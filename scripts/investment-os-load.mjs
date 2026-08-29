#!/usr/bin/env node

/**
 * Investment OS 50人核心路径压测。
 *
 * 必填环境变量：
 *   INVESTMENT_OS_PROJECT_ID   已存在的项目ID
 * 可选：
 *   INVESTMENT_OS_BASE_URL     默认 http://localhost:8080
 *   INVESTMENT_OS_COOKIE       已授权的测试账号 Cookie（不得提交到Git）
 *   INVESTMENT_OS_BEARER       已授权的测试令牌（不得提交到Git）
 *   INVESTMENT_OS_CONCURRENCY  默认 50
 *   INVESTMENT_OS_ITERATIONS   每个虚拟用户请求轮数，默认 4
 *   INVESTMENT_OS_RECORD       设为 1 时把结果写入当前项目生产验收台账
 *
 * 每轮并行访问项目大脑和阶段4—6执行API，用真实HTTP耗时计算p50/p95、
 * 成功率和并发峰值。脚本不读取浏览器存储，也不伪造生产验收结果。
 */

const baseUrl = String(process.env.INVESTMENT_OS_BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const projectId = String(process.env.INVESTMENT_OS_PROJECT_ID || "").trim();
const concurrency = Math.max(1, Number(process.env.INVESTMENT_OS_CONCURRENCY || 50));
const iterations = Math.max(1, Number(process.env.INVESTMENT_OS_ITERATIONS || 4));
const cookie = String(process.env.INVESTMENT_OS_COOKIE || "").trim();
const bearer = String(process.env.INVESTMENT_OS_BEARER || "").trim();

if (!projectId) {
  console.error("缺少 INVESTMENT_OS_PROJECT_ID，未执行压测。请指定一个测试项目ID。");
  process.exit(2);
}

const headers = { accept: "application/json" };
if (cookie) headers.cookie = cookie;
if (bearer) headers.authorization = `Bearer ${bearer}`;

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
};

const requestOnce = async (path) => {
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(30000) });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Math.round(performance.now() - started),
      error: response.ok ? "" : body.slice(0, 180),
    };
  } catch (error) {
    return { ok: false, status: 0, latencyMs: Math.round(performance.now() - started), error: String(error?.message || error) };
  }
};

const worker = async () => {
  const out = [];
  for (let i = 0; i < iterations; i += 1) {
    out.push(await requestOnce(`/api/projectbrain?projectId=${encodeURIComponent(projectId)}`));
    out.push(await requestOnce(`/api/investmentops?projectId=${encodeURIComponent(projectId)}`));
  }
  return out;
};

const startedAt = new Date().toISOString();
const wallStarted = performance.now();
const groups = await Promise.all(Array.from({ length: concurrency }, () => worker()));
const results = groups.flat();
const wallMs = Math.round(performance.now() - wallStarted);
const successes = results.filter((item) => item.ok);
const failures = results.filter((item) => !item.ok);
const latencies = successes.map((item) => item.latencyMs);
const summary = {
  kind: "slo",
  startedAt,
  finishedAt: new Date().toISOString(),
  baseUrl,
  projectId,
  concurrency,
  iterations,
  requestCount: results.length,
  wallMs,
  throughputPerSecond: wallMs ? Number((results.length / (wallMs / 1000)).toFixed(2)) : 0,
  successRate: results.length ? Number((successes.length / results.length).toFixed(4)) : 0,
  failureCount: failures.length,
  p50Ms: percentile(latencies, 0.5),
  p95Ms: percentile(latencies, 0.95),
  recoveryRate: failures.length ? 0 : 1,
  sampleErrors: failures.slice(0, 5),
};

console.log(JSON.stringify(summary, null, 2));

if (process.env.INVESTMENT_OS_RECORD === "1") {
  const response = await fetch(`${baseUrl}/api/investmentops`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ action: "saveEvaluation", projectId, kind: "slo", result: summary }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    console.error(`压测完成，但写入生产验收台账失败：${response.status} ${(await response.text()).slice(0, 200)}`);
    process.exit(1);
  }
  console.error("压测结果已写入当前项目的生产验收台账。");
}

process.exit(failures.length ? 1 : 0);
