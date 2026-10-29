# Register Windows Task Scheduler jobs; no Codex requests are sent at installation time.
param([switch]$ReplaceExistingTasks)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$nodeCmd=Get-Command node.exe -ErrorAction SilentlyContinue
if(-not $nodeCmd){throw "Node.js >= 20 not found on PATH."}
$node=$nodeCmd.Source
$nodeMajor=[int]((& $node --version).TrimStart('v').Split('.')[0])
if($nodeMajor -lt 20){throw 'Node.js >= 20 is required.'}
if(-not (Get-Command codex.cmd -ErrorAction SilentlyContinue)){
 Write-Warning 'Codex CLI missing from PATH. Run: npm install -g @openai/codex'
}
if(!(Test-Path (Join-Path $root 'src\smart-scheduler.js'))){throw 'Project source missing.'}
Set-Content -LiteralPath (Join-Path $root 'node-path.txt') -Value $node -Encoding ASCII
$wscript=Join-Path $env:WINDIR 'System32\wscript.exe'
$runner=Join-Path $root 'scripts\run-node-hidden.vbs'
$usr=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal=New-ScheduledTaskPrincipal -UserId $usr -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 8)
function Register-PrewarmTask($name,$relativeScript,$trigger,$tail,$interval,$duration,$delay) {
  $file=Join-Path $root $relativeScript
  if(!(Test-Path -LiteralPath $file)){throw "Missing script: $file"}
  $arguments='//B //Nologo "'+$runner+'" "'+$file+'"'
  if($tail){$arguments+=' '+$tail}
  $action=New-ScheduledTaskAction -Execute $wscript -Argument $arguments -WorkingDirectory $root
  $existing=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if($existing -and !$ReplaceExistingTasks){throw "Task $name exists; use -ReplaceExistingTasks to update."}
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  # Some Windows versions do not expose Interval / Duration setters on New-ScheduledTaskTrigger.
  # Repetition and login delay are configured using the Task Scheduler XML format.
  if($interval -or $delay){
    [xml]$xml=Export-ScheduledTask -TaskName $name
    $ns=$xml.DocumentElement.NamespaceURI
    if($interval) {
      $target=$xml.SelectSingleNode("//*[local-name()='CalendarTrigger']")
      if(!$target){throw "Missing CalendarTrigger for $name"}
      $rep=$target.SelectSingleNode("./*[local-name()='Repetition']")
      if(!$rep){$rep=$xml.CreateElement('Repetition',$ns);$target.InsertBefore($rep,$target.FirstChild)|Out-Null}
      foreach($spec in @(@('Interval',$interval),@('Duration',$duration))){
        $el=$rep.SelectSingleNode("./*[local-name()='"+$spec[0]+"']")
        if(!$el){$el=$xml.CreateElement($spec[0],$ns);$rep.AppendChild($el)|Out-Null}
        $el.InnerText=$spec[1]
      }
    }
    if($delay) {
      $target=$xml.SelectSingleNode("//*[local-name()='LogonTrigger']")
      if(!$target){throw "Missing LogonTrigger for $name"}
      $el=$target.SelectSingleNode("./*[local-name()='Delay']")
      if(!$el){$el=$xml.CreateElement('Delay',$ns);$target.AppendChild($el)|Out-Null}
      $el.InnerText=$delay
    }
    Register-ScheduledTask -TaskName $name -Xml $xml.OuterXml -Force | Out-Null
  }
  $task=Get-ScheduledTask -TaskName $name
  Write-Output "Installed: $name; active=$($task.Settings.Enabled)"
}
$morning=New-ScheduledTaskTrigger -Daily -At '05:30'
$poll=New-ScheduledTaskTrigger -Daily -At '08:00'
$login=New-ScheduledTaskTrigger -AtLogOn -User $usr
Register-PrewarmTask 'Codex-Prewarm-Morning' 'src\morning-real-prewarm.js' $morning '' 'PT15M' 'PT5H30M' ''
Register-PrewarmTask 'Codex-Prewarm-SmartPoll' 'src\smart-scheduler.js' $poll '' 'PT10M' 'PT15H' ''
Register-PrewarmTask 'Codex-Prewarm-OnLogin' 'src\smart-scheduler.js' $login '--logon-recovery' '' '' 'PT1M30S'
Write-Output ('Log files: '+(Join-Path $root 'logs'))
Write-Output 'Complete separate ChatGPT A/B/C logins before unattended use.'
