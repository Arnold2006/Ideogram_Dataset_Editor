# Ideogram 4 Dataset Editor — Portable Windows App

Local, offline Ideogram-4-style prompt editor with 3-col thumbnail grid and embedded `llama.cpp` vision captioning.

## Portable usage (no install, no admin)
1. Unzip `Ideogram4Editor-*-portable-win-x64.zip` anywhere (USB stick works).
2. Put your vision model into `models/`:
   - `Huihui-Qwen3-VL-4B-Instruct-abliterated-Q4_K_M.gguf`
   - `mmproj-F16.gguf` (vision projector — required for this split-file model)
3. Run `Ideogram4Editor.exe` (in the unpacked folder). On first run with no WebView2, run `bin/MicrosoftEdgeWebview2Setup.exe` once if prompted.
4. Open Folder → pick a folder with images (`jpg/jpeg/png/webp/bmp/gif`). Thumbnails appear in the 3-col grid.
5. Click a thumbnail → edit the right pane (Overview / Style / Composition / Elements + bbox canvas). Arrow keys navigate (auto-saves current before leaving), `Ctrl+S` saves, `Ctrl+B` toggles full-width bbox edit.
6. AI: Settings (⚙) → select active model + mmproj → **Generate with AI** (single) or **Generate all unprocessed** (batch). Drafts are in-memory — **Save** to write `.json` next to each image. Missing `.json` files are created in-memory only until you Save.

## JSON schema
Same as the HTML prototype: `high_level_description`, `style_description` (`aesthetics`, `lighting`, `medium`, `photo` XOR `art_style`, `color_palette`), `compositional_deconstruction` (`background`, `elements[]` with `type` `obj`|`text`, `desc`, `text?`, `bbox` `[ymin,xmin,ymax,xmax]` 0..1000, `color_palette?`).

## Development
```bash
npm install
npm run electron:dev   # Vite + Electron with hot reload
npm run build          # Vite only
npm run dist           # unpacked portable dir in out/
npm run dist:zip       # plus .zip in out/
```

## Models & inference
- Bundled `llama-server.exe` (+ optional `llama-server-cuda.exe`) in `bin/` — downloaded separately (see `bin/README.md`). The app auto-selects CUDA if `nvidia-smi` succeeds.
- System prompt is editable in Settings; `config/prompt.txt` overrides `prompts/ideogram4_default.txt`. Empty/invalid prompt falls back to default.

## WebView2
Windows 10 1903+ includes WebView2. If missing, run `bin/MicrosoftEdgeWebview2Setup.exe`.

## Distribution
Preferred: plain `.zip` folder (primary artifact) + `git pull` (clone + `npm ci` + `npm run electron:dev`). No installer, no self-extracting exe.

## Attribution
Grid, thumb generation, and Electron shell follow the pattern in `Arnold2006/ImageForge` (MIT) — 3-col grid, `sharp` thumbnails at 280 px, `dialog.showOpenDialog`.
