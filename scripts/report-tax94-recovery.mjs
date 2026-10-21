// Test-copy-only recovery preparation. No main(), network request, file write or adoption.
import crypto from 'node:crypto';
import path from 'node:path';
import {applyBoundedEdits} from './report-runner-bounded-repair.mjs';

export const TAX94_RECOVERY=Object.freeze({
  key:'tax:9.4',projectId:'f4395f64-af1b-43bd-b809-580b5ec9406b',sectionKey:'财务评价 / 不确定性分析',
  taskId:'rsec_346fe1fb13e5b52a861a4f0db201e5ac2bb337e8da6df6e3eb49f749eb86e90d',runId:'run_6ef14d8f-7596-4570-91ad-5f6e1e73c868',inputHash:'72bbf44d8bb9323d9fee8016c133f04c864f58ea1641185572cfeafc0a432c05',
  beforeName:'bounded-before-9.4-1791618434644-301c37.json',beforeSha256:'0e647a40dea8a825a22f1c48468ff37e4206d9846dcac36304875d2bb9204d0f',
  queueName:'bounded-shared-queue-receipt-1791618475235-e2c6c4.json',queueSha256:'0917a8b6bbc29d349284afb5823452aa9d5915dd6a02aae25f3ce75051dd2c74',
  candidateSha256:'67b506baed703a45ed001edd83b2d16dbd7029fa88829177dbb7efb15c03c909',rawSha256:'9287c2b3bc0542bc16e86305b9172ac20e7c3c6378a457186c2294313b04667f',
  financialSourceSha256:'5619d0e69a41c4326b5861f12643742fd785cee82019a7ff7700a88bdb93d159',
  snapshotId:'calc-1dc5e998-e7ca-4e06-917b-5dba647cb0bb',snapshotVersion:5,
  headings:Object.freeze(['敏感性分析','盈亏平衡分析','敏感性与不确定性分析']),
  headers:Object.freeze(['敏感因素','波动幅度','全投资IRR（%）','累计净现值（万元）']),
  rows:Object.freeze([
    ['基准方案','—','12.26','91.02'],['租金','+10%','16.08','134.39'],['租金','−10%','8.29','47.1'],
    ['出租率','+5个百分点','14.65','117.73'],['出租率','−5个百分点','9.81','63.88'],
    ['运营成本','+10%','11.27','80.02'],['装修造价','+10%','8.66','56.21']
  ].map(Object.freeze)),
  gapStatement:'敏感性与不确定性分析资料待核验，相关判断暂不作确定性结论。'
});
const sha=value=>crypto.createHash('sha256').update(Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fileName=value=>String(value||'').replace(/\\/g,'/').split('/').at(-1);

// The caller must supply fresh GET/DB observations and a complete recovery-directory scan.
// This returns a declaration, NOT permission to resend a request or an invented after receipt.
export function reconcileTax94NotDispatched(evidence){
  const p=TAX94_RECOVERY,{beforeBytes,queueBytes,task,dbRows,currentSection,financialSourceSignature,paidState}=evidence||{};
  assert(beforeBytes&&sha(beforeBytes)===p.beforeSha256,'Old before receipt SHA changed');
  assert(queueBytes&&sha(queueBytes)===p.queueSha256,'Old queue receipt SHA changed');
  const before=JSON.parse(beforeBytes),queue=JSON.parse(queueBytes);
  assert(before.key==='tax'&&before.number==='9.4'&&before.section?.executionTask?.id===p.taskId,'Old before identity changed');
  assert(['paragraphs','headings','tables'].every(k=>Array.isArray(before.plan?.[k])&&!before.plan[k].length),'Old bounded plan was not empty; dispatch is uncertain');
  const rows=queue.receipts?.filter(row=>row.key==='tax'&&row.number==='9.4');
  assert(rows?.length===1&&rows[0].status==='blocked'&&rows[0].error?.code==='bounded-target-unavailable'&&fileName(rows[0].beforeFile)===p.beforeName&&queue.remainingPaidRunning===0,'No exact non-dispatch queue receipt');
  assert(Array.isArray(dbRows)&&dbRows.length===1,'Existing task registry is ambiguous');
  const row=dbRows[0];
  assert(row.id===p.taskId&&row.project_id===p.projectId&&row.section_key===p.sectionKey&&row.run_id===p.runId&&row.input_hash===p.inputHash,'DB task identity changed');
  assert(evidence.expectedUserId&&String(row.user_id)===String(evidence.expectedUserId),'DB task owner changed or was not checked');
  assert(task?.id===p.taskId&&task.runId===p.runId&&task.status==='completed'&&task.rulesChanged===false&&task.graph?.find(n=>n.key==='context_snapshot')?.hash===p.inputHash,'Old task is incomplete, uncertain or changed; GET only');
  assert(task.usage?.status==='settled'&&sha(task.text||'')===p.candidateSha256&&sha(task.rawText||'')===p.rawSha256&&sha(task.structuredText||'')===p.rawSha256,'Old response/settlement changed; inspect before retry');
  assert(currentSection&&!currentSection.locked&&!String(currentSection.editedHtml||currentSection.content||'').trim()&&sha(currentSection.pendingRevision?.after||'')===p.candidateSha256,'Current body/candidate changed');
  assert(!currentSection.executionTask?.id||currentSection.executionTask.id===p.taskId,'Current task changed');
  assert(sha(financialSourceSignature||'')===p.financialSourceSha256&&currentSection.pendingRevision?.completionFinancialSource?.sourceSignature===financialSourceSignature,'Frozen financial source changed');
  assert(evidence.sourceUnchanged?.tax===true&&evidence.sourceUnchanged?.longgang===true,'Formal source changed or was not checked');
  assert(paidState?.scanComplete===true&&paidState.checkpointStatus!=='running','Paid state was not fully inspected');
  for(const key of ['rawFiles','afterFiles','paidIntentFiles','uncertainRequests','consumptionReceipts'])assert(Array.isArray(paidState[key])&&paidState[key].length===0,'Retained or unknown paid result prevents resubmission: '+key);
  const declaration={version:'tax94-not-dispatched-empty-plan-v1',classification:'not-dispatched-empty-plan',key:p.key,projectId:p.projectId,oldTaskId:p.taskId,oldRunId:p.runId,oldInputHash:p.inputHash,beforeFileSha256:p.beforeSha256,queueFileSha256:p.queueSha256,candidateSha256:p.candidateSha256,rawTextSha256:p.rawSha256,financialSourceSignatureSha256:p.financialSourceSha256,taskStatus:task.status,notAnAfterReceipt:true,newPaidAiCalls:0};
  return {...declaration,declarationSha256:sha(declaration)};
}

// Export for page.evaluate. Computes into local variables/DOM clones only; no global/project writes.
export async function browserPrepareTax94Analysis(policy){
  if(currentProjectId!==policy.projectId||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Exact paused editable test copy required');
  const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
  const section=chapters[8]?.sections[3],oldCandidate=section?.pendingRevision?.after||'',originalSectionJson=JSON.stringify(section),sourceIdentity=reportCandidateInputIdentity();
  if(!section||section.locked||String(section.editedHtml||section.content||'').trim()||await digest(oldCandidate)!==policy.candidateSha256)throw Error('Current candidate changed');
  const result=runCalcEngine('gaibao',JSON.parse(JSON.stringify(calcParams)));
  // Match the production report calculation entry: the engine returns values,
  // while its caller owns the calculation-type marker used in source binding.
  result.__ctype='gaibao';
  result.sens=computeSensitivity(calcParams);result.modeCompare=computeModeCompare(calcParams);
  const context={...reportFinancialContext(),result},binding=ReportFinancialTables.bindSource(context);
  if(binding.snapshotId!==policy.snapshotId||binding.snapshotVersion!==policy.snapshotVersion||await digest(binding.sourceSignature)!==policy.financialSourceSha256||section.pendingRevision.completionFinancialSource?.sourceSignature!==binding.sourceSignature)throw Error('Current adopted financial source changed');
  const generated=ReportFinancialTables.prepare([{key:policy.sectionKey,html:'<table data-report-calc-kind="sensitivity"></table>'}],context);
  if(generated.updatedCount!==1)throw Error('Production sensitivity table was not generated');
  const box=document.createElement('div');box.innerHTML=generated.entries[0].html;
  const table=box.querySelector('table');
  if(!table||box.querySelectorAll('table').length!==1)throw Error('Ambiguous production table');
  const cells=Array.from(table.rows,row=>Array.from(row.cells,cell=>cell.textContent));
  if(JSON.stringify(cells)!==JSON.stringify([policy.headers,...policy.rows]))throw Error('Production sensitivity values changed');
  const programTableSha256=await digest(table.outerHTML);
  if(currentProjectId!==policy.projectId||JSON.stringify(chapters[8]?.sections[3])!==originalSectionJson||reportCandidateInputIdentity()!==sourceIdentity||!projectCanEdit())throw Error('Section/source changed during preparation');
  return {version:'tax94-production-analysis-preparation-v1',projectId:policy.projectId,oldCandidate,originalSection:JSON.parse(originalSectionJson),sourceIdentity,financialBinding:binding,programTableHtml:table.outerHTML,programCells:cells,programTableSha256,notWritten:true,newPaidAiCalls:0};
}

const textOf=html=>String(html).replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
export function prepareTax94Slots(prepared){
  const p=TAX94_RECOVERY;
  assert(prepared?.projectId===p.projectId&&prepared.notWritten===true&&prepared.newPaidAiCalls===0,'Use read-only production preparation');
  assert(sha(prepared.oldCandidate||'')===p.candidateSha256&&sha(prepared.financialBinding?.sourceSignature||'')===p.financialSourceSha256,'Candidate or financial source changed');
  assert(prepared.financialBinding.snapshotId===p.snapshotId&&prepared.financialBinding.snapshotVersion===p.snapshotVersion,'Adopted snapshot changed');
  const html=prepared.programTableHtml||'',matches=[...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)],cells=matches.map(row=>[...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cell=>textOf(cell[1])));
  assert(/^<table\b/i.test(html)&&/<\/table>\s*$/i.test(html)&&[...html.matchAll(/<table\b/gi)].length===1,'Expected exactly one production table');
  assert(sha(html)===prepared.programTableSha256&&same(cells,[p.headers,...p.rows])&&same(prepared.programCells,cells),'Canonical program values/table changed');
  assert(html.includes('data-report-calc-kind="sensitivity"')&&html.includes('data-report-calc-snapshot="'+p.snapshotId+'"')&&html.includes('data-report-calc-project="'+p.projectId+'"'),'Production table ownership missing');
  let seedHtml='',paragraphs=[];
  p.headings.forEach((title,i)=>{
    seedHtml+='<h3>'+title+'</h3>';
    if(i===0)seedHtml+='<figure data-qa-tax94-program-table="true"><figcaption>敏感性分析表</figcaption>'+html+'</figure>';
    const open='<p data-qa-tax94-analysis-slot="'+i+'">',original=open+'【分析槽 '+i+'】</p>',start=seedHtml.length;
    paragraphs.push({id:'tax94-analysis-'+i,start,end:start+original.length,original,html:true,open,close:'</p>'});seedHtml+=original;
  });
  seedHtml+='<p data-qa-tax94-gap="true">'+p.gapStatement+'</p>';
  assert(new Set(paragraphs.map(x=>x.start)).size===3,'Analysis slots must have distinct positions');
  return {...prepared,seedHtml,seedSha256:sha(seedHtml),plan:{paragraphs,headings:[],tables:[]},oldCandidatePreserved:true,semanticReviewRequired:true};
}

export function tax94AnalysisRequest(prepared){
  assert(prepared?.plan?.paragraphs?.length===3&&sha(prepared.seedHtml)===prepared.seedSha256,'Prepared slots changed');
  return {section:'9.4',targets:prepared.plan,instruction:'只输出三个 replacements 分析段，additions 和 tables 必须为空。每段至少六十字，只作定性比较，不重复任何阿拉伯数字；数字以程序冻结表为准。顺序为敏感性分析、盈亏平衡分析、敏感性与不确定性分析。仅解释表中已测情景，不扩展保证；当前未求解盈亏平衡临界值，绝不编造、插值或引用其他项目阈值。未知事实仍待核验，不重复缺口限制句。',originalContext:prepared.seedHtml,responseSchema:{replacements:prepared.plan.paragraphs.map(x=>({id:x.id,text:'实质分析文字'})),additions:[],tables:[]},financialSourceSignatureSha256:TAX94_RECOVERY.financialSourceSha256};
}

export function applyTax94Analyses(prepared,response){
  const p=TAX94_RECOVERY;
  assert(prepared?.plan?.paragraphs?.length===3&&sha(prepared.seedHtml)===prepared.seedSha256,'Prepared slots changed');
  assert(response&&Array.isArray(response.replacements)&&response.replacements.length===3&&Array.isArray(response.additions)&&!response.additions.length&&Array.isArray(response.tables)&&!response.tables.length,'Exactly three prose replacements only');
  for(const item of response.replacements)assert(typeof item.text==='string'&&item.text.trim().length>=60&&!/[0-9０-９]/.test(item.text)&&!item.text.includes(p.gapStatement),'Analysis must be substantive qualitative prose without invented/repeated numbers or gap duplication');
  const result=applyBoundedEdits(prepared.seedHtml,prepared.plan,response);
  assert(result.after.includes(prepared.programTableHtml),'Program-owned table changed');
  assert(same([...result.after.matchAll(/<h3>(.*?)<\/h3>/g)].map(x=>x[1]),p.headings),'Heading order changed');
  assert(result.after.split(p.gapStatement).length===2&&!result.after.includes('【分析槽 '),'Gap statement/analysis slots invalid');
  return {...result,oldCandidateSha256:p.candidateSha256,programTableSha256:prepared.programTableSha256,financialSourceSignatureSha256:p.financialSourceSha256,semanticReviewRequired:true,notAccepted:true};
}

// Controller must atomically create this *before* its fixed paid intent, and never reuse it.
export function tax94ConsumptionPath(recoveryDirectory,declaration){
  const p=TAX94_RECOVERY;
  assert(declaration?.classification==='not-dispatched-empty-plan'&&declaration.key===p.key&&declaration.projectId===p.projectId&&declaration.oldTaskId===p.taskId&&declaration.oldRunId===p.runId&&declaration.oldInputHash===p.inputHash&&declaration.beforeFileSha256===p.beforeSha256&&declaration.queueFileSha256===p.queueSha256&&declaration.candidateSha256===p.candidateSha256&&declaration.financialSourceSignatureSha256===p.financialSourceSha256&&declaration.taskStatus==='completed'&&declaration.notAnAfterReceipt===true&&declaration.newPaidAiCalls===0,'Exact reconciliation declaration required');
  const {declarationSha256,...unsigned}=declaration;assert(sha(unsigned)===declarationSha256,'Reconciliation declaration changed');
  return path.join(recoveryDirectory,'tax94-reconciliation-consumed-'+declarationSha256+'.json');
}
