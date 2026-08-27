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
set "ZIP=%APP%\node.zip"

if not exist "%NODE_EXE%" (
  echo [Ideogram4 Dataset Editor] Portable Node.js not found. Downloading...
  if not exist "%NODE_DIR%" mkdir "%NODE_DIR%"
  
  echo Downloading Node.js v20.18.0...
  powershell -NoProfile -Command "$url=$env:NODE_URL; $zip=$env:ZIP; Invoke-WebRequest -Uri $url -OutFile $zip; if (Test-Path $zip) { Write-Host 'Download OK: ' $zip } else { exit 1 }"
  if errorlevel 1 (
    echo Download failed. Check internet connection.
    pause
    exit /b 1
  )
  
  if not exist "%ZIP%" (
    echo Download failed - file not found at %ZIP%
    pause
    exit /b 1
  )
  
  echo Extracting Node.js...
  powershell -NoProfile -Command "$zip=$env:ZIP; $dest=$env:NODE_DIR; if (Test-Path $zip) { Expand-Archive -Path $zip -DestinationPath $dest -Force; Write-Host 'Extract OK' } else { Write-Host 'ZIP not found: ' $zip; exit 1 }"
  if errorlevel 1 (
    echo Extraction failed.
    if exist "%ZIP%" del "%ZIP%"
    pause
    exit /b 1
  )
  
  rem Move contents from node-v20.18.0-win-x64 subfolder up to node dir
  echo Checking extracted structure...
  dir /b "%NODE_DIR%"
  for /d %%d in ("%NODE_DIR%\node-v*-win-x64") do (
    echo Found subfolder: %%d
    robocopy "%%d" "%NODE_DIR%" /E /MOVE
    if errorlevel 8 (
      echo robocopy failed with error %errorlevel%
    ) else (
      rmdir /s /q "%%d"
    )
  )
  if not exist "%NODE_EXE%" (
    echo Searching for node.exe in extracted folders...
    for /r "%NODE_DIR%" %%f in (node.exe) do (
      echo Found node.exe at: %%f
      set "FOUND_NODE=%%f"
    )
    if defined FOUND_NODE (
      echo Copying found node.exe to %NODE_EXE%
      copy "%FOUND_NODE%" "%NODE_EXE%"
    )
  )
  
  if exist "%ZIP%" del "%ZIP%"
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
  if exist "%APP%\node\node_modules\npm\bin\npm-cli.js" (
    echo [Ideogram4 Dataset Editor] Found npm at node_modules/npm/bin/npm-cli.js
    "%NODE_EXE%" "%APP%\node\node_modules\npm\bin\npm-cli.js" install
  ) else if exist "%APP%\node\npm\bin\npm-cli.js" (
    echo [Ideogram4 Dataset Editor] Found npm at npm/bin/npm-cli.js
    "%NODE_EXE%" "%APP%\node\npm\bin\npm-cli.js" install
  ) else (
    echo [Ideogram4 Dataset Editor] Portable npm not found at either location.
    echo Checked: %APP%\node\node_modules\npm\bin\npm-cli.js
    echo Checked: %APP%\node\npm\bin\npm-cli.js
    popd
    pause
    exit /b 1
  )
  if errorlevel 1 (
    echo [Ideogram4 Dataset Editor] npm install failed with exit code %errorlevel%.
    popd
    pause
    exit /b 1
  )
  popd
)
if not exist "%APP%\node_modules" (
  echo [Ideogram4 Dataset Editor] npm install failed - node_modules not created.
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
