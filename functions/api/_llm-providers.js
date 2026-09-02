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
    label: "云端DeepSeek（当前默认）",
    urlKeys: ["DEEPSEEK_API_URL", "DEEPSEEK_BASE_URL", "LLM_BASE_URL"],
    keyKeys: ["DEEPSEEK_API_KEY", "LLM_API_KEY"],
    modelKeys: ["DEEPSEEK_MODEL", "LLM_MODEL"],
    defaultModel: "deepseek-v4-flash",
    defaultUrl: "https://api.deepseek.com/chat/completions",
  },
};

// 进程内短期熔断：本地部署时可避免每个问题都重新等待同一个不可达内网地址。
// Cloudflare isolate 复用期间同样有效；不持久化，不包含URL或Key。
const providerHealth = new Map();

function numberEnv(env, key, fallback, min, max) {
  const value = Number(env[key]);
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback));
}

function healthOf(name) {
  return providerHealth.get(name) || { failures: 0, openUntil: 0 };
}

function markSuccess(name) {
  providerHealth.set(name, { failures: 0, openUntil: 0 });
}

function markFailure(name) {
  const old = healthOf(name);
  const failures = Math.min(8, old.failures + 1);
  const cooldown = Math.min(300000, 15000 * Math.pow(2, failures - 1));
  providerHealth.set(name, { failures, openUntil: Date.now() + cooldown });
}

function timeoutError(name, timeoutMs) {
  const error = new Error(name + "响应超过" + timeoutMs + "ms");
  error.code = "LLM_TIMEOUT";
  return error;
}

async function callOne(cfg, payload, fetchImpl, timeoutMs, externalSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", abortFromParent, { once: true });
  }
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const startedAt = Date.now();
  try {
    const providerPayload={...payload,model:cfg.model};
    // DeepSeek V4默认开启思考模式；强制工具选择、结构化抽取和既有Agent循环均按非思考模式设计。
    // 只对DeepSeek注入该参数，避免GLM/Qwen等OpenAI兼容网关因未知字段拒绝请求。
    if(/deepseek/i.test(cfg.id+" "+cfg.model)&&!providerPayload.thinking)providerPayload.thinking={type:"disabled"};
    const response = await fetchImpl(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cfg.apiKey,
      },
      body: JSON.stringify(providerPayload),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = "HTTP " + response.status;
      try {
        const data = await response.clone().json();
        detail = String(data && data.error && (data.error.message || data.error) || data.message || detail);
      } catch (_) {}
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }
    return { response, provider: cfg.id, model: cfg.model, latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (timedOut) throw timeoutError(cfg.id, timeoutMs);
    if (/fetch failed|network|econn|eacces|enetunreach|etimedout/i.test(String(error && error.message || error))) {
      const causeCode=String(error && error.cause && error.cause.code || "").trim();
      const wrapped=new Error(cfg.id+"网络连接失败"+(causeCode?"（"+causeCode+"）":"")+"；请确认本地服务在正常网络权限下启动，并检查代理、VPN、防火墙和Provider地址");
      wrapped.code=causeCode||"LLM_NETWORK_ERROR";throw wrapped;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", abortFromParent);
  }
}

export async function probeProviderNetwork(env, name, fetchImpl=fetch, timeoutMs=5000){
  const cfg=getProviderConfig(env,name);
  if(!cfg||!cfg.available)return {reachable:false,provider:String(name||""),error:"Provider配置不完整"};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(500,timeoutMs));
  try{
    const response=await fetchImpl(cfg.url,{method:"HEAD",signal:controller.signal});
    return {reachable:true,provider:cfg.id,status:response.status};
  }catch(error){
    return {reachable:false,provider:cfg.id,error:String(error&&error.message||error||"网络连接失败"),code:String(error&&error.cause&&error.cause.code||"")};
  }finally{clearTimeout(timer);}
}

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
  const companyEnabled = /^(1|true|yes|on)$/i.test(String(env.LLM_ENABLE_COMPANY_PROVIDERS || ""));
  const defaultProvider = companyEnabled
    ? String(env.LLM_DEFAULT_PROVIDER || "deepseek-cloud").toLowerCase()
    : "deepseek-cloud";
  return {
    defaultProvider: PROVIDERS[defaultProvider] ? defaultProvider : "deepseek-cloud",
    companyProvidersEnabled: companyEnabled,
    providers: Object.keys(PROVIDERS).map((id) => {
      const cfg = getProviderConfig(env, id);
      return { id, label: cfg.label, model: cfg.model, available: cfg.available };
    }),
  };
}

export function providerOrder(env, requested) {
  const companyEnabled = /^(1|true|yes|on)$/i.test(String(env.LLM_ENABLE_COMPANY_PROVIDERS || ""));
  const explicit = String(requested || "").toLowerCase();
  // 当前默认只走公网云端。公司内网模型必须由管理员显式开启，避免未接内网时
  // 每个请求都先撞 DeepSeek/GLM/Qwen 的不可达地址。
  if (!companyEnabled) return ["deepseek-cloud"];
  if (PROVIDERS[explicit]) return [explicit];
  const defaultProvider = String(env.LLM_DEFAULT_PROVIDER || "deepseek-cloud").toLowerCase();
  const fallback = String(env.LLM_FALLBACK_PROVIDERS || "deepseek,glm,qwen")
    .split(",").map((x) => x.trim().toLowerCase()).filter((x) => PROVIDERS[x]);
  return [...new Set(["deepseek-cloud", PROVIDERS[defaultProvider] ? defaultProvider : "deepseek-cloud", ...fallback])];
}

export async function callConfiguredLlm(env, requestedProvider, payload, fetchImpl = fetch, options = {}) {
  const profile = String(options.profile || "standard").toLowerCase();
  const orderedNames = providerOrder(env, requestedProvider);
  const available = orderedNames.map((name) => getProviderConfig(env, name)).filter((cfg) => cfg && cfg.available);
  if (!available.length) throw new Error("可用模型调用均失败：没有配置完整的模型Provider");

  // 交互模式：当前默认只有云端；将来显式开启公司模型后，仍由云端先发，
  // 再与首个内网候选做延迟竞速，避免多个网络超时串成一分钟。
  if (profile === "interactive") {
    const totalTimeoutMs = numberEnv(env, "LLM_INTERACTIVE_TIMEOUT_MS", 3200, 1500, 10000);
    const hedgeDelayMs = numberEnv(env, "LLM_INTERACTIVE_HEDGE_DELAY_MS", 900, 200, totalTimeoutMs - 300);
    const now = Date.now();
    let candidates = available.filter((cfg) => healthOf(cfg.id).openUntil <= now);
    if (!candidates.length) candidates = available.slice(); // 全部熔断时允许半开探测
    const primary = candidates[0];
    const cloud = candidates.find((cfg) => cfg.id === "deepseek-cloud" && cfg.id !== primary.id);
    const hedge = cloud || candidates.find((cfg) => cfg.id !== primary.id) || null;
    const selected = hedge ? [primary, hedge] : [primary];
    const groupController = new AbortController();
    const attempts = [];
    const startedAt = Date.now();
    const jobs = selected.map((cfg, index) => (async () => {
      if (index) await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, hedgeDelayMs);
        groupController.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("竞速请求已取消")); }, { once: true });
      });
      const remaining = Math.max(300, totalTimeoutMs - (Date.now() - startedAt));
      try {
        const result = await callOne(cfg, payload, fetchImpl, remaining, groupController.signal);
        markSuccess(cfg.id);
        return result;
      } catch (error) {
        if (!groupController.signal.aborted) {
          markFailure(cfg.id);
          attempts.push(cfg.id + "：" + String(error && error.message || error));
        }
        throw error;
      }
    })());
    try {
      const result = await Promise.any(jobs);
      groupController.abort();
      return { ...result, totalLatencyMs: Date.now() - startedAt, mode: "interactive" };
    } catch (_) {
      groupController.abort();
      throw new Error("交互模型在" + totalTimeoutMs + "ms内未返回：" + (attempts.join("；") || "全部请求超时"));
    }
  }

  const attempts = [];
  const timeoutMs = numberEnv(env, "LLM_PROVIDER_TIMEOUT_MS", 45000, 3000, 120000);
  for (const name of orderedNames) {
    const cfg = getProviderConfig(env, name);
    if (!cfg || !cfg.available) {
      attempts.push(name + "：未配置完整");
      continue;
    }
    try {
      const result = await callOne(cfg, payload, fetchImpl, timeoutMs);
      markSuccess(name);
      return { ...result, mode: "standard" };
    } catch (error) {
      markFailure(name);
      attempts.push(name + "：调用失败（" + String(error && error.message || error) + "）");
      continue;
    }
  }
  throw new Error("可用模型调用均失败：" + attempts.join("；"));
}
