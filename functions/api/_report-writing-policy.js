// Server-owned writing policy. Saved project context and published logic are
// authority; request-side prose settings and purported review receipts are not.
import '../../report-writing-standard.js';
import '../../report-logic-core.js';
import '../../report-gap-registry.js';
import '../../report-gap-workflow.js';
import writingPolicy from '../../report-writing-policy.js';

const standard=globalThis.ReportWritingStandard;
const core=globalThis.ReportLogicCore;
const gaps=globalThis.ReportGapRegistry,workflow=globalThis.ReportGapWorkflow;
export const REPORT_WRITING_POLICY_VERSION=standard.VERSION+':'+standard.RULE_VERSION;
export const REPORT_GAP_POLICY_VERSION=workflow.VERSION+':'+gaps.VERSION;
const supported=new Set(['rent','gaibao','sale']);
const parse=value=>{if(typeof value!=='string')return value&&typeof value==='object'?value:{};try{return JSON.parse(value);}catch{throw new Error('后台已发布写作逻辑损坏，请管理员核对，未发送模型请求');}};

export function savedReportWritingType(saved,requested=''){
  const actual=[saved?.calcType,saved?.calcResult?.__ctype,saved?.rptCtype].find(value=>supported.has(value));
  if(actual&&supported.has(requested)&&actual!==requested)throw new Error('测算类型与已保存项目不一致，请保存并刷新项目后重试');
  // Old drafts without a declared calculation type remain usable. They cannot
  // override a type already present in the saved project.
  return actual||(supported.has(requested)?requested:'');
}
export function reportWritingScope(saved,projectType){
  if(projectType!=='gaibao')return projectType||'rent';
  const value=saved?.project?.businessScenario||saved?.aiReportExtracted?.businessScenario;
  return value==='commercial_renovation'?'commercial_renovation':'housing_conversion';
}
export function projectReportWritingPolicy(data,saved,projectType,sectionKey,source={}){
  const normalized=writingPolicy.normalize(data||{}),scope=reportWritingScope(saved,projectType);
  const split=String(sectionKey).indexOf(' / '),chapter=split<0?'':String(sectionKey).slice(0,split),title=split<0?String(sectionKey):String(sectionKey).slice(split+3);
  const project=saved?.project||{},projectText=[project.name,project.type,project.location,project.desc].filter(Boolean).join(' ');
  const rules=core.matchRules(normalized,chapter,title,{projectType:projectType||'rent',businessScenario:scope,projectText});
  const config=standard.normalize(normalized.writingStandard);
  const context={projectType:projectType||'rent',businessScenario:scope,chapter,title,writingLogic:rules.map(rule=>String(rule.writingLogic||'')).filter(Boolean).join('\n')};
  const globalRequirements=String(normalized.globalRequirements?.[scope]||'');
  const authority={version:REPORT_WRITING_POLICY_VERSION,sourceId:source.id||null,sourceVersion:Number(source.version)||null,scope,ruleIds:rules.map(rule=>String(rule.id||'')),globalRequirements,config,context};
  const prompt='\n【服务端已发布写作规则，优先于请求内的旧写作设置】\n'+
    (globalRequirements?'【后台全篇要求】\n'+globalRequirements+'\n':'')+
    standard.prompt(config,context);
  const {businessScenario:ignoredScenario,...contractContext}=context;
  return {authority,binding:{config,context:contractContext},prompt,logicData:normalized};
}
export async function loadReportWritingPolicy(env,saved,projectType,sectionKey){
  const row=supported.has(projectType)?await env.DB.prepare("SELECT id,version,data FROM report_logic_sets WHERE project_type=? AND status='published' ORDER BY version DESC LIMIT 1").bind(projectType).first():null;
  return projectReportWritingPolicy(row?parse(row.data):{},saved,projectType,sectionKey,row||{});
}

// Refinements are persisted separately from the editable project JSON. Reading
// the table's existence is safe inside a PostgreSQL transaction; attempting a
// missing-table SELECT and catching it would leave the transaction aborted.
export async function loadReportRequirementOverrides(env,userId,projectId,saved){
  const postgres=env.DEPLOY_MODE==='local'||typeof env.DB._transaction==='function';
  const exists=await env.DB.prepare(postgres?"SELECT to_regclass('data_requirement_refinements') AS name":"SELECT name FROM sqlite_master WHERE type='table' AND name='data_requirement_refinements'").first();
  if(!exists?.name)return {};
  const lookup=String(projectId||saved?.workflow?.projectId||saved?.project?.id||saved?.project?.name||'current-project').slice(0,120);
  const rows=(await env.DB.prepare('SELECT * FROM data_requirement_refinements WHERE user_id=? AND project_id=? ORDER BY logic_id,version DESC').bind(userId,lookup).all()).results||[],latest={};
  for(const row of rows)if(!Object.hasOwn(latest,row.logic_id))latest[row.logic_id]={id:row.id,ruleId:row.logic_id,version:Number(row.version),requirement:parse(row.requirement_json),feedback:row.feedback||'',updatedAt:Number(row.updated_at)};
  return latest;
}
export function reportGapPolicySource(saved,options){
  const ctx=workflow.fromSaved(saved,options),registry=saved?.workflow?.reportGapRegistry||null;
  return {version:REPORT_GAP_POLICY_VERSION,registry,sourceRevision:registry?workflow.sourceRevision(ctx):null,...(registry?{receipts:saved?.workflow?.reportGapReceipts||{},trustedApprovals:options?.trustedApprovals||[]}: {})};
}
export function projectReportGapPolicy(saved,options){
  const source=reportGapPolicySource(saved,options);
  if(!source.registry)return {source,binding:null,prompt:'',registry:null};
  // Only verified server receipts may supply options.trustedApprovals; claimed
  // closures in writable state alone reopen during deterministic derivation.
  const ctx=workflow.fromSaved(saved,options),derived=workflow.create(ctx);
  if(!derived.registry.valid||!derived.active)throw new Error('资料缺口台账尚未应用或项目资料已变化，请重新核对并应用台账后生成；原报告和候选未改动');
  if(!derived.sectionKeys.includes(options.sectionKey))throw new Error('当前小节不在已保存的缺口台账目录中，请保存目录并重新应用台账');
  const presentation=workflow.section(derived.registry,options.sectionKey,{projectKey:ctx.projectKey,sourceRevision:derived.sourceRevision,trustedApprovals:options.trustedApprovals||[]});
  if(!presentation.valid)throw new Error('资料缺口台账未通过校验，请核对主位置及资料版本');
  const binding={version:'report-gap-requirements-v1',registryHash:gaps.fingerprint(derived.registry),sourceRevision:derived.sourceRevision,primaryMarkers:presentation.primaryMarkers,references:presentation.references,...(presentation.forbiddenMarkers?{forbiddenMarkers:presentation.forbiddenMarkers}:{})};
  return {source,binding,registry:derived.registry,prompt:'\n【服务端已核对的资料缺口分工】\n'+presentation.instructions};
}
