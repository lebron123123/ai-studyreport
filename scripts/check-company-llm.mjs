import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { callConfiguredLlm, getProviderConfig } from "../functions/api/_llm-providers.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath = path.join(root, "集团大模型检测结果.txt");
const providers = [
  ["deepseek", "公司 DeepSeek"],
  ["glm", "公司 GLM"],
  ["qwen", "公司 Qwen"],
];

function tcpCheck(host, port, timeout = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port, timeout });
    const done = (result) => {
      socket.destroy();
      resolve({ ...result, latencyMs: Date.now() - started });
    };
    socket.once("connect", () => done({ ok: true }));
    socket.once("timeout", () => done({ ok: false, error: "连接超时" }));
    socket.once("error", (error) => done({ ok: false, error: error.code || error.message }));
  });
}

function cleanError(error) {
  return String(error?.message || error || "未知错误")
    .replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[密钥已隐藏]")
    .slice(0, 600);
}

async function checkOne(id, label) {
  const config = getProviderConfig(process.env, id);
  const result = { id, label, configured: Boolean(config?.available), model: config?.model || "" };
  if (!config?.available) return { ...result, ok: false, stage: "配置", error: "URL或Key未填写完整" };

  let endpoint;
  try { endpoint = new URL(config.url); }
  catch { return { ...result, ok: false, stage: "URL", error: "URL格式无法解析" }; }

  const port = Number(endpoint.port) || (endpoint.protocol === "https:" ? 443 : 80);
  const tcp = await tcpCheck(endpoint.hostname, port);
  Object.assign(result, { host: endpoint.hostname, port, tcp });
  if (!tcp.ok) return { ...result, ok: false, stage: "网络", error: tcp.error };

  const started = Date.now();
  try {
    const timedFetch = (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
    const called = await callConfiguredLlm(process.env, id, {
      messages: [{ role: "user", content: "只回复OK" }],
      max_tokens: 16,
      temperature: 0,
      stream: false,
    }, timedFetch);
    const data = await called.response.json();
    const message = data?.choices?.[0]?.message;
    if (!message) return { ...result, ok: false, stage: "响应", apiLatencyMs: Date.now() - started, error: "未返回OpenAI兼容choices.message" };
    return { ...result, ok: true, stage: "完成", apiLatencyMs: Date.now() - started, responseShape: "choices[0].message" };
  } catch (error) {
    return { ...result, ok: false, stage: "API", apiLatencyMs: Date.now() - started, error: cleanError(error) };
  }
}

const startedAt = new Date();
const results = [];
console.log("\n集团大模型连通性检测（不会显示Key）");
console.log("检测时间：" + startedAt.toLocaleString("zh-CN"));
console.log("-".repeat(56));

for (const [id, label] of providers) {
  process.stdout.write(`正在检测 ${label} ... `);
  const result = await checkOne(id, label);
  results.push(result);
  console.log(result.ok ? "成功" : `失败（${result.stage}）`);
}

const lines = [
  "集团大模型连通性检测结果",
  `检测时间：${startedAt.toLocaleString("zh-CN")}`,
  `本机时间：${startedAt.toISOString()}`,
  "注意：报告不包含任何API Key。",
  "",
];

for (const item of results) {
  lines.push(`【${item.label}】${item.ok ? "成功" : "失败"}`);
  lines.push(`  模型：${item.model || "未配置"}`);
  if (item.host) lines.push(`  地址：${item.host}:${item.port}`);
  if (item.tcp) lines.push(`  TCP：${item.tcp.ok ? "成功" : "失败"}（${item.tcp.latencyMs}ms）`);
  if (item.apiLatencyMs != null) lines.push(`  API：${item.ok ? "成功" : "失败"}（${item.apiLatencyMs}ms）`);
  lines.push(`  阶段：${item.stage}`);
  if (item.error) lines.push(`  原因：${item.error}`);
  lines.push("");
}

fs.writeFileSync(reportPath, lines.join("\n"), "utf8");

console.log("-".repeat(56));
for (const item of results) console.log(`${item.ok ? "✓" : "✗"} ${item.label}：${item.ok ? `API正常（${item.apiLatencyMs}ms）` : `${item.stage}失败 - ${item.error}`}`);
console.log("\n结果已保存：" + reportPath);
console.log(results.every((item) => item.ok) ? "\n结论：三套集团API全部可以正常调用。" : "\n结论：仍有接口未打通，请把结果文件交给网络或模型平台管理员。" );

if (process.argv.includes("--open") && process.platform === "win32") {
  try {
    const child = spawn("notepad.exe", [reportPath], { detached: true, stdio: "ignore" });
    child.unref();
  } catch (_) {}
}
