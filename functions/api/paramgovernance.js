// /api/paramgovernance —— 参数治理草稿、审核发布、证据引用与版本历史。
// 草稿永远不直接进入测算；只有 publish 会同步 calc_paramdefaults / calc_paramrules。
import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
import { governanceTrigger,recordReviewEvent,listReviewEvents,ensureReviewSchema } from "./_paramreview.js";

function isAdmin(env,user){const a=(env.ADMIN_USERS||"").split(",").map(x=>x.trim()).filter(Boolean);return a.includes(user.username)||a.includes(String(user.userId));}
function passOk(env,request){return !env.ADMIN_PASS||request.headers.get("x-admin-pass")===env.ADMIN_PASS;}
function text(v,n=300){return String(v??"").trim().slice(0,n);}
function parse(v,fallback){try{return JSON.parse(v||"");}catch(e){return fallback;}}
function validType(v){v=String(v||"");return ["rent","sale","gaibao","coeff_rent","coeff_sale","coeff_gaibao","coeff_invest"].includes(v)?v:"";}
function cleanRefs(v){return (Array.isArray(v)?v:[]).slice(0,8).map(x=>({id:text(x&&x.id,180),type:text(x&&x.type,20),label:text(x&&x.label,180),version:text(x&&x.version,40),sourceRef:text(x&&x.sourceRef,300),effectiveDate:text(x&&x.effectiveDate,10),expiryDate:text(x&&x.expiryDate,10)})).filter(x=>x.id&&x.label);}
export function cleanRow(r){
  const out={key:text(r&&r.key,80),label:text(r&&r.label,120),unit:text(r&&r.unit,40),role:text(r&&r.role,40),sourcePolicy:text(r&&r.sourcePolicy,40),volatility:text(r&&r.volatility,40),confirmation:text(r&&r.confirmation,30),impactLevel:text(r&&r.impactLevel,20),
    hasExpertOverride:!!(r&&r.hasExpertOverride),expertValue:r&&r.hasExpertOverride?r.expertValue:null,ruleValue:Number.isFinite(r&&r.ruleValue)?r.ruleValue:null,min:Number.isFinite(r&&r.min)?r.min:null,max:Number.isFinite(r&&r.max)?r.max:null,
    region:text(r&&r.region,80),projectType:text(r&&r.projectType,80),basis:text(r&&r.basis,1000),evidenceRefs:cleanRefs(r&&r.evidenceRefs),effectiveDate:text(r&&r.effectiveDate,10),expiryDate:text(r&&r.expiryDate,10),enabled:!!(r&&r.enabled),manualRequired:!!(r&&r.manualRequired),input:r&&r.input!==false,derived:!!(r&&r.derived)};
  if(Array.isArray(out.expertValue)) out.expertValue=out.expertValue.slice(0,30).map(Number).filter(Number.isFinite);
  else if(typeof out.expertValue==="string") out.expertValue=text(out.expertValue,1000);
  else if(typeof out.expertValue==="number"&&!Number.isFinite(out.expertValue)) out.expertValue=null;
  return out;
}
let schemaReady=false;
async function ensureSchema(env){
  if(schemaReady)return; const ts=env.DEPLOY_MODE==="local"?"BIGINT":"INTEGER";
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS param_governance (calc_type TEXT NOT NULL,param_key TEXT NOT NULL,draft_data TEXT NOT NULL DEFAULT '{}',published_data TEXT NOT NULL DEFAULT '{}',draft_version INTEGER NOT NULL DEFAULT 1,published_version INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'draft',updated_by TEXT DEFAULT '',updated_at "+ts+" NOT NULL,published_by TEXT DEFAULT '',published_at "+ts+" DEFAULT 0,PRIMARY KEY(calc_type,param_key))").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_param_governance_type_status ON param_governance(calc_type,status,updated_at DESC)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS param_governance_history (id TEXT PRIMARY KEY,calc_type TEXT NOT NULL,param_key TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,change_summary TEXT DEFAULT '',published_by TEXT DEFAULT '',published_at "+ts+" NOT NULL)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_param_governance_history ON param_governance_history(calc_type,param_key,version DESC)").run(); schemaReady=true;
}
async function getConfig(env,key,fallback={}){const r=await env.DB.prepare("SELECT data FROM configs WHERE key=?").bind(key).first();return r?parse(r.data,fallback):fallback;}
async function setConfig(env,key,data){const s=JSON.stringify(data),now=Date.now(),old=await env.DB.prepare("SELECT key FROM configs WHERE key=?").bind(key).first();if(old)await env.DB.prepare("UPDATE configs SET data=?,updated_at=? WHERE key=?").bind(s,now,key).run();else await env.DB.prepare("INSERT INTO configs(key,data,updated_at) VALUES(?,?,?)").bind(key,s,now).run();}
function ref(type,id,label,version="",sourceRef="",effectiveDate="",expiryDate=""){return{type,id:type+":"+id,label,version,sourceRef,effectiveDate,expiryDate};}
async function evidenceOptions(env){
  const out=[];
  try{const r=await env.DB.prepare("SELECT id,title,doc_no,version_no,source_ref,effective_date,expiry_date,effect_status FROM source_assets WHERE lifecycle='active' ORDER BY updated_at DESC LIMIT 200").all();for(const x of r.results||[])out.push(ref("asset",x.id,"正式资料｜"+x.title+(x.doc_no?"｜"+x.doc_no:""),x.version_no,x.source_ref,x.effective_date,x.expiry_date));}catch(e){}
  try{const r=await env.DB.prepare("SELECT id,title,version,source_ref,effective_date,expiry_date FROM wiki_pages WHERE status='published' ORDER BY updated_at DESC LIMIT 150").all();for(const x of r.results||[])out.push(ref("wiki",x.id,"Wiki｜"+x.title,"v"+(x.version||0),x.source_ref,x.effective_date,x.expiry_date));}catch(e){}
  try{const r=await env.DB.prepare("SELECT m.id,m.field_label,m.workbook_id,m.sheet_name,m.cell_address,w.title,a.source_ref FROM excel_field_mappings m JOIN excel_workbooks w ON w.id=m.workbook_id LEFT JOIN source_assets a ON a.id=w.asset_id WHERE m.enabled=1 ORDER BY m.updated_at DESC LIMIT 200").all();for(const x of r.results||[])out.push(ref("excel",x.id,"Excel｜《"+x.title+"》→"+x.sheet_name+"!"+x.cell_address+(x.field_label?"｜"+x.field_label:""),"",x.source_ref));}catch(e){}
  try{const r=await env.DB.prepare("SELECT id,title,section,source_ref FROM rag_text_chunks ORDER BY created_at DESC LIMIT 120").all();for(const x of r.results||[])out.push(ref("rag",x.id,"RAG条款｜"+x.title+(x.section?"→"+x.section:""),"",x.source_ref));}catch(e){}
  return out;
}
export function changedFields(a,b){const keys=["hasExpertOverride","expertValue","ruleValue","min","max","impactLevel","role","sourcePolicy","volatility","confirmation","region","projectType","basis","effectiveDate","expiryDate","enabled","manualRequired","evidenceRefs","input","derived"];return keys.filter(k=>JSON.stringify((a&&a[k])??null)!==JSON.stringify((b&&b[k])??null));}
function historyId(type,key,version){return "pgh_"+type+"_"+key+"_"+version+"_"+Date.now();}
export function projectPublishedConfigs(type,records,now=Date.now(),username="管理员"){
  const live=(records||[]).map(x=>({record:x,data:x.status==="draft"?parse(x.draft_data,{}):parse(x.published_data,{})})).filter(x=>x.data.key&&!x.data.derived&&x.data.input!==false);
  if(type.startsWith("coeff_")){const config={};for(const {data:d} of live)if(d.hasExpertOverride)config[d.key]=d.expertValue;return{kind:"coeff",target:type.slice(6),config};}
  const defaults={},rules=[];for(const {record:x,data:d} of live){if(d.hasExpertOverride)defaults[d.key]=d.expertValue;if(d.ruleValue!==null||d.min!==null||d.max!==null||d.basis||d.evidenceRefs&&d.evidenceRefs.length||d.enabled)rules.push({key:d.key,label:d.label,value:d.ruleValue,min:d.min,max:d.max,region:d.region,projectType:d.projectType,basis:d.basis,evidenceRefs:d.evidenceRefs,effectiveDate:d.effectiveDate,expiryDate:d.expiryDate,enabled:d.enabled,manualRequired:d.manualRequired,role:d.role,sourcePolicy:d.sourcePolicy,volatility:d.volatility,confirmation:d.confirmation,impactLevel:d.impactLevel,version:(Number(x.published_version)||0)+(x.status==="draft"?1:0),updatedAt:now,updatedBy:username});}return{kind:"input",defaults,rules};
}

export async function onRequestGet(context){
  const {request}=context,env=adaptEnv(context.env),user=await verifyAuth(request,adaptEnv(context.env));if(!user)return json({ok:false,error:"未登录"},401);
  try{await ensureSchema(env);}catch(e){return json({ok:false,error:"参数治理表初始化失败："+e.message},500);}
  const u=new URL(request.url),type=validType(u.searchParams.get("type"));
  if(!type)return json({ok:false,error:"测算类型不合法"},400);
  const rows=await env.DB.prepare("SELECT * FROM param_governance WHERE calc_type=? ORDER BY param_key").bind(type).all();
  let refs=[];if(u.searchParams.get("evidence")!=="0")refs=await evidenceOptions(env);
  let history=[];if(u.searchParams.get("history")==="1"){const h=await env.DB.prepare("SELECT id,param_key,version,change_summary,published_by,published_at FROM param_governance_history WHERE calc_type=? ORDER BY published_at DESC LIMIT 150").bind(type).all();history=h.results||[];}
  const reviewEvents=await listReviewEvents(env,type);
  return json({ok:true,rows:(rows.results||[]).map(x=>({...x,draft:parse(x.draft_data,{}),published:parse(x.published_data,{})})),references:refs,history,reviewEvents});
}

export async function onRequestPost(context){
  const {request}=context,env=adaptEnv(context.env),user=await verifyAuth(request,adaptEnv(context.env));if(!user)return json({ok:false,error:"未登录"},401);if(!isAdmin(env,user)||!passOk(env,request))return json({ok:false,error:"仅管理员可维护参数治理版本"},403);
  try{await ensureSchema(env);}catch(e){return json({ok:false,error:"参数治理表初始化失败："+e.message},500);}let body;try{body=await request.json();}catch(e){return json({ok:false,error:"格式有误"},400);}
  const action=text(body.action,30),type=validType(body.calcType);if(!type)return json({ok:false,error:"测算类型不合法"},400);const now=Date.now();
  if(action==="saveDraft"){
    const rows=(Array.isArray(body.rows)?body.rows:[]).slice(0,160).map(cleanRow).filter(x=>x.key);if(!rows.length)return json({ok:false,error:"没有可保存参数"},400);let changed=0;
    for(const row of rows){if(row.effectiveDate&&row.expiryDate&&row.effectiveDate>row.expiryDate)return json({ok:false,error:row.label+"：生效日期不能晚于失效日期"},400);if(row.min!==null&&row.max!==null&&row.min>row.max)return json({ok:false,error:row.label+"：下限不能大于上限"},400);
      const old=await env.DB.prepare("SELECT * FROM param_governance WHERE calc_type=? AND param_key=?").bind(type,row.key).first(),oldDraft=old?parse(old.draft_data,{}):{},oldPublished=old?parse(old.published_data,{}):{},base=old?(old.status==="draft"?oldDraft:oldPublished):{},isChanged=JSON.stringify(base)!==JSON.stringify(row),status=!isChanged&&old&&old.status==="published"?"published":"draft";if(isChanged)changed++;
      if(old)await env.DB.prepare("UPDATE param_governance SET draft_data=?,draft_version=?,status=?,updated_by=?,updated_at=? WHERE calc_type=? AND param_key=?").bind(JSON.stringify(row),status==="published"?(Number(old.published_version)||0):Math.max(Number(old.draft_version)||1,(Number(old.published_version)||0)+1),status,user.username,now,type,row.key).run();
      else await env.DB.prepare("INSERT INTO param_governance(calc_type,param_key,draft_data,published_data,draft_version,published_version,status,updated_by,updated_at,published_by,published_at) VALUES(?,?,?,'{}',1,0,'draft',?,?, '',0)").bind(type,row.key,JSON.stringify(row),user.username,now).run();
    }
    return json({ok:true,message:"草稿已保存，尚未影响正式测算",changed});
  }
  if(action==="publish"){
    const q=await env.DB.prepare("SELECT * FROM param_governance WHERE calc_type=? AND status='draft' ORDER BY param_key").bind(type).all(),rows=q.results||[];if(!rows.length)return json({ok:false,error:"没有待发布草稿"},400);
    const changes=[];for(const x of rows){const d=parse(x.draft_data,{}),p=parse(x.published_data,{}),fields=changedFields(p,d);if(fields.length)changes.push({key:x.param_key,label:d.label||x.param_key,impactLevel:d.impactLevel||"未分析",fields});}
    const all=await env.DB.prepare("SELECT * FROM param_governance WHERE calc_type=? ORDER BY param_key").bind(type).all();
    const projected=projectPublishedConfigs(type,all.results||[],now,user.username);
    if(projected.kind==="coeff"){
      await setConfig(env,"calc_"+projected.target,projected.config);
    }else{
      const defaults=await getConfig(env,"calc_paramdefaults",{}),rules=await getConfig(env,"calc_paramrules",{});defaults[type]=projected.defaults;rules[type]=projected.rules;await setConfig(env,"calc_paramdefaults",defaults);await setConfig(env,"calc_paramrules",rules);
    }
    for(const x of rows){const d=parse(x.draft_data,{}),ver=(Number(x.published_version)||0)+1,fields=changedFields(parse(x.published_data,{}),d);await env.DB.prepare("UPDATE param_governance SET published_data=?,published_version=?,draft_version=?,status='published',published_by=?,published_at=?,updated_at=? WHERE calc_type=? AND param_key=?").bind(JSON.stringify(d),ver,ver,user.username,now,now,type,x.param_key).run();await env.DB.prepare("INSERT INTO param_governance_history(id,calc_type,param_key,version,data,change_summary,published_by,published_at) VALUES(?,?,?,?,?,?,?,?)").bind(historyId(type,x.param_key,ver),type,x.param_key,ver,JSON.stringify(d),fields.join("、"),user.username,now).run();}
    const reviewEventId=await recordReviewEvent(env,governanceTrigger(type,changes),user.username);
    return json({ok:true,message:"已审核发布，正式测算将在下次加载时生效",published:rows.length,changes,reviewEventId});
  }
  if(action==="ackReview"){
    const id=text(body.id,120);if(!id)return json({ok:false,error:"缺少重评估事件编号"},400);await ensureReviewSchema(env);await env.DB.prepare("UPDATE param_review_events SET status='acknowledged',handled_by=?,handled_at=? WHERE id=?").bind(user.username,now,id).run();return json({ok:true,message:"已确认该变更提醒；系统未自动修改参数或敏感等级"});
  }
  if(action==="restoreDraft"){
    const key=text(body.key,80),version=parseInt(body.version)||0,h=await env.DB.prepare("SELECT data FROM param_governance_history WHERE calc_type=? AND param_key=? AND version=?").bind(type,key,version).first();if(!h)return json({ok:false,error:"历史版本不存在"},404);const old=await env.DB.prepare("SELECT published_version FROM param_governance WHERE calc_type=? AND param_key=?").bind(type,key).first();await env.DB.prepare("UPDATE param_governance SET draft_data=?,draft_version=?,status='draft',updated_by=?,updated_at=? WHERE calc_type=? AND param_key=?").bind(h.data,(Number(old&&old.published_version)||0)+1,user.username,now,type,key).run();return json({ok:true,message:"历史版本已恢复为草稿，发布前不会影响正式测算"});
  }
  return json({ok:false,error:"未知操作"},400);
}
