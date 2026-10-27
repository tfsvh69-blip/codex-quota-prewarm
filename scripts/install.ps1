# Run from PowerShell as the Windows user who will use Codex.
# This installer does NOT copy or create any account credentials.
param([switch]$ReplaceExistingTasks)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$nodeCmd=Get-Command node.exe -ErrorAction SilentlyContinue
if(-not $nodeCmd){throw "Node.js >= 20 not found on PATH. Install Node.js or add it to PATH."}
$node=$nodeCmd.Source
$nodeMajor=[int]((& $node --version).TrimStart('v').Split('.')[0])
if($nodeMajor -lt 20){throw 'Node.js >=20 is required.'}
$codexCmd=Get-Command codex.cmd -ErrorAction SilentlyContinue
if(-not $codexCmd){Write-Warning 'Codex CLI missing from PATH. Run: npm install -g @openai/codex'}
if(!(Test-Path (Join-Path $root 'src\smart-scheduler.js'))){throw 'Project source missing.'}
Set-Content -LiteralPath (Join-Path $root 'node-path.txt') -Value $node -Encoding ASCII
$wscript=Join-Path $env:WINDIR 'System32\wscript.exe'
$runner=Join-Path $root 'scripts\run-node-hidden.vbs'
$usr=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal=New-ScheduledTaskPrincipal -UserId $usr -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 8)
function Register-PrewarmTask($name,$relativeScript,$trigger,$tail='') {
  $file=Join-Path $root $relativeScript
  $arguments='//B //Nologo "'+$runner+'" "'+$file+'"'
  if($tail){$arguments+=' '+$tail}
  $action=New-ScheduledTaskAction -Execute $wscript -Argument $arguments -WorkingDirectory $root
  $existing=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if($existing -and !$ReplaceExistingTasks){throw "Task $name exists; use -ReplaceExistingTasks to update."}
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Write-Output "Installed: $name"
}
$morning=New-ScheduledTaskTrigger -Daily -At '05:30'
$morning.Repetition.Interval='PT15M'
$morning.Repetition.Duration='PT5H30M'
$poll=New-ScheduledTaskTrigger -Daily -At '08:00'
$poll.Repetition.Interval='PT10M'
$poll.Repetition.Duration='PT15H'
$login=New-ScheduledTaskTrigger -AtLogOn -User $usr
try{$login.Delay='PT90S'}catch{Write-Warning 'Unable to set login delay; task remains active.'}
Register-PrewarmTask 'Codex-Prewarm-Morning' 'src\morning-real-prewarm.js' $morning
Register-PrewarmTask 'Codex-Prewarm-SmartPoll' 'src\smart-scheduler.js' $poll
Register-PrewarmTask 'Codex-Prewarm-OnLogin' 'src\smart-scheduler.js' $login '--logon-recovery'
Write-Output 'Completed. Log in to two separate Codex ChatGPT accounts BEFORE relying on scheduled runs.'
Write-Output ('Log files: '+(Join-Path $root 'logs'))
