// Durable section generation: snapshot -> effective rules -> queued model -> candidate.
// This does not modify the accepted report, and does not claim formal human sign-off.
import {verifyAuth,json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {resolveProjectAccess} from './_project-access.js';
import {ensureReportOrchestration,parseJson} from './_report-orchestration.js';
import {reportEvidenceHash} from './_report-trusted-evaluation.js';
import {ensureAgentRuntime,createAgentRun} from './_agent-runtime.js';
import {ensureAgentEnterprise,upsertRunGovernance,enqueueAgentJob} from './_agent-enterprise.js';
import {ensureAgentBudget} from './_agent-budget.js';
export async function ensureReportExecution(env){
  await ensureReportOrchestration(env);await ensureAgentRuntime(env);await ensureAgentEnterprise(env);await ensureAgentBudget(env);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS report_section_tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,section_key TEXT NOT NULL,input_hash TEXT NOT NULL,rules_hash TEXT NOT NULL,input_json TEXT NOT NULL,run_id TEXT NOT NULL,created_at BIGINT NOT NULL)').run();
}
export async function effectiveReportRules(env,projectId,projectType=''){
  const project=await env.DB.prepare('SELECT data FROM projects WHERE id=?').bind(projectId).first(),data=parseJson(project?.data,{});
  // Scope is derived from saved project data, never from the generation request.
  const declared=data.project?.businessScenario||data.aiReportExtracted?.businessScenario;
  const scenario=['commercial_renovation','housing_conversion'].includes(declared)?declared:((data.calcType||data.rptCtype)==='gaibao'?'housing_conversion':'');
  const organization=String(env.REPORT_ORGANIZATION_ID||'');
  const rows=(await env.DB.prepare("SELECT id,version,payload_json FROM report_rule_publications WHERE status='published' AND ((scope='project_only' AND scope_key=?) OR (scope='scenario_rule' AND scope_key=?) OR (scope='org_rule' AND scope_key=? AND scope_key!='')) ORDER BY published_at,id").bind(projectId,scenario,organization).all()).results||[];
  const rules=rows.map(r=>{const p=parseJson(r.payload_json,{});return {id:r.id,version:r.version,target:String(p.target||''),rule:String(p.candidateRule||'')};});
  if(['rent','gaibao','sale'].includes(projectType)){
    const base=await env.DB.prepare("SELECT id,version,data FROM report_logic_sets WHERE project_type=? AND status='published' ORDER BY version DESC LIMIT 1").bind(projectType).first();
    if(base)rules.push({id:base.id,version:Number(base.version),target:'',rule:'',baseLogic:true,hash:await reportEvidenceHash(base.data)});
  }
  return rules;
}
export async function startReportSection(env,userId,b){
  if(!env.DB._transaction)throw new Error('持久化报告生成需要事务数据库；请启动本地 PostgreSQL 服务');
  await ensureReportExecution(env);
  const projectId=String(b.projectId||''),sectionKey=String(b.sectionKey||'');
  if(!projectId||!sectionKey||sectionKey.length>500||typeof b.system!=='string'||typeof b.user!=='string'||!b.user.trim())throw new Error('缺少项目、小节或生成输入');
  if(JSON.stringify(b).length>500000)throw new Error('小节上下文过大，请减少无关材料后重试');
  return env.DB._transaction(async DB=>{
    const scoped={...env,DB};await DB.prepare('SELECT id FROM projects WHERE id=? FOR UPDATE').bind(projectId).first();
    const access=await resolveProjectAccess(scoped,userId,projectId);if(!access?.permissions.edit)throw new Error('项目编辑权限已失效');
    const projectType=['rent','gaibao','sale'].includes(b.projectType)?b.projectType:'';
    const rules=await effectiveReportRules(scoped,projectId,projectType),applicable=rules.filter(r=>!r.target||sectionKey.includes(r.target)),rulesHash=await reportEvidenceHash(applicable);
    const base=rules.find(r=>r.baseLogic);if(base&&Number(b.logicVersion)!==base.version)throw new Error('前台逻辑版本落后于后台，请刷新逻辑后重试；未发送模型请求');
    const snapshot={system:b.system,user:b.user,sectionKey,projectType,rules:applicable},inputHash=await reportEvidenceHash(snapshot),id='rsec_'+await reportEvidenceHash([userId,projectId,inputHash]);
    const old=await DB.prepare('SELECT * FROM report_section_tasks WHERE id=?').bind(id).first();if(old)return {id,reused:true,runId:old.run_id};
    const {run}=await createAgentRun(scoped,userId,{agentType:'report_section',projectId,query:sectionKey,idempotencyKey:id});
    await upsertRunGovernance(scoped,userId,run.id,{executionMode:'server',budgetInputTokens:2000000,budgetOutputTokens:4000});
    await enqueueAgentJob(scoped,userId,run.id,{kind:'llm_task',maxAttempts:2,payload:{projectId,reportSectionTaskId:id,system:b.system+(applicable.some(r=>r.rule)?'\n【已发布项目规则】\n'+applicable.filter(r=>r.rule).map(r=>r.rule).join('\n'):''),query:b.user,maxTokens:4000}});
    await DB.prepare('INSERT INTO report_section_tasks(id,project_id,user_id,section_key,input_hash,rules_hash,input_json,run_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,projectId,userId,sectionKey,inputHash,rulesHash,JSON.stringify(snapshot),run.id,Date.now()).run();
    return {id,reused:false,runId:run.id};
  });
}
export async function readReportSection(env,userId,id){
  await ensureReportExecution(env);
  const row=await env.DB.prepare('SELECT * FROM report_section_tasks WHERE id=? AND user_id=?').bind(id,userId).first();if(!row||!(await resolveProjectAccess(env,userId,row.project_id))?.permissions.view)throw new Error('任务不存在或项目权限已失效');
  const job=await env.DB.prepare('SELECT id,status,error_text FROM agent_jobs WHERE run_id=?').bind(row.run_id).first(),ledger=await env.DB.prepare('SELECT response_json,status,actual_input,actual_output,actual_cost FROM agent_call_ledger WHERE run_id=?').bind(row.run_id).first();
  const rules=(await effectiveReportRules(env,row.project_id,parseJson(row.input_json,{}).projectType)).filter(r=>!r.target||row.section_key.includes(r.target));
  const stale=(await reportEvidenceHash(rules))!==row.rules_hash,status=stale?'invalidated':job?.status||'missing';
  return {id:row.id,runId:row.run_id,jobId:job?.id,status,error:stale?'规则已发布或回滚，本次候选已失效，请按最新逻辑重新生成':job?.error_text,text:status==='completed'?parseJson(ledger?.response_json,{}).text||'':'',graph:[{key:'context_snapshot',status:'completed',hash:row.input_hash},{key:'effective_rules',dependsOn:['context_snapshot'],status:stale?'invalidated':'completed',hash:row.rules_hash},{key:'content_generate',dependsOn:['effective_rules'],status},{key:'candidate_review',dependsOn:['content_generate'],status:status==='completed'?'ready':'pending'}],usage:ledger?{status:ledger.status,input:ledger.actual_input,output:ledger.actual_output,costMicros:ledger.actual_cost}:null};
}
async function handle(context,post){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:'未登录'},401);
  try{return json({ok:true,task:post?await startReportSection(env,user.userId,await context.request.json()):await readReportSection(env,user.userId,new URL(context.request.url).searchParams.get('id'))});}
  catch(e){return json({ok:false,error:e.message},409);}
}
export const onRequestPost=context=>handle(context,true);
export const onRequestGet=context=>handle(context,false);
