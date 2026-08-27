# bin/

Place llama.cpp binaries here before packaging — or let the app download them automatically:

- `llama-server.exe` (CPU AVX2, from https://github.com/ggerganov/llama.cpp/releases)
- `llama-server-cuda.exe` + `cublas`/`cudart` DLLs (optional CUDA build)
- `MicrosoftEdgeWebview2Setup.exe` (bootstrapper, https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

Auto-download:
- On first `Test model` / `Generate` the app will auto-download the latest `llama.cpp` CPU (+ CUDA) zip via GitHub API and extract `llama-server.exe` into `bin/` — no manual step needed if you have internet.
- You can also run manually: `node scripts/fetch-llama.js` or `powershell -File scripts/fetch-llama.ps1`
- `run.bat` also auto-downloads `bin\llama-server.exe` before launching if missing.

For fully offline/portable builds, pre-populate `bin\` before `npm run dist` and the binaries are included in the portable zip.
