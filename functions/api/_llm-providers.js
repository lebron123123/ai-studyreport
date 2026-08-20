const PROVIDERS = {
  deepseek: {
    label: "DeepSeek-V4-Flash-0731",
    urlKeys: ["COMPANY_DEEPSEEK_API_URL", "COMPANY_DEEPSEEK_BASE_URL"],
    keyKeys: ["COMPANY_DEEPSEEK_API_KEY"],
    modelKeys: ["COMPANY_DEEPSEEK_MODEL"],
    defaultModel: "DeepSeek-V4-Flash-0731",
  },
  glm: {
    label: "GLM-4.5",
    urlKeys: ["GLM_API_URL", "GLM_BASE_URL"],
    keyKeys: ["GLM_API_KEY"],
    modelKeys: ["GLM_MODEL"],
    defaultModel: "GLM-4.5",
  },
  qwen: {
    label: "Qwen3.6-27B",
    urlKeys: ["QWEN_API_URL", "QWEN_BASE_URL"],
    keyKeys: ["QWEN_API_KEY"],
    modelKeys: ["QWEN_MODEL"],
    defaultModel: "Qwen3.6-27B",
  },
  "deepseek-cloud": {
    label: "原云端DeepSeek（最终兜底）",
    urlKeys: ["DEEPSEEK_API_URL", "DEEPSEEK_BASE_URL", "LLM_BASE_URL"],
    keyKeys: ["DEEPSEEK_API_KEY", "LLM_API_KEY"],
    modelKeys: ["DEEPSEEK_MODEL", "LLM_MODEL"],
    defaultModel: "deepseek-v4-flash",
    defaultUrl: "https://api.deepseek.com/chat/completions",
  },
};

function first(env, keys) {
  for (const key of keys) {
    const value = String(env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

// 公司交付的 URL 可能已经是完整推理端点（如 /inference/deepseek），这种情况原样使用；
// 只有明确给到 OpenAI base URL（以 /v1 结尾）时才自动补 /chat/completions。
export function normalizeChatUrl(value) {
  const raw = String(value || "").trim();
  // 从聊天或表格复制URL时，前面偶尔会带“URL:”、多余字母或空格；只提取真正的HTTP地址。
  const extracted = (raw.match(/https?:\/\/[^\s]+/i) || [raw])[0];
  const url = extracted.replace(/[，。；;]+$/, "").replace(/\/+$/, "");
  if (!url) return "";
  if (/\/chat\/completions$/i.test(url)) return url;
  if (/\/v1$/i.test(url)) return url + "/chat/completions";
  return url;
}

export function getProviderConfig(env, name) {
  const id = String(name || "").toLowerCase();
  const def = PROVIDERS[id];
  if (!def) return null;
  const url = normalizeChatUrl(first(env, def.urlKeys) || def.defaultUrl || "");
  const apiKey = first(env, def.keyKeys);
  const model = first(env, def.modelKeys) || def.defaultModel;
  return { id, label: def.label, url, apiKey, model, available: Boolean(url && apiKey && model) };
}

export function providerStatus(env) {
  const defaultProvider = String(env.LLM_DEFAULT_PROVIDER || "deepseek").toLowerCase();
  return {
    defaultProvider: PROVIDERS[defaultProvider] ? defaultProvider : "deepseek",
    providers: Object.keys(PROVIDERS).map((id) => {
      const cfg = getProviderConfig(env, id);
      return { id, label: cfg.label, model: cfg.model, available: cfg.available };
    }),
  };
}

export function providerOrder(env, requested) {
  const explicit = String(requested || "").toLowerCase();
  if (PROVIDERS[explicit]) return [explicit];
  const defaultProvider = String(env.LLM_DEFAULT_PROVIDER || "deepseek").toLowerCase();
  const fallback = String(env.LLM_FALLBACK_PROVIDERS || "glm,qwen,deepseek-cloud")
    .split(",").map((x) => x.trim().toLowerCase()).filter((x) => PROVIDERS[x]);
  return [...new Set([PROVIDERS[defaultProvider] ? defaultProvider : "deepseek", ...fallback])];
}

export async function callConfiguredLlm(env, requestedProvider, payload, fetchImpl = fetch) {
  const attempts = [];
  for (const name of providerOrder(env, requestedProvider)) {
    const cfg = getProviderConfig(env, name);
    if (!cfg || !cfg.available) {
      attempts.push(name + "：未配置完整");
      continue;
    }
    let response;
    try {
      response = await fetchImpl(cfg.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + cfg.apiKey,
        },
        body: JSON.stringify({ ...payload, model: cfg.model }),
      });
    } catch (error) {
      attempts.push(name + "：连接失败（" + String(error && error.message || error) + "）");
      continue;
    }
    if (response.ok) return { response, provider: name, model: cfg.model };
    let detail = "HTTP " + response.status;
    try {
      const data = await response.clone().json();
      detail = String(data && data.error && (data.error.message || data.error) || data.message || detail);
    } catch (_) {}
    attempts.push(name + "：" + detail);
  }
  throw new Error("可用模型调用均失败：" + attempts.join("；"));
}
