param([ValidateSet('A','B')][string]$Account='B')
$ErrorActionPreference='Stop'
$cmd=Get-Command codex.cmd -ErrorAction Stop
$home=if($Account -eq 'A') {Join-Path $env:USERPROFILE '.codex'}
      else {Join-Path $env:USERPROFILE '.codex-prewarm-B'}
New-Item -ItemType Directory -Force -Path $home|Out-Null
$previous=$env:CODEX_HOME
$api=$env:OPENAI_API_KEY
try {
  $env:CODEX_HOME=$home
  $env:OPENAI_API_KEY=$null
  Write-Output "Sign in to ChatGPT Codex account $Account using the opened browser."
  & $cmd.Source login
  & $cmd.Source login status
} finally {
  $env:CODEX_HOME=$previous
  $env:OPENAI_API_KEY=$api
}
