@echo off
REM Ideogram 4 Dataset Editor — Gradio alternative (ComfyUI-style, python_embeded)
REM Fast 5s FrameForge pipeline, same models/ and bin/ as Electron version.
REM No Electron — pure Python + Gradio, launched via python_embeded or system python.
setlocal
pushd "%~dp0"

REM Prefer python_embeded (like ComfyUI), fallback to system python
set PY=python
if exist "python_embeded\python.exe" set PY=python_embeded\python.exe

echo Checking Gradio dependencies...
%PY% -s -c "import gradio" >nul 2>&1
if errorlevel 1 (
  echo Installing Gradio + Pillow + requests...
  %PY% -s -m pip install --upgrade gradio pillow requests
  if errorlevel 1 (
    echo pip install failed - trying with --user
    %PY% -s -m pip install --user gradio pillow requests
  )
)

REM Ensure llama-server binary exists (auto-download like Electron)
if not exist "bin\llama-server.exe" (
  echo llama-server not found - downloading...
  where node >nul 2>&1
  if not errorlevel 1 (
    node scripts\fetch-llama.js
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\fetch-llama.ps1"
  )
)

echo Starting Gradio on http://127.0.0.1:7860 ...
REM Use -s to avoid site-packages interference (like ComfyUI)
%PY% -s gradio_app.py
if errorlevel 1 (
  echo Gradio failed - trying system python without -s
  python gradio_app.py
)
popd
pause
