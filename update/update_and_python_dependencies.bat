@echo off
call "%~dp0update.bat" nopause
echo -
echo This will try to reinstall Node deps and Python deps (if python_embeded present).
echo -
echo If you just want to update normally, close this and run update.bat instead.
echo -
pause
call npm install
if errorlevel 1 echo npm install failed or npm not on PATH.
if exist "..\python_embeded\python.exe" goto :pydep
echo python_embeded not found - skipping Python deps.
goto :done
:pydep
echo Updating python_embeded deps...
"..\python_embeded\python.exe" -s -m pip install --upgrade pygit2
:done
pause
