import test from "node:test";
import assert from "node:assert/strict";
import { callConfiguredLlm, normalizeChatUrl, providerOrder, providerStatus } from "../functions/api/_llm-providers.js";

test("公司完整推理URL原样使用，OpenAI v1自动补全", () => {
  assert.equal(normalizeChatUrl("http://intranet/inference/deepseek"), "http://intranet/inference/deepseek");
  assert.equal(normalizeChatUrl("http://intranet/v1/"), "http://intranet/v1/chat/completions");
  assert.equal(normalizeChatUrl("h http://intranet/v1/chat/completions"), "http://intranet/v1/chat/completions");
});

test("默认只使用云端，显式开启后才加入公司内网模型", () => {
  assert.deepEqual(providerOrder({}, ""), ["deepseek-cloud"]);
  assert.deepEqual(providerOrder({}, "glm"), ["deepseek-cloud"]);
  const enabled={LLM_ENABLE_COMPANY_PROVIDERS:"1",LLM_DEFAULT_PROVIDER:"deepseek",LLM_FALLBACK_PROVIDERS:"glm,qwen"};
  assert.deepEqual(providerOrder(enabled, ""), ["deepseek-cloud", "deepseek", "glm", "qwen"]);
  assert.deepEqual(providerOrder(enabled, "glm"), ["glm"]);
});

test("状态接口不泄露URL和Key", () => {
  const status = providerStatus({ COMPANY_DEEPSEEK_API_URL: "http://secret", COMPANY_DEEPSEEK_API_KEY: "secret-key" });
  assert.equal(status.providers[0].available, true);
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("默认模型失败后自动回退GLM，并使用各自模型名", async () => {
  const calls = [];
  const env = {
    LLM_ENABLE_COMPANY_PROVIDERS: "1",
    COMPANY_DEEPSEEK_API_URL: "http://ds", COMPANY_DEEPSEEK_API_KEY: "ds-key", COMPANY_DEEPSEEK_MODEL: "ds-model",
    GLM_API_URL: "http://glm", GLM_API_KEY: "glm-key", GLM_MODEL: "glm-model",
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (url === "http://ds") return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  };
  const result = await callConfiguredLlm(env, "", { messages: [] }, fetchImpl);
  assert.equal(result.provider, "glm");
  assert.equal(calls[0].body.model, "ds-model");
  assert.equal(calls[1].body.model, "glm-model");
  assert.equal(calls[1].options.headers.Authorization, "Bearer glm-key");
});

test("交互模式不会串行等待不可达内网模型，会延迟竞速云端兜底", async () => {
  const calls = [];
  const env = {
    LLM_ENABLE_COMPANY_PROVIDERS: "1",
    LLM_INTERACTIVE_TIMEOUT_MS: "1500",
    LLM_INTERACTIVE_HEDGE_DELAY_MS: "200",
    COMPANY_DEEPSEEK_API_URL: "http://intranet-ds", COMPANY_DEEPSEEK_API_KEY: "ds-key",
    DEEPSEEK_API_URL: "https://cloud-ds", DEEPSEEK_API_KEY: "cloud-key", DEEPSEEK_MODEL: "cloud-model",
  };
  const fetchImpl = (url, options) => {
    calls.push(url);
    if (url === "http://intranet-ds") {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      });
    }
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "fast" } }] }), { status: 200 }));
  };
  const started = Date.now();
  const result = await callConfiguredLlm(env, "", { messages: [] }, fetchImpl, { profile: "interactive" });
  assert.equal(result.provider, "deepseek-cloud");
  assert.equal(result.mode, "interactive");
  assert.ok(Date.now() - started < 1000);
  assert.equal(calls.includes("https://cloud-ds"), true);
  assert.ok(calls.length <= 2, "熔断后可直接跳过已知故障Provider；首次调用最多主备两路");
});
