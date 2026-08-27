@echo off
REM Ideogram4 Dataset Editor - update, rebuild, and start (kept for ComfyUI parity)
REM Now just delegates to update.bat which already rebuilds and starts.
call "%~dp0update.bat" %*
