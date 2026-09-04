import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
import { buildHousingSearchPlan, wrProviderCatalog, wrSearch, wrDeduplicate, wrCrossVerify, wrFetchDocument, wrAuthority, wrText, wrCanonicalUrl } from "./_web-research-core.js";
import "../../report-query-planner.js";

const ReportQueryPlanner=globalThis.ReportQueryPlanner;

let wrSchemaReady=false;
async function wrEnsureSchema(env){
  if(wrSchemaReady)return;const db=env.DB;
  await db.prepare("CREATE TABLE IF NOT EXISTS web_search_runs (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,project_id TEXT DEFAULT '',section_key TEXT DEFAULT '',plan_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'running',provider TEXT DEFAULT '',query_count INTEGER NOT NULL DEFAULT 0,result_count INTEGER NOT NULL DEFAULT 0,error_text TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_web_runs_user_project ON web_search_runs(user_id,project_id,updated_at)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS web_evidence (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,project_id TEXT DEFAULT '',logic_id TEXT DEFAULT '',chapter TEXT DEFAULT '',section TEXT DEFAULT '',query_text TEXT DEFAULT '',title TEXT NOT NULL,url TEXT NOT NULL,canonical_url TEXT NOT NULL,publisher TEXT DEFAULT '',published_at TEXT DEFAULT '',fetched_at TEXT DEFAULT '',source_type TEXT DEFAULT 'web',authority_level TEXT DEFAULT 'D',authority_score INTEGER NOT NULL DEFAULT 0,excerpt TEXT DEFAULT '',content_text TEXT DEFAULT '',content_hash TEXT DEFAULT '',data_period TEXT DEFAULT '',provider TEXT DEFAULT '',confidence INTEGER NOT NULL DEFAULT 0,verification_status TEXT DEFAULT 'single',status TEXT NOT NULL DEFAULT 'candidate',metadata_json TEXT NOT NULL DEFAULT '{}',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_web_evidence_project ON web_evidence(user_id,project_id,status,updated_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_web_evidence_section ON web_evidence(user_id,project_id,chapter,section)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS web_evidence_bindings (id TEXT PRIMARY KEY,evidence_id TEXT NOT NULL,user_id INTEGER NOT NULL,project_id TEXT DEFAULT '',logic_id TEXT NOT NULL,chapter TEXT DEFAULT '',section TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'approved',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,UNIQUE(evidence_id,logic_id))").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_web_evidence_bindings_project ON web_evidence_bindings(user_id,project_id,logic_id,status)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS web_provider_health (provider TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'unknown',latency_ms INTEGER NOT NULL DEFAULT 0,last_error TEXT DEFAULT '',success_count INTEGER NOT NULL DEFAULT 0,failure_count INTEGER NOT NULL DEFAULT 0,last_checked_at BIGINT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS web_search_lenses (id TEXT PRIMARY KEY,name TEXT NOT NULL,dimension TEXT DEFAULT '',domains_json TEXT NOT NULL DEFAULT '[]',housing_types_json TEXT NOT NULL DEFAULT '[]',query_suffix TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'active',version INTEGER NOT NULL DEFAULT 1,updated_by TEXT DEFAULT '',updated_at BIGINT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS data_requirement_refinements (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,project_id TEXT NOT NULL,logic_id TEXT NOT NULL,version INTEGER NOT NULL,requirement_json TEXT NOT NULL,feedback TEXT DEFAULT '',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,UNIQUE(user_id,project_id,logic_id,version))").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_requirement_refinement_latest ON data_requirement_refinements(user_id,project_id,logic_id,version DESC)").run();
  wrSchemaReady=true;
}
function wrId(prefix){return prefix+"_"+crypto.randomUUID();}
function wrAdmin(env,user){const ids=String(env.ADMIN_USERS||"").split(",").map(x=>x.trim());return ids.includes(user.username)||ids.includes(String(user.userId));}
function wrHash(value){let h=2166136261;for(const c of String(value||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
async function wrHealth(env,provider,ok,latency,error){const now=Date.now();await env.DB.prepare("INSERT INTO web_provider_health(provider,status,latency_ms,last_error,success_count,failure_count,last_checked_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET status=?,latency_ms=?,last_error=?,success_count=web_provider_health.success_count+?,failure_count=web_provider_health.failure_count+?,last_checked_at=?").bind(provider,ok?"healthy":"degraded",latency||0,error||"",ok?1:0,ok?0:1,now,ok?"healthy":"degraded",latency||0,error||"",ok?1:0,ok?0:1,now).run();}
async function wrSaveEvidence(env,user,ctx,row){
  const id=wrId("evi"),now=Date.now(),canonical=wrCanonicalUrl(row.url),authority=wrAuthority(canonical,row.publisher);
  await env.DB.prepare("INSERT INTO web_evidence(id,user_id,project_id,logic_id,chapter,section,query_text,title,url,canonical_url,publisher,published_at,fetched_at,source_type,authority_level,authority_score,excerpt,content_text,content_hash,data_period,provider,confidence,verification_status,status,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,user.userId,ctx.projectId||"",ctx.logicId||"",ctx.chapter||"",ctx.section||"",ctx.query||"",row.title||canonical,row.url,canonical,row.publisher||"",row.publishedAt||"",row.fetchedAt||"","web",row.authorityLevel||authority.level,row.authorityScore||authority.score,row.snippet||row.excerpt||"",row.contentText||"",wrHash((row.contentText||row.snippet||"")+canonical),ctx.dataPeriod||"",row.provider||"",row.confidence||authority.score,row.verificationStatus||"single","candidate",JSON.stringify({authorityReason:row.authorityReason||authority.reason,rank:row.rank||0,qualityScore:row.qualityScore||0,qualityGrade:row.qualityGrade||"D",qualityReasons:row.qualityReasons||[],meetsRequirement:!!row.meetsRequirement}),now,now).run();
  return id;
}
async function wrListEvidence(env,user,body){
  const projectId=wrText(body.projectId,120),rows=(await env.DB.prepare("SELECT * FROM web_evidence WHERE user_id=? AND project_id=? AND status<>? ORDER BY authority_score DESC,updated_at DESC LIMIT 200").bind(user.userId,projectId,"archived").all()).results||[];
  const bindings=(await env.DB.prepare("SELECT evidence_id,logic_id,chapter,section,status FROM web_evidence_bindings WHERE user_id=? AND project_id=? AND status=?").bind(user.userId,projectId,"approved").all()).results||[],byEvidence={};
  for(const binding of bindings)(byEvidence[binding.evidence_id]||(byEvidence[binding.evidence_id]=[])).push(binding);
  return rows.filter(x=>!body.chapter||x.chapter===body.chapter).filter(x=>!body.section||x.section===body.section).map(x=>{const metadata=safeJson(x.metadata_json,{});return {...x,logicIds:(byEvidence[x.id]||[]).map(y=>y.logic_id),bindings:byEvidence[x.id]||[],metadata,qualityScore:Number(metadata.qualityScore||0),qualityGrade:metadata.qualityGrade||"D",qualityReasons:metadata.qualityReasons||[],meetsRequirement:!!metadata.meetsRequirement};});
}
function safeJson(value,fallback){try{return JSON.parse(value);}catch(e){return fallback;}}
function wrNormalizeRequirement(input){
  const source=input&&typeof input==="object"?input:{},channels=["knowledge_base","provider","web_search","manual_upload","calculation_engine","derived_section"],fields=(Array.isArray(source.fields)?source.fields:[]).slice(0,20).map((field,index)=>({key:wrText(field?.key||"custom"+(index+1),50),label:wrText(field?.label||field,80),dataType:wrText(field?.dataType||"mixed",20),required:field?.required!==false})).filter(x=>x.label);
  return {fields,timeScope:{kind:wrText(source.timeScope?.kind,50),maxAgeMonths:source.timeScope?.maxAgeMonths==null?null:wrClamp(source.timeScope.maxAgeMonths,1,240,36)},geoScope:{level:wrText(source.geoScope?.level,30),value:wrText(source.geoScope?.value,100)},allowedChannels:(Array.isArray(source.allowedChannels)?source.allowedChannels:[]).filter(x=>channels.includes(x)),quality:{minScore:wrClamp(source.quality?.minScore,60,100,80),minAuthority:["A","B","C","D"].includes(source.quality?.minAuthority)?source.quality.minAuthority:"A",requireCrossCheck:source.quality?.requireCrossCheck!==false},budget:{maxQueries:wrClamp(source.budget?.maxQueries,1,2,1),maxResults:wrClamp(source.budget?.maxResults,1,8,5),maxOutputTokens:wrClamp(source.budget?.maxOutputTokens,500,1000,900),maxSourcesAccepted:wrClamp(source.budget?.maxSourcesAccepted,1,4,2)}};
}
async function wrListRefinements(env,user,body){
  const rows=(await env.DB.prepare("SELECT * FROM data_requirement_refinements WHERE user_id=? AND project_id=? ORDER BY logic_id,version DESC").bind(user.userId,wrText(body.projectId,120)).all()).results||[],latest={};
  rows.forEach(row=>{if(!latest[row.logic_id])latest[row.logic_id]={id:row.id,ruleId:row.logic_id,version:Number(row.version),requirement:safeJson(row.requirement_json,{}),feedback:row.feedback||"",updatedAt:Number(row.updated_at)};});return latest;
}
const wrClamp=(value,min,max,fallback)=>Math.max(min,Math.min(Number(value)||fallback,max));
function wrRequirementTokens(requirement){
  const text=[...(requirement?.queryTerms||[]),...(requirement?.fields||[]).flatMap(x=>[x.key,x.label]),requirement?.title,requirement?.evidenceGoal].filter(Boolean).join(" ").toLowerCase();
  return [...new Set(text.match(/[\u4e00-\u9fa5]{2,8}|[a-z0-9]{3,}/g)||[])].slice(0,40);
}
function wrEvidenceQuality(row,requirement,now=Date.now()){
  const authority=String(row.authorityLevel||"D"),authorityPoints={A:35,B:29,C:19,D:8}[authority]||8,tokens=wrRequirementTokens(requirement),hay=[row.title,row.snippet,row.publisher,row.url].filter(Boolean).join(" ").toLowerCase();
  const matched=tokens.filter(token=>hay.includes(token)),relevance=tokens.length?Math.min(30,Math.round(matched.length/Math.min(tokens.length,6)*30)):18;
  const published=Date.parse(row.publishedAt||""),maxAge=Number(requirement?.timeScope?.maxAgeMonths)||60,ageMonths=Number.isFinite(published)?Math.max(0,(now-published)/(30.44*86400000)):null;
  const freshness=ageMonths==null?6:ageMonths<=maxAge?15:ageMonths<=maxAge*2?8:2,cross=/cross|multi/.test(row.verificationStatus||"")?10:requirement?.quality?.requireCrossCheck?2:7;
  const completeness=[row.title,row.url,row.publisher,row.publishedAt,row.snippet].filter(Boolean).length*2,score=Math.max(0,Math.min(100,authorityPoints+relevance+freshness+cross+completeness));
  const minScore=Number(requirement?.quality?.minScore)||80,minAuthority=String(requirement?.quality?.minAuthority||"A"),rank={A:4,B:3,C:2,D:1},meetsAuthority=(rank[authority]||0)>=(rank[minAuthority]||4);
  return {...row,qualityScore:score,qualityGrade:score>=90?"A":score>=80?"B":score>=65?"C":"D",qualityReasons:[`权威度${authority}`,`需求词命中${matched.length}项`,ageMonths==null?"发布日期待核":"时效约"+Math.round(ageMonths)+"个月",/cross|multi/.test(row.verificationStatus||"")?"已交叉核验":"单一来源"],meetsRequirement:score>=minScore&&meetsAuthority};
}
async function wrRunSearch(env,user,body){
  const requirement=body.requirementSchema&&typeof body.requirementSchema==="object"?body.requirementSchema:null,providedPlan=body.queryPlan&&typeof body.queryPlan==="object"?body.queryPlan:null,decisionPlan=providedPlan||ReportQueryPlanner.createPlan({...(requirement||{}),purpose:requirement?.queryPurpose||requirement?.evidenceGoal||body.requirement,targetChapter:body.chapter,targetMetric:requirement?.targetMetric,risk:requirement?.risk,webAllowed:requirement?.webAllowed});
  if(!decisionPlan.webAllowed)return {skipped:true,stopReason:ReportQueryPlanner.nextAction(decisionPlan,decisionPlan).reason,decisionPlan,plan:{queries:[]},results:[],errors:[],budgetUsed:{queries:0,results:0,outputTokens:0}};
  const budget=body.budget&&typeof body.budget==="object"?body.budget:requirement?.budget||decisionPlan.budget||{},maxQueries=wrClamp(budget.maxQueries||body.maxQueries,1,6,decisionPlan.budget.maxQueries),maxResults=wrClamp(budget.maxResults||body.maxResults||decisionPlan.budget.maxCandidates,1,10,5),limit=wrClamp(body.limit||maxResults,1,5,5),maxOutputTokens=wrClamp(budget.maxOutputTokens,500,1000,900);
  decisionPlan.budget.maxQueries=maxQueries;decisionPlan.budget.maxCandidates=maxResults;
  const exactQuery=wrText(body.query||requirement?.query,180),broadPlan=body.plan?.queries?body.plan:buildHousingSearchPlan({...body,maxQueries}),plan=exactQuery?{schemaVersion:requirement?.schemaVersion||1,queries:[{dimension:requirement?.dataNature||"precise",query:exactQuery}]}:broadPlan,queries=(exactQuery?plan.queries:broadPlan.queries).slice(0,maxQueries),runId=wrId("run"),now=Date.now();
  await env.DB.prepare("INSERT INTO web_search_runs(id,user_id,project_id,section_key,plan_json,status,query_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(runId,user.userId,body.projectId||"",[body.chapter,body.section].filter(Boolean).join("/"),JSON.stringify({...plan,decisionPlan}),"running",0,now,now).run();
  const raw=[];const errors=[];let provider="",latency=0,used=0,currentDecision=decisionPlan;
  for(const q of queries){const out=await wrSearch(env,q.query,{limit,providers:body.providers,maxOutputTokens});used+=1;provider=provider||out.provider;latency+=out.latencyMs||0;out.results.forEach(x=>raw.push({...x,query:q.query,dimension:q.dimension}));errors.push(...(out.errors||[]));const interim=wrCrossVerify(wrDeduplicate(raw)).map(row=>wrEvidenceQuality(row,requirement,now)),accepted=interim.filter(x=>x.meetsRequirement),best=interim.reduce((n,x)=>Math.max(n,x.qualityScore||0),0);currentDecision=ReportQueryPlanner.record(currentDecision,{accepted:accepted.length>0,independentSources:new Set(accepted.map(x=>{try{return new URL(x.url).hostname;}catch(_){return x.url;}})).size,quality:best});if(ReportQueryPlanner.nextAction(currentDecision,currentDecision).stop)break;}
  const verified=wrCrossVerify(wrDeduplicate(raw)).map(row=>wrEvidenceQuality(row,requirement,now)).sort((a,b)=>b.qualityScore-a.qualityScore||b.authorityScore-a.authorityScore).slice(0,maxResults);const ids=[];
  for(const row of verified)ids.push(await wrSaveEvidence(env,user,{...body,query:row.query},row));
  const ok=verified.length>0;await wrHealth(env,provider||"all",ok,latency,ok?"":errors.map(x=>x.provider+":"+x.error).join("；").slice(0,500));
  await env.DB.prepare("UPDATE web_search_runs SET status=?,provider=?,query_count=?,result_count=?,error_text=?,updated_at=? WHERE id=?").bind(ok?"completed":"failed",provider,used,verified.length,errors.map(x=>x.error).join("；").slice(0,800),Date.now(),runId).run();
  const finalDecision=ReportQueryPlanner.nextAction(currentDecision,currentDecision),stopReason=finalDecision.stop?finalDecision.reason:"本轮无合格证据，转知识库、数据接口或人工补充";
  return {runId,plan,decisionPlan:currentDecision,results:verified.map((x,i)=>({...x,evidenceId:ids[i]})),errors,provider,stopReason,budgetUsed:{queries:used,results:verified.length,outputTokens:maxOutputTokens*used,maxQueries,maxResults,maxOutputTokens}};
}

async function wrHandle(context,body){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:"未登录"},401);
  await wrEnsureSchema(env);const action=body.action||"status";
  if(action==="status"){
    const health=(await env.DB.prepare("SELECT * FROM web_provider_health ORDER BY provider").all()).results||[],lenses=(await env.DB.prepare("SELECT * FROM web_search_lenses WHERE status<>? ORDER BY updated_at DESC").bind("deleted").all()).results||[];
    return json({ok:true,providers:wrProviderCatalog(env),health,lenses:lenses.map(x=>({...x,domains:safeJson(x.domains_json,[]),housingTypes:safeJson(x.housing_types_json,[])}))});
  }
  if(action==="plan")return json({ok:true,plan:buildHousingSearchPlan(body)});
  if(action==="search"||action==="searchSection")return json({ok:true,...await wrRunSearch(env,user,body)});
  if(action==="listEvidence")return json({ok:true,evidence:await wrListEvidence(env,user,body)});
  if(action==="listRequirementRefinements")return json({ok:true,refinements:await wrListRefinements(env,user,body)});
  if(action==="refineRequirement"){
    const projectId=wrText(body.projectId,120),logicId=wrText(body.logicId||body.ruleId,120),feedback=wrText(body.feedback,1000);if(!projectId||!logicId)return json({ok:false,error:"缺少项目或逻辑项标识"},400);
    const latest=await env.DB.prepare("SELECT version FROM data_requirement_refinements WHERE user_id=? AND project_id=? AND logic_id=? ORDER BY version DESC LIMIT 1").bind(user.userId,projectId,logicId).first(),version=Number(latest?.version||0)+1,requirement=wrNormalizeRequirement(body.requirement),now=Date.now(),id=wrId("reqref");
    await env.DB.prepare("INSERT INTO data_requirement_refinements(id,user_id,project_id,logic_id,version,requirement_json,feedback,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,user.userId,projectId,logicId,version,JSON.stringify(requirement),feedback,now,now).run();
    return json({ok:true,refinement:{id,ruleId:logicId,version,requirement,feedback,updatedAt:now}});
  }
  if(action==="fetch"){
    const doc=await wrFetchDocument(env,body.url);if(body.evidenceId)await env.DB.prepare("UPDATE web_evidence SET fetched_at=?,content_text=?,excerpt=?,content_hash=?,updated_at=? WHERE id=? AND user_id=?").bind(doc.fetchedAt,doc.text,doc.text.slice(0,1200),wrHash(doc.text),Date.now(),body.evidenceId,user.userId).run();return json({ok:true,document:doc});
  }
  if(action==="updateEvidenceContent"){
    const text=wrText(body.text,30000);if(text.length<20)return json({ok:false,error:"提取正文过短，未写入证据台账"},400);
    await env.DB.prepare("UPDATE web_evidence SET fetched_at=?,content_text=?,excerpt=?,content_hash=?,updated_at=? WHERE id=? AND user_id=?").bind(new Date().toISOString(),text,text.slice(0,1200),wrHash(text),Date.now(),body.evidenceId,user.userId).run();return json({ok:true,length:text.length});
  }
  if(action==="verify"){
    const rows=await wrListEvidence(env,user,body),verified=wrCrossVerify(rows.map(x=>({url:x.url,title:x.title,snippet:x.excerpt,publisher:x.publisher,authorityScore:x.authority_score,authorityLevel:x.authority_level,provider:x.provider})));
    for(const row of verified)await env.DB.prepare("UPDATE web_evidence SET confidence=?,verification_status=?,updated_at=? WHERE user_id=? AND project_id=? AND canonical_url=?").bind(row.confidence,row.verificationStatus,Date.now(),user.userId,wrText(body.projectId,120),wrCanonicalUrl(row.url)).run();
    return json({ok:true,verified:verified.length,crossVerified:verified.filter(x=>x.verificationStatus==="cross_verified").length});
  }
  if(action==="setEvidenceStatus"){
    const status=["candidate","approved","archived","rejected"].includes(body.status)?body.status:"candidate",now=Date.now(),logicIds=[...(Array.isArray(body.logicIds)?body.logicIds:[]),body.logicId].map(x=>wrText(x,120)).filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i);
    const evidence=await env.DB.prepare("SELECT project_id,chapter,section FROM web_evidence WHERE id=? AND user_id=?").bind(body.id,user.userId).first();if(!evidence)return json({ok:false,error:"证据不存在"},404);
    await env.DB.prepare("UPDATE web_evidence SET status=?,logic_id=?,updated_at=? WHERE id=? AND user_id=?").bind(status,logicIds[0]||"",now,body.id,user.userId).run();
    if(status==="approved")for(const logicId of logicIds)await env.DB.prepare("INSERT INTO web_evidence_bindings(id,evidence_id,user_id,project_id,logic_id,chapter,section,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(evidence_id,logic_id) DO UPDATE SET status=?,chapter=?,section=?,updated_at=?").bind(wrId("bind"),body.id,user.userId,evidence.project_id,logicId,evidence.chapter,evidence.section,"approved",now,now,"approved",evidence.chapter,evidence.section,now).run();
    else await env.DB.prepare("UPDATE web_evidence_bindings SET status=?,updated_at=? WHERE evidence_id=? AND user_id=?").bind(status,now,body.id,user.userId).run();
    return json({ok:true,logicIds});
  }
  if(action==="saveLens"){
    if(!wrAdmin(env,user))return json({ok:false,error:"仅管理员可维护检索透镜"},403);const id=body.id||wrId("lens"),old=body.id?await env.DB.prepare("SELECT version FROM web_search_lenses WHERE id=?").bind(id).first():null;
    await env.DB.prepare("INSERT INTO web_search_lenses(id,name,dimension,domains_json,housing_types_json,query_suffix,status,version,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=?,dimension=?,domains_json=?,housing_types_json=?,query_suffix=?,status=?,version=?,updated_by=?,updated_at=?").bind(id,wrText(body.name,100),wrText(body.dimension,50),JSON.stringify(body.domains||[]),JSON.stringify(body.housingTypes||[]),wrText(body.querySuffix,200),body.status||"active",(old?.version||0)+1,user.username,Date.now(),wrText(body.name,100),wrText(body.dimension,50),JSON.stringify(body.domains||[]),JSON.stringify(body.housingTypes||[]),wrText(body.querySuffix,200),body.status||"active",(old?.version||0)+1,user.username,Date.now()).run();return json({ok:true,id});
  }
  return json({ok:false,error:"未知操作"},400);
}
export async function onRequestGet(context){try{return await wrHandle(context,{action:"status"});}catch(e){return json({ok:false,error:"联网检索状态读取失败："+e.message},500);}}
export async function onRequestPost(context){let body;try{body=await context.request.json();}catch(e){return json({ok:false,error:"格式有误"},400);}try{return await wrHandle(context,body);}catch(e){return json({ok:false,error:"联网研究失败："+e.message},500);}}
export { wrEvidenceQuality, wrRequirementTokens, wrNormalizeRequirement };
