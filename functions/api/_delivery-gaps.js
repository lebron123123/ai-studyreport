// Frozen, server-owned gap context. Editable project JSON is never closure proof.
import {loadReportWritingPolicy,loadReportRequirementOverrides,savedReportWritingType} from './_report-writing-policy.js';
import {loadReportGapApprovals} from './_report-gap-approval.js';

const workflow=globalThis.ReportGapWorkflow,gaps=globalThis.ReportGapRegistry;
export const DELIVERY_GAP_CONTEXT_VERSION='delivery-gap-context-v1';
const clone=value=>value===undefined?null:JSON.parse(JSON.stringify(value));
const problem=(code,message)=>({code,message,severity:'error'});
export function hasDeliveryGapRegistry(saved){return !!saved?.workflow&&Object.hasOwn(saved.workflow,'reportGapRegistry');}
// Enabling the governed workflow is monotonic once server history exists. A
// writable draft cannot erase that fact by deleting its entire ledger property.
export async function hasDeliveryGapHistory(env,projectId){
  const frozen=await env.DB.prepare('SELECT id FROM report_deliveries WHERE project_id=? AND snapshot_json LIKE ? LIMIT 1').bind(projectId,'%"schemaVersion":4%').first();
  if(frozen)return true;
  return !!await env.DB.prepare("SELECT id FROM project_events WHERE project_id=? AND event_type='report.gap.human-confirmed' LIMIT 1").bind(projectId).first();
}

// Only the delivery service calls this loader. No body-provided config, evidence
// claims, approval arrays or activation flag are treated as authoritative facts.
export async function loadDeliveryGapContext(env,userId,projectId,saved){
  if(!hasDeliveryGapRegistry(saved))return null;
  const projectType=savedReportWritingType(saved)||workflow.fromSaved(saved).projectType;
  const policy=await loadReportWritingPolicy(env,saved,projectType,'');
  const requirementOverrides=await loadReportRequirementOverrides(env,userId,projectId,saved);
  const ctx=workflow.fromSaved(saved,{projectKey:String(projectId),projectType,logicData:policy.logicData,requirementOverrides});
  const trustedApprovals=await loadReportGapApprovals(env,saved,ctx);
  return {version:DELIVERY_GAP_CONTEXT_VERSION,projectKey:String(projectId),projectType,businessScenario:ctx.businessScenario,
    policy:{sourceId:policy.authority.sourceId,sourceVersion:policy.authority.sourceVersion,scope:policy.authority.scope,logicData:clone(policy.logicData)},requirementOverrides:clone(requirementOverrides),trustedApprovals};
}

export function deliveryGapSnapshot(saved,authority){
  const ctx=authority&&typeof authority==='object'?authority:{};
  // Only server-verified receipts enter the immutable authority envelope, never
  // saved.workflow.trustedApprovals or a client request's review booleans.
  return {version:DELIVERY_GAP_CONTEXT_VERSION,registry:clone(saved.workflow?.reportGapRegistry),authority:{version:ctx.version||null,projectKey:String(ctx.projectKey||''),projectType:String(ctx.projectType||''),businessScenario:String(ctx.businessScenario||''),policy:clone(ctx.policy),requirementOverrides:clone(ctx.requirementOverrides||{}),trustedApprovals:clone(Array.isArray(ctx.trustedApprovals)?ctx.trustedApprovals:[])},
    outline:(saved.chapters||[]).map(c=>({name:String(c.name||c.title||''),checked:c.checked!==false,sections:(c.sections||[]).map(s=>({t:String(s.t||s.title||''),checked:s.checked!==false}))}))};
}

const visible=value=>String(value||'').replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,'').replace(/&(?:nbsp|#160|#xA0);/gi,' ').replace(/&(?:#(\d+)|#x([\da-f]+));/gi,(_,dec,hex)=>{const n=parseInt(dec||hex,dec?10:16);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&amp;/gi,'&').replace(/[\u200b-\u200d\ufeff]/g,'');

function gapContext(snapshot){
  const frozen=snapshot.gapReview,authority=frozen.authority;
  const saved={project:snapshot.project||{},calcParams:snapshot.restoreInput?.calcParams||{},kb:snapshot.references?.kb||[],chapters:frozen.outline,calcType:authority.projectType,workflow:{reportGapRegistry:frozen.registry}};
  return workflow.fromSaved(saved,{projectKey:authority.projectKey,projectType:authority.projectType,businessScenario:authority.businessScenario,logicData:authority.policy.logicData,requirementOverrides:authority.requirementOverrides||{},trustedApprovals:authority.trustedApprovals||[]});
}
export function deliveryGapQuality(snapshot){
  if(snapshot?.schemaVersion!==4)return null;
  const frozen=snapshot.gapReview,authority=frozen?.authority,issues=[];
  const fail=()=>({passed:false,canFinalize:false,factsVerified:false,issues,unresolvedCritical:[],method:'structured-gap-delivery-v1'});
  if(frozen?.version!==DELIVERY_GAP_CONTEXT_VERSION||authority?.version!==DELIVERY_GAP_CONTEXT_VERSION||!authority.projectKey||!['rent','sale','gaibao'].includes(authority.projectType)||!Array.isArray(frozen.outline)){
    issues.push(problem('missing-gap-context','冻结稿缺少服务端资料缺口核查上下文，不能正式签发'));return fail();
  }
  if(!frozen.registry||typeof frozen.registry!=='object'||!authority.policy?.sourceId||!Number.isSafeInteger(authority.policy.sourceVersion)||authority.policy.sourceVersion<1||!Array.isArray(authority.policy.logicData?.rules)){
    issues.push(problem('missing-gap-policy','资料缺口台账或已发布数据需求不完整，不能把空台账视为核查通过'));return fail();
  }
  try{
    const ctx=gapContext(snapshot);
    const derived=workflow.create(ctx);
    if(frozen.registry.sourceRevision!==derived.sourceRevision)issues.push(problem('stale-gap-source','资料、测算参数、目录或数据需求已变化，请重新核对资料缺口台账'));
    if(!derived.active)issues.push(problem('inactive-gap-registry','资料缺口台账未在当前资料版本明确应用，不能绕过正式交付核查'));
    if(derived.coverage.unmatched.length)issues.push(problem('unmatched-gap-sections','部分章节未匹配到已发布数据需求，不能确认缺口核查完整'));
    // Snapshot prose, not rendered prompts or editable comments, is inspected.
    const entries=(snapshot.chapters||[]).flatMap(c=>(c.sections||[]).map(s=>({sectionKey:String(c.name)+' / '+String(s.title),text:visible(s.content)})));
    const inspection=gaps.inspect(entries,derived.registry,{projectKey:ctx.projectKey,sourceRevision:derived.sourceRevision,trustedApprovals:authority.trustedApprovals||[]});
    issues.push(...inspection.issues);
    if(inspection.unresolvedCritical.length)issues.push(problem('unresolved-critical-gaps','仍有 '+inspection.unresolvedCritical.length+' 项关键事项未取得当前版本的有效核验证据或独立确认，不能正式签发'));
    const passed=derived.registry.valid&&inspection.canFinalize&&issues.length===0;
    return {passed,canFinalize:passed,factsVerified:false,issues,unresolved:inspection.unresolved,unresolvedCritical:inspection.unresolvedCritical,sourceRevision:derived.sourceRevision,method:'structured-gap-delivery-v1'};
  }catch(error){issues.push(problem('gap-review-failed','资料缺口核查失败：'+String(error?.message||error)));return fail();}
}

// Only the exact server-generated limitation sentence is not a project numeric
// assertion. This copy is used solely by numeric auditing; all other checks and
// the immutable original continue to inspect the complete, unchanged prose.
export function deliveryGapNumericSnapshot(snapshot){
  const quality=deliveryGapQuality(snapshot);if(!quality?.passed)return snapshot;
  const ctx=gapContext(snapshot),derived=workflow.create(ctx),result=clone(snapshot);
  for(const chapter of result.chapters||[])for(const section of chapter.sections||[]){
    const key=String(chapter.name)+' / '+String(section.title),presentation=workflow.section(derived.registry,key,{projectKey:ctx.projectKey,sourceRevision:derived.sourceRevision,trustedApprovals:ctx.trustedApprovals||[]});
    // No red markers, freely authored variants, repeated occurrences, detached
    // strings or broad numeric patterns are exempted.
    for(const ref of presentation.references||[])if(ref.ownerSection===key&&section.content.split(ref.text).length===2)section.content=section.content.replace(ref.text,'〔资料核验边界已逐字核对〕');
  }
  return result;
}
