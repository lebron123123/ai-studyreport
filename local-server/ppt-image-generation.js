import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKFLOW_DIR = path.join(HERE, "comfy-workflows");
const GEMINI_MODELS = Object.freeze({
  fast: "gemini-3.1-flash-lite-image",
  standard: "gemini-3.1-flash-image",
  premium: "gemini-3-pro-image",
});
const ALLOWED_RATIOS = new Set(["1:1", "4:3", "3:2", "16:9", "21:9", "9:16"]);
const ALLOWED_SIZES = new Set(["512", "1K", "2K", "4K"]);
const COMFY_DIMENSIONS = Object.freeze({
  "1:1": [1024, 1024],
  "4:3": [1024, 768],
  "3:2": [1152, 768],
  "16:9": [1344, 768],
  "21:9": [1536, 640],
  "9:16": [768, 1344],
});

const enabled = value => /^(1|true|yes|on)$/i.test(String(value || ""));
const cleanBase = value => String(value || "").trim().replace(/\/+$/, "");
const safePrompt = value => {
  const prompt = String(value || "").replace(/\u0000/g, "").trim();
  if (!prompt) throw new Error("生图提示词不能为空");
  if (prompt.length > 4000) throw new Error("生图提示词不能超过4000字");
  return prompt;
};
const ratioOf = value => ALLOWED_RATIOS.has(value) ? value : "16:9";
const sizeOf = value => ALLOWED_SIZES.has(value) ? value : "1K";

function authHeaders(env) {
  const key = String(env.COMFYUI_API_KEY || "").trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function fetchJson(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      const message = data.error?.message || data.error || data.message || data.raw || `HTTP ${response.status}`;
      throw new Error(String(message).slice(0, 500));
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("图片服务请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function findImagePayload(value) {
  if (!value || typeof value !== "object") return null;
  if (value.output_image?.data) return { data: value.output_image.data, mimeType: value.output_image.mime_type || "image/png" };
  if (value.inlineData?.data) return { data: value.inlineData.data, mimeType: value.inlineData.mimeType || value.inlineData.mime_type || "image/png" };
  if (value.inline_data?.data) return { data: value.inline_data.data, mimeType: value.inline_data.mime_type || "image/png" };
  if ((value.type === "image" || value.mime_type?.startsWith?.("image/")) && value.data) {
    return { data: value.data, mimeType: value.mime_type || value.mimeType || "image/png" };
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = Array.isArray(child)
        ? child.map(findImagePayload).find(Boolean)
        : findImagePayload(child);
      if (found) return found;
    }
  }
  return null;
}

export function imageProviderStatus(env = process.env) {
  const nanoProvider = String(env.NANO_BANANA_PROVIDER || "google").toLowerCase();
  const nanoConfigured = enabled(env.NANO_BANANA_ENABLED) && Boolean(nanoProvider === "apiyi" ? (env.APIYI_API_KEY || env.GEMINI_API_KEY) : env.GEMINI_API_KEY);
  const comfyConfigured = enabled(env.COMFYUI_ENABLED) && Boolean(cleanBase(env.COMFYUI_BASE_URL));
  return {
    providers: [
      {
        id: "nano-banana",
        name: "Nano Banana",
        available: nanoConfigured,
        local: false,
        model: nanoProvider === "apiyi"
          ? (env.APIYI_NANO_BANANA_MODEL || "gemini-3.1-flash-image-preview")
          : (env.NANO_BANANA_MODEL || GEMINI_MODELS[env.NANO_BANANA_MODE] || GEMINI_MODELS.standard),
        reason: nanoConfigured ? "已配置" : "需设置NANO_BANANA_ENABLED=true和GEMINI_API_KEY",
      },
      {
        id: "comfyui",
        name: "ComfyUI / Stable Diffusion",
        available: comfyConfigured,
        local: true,
        model: env.COMFYUI_CHECKPOINT || "未指定Checkpoint",
        reason: comfyConfigured ? "已配置" : "需设置COMFYUI_ENABLED=true和COMFYUI_BASE_URL",
      },
    ],
  };
}

export async function generateNanoBanana(request, env = process.env, fetchImpl = fetch) {
  if (!enabled(env.NANO_BANANA_ENABLED)) throw new Error("Nano Banana尚未启用");
  const provider = String(env.NANO_BANANA_PROVIDER || "google").trim().toLowerCase();
  const apiKey = String(provider === "apiyi" ? (env.APIYI_API_KEY || env.GEMINI_API_KEY || "") : (env.GEMINI_API_KEY || "")).trim();
  if (!apiKey) throw new Error(provider === "apiyi" ? "服务器尚未配置APIYI_API_KEY或GEMINI_API_KEY" : "服务器尚未配置GEMINI_API_KEY");
  const prompt = safePrompt(request.prompt);
  const mode = ["fast", "standard", "premium"].includes(request.mode) ? request.mode : (env.NANO_BANANA_MODE || "standard");
  const model = env.NANO_BANANA_MODEL || GEMINI_MODELS[mode] || GEMINI_MODELS.standard;
  const aspectRatio = ratioOf(request.aspectRatio);
  const imageSize = sizeOf(request.imageSize || env.NANO_BANANA_IMAGE_SIZE);
  if (provider === "apiyi") {
    const endpoint = String(env.NANO_BANANA_API_URL || "https://api.apiyi.com/v1/chat/completions").trim();
    const apiYiModel = env.APIYI_NANO_BANANA_MODEL || env.NANO_BANANA_MODEL || "gemini-3.1-flash-image-preview";
    const apiYiPrompt = `生成一张${aspectRatio}比例、${imageSize}分辨率的图片。${prompt}`;
    const data = await fetchJson(fetchImpl, endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: apiYiModel,
        stream: false,
        messages: [{ role: "user", content: [{ type: "text", text: apiYiPrompt }] }],
      }),
    }, Number(env.NANO_BANANA_TIMEOUT_MS) || 300000);
    const dataUrl = await resolveOpenAiImage(data?.choices?.[0]?.message?.content, fetchImpl);
    if (!dataUrl) throw new Error("API易未返回可识别的图片Base64或URL，请检查模型权限与响应格式");
    return {
      id: `nano-${Date.now()}`,
      label: "Nano Banana生成候选",
      kind: "image",
      dataUrl,
      provider: "nano-banana",
      sourceRef: `API易 Nano Banana · ${apiYiModel}`,
      model: apiYiModel,
      aspectRatio,
      imageSize,
      prompt,
      promptVersion: "ppt-image-v1-apiyi",
      generatedAt: Date.now(),
    };
  }
  const endpoint = cleanBase(env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta") + "/interactions";
  const data = await fetchJson(fetchImpl, endpoint, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: prompt,
      response_format: { type: "image", aspect_ratio: aspectRatio, image_size: imageSize },
    }),
  }, Number(env.NANO_BANANA_TIMEOUT_MS) || 180000);
  const image = findImagePayload(data);
  if (!image?.data) throw new Error("Nano Banana未返回图片，请检查模型权限或提示词");
  return {
    id: `nano-${Date.now()}`,
    label: "Nano Banana生成候选",
    kind: "image",
    dataUrl: `data:${image.mimeType};base64,${image.data}`,
    provider: "nano-banana",
    sourceRef: `Nano Banana · ${model}`,
    model,
    aspectRatio,
    imageSize,
    prompt,
    promptVersion: "ppt-image-v1",
    generatedAt: Date.now(),
  };
}

function contentCandidates(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => contentCandidates(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => contentCandidates(item, out));
  return out;
}

async function resolveOpenAiImage(content, fetchImpl) {
  const strings = contentCandidates(content);
  for (const value of strings) {
    const dataMatch = value.match(/data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)/);
    if (dataMatch) return `data:${dataMatch[1]};base64,${dataMatch[2].replace(/\s/g, "")}`;
  }
  for (const value of strings) {
    const urlMatch = value.match(/https?:\/\/[^\s)"']+/);
    if (!urlMatch) continue;
    const response = await fetchImpl(urlMatch[0]);
    if (!response.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) continue;
    const mime = response.headers.get("content-type") || "image/png";
    if (!mime.startsWith("image/")) continue;
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }
  return "";
}

function deepReplace(value, variables) {
  if (typeof value === "string") {
    const exact = value.match(/^\$\{([A-Z0-9_]+)\}$/);
    if (exact && Object.prototype.hasOwnProperty.call(variables, exact[1])) return variables[exact[1]];
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => String(variables[key] ?? ""));
  }
  if (Array.isArray(value)) return value.map(item => deepReplace(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepReplace(item, variables)]));
  }
  return value;
}

function firstComfyImage(history, promptId) {
  const job = history?.[promptId] || history;
  for (const output of Object.values(job?.outputs || {})) {
    const image = output?.images?.[0];
    if (image?.filename) return image;
  }
  return null;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function generateComfyUi(request, env = process.env, fetchImpl = fetch, options = {}) {
  if (!enabled(env.COMFYUI_ENABLED)) throw new Error("ComfyUI尚未启用");
  const base = cleanBase(env.COMFYUI_BASE_URL);
  if (!base) throw new Error("服务器尚未配置COMFYUI_BASE_URL");
  const prompt = safePrompt(request.prompt);
  const aspectRatio = ratioOf(request.aspectRatio);
  const [width, height] = COMFY_DIMENSIONS[aspectRatio];
  const workflowName = String(request.workflow || env.COMFYUI_WORKFLOW || "ppt-image-hero").replace(/[^a-z0-9_-]/gi, "");
  const workflowDir = options.workflowDir || env.COMFYUI_WORKFLOW_DIR || DEFAULT_WORKFLOW_DIR;
  const workflowRaw = await readFile(path.join(workflowDir, `${workflowName}.json`), "utf8");
  const seed = Number.isFinite(Number(request.seed)) ? Math.floor(Number(request.seed)) : Math.floor(Math.random() * 2147483647);
  const workflow = deepReplace(JSON.parse(workflowRaw), {
    PROMPT: prompt,
    NEGATIVE_PROMPT: request.negativePrompt || env.COMFYUI_NEGATIVE_PROMPT || "文字，水印，标志，低清晰度，畸变建筑，错误透视",
    CHECKPOINT: env.COMFYUI_CHECKPOINT || "sd_xl_base_1.0.safetensors",
    WIDTH: width,
    HEIGHT: height,
    SEED: seed,
    OUTPUT_PREFIX: `ppt/${Date.now()}`,
  });
  const headers = { "Content-Type": "application/json", ...authHeaders(env) };
  const queued = await fetchJson(fetchImpl, `${base}/prompt`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: workflow, client_id: `ppt-${Date.now()}` }),
  }, Number(env.COMFYUI_REQUEST_TIMEOUT_MS) || 30000);
  const promptId = queued.prompt_id;
  if (!promptId) throw new Error("ComfyUI未返回prompt_id");
  const deadline = Date.now() + (Number(env.COMFYUI_TIMEOUT_MS) || 240000);
  const pollMs = options.pollMs ?? (Number(env.COMFYUI_POLL_MS) || 1000);
  let image;
  while (Date.now() < deadline) {
    const history = await fetchJson(fetchImpl, `${base}/history/${encodeURIComponent(promptId)}`, {
      method: "GET",
      headers: authHeaders(env),
    }, Number(env.COMFYUI_REQUEST_TIMEOUT_MS) || 30000);
    image = firstComfyImage(history, promptId);
    if (image) break;
    await wait(pollMs);
  }
  if (!image) throw new Error("ComfyUI生成超时或未产生图片");
  const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" });
  const response = await fetchImpl(`${base}/view?${query}`, { headers: authHeaders(env) });
  if (!response.ok) throw new Error(`ComfyUI图片读取失败：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("ComfyUI返回图片为空或超过20MB");
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";
  return {
    id: `comfy-${promptId}`,
    label: "Stable Diffusion生成候选",
    kind: "image",
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    provider: "comfyui",
    sourceRef: `ComfyUI · ${env.COMFYUI_CHECKPOINT || "checkpoint"}`,
    model: env.COMFYUI_CHECKPOINT || "checkpoint",
    workflow: workflowName,
    promptId,
    aspectRatio,
    seed,
    prompt,
    promptVersion: "ppt-image-v1",
    generatedAt: Date.now(),
  };
}

export async function generatePptImage(request, env = process.env, fetchImpl = fetch, options = {}) {
  const provider = String(request.provider || "nano-banana");
  if (provider === "nano-banana") return generateNanoBanana(request, env, fetchImpl);
  if (provider === "comfyui") return generateComfyUi(request, env, fetchImpl, options);
  throw new Error("不支持的图片Provider");
}

export function createLimiter(maxConcurrency = 1) {
  const max = Math.max(1, Math.min(4, Number(maxConcurrency) || 1));
  let active = 0;
  const queue = [];
  const runNext = () => {
    while (active < max && queue.length) {
      const job = queue.shift();
      active += 1;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { active -= 1; runNext(); });
    }
  };
  return task => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); runNext(); });
}

export { GEMINI_MODELS, COMFY_DIMENSIONS };
