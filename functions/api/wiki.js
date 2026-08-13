// /api/wiki —— 公司 Wiki 知识层
// 原始资料仍留在 RAG 文件库；这里存放经人工确认、可维护、带版本和适用边界的知识页面。
// 只有发布动作才把页面同步到向量库，草稿永远不会进入报告生成链路。
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

const KINDS = ["policy", "report", "rule", "case"];
const KIND_LABEL = { policy:"政策要点", report:"报告编制", rule:"业务口径与规则依据", case:"案例经验" };
let wikiSchemaReady = false;
let wikiExactSchemaReady = false;

// 新版代码先于数据库结构上线时，Wiki 首次访问可自行补齐表；正式云端仍保留 migrations/ 脚本供发布流程执行。
async function ensureWikiSchema(env){
  if(wikiSchemaReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS wiki_pages (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'report', status TEXT NOT NULL DEFAULT 'draft', content TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', region TEXT DEFAULT '', project_type TEXT DEFAULT '', doc_no TEXT DEFAULT '', issuer TEXT DEFAULT '', source_ref TEXT DEFAULT '', security INTEGER NOT NULL DEFAULT 1, dept_scope TEXT DEFAULT '全部门', effective_date TEXT DEFAULT '', expiry_date TEXT DEFAULT '', version INTEGER NOT NULL DEFAULT 0, vector_ids TEXT NOT NULL DEFAULT '[]', created_by INTEGER, created_name TEXT DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, published_at INTEGER)").run();
  // Cloudflare D1 的 INTEGER 可容纳 JS 毫秒时间戳；本地 PostgreSQL 的 INTEGER 不行。
  // 兼容最早自动创建的本地表，启动时无损扩为 BIGINT，避免保存草稿时报“超出 integer 范围”。
  if(env.DEPLOY_MODE === "local"){
    await env.DB.prepare("ALTER TABLE wiki_pages ALTER COLUMN created_at TYPE BIGINT").run();
    await env.DB.prepare("ALTER TABLE wiki_pages ALTER COLUMN updated_at TYPE BIGINT").run();
    await env.DB.prepare("ALTER TABLE wiki_pages ALTER COLUMN published_at TYPE BIGINT").run();
  }
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_wiki_pages_status_updated ON wiki_pages(status, updated_at DESC)").run();
  wikiSchemaReady = true;
}

// Wiki 与“文件上传”共用同一张精确检索索引表。这样政策 Wiki 发布后，
// 也能直接响应“文号＋第X条”，不必再重复上传一份附件。
async function ensureWikiExactSchema(env){
  if(wikiExactSchemaReady) return;
  const tsType = env.DEPLOY_MODE === "local" ? "BIGINT" : "INTEGER";
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS rag_text_chunks (id TEXT PRIMARY KEY,title TEXT NOT NULL,chapter TEXT DEFAULT '',section TEXT DEFAULT '',text TEXT NOT NULL,category TEXT DEFAULT '',doc_no TEXT DEFAULT '',issuer TEXT DEFAULT '',source_ref TEXT DEFAULT '',created_at "+tsType+" NOT NULL)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_rag_text_chunks_doc_no ON rag_text_chunks(doc_no)").run();
  wikiExactSchemaReady = true;
}

function isAdmin(env, user){
  const admins = (env.ADMIN_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return admins.includes(user.username) || admins.includes(String(user.userId));
}
function passOk(env, request){ return !env.ADMIN_PASS || request.headers.get("x-admin-pass") === env.ADMIN_PASS; }
function clean(v, max){ return String(v==null ? "" : v).trim().slice(0, max); }
function date(v){ v=clean(v,10); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ""; }
function pageId(){
  const a = new Uint32Array(1); crypto.getRandomValues(a);
  return "w"+Date.now().toString(36)+a[0].toString(36).slice(0,5);
}
function sourcePrefix(p){ return "【Wiki】"+p.id+"｜"; }
function sourceTitle(p){ return (sourcePrefix(p)+p.title).slice(0,80); }
function safeJson(s, fallback){ try{ const v=JSON.parse(s); return v==null ? fallback : v; }catch(e){ return fallback; } }
function tagsOf(v){
  const a = Array.isArray(v) ? v : String(v||"").split(/[,，、\n]/);
  return [...new Set(a.map(x=>clean(x,24)).filter(Boolean))].slice(0,12);
}
function splitText(text, size=900, overlap=100){
  const out=[]; let i=0; text=String(text||"").trim();
  while(i<text.length){
    let end=Math.min(i+size,text.length);
    if(end<text.length){ for(let j=end;j>i+Math.floor(size*.55);j--){ if("。！？；\n".includes(text[j])){ end=j+1; break; } } }
    const part=text.slice(i,end).trim(); if(part) out.push(part);
    if(end>=text.length) break; i=Math.max(end-overlap,i+1);
  }
  return out.slice(0,60);
}
function toPage(row){
  if(!row) return null;
  return Object.assign({},row,{ tags:safeJson(row.tags,[]), vector_ids:safeJson(row.vector_ids,[]) });
}
async function embed(env,texts){ const r=await env.AI.run("@cf/baai/bge-m3",{text:texts}); return r.data; }

async function writeRagLedger(env, title, ids, p, enabled){
  const exists=await env.DB.prepare("SELECT title FROM rag_files_v2 WHERE title=?").bind(title).first();
  const level=(p.kind==="policy" || p.kind==="rule") ? 1 : 2;
  const args=[JSON.stringify(ids),ids.length,"业务逻辑",level,enabled?1:0,p.security,p.dept_scope,p.effective_date,p.expiry_date,Date.now(),title];
  if(exists){
    await env.DB.prepare("UPDATE rag_files_v2 SET ids=?, chunks=?, category=?, level=?, enabled=?, security=?, dept_scope=?, effective_date=?, expiry_date=?, updated_at=? WHERE title=?").bind(...args).run();
  }else{
    await env.DB.prepare("INSERT INTO rag_files_v2(title,ids,chunks,category,level,enabled,security,dept_scope,effective_date,expiry_date,content_hash,version,updated_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?, '',1,?,?)")
      .bind(title,JSON.stringify(ids),ids.length,"业务逻辑",level,enabled?1:0,p.security,p.dept_scope,p.effective_date,p.expiry_date,Date.now(),Date.now()).run();
  }
}

export async function onRequestPost(context){
  const {request}=context; const env=adaptEnv(context.env);
  const user=await verifyAuth(request,env);
  if(!user) return json({ok:false,error:"未登录"},401);
  try{ await ensureWikiSchema(env); }catch(e){ return json({ok:false,error:"Wiki 数据表初始化失败："+e.message},500); }
  let body; try{ body=await request.json(); }catch(e){ return json({ok:false,error:"格式有误"},400); }
  const action=clean(body.action,32);

  // 前台知识中心只展示已经发布、低密级且面向全部门的页面；草稿、归档页绝不外露。
  if(action==="publicList"){
    const rows=await env.DB.prepare("SELECT id,title,kind,content,tags,region,project_type,doc_no,issuer,source_ref,effective_date,expiry_date,version,published_at FROM wiki_pages WHERE status='published' AND security=1 AND (dept_scope='' OR dept_scope='全部门') ORDER BY published_at DESC LIMIT 200").all();
    return json({ok:true,pages:(rows.results||[]).map(toPage)});
  }
  if(!isAdmin(env,user)) return json({ok:false,error:"仅管理员可管理 Wiki"},403);

  if(action==="list"){
    const rows=await env.DB.prepare("SELECT id,title,kind,status,tags,region,project_type,doc_no,issuer,source_ref,security,dept_scope,effective_date,expiry_date,version,created_name,created_at,updated_at,published_at FROM wiki_pages ORDER BY updated_at DESC LIMIT 300").all();
    return json({ok:true,pages:(rows.results||[]).map(toPage)});
  }
  if(action==="get"){
    const id=clean(body.id,40); const row=await env.DB.prepare("SELECT * FROM wiki_pages WHERE id=?").bind(id).first();
    return row ? json({ok:true,page:toPage(row)}) : json({ok:false,error:"页面不存在"},404);
  }
  if(!passOk(env,request)) return json({ok:false,error:"管理员密码校验失败，请重新进入后台"},403);

  if(action==="save"){
    const now=Date.now(), id=clean(body.page&&body.page.id,40)||pageId(), old=await env.DB.prepare("SELECT * FROM wiki_pages WHERE id=?").bind(id).first();
    const inPage=body.page||{}; const title=clean(inPage.title,80), content=clean(inPage.content,30000);
    if(!title) return json({ok:false,error:"请填写 Wiki 标题"},400);
    if(!content) return json({ok:false,error:"请填写 Wiki 正文"},400);
    const kind=KINDS.includes(inPage.kind)?inPage.kind:"report", tags=tagsOf(inPage.tags);
    const eff=date(inPage.effective_date), exp=date(inPage.expiry_date);
    if(eff&&exp&&eff>exp) return json({ok:false,error:"生效日期不能晚于失效日期"},400);
    const p={id,title,kind,content,tags:JSON.stringify(tags),region:clean(inPage.region,40),project_type:clean(inPage.project_type,40),doc_no:clean(inPage.doc_no,80),issuer:clean(inPage.issuer,60),source_ref:clean(inPage.source_ref,240),security:Math.min(3,Math.max(1,parseInt(inPage.security)||1)),dept_scope:clean(inPage.dept_scope,40)||"全部门",effective_date:eff,expiry_date:exp};
    if(!p.source_ref) return json({ok:false,error:"请填写原始依据（文件名及条款或页码）"},400);
    if(old){
      // 编辑已发布页会自动进入草稿态；线上 RAG 继续保留上一版，直到再次点击“发布”。
      await env.DB.prepare("UPDATE wiki_pages SET title=?,kind=?,status='draft',content=?,tags=?,region=?,project_type=?,doc_no=?,issuer=?,source_ref=?,security=?,dept_scope=?,effective_date=?,expiry_date=?,updated_at=? WHERE id=?")
        .bind(p.title,p.kind,p.content,p.tags,p.region,p.project_type,p.doc_no,p.issuer,p.source_ref,p.security,p.dept_scope,p.effective_date,p.expiry_date,now,id).run();
    }else{
      await env.DB.prepare("INSERT INTO wiki_pages(id,title,kind,status,content,tags,region,project_type,doc_no,issuer,source_ref,security,dept_scope,effective_date,expiry_date,version,vector_ids,created_by,created_name,created_at,updated_at) VALUES(?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?, '[]',?,?,?,?)")
        .bind(id,p.title,p.kind,p.content,p.tags,p.region,p.project_type,p.doc_no,p.issuer,p.source_ref,p.security,p.dept_scope,p.effective_date,p.expiry_date,0,user.userId,user.username,now,now).run();
    }
    const saved=await env.DB.prepare("SELECT * FROM wiki_pages WHERE id=?").bind(id).first();
    return json({ok:true,page:toPage(saved),message:old&&old.status==="published"?"已保存为新草稿，当前发布版本仍在生效":"草稿已保存"});
  }

  const id=clean(body.id,40); const row=await env.DB.prepare("SELECT * FROM wiki_pages WHERE id=?").bind(id).first();
  if(!row) return json({ok:false,error:"页面不存在"},404);
  const p=toPage(row), title=sourceTitle(p);

  if(action==="publish"){
    if(!env.VECTORIZE || !env.AI) return json({ok:false,error:"未绑定向量库或 AI，无法发布到 RAG"},500);
    if(p.content.length<60) return json({ok:false,error:"Wiki 正文至少应有 60 个字，避免形成无效知识页"},400);
    const oldIds=p.vector_ids||[];
    if(oldIds.length) try{ await env.VECTORIZE.deleteByIds(oldIds); }catch(e){}
    // 标题可以改，但旧版向量台账必须一并清掉/停用，不能留下一个“看似有效”的旧标题。
    try{ await env.DB.prepare("DELETE FROM rag_files_v2 WHERE title LIKE ?").bind(sourcePrefix(p)+"%").run(); }catch(e){}
    try{ await ensureWikiExactSchema(env); await env.DB.prepare("DELETE FROM rag_text_chunks WHERE title LIKE ?").bind(sourcePrefix(p)+"%").run(); }catch(e){}
    const meta=["【公司 Wiki（已审核发布）】", "类型："+(KIND_LABEL[p.kind]||p.kind), p.doc_no?"文号："+p.doc_no:"", p.issuer?"发布/确认主体："+p.issuer:"", p.region?"适用区域："+p.region:"", p.project_type?"适用项目："+p.project_type:"", p.source_ref?"原始依据："+p.source_ref:"", "标签："+(p.tags||[]).join("、")].filter(Boolean).join("\n");
    const parts=splitText(p.content); const vecs=await embed(env,parts.map(x=>meta+"\n\n"+x)); const now=Date.now();
    const ids=parts.map((x,i)=>"wiki_"+p.id+"_"+now+"_"+i);
    const category=(p.kind==="policy"||p.kind==="rule")?"政策文件":"业务逻辑";
    await env.VECTORIZE.upsert(parts.map((x,i)=>({id:ids[i],values:vecs[i],metadata:{title,chapter:"Wiki · "+(KIND_LABEL[p.kind]||p.kind),section:p.source_ref||p.doc_no||"已审核知识页",category,level:(p.kind==="policy"||p.kind==="rule")?1:2,docNo:p.doc_no||"",issuer:p.issuer||"",sourceRef:p.source_ref||"",text:meta+"\n\n"+x}})));
    try{
      for(let i=0;i<ids.length;i++) await env.DB.prepare("INSERT INTO rag_text_chunks(id,title,chapter,section,text,category,doc_no,issuer,source_ref,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(ids[i],title,"Wiki · "+(KIND_LABEL[p.kind]||p.kind),p.source_ref||p.doc_no||"已审核知识页",meta+"\n\n"+parts[i],category,p.doc_no||"",p.issuer||"",p.source_ref||"",now).run();
    }catch(e){}
    await writeRagLedger(env,title,ids,p,true);
    await env.DB.prepare("UPDATE wiki_pages SET status='published',vector_ids=?,version=version+1,updated_at=?,published_at=? WHERE id=?").bind(JSON.stringify(ids),now,now,p.id).run();
    return json({ok:true,message:"已发布并同步到 RAG",chunks:ids.length});
  }
  if(action==="archive"){
    await env.DB.prepare("UPDATE wiki_pages SET status='archived',updated_at=? WHERE id=?").bind(Date.now(),p.id).run();
    await env.DB.prepare("UPDATE rag_files_v2 SET enabled=0 WHERE title LIKE ?").bind(sourcePrefix(p)+"%").run();
    return json({ok:true,message:"已归档，页面不再参与检索"});
  }
  if(action==="delete"){
    if((p.vector_ids||[]).length) try{ await env.VECTORIZE.deleteByIds(p.vector_ids); }catch(e){}
    await env.DB.prepare("DELETE FROM rag_files_v2 WHERE title LIKE ?").bind(sourcePrefix(p)+"%").run();
    try{ await ensureWikiExactSchema(env); await env.DB.prepare("DELETE FROM rag_text_chunks WHERE title LIKE ?").bind(sourcePrefix(p)+"%").run(); }catch(e){}
    await env.DB.prepare("DELETE FROM wiki_pages WHERE id=?").bind(p.id).run();
    return json({ok:true,message:"Wiki 页面及其检索索引已删除"});
  }
  return json({ok:false,error:"未知操作"},400);
}
