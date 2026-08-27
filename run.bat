@echo off
REM Ideogram 4 Dataset Editor — FrameForge engine (5s) + Ideogram UI (grid + bbox)
REM Portable, like ComfyUI: python_embeded optional, Node 18+ required, no Electron.
REM UI is the Ideogram two-pane (left 3-col thumbs, right JSON + bbox canvas).
REM Engine is FrameForge's server.mjs (ctx 32768, flash-attn, GPU 99, json_schema strict).
setlocal
pushd "%~dp0"

REM If portable exe exists from old Electron build, still support it
if exist "out\win-unpacked\Ideogram4Editor.exe" goto checkbin

if exist "dist\index.html" goto checkbin_dist
if exist "server.mjs" goto checkbin_dist
goto autobuild

:checkbin
call :ensure_llama
if exist "out\win-unpacked\Ideogram4Editor.exe" goto exe
goto server

:checkbin_dist
call :ensure_llama
goto server

:exe
echo Starting Ideogram4Editor — portable exe (legacy Electron)...
start "" "out\win-unpacked\Ideogram4Editor.exe"
popd
exit /b

:server
echo Starting Ideogram Dataset Editor — FrameForge engine (http://127.0.0.1:7860)...
REM Prefer node server.mjs (new, 5s), fallback to Electron if present
if exist "server.mjs" goto nodeserver
if exist "node_modules\.bin\electron.cmd" goto electron
echo No server found — needs npm install
goto autobuild

:nodeserver
where node >nul 2>&1
if errorlevel 1 goto nonpm
node server.mjs
popd
exit /b

:electron
call "node_modules\.bin\electron.cmd" .
popd
exit /b

:autobuild
echo No build found — running automatic setup...
where npm >nul 2>&1
if not errorlevel 1 goto has_npm
goto nonpm
:has_npm
if exist "node_modules" goto skip_install
echo Installing dependencies — npm install...
call npm install
if errorlevel 1 goto npmfail
:skip_install
echo Building frontend — npm run build...
call npm run build
if errorlevel 1 goto buildfail
call :ensure_llama
echo Launching server...
if exist "server.mjs" goto nodeserver
if exist "dist\index.html" goto server
goto buildfail

:ensure_llama
REM auto-download llama-server if missing (same as before, now also for Node server)
if exist "bin\llama-server.exe" exit /b 0
if exist "frameforge\bin\llama-server.exe" exit /b 0
if exist "out\win-unpacked\bin\llama-server.exe" exit /b 0
if exist "out\win-unpacked\resources\app\bin\llama-server.exe" exit /b 0
echo llama-server.exe not found — downloading automatically...
where node >nul 2>&1
if errorlevel 1 goto ensure_powershell
node scripts\fetch-llama.js
exit /b 0
:ensure_powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\fetch-llama.ps1"
exit /b 0

:nonpm
echo npm not found. Please install Node.js 18+ from https://nodejs.org/
echo Then re-run run.bat
echo Alternatively download the prebuilt portable zip from GitHub Releases.
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
