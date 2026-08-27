@echo off
REM Ideogram4 Dataset Editor - portable launcher (ComfyUI_windows_portable style)
REM No install, no admin, no system Node/Python required after first build.
setlocal
pushd "%~dp0"
if exist "out\win-unpacked\Ideogram4Editor.exe" goto :exe
if exist "dist\index.html" goto :dist
goto :nobuild

:exe
echo Starting Ideogram4Editor (portable exe)...
start "" "out\win-unpacked\Ideogram4Editor.exe"
popd
exit /b

:dist
echo Found built frontend - launching Electron...
if exist "node_modules\.bin\electron.cmd" goto :electron
if exist "python_embeded\python.exe" goto :pyfallback
echo Electron not found. Run: npm install
pause
popd
exit /b

:electron
call "node_modules\.bin\electron.cmd" .
popd
exit /b

:pyfallback
echo Electron binary missing, trying browser fallback via Python...
"python_embeded\python.exe" -s app\launch.py --browser
pause
popd
exit /b

:nobuild
echo No build found. First-time setup:
echo   1) npm install
echo   2) npm run dist
echo Then re-run run.bat
pause
popd
exit /b
