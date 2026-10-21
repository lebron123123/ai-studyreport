import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {TAX94_RECOVERY as p,reconcileTax94NotDispatched,browserPrepareTax94Analysis,prepareTax94Slots,tax94AnalysisRequest,applyTax94Analyses,tax94ConsumptionPath} from '../scripts/report-tax94-recovery.mjs';
const dir=new URL('../outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5/generation-runner/tax/recovery/',import.meta.url);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
async function fixture(){
  const beforeBytes=await fs.readFile(new URL(p.beforeName,dir)),queueBytes=await fs.readFile(new URL(p.queueName,dir)),before=JSON.parse(beforeBytes),free=JSON.parse(await fs.readFile(new URL('free-protocol-9.4-1791617798838.json',dir)));
  return {beforeBytes,queueBytes,task:free.task,dbRows:[{id:p.taskId,project_id:p.projectId,user_id:'fixture-owner',section_key:p.sectionKey,input_hash:p.inputHash,run_id:p.runId}],expectedUserId:'fixture-owner',currentSection:before.originalSection,financialSourceSignature:before.originalSection.pendingRevision.completionFinancialSource.sourceSignature,sourceUnchanged:{tax:true,longgang:true},paidState:{scanComplete:true,checkpointStatus:'failed',rawFiles:[],afterFiles:[],paidIntentFiles:[],uncertainRequests:[],consumptionReceipts:[]}};
}
async function prepared(){
  const e=await fixture(),cell=(tag,value)=>'<'+tag+'>'+value+'</'+tag+'>',rows=[p.headers,...p.rows];
  const table='<table data-report-calc-kind="sensitivity" data-report-calc-snapshot="'+p.snapshotId+'" data-report-calc-project="'+p.projectId+'">'+rows.map((r,i)=>'<tr>'+r.map(v=>cell(i?'td':'th',v)).join('')+'</tr>').join('')+'</table>';
  return prepareTax94Slots({projectId:p.projectId,notWritten:true,newPaidAiCalls:0,oldCandidate:e.currentSection.pendingRevision.after,financialBinding:{snapshotId:p.snapshotId,snapshotVersion:p.snapshotVersion,sourceSignature:e.financialSourceSignature},programTableHtml:table,programTableSha256:sha(table),programCells:rows});
}
test('browser preparation matches production type marker without relaxing financial source checks',async()=>{
  for(const changedAmount of [false,true]){
    const oldCandidate='retained candidate',source=JSON.stringify({amount:123,__ctype:'gaibao',sens:['s'],modeCompare:['m']}),policy={...p,candidateSha256:sha(oldCandidate),financialSourceSha256:sha(source)};
    const section={content:'',pendingRevision:{after:oldCandidate,completionFinancialSource:{sourceSignature:source}}},chapters=Array.from({length:9},()=>({sections:[]}));chapters[8].sections[3]=section;
    const params={amount:123},original=JSON.stringify({section,params}),cells=[p.headers,...p.rows],table={outerHTML:'<table>program</table>',rows:cells.map(row=>({cells:row.map(textContent=>({textContent}))}))};
    let boundResult;
    const sandbox={crypto:crypto.webcrypto,TextEncoder,currentProjectId:p.projectId,window:{__qaDispatchPaused:true},projectCanEdit:()=>true,chapters,calcParams:params,reportCandidateInputIdentity:()=> 'stable-input',
      runCalcEngine:(type,input)=>{assert.equal(type,'gaibao');assert.notEqual(input,params);return {amount:changedAmount?124:input.amount};},computeSensitivity:()=>['s'],computeModeCompare:()=>['m'],reportFinancialContext:()=>({}),
      ReportFinancialTables:{bindSource:({result})=>{boundResult=result;return {snapshotId:p.snapshotId,snapshotVersion:p.snapshotVersion,sourceSignature:JSON.stringify(result)};},prepare:()=>({updatedCount:1,entries:[{html:table.outerHTML}]})},
      document:{createElement:()=>({innerHTML:'',querySelector:()=>table,querySelectorAll:()=>[table]})}};
    const run=vm.runInNewContext('('+browserPrepareTax94Analysis.toString()+')',sandbox);
    if(changedAmount)await assert.rejects(run(policy),/Current adopted financial source changed/);
    else assert.equal((await run(policy)).notWritten,true);
    assert.equal(boundResult.__ctype,'gaibao');assert.equal(JSON.stringify({section,params}),original);
  }
});
test('exact retained empty plan and terminal response yield a non-dispatch declaration, not a paid receipt',async()=>{
  const declaration=reconcileTax94NotDispatched(await fixture());assert.equal(declaration.classification,'not-dispatched-empty-plan');assert.equal(declaration.newPaidAiCalls,0);assert.equal(declaration.notAnAfterReceipt,true);assert.match(tax94ConsumptionPath('recovery',declaration),/tax94-reconciliation-consumed-[a-f0-9]{64}\.json$/);
});
test('unknown request, existing intent, returned raw output, or consumed clearance always block',async()=>{
  for(const key of ['uncertainRequests','paidIntentFiles','rawFiles','afterFiles','consumptionReceipts']){const e=await fixture();e.paidState[key]=['retained-or-unknown'];assert.throws(()=>reconcileTax94NotDispatched(e),/prevents resubmission/);}
  const e=await fixture();e.paidState.scanComplete=false;assert.throws(()=>reconcileTax94NotDispatched(e),/not fully inspected/);
});
test('incomplete/changed task, candidate, source, owner and old receipt all block',async()=>{
  for(const mutate of [e=>e.task.status='running',e=>e.task.rawText+='changed',e=>e.currentSection.pendingRevision.after+='changed',e=>e.financialSourceSignature+='changed',e=>e.dbRows[0].user_id='other',e=>e.beforeBytes=Buffer.from('{}')]){const e=await fixture();mutate(e);assert.throws(()=>reconcileTax94NotDispatched(e));}
});
test('three prose slots have distinct positions, required order, canonical table and one gap statement',async()=>{
  const prep=await prepared();assert.equal(new Set(prep.plan.paragraphs.map(x=>x.start)).size,3);assert.deepEqual([...prep.seedHtml.matchAll(/<h3>(.*?)<\/h3>/g)].map(x=>x[1]),p.headings);assert.equal(prep.seedHtml.split(p.gapStatement).length,2);assert.equal(prep.oldCandidatePreserved,true);assert.equal(tax94AnalysisRequest(prep).targets.paragraphs.length,3);
  const prose='当前程序表反映的是限定条件下的已测方案比较，不能据此推定未测试情景同样安全。租金和出租率变化影响经营回收，成本上升压缩项目余量，仍须结合实际执行与资料核验持续跟踪。';
  const result=applyTax94Analyses(prep,{replacements:[...prep.plan.paragraphs].reverse().map(x=>({id:x.id,text:prose})),additions:[],tables:[]});assert.equal(result.notAccepted,true);assert.equal(result.semanticReviewRequired,true);assert.ok(result.after.includes(prep.programTableHtml));assert.deepEqual([...result.after.matchAll(/<h3>(.*?)<\/h3>/g)].map(x=>x[1]),p.headings);
});
test('altered numeric row is rejected even if the attacker updates the table hash and claimed cells',async()=>{
  const prep=await prepared(),bad={...prep,programTableHtml:prep.programTableHtml.replace('12.26','88.88'),programCells:structuredClone(prep.programCells)};bad.programCells[1][2]='88.88';bad.programTableSha256=sha(bad.programTableHtml);assert.throws(()=>prepareTax94Slots(bad),/Canonical program values/);
});
test('AI cannot change table/headings, invent numeric break-even, omit or duplicate a slot',async()=>{
  const prep=await prepared(),prose='当前仅能根据已测情景说明变化方向与经营风险，尚未形成盈亏平衡临界点的独立求解结果，不能把情景净现值为正等同于所有条件均可承受。后续需要按同一测算口径核验临界条件并保留资料待核验边界。',response={replacements:prep.plan.paragraphs.map(x=>({id:x.id,text:prose})),additions:[],tables:[]};
  for(const mutate of [r=>r.replacements[0].text+='盈亏平衡出租率为15.1%。',r=>r.replacements.pop(),r=>r.replacements[1].id=r.replacements[0].id,r=>r.additions.push({id:'new',text:prose}),r=>r.tables.push({id:'table'}),r=>r.replacements[0].text='<table>改表</table>']){const r=structuredClone(response);mutate(r);assert.throws(()=>applyTax94Analyses(prep,r));}
});
