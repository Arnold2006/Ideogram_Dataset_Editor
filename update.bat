@echo off
setlocal
title Ideogram4 Dataset Editor Update
set "ROOT=%~dp0"
pushd "%ROOT%"
echo [Ideogram4 Dataset Editor] Updating from git...
git pull
if %errorlevel% neq 0 (
  echo [Ideogram4 Dataset Editor] git pull failed.
  pause
  exit /b 1
)
echo.
echo [Ideogram4 Dataset Editor] Updating dependencies if needed...
if exist "app\package.json" (
  pushd "app"
  where npm >nul 2>&1
  if %errorlevel% equ 0 (
    call npm install
  ) else (
    where node >nul 2>&1
    if %errorlevel% equ 0 (
      if exist "node\node.exe" (
        "node\node.exe" "node\npm\bin\npm-cli.js" install
      )
    )
  )
  popd
)
echo [Ideogram4 Dataset Editor] Done.
pause
