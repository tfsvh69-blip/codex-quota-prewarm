$ErrorActionPreference='Stop'
foreach($n in @('Codex-Prewarm-Morning','Codex-Prewarm-SmartPoll','Codex-Prewarm-OnLogin')){
  if(Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue){
    Unregister-ScheduledTask -TaskName $n -Confirm:$false
    Write-Output "Removed task: $n"
  }
}
Write-Output 'Account credentials, scripts and logs have NOT been deleted.'
