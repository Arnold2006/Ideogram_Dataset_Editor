HOW TO RUN:

Double-click one of:

  run.bat                — standard (auto-selects CPU or NVIDIA GPU)
  run_cpu.bat            — force CPU mode (same exe, kept for ComfyUI parity)
  run_nvidia_gpu.bat     — NVIDIA GPU mode (uses bin\llama-server-cuda.exe if present)

No system Node.js/Python required after the portable is built.
On first run, if WebView2 is missing, run bin\MicrosoftEdgeWebview2Setup.exe once.

MODELS:
Put your vision model into models\:

  Huihui-Qwen3-VL-4B-Instruct-abliterated-Q4_K_M.gguf
  mmproj-F16.gguf

Select the active pair in the app: Settings (gear icon) -> Upload/Select -> Active model.

DATASET:
Open Folder -> pick a folder with images (jpg/jpeg/png/webp/bmp/gif).
Thumbnails appear in the left 3-col grid. Click a thumb to edit on the right.
Arrow keys navigate (auto-saves current before leaving), Ctrl+S saves, Ctrl+B toggles full-width bbox edit.
AI drafts are in-memory until you Save — missing .json are NOT created on disk until Save/Generate->Save.

RECOMMENDED WAY TO UPDATE:

  update\update.bat                          — git pull (pygit2 or plain git) + npm install
  update\update_and_rebuild.bat              — pull + npm install + npm run dist
  update\update_and_python_dependencies.bat  — pull + reinstall python_embeded deps (rare; only if deps broken)

TO SHARE MODELS BETWEEN MACHINES:
Copy the models\ folder or point the app at a shared drive. The app never auto-downloads models.

BUILD FROM SOURCE (once):
  npm install
  npm run dist         — builds out\win-unpacked\Ideogram4Editor.exe
  npm run dist:zip     — also makes out\Ideogram4Editor-*-portable-win-x64.zip
Then use run.bat or zip the portable folder for USB.
