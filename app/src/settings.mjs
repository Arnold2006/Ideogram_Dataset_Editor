import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_PROMPT as DEF_SYSTEM, MINIMAX_SYSTEM_PROMPT as DEF_MINIMAX } from "./prompt.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");
const CONFIG_DIR = path.join(appDir, "config");
const CONFIG_FILE = path.join(CONFIG_DIR, "settings.json");

// Defaults — never mutated, used as fallback if user borks prompts
export const DEFAULT_PROMPTS = {
  systemPrompt: DEF_SYSTEM,
  plainSystemPrompt: `You are an expert prompt engineer for text-to-image AI models.
When given a description or reference image, write a single rich plain-text prompt optimised for models like Flux, SDXL, or similar diffusion models.

Rules:
- Output ONLY the prompt text itself — no preamble, no explanation, no quotes, no markdown
- Be highly descriptive: subject, style, lighting, mood, color palette, camera/lens feel, era
- Use natural flowing prose mixed with comma-separated descriptive phrases
- Aim for 60-120 words
- Do not mention Ideogram, JSON, or any schema`,
  minimaxSystemPrompt: DEF_MINIMAX,
};

export const DEFAULT_SETTINGS = {
  // model overrides (null = auto-discover like before)
  modelPath: null,
  mmprojPath: null,
  contextSize: 32768,
  // prompts — null means use default via fallback
  prompts: { ...DEFAULT_PROMPTS },
};

function ensureConfigDir() {
  try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); } catch {}
}

function sanitizePrompt(value, fallback) {
  if (typeof value !== "string") return fallback;
  const t = value.trim();
  if (t.length < 10) return fallback; // too short = user messed up
  return value;
}

export function loadSettings() {
  let raw = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {}
  const out = {
    modelPath: typeof raw.modelPath === "string" && raw.modelPath.trim() ? raw.modelPath.trim() : null,
    mmprojPath: typeof raw.mmprojPath === "string" && raw.mmprojPath.trim() ? raw.mmprojPath.trim() : null,
    contextSize: Number.isFinite(raw.contextSize) && raw.contextSize > 0 ? Math.floor(raw.contextSize) : DEFAULT_SETTINGS.contextSize,
    prompts: {
      systemPrompt: sanitizePrompt(raw.prompts?.systemPrompt, DEFAULT_PROMPTS.systemPrompt),
      plainSystemPrompt: sanitizePrompt(raw.prompts?.plainSystemPrompt, DEFAULT_PROMPTS.plainSystemPrompt),
      minimaxSystemPrompt: sanitizePrompt(raw.prompts?.minimaxSystemPrompt, DEFAULT_PROMPTS.minimaxSystemPrompt),
    },
  };
  // if file had bad prompts, persist corrected file so user sees fallback on next load (non-destructive)
  // but don't overwrite if file missing — only if prompts were invalid
  const needsFix =
    raw.prompts?.systemPrompt !== out.prompts.systemPrompt ||
    raw.prompts?.plainSystemPrompt !== out.prompts.plainSystemPrompt ||
    raw.prompts?.minimaxSystemPrompt !== out.prompts.minimaxSystemPrompt;
  if (needsFix && fs.existsSync(CONFIG_FILE)) {
    try { saveSettings(out); } catch {}
  }
  return out;
}

export function saveSettings(partial) {
  ensureConfigDir();
  const cur = loadSettings();
  const next = {
    modelPath: partial.modelPath !== undefined ? (typeof partial.modelPath === "string" && partial.modelPath.trim() ? partial.modelPath.trim() : null) : cur.modelPath,
    mmprojPath: partial.mmprojPath !== undefined ? (typeof partial.mmprojPath === "string" && partial.mmprojPath.trim() ? partial.mmprojPath.trim() : null) : cur.mmprojPath,
    contextSize: partial.contextSize !== undefined ? (Number.isFinite(partial.contextSize) && partial.contextSize > 0 ? Math.floor(partial.contextSize) : cur.contextSize) : cur.contextSize,
    prompts: {
      systemPrompt: partial.prompts?.systemPrompt !== undefined ? sanitizePrompt(partial.prompts.systemPrompt, DEFAULT_PROMPTS.systemPrompt) : cur.prompts.systemPrompt,
      plainSystemPrompt: partial.prompts?.plainSystemPrompt !== undefined ? sanitizePrompt(partial.prompts.plainSystemPrompt, DEFAULT_PROMPTS.plainSystemPrompt) : cur.prompts.plainSystemPrompt,
      minimaxSystemPrompt: partial.prompts?.minimaxSystemPrompt !== undefined ? sanitizePrompt(partial.prompts.minimaxSystemPrompt, DEFAULT_PROMPTS.minimaxSystemPrompt) : cur.prompts.minimaxSystemPrompt,
    },
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function resetPrompts() {
  ensureConfigDir();
  const cur = loadSettings();
  cur.prompts = { ...DEFAULT_PROMPTS };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cur, null, 2), "utf8");
  return cur;
}

// Helper: get effective prompt with guaranteed fallback (used by server at generation time)
export function getEffectivePrompt(settings, key) {
  const val = settings?.prompts?.[key];
  return sanitizePrompt(val, DEFAULT_PROMPTS[key]);
}

// For UI: list discoverable models
export function listModels() {
  const modelsDir = path.join(appDir, "models");
  if (!fs.existsSync(modelsDir)) return [];
  const files = fs.readdirSync(modelsDir);
  return files.filter(f => f.toLowerCase().endsWith(".gguf")).map(f => ({ name: f, path: path.join(modelsDir, f), isMmproj: f.toLowerCase().startsWith("mmproj") })).sort((a,b)=> a.name.localeCompare(b.name));
}

export function getDefaults() {
  return { prompts: { ...DEFAULT_PROMPTS }, settings: { ...DEFAULT_SETTINGS } };
}
