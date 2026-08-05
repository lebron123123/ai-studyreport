/* ============================================================
   server.js —— 本地服务器（替代 Cloudflare Pages）

   它做三件事：
     1. 把网页静态文件发出去（index.html、各个 .js）
     2. 把 /api/xxx 的请求转给原有的 functions/api/xxx.js 处理
     3. 在转交之前，把本地版的 DB / VECTORIZE / AI 注入 env

   关键点：原有的接口代码【一行都不用改】。
   因为 Cloudflare Pages Functions 用的是 Web 标准的 Request/Response，
   而 Node 18+ 原生就支持这两个对象，所以同一份代码两边都能跑。
   ============================================================ */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createD1Shim } from "./d1-shim.js";
import { createVectorStore } from "./vector-pg.js";
import { createAIAdapter } from "./ai-ollama.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");          // 仓库根目录（网页文件在这里）
const API_DIR = path.join(ROOT, "functions", "api");

/* ---------- 1. 组装 env（相当于 Cloudflare 的绑定） ---------- */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ 缺少 DATABASE_URL。请在 local-server/.env 里配置，例如：");
  console.error("   DATABASE_URL=postgres://postgres:你的密码@127.0.0.1:5432/studydb");
  process.exit(1);
}

const db = createD1Shim(DATABASE_URL);
const vectorize = createVectorStore(db, 1024);
const ai = createAIAdapter({
  ollamaUrl: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
  embedModel: process.env.EMBED_MODEL || "bge-m3",
});

const ENV = {
  ...process.env,
  DEPLOY_MODE: "local",
  DB: db,
  VECTORIZE: vectorize,
  AI: ai,
};

/* ---------- 2. 启动自检：早点发现问题，别等用户点了才报错 ---------- */
async function selfCheck() {
  const line = (ok, msg) => console.log((ok ? "  ✅ " : "  ❌ ") + msg);
  console.log("\n启动自检：");

  try { await db._ping(); line(true, "PostgreSQL 连接正常"); }
  catch (e) { line(false, "PostgreSQL 连不上：" + e.message); }

  try {
    const r = await db.prepare("SELECT COUNT(*)::int AS n FROM users").first();
    line(true, "数据表可访问（users 表 " + r.n + " 条记录）");
  } catch (e) {
    line(false, "数据表读取失败，可能是还没建表。请先执行 schema-postgres.sql");
  }

  try {
    const info = await ai._ping();
    const has = info.models.some((m) => m.startsWith(ai._embedModel));
    line(has, has ? "Ollama 正常，已安装 " + ai._embedModel
                  : "Ollama 在运行，但没找到 " + ai._embedModel + "，请执行：ollama pull " + ai._embedModel);
  } catch (e) {
    line(false, "Ollama 连不上：" + e.message + "（请确认 Ollama 已启动）");
  }

  try { const d = await vectorize.describe(); line(true, "向量库可访问（当前 " + d.vectorsCount + " 条向量）"); }
  catch (e) { line(false, "向量表读取失败，请确认已执行 schema-postgres.sql 且装了 pgvector 扩展"); }

  if (!process.env.DEEPSEEK_API_KEY) {
    console.log("  ⚠️  未配置 DEEPSEEK_API_KEY，AI 生成会失败");
  }
  if (!process.env.SESSION_SECRET) {
    console.log("  ⚠️  未配置 SESSION_SECRET，登录会失败");
  }
  console.log("");
}

/* ---------- 3. 路由 ---------- */
const app = new Hono();

// 可用的接口名单（从目录扫描，下划线开头的是内部模块，不对外）
const apiNames = existsSync(API_DIR)
  ? readdirSync(API_DIR).filter((f) => f.endsWith(".js") && !f.startsWith("_")).map((f) => f.replace(/\.js$/, ""))
  : [];

const handlerCache = new Map();
async function loadHandler(name) {
  if (handlerCache.has(name)) return handlerCache.get(name);
  const file = path.join(API_DIR, name + ".js");
  if (!existsSync(file)) return null;
  const mod = await import(pathToFileURL(file).href);
  handlerCache.set(name, mod);
  return mod;
}

app.all("/api/:name", async (c) => {
  const name = c.req.param("name");
  if (!apiNames.includes(name)) return c.json({ error: "接口不存在：" + name }, 404);

  const mod = await loadHandler(name);
  if (!mod) return c.json({ error: "接口加载失败：" + name }, 500);

  // Pages Functions 按方法命名：onRequestGet / onRequestPost / onRequestDelete …
  const method = c.req.method.charAt(0) + c.req.method.slice(1).toLowerCase();
  const fn = mod["onRequest" + method] || mod.onRequest;
  if (!fn) return c.json({ error: "该接口不支持 " + c.req.method + " 方法" }, 405);

  try {
    // 构造和 Cloudflare 一样的 context 对象
    const res = await fn({
      request: c.req.raw,
      env: ENV,
      params: {},
      data: {},
      waitUntil: (p) => { Promise.resolve(p).catch(() => {}); },
      next: async () => new Response("", { status: 404 }),
    });
    return res instanceof Response ? res : c.json({ error: "接口未返回有效响应" }, 500);
  } catch (e) {
    console.error("[" + name + "] 出错：", e);
    return c.json({ error: e.message || "服务器内部错误" }, 500);
  }
});

// 静态文件：网页本体
app.use("/*", serveStatic({ root: path.relative(process.cwd(), ROOT) || "." }));
app.get("/", serveStatic({ path: path.join(path.relative(process.cwd(), ROOT) || ".", "index.html") }));

/* ---------- 4. 启动 ---------- */
const PORT = parseInt(process.env.PORT) || 8080;
await selfCheck();
console.log("接口已加载：" + apiNames.join("、"));
const httpServer = serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log("\n🚀 本地站已启动：http://localhost:" + info.port);
  console.log("   （同一局域网内其他电脑可用本机IP访问）\n");
});
// 端口占用等启动失败原来是"未捕获异常"，Node会直接打一串英文堆栈然后退出——
// 双击桌面快捷方式时窗口一闪而过，根本来不及看是什么问题。这里接住，打印人话原因再退出。
httpServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("\n❌ 启动失败：端口 " + PORT + " 已经被占用。");
    console.error("   最常见的原因：这个本地站已经在另一个窗口里启动着了。");
    console.error("   解决办法：关掉之前那个还开着的本地站窗口，再重新运行；");
    console.error("   或者打开 local-server\\.env，把 PORT 改成别的数字（比如 8081）后再启动。\n");
  } else {
    console.error("\n❌ 服务器启动失败：" + err.message + "\n");
  }
  process.exit(1);
});
