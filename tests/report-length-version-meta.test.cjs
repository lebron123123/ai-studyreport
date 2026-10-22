'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../project-workflow.js'),C=require('../report-completion-contract.js'),L=require('../report-length-plan.js');
const reportSource=fs.readFileSync(require.resolve('../report.js'),'utf8');
const start=reportSource.indexOf('function currentReportVersionMeta('),end=reportSource.indexOf('function bindProvToggle(',start);
assert.ok(start>=0&&end>start,'版本元数据入口存在');
const metaSource=reportSource.slice(start,end);
const lengthUiSource=fs.readFileSync(require.resolve('../report-length-ui.js'),'utf8');
const planStart=reportSource.indexOf('function reportCompletionPlan('),planEnd=reportSource.indexOf('async function reportBasisMaterialItems(',planStart);
assert.ok(planStart>=0&&planEnd>planStart,'完成复核的真实计划入口存在');
const completionPlanSource=reportSource.slice(planStart,planEnd);
const clone=value=>JSON.parse(JSON.stringify(value));

function fixture(total=75000){
  const chapters=[{cn:'一',name:'业务分析',checked:true,sections:Array.from({length:43},(_,i)=>({t:'业务主题'+i}))},
    {cn:'二',name:'未启用附件',checked:false,sections:[{t:'附件',content:'不'.repeat(100000)}]}];
  const plan={...L.createPlan(chapters),confirmedAt:'2026-10-09T12:00:00Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary({}).fingerprint}};
  const workflow=W.ensureState({reportCompletion:{lengthPlan:plan}});
  const ctx={chapters,projectWorkflow:workflow,project:{name:'[系统测试]篇幅版本元数据'},calcParams:{},kbEntries:[],
    ReportCompletionContract:C,ReportLengthPlan:L,ProjectWorkflow:W};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(lengthUiSource+'\n'+metaSource,ctx);
  const setTotal=actual=>{
    let left=actual;chapters[0].sections.forEach((s,i)=>{const count=i===42?left:Math.floor(actual*plan.sections[i].target/plan.totalTarget);left-=count;s.content=String.fromCodePoint(0x4e00+i).repeat(count);delete s.editedHtml;});
  };
  setTotal(total);return {ctx,chapters,workflow,plan,setTotal,meta:reason=>ctx.currentReportVersionMeta(reason)};
}

test('版本入口按正式正文计数：候选、未选章节和大表格都不能抬高字数',()=>{
  const f=fixture(50000),section=f.chapters[0].sections[0],before=section.content.length;
  section.pendingRevision={after:'候'.repeat(100000)};
  let meta=f.meta('保存当前阶段');assert.equal(meta.lengthDelivery.actual,50000);assert.equal(meta.lengthDelivery.status,'short');
  section.editedHtml='<p>甲乙</p><table><tr><td>'+('表'.repeat(50000))+'</td></tr></table>';
  meta=f.meta();assert.equal(meta.lengthDelivery.actual,50000-before+2);assert.equal(meta.lengthDelivery.target,75000);
  assert.equal(meta.lengthDelivery.min,67500);assert.equal(meta.lengthDelivery.max,82500);assert.equal(meta.lengthDelivery.planId,f.plan.planId);
  assert.equal(section.pendingRevision.after.length,100000);assert.equal(f.chapters[1].sections[0].content.length,100000);
});

test('统一版本元数据能区分短稿、正常范围、超量、缺节，不对未确认旧稿追认承诺',()=>{
  const f=fixture();
  for(const [actual,status] of [[67499,'short'],[67500,'within-range'],[75000,'within-range'],[82500,'within-range'],[82501,'over']]){
    f.setTotal(actual);const meta=f.meta();assert.equal(meta.lengthDelivery.status,status);assert.equal(meta.lengthDelivery.actual,actual);
  }
  f.chapters[0].sections[0].content='';assert.equal(f.meta().lengthDelivery.status,'incomplete');
  delete f.plan.confirmedAt;assert.equal(f.meta().lengthDelivery,undefined);
  delete f.workflow.reportCompletion.lengthPlan;assert.equal(f.meta().lengthDelivery,undefined);
});

test('版本保存克隆篇幅结果；只变化核对时间不造新版，交付结果变化不得误去重',()=>{
  const f=fixture(50000),meta=f.meta('保存短稿'),first=W.createReportVersion(f.workflow,f.chapters,meta);
  assert.equal(first.lengthDelivery.status,'short');assert.equal(first.lengthDelivery.actual,50000);
  meta.lengthDelivery.actual=1;assert.equal(first.lengthDelivery.actual,50000,'外部元数据修改不污染保存版本');
  const repeat=f.meta('再次保存');repeat.lengthDelivery.checkedAt='2026-10-09T14:00:00Z';
  assert.equal(W.createReportVersion(f.workflow,f.chapters,repeat).id,first.id);assert.equal(f.workflow.reportVersions.length,1);
  const changed=f.meta();changed.lengthDelivery.planId='[系统测试]不同确认计划';
  const second=W.createReportVersion(f.workflow,f.chapters,changed);assert.notEqual(second.id,first.id);assert.equal(f.workflow.reportVersions.length,2);
  const corrected=f.meta();corrected.lengthDelivery.status='incomplete';
  assert.notEqual(W.createReportVersion(f.workflow,f.chapters,corrected).id,second.id);
});

test('上一完整版本不选短稿、超量、缺节或部分更新，旧版无篇幅元数据继续可读',()=>{
  const f=fixture(),legacy={id:'[系统测试]旧完整V9',version:9,chapters:clone(f.chapters)};
  f.workflow.reportVersions=[legacy];f.workflow.currentReportVersionId=legacy.id;
  f.setTotal(50000);const short=W.createReportVersion(f.workflow,f.chapters,f.meta());
  assert.equal(W.latestCompleteReportVersion(f.workflow,short.id).id,legacy.id);
  f.setTotal(85000);const over=W.createReportVersion(f.workflow,f.chapters,f.meta());
  assert.equal(W.latestCompleteReportVersion(f.workflow,over.id).id,legacy.id);
  f.setTotal(75000);f.chapters[0].sections[0].content='';const missing=W.createReportVersion(f.workflow,f.chapters,f.meta());
  assert.equal(W.latestCompleteReportVersion(f.workflow,missing.id).id,legacy.id);
  f.setTotal(75000);const partial=W.createReportVersion(f.workflow,f.chapters,f.meta());partial.candidateBatchAcceptance={status:'partial',unresolved:9};
  assert.equal(W.latestCompleteReportVersion(f.workflow,partial.id).id,legacy.id);
  f.workflow.currentReportVersionId=legacy.id; // 独立完整保存用例；不能隐式抹掉上一轮尚未解决的部分更新。
  f.setTotal(74999);const full=W.createReportVersion(f.workflow,f.chapters,f.meta());assert.equal(W.latestCompleteReportVersion(f.workflow,full.id).id,full.id);
  assert.equal(legacy.lengthDelivery,undefined);assert.equal(legacy.chapters[0].sections[0].content.length,f.plan.sections[0].target);
});

test('保存再恢复仍重新查正式正文，候选不变成已交付字数，保存的短稿不冒充完整版本',()=>{
  const f=fixture(50000);f.chapters[0].sections[0].pendingRevision={after:'候'.repeat(100000)};
  const stage=W.createReportVersion(f.workflow,f.chapters,f.meta());
  const reloaded=fixture();reloaded.ctx.chapters=clone(f.chapters);reloaded.ctx.projectWorkflow=clone(f.workflow);
  const current=reloaded.meta();assert.equal(current.lengthDelivery.actual,50000);assert.equal(current.lengthDelivery.status,'short');
  assert.equal(W.latestCompleteReportVersion(reloaded.ctx.projectWorkflow,stage.id),null);
  assert.equal(reloaded.ctx.chapters[0].sections[0].pendingRevision.after.length,100000);
});

test('真实完成复核入口保留已确认但失效的自定义目标，不因预算清空退回默认计划',()=>{
  const f=fixture(),budgets={'业务分析 / 业务主题0':{proseTarget:1600}};
  f.workflow.reportCompletion.budgets=budgets;
  f.workflow.reportCompletion.lengthPlan={...L.createPlan(f.chapters,{proseTotal:50000}),confirmedAt:'2026-10-09T12:00:00Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary(budgets).fingerprint}};
  Object.assign(f.ctx,{reportCompletionFacts:()=>[],rlProjectType:()=> 'gaibao',reportBusinessStructureBinding:()=>({version:'business-structure-v1',sourceHash:'empty',requiredHeadings:[]}),
    reportGenerationRulesIdentity:()=> 'system-test',reportFinancialIdentity:()=>null,
    reportCompletionEntries:()=>f.chapters.filter(c=>c.checked!==false).flatMap(c=>c.sections.map(s=>({key:c.name+' / '+s.t,text:s.editedHtml||s.content||''})))});
  vm.runInContext(completionPlanSource,f.ctx);
  assert.equal(f.ctx.ReportLengthUI.planStatus().status,'confirmed');
  f.workflow.reportCompletion.budgets={};
  const before=JSON.stringify(f.workflow),plan=f.ctx.reportCompletionPlan();
  assert.equal(plan.lengthPlanStatus.status,'stale-confirmed');assert.equal(plan.lengthPlanStatus.target,50000);
  const review=C.reviewDocument(f.ctx.reportCompletionEntries(),plan);
  assert.equal(review.lengthReview.status,'stale-plan');assert.equal(review.lengthReview.target,50000);
  assert.equal(review.status,'blocked');assert.equal(JSON.stringify(f.workflow),before,'复核不重新确认目标或改旧计划');
});

test('34/43部分更新后逐节接受不丢剩余问题；全部处理后才完整，撤销后再次待处理',()=>{
  const f=fixture(),rows=f.chapters[0].sections;
  const legacy=W.createReportVersion(f.workflow,f.chapters,f.meta('原完整稿'));
  rows.forEach(s=>assert.ok(W.setCandidate(s,s.content+'修订','[系统测试]本轮统一修订')));
  rows.slice(0,34).forEach(s=>assert.ok(W.acceptCandidate(s)));
  const partial=W.createReportVersion(f.workflow,f.chapters,f.meta('批量接受34节'));
  partial.candidateBatchAcceptance={schemaVersion:1,status:'partial',accepted:34,requested:43,unresolved:9,
    problems:rows.slice(34).map(s=>({sectionKey:f.chapters[0].name+' / '+s.t,issues:[{code:'candidate-pending',message:'尚待接受'}]}))};
  assert.equal(W.latestCompleteReportVersion(f.workflow,partial.id).id,legacy.id);
  assert.ok(W.acceptCandidate(rows[34]));
  let meta=f.meta('逐节接受第35节');
  assert.equal(meta.candidateBatchAcceptance.status,'partial');assert.equal(meta.candidateBatchAcceptance.unresolved,8);
  const single=W.createReportVersion(f.workflow,f.chapters,meta);
  assert.equal(single.lengthDelivery.status,'within-range');assert.equal(single.candidateBatchAcceptance.unresolved,8);
  assert.equal(W.latestCompleteReportVersion(f.workflow,single.id).id,legacy.id,'篇幅达标不能掩盖本轮未更新的8节');
  const repeated=W.createReportVersion(f.workflow,f.chapters,f.meta('重复保存'));
  assert.equal(repeated.id,single.id,'稳定的待处理清单不应重复造版');
  rows.slice(35).forEach(s=>assert.ok(W.acceptCandidate(s)));
  meta=f.meta('所有剩余节都已接受');
  assert.equal(meta.candidateBatchAcceptance.status,'scope-updated');assert.equal(meta.candidateBatchAcceptance.unresolved,0);
  const completed=W.createReportVersion(f.workflow,f.chapters,meta);
  assert.equal(W.latestCompleteReportVersion(f.workflow,completed.id).id,completed.id);
  assert.ok(W.undoSection(rows[34]));
  const undo=W.createReportVersion(f.workflow,f.chapters,f.meta('撤销第35节'));
  assert.equal(undo.candidateBatchAcceptance.status,'partial');assert.equal(undo.candidateBatchAcceptance.unresolved,1);
  assert.equal(undo.candidateBatchAcceptance.problems[0].sectionKey,f.chapters[0].name+' / '+rows[34].t);
  assert.equal(W.latestCompleteReportVersion(f.workflow,undo.id).id,completed.id,'撤销后的当前稿不冒充完成稿，上一完整版本仍保留');
  const reloaded=fixture();reloaded.ctx.chapters=clone(f.chapters);reloaded.ctx.projectWorkflow=clone(f.workflow);
  assert.equal(reloaded.meta().candidateBatchAcceptance.unresolved,1,'保存恢复不会忘掉未完成更新');
});
