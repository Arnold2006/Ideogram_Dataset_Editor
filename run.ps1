# PowerShell launcher — so you can run `.\run.ps1` or `powershell -File run.ps1` without cmd quirks
# Just delegates to run.bat via cmd, so spaced paths still work.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& cmd /c "`"$here\run.bat`""
exit $LASTEXITCODE
