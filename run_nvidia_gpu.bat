@echo off
REM Ideogram4 Dataset Editor — NVIDIA GPU mode
REM Uses llama-server-cuda.exe if present + nvidia-smi succeeds; else falls back to CPU.
REM Kept for ComfyUI_windows_portable parity — no extra flags needed, the app auto-selects.
call "%~dp0run.bat"
echo If ComfyUI did not start try updating your Nvidia drivers. For c10.dll errors install vc_redist: https://aka.ms/vc14/vc_redist.x64.exe
