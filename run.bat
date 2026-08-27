@echo off
REM Ideogram4 Dataset Editor - portable launcher (ComfyUI_windows_portable style)
REM Auto-installs deps and binaries if missing.
setlocal
pushd "%~dp0"
if exist "out\win-unpacked\Ideogram4Editor.exe" goto :checkbin
if exist "dist\index.html" goto :checkbin_dist
goto :autobuild

:checkbin
call :ensure_llama
if exist "out\win-unpacked\Ideogram4Editor.exe" goto :exe
goto :dist

:checkbin_dist
call :ensure_llama
goto :dist

:exe
echo Starting Ideogram4Editor (portable exe)...
start "" "out\win-unpacked\Ideogram4Editor.exe"
popd
exit /b

:dist
echo Found built frontend - launching Electron...
if exist "node_modules\.bin\electron.cmd" goto :electron
echo Electron not found - needs npm install
goto :autobuild

:electron
call "node_modules\.bin\electron.cmd" .
popd
exit /b

:autobuild
echo No build found - running automatic setup...
where npm >nul 2>&1
if errorlevel 1 goto :nonpm
if not exist "node_modules" (
  echo Installing dependencies (npm install)...
  call npm install
  if errorlevel 1 goto :npmfail
)
echo Building frontend (npm run build)...
call npm run build
if errorlevel 1 goto :buildfail
call :ensure_llama
echo Building portable (npm run dist)...
call npm run dist
if errorlevel 1 (
  echo Portable build failed - trying to launch with dist only
  if exist "node_modules\.bin\electron.cmd" goto :electron
  goto :buildfail
)
if exist "out\win-unpacked\Ideogram4Editor.exe" goto :exe
if exist "dist\index.html" goto :electron
goto :buildfail

:ensure_llama
REM auto-download llama-server if missing
if exist "bin\llama-server.exe" exit /b 0
if exist "out\win-unpacked\bin\llama-server.exe" exit /b 0
if exist "out\win-unpacked\resources\app\bin\llama-server.exe" exit /b 0
echo llama-server.exe not found - downloading automatically...
REM prefer node fetch
where node >nul 2>&1
if not errorlevel 1 (
  node scripts\fetch-llama.js
  exit /b 0
)
REM fallback to powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\fetch-llama.ps1"
exit /b 0

:nonpm
echo npm not found. Please install Node.js 18+ from https://nodejs.org/
echo Then re-run run.bat
echo Alternatively download the prebuilt portable zip from GitHub Releases (contains out\win-unpacked).
pause
popd
exit /b 1

:npmfail
echo npm install failed. Check internet and try again.
pause
popd
exit /b 1

:buildfail
echo Build failed. See errors above.
pause
popd
exit /b 1
