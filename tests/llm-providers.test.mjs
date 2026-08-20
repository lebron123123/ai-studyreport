import test from "node:test";
import assert from "node:assert/strict";
import { callConfiguredLlm, normalizeChatUrl, providerOrder, providerStatus } from "../functions/api/_llm-providers.js";

test("公司完整推理URL原样使用，OpenAI v1自动补全", () => {
  assert.equal(normalizeChatUrl("http://intranet/inference/deepseek"), "http://intranet/inference/deepseek");
  assert.equal(normalizeChatUrl("http://intranet/v1/"), "http://intranet/v1/chat/completions");
  assert.equal(normalizeChatUrl("h http://intranet/v1/chat/completions"), "http://intranet/v1/chat/completions");
});

test("默认DeepSeek，回退GLM和Qwen", () => {
  assert.deepEqual(providerOrder({}, ""), ["deepseek", "glm", "qwen", "deepseek-cloud"]);
  assert.deepEqual(providerOrder({}, "glm"), ["glm"]);
});

test("状态接口不泄露URL和Key", () => {
  const status = providerStatus({ COMPANY_DEEPSEEK_API_URL: "http://secret", COMPANY_DEEPSEEK_API_KEY: "secret-key" });
  assert.equal(status.providers[0].available, true);
  assert.equal(JSON.stringify(status).includes("secret"), false);
});

test("默认模型失败后自动回退GLM，并使用各自模型名", async () => {
  const calls = [];
  const env = {
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
