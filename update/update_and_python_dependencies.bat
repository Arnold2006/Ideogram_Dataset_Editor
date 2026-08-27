@echo off
REM Ideogram4 Dataset Editor - update, reinstall Node/Python deps, rebuild, and start
call "%~dp0update.bat" nopause
echo.
echo Reinstalling Node and Python dependencies...
call npm install
if errorlevel 1 echo npm install failed or npm not on PATH - will try to launch existing build.

if exist "%~dp0..\python_embeded\python.exe" (
  echo Updating python_embeded deps...
  "%~dp0..\python_embeded\python.exe" -s -m pip install --upgrade pygit2
) else (
  echo python_embeded not found - skipping Python deps.
)

echo Rebuilding portable...
where npm >nul 2>&1
if not errorlevel 1 call npm run dist

echo Starting app...
if exist "%~dp0..\out\win-unpacked\Ideogram4Editor.exe" (
  start "" "%~dp0..\out\win-unpacked\Ideogram4Editor.exe"
) else if exist "%~dp0..\run.bat" (
  call "%~dp0..\run.bat"
)
pause
