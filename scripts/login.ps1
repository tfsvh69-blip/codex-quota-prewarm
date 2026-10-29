param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[A-Z][A-Z0-9_-]*$')][string]$Account,
 [switch]$Replace,
 [switch]$ValidateOnly
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$config=Join-Path $root 'config.local.json'
$slots=@()
if(Test-Path $config){
 $settings=Get-Content -LiteralPath $config -Raw|ConvertFrom-Json
 $slots=@($settings.accounts)
}
if(!$slots.Count){
 $slots=@(
  [pscustomobject]@{name='A';home='.codex';enabled=$true},
  [pscustomobject]@{name='B';home='.codex-prewarm-B';enabled=$true},
  [pscustomobject]@{name='C';home='.codex-prewarm-C';enabled=$true}
 )
}
$entry=$slots|Where-Object {$_.name -eq $Account -and $_.enabled -ne $false}|Select-Object -First 1
if(!$entry){throw 'Slot not enabled in config.local.json'}
if($Replace -and $Account -eq 'A'){throw 'Refusing to replace primary slot A through this script'}
$slotHome=if([IO.Path]::IsPathRooted([string]$entry.home)){[string]$entry.home}else{Join-Path $env:USERPROFILE ([string]$entry.home)}
New-Item -ItemType Directory -Path $slotHome -Force|Out-Null
$cli=Get-Command codex.cmd -ErrorAction Stop
$priorHome=$env:CODEX_HOME;$priorApi=$env:OPENAI_API_KEY;$priorToken=$env:CODEX_ACCESS_TOKEN
try {
 $env:CODEX_HOME=$slotHome;$env:OPENAI_API_KEY=$null;$env:CODEX_ACCESS_TOKEN=$null
 if($ValidateOnly){ Write-Host "PREFLIGHT_OK account=$Account directory=$slotHome"; return }
 if($Replace){ & $cli.Source logout }
 Write-Host "Sign in to ChatGPT account slot $Account."
 & $cli.Source login
 if($LASTEXITCODE -ne 0){throw 'Codex login failed'}
 & $cli.Source login status
} finally {
 $env:CODEX_HOME=$priorHome;$env:OPENAI_API_KEY=$priorApi;$env:CODEX_ACCESS_TOKEN=$priorToken
}
