@echo off
call "%~dp0update.bat" nopause
echo -
echo This will try to reinstall Node deps and Python deps (if python_embeded present).
echo -
echo If you just want to update normally, close this and run update.bat instead.
echo -
pause
call npm install 2>nul
if %errorlevel% neq 0 echo npm install failed or npm not on PATH.

if exist "..\python_embeded\python.exe" (
  echo Updating python_embeded deps...
  "..\python_embeded\python.exe" -s -m pip install --upgrade pygit2 2>nul
) else (
  echo python_embeded not found — skipping Python deps.
)
pause
