# Produce a source-only Windows release ZIP from the Git commit (not from a live user profile).
# No auth files, runtime state, ignored logs or local configuration can be archived.
param(
 [ValidatePattern('^\d{4}-\d{2}-\d{2}$')][string]$Version='2026-10-29'
)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
 if((git status --porcelain --untracked-files=no).Count -gt 0){
  throw 'Tracked files have uncommitted changes. Commit and review them before packaging HEAD.'
 }
 $dir=Join-Path $repo 'releases'
 if(!(Test-Path -LiteralPath $dir)){New-Item -ItemType Directory -Path $dir|Out-Null}
 $output=Join-Path $dir ("codex-quota-prewarm-$Version.zip")
 if(Test-Path -LiteralPath $output){throw "Release ZIP already exists: $output"}
 & git archive --format=zip --prefix='codex-quota-prewarm/' "--output=$output" HEAD
 if($LASTEXITCODE -ne 0){throw 'git archive failed'}
 # Windows PowerShell 5.1 needs the FileSystem assembly for ZipFile.
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $zip=[System.IO.Compression.ZipFile]::OpenRead($output)
 try {
  $entries=@($zip.Entries | ForEach-Object {$_.FullName})
  if(!$entries.Count){throw 'Archive is empty'}
  $forbidden='(?i)(^|/)(auth\.json|config\.local\.json|\.dashboard\.local\.json|node-path\.txt|dashboard-state\.json|\.env|logs/|\.git/)'
  if(@($entries | Where-Object {$_ -match $forbidden}).Count){throw 'Sensitive or runtime file in archive'}
  if(!(@($entries | Where-Object {$_ -eq 'codex-quota-prewarm/README.md'}).Count)){throw 'README missing'}
  Write-Output "ARCHIVE_OK entries=$($entries.Count)"
 }finally{$zip.Dispose()}
 $sha=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
 Write-Output "OUTPUT=$output"
 Write-Output "SHA256=$sha"
}catch {
 if($output -and (Test-Path -LiteralPath $output)){Remove-Item -LiteralPath $output -Force}
 throw
}finally{Pop-Location}
