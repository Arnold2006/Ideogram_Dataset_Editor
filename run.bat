@echo off
REM Ideogram4 Dataset Editor — portable launcher (ComfyUI_windows_portable style)
REM No install, no admin, no system Node/Python required after first build.
SETLOCAL
cd /d "%~dp0"

if exist "out\win-unpacked\Ideogram4Editor.exe" (
  echo Starting Ideogram4Editor (portable exe)...
  start "" "out\win-unpacked\Ideogram4Editor.exe"
  exit /b
)
if exist "dist\index.html" (
  echo Found built frontend — launching Electron...
  if exist "node_modules\.bin\electron.cmd" (
    call "node_modules\.bin\electron.cmd" .
    exit /b
  )
  if exist "python_embeded\python.exe" (
    echo Electron binary missing, trying browser fallback via Python...
    "python_embeded\python.exe" -s app\launch.py --browser
    pause
    exit /b
  )
  echo Electron not found. Run: npm install
  pause
  exit /b
)
echo No build found. First-time setup:
echo   1) npm install
echo   2) npm run dist
echo Then re-run run.bat
pause
