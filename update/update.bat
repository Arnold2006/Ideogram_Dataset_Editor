@echo off
REM Ideogram4 Dataset Editor - update from GitHub, rebuild, and start (ComfyUI style)
REM Uses python_embeded/pygit2 if present, else plain git CLI.
REM After pull it rebuilds the portable (npm run dist) and launches the app.
setlocal
pushd "%~dp0"
if exist "..\python_embeded\python.exe" goto :pyembed
goto :trygit

:pyembed
echo Updating via python_embeded + pygit2 (if available) or git CLI...
"..\python_embeded\python.exe" -s update.py ".." --rebuild
if exist "update_new.py" goto :pynew
goto :launch

:pynew
move /y "update_new.py" "update.py" >nul
echo Updater was updated - running again...
"..\python_embeded\python.exe" -s update.py ".." --skip_self_update --rebuild
goto :launch

:trygit
echo python_embeded not found - trying git CLI + system python...
where git >nul 2>&1
if errorlevel 1 goto :nogit
python update.py ".." --rebuild
if exist "update_new.py" goto :gitnew
goto :launch

:gitnew
move /y "update_new.py" "update.py" >nul
python update.py ".." --skip_self_update --rebuild
goto :launch

:nogit
echo Neither python_embeded nor git found.
echo Install git for Windows or copy python_embeded from ComfyUI_windows_portable.
echo Alternatively: git pull
goto :launch

:launch
popd
echo.
echo Update and rebuild complete - starting app...
REM Prefer portable exe, fallback to run.bat (handles dev mode / auto-build)
if exist "%~dp0..\out\win-unpacked\Ideogram4Editor.exe" (
  echo Starting portable exe...
  start "" "%~dp0..\out\win-unpacked\Ideogram4Editor.exe"
) else if exist "%~dp0..\run.bat" (
  echo Portable not found, launching via run.bat...
  call "%~dp0..\run.bat"
) else (
  echo No launch target found. Run: npm run dist
)
if "%~1"=="" pause
exit /b
