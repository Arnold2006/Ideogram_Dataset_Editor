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

set "NODE_DIR=%APP%\node"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NODE_URL=https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip"

if not exist "%NODE_EXE%" (
  echo [Ideogram4 Dataset Editor] Portable Node.js not found. Downloading...
  if not exist "%NODE_DIR%" mkdir "%NODE_DIR%"
  
  set "ZIP=%APP%\node.zip"
  echo Downloading Node.js v20.18.0...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%ZIP%'"
  if errorlevel 1 (
    echo Download failed. Check internet connection.
    pause
    exit /b 1
  )
  
  echo Extracting Node.js...
  powershell -NoProfile -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '%NODE_DIR%' -Force"
  if errorlevel 1 (
    echo Extraction failed.
    del "%ZIP%"
    pause
    exit /b 1
  )
  
  rem Move contents from node-v20.18.0-win-x64 subfolder up to node dir
  for /d %%d in ("%NODE_DIR%\node-v*-win-x64") do (
    robocopy "%%d" "%NODE_DIR%" /E /MOVE >nul
    rmdir /s /q "%%d"
  )
  
  del "%ZIP%"
  echo Node.js installed to %NODE_DIR%
)

if not exist "%NODE_EXE%" (
  echo [Ideogram4 Dataset Editor] Node.js extraction failed - node.exe not found.
  pause
  exit /b 1
)

echo [Ideogram4 Dataset Editor] Using portable Node: %NODE_EXE%
"%NODE_EXE%" --version
if not exist "%APP%\node_modules" (
  echo [Ideogram4 Dataset Editor] Installing dependencies (first run)...
  pushd "%APP%"
  if exist "%APP%\node\npm\bin\npm-cli.js" (
    "%NODE_EXE%" "%APP%\node\npm\bin\npm-cli.js" install
  ) else (
    echo [Ideogram4 Dataset Editor] Portable npm not found at %APP%\node\npm\
    echo Please copy the npm folder from Node.js distribution to: %APP%\node\npm\
    popd
    pause
    exit /b 1
  )
  popd
)
if not exist "%APP%\node_modules" (
  echo [Ideogram4 Dataset Editor] npm install failed.
  pause
  exit /b 1
)
if not exist "%APP%\bin\llama-server.exe" (
  echo [Ideogram4 Dataset Editor] llama-server not found — editor still works, generation needs it.
  echo [Ideogram4 Dataset Editor] Run: node app/scripts/download-llama.mjs and add models to app\models\
)
set "PORT=8123"
echo [Ideogram4 Dataset Editor] Starting on http://127.0.0.1:%PORT% ...
echo [Ideogram4 Dataset Editor] Keep this window open. Close to stop.
echo.
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:%PORT%
pushd "%APP%"
"%NODE_EXE%" server.mjs
popd
pause
