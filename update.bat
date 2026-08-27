@echo off
setlocal
title FrameForge Update
set "ROOT=%~dp0"
pushd "%ROOT%"
echo [FrameForge] Updating from git...
git pull
if %errorlevel% neq 0 (
  echo [FrameForge] git pull failed.
  pause
  exit /b 1
)
echo.
echo [FrameForge] Updating dependencies if needed...
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
echo [FrameForge] Done.
pause
