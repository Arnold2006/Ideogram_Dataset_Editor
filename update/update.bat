@echo off
REM Ideogram4 Dataset Editor - update (ComfyUI style)
REM Uses python_embeded/pygit2 if present, else plain git CLI.
setlocal
pushd "%~dp0"
if exist "..\python_embeded\python.exe" goto :pyembed
goto :trygit

:pyembed
echo Updating via python_embeded + pygit2 (if available) or git CLI...
"..\python_embeded\python.exe" -s update.py ".."
if exist "update_new.py" goto :pynew
goto :done

:pynew
move /y "update_new.py" "update.py" >nul
echo Updater was updated - running again...
"..\python_embeded\python.exe" -s update.py ".." --skip_self_update
goto :done

:trygit
echo python_embeded not found - trying git CLI + system python...
where git >nul 2>&1
if errorlevel 1 goto :nogit
python update.py ".."
if exist "update_new.py" goto :gitnew
goto :done

:gitnew
move /y "update_new.py" "update.py" >nul
python update.py ".." --skip_self_update
goto :done

:nogit
echo Neither python_embeded nor git found.
echo Install git for Windows or copy python_embeded from ComfyUI_windows_portable.
echo Alternatively: git pull
goto :done

:done
popd
if "%~1"=="" pause
exit /b
