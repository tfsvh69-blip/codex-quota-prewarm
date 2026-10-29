$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$nodeCmd=Get-Command node.exe -ErrorAction SilentlyContinue
if(!$nodeCmd){throw 'Node.js not in PATH, install Node.js 20+ first.'}
$node=$nodeCmd.Source
Set-Content -LiteralPath (Join-Path $root 'node-path.txt') -Value $node -Encoding ASCII
$name='Codex-额度管理上位机'
$wscript=Join-Path $env:WINDIR 'System32\wscript.exe'
$script=Join-Path $root 'scripts\start-dashboard.vbs'
$action=New-ScheduledTaskAction -Execute $wscript -Argument ('//B //Nologo "'+$script+'"') -WorkingDirectory $root
$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $user
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force|Out-Null
Start-ScheduledTask -TaskName $name
$desktop=[Environment]::GetFolderPath('Desktop')
$shortcut=Join-Path $desktop 'Codex额度管理台.url'
[IO.File]::WriteAllText($shortcut,(@('[InternetShortcut]','URL=http://127.0.0.1:38671/') -join [Environment]::NewLine),(New-Object System.Text.UTF8Encoding($false)))
Write-Host 'Dashboard task and desktop shortcut configured. URL: http://127.0.0.1:38671'
