param([switch]$Zip)
# Build portable dir then optionally zip (ComfyUI-style portable)
$ErrorActionPreference='Stop'
Push-Location $PSScriptRoot/..
try{
  npm run dist
  if($Zip){ npm run package:zip }
  Write-Host "`nPortable ready:" -ForegroundColor Green
  Get-ChildItem out -Recurse -Directory | Select-Object FullName | Format-Table -AutoSize
  if(Test-Path out/win-unpacked/Ideogram4Editor.exe){
    Write-Host "Launch with: .\run.bat  (or .\run_cpu.bat / .\run_nvidia_gpu.bat)" -ForegroundColor Cyan
  }
  if($Zip -and (Test-Path out/Ideogram4Editor-*.zip)){
    Get-ChildItem out/*.zip | ForEach-Object { Write-Host "Zip: $($_.FullName)  $(([int]($_.Length/1MB)).ToString()) MB" }
  }
  Write-Host "Update: .\update\update.bat  /  .\update\update_and_rebuild.bat" -ForegroundColor Cyan
} finally { Pop-Location }
