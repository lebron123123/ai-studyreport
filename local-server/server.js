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
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createD1Shim } from "./d1-shim.js";
import { createVectorStore } from "./vector-pg.js";
import { createAIAdapter } from "./ai-ollama.js";
import { createWorker } from "tesseract.js";
import chiSimData from "@tesseract.js-data/chi_sim";
import { verifyAuth } from "../functions/api/_auth.js";
import { buildPptxBuffer, validatePptxBuffer } from "./ppt-export.js";
import { buildNativeTemplatePptx } from "./ppt-native-template.js";
import { enrichCustomTemplatePlan } from "./ppt-custom-template-export.js";
import { analyzeTemplateBuffer } from "./ppt-template-analyzer.js";
import { ensureTemplatePreviews, resolvePreviewFile, resolveStoredTemplate } from "./ppt-template-preview.js";
import { createLimiter, generatePptImage, imageProviderStatus } from "./ppt-image-generation.js";
import { providerStatus as llmProviderStatus } from "../functions/api/_llm-providers.js";
import { startAgentWorker } from "./agent-worker.js";
import { createRagObjectStore } from "./rag-object-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 公司内网模型与第三方生图单独放在.env.company，避免改写原.env中的数据库及云端兜底密钥。
const companyEnvPath = path.join(__dirname, ".env.company");
if (existsSync(companyEnvPath) && typeof process.loadEnvFile === "function") process.loadEnvFile(companyEnvPath);
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
const ragObjects = createRagObjectStore(process.env.RAG_OBJECT_ROOT || path.join(ROOT, "local-data", "rag-objects"));

const ENV = {
  ...process.env,
  DEPLOY_MODE: "local",
  DB: db,
  VECTORIZE: vectorize,
  AI: ai,
  RAG_OBJECTS: ragObjects,
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

  // 轻量向前迁移：新增表使用IF NOT EXISTS，旧部署升级无需人工执行整份schema。
  try{
    await db.prepare("CREATE TABLE IF NOT EXISTS aireport_project_sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, project_id TEXT NOT NULL, data TEXT NOT NULL, updated_at BIGINT NOT NULL, UNIQUE(user_id, project_id))").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_aireport_project_sessions_user ON aireport_project_sessions(user_id, updated_at DESC)").run();
    line(true,"项目级AI可研会话表已就绪");
  }catch(e){ line(false,"项目级AI可研会话表初始化失败："+e.message); }

  try{
    await db.prepare("CREATE TABLE IF NOT EXISTS knowledge_contributions (id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',source_ref TEXT DEFAULT '',file_name TEXT DEFAULT '',region TEXT DEFAULT '',project_type TEXT DEFAULT '',meta TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending',review_note TEXT DEFAULT '',target_module TEXT DEFAULT '',target_ref TEXT DEFAULT '',parent_id TEXT DEFAULT '',user_id INTEGER NOT NULL,username TEXT DEFAULT '',created_at BIGINT NOT NULL,reviewed_at BIGINT,reviewed_by TEXT DEFAULT '')").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_knowledge_contributions_status ON knowledge_contributions(status,created_at DESC)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_knowledge_contributions_user ON knowledge_contributions(user_id,created_at DESC)").run();
    line(true,"知识协作投稿审核表已就绪");
  }catch(e){ line(false,"知识协作投稿审核表初始化失败："+e.message); }

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

  try { line(existsSync(ragObjects.root), "RAG原件对象目录已就绪"); }
  catch (e) { line(false, "RAG原件对象目录不可用：" + e.message); }

  const llmStatus = llmProviderStatus(ENV);
  for (const provider of llmStatus.providers) {
    line(provider.available, "大模型 " + provider.label + (provider.id === llmStatus.defaultProvider ? "（默认）" : ""));
  }
  if (!process.env.SESSION_SECRET) {
    console.log("  ⚠️  未配置 SESSION_SECRET，登录会失败");
  }
  const imageStatus=imageProviderStatus(ENV);
  for(const provider of imageStatus.providers){
    line(provider.available,"PPT生图："+provider.name+(provider.available?" 已就绪":" 未启用"));
  }
  console.log("");
}

/* ---------- 3. 路由 ---------- */
const app = new Hono();
const runImageGeneration = createLimiter(process.env.PPT_IMAGE_MAX_CONCURRENCY || 1);

// PPT图片服务统一网关：浏览器不直接接触云端密钥或ComfyUI地址。
app.get("/api/ppt-image-status", async c=>{
  const user=await verifyAuth(c.req.raw,ENV);if(!user)return c.json({ok:false,error:"未登录"},401);
  return c.json({ok:true,...imageProviderStatus(ENV)});
});

app.post("/api/ppt-image-generate", async c=>{
  const user=await verifyAuth(c.req.raw,ENV);if(!user)return c.json({ok:false,error:"未登录"},401);
  try{
    const body=await c.req.json();
    const prompt=String(body&&body.prompt||"");
    if(!prompt||prompt.length>4000)return c.json({ok:false,error:"提示词为空或超过4000字"},400);
    const image=await runImageGeneration(()=>generatePptImage(body,ENV));
    return c.json({ok:true,image});
  }catch(e){
    console.error("[ppt-image-generate]",e);
    const message=String(e&&e.message||e||"图片生成失败");
    const status=/尚未启用|尚未配置|不支持/.test(message)?503:500;
    return c.json({ok:false,error:message},status);
  }
});

// 本地离线 OCR：中文训练数据随本地服务安装，不把扫描件上传到任何云端。
let ocrWorkerPromise = null;
let ocrQueue = Promise.resolve();
async function getOcrWorker(){
  if(!ocrWorkerPromise) ocrWorkerPromise = createWorker("chi_sim", 1, { langPath: chiSimData.langPath, gzip: chiSimData.gzip });
  return ocrWorkerPromise;
}
app.post("/api/local-ocr", async c=>{
  const user=await verifyAuth(c.req.raw,ENV); if(!user) return c.json({ok:false,error:"未登录"},401);
  try{
    const body=await c.req.json(), b64=String(body.dataBase64||"");
    if(!b64||b64.length>18*1024*1024) return c.json({ok:false,error:"OCR图片为空或超过限制"},400);
    const worker=await getOcrWorker(), image=Buffer.from(b64,"base64");
    const job=ocrQueue.then(()=>worker.recognize(image)); ocrQueue=job.catch(()=>{}); const result=await job;
    const text=String(result.data&&result.data.text||"").trim(); return c.json({ok:true,text,confidence:Number(result.data&&result.data.confidence||0)});
  }catch(e){return c.json({ok:false,error:"本地OCR失败："+(e.message||e)},500);}
});

// 本地 AI PPT 导出：品牌模板约束主题，SlideSpec 动态选择原生可编辑组件。
app.post("/api/ppt-export", async c=>{
  const user=await verifyAuth(c.req.raw,ENV);if(!user)return c.json({ok:false,error:"未登录"},401);
  try{
    const body=await c.req.json();let plan=body&&body.plan;
    if(!plan||!Array.isArray(plan.slides)||plan.slides.length<1)return c.json({ok:false,error:"没有可导出的PPT页面"},400);
    if(plan.slides.length>40)return c.json({ok:false,error:"单份PPT暂不支持超过40页"},400);
    const customId=String(plan.realTemplateRecordId||(plan.slides.find(slide=>slide&&slide.templateRecordId)||{}).templateRecordId||"").slice(0,100);
    let buffer;
    if(customId){
      const row=await ENV.DB.prepare("SELECT id,user_id,name,status,storage_key,profile FROM ppt_templates WHERE id=?").bind(customId).first();
      if(!row)return c.json({ok:false,error:"选中的真实模板不存在或已删除"},404);
      const admins=String(ENV.ADMIN_USERS||"").split(",").map(value=>value.trim()).filter(Boolean),admin=admins.includes(user.username)||admins.includes(String(user.userId));
      if(Number(row.user_id)!==Number(user.userId)&&row.status!=="published"&&!admin)return c.json({ok:false,error:"无权使用该真实模板"},403);
      let profile={};try{profile=JSON.parse(row.profile||"{}");}catch{}
      const sourcePath=resolveStoredTemplate(ROOT,row.storage_key);
      if(!existsSync(sourcePath))return c.json({ok:false,error:"真实模板原文件不存在，请重新上传"},404);
      plan=enrichCustomTemplatePlan(plan,{...row,profile},{isOwner:Number(row.user_id)===Number(user.userId)});
      buffer=await buildNativeTemplatePptx(plan,{templatePath:sourcePath});
    }else buffer=await buildPptxBuffer(plan);
    const qa=await validatePptxBuffer(buffer,plan),name=String(plan.title||"项目汇报").replace(/[\\/:*?\"<>|]/g,"_").slice(0,80)+".pptx";
    if(!qa.ok)return c.json({ok:false,error:"PPT结构质检失败："+qa.errors.join("；"),qa},500);
    return new Response(buffer,{status:200,headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.presentationml.presentation","Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(name),"Cache-Control":"no-store","X-PPT-QA":"passed","X-PPT-QA-Warnings":String(qa.warnings.length),"X-PPT-Slides":String(qa.slideCount),"X-PPT-Native":String(qa.nativeTemplate===true),"X-PPT-Template-Mode":plan.realTemplateRecordId?"source-slide-clone":"generated"}});
  }catch(e){console.error("[ppt-export]",e);return c.json({ok:false,error:"PPT导出失败："+(e.message||e)},500);}
});

// Reference PPT template induction: local-only parsing and storage, never uploads the source file.
app.post("/api/ppt-template-analyze", async c=>{
  const user=await verifyAuth(c.req.raw,ENV);if(!user)return c.json({ok:false,error:"未登录"},401);
  try{
    const body=await c.req.json(),name=String(body.name||"reference.pptx").replace(/[\\/:*?\"<>|]/g,"_").slice(0,120),b64=String(body.dataBase64||"");
    if(!/\.(pptx|potx)$/i.test(name))return c.json({ok:false,error:"只支持PPTX/POTX参考模板"},400);
    if(!b64||b64.length>90*1024*1024)return c.json({ok:false,error:"参考模板为空或超过约65MB"},400);
    const buffer=Buffer.from(b64,"base64"),profile=await analyzeTemplateBuffer(buffer,name),dir=path.join(ROOT,"local-data","ppt-templates","user-"+user.userId);mkdirSync(dir,{recursive:true});
    const file=profile.fingerprint.slice(0,24)+path.extname(name).toLowerCase();writeFileSync(path.join(dir,file),buffer);
    return c.json({ok:true,profile,storageKey:"user-"+user.userId+"/"+file,cached:false});
  }catch(e){console.error("[ppt-template-analyze]",e);return c.json({ok:false,error:"参考PPT解析失败："+(e.message||e)},500);}
});

// Local template thumbnail endpoint. Source PPTX stays private; only cached PNG previews are returned.
app.get("/api/ppt-template-preview", async c=>{
  const user=await verifyAuth(c.req.raw,ENV);if(!user)return c.json({ok:false,error:"未登录"},401);
  try{
    const templateId=String(c.req.query("id")||"").slice(0,100),page=Math.max(1,Number(c.req.query("page"))||1);
    const row=await ENV.DB.prepare("SELECT id,user_id,status,storage_key,profile FROM ppt_templates WHERE id=?").bind(templateId).first();
    if(!row)return c.json({ok:false,error:"模板不存在"},404);
    const admins=String(ENV.ADMIN_USERS||"").split(",").map(value=>value.trim()).filter(Boolean),admin=admins.includes(user.username)||admins.includes(String(user.userId));
    if(Number(row.user_id)!==Number(user.userId)&&row.status!=="published"&&!admin)return c.json({ok:false,error:"无权查看该模板"},403);
    let profile={};try{profile=JSON.parse(row.profile||"{}");}catch{}
    const pages=(profile.pages||[]).map(item=>Number(item.page)).filter(Number.isFinite),allowed=pages.includes(page)||(profile.pageIndex||[]).some(item=>Number(item.page)===page);
    if(!allowed)return c.json({ok:false,error:"页面不在模板合同中"},404);
    const sourcePath=resolveStoredTemplate(ROOT,row.storage_key),previewPath=resolvePreviewFile(ROOT,templateId,page);
    if(!existsSync(previewPath))await ensureTemplatePreviews({root:ROOT,templateId,sourcePath,pages:pages.length?pages:[page]});
    if(!existsSync(previewPath))return c.json({ok:false,error:"缩略图生成失败"},500);
    return new Response(readFileSync(previewPath),{headers:{"Content-Type":"image/png","Cache-Control":"private, max-age=86400"}});
  }catch(e){console.error("[ppt-template-preview]",e);return c.json({ok:false,error:"模板缩略图生成失败："+(e.message||e)},500);}
});

// Local-only artifact cleanup after the governance API has deleted a template record.
app.post("/api/ppt-template-cleanup", async c=>{
  const user=await verifyAuth(c.req.raw,ENV);if(!user)return c.json({ok:false,error:"未登录"},401);
  const admins=String(ENV.ADMIN_USERS||"").split(",").map(value=>value.trim()).filter(Boolean);
  if(!admins.includes(user.username)&&!admins.includes(String(user.userId)))return c.json({ok:false,error:"仅管理员可清理模板文件"},403);
  if(ENV.ADMIN_PASS&&c.req.header("x-admin-pass")!==ENV.ADMIN_PASS)return c.json({ok:false,error:"管理员验证已失效"},403);
  try{
    const body=await c.req.json(),templateId=String(body.id||"").slice(0,100),storageKey=String(body.storageKey||"").slice(0,300);
    if(!templateId||!storageKey)return c.json({ok:false,error:"缺少模板清理目标"},400);
    const sourcePath=resolveStoredTemplate(ROOT,storageKey),previewDir=path.dirname(resolvePreviewFile(ROOT,templateId,1));
    rmSync(sourcePath,{force:true});rmSync(previewDir,{recursive:true,force:true});
    return c.json({ok:true,cleaned:true});
  }catch(e){console.error("[ppt-template-cleanup]",e);return c.json({ok:false,error:"模板文件清理失败："+(e.message||e)},500);}
});

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
const agentWorker=startAgentWorker(ENV,{pollMs:process.env.AGENT_WORKER_POLL_MS,leaseMs:process.env.AGENT_WORKER_LEASE_MS});
console.log("Agent后台Worker已启动："+agentWorker.workerId);
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
