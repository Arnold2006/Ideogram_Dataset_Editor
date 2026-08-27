#!/usr/bin/env node
// Ideogram 4 Dataset Editor — Node server (FrameForge engine + Ideogram UI)
// Serves the Ideogram UI (dist/ or src) and provides the same 5s generation pipeline
// as FrameForge/app/server.mjs, but with the Ideogram Dataset Editor's two-pane UI.

// This file is the new entry point when NOT using Electron.
// It replaces electron/main.js for the "Gradio-like" Node version the user asked for.
// UI remains exactly like the Ideogram prototype: left = 3-col thumbnail grid, right = JSON editor + bbox canvas.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// FrameForge engine — prompt/schema/normalize/validate from app/src/
let SYSTEM_PROMPT, FEW_SHOT, GENERATION_SCHEMA, normalizeCaption, validateCaption;
try {
  const promptMod = await import("./app/src/prompt.mjs");
  SYSTEM_PROMPT = promptMod.SYSTEM_PROMPT;
  FEW_SHOT = promptMod.FEW_SHOT;
  const genMod = await import("./app/src/generation-schema.mjs");
  GENERATION_SCHEMA = genMod.GENERATION_SCHEMA;
  const normMod = await import("./app/src/normalize.mjs");
  normalizeCaption = normMod.normalizeCaption;
  const valMod = await import("./app/src/validate.mjs");
  validateCaption = valMod.validateCaption;
} catch (e) {
  console.error("Failed to load FrameForge prompt/schema from app/src:", e.message);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 7860; // Gradio-like default, also used by run_gradio.bat
const HOST = "127.0.0.1";
const LLAMA_PORT = Number(process.env.LLAMA_PORT) || 8124;
const CONTEXT_SIZE = 32768;
const MAX_ATTEMPTS = 2;

const SUPPORTED_IMG = new Set([".jpg",".jpeg",".png",".webp",".bmp",".gif"]);
const ROOT = __dirname;
const MODELS_DIR = process.env.MODELS_DIR ? path.resolve(process.env.MODELS_DIR) : path.join(ROOT, "models");
const BIN_DIR = process.env.BIN_DIR ? path.resolve(process.env.BIN_DIR) : path.join(ROOT, "bin");

// --- helpers ---
function resolveModels() {
  if (!fs.existsSync(MODELS_DIR)) {
    console.warn(`No models/ directory at ${MODELS_DIR} — put Huihui-Qwen3-VL-4B + mmproj-F16.gguf there. UI will still load.`);
    return { modelFile: null, mmprojFile: null };
  }
  const files = fs.readdirSync(MODELS_DIR);
  const modelFile = process.env.MODEL_PATH ? path.resolve(process.env.MODEL_PATH) : (() => {
    const f = files.filter(f => f.toLowerCase().endsWith(".gguf") && !f.toLowerCase().startsWith("mmproj")).sort()[0];
    if (!f) { console.warn("No model .gguf in models/ — UI will load but generation will fail until you add one."); return null; }
    return path.join(MODELS_DIR, f);
  })();
  const mmprojFile = process.env.MMPROJ_PATH ? path.resolve(process.env.MMPROJ_PATH) : (() => {
    const f = files.filter(f => f.toLowerCase().startsWith("mmproj") && f.toLowerCase().endsWith(".gguf")).sort()[0];
    return f ? path.join(MODELS_DIR, f) : null;
  })();
  return { modelFile, mmprojFile };
}
function resolveLlamaServer() {
  const candidates = [
    path.join(BIN_DIR, "llama-server.exe"),
    path.join(BIN_DIR, "llama-server"),
    path.join(ROOT, "app", "bin", "llama-server.exe"),
    path.join(ROOT, "bin", "llama-server.exe"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  console.warn("llama-server not found in bin/ or app/bin/. Run: node scripts/fetch-llama.js — UI will still load.");
  return null;
}
function hasNvidia() {
  try { require("child_process").execSync("nvidia-smi", {stdio:"ignore", timeout:2000}); return true; } catch { return false; }
}
let llamaProc = null;
async function startLlamaServer(serverBin, modelFile, mmprojFile) {
  const useGpu = fs.existsSync(path.join(BIN_DIR, "llama-server-cuda.exe")) && hasNvidia();
  const exe = useGpu && fs.existsSync(path.join(BIN_DIR, "llama-server-cuda.exe")) ? path.join(BIN_DIR, "llama-server-cuda.exe") : serverBin;
  const args = [
    "--model", modelFile,
    "--ctx-size", String(CONTEXT_SIZE),
    "--port", String(LLAMA_PORT),
    "--host", "127.0.0.1",
    "--no-webui", "--jinja", "--flash-attn", "on", "--parallel", "1", "--log-disable",
  ];
  if (mmprojFile) args.push("--mmproj", mmprojFile);
  if (useGpu) args.push("--n-gpu-layers", "99");
  console.log(`[llama] Using ${useGpu ? "GPU" : "CPU"} exe=${path.basename(exe)} ctx=${CONTEXT_SIZE}`);
  console.log(args.join(" "));
  const proc = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.on("data", d => process.stdout.write(d));
  proc.stderr.on("data", d => process.stderr.write(d));
  proc.on("exit", code => { if (code !== 0 && code !== null) { console.error(`llama-server exited ${code}`); process.exit(1); } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("llama-server timeout 120s")), 120000);
    const check = async () => {
      try { const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/health`); if (r.ok) { clearTimeout(t); resolve(); return; } } catch {}
      setTimeout(check, 500);
    };
    proc.on("error", e => { clearTimeout(t); reject(e); });
    check();
  });
  process.on("exit", () => { try { proc.kill(); } catch {} });
  llamaProc = proc;
  return proc;
}

// --- FrameForge generation (5s) ---
function buildMessages(description, imageBase64, lastErrors, aspectRatio="1:1") {
  const [arW, arH] = aspectRatio.split(":").map(Number);
  const gridW = arW >= arH ? 1000 : Math.round(1000 * arW / arH);
  const gridH = arH >= arW ? 1000 : Math.round(1000 * arH / arW);
  const arNote = `\n\nTarget aspect ratio: ${aspectRatio} (bbox grid is ${gridW}x${gridH}, x in [0,${gridW}], y in [0,${gridH}]).`;
  const styleNote = `\n\nYou MUST always include the "style_description" object. Choose either photograph (aesthetics, lighting, photo, medium="photograph", color_palette) or art (aesthetics, lighting, medium, art_style, color_palette).`;
  const sysPrompt = SYSTEM_PROMPT + styleNote + arNote;
  const messages = [{ role: "system", content: sysPrompt }];
  for (const [u, r] of FEW_SHOT) {
    messages.push({ role: "user", content: u });
    messages.push({ role: "assistant", content: r });
  }
  const errorSuffix = lastErrors.length ? "\n\n(Your previous answer had these problems, fix them: " + lastErrors.join("; ") + ")" : "";
  let userContent;
  if (imageBase64) {
    const b64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
    userContent = [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
      { type: "text", text: (description ? `Analyse this image and use it as the subject. Additional context: ${description}` : "Analyse this image carefully and generate a detailed Ideogram 4 JSON prompt for it.") + errorSuffix }
    ];
  } else {
    userContent = (description || "Generate an Ideogram 4 JSON prompt.") + errorSuffix;
  }
  messages.push({ role: "user", content: userContent });
  return messages;
}
async function callLlamaServer(messages, temperature, onChunk) {
  const res = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "local", messages, temperature, max_tokens: 3000, stream: true,
      response_format: { type: "json_schema", json_schema: { name: "ideogram_prompt", schema: GENERATION_SCHEMA, strict: true } }
    })
  });
  if (!res.ok) throw new Error(`llama-server ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer="", fullText="";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      try {
        const evt = JSON.parse(data);
        const chunk = evt.choices?.[0]?.delta?.content ?? "";
        if (chunk) { fullText += chunk; onChunk(chunk); }
      } catch {}
    }
  }
  return fullText;
}
async function generateCaption(description, imageBase64, emit, aspectRatio="1:1") {
  let lastErrors=[];
  for (let attempt=1; attempt<=MAX_ATTEMPTS; attempt++) {
    if (attempt>1) emit({type:"retry", attempt, errors:lastErrors});
    const messages = buildMessages(description, imageBase64, lastErrors, aspectRatio);
    let text;
    try {
      text = await callLlamaServer(messages, attempt===1?0.7:0.3, c=> emit({type:"chunk", text:c}));
    } catch(e){ emit({type:"error", message:String(e.message||e)}); return; }
    let raw; try{ raw=JSON.parse(text); }catch{ lastErrors=["output was not parseable JSON"]; continue; }
    const norm = normalizeCaption(raw);
    if(!norm.ok){ lastErrors=[norm.reason]; continue; }
    const {valid, errors} = validateCaption(norm.value);
    if(!valid){ lastErrors=errors; continue; }
    emit({type:"done", mode:"ideogram", prompt:norm.value, valid:true, attempts:attempt});
    return;
  }
  emit({type:"error", message:`Could not produce a valid caption after ${MAX_ATTEMPTS} attempts.`, errors:lastErrors});
}

// --- dataset helpers (same as Electron, but via HTTP) ---
function listDataset(folder) {
  const entries = {};
  for (const e of fs.readdirSync(folder, {withFileTypes:true})) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    const base = e.name.slice(0, e.name.length - path.extname(e.name).length);
    if (!entries[base]) entries[base] = {base};
    if (SUPPORTED_IMG.has(ext)) entries[base].img = e.name;
    if (ext === ".json") entries[base].json = e.name;
  }
  const out=[];
  for (const v of Object.values(entries)) {
    if (!v.img) continue;
    const imgPath = path.join(folder, v.img);
    const jsonPath = path.join(folder, v.json || v.base + ".json");
    let data={}, hasJson=false;
    if (v.json) { try{ data=JSON.parse(fs.readFileSync(jsonPath,"utf8")); hasJson=true; }catch{ data={}; hasJson=true; } }
    let stat=null; try{ stat=fs.statSync(imgPath); }catch{}
    out.push({base:v.base, imgName:v.img, jsonName:path.basename(jsonPath), imgPath, jsonPath, hasJson, data, size:stat?stat.size:0});
  }
  out.sort((a,b)=>a.base.localeCompare(b.base));
  return out;
}
async function getThumbnail(imagePath, size=280) {
  try {
    const sharp = (await import("sharp")).default;
    const buf = await sharp(imagePath).rotate().resize(size, size, {fit:"inside", withoutEnlargement:true}).jpeg({quality:70}).toBuffer();
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    try {
      const buf = fs.readFileSync(imagePath);
      const mime = imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch { return ""; }
  }
}

// --- HTTP server (serves Ideogram UI like FrameForge serves its public/) ---
const { modelFile, mmprojFile } = (() => {
  try { return resolveModels(); } catch(e) { console.warn(e.message); return {modelFile:null, mmprojFile:null}; }
})();
let serverBin;
try { serverBin = resolveLlamaServer(); } catch(e) { console.warn(e.message); }

if (modelFile && serverBin) {
  await startLlamaServer(serverBin, modelFile, mmprojFile);
  console.log("llama-server ready — FrameForge engine active (5s)");
} else {
  console.warn("No model/bin found — start will fail until you put models/*.gguf and run scripts/fetch-llama.js");
}

const DIST_DIR = path.join(ROOT, "dist");
const SRC_DIR = path.join(ROOT, "src");
const PUBLIC_DIR = DIST_DIR; // vite build outputs to dist/

function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".svg":"image/svg+xml",".woff2":"font/woff2"};
  const ct = map[ext] || "application/octet-stream";
  try {
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {"Content-Type": ct, "Cache-Control":"no-cache"});
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}
function readBody(req){
  return new Promise((resolve,reject)=>{
    let b=""; req.on("data",c=>{b+=c; if(b.length>50_000_000) reject(new Error("body too large"));}); req.on("end",()=>resolve(b)); req.on("error",reject);
  });
}
function sendJson(res, code, obj){
  res.writeHead(code, {"Content-Type":"application/json"}); res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req,res)=>{
  // CORS for Vite dev (5173 -> 7860)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if(req.method==="OPTIONS"){ res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  // --- API: dataset ---
  if(req.method==="POST" && url.pathname==="/api/list-dataset"){
    try{
      const body=JSON.parse(await readBody(req));
      const list = listDataset(body.folder);
      sendJson(res,200,list);
    }catch(e){ sendJson(res,400,{error:e.message}); }
    return;
  }
  if(req.method==="POST" && url.pathname==="/api/get-thumbnail"){
    try{
      const body=JSON.parse(await readBody(req));
      const thumb = await getThumbnail(body.imagePath, body.size||280);
      sendJson(res,200,{dataUrl:thumb});
    }catch(e){ sendJson(res,400,{error:e.message}); }
    return;
  }
  if(req.method==="POST" && url.pathname==="/api/get-image-data"){
    try{
      const body=JSON.parse(await readBody(req));
      const buf=fs.readFileSync(body.imagePath);
      const mime = body.imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      sendJson(res,200,{dataUrl:`data:${mime};base64,${buf.toString("base64")}`, width:0, height:0});
    }catch(e){ sendJson(res,400,{error:e.message}); }
    return;
  }
  if(req.method==="POST" && url.pathname==="/api/write-json"){
    try{
      const body=JSON.parse(await readBody(req));
      fs.writeFileSync(body.jsonPath, typeof body.data==="string" ? body.data : JSON.stringify(body.data,null,2), "utf8");
      sendJson(res,200,{ok:true});
    }catch(e){ sendJson(res,400,{error:e.message}); }
    return;
  }
  if(req.method==="GET" && url.pathname==="/api/health"){
    // Proxy to llama health
    try{
      const r=await fetch(`http://127.0.0.1:${LLAMA_PORT}/health`);
      const j=await r.json().catch(()=>({}));
      sendJson(res,200,{status:j.status||"ok", llamaPort: LLAMA_PORT});
    }catch{ sendJson(res,503,{status:"starting"}); }
    return;
  }
  if(req.method==="GET" && url.pathname==="/api/models"){
    try{
      const files=fs.readdirSync(MODELS_DIR);
      const models=files.filter(f=>f.toLowerCase().endsWith(".gguf")).map(f=>{
        try{ const st=fs.statSync(path.join(MODELS_DIR,f)); return {name:f, size:st.size}; }catch{ return {name:f}; }
      });
      let active=null; try{ active=JSON.parse(fs.readFileSync(path.join(MODELS_DIR,"active.json"),"utf8")); }catch{}
      sendJson(res,200,{models, active});
    }catch(e){ sendJson(res,500,{error:e.message}); }
    return;
  }
  // --- API: generate (FrameForge 5s) ---
  if(req.method==="POST" && url.pathname==="/api/generate"){
    let body;
    try{ body=JSON.parse(await readBody(req)); }catch{ sendJson(res,400,{error:"invalid JSON"}); return; }
    const { imagePath, folder, base, aspectRatio="1:1" } = body;
    let imgPath = imagePath;
    if(!imgPath && folder && base){
      const list = listDataset(folder);
      const hit = list.find(x=>x.base===base);
      if(hit) imgPath=hit.imgPath;
    }
    if(!imgPath || !fs.existsSync(imgPath)){ sendJson(res,400,{error:"image not found"}); return; }
    const buf=fs.readFileSync(imgPath);
    const b64=`data:image/jpeg;base64,${buf.toString("base64")}`;
    res.writeHead(200, {"Content-Type":"application/x-ndjson","Cache-Control":"no-cache","X-Accel-Buffering":"no"});
    const emit = e=> res.write(JSON.stringify(e)+"\n");
    try{
      await generateCaption("", b64, emit, aspectRatio);
    }catch(e){ emit({type:"error", message:String(e.message)}); }
    res.end();
    return;
  }
  // --- Static: serve Ideogram UI (dist/ if built, else src/index.html) ---
  let filePath;
  if(url.pathname==="/" || url.pathname==="/index.html"){
    filePath = fs.existsSync(path.join(DIST_DIR,"index.html")) ? path.join(DIST_DIR,"index.html") : path.join(ROOT,"index.html");
  } else {
    // Try dist first, then src, then root
    const tryPaths=[
      path.join(DIST_DIR, url.pathname.slice(1)),
      path.join(ROOT, url.pathname.slice(1)),
      path.join(SRC_DIR, url.pathname.slice(1)),
    ];
    filePath = tryPaths.find(p=>fs.existsSync(p) && fs.statSync(p).isFile());
  }
  if(filePath) { serveStatic(req,res,filePath); return; }
  res.writeHead(404, {"Content-Type":"text/html"});
  res.end(`<h1>Ideogram Dataset Editor (FrameForge engine)</h1><p>UI: <a href="/">/</a> — API: <a href="/api/health">/api/health</a></p><p>Run <code>npm run build</code> to build dist/ for production.</p>`);
});

server.listen(PORT, HOST, ()=>{
  console.log(`Ideogram Dataset Editor (FrameForge engine) at http://${HOST}:${PORT}`);
  console.log(`UI: Ideogram two-pane (grid + JSON + bbox) — Engine: FrameForge 5s (ctx 32768, flash-attn, GPU 99)`);
  // Try to open browser
  const cmd = process.platform==="win32" ? "start" : process.platform==="darwin" ? "open" : "xdg-open";
  try{ require("child_process").exec(`${cmd} http://${HOST}:${PORT}`); }catch{}
});
