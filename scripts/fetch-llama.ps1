param([switch]$Force)
# Wrapper for fetch-llama.js so run.bat can call PowerShell without Node knowledge
$ErrorActionPreference='Stop'
Push-Location $PSScriptRoot
try{
  if(Test-Path "..\bin\llama-server.exe" -and -not $Force){
    Write-Host "[fetch-llama.ps1] llama-server.exe already present — skip"
    exit 0
  }
  # prefer node if available
  $node = $null
  foreach($c in @("node","node.exe")){
    try{ $node = (Get-Command $c -ErrorAction SilentlyContinue).Source } catch{}
    if($node){ break }
  }
  if($node){
    Write-Host "[fetch-llama.ps1] using node $node"
    & $node "$PSScriptRoot\fetch-llama.js"
    exit $LASTEXITCODE
  }
  # fallback: direct PowerShell download (pinned)
  Write-Host "[fetch-llama.ps1] node not found, using PowerShell download (pinned b4242)"
  $binDir = Join-Path $PSScriptRoot "..\bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  $url = "https://github.com/ggml-org/llama.cpp/releases/download/b4242/llama-b4242-bin-win-avx2-x64.zip"
  $zip = Join-Path $binDir "llama-b4242-bin-win-avx2-x64.zip"
  if(-not (Test-Path $zip)){
    Write-Host "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  }
  $tmp = Join-Path $binDir "_dl_tmp"
  if(Test-Path $tmp){ Remove-Item -Recurse -Force $tmp }
  Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
  $exe = Get-ChildItem -Recurse -Path $tmp -Filter "llama-server.exe" | Select-Object -First 1
  if($exe){
    Copy-Item -Force $exe.FullName (Join-Path $binDir "llama-server.exe")
    Write-Host "Installed llama-server.exe"
    Get-ChildItem -Recurse -Path $tmp -Filter "*.dll" | ForEach-Object { Copy-Item -Force $_.FullName $binDir -ErrorAction SilentlyContinue }
  }
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  if(-not (Test-Path (Join-Path $binDir "llama-server.exe"))){ Write-Error "Download failed"; exit 1 }
} finally { Pop-Location }
