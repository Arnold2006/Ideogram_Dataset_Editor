@echo off
call "%~dp0update.bat" nopause
echo -
echo Rebuilding portable (npm run dist)...
echo -
if exist "..\python_embeded\python.exe" (
  where npm >nul 2>&1
  if %errorlevel%==0 (
    call npm run dist
  ) else (
    echo npm not on PATH — install Node.js 18+ or use the pre-built out\win-unpacked
  )
) else (
  call npm run dist 2>nul
  if %errorlevel% neq 0 (
    echo npm not found. Install Node.js 18+ then re-run this.
  )
)
pause
