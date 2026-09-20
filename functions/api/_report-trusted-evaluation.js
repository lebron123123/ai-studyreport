// Only approved immutable cases and server-recorded model outputs are evidence.
import {ensureReportOrchestration,parseJson} from './_report-orchestration.js';
import {ensureAgentRuntime,createAgentRun} from './_agent-runtime.js';
import {ensureAgentEnterprise,upsertRunGovernance,enqueueAgentJob} from './_agent-enterprise.js';
import {ensureAgentBudget} from './_agent-budget.js';
import {scoreReportQuality,validateQualityContract} from './_report-quality.js';
import {resolveProjectAccess} from './_project-access.js';
import {ensureProjectArtifacts} from './projectartifacts.js';
import {approvedCaseSource} from './_report-case-provenance.js';
export async function reportEvidenceHash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
export function reportCandidateBinding(row){const c=parseJson(row.candidate_json,{});return {id:row.id,version:Number(row.version),projectId:row.project_id,scenario:row.scenario,rule:c.candidateRule,target:c.target};}
export function scoreReportCase(sample,text){
  return scoreReportQuality(sample,text);
}
export async function ensureTrustedReportEvaluation(env){
  await ensureReportOrchestration(env);await ensureAgentRuntime(env);await ensureAgentEnterprise(env);await ensureAgentBudget(env);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS report_trusted_cases(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,scenario TEXT NOT NULL,dataset_role TEXT NOT NULL,sample_hash TEXT NOT NULL,sample_json TEXT NOT NULL,approved_by INTEGER NOT NULL,approved_at BIGINT NOT NULL)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS report_trusted_runs(id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL,candidate_hash TEXT NOT NULL,case_id TEXT NOT NULL,sample_hash TEXT NOT NULL,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,result_json TEXT NOT NULL DEFAULT \'\',created_at BIGINT NOT NULL,UNIQUE(candidate_hash,case_id))').run();
}
export async function registerReportCase(env,userId,input){
  await ensureTrustedReportEvaluation(env);
  if(!env.DB._transaction)throw new Error('Golden登记需要事务数据库');
  return env.DB._transaction(async DB=>{
  env={...env,DB};
  await DB.prepare('SELECT pg_advisory_xact_lock(1907001)').first();
  await DB.prepare('SELECT id FROM projects WHERE id=? FOR UPDATE').bind(String(input.projectId||'')).first();
  const source=await approvedCaseSource(env,userId,String(input.projectId||''),String(input.deliveryId||''),{current:true});
  const sample={...source.contract,projectId:String(input.projectId||''),scenario:String(input.scenario||''),datasetRole:input.datasetRole,input:String(input.input||''),approvalNote:String(input.approvalNote||''),provenance:source};
  validateQualityContract(sample);
  if(!sample.projectId||!sample.scenario||!['training','holdout'].includes(sample.datasetRole)||!sample.input||!sample.approvalNote||!scoreReportCase(sample,'').checks.length)throw new Error('需要确认项目、场景、training/holdout、真实输入、检查条件和负责人批准依据');
  if(sample.input.length>25000)throw new Error('评测输入过大，请拆分为可独立核验的小节');
  if(!scoreReportCase(sample,source.approvedText).passed)throw new Error('批准正文未通过其冻结检查条件');
  const cases=(await DB.prepare('SELECT project_id,dataset_role,sample_json FROM report_trusted_cases WHERE scenario=?').bind(sample.scenario).all()).results||[];
  const normalized=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  if(cases.some(c=>c.dataset_role!==sample.datasetRole&&(c.project_id===sample.projectId||normalized(parseJson(c.sample_json,{}).input)===normalized(sample.input)||parseJson(c.sample_json,{}).provenance?.contentHash===source.contentHash)))throw new Error('训练与留出必须使用独立项目和材料，不能跨集合重复登记');
  if(sample.citations?.length){
    await ensureProjectArtifacts(env);
    if(!(await resolveProjectAccess(env,userId,sample.projectId))?.permissions.view)throw new Error('无权核验样本来源项目');
    for(const citation of sample.citations){
      const object=await env.DB.prepare('SELECT storage_key FROM report_source_artifacts WHERE project_id=? AND content_hash=? LIMIT 1').bind(sample.projectId,citation.sourceHash).first();
      if(!object||!env.RAG_OBJECTS?.verify||!(await env.RAG_OBJECTS.verify(object.storage_key,citation.sourceHash)).ok)throw new Error('引用原件不存在或SHA-256校验失败');
    }
  }
  await ensureTrustedReportEvaluation(env);const hash=await reportEvidenceHash(sample),id='rcase_'+hash;
  await env.DB.prepare('INSERT INTO report_trusted_cases(id,project_id,scenario,dataset_role,sample_hash,sample_json,approved_by,approved_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,sample.projectId,sample.scenario,sample.datasetRole,hash,JSON.stringify(sample),userId,Date.now()).run();
  return {id,sampleHash:hash,datasetRole:sample.datasetRole};
  });
}
export async function startReportEvaluation(env,userId,row,caseId){
  await ensureTrustedReportEvaluation(env);
  if(!env.DB._transaction)throw new Error('可信评测需要事务数据库');
  return env.DB._transaction(async DB=>{
    const locked=await DB.prepare('SELECT * FROM report_feedback_candidates WHERE id=? FOR UPDATE').bind(row.id).first();
    if(!locked)throw new Error('规则候选不存在');
    return enqueueReportEvaluation({...env,DB},userId,locked,caseId);
  });
}
async function enqueueReportEvaluation(env,userId,row,caseId){
  const sampleRow=await env.DB.prepare('SELECT * FROM report_trusted_cases WHERE id=?').bind(caseId).first();if(!sampleRow)throw new Error('未找到负责人批准的受控样本');
  const approvedSample=parseJson(sampleRow.sample_json,{});
  await approvedCaseSource(env,userId,sampleRow.project_id,approvedSample.provenance?.deliveryId);
  if(await reportEvidenceHash(approvedSample)!==sampleRow.sample_hash)throw new Error('受控样本完整性校验失败');
  if(sampleRow.scenario!==row.scenario&&!parseJson(row.candidate_json,{}).organizationId)throw new Error('样本场景与规则不一致');
  if(sampleRow.dataset_role==='holdout'&&sampleRow.project_id===row.project_id)throw new Error('留出项目不能是该规则的来源项目');
  const binding=reportCandidateBinding(row),hash=await reportEvidenceHash(binding),id='reval_'+await reportEvidenceHash([hash,caseId]);
  if(!String(binding.rule||'').trim())throw new Error('规则内容不能为空');
  const old=await env.DB.prepare('SELECT j.id,j.status FROM report_trusted_runs e JOIN agent_jobs j ON j.run_id=e.run_id WHERE e.id=?').bind(id).first();
  if(old)return {id,jobId:old.id,status:old.status,reused:true};
  const sample=parseJson(sampleRow.sample_json,{});
  // Different project IDs cannot turn the same source text into independent holdout evidence.
  const materialKey=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  const registered=(await env.DB.prepare('SELECT dataset_role,sample_json FROM report_trusted_cases WHERE scenario=?').bind(sampleRow.scenario).all()).results||[];
  if(registered.some(other=>other.dataset_role!==sampleRow.dataset_role&&materialKey(parseJson(other.sample_json,{}).input)===materialKey(sample.input)))throw new Error('训练与留出样本材料重复，不能作为独立评测');
  const {run}=await createAgentRun(env,userId,{agentType:'report_evaluation',projectId:row.project_id,query:'受控规则评测',idempotencyKey:id});
  await upsertRunGovernance(env,userId,run.id,{executionMode:'server',budgetInputTokens:100000,budgetOutputTokens:4000});
  const job=await enqueueAgentJob(env,userId,run.id,{kind:'llm_task',maxAttempts:1,payload:{projectId:row.project_id,evaluationSource:{projectId:sampleRow.project_id,deliveryId:sample.provenance.deliveryId},system:'依据项目材料执行以下写作规则。仅输出报告正文，不要输出说明。\n'+binding.rule,query:sample.input,maxTokens:4000}});
  await env.DB.prepare("INSERT INTO report_trusted_runs(id,candidate_id,candidate_hash,case_id,sample_hash,run_id,user_id,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(id,row.id,hash,caseId,sampleRow.sample_hash,run.id,userId,Date.now()).run();
  return {id,jobId:job.id,status:job.status};
}
export async function trustedReportEvaluations(env,row){
  await ensureTrustedReportEvaluation(env);const hash=await reportEvidenceHash(reportCandidateBinding(row));
  const rows=(await env.DB.prepare('SELECT e.*,c.dataset_role,c.project_id,c.scenario,c.sample_json,c.sample_hash AS current_sample_hash,l.response_json,j.status AS job_status FROM report_trusted_runs e JOIN report_trusted_cases c ON c.id=e.case_id LEFT JOIN agent_call_ledger l ON l.run_id=e.run_id LEFT JOIN agent_jobs j ON j.run_id=e.run_id WHERE e.candidate_id=? AND e.candidate_hash=? ORDER BY e.created_at').bind(row.id,hash).all()).results||[];
  const results=[];
  for(const r of rows){
    if(!r.id)continue;
    const registeredSample=parseJson(r.sample_json,{});
    try{await approvedCaseSource(env,r.user_id,r.project_id,registeredSample.provenance?.deliveryId);if(await reportEvidenceHash(registeredSample)!==r.sample_hash)throw new Error('hash');}catch{results.push({datasetRole:r.dataset_role,projectId:r.project_id,passed:false,score:0,status:'approval_or_access_invalid'});continue;}
    if(r.sample_hash!==r.current_sample_hash||r.job_status!=='completed'||!r.response_json){results.push({datasetRole:r.dataset_role,projectId:r.project_id,scenario:r.scenario,runId:r.run_id,passed:false,score:0,status:r.job_status||'missing'});continue;}
    const text=String(parseJson(r.response_json,{}).text||''),sample=parseJson(r.sample_json,{}),metrics=scoreReportCase(sample,text);
    const result={...metrics,datasetRole:r.dataset_role,projectId:r.project_id,scenario:r.scenario,runId:r.run_id,candidateHash:hash,sampleHash:r.sample_hash,outputHash:await reportEvidenceHash(text)};
    await env.DB.prepare('UPDATE report_trusted_runs SET result_json=? WHERE id=?').bind(JSON.stringify(result),r.id).run();results.push(result);
  }
  return results;
}
