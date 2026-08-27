@echo off
REM Ideogram4 Dataset Editor — update (ComfyUI style)
REM Uses python_embeded/pygit2 if present, else plain git CLI.
SETLOCAL
cd /d "%~dp0"

if exist "..\python_embeded\python.exe" (
  echo Updating via python_embeded + pygit2 (if available) or git CLI...
  "..\python_embeded\python.exe" -s update.py ".."
  if exist "update_new.py" (
    move /y "update_new.py" "update.py"
    echo Updater was updated — running again...
    "..\python_embeded\python.exe" -s update.py ".." --skip_self_update
  )
) else (
  echo python_embeded not found — trying git CLI + system python...
  where git >nul 2>&1
  if %errorlevel%==0 (
    python update.py ".."
    if exist "update_new.py" (
      move /y "update_new.py" "update.py"
      python update.py ".." --skip_self_update
    )
  ) else (
    echo Neither python_embeded nor git found.
    echo Install git for Windows or copy python_embeded from ComfyUI_windows_portable.
    echo Alternatively: git pull
  )
)
if "%~1"=="" pause
