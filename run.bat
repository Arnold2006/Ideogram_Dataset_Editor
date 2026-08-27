@echo off
setlocal EnableDelayedExpansion
title Ideogram4 Dataset Editor
set "ROOT=%~dp0"
set "APP=%ROOT%app"
if not exist "%APP%\server.mjs" (
  echo [Ideogram4 Dataset Editor] Could not find app\server.mjs at %APP%
  pause
  exit /b 1
)
set "NODE_EXE="
if exist "%APP%\node\node.exe" set "NODE_EXE=%APP%\node\node.exe"
if not defined NODE_EXE (
  where node >nul 2>&1
  if !errorlevel! equ 0 (
    for /f "delims=" %%i in ('where node') do set "NODE_EXE=%%i" & goto :found
  )
)
:found
if not defined NODE_EXE (
  echo [Ideogram4 Dataset Editor] Node.js not found.
  echo  Please install Node.js 20+ from https://nodejs.org
  echo  OR place a portable Node at app\node\node.exe
  echo  Download win-x64 zip from https://nodejs.org/dist/latest-v20.x/
  pause
  exit /b 1
)
echo [Ideogram4 Dataset Editor] Using Node: %NODE_EXE%
"%NODE_EXE%" --version
if not exist "%APP%\node_modules" (
  echo [Ideogram4 Dataset Editor] Installing dependencies (first run)...
  pushd "%APP%"
  if exist "%APP%\node\npm\bin\npm-cli.js" (
    "%NODE_EXE%" "%APP%\node\npm\bin\npm-cli.js" install
  ) else (
    where npm >nul 2>&1
    if !errorlevel! equ 0 ( call npm install ) else ( "%NODE_EXE%" --run npm install 2>nul )
  )
  popd
)
if not exist "%APP%\node_modules" (
  echo [Ideogram4 Dataset Editor] Trying npm from PATH...
  pushd "%APP%"
  call npm install
  popd
)
if not exist "%APP%\bin\llama-server.exe" (
  echo [Ideogram4 Dataset Editor] llama-server not found — editor still works, generation needs it.
  echo [Ideogram4 Dataset Editor] Run: node app/scripts/download-llama.mjs and add models to app\models\
)
set "PORT=8123"
echo [Ideogram4 Dataset Editor] Starting on http://127.0.0.1:%PORT% ...
echo [Ideogram4 Dataset Editor] Keep this window open. Close to stop.
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:%PORT%"
pushd "%APP%"
"%NODE_EXE%" server.mjs
popd
pause
