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
set "NODE_EXE=%APP%\node\node.exe"
if not exist "%NODE_EXE%" (
  echo [Ideogram4 Dataset Editor] Portable Node.js not found at %NODE_EXE%
  echo.
  echo To make this app fully portable:
  echo 1. Download Node.js win-x64 zip from https://nodejs.org/dist/latest-v20.x/
  echo 2. Extract and copy node.exe to: %APP%\node\node.exe
  echo 3. Also copy the npm folder to: %APP%\node\npm\
  echo.
  echo This app requires portable Node.js - no system installation used.
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
