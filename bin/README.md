# bin/

Place llama.cpp binaries here before packaging:

- `llama-server.exe` (CPU AVX2, from https://github.com/ggml-org/llama.cpp/releases)
- `llama-server-cuda.exe` + `cublas`/`cudart` DLLs (optional CUDA build)
- `MicrosoftEdgeWebview2Setup.exe` (bootstrapper, https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

Build will warn if `llama-server.exe` is missing but still produce a UI-only portable (AI Generate will show a setup error until binaries are added).
