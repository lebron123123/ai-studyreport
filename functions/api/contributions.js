// /api/contributions  前台知识协作投稿 + 后台审核分流
// 投稿提交后不可原地修改；退回后只能复制形成新提交，避免审核对象被静默替换。
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";

const KINDS = ["material","wiki","rule","example","correction"];
const STATUSES = ["pending","needs_changes","approved","rejected"];
let schemaReady = false;

function isAdmin(env,user){
  const admins=(env.ADMIN_USERS||"").split(",").map(x=>x.trim()).filter(Boolean);
  return admins.includes(user.username)||admins.includes(String(user.userId));
}
function passOk(env,request){ return !env.ADMIN_PASS || request.headers.get("x-admin-pass")===env.ADMIN_PASS; }
function clean(v,n=240){ return String(v==null?"":v).trim().slice(0,n); }
function makeId(prefix="con_"){ const a=new Uint32Array(1);crypto.getRandomValues(a);return prefix+Date.now().toString(36)+a[0].toString(36).slice(0,6); }
function safeJson(s,fallback){try{return JSON.parse(s||"");}catch(e){return fallback;}}
function out(row){return row?{...row,meta:safeJson(row.meta,{}),created_at:Number(row.created_at||0),reviewed_at:Number(row.reviewed_at||0)}:null;}

async function ensureSchema(env){
  if(schemaReady)return;
  const ts=env.DEPLOY_MODE==="local"?"BIGINT":"INTEGER";
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS knowledge_contributions (id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',source_ref TEXT DEFAULT '',file_name TEXT DEFAULT '',region TEXT DEFAULT '',project_type TEXT DEFAULT '',meta TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'pending',review_note TEXT DEFAULT '',target_module TEXT DEFAULT '',target_ref TEXT DEFAULT '',parent_id TEXT DEFAULT '',user_id INTEGER NOT NULL,username TEXT DEFAULT '',created_at "+ts+" NOT NULL,reviewed_at "+ts+",reviewed_by TEXT DEFAULT '')").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_knowledge_contributions_status ON knowledge_contributions(status,created_at DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_knowledge_contributions_user ON knowledge_contributions(user_id,created_at DESC)").run();
  schemaReady=true;
}

async function routeApproved(env,row,user){
  const now=Date.now(), meta=safeJson(row.meta,{});
  if(row.kind==="wiki"){
    const id=makeId("w"), kind=["policy","report","rule","case"].includes(meta.wikiKind)?meta.wikiKind:"report";
    await env.DB.prepare("INSERT INTO wiki_pages(id,title,kind,status,content,tags,region,project_type,doc_no,issuer,source_ref,security,dept_scope,effective_date,expiry_date,version,vector_ids,created_by,created_name,created_at,updated_at) VALUES(?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?, '[]',?,?,?,?)")
      .bind(id,row.title,kind,row.content,JSON.stringify(meta.tags||[]),row.region,row.project_type,clean(meta.docNo,80),clean(meta.issuer,60),row.source_ref,Math.min(3,Math.max(1,Number(meta.security)||1)),clean(meta.deptScope,40)||"全部门",clean(meta.effectiveDate,10),clean(meta.expiryDate,10),0,user.userId,user.username,now,now).run();
    return {module:"知识 Wiki（待发布草稿）",ref:id};
  }
  if(row.kind==="material"){
    const id=makeId("asset_");
    await env.DB.prepare("INSERT INTO source_assets(id,title,document_type,category,lifecycle,effect_status,doc_no,issuer,issue_date,effective_date,expiry_date,project_no,project_type,region,source_ref,version_no,content_hash,rag_title,note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id,row.title,clean(meta.documentType,30)||"other",clean(meta.category,30),"active",clean(meta.effectStatus,20)||"unknown",clean(meta.docNo,80),clean(meta.issuer,60),clean(meta.issueDate,10),clean(meta.effectiveDate,10),clean(meta.expiryDate,10),clean(meta.projectNo,60),row.project_type,row.region,row.source_ref,clean(meta.versionNo,30),clean(meta.contentHash,64),"",clean(meta.note,1000)||"由前台投稿审核通过；尚未发布到RAG",user.userId,now,now).run();
    if(row.content) await env.DB.prepare("INSERT INTO source_asset_versions(id,asset_id,version_no,content_hash,content_text,effect_status,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(makeId("aver_"),id,clean(meta.versionNo,30)||"v1",clean(meta.contentHash,64),row.content,clean(meta.effectStatus,20)||"unknown",now).run();
    return {module:"正式资料台账（待RAG发布）",ref:id};
  }
  if(row.kind==="rule" || row.kind==="example"){
    const key=row.kind==="rule"?"calc_airules":"calc_examples", old=await env.DB.prepare("SELECT data FROM configs WHERE key=?").bind(key).first();
    const list=old?safeJson(old.data,[]):[];
    if(row.kind==="rule") list.push({id:makeId("AR-"),match:clean(meta.match,200)||row.title,rule:row.content,reason:clean(meta.reason,1000),evidenceRefs:[]});
    else list.push({match:clean(meta.match,200)||row.title,title:row.title,content:row.content});
    if(old) await env.DB.prepare("UPDATE configs SET data=?,updated_at=? WHERE key=?").bind(JSON.stringify(list),now,key).run();
    else await env.DB.prepare("INSERT INTO configs(key,data,updated_at) VALUES(?,?,?)").bind(key,JSON.stringify(list),now).run();
    return {module:row.kind==="rule"?"AI可研审核规则":"黄金范例库",ref:String(list.length-1)};
  }
  return {module:"治理改进待办",ref:row.id};
}

export async function onRequestPost(context){
  const {request}=context,env=adaptEnv(context.env),user=await verifyAuth(request,adaptEnv(context.env));
  if(!user)return json({ok:false,error:"未登录"},401);
  try{await ensureSchema(env);}catch(e){return json({ok:false,error:"协作台账初始化失败："+e.message},500);}
  let body;try{body=await request.json();}catch(e){return json({ok:false,error:"请求格式有误"},400);}
  const action=clean(body.action,24)||"listMine";

  if(action==="listMine"){
    const rows=await env.DB.prepare("SELECT * FROM knowledge_contributions WHERE user_id=? ORDER BY created_at DESC LIMIT 200").bind(user.userId).all();
    return json({ok:true,items:(rows.results||[]).map(out)});
  }
  if(action==="listReview"){
    if(!isAdmin(env,user)||!passOk(env,request))return json({ok:false,error:"仅管理员可查看审核队列"},403);
    const status=STATUSES.includes(body.status)?body.status:"pending";
    const rows=await env.DB.prepare("SELECT * FROM knowledge_contributions WHERE status=? ORDER BY created_at ASC LIMIT 300").bind(status).all();
    return json({ok:true,items:(rows.results||[]).map(out)});
  }
  if(action==="submit"){
    const p=body.item||{},kind=KINDS.includes(p.kind)?p.kind:"correction",title=clean(p.title,120),content=clean(p.content,200000),sourceRef=clean(p.source_ref,500),fileName=clean(p.file_name,180),parentId=clean(p.parent_id,50),itemMeta=p.meta&&typeof p.meta==="object"?p.meta:{},idempotencyKey=clean(itemMeta.idempotencyKey,120);
    if(!title)return json({ok:false,error:"请填写标题"},400);
    if(!content)return json({ok:false,error:"请填写说明或上传可解析文件"},400);
    if(kind!=="correction"&&!sourceRef)return json({ok:false,error:"请填写原始依据或来源位置"},400);
    if(parentId){const old=await env.DB.prepare("SELECT user_id,status FROM knowledge_contributions WHERE id=?").bind(parentId).first();if(!old||old.user_id!==user.userId||!["needs_changes","rejected"].includes(old.status))return json({ok:false,error:"只有本人被退回或驳回的提交可重新提交"},400);}
    if(idempotencyKey){const existing=await env.DB.prepare("SELECT id,status,target_module,target_ref FROM knowledge_contributions WHERE user_id=? AND kind=? AND source_ref=? AND status IN ('pending','approved') ORDER BY created_at DESC LIMIT 1").bind(user.userId,kind,sourceRef).first();if(existing)return json({ok:true,id:existing.id,status:existing.status,target_module:existing.target_module||"",target_ref:existing.target_ref||"",existing:true,message:"该联网依据已在知识库审核链路中，无需重复提交"});}
    const id=makeId(),now=Date.now(),meta=JSON.stringify(itemMeta);
    await env.DB.prepare("INSERT INTO knowledge_contributions(id,kind,title,content,source_ref,file_name,region,project_type,meta,status,parent_id,user_id,username,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)")
      .bind(id,kind,title,content,sourceRef,fileName,clean(p.region,40),clean(p.project_type,40),meta,parentId,user.userId,user.username,now).run();
    return json({ok:true,id,status:"pending",message:"已提交管理员审核；审核前不会进入正式知识库"});
  }
  if(action==="review"){
    if(!isAdmin(env,user)||!passOk(env,request))return json({ok:false,error:"仅管理员可审核"},403);
    const id=clean(body.id,50),decision=clean(body.decision,20),note=clean(body.note,1200),row=await env.DB.prepare("SELECT * FROM knowledge_contributions WHERE id=?").bind(id).first();
    if(!row)return json({ok:false,error:"提交不存在"},404);
    if(row.status!=="pending")return json({ok:false,error:"该提交已处理，不能重复审核"},409);
    if(decision==="return"&&!note)return json({ok:false,error:"退回时请填写修改意见"},400);
    let status,target={module:"",ref:""};
    if(decision==="approve"){try{target=await routeApproved(env,row,user);status="approved";}catch(e){return json({ok:false,error:"分流到正式模块失败："+e.message},500);}}
    else if(decision==="return")status="needs_changes";
    else if(decision==="reject")status="rejected";
    else return json({ok:false,error:"未知审核动作"},400);
    await env.DB.prepare("UPDATE knowledge_contributions SET status=?,review_note=?,target_module=?,target_ref=?,reviewed_at=?,reviewed_by=? WHERE id=?")
      .bind(status,note,target.module,target.ref,Date.now(),user.username,id).run();
    return json({ok:true,status,target,message:status==="approved"?"审核通过并已分流到“"+target.module+"”":status==="needs_changes"?"已退回补充":"已驳回"});
  }
  return json({ok:false,error:"未知操作"},400);
}
