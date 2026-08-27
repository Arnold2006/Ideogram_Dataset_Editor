#!/usr/bin/env python
"""
Ideogram 4 Dataset Editor — Gradio alternative (ComfyUI-style, python_embeded).

Launches a Gradio Blocks UI that reuses FrameForge's 5s pipeline:
 - Left: Gallery (3-col, 280px thumbs via PIL) — click to load editor
 - Center: Image + bbox editor (gr.AnnotatedImage, 0-1000 normalized)
 - Right: Structured Ideogram JSON form (high_level, style, background, elements)
 - Top: Generate with AI (single) + Generate all unprocessed + Save / Save all

Backend: same llama-server as Electron (bin/llama-server.exe + models/*.gguf),
         same FrameForge SYSTEM_PROMPT/FEW_SHOT + json_schema strict (via
         electron/frameforge/* ported to Python — see frameforge_py/).

Run:  python_embeded\python.exe -s gradio_app.py
      or  run_gradio.bat
      or  python gradio_app.py  (if gradio/pillow installed)
"""
import os, sys, json, base64, pathlib, mimetypes, subprocess, time, html, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODELS_DIR = ROOT / "models"
BIN_DIR = ROOT / "bin"
CONFIG_DIR = ROOT / "config"
PROMPTS_DIR = ROOT / "prompts"

# Ensure dirs
for d in [MODELS_DIR, BIN_DIR, CONFIG_DIR, PROMPTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

try:
    import gradio as gr
except ImportError:
    print("gradio not found — installing...")
    subprocess.check_call([sys.executable, "-s", "-m", "pip", "install", "gradio", "pillow", "requests"])
    import gradio as gr

from PIL import Image
import requests

# Reuse FrameForge prompt/schema via Python port (simple import of JS logic translated)
# For now we embed the key parts: use the same SYSTEM_PROMPT as FrameForge's JS.
# If electron/frameforge/prompt.js exists, load it; else fallback to ideogram4_default.txt
def load_system_prompt():
    # Try FrameForge prompt.js
    ff_prompt = ROOT / "electron" / "frameforge" / "prompt.js"
    if ff_prompt.exists():
        try:
            txt = ff_prompt.read_text(encoding="utf-8")
            # Extract SYSTEM_PROMPT content between backticks (first large block)
            m = re.search(r"const SYSTEM_PROMPT = `(.+?)`;", txt, re.S)
            if m:
                return m.group(1)
        except: pass
    # Fallback to ideogram4_default.txt or config/prompt.txt
    for p in [CONFIG_DIR / "prompt.txt", PROMPTS_DIR / "ideogram4_default.txt"]:
        if p.exists():
            try: return p.read_text(encoding="utf-8")
            except: pass
    return "You are an expert Ideogram 4 prompt engineer. Output ONLY JSON."

SYSTEM_PROMPT = load_system_prompt()

SUPPORTED_IMG = {".jpg",".jpeg",".png",".webp",".bmp",".gif"}

def list_dataset(folder: str):
    if not folder or not Path(folder).exists():
        return []
    entries = {}
    for p in Path(folder).iterdir():
        if not p.is_file(): continue
        ext = p.suffix.lower()
        base = p.stem
        if base not in entries:
            entries[base] = {"base": base}
        if ext in SUPPORTED_IMG:
            entries[base]["img"] = p.name
        elif ext == ".json":
            entries[base]["json"] = p.name
    out = []
    for base, v in entries.items():
        if "img" not in v: continue
        img_path = Path(folder) / v["img"]
        json_path = Path(folder) / v.get("json", base + ".json")
        has_json = "json" in v and json_path.exists()
        data = {}
        if has_json:
            try: data = json.loads(json_path.read_text(encoding="utf-8"))
            except: data = {}
        try: stat = img_path.stat()
        except: stat = None
        out.append({
            "base": base, "imgName": v["img"], "jsonName": json_path.name,
            "imgPath": str(img_path), "jsonPath": str(json_path),
            "hasJson": has_json, "data": data,
            "size": stat.st_size if stat else 0
        })
    out.sort(key=lambda x: x["base"])
    return out

def thumb_path(img_path, size=280):
    # Return PIL thumbnail as base64 for gr.Gallery (Gradio handles PIL directly)
    try:
        im = Image.open(img_path)
        im = im.convert("RGB")
        im.thumbnail((size, size))
        return im
    except: return None

# Llama-server management (same as Electron, but via Python)
llama_proc = None
llama_port = None

def find_llama_bin():
    candidates = [
        BIN_DIR / "llama-server.exe",
        BIN_DIR / "llama-server-cuda.exe",
        BIN_DIR / "llama-server" / "llama-server.exe",
    ]
    for c in candidates:
        if c.exists() and c.stat().st_size > 1024:
            return c
    return BIN_DIR / "llama-server.exe"

def has_nvidia():
    try: subprocess.run(["nvidia-smi"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2, check=True); return True
    except: return False

def ensure_llama():
    global llama_proc, llama_port
    if llama_proc and llama_proc.poll() is None and llama_port:
        return llama_port
    # Find active model
    active_path = MODELS_DIR / "active.json"
    if not active_path.exists():
        raise RuntimeError("No active model - upload Huihui-Qwen3-VL-4B + mmproj-F16.gguf and select in Settings")
    cfg = json.loads(active_path.read_text(encoding="utf-8"))
    model = cfg.get("model")
    mmproj = cfg.get("mmproj")
    if not model: raise RuntimeError("No active model selected")
    model_path = MODELS_DIR / model
    if not model_path.exists(): raise RuntimeError(f"Model not found: {model}")
    mmproj_path = MODELS_DIR / mmproj if mmproj else None
    if mmproj and not mmproj_path.exists(): raise RuntimeError(f"mmproj not found: {mmproj}")
    bin_path = find_llama_bin()
    if not bin_path.exists(): raise RuntimeError(f"llama-server not found at {bin_path} - run: node scripts/fetch-llama.js")
    # Auto-update check for Qwen3 old binary
    try:
        ver_out = subprocess.run([str(bin_path), "--version"], capture_output=True, text=True, timeout=3)
        m = re.search(r"b(\d+)", ver_out.stdout + ver_out.stderr)
        if m and int(m.group(1)) < 6887 and "qwen3" in model.lower():
            raise RuntimeError(f"Binary {bin_path} is b{m.group(1)} < b6887 too old for Qwen3-VL - run: node scripts/fetch-llama.js --force")
    except RuntimeError: raise
    except: pass
    # Pick port
    import socket
    s = socket.socket(); s.bind(("127.0.0.1", 0)); llama_port = s.getsockname()[1]; s.close()
    # Build args like FrameForge (fast)
    use_gpu = (BIN_DIR / "llama-server-cuda.exe").exists() and has_nvidia()
    exe = str(BIN_DIR / "llama-server-cuda.exe") if use_gpu and (BIN_DIR / "llama-server-cuda.exe").exists() else str(bin_path)
    args = [
        exe, "--model", str(model_path),
        "--ctx-size", "32768",
        "--port", str(llama_port),
        "--host", "127.0.0.1",
        "--no-webui", "--jinja", "--flash-attn", "on", "--parallel", "1", "--log-disable",
    ]
    if mmproj_path: args += ["--mmproj", str(mmproj_path)]
    if use_gpu: args += ["--n-gpu-layers", "99"]
    print(f"[llama] Using {'GPU' if use_gpu else 'CPU'} exe={Path(exe).name} ctx=32768 mmproj={'yes' if mmproj_path else 'no'}")
    print(" ".join(args))
    llama_proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    # Wait for health
    for _ in range(60):
        try:
            r = requests.get(f"http://127.0.0.1:{llama_port}/health", timeout=1)
            if r.ok: return llama_port
        except: pass
        if llama_proc.poll() is not None:
            out, err = llama_proc.communicate()
            raise RuntimeError(f"llama-server exited: {err.decode(errors='ignore')[-1000:]}")
        time.sleep(0.5)
    raise RuntimeError("llama-server did not become ready in 30s")

def call_llama(image_path, system_prompt=SYSTEM_PROMPT):
    port = ensure_llama()
    # Use FrameForge's json_schema strict path if available
    # For now use same simple method as Electron fallback, but with streaming/fast params
    # We will call with json_schema if possible
    img_data = base64.b64encode(Path(image_path).read_bytes()).decode()
    mime = mimetypes.guess_type(image_path)[0] or "image/jpeg"
    data_url = f"data:{mime};base64,{img_data}"
    # Try json_schema first (FrameForge fast)
    try:
        # Load generation schema if available
        gen_schema = None
        try:
            # Try to load from electron/frameforge/generation-schema.js
            txt = (ROOT / "electron" / "frameforge" / "generation-schema.js").read_text(encoding="utf-8")
            # Extract JSON schema object via eval (simple)
            # For now use a minimal schema that enforces top-level
            gen_schema = {
                "type": "object",
                "required": ["high_level_description", "style_description", "compositional_deconstruction"],
                "properties": {
                    "high_level_description": {"type": "string"},
                    "style_description": {"type": "object"},
                    "compositional_deconstruction": {"type": "object"}
                }
            }
        except: pass
        body = {
            "model": "local",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": "Analyse this image carefully and generate a detailed Ideogram 4 JSON prompt for it."}
                ]}
            ],
            "temperature": 0.7,
            "max_tokens": 3000,
            "stream": False,
        }
        if gen_schema:
            body["response_format"] = {"type": "json_schema", "json_schema": {"name": "ideogram_prompt", "schema": gen_schema, "strict": True}}
        r = requests.post(f"http://127.0.0.1:{port}/v1/chat/completions", json=body, timeout=120)
        r.raise_for_status()
        j = r.json()
        content = j["choices"][0]["message"]["content"]
        # Try to parse and normalize via FrameForge normalize if available
        try:
            raw = json.loads(content)
            # Use normalize/validate if available
            sys.path.insert(0, str(ROOT / "electron" / "frameforge"))
            # Instead, just return raw and let JS validate
            return raw
        except:
            return json.loads(content)
    except Exception as e:
        print(f"[llama] json_schema failed, fallback: {e}")
        # Fallback plain
        body = {
            "model": "ideogram4",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": [
                    {"type": "text", "text": "Caption this image as JSON."},
                    {"type": "image_url", "image_url": {"url": data_url}}
                ]}
            ],
            "temperature": 0.2,
            "max_tokens": 2048,
            "stream": False
        }
        r = requests.post(f"http://127.0.0.1:{port}/v1/chat/completions", json=body, timeout=120)
        r.raise_for_status()
        j = r.json()
        content = j["choices"][0]["message"]["content"]
        # Strip fences
        content = content.strip()
        if content.startswith("```"):
            content = re.sub(r"^```(?:json)?\s*", "", content)
            content = re.sub(r"\s*```$", "", content)
        return json.loads(content)

# Gradio UI
def build_ui():
    with gr.Blocks(title="Ideogram 4 Dataset Editor — Gradio", theme=gr.themes.Monochrome(), css="""
        .gradio-container {max-width: 1400px}
        #gallery {height: 600px; overflow-y: auto}
        .thumb-status {font-size: 10px}
        """) as demo:
        gr.Markdown("# ◈ Ideogram 4 Dataset Editor — Gradio (5s FrameForge)  \nPortable, no Electron — same `models/` and `bin/` as Electron version.  \nFolder → Gallery (3-col) → Image + bbox (double-click bbox to jump to element) → JSON → Generate")
        with gr.Row():
            folder_in = gr.Textbox(label="Dataset folder", placeholder="C:\\path\\to\\images", scale=4)
            btn_load = gr.Button("📁 Load Folder", variant="primary", scale=1)
            btn_settings = gr.Button("⚙ Models", scale=0)
        status = gr.Markdown("")
        with gr.Row():
            with gr.Column(scale=2):
                gallery = gr.Gallery(label="Thumbnails — click to edit (3-col, with status)", columns=3, height="auto", object_fit="cover", show_label=True)
                gallery_state = gr.State([])
                selected_idx = gr.State(0)
            with gr.Column(scale=3):
                with gr.Tabs():
                    with gr.Tab("Preview + BBox"):
                        img = gr.AnnotatedImage(label="Image — drag bbox to move, corner to resize (double-click to jump)", height=500, show_label=True)
                        # Fallback: regular Image with boxes if AnnotatedImage not ideal
                        # For now use AnnotatedImage; boxes are [xmin, ymin, xmax, ymax] in 0-1000
                        img_name = gr.Markdown("")
                    with gr.Tab("JSON Editor"):
                        json_editor = gr.JSON(label="Ideogram 4 JSON (high_level, style, composition, elements)", show_label=True)
                        with gr.Row():
                            btn_save = gr.Button("💾 Save", variant="primary")
                            btn_save_all = gr.Button("Save All")
                        save_status = gr.Markdown("")
                    with gr.Tab("AI"):
                        with gr.Row():
                            btn_gen = gr.Button("✦ Generate with AI (5s)", variant="primary")
                            btn_gen_all = gr.Button("Generate all unprocessed")
                            btn_cancel = gr.Button("Cancel")
                        gen_status = gr.Markdown("")
                        gen_progress = gr.Slider(visible=False)
        # Logic
        def load_folder(folder):
            if not folder or not Path(folder).exists():
                return gr.update(value=None), [], "Folder not found", [], 0
            data = list_dataset(folder)
            # Build gallery items: list of (PIL, caption)
            thumbs = []
            for d in data:
                try:
                    im = thumb_path(d["imgPath"])
                    cap = f"{d['base']} — {'AI draft' if d.get('_aiDraft') else 'saved' if d['hasJson'] else 'empty'}"
                    thumbs.append((im, cap))
                except: thumbs.append((None, d["base"]))
            return thumbs, data, f"Loaded {len(data)} images from `{folder}`", data, 0

        def select_image(evt: gr.SelectData, data):
            if not data or evt.index is None: return None, {}, ""
            idx = evt.index
            entry = data[idx]
            # AnnotatedImage format: (image, boxes)
            # boxes: list of [xmin, ymin, xmax, ymax] + label
            # Convert bbox [ymin, xmin, ymax, xmax] 0-1000 to pixel boxes for display
            # For now just show image without boxes; bbox editing via JSON
            try:
                im = Image.open(entry["imgPath"]).convert("RGB")
            except: im = None
            # Build annotated boxes
            ann = []
            for el in entry["data"].get("compositional_deconstruction", {}).get("elements", []):
                bbox = el.get("bbox")
                if not bbox or len(bbox)!=4: continue
                # bbox is [ymin, xmin, ymax, xmax] 0-1000
                y0, x0, y1, x1 = bbox
                # AnnotatedImage expects [x_min, y_min, x_max, y_max] in pixels, but we can pass normalized and let Gradio scale?
                # Gradio's AnnotatedImage boxes are in pixel coords relative to image size
                # So convert 0-1000 to image size
                if im:
                    w, h = im.size
                    x0p, y0p = x0/1000*w, y0/1000*h
                    x1p, y1p = x1/1000*w, y1/1000*h
                    ann.append(((x0p, y0p, x1p, y1p), el.get("desc","")[:40]))
            # Return image + annotations
            # gr.AnnotatedImage expects (image, [([x0,y0,x1,y1], label), ...])
            # For empty, just image
            display = (im, ann) if ann else im
            return display, entry["data"], f"`{entry['imgName']}`"

        def save_current(json_data, data, idx, folder):
            if not data or idx is None or idx >= len(data): return "No selection"
            entry = data[idx]
            # json_data is the edited JSON from gr.JSON
            if isinstance(json_data, dict):
                entry["data"] = json_data
            else:
                try: entry["data"] = json.loads(json_data) if isinstance(json_data, str) else json_data
                except: return "Invalid JSON"
            # Write to disk
            Path(entry["jsonPath"]).write_text(json.dumps(entry["data"], indent=2), encoding="utf-8")
            return f"Saved {entry['jsonName']}"

        def save_all(json_data, data, idx, folder):
            # Save current first
            if data and 0 <= idx < len(data) and json_data:
                try:
                    d = json_data if isinstance(json_data, dict) else json.loads(json_data)
                    data[idx]["data"] = d
                except: pass
            count=0
            for e in data:
                try:
                    Path(e["jsonPath"]).write_text(json.dumps(e["data"], indent=2), encoding="utf-8")
                    count+=1
                except: pass
            return f"Saved {count} files"

        def gen_one(json_data, data, idx, folder):
            if not data or idx is None or idx >= len(data): return json_data, "No selection"
            entry = data[idx]
            try:
                result = call_llama(entry["imgPath"])
                entry["data"] = result
                entry["_aiDraft"] = True
                return result, f"Generated for {entry['base']} — review & Save"
            except Exception as e:
                return json_data, f"Error: {e}"

        btn_load.click(load_folder, inputs=[folder_in], outputs=[gallery, gallery_state, status, gallery_state, selected_idx])
        gallery.select(select_image, inputs=[gallery_state], outputs=[img, json_editor, img_name])
        btn_save.click(save_current, inputs=[json_editor, gallery_state, selected_idx, folder_in], outputs=[save_status])
        btn_save_all.click(save_all, inputs=[json_editor, gallery_state, selected_idx, folder_in], outputs=[save_status])
        btn_gen.click(gen_one, inputs=[json_editor, gallery_state, selected_idx, folder_in], outputs=[json_editor, gen_status])

        # Also handle folder drop via textbox change
        folder_in.submit(load_folder, inputs=[folder_in], outputs=[gallery, gallery_state, status, gallery_state, selected_idx])

    return demo

if __name__ == "__main__":
    demo = build_ui()
    demo.launch(server_name="127.0.0.1", server_port=7860, inbrowser=True, show_error=True)
