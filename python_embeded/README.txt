python_embeded placeholder — optional for full portable.

This app is Electron-based; python_embeded is NOT required to run the editor
(out\win-unpacked\Ideogram4Editor.exe runs with no system dependencies).

python_embeded IS used for:
  - update\update.py via pygit2 (like ComfyUI_windows_portable) when git CLI is absent
  - app\launch.py browser fallback when Electron is not available

To add it (optional):
  1) Copy python_embeded\ from ComfyUI_windows_portable, or
  2) Download python-3.11.x-embed-amd64.zip from python.org, unzip to python_embeded\,
     uncomment `import site` in python311._pth, and run:
       python_embeded\python.exe get-pip.py
       python_embeded\python.exe -m pip install pygit2

The portable will work without this folder — update.bat will fall back to `git` CLI.
