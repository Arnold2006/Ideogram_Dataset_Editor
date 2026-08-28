// Ideogram4 Dataset Editor — portable dataset editor
// Spawns llama-server (app/bin/) as subprocess with --mmproj for vision, then proxies OpenAI-compatible API.
// UI is a dataset editor: 3-column image grid on left, prompt editor on right. No chat.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeCaption, serializeCaption } from "./src/normalize.mjs";
import { validateCaption } from "./src/validate.mjs";
import { SYSTEM_PROMPT as FALLBACK_SYSTEM, FEW_SHOT, MINIMAX_SYSTEM_PROMPT as FALLBACK_MINIMAX } from "./src/prompt.mjs";
import { GENERATION_SCHEMA } from "./src/generation-schema.mjs";
import { IDEOGRAM_SCHEMA } from "./src/ideogram-schema.mjs";
import { loadSettings, saveSettings, resetPrompts, listModels, getEffectivePrompt, DEFAULT_PROMPTS } from "./src/settings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// PLAIN fallback is stored in settings defaults; keep local copy for import fallback
const PLAIN_FALLBACK = DEFAULT_PROMPTS.plainSystemPrompt;

const PORT = Number(process.env.PORT) || 8123;
const HOST = "127.0.0.1";
const LLAMA_PORT = Number(process.env.LLAMA_PORT) || 8124;
// CONTEXT_SIZE now comes from settings (env still overrides)
function getContextSize() {
  try { return loadSettings().contextSize || 32768; } catch { return 32768; }
}
const CONTEXT_SIZE = Number(process.env.CONTEXT_SIZE) || getContextSize();
const MAX_ATTEMPTS = 2;

// ── model / mmproj discovery (settings → env → auto) ───────────────────────
function resolveModels() {
  const modelsDir = path.join(__dirname, "models");
  if (!fs.existsSync(modelsDir)) {
    return { modelFile: null, mmprojFile: null, modelsDir };
  }
  const files = fs.readdirSync(modelsDir);
  let s = null; try { s = loadSettings(); } catch {}
  const modelFile = s?.modelPath
    ? path.resolve(s.modelPath)
    : process.env.MODEL_PATH
    ? path.resolve(process.env.MODEL_PATH)
    : (() => {
        const f = files
          .filter(f => f.toLowerCase().endsWith(".gguf") && !f.toLowerCase().startsWith("mmproj"))
          .sort()[0];
        return f ? path.join(modelsDir, f) : null;
      })();
  const mmprojFile = s?.mmprojPath
    ? path.resolve(s.mmprojPath)
    : process.env.MMPROJ_PATH
    ? path.resolve(process.env.MMPROJ_PATH)
    : (() => {
        const f = files
          .filter(f => f.toLowerCase().startsWith("mmproj") && f.toLowerCase().endsWith(".gguf"))
          .sort()[0];
        return f ? path.join(modelsDir, f) : null;
      })();
  return { modelFile, mmprojFile, modelsDir };
}

function resolveLlamaServer() {
  const candidates = [
    path.join(__dirname, "bin", "llama-server.exe"),
    path.join(__dirname, "bin", "llama-server"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

async function startLlamaServer(serverBin, modelFile, mmprojFile) {
  const args = [
    "--model", modelFile,
    "--ctx-size", String(CONTEXT_SIZE),
    "--port", String(LLAMA_PORT),
    "--host", "127.0.0.1",
    "--no-webui",
    "--jinja",
    "--flash-attn", "on",
    "--n-gpu-layers", "99",
    "--parallel", "1",
    "--log-disable",
  ];
  if (mmprojFile) {
    args.push("--mmproj", mmprojFile);
    console.log(`Vision enabled: ${path.basename(mmprojFile)}`);
  } else {
    console.warn("No mmproj file found in models/ — image input will not work.");
  }
  console.log(`Starting llama-server on port ${LLAMA_PORT}…`);
  const proc = spawn(serverBin, args, { stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.on("data", d => process.stdout.write(d));
  proc.stderr.on("data", d => process.stderr.write(d));
  proc.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`llama-server exited with code ${code}`);
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("llama-server startup timeout after 120s")), 120_000);
    const check = async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${LLAMA_PORT}/health`);
        if (r.ok) { clearTimeout(timeout); resolve(); return; }
      } catch {}
      setTimeout(check, 500);
    };
    proc.on("error", (err) => { clearTimeout(timeout); reject(err); });
    check();
  });
  process.on("exit", () => { try { proc.kill(); } catch {} });
  return proc;
}

// ── build messages (with fallback prompts) ─────────────────────────────────
function buildMessages(description, imageBase64, lastErrors, steering = "", aspectRatio = "1:1") {
  const [arW, arH] = aspectRatio.split(":").map(Number);
  const gridW = arW >= arH ? 1000 : Math.round(1000 * arW / arH);
  const gridH = arH >= arW ? 1000 : Math.round(1000 * arH / arW);
  const arNote = `\n\nTarget aspect ratio: ${aspectRatio} (bbox grid is ${gridW}\u00d7${gridH}, x in [0,${gridW}], y in [0,${gridH}]). Place and size all bboxes to suit this canvas shape.`;
  const styleNote = `\n\nYou MUST always include the "style_description" object in your output. It is required, never optional. Choose either the photograph variant (with fields: aesthetics, lighting, photo, medium="photograph", color_palette) or the art variant (with fields: aesthetics, lighting, medium, art_style, color_palette). Always populate all fields with rich, specific values. Never omit style_description.`;
  let basePrompt = FALLBACK_SYSTEM;
  try { const s = loadSettings(); basePrompt = getEffectivePrompt(s, "systemPrompt"); } catch {}
  const sysPrompt = (steering ? basePrompt + "\n\nAdditional style guidance:\n" + steering : basePrompt) + styleNote + arNote;
  const messages = [{ role: "system", content: sysPrompt }];
  for (const [user, response] of FEW_SHOT) {
    messages.push({ role: "user", content: user });
    messages.push({ role: "assistant", content: response });
  }
  const errorSuffix = lastErrors.length > 0
    ? "\n\n(Your previous answer had these problems, fix them: " + lastErrors.join("; ") + ")"
    : "";
  let userContent;
  if (imageBase64) {
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, "");
    userContent = [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
      { type: "text", text: (description ? `Analyse this image and use it as the subject. Additional context from user: ${description}` : "Analyse this image carefully and generate a detailed Ideogram 4 JSON prompt for it.") + errorSuffix }
    ];
  } else {
    userContent = description + errorSuffix;
  }
  messages.push({ role: "user", content: userContent });
  return messages;
}

function buildPlainMessages(description, imageBase64, aspectRatio = "1:1", steering = "") {
  const arNote = `\n\nTarget image aspect ratio: ${aspectRatio}. Keep composition descriptions appropriate for this shape.`;
  let basePlain = PLAIN_FALLBACK;
  try { const s = loadSettings(); basePlain = getEffectivePrompt(s, "plainSystemPrompt"); } catch {}
  const sysPrompt = (steering ? basePlain + "\n\nAdditional style guidance:\n" + steering : basePlain) + arNote;
  const messages = [{ role: "system", content: sysPrompt }];
  let userContent;
  if (imageBase64) {
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, "");
    userContent = [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
      { type: "text", text: description ? `Analyse this image and write a prompt for it. Extra context: ${description}` : "Analyse this image and write a detailed text-to-image prompt for it." }
    ];
  } else {
    userContent = `Write a text-to-image prompt for: ${description}`;
  }
  messages.push({ role: "user", content: userContent });
  return messages;
}

function buildMiniMaxMessages(description, imageBase64, steering = "") {
  let baseMini = FALLBACK_MINIMAX;
  try { const s = loadSettings(); baseMini = getEffectivePrompt(s, "minimaxSystemPrompt"); } catch {}
  const sysPrompt = steering ? baseMini + "\n\nAdditional style guidance:\n" + steering : baseMini;
  const messages = [{ role: "system", content: sysPrompt }];
  let userContent;
  if (imageBase64) {
    const base64Data = imageBase64.replace(/^data:[^;]+;base64,/, "");
    userContent = [
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
      { type: "text", text: description ? `Generate a MiniMax H3 ComfyUI prompt for this scene. Extra context: ${description}` : "Generate a MiniMax H3 ComfyUI prompt for the scene shown in this image." }
    ];
  } else {
    userContent = description;
  }
  messages.push({ role: "user", content: userContent });
  return messages;
}

async function generateMiniMax(description, imageBase64, emit, steering = "") {
  const started = Date.now();
  const messages = buildMiniMaxMessages(description, imageBase64, steering);
  let text;
  try {
    text = await callLlamaServerPlain(messages, (chunk) => emit({ type: "chunk", text: chunk }));
  } catch (err) {
    emit({ type: "error", message: String(err?.message || err) });
    return;
  }
  if (!text || text.trim().length === 0) {
    emit({ type: "error", message: "MiniMax generation produced empty output." });
    return;
  }
  emit({ type: "done", mode: "minimax", text: text.trim(), duration_ms: Date.now() - started });
}

async function callLlamaServer(messages, temperature, onChunk) {
  const res = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "local",
      messages,
      temperature,
      max_tokens: 3000,
      stream: true,
      response_format: { type: "json_schema", json_schema: { name: "ideogram_prompt", schema: GENERATION_SCHEMA, strict: true } }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`llama-server error ${res.status}: ${err}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", fullText = "";
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

async function callLlamaServerPlain(messages, onChunk) {
  const res = await fetch(`http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", messages, temperature: 0.8, max_tokens: 512, stream: true })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`llama-server error ${res.status}: ${err}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", fullText = "";
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
  return fullText.trim();
}

async function generatePlain(description, imageBase64, emit, aspectRatio = "1:1", steering = "") {
  const started = Date.now();
  const messages = buildPlainMessages(description, imageBase64, aspectRatio, steering);
  let text;
  try {
    text = await callLlamaServerPlain(messages, (chunk) => emit({ type: "chunk", text: chunk }));
  } catch (err) {
    emit({ type: "error", message: String(err?.message || err) });
    return;
  }
  emit({ type: "done", mode: "plain", text, duration_ms: Date.now() - started });
}

async function generateCaption(description, imageBase64, emit, aspectRatio = "1:1", steering = "") {
  let lastErrors = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) emit({ type: "retry", attempt, errors: lastErrors });
    const messages = buildMessages(description, imageBase64, lastErrors, steering, aspectRatio);
    const started = Date.now();
    let text;
    try {
      text = await callLlamaServer(messages, attempt === 1 ? 0.7 : 0.3, (chunk) => emit({ type: "chunk", text: chunk }));
    } catch (err) {
      emit({ type: "error", message: String(err?.message || err) });
      return;
    }
    let raw;
    try { raw = JSON.parse(text); }
    catch { lastErrors = ["output was not parseable JSON"]; continue; }
    const normalized = normalizeCaption(raw);
    if (!normalized.ok) { lastErrors = [normalized.reason]; continue; }
    const { valid, errors } = validateCaption(normalized.value);
    if (!valid) { lastErrors = errors; continue; }
    emit({ type: "done", mode: "ideogram", prompt: normalized.value, prompt_compact: serializeCaption(normalized.value), valid: true, attempts: attempt, duration_ms: Date.now() - started });
    return;
  }
  emit({ type: "error", message: `Could not produce a valid caption after ${MAX_ATTEMPTS} attempts.`, errors: lastErrors });
}

// ── batch folder captioning ──────────────────────────────────────────────────
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
const IMAGE_MIME_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".bmp": "image/bmp", ".gif": "image/gif" };

function generateForFile(reqMode, imageBase64, aspectRatio, steering, forwardEmit) {
  return new Promise((resolve) => {
    let resultEvent = null;
    const emit = (event) => { forwardEmit(event); if (event.type === "done" || event.type === "error") resultEvent = event; };
    const job = reqMode === "plain" ? generatePlain("", imageBase64, emit, aspectRatio, steering) : reqMode === "minimax" ? generateMiniMax("", imageBase64, emit, steering) : generateCaption("", imageBase64, emit, aspectRatio, steering);
    job.then(() => resolve(resultEvent ?? { type: "error", message: "no result produced" }));
  });
}

async function generateFolder(folderPath, reqMode, aspectRatio, steering, emit) {
  let entries;
  try { entries = fs.readdirSync(folderPath, { withFileTypes: true }); }
  catch (err) { emit({ type: "error", message: `Could not read folder: ${err.message}` }); return; }
  const files = entries.filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase())).map((e) => e.name).sort();
  if (files.length === 0) { emit({ type: "error", message: "No supported image files found in folder." }); return; }
  let succeeded = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    emit({ type: "file-start", file, index: i + 1, total: files.length });
    const ext = path.extname(file).toLowerCase();
    const base = file.slice(0, -ext.length);
    const filePath = path.join(folderPath, file);
    let imageBase64;
    try {
      const buf = fs.readFileSync(filePath);
      imageBase64 = `data:${IMAGE_MIME_TYPES[ext] || "image/jpeg"};base64,${buf.toString("base64")}`;
    } catch (err) {
      failed++; emit({ type: "file-error", file, message: `Could not read file: ${err.message}` }); continue;
    }
    const forwardEmit = (event) => emit({ ...event, file });
    const result = await generateForFile(reqMode, imageBase64, aspectRatio, steering, forwardEmit);
    if (result.type === "error") { failed++; emit({ type: "file-error", file, message: result.message }); continue; }
    const isTextMode = result.mode === "plain" || result.mode === "minimax";
    const content = isTextMode ? result.text : JSON.stringify(result.prompt, null, 2);
    const outName = base + (isTextMode ? ".txt" : ".json");
    const outPath = path.join(folderPath, outName);
    try { fs.writeFileSync(outPath, content, "utf8"); }
    catch (err) { failed++; emit({ type: "file-error", file, message: `Could not write caption: ${err.message}` }); continue; }
    succeeded++; emit({ type: "file-done", file, outFile: outName, duration_ms: result.duration_ms });
  }
  emit({ type: "batch-done", total: files.length, succeeded, failed });
}

// ── dataset helpers ──────────────────────────────────────────────────────────
function listFolderImages(folderPath) {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map(e => e.name).sort();
  return files.map(file => {
    const ext = path.extname(file).toLowerCase();
    const base = file.slice(0, -ext.length);
    const full = path.join(folderPath, file);
    let stat = null; try { stat = fs.statSync(full); } catch {}
    const jsonPath = path.join(folderPath, base + ".json");
    const txtPath = path.join(folderPath, base + ".txt");
    let captionFile = null, captionMode = null;
    if (fs.existsSync(jsonPath)) { captionFile = base + ".json"; captionMode = "ideogram"; }
    else if (fs.existsSync(txtPath)) { captionFile = base + ".txt"; captionMode = "txt"; }
    return { file, size: stat ? stat.size : 0, captionFile, captionMode };
  });
}

function findCaptionForImage(imagePath) {
  const ext = path.extname(imagePath);
  const base = imagePath.slice(0, -ext.length);
  const jsonPath = base + ".json";
  const txtPath = base + ".txt";
  if (fs.existsSync(jsonPath)) return { path: jsonPath, mode: "ideogram", name: path.basename(jsonPath) };
  if (fs.existsSync(txtPath)) return { path: txtPath, mode: "plain", name: path.basename(txtPath) };
  return null;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ""; req.on("data", (chunk) => { body += chunk; if (body.length > 20_000_000) reject(new Error("body too large")); });
    req.on("end", () => resolve(body)); req.on("error", reject);
  });
}
function readRaw(req, limit = 8_000_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      chunks.push(c);
      total += c.length;
      if (total > limit) reject(new Error("upload too large"));
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function sendJson(res, status, value) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); }
let queue = Promise.resolve();
function enqueue(job) { const run = queue.then(job, job); queue = run.catch(() => {}); return run; }

// ── startup ───────────────────────────────────────────────────────────────────
let { modelFile, mmprojFile } = resolveModels();
let serverBin = resolveLlamaServer();
if (modelFile) console.log(`Model:  ${path.basename(modelFile)}`); else console.log("Model: (none) — generation will be unavailable until models are placed in app/models/");
if (serverBin) console.log(`Binary: ${serverBin}`); else console.log("Binary: (none) — generation unavailable; dataset editing still works. Run app/scripts/download-llama.mjs to fetch llama-server.");

let llamaProc = null;
if (serverBin && modelFile) {
  try { llamaProc = await startLlamaServer(serverBin, modelFile, mmprojFile); console.log("llama-server ready."); }
  catch (e) { console.error("Failed to start llama-server:", e.message, "— continuing without generation."); }
} else {
  console.log("Skipping llama-server startup (missing binary or model). UI will still run for dataset editing.");
}

async function ensureLlamaBinary() {
  if (resolveLlamaServer()) return true;
  const dl = path.join(__dirname, "scripts", "download-llama.mjs");
  if (!fs.existsSync(dl)) return false;
  console.log("llama-server missing — auto-downloading via scripts/download-llama.mjs …");
  try {
    const proc = spawn(process.execPath, [dl], { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout?.on("data", d => process.stdout.write(d));
    proc.stderr?.on("data", d => process.stderr.write(d));
    const code = await new Promise((resolve) => { proc.on("close", resolve); proc.on("error", () => resolve(1)); });
    if (code !== 0) { console.error("download-llama.mjs failed with code", code); return false; }
    return !!resolveLlamaServer();
  } catch (e) {
    console.error("ensureLlamaBinary failed:", e);
    return false;
  }
}

async function restartLlamaServer() {
  const next = resolveModels();
  modelFile = next.modelFile;
  mmprojFile = next.mmprojFile;
  serverBin = resolveLlamaServer();
  if (!serverBin) {
    const ok = await ensureLlamaBinary();
    if (ok) {
      serverBin = resolveLlamaServer();
      console.log("llama-server binary downloaded:", serverBin);
    } else {
      return { ok: false, error: "llama-server binary not found in app/bin — auto-download failed, run app/scripts/download-llama.mjs manually" };
    }
  }
  if (llamaProc) {
    try { llamaProc.kill(); } catch {}
    await new Promise(r => setTimeout(r, 1500));
    llamaProc = null;
  }
  if (!serverBin) return { ok: false, error: "llama-server binary not found in app/bin — run app/scripts/download-llama.mjs" };
  if (!modelFile) return { ok: false, error: "no model .gguf found in app/models — upload a model first" };
  try {
    llamaProc = await startLlamaServer(serverBin, modelFile, mmprojFile);
    console.log("llama-server restarted.");
    return { ok: true, model: path.basename(modelFile), mmproj: mmprojFile ? path.basename(mmprojFile) : null, vision: !!mmprojFile };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS for portable usage (file:// etc - though we serve from same origin)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(__dirname, "public", "index.html")).pipe(res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    if (llamaProc) {
      try {
        const h = await fetch(`http://127.0.0.1:${LLAMA_PORT}/health`);
        const hj = await h.json();
        sendJson(res, 200, { status: hj.status ?? "ok", model: modelFile ? path.basename(modelFile) : null, mmproj: mmprojFile ? path.basename(mmprojFile) : null, vision: !!mmprojFile, generation: true });
        return;
      } catch {}
    }
    sendJson(res, 200, { status: llamaProc ? "starting" : "no-model", model: modelFile ? path.basename(modelFile) : null, mmproj: mmprojFile ? path.basename(mmprojFile) : null, vision: !!mmprojFile, generation: !!llamaProc });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/schema") {
    sendJson(res, 200, IDEOGRAM_SCHEMA); return;
  }

  // ── settings APIs ──────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/settings") {
    try {
      const s = loadSettings();
      const models = listModels();
      sendJson(res, 200, { settings: s, models, defaults: DEFAULT_PROMPTS });
    } catch (err) { sendJson(res, 500, { error: String(err.message) }); }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/settings") {
    try {
      const body = JSON.parse(await readBody(req));
      const saved = saveSettings(body);
      const models = listModels();
      sendJson(res, 200, { ok: true, settings: saved, models });
    } catch (err) { sendJson(res, 400, { error: String(err.message) }); }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/settings/reset") {
    let key = null;
    try {
      const raw = await readBody(req);
      if (raw.trim()) key = JSON.parse(raw).key || null;
    } catch {}
    try {
      let saved;
      if (key && DEFAULT_PROMPTS[key] !== undefined) {
        const cur = loadSettings();
        cur.prompts[key] = DEFAULT_PROMPTS[key];
        saved = saveSettings(cur);
      } else {
        saved = resetPrompts();
      }
      sendJson(res, 200, { ok: true, settings: saved, defaults: DEFAULT_PROMPTS });
    } catch (err) { sendJson(res, 500, { error: String(err.message) }); }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/llama/restart") {
    const r = await restartLlamaServer();
    if (r.ok) sendJson(res, 200, { ok: true, ...r });
    else sendJson(res, 500, { ok: false, ...r });
    return;
  }

  // ── models upload / download (save to app/models) ───────────────────
  if (req.method === "POST" && url.pathname === "/api/models/upload") {
    const rawFilename = req.headers["x-filename"] || "model.gguf";
    const filename = path.basename(String(rawFilename).trim());
    if (!filename.toLowerCase().endsWith(".gguf")) { sendJson(res, 400, { error: "filename must end with .gguf" }); return; }
    if (filename.includes("..")) { sendJson(res, 400, { error: "invalid filename" }); return; }
    const modelsDir = path.join(__dirname, "models");
    try { fs.mkdirSync(modelsDir, { recursive: true }); } catch {}
    const dest = path.join(modelsDir, filename);
    try {
      // Stream to file to handle >2GB models (avoid Buffer limit)
      const out = fs.createWriteStream(dest);
      let received = 0;
      await new Promise((resolve, reject) => {
        req.on("data", (chunk) => { received += chunk.length; });
        req.pipe(out);
        out.on("finish", resolve);
        out.on("error", reject);
        req.on("error", reject);
      });
      if (received === 0) { try { fs.unlinkSync(dest); } catch {} sendJson(res, 400, { error: "empty file" }); return; }
      // auto restart / start llama-server with new model
      const restart = await restartLlamaServer();
      sendJson(res, 200, { ok: true, filename, size: received, path: dest, restart });
    } catch (err) {
      try { fs.unlinkSync(dest); } catch {}
      sendJson(res, 500, { error: String(err.message) });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/models/download") {
    let body; try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: "invalid JSON" }); return; }
    const urlStr = typeof body.url === "string" ? body.url.trim() : "";
    if (!urlStr || !/^https?:\/\//i.test(urlStr)) { sendJson(res, 400, { error: "provide valid http(s) url to .gguf" }); return; }
    let filename = typeof body.filename === "string" && body.filename.trim() ? path.basename(body.filename.trim()) : path.basename(new URL(urlStr).pathname) || "model.gguf";
    if (!filename.toLowerCase().endsWith(".gguf")) filename += ".gguf";
    if (filename.includes("..")) filename = "model.gguf";
    const modelsDir = path.join(__dirname, "models");
    try { fs.mkdirSync(modelsDir, { recursive: true }); } catch {}
    const dest = path.join(modelsDir, filename);
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" });
    const emit = (ev) => res.write(JSON.stringify(ev) + "\n");
    try {
      emit({ type: "progress", message: "Downloading " + filename + " ..." });
      const r = await fetch(urlStr);
      if (!r.ok) throw new Error(`fetch ${r.status} ${r.statusText}`);
      const total = Number(r.headers.get("content-length") || 0);
      const reader = r.body.getReader();
      const out = fs.createWriteStream(dest);
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        out.write(value);
        if (total) {
          const pct = ((received / total) * 100).toFixed(1);
          emit({ type: "progress", message: `Downloading ${filename}: ${(received/1024/1024).toFixed(1)} / ${(total/1024/1024).toFixed(1)} MB (${pct}%)` });
        } else {
          emit({ type: "progress", message: `Downloading ${filename}: ${(received/1024/1024).toFixed(1)} MB` });
        }
      }
      out.end();
      await new Promise((res2, rej) => { out.on("finish", res2); out.on("error", rej); });
      emit({ type: "done", filename, size: received, path: dest });
      emit({ type: "progress", message: "Restarting llama-server with new model..." });
      const rr = await restartLlamaServer();
      if (rr.ok) emit({ type: "restart", ok: true, model: rr.model, mmproj: rr.mmproj });
      else emit({ type: "restart", ok: false, error: rr.error });
    } catch (err) {
      try { fs.unlinkSync(dest); } catch {}
      emit({ type: "error", message: String(err.message) });
    }
    res.end();
    return;
  }

  // ── dataset APIs ───────────────────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/api/list") {
    let folderPath;
    try { const body = JSON.parse(await readBody(req)); folderPath = typeof body.folderPath === "string" ? body.folderPath.trim() : ""; }
    catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
    if (!folderPath) { sendJson(res, 400, { error: "provide 'folderPath'" }); return; }
    const resolved = path.resolve(folderPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) { sendJson(res, 400, { error: "folderPath is not an existing directory" }); return; }
    try {
      const images = listFolderImages(resolved);
      sendJson(res, 200, { folder: resolved, count: images.length, images });
    } catch (err) { sendJson(res, 500, { error: String(err.message) }); }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/image") {
    const p = url.searchParams.get("path");
    if (!p) { sendJson(res, 400, { error: "provide ?path=" }); return; }
    const resolved = path.resolve(p);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) { sendJson(res, 404, { error: "file not found" }); return; }
    if (!IMAGE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) { sendJson(res, 400, { error: "not an image" }); return; }
    const ext = path.extname(resolved).toLowerCase();
    const mime = IMAGE_MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
    fs.createReadStream(resolved).pipe(res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/caption") {
    const p = url.searchParams.get("path");
    if (!p) { sendJson(res, 400, { error: "provide ?path=" }); return; }
    const resolved = path.resolve(p);
    // p is image path; resolve sibling caption
    const cap = findCaptionForImage(resolved);
    if (!cap) { sendJson(res, 200, { exists: false, content: null, mode: null }); return; }
    try {
      const content = fs.readFileSync(cap.path, "utf8");
      sendJson(res, 200, { exists: true, content, mode: cap.mode, file: cap.name, captionPath: cap.path });
    } catch (err) { sendJson(res, 500, { error: String(err.message) }); }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/save-caption") {
    let imagePath, content, mode;
    try {
      const body = JSON.parse(await readBody(req));
      imagePath = typeof body.imagePath === "string" ? body.imagePath.trim() : "";
      content = typeof body.content === "string" ? body.content : "";
      mode = body.mode;
    } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
    if (!imagePath) { sendJson(res, 400, { error: "provide 'imagePath'" }); return; }
    const resolvedImg = path.resolve(imagePath);
    if (!fs.existsSync(resolvedImg)) { sendJson(res, 404, { error: "image file not found" }); return; }
    const ext = path.extname(resolvedImg);
    const base = resolvedImg.slice(0, -ext.length);
    // Decide output file: if mode is ideogram validate JSON else txt
    let outPath, finalContent = content;
    if (mode === "ideogram") {
      outPath = base + ".json";
      // Validate before saving if possible
      try {
        const parsed = JSON.parse(content);
        const normalized = normalizeCaption(parsed);
        if (!normalized.ok) { sendJson(res, 400, { error: "normalize failed: " + normalized.reason }); return; }
        const { valid, errors } = validateCaption(normalized.value);
        if (!valid) { sendJson(res, 400, { error: "validation failed", errors }); return; }
        finalContent = JSON.stringify(normalized.value, null, 2);
      } catch (e) {
        sendJson(res, 400, { error: "invalid JSON: " + e.message }); return;
      }
    } else {
      // plain/minimax or auto: save as .txt, remove .json if exists
      outPath = base + ".txt";
      // if a .json exists and we're saving txt, keep both? We overwrite txt only.
    }
    try {
      fs.writeFileSync(outPath, finalContent, "utf8");
      sendJson(res, 200, { ok: true, outFile: path.basename(outPath), outPath });
    } catch (err) { sendJson(res, 500, { error: String(err.message) }); }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/delete-caption") {
    let imagePath;
    try { const body = JSON.parse(await readBody(req)); imagePath = typeof body.imagePath === "string" ? body.imagePath.trim() : ""; }
    catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
    if (!imagePath) { sendJson(res, 400, { error: "provide 'imagePath'" }); return; }
    const resolvedImg = path.resolve(imagePath);
    const cap = findCaptionForImage(resolvedImg);
    if (!cap) { sendJson(res, 404, { error: "no caption to delete" }); return; }
    try { fs.unlinkSync(cap.path); sendJson(res, 200, { ok: true }); }
    catch (err) { sendJson(res, 500, { error: String(err.message) }); }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/generate") {
    if (!llamaProc) { sendJson(res, 503, { error: "generation unavailable — model or llama-server not loaded" }); return; }
    let description, imageBase64 = null, reqMode = "ideogram", aspectRatio = "1:1", steering = "";
    try {
      const body = JSON.parse(await readBody(req));
      description = typeof body.description === "string" ? body.description.trim() : "";
      if (typeof body.image === "string" && body.image.length > 0) imageBase64 = body.image;
      if (body.mode === "plain") reqMode = "plain";
      if (body.mode === "minimax") reqMode = "minimax";
      if (typeof body.aspectRatio === "string") aspectRatio = body.aspectRatio;
      if (typeof body.steering === "string") steering = body.steering.trim();
    } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
    if (!description && !imageBase64) { sendJson(res, 400, { error: "provide 'description', 'image' (base64), or both" }); return; }
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
    const emit = (event) => res.write(JSON.stringify(event) + "\n");
    try {
      const useSteering = steering || description;
      const useDesc = steering ? "" : description;
      if (reqMode === "plain") await enqueue(() => generatePlain(useDesc || description, imageBase64, emit, aspectRatio, steering));
      else if (reqMode === "minimax") await enqueue(() => generateMiniMax(useDesc || description, imageBase64, emit, steering));
      else await enqueue(() => generateCaption(useDesc || description, imageBase64, emit, aspectRatio, steering));
    } catch (err) { emit({ type: "error", message: String(err?.message || err) }); }
    res.end(); return;
  }

  if (req.method === "POST" && url.pathname === "/api/generate-folder") {
    if (!llamaProc) { sendJson(res, 503, { error: "generation unavailable — model or llama-server not loaded" }); return; }
    let folderPath, reqMode = "ideogram", aspectRatio = "1:1", steering = "";
    try {
      const body = JSON.parse(await readBody(req));
      folderPath = typeof body.folderPath === "string" ? body.folderPath.trim() : "";
      if (body.mode === "plain") reqMode = "plain";
      if (body.mode === "minimax") reqMode = "minimax";
      if (typeof body.aspectRatio === "string") aspectRatio = body.aspectRatio;
      if (typeof body.steering === "string") steering = body.steering.trim();
    } catch { sendJson(res, 400, { error: "invalid JSON body" }); return; }
    if (!folderPath) { sendJson(res, 400, { error: "provide 'folderPath'" }); return; }
    const resolvedPath = path.resolve(folderPath);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) { sendJson(res, 400, { error: "folderPath is not an existing directory" }); return; }
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
    const emit = (event) => res.write(JSON.stringify(event) + "\n");
    try { await enqueue(() => generateFolder(resolvedPath, reqMode, aspectRatio, steering, emit)); }
    catch (err) { emit({ type: "error", message: String(err?.message || err) }); }
    res.end(); return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Ideogram4 Dataset Editor running at http://${HOST}:${PORT}`);
  // Try to open browser on Windows portable launch (non-blocking)
  if (process.env.FF_AUTO_OPEN !== "0") {
    // Don't auto-open when running under Pinokio or tests
  }
});
