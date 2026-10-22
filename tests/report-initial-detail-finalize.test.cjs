const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../report-completion-contract.js'),A=require('../report-argument.js'),MD=require('../md.js'),L=require('../report-length-plan.js');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
const code=source.slice(source.indexOf('async function reportFinalizeInitialDeliveryDetails('),source.indexOf('function reportCompletionReviewHtml('))+'\n'+source.slice(source.indexOf('function reportSummarySourceSnapshot('),source.indexOf('function reportPrepareSummaryContext('));
const copy=x=>structuredClone(x),table='<table><tr><th>项目</th><th>面积</th></tr><tr><td>甲</td><td>5973</td></tr></table>';
async function fixture({oversized}={}){
  const chapters=[{name:'经营分析',checked:true,sections:oversized?Array.from({length:32},(_,i)=>({t:'经营事项'+i,content:oversized==='context'?'<p>完整事实待核实。</p>'.repeat(400):'甲'.repeat(3500)+'；原协议尚待核实。'})):[{t:'规模台账',content:'范围尚待核实。\n\n'+table},{t:'运营边界',content:'消防条件未落实前不得投入运营。'}]},{name:'总论',checked:true,sections:[{t:'结论',content:''}]}];
  const lengthPlan=oversized?{...L.createPlan(chapters,{proseTotal:84500,targetPages:120}),confirmedAt:'2026-10-13T08:00:00.000Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary({}).fingerprint}}:undefined;
  const plan=C.createPlan(chapters,{lengthPlan}),keys=plan.sections.slice(0,chapters[0].sections.length).map(c=>c.sectionKey);
  for(const [i,s] of chapters[0].sections.entries()){
    s.completionContract=await C.bindFrozenTables({...copy(plan.sections[i]),planId:'generated-'+i},s.content,'original-source-'+i);
    s.completionQuality={status:'passed',factsVerified:false};s.executionTask={id:'task-'+i,qualityContract:copy(s.completionContract)};
  }
  let checks=0,financial=[];
  const ctx={chapters,ReportArgument:A,ReportCompletionContract:C,MD,currentProjectId:'[系统测试]finalize',
    ensureReportTableTemplates:async()=>{},reportCompletionPlan:()=>copy(plan),reportAssertCompletionPlan:p=>p,
    renderContent:t=>MD.renderHtml(t),sectionFormalTemplates:()=>[],reportCandidateInputIdentity:()=> 'same-input',
    reportVerifyBasisMaterials:async()=>{},reportFinancialCandidateIssues:candidate=>typeof financial==='function'?financial(candidate):financial};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);
  const assertCurrent=async()=>{checks++;};
  return {ctx,chapters,plan,keys,checks:()=>checks,setFinancial:v=>financial=v,
    run:(ownedKeys=keys,guard=assertCurrent)=>ctx.reportFinalizeInitialDeliveryDetails({ownedKeys,assertCurrent:guard})};
}
const contracts=f=>JSON.stringify(f.chapters.map(c=>c.sections.map(s=>[s.completionContract,s.completionQuality])));
test('本轮明细按当前要求重新全量核对后统一，实际正文、任务原回执和冻结表不变',async()=>{
  const f=await fixture(),original=f.chapters[0].sections.map(s=>({content:s.content,task:copy(s.executionTask),frozen:copy(s.completionContract.frozenTables)}));
  const result=await f.run();assert.equal(result.changed,true);assert.deepEqual(Array.from(result.sectionKeys),f.keys);assert.ok(f.checks()>8);
  f.chapters[0].sections.forEach((s,i)=>{assert.equal(s.completionContract.planId,f.plan.planId);assert.equal(s.content,original[i].content);assert.deepEqual(s.executionTask,original[i].task);assert.deepEqual(s.completionContract.frozenTables,original[i].frozen);});
  assert.match(A.summaryContext(f.chapters,'总论','结论',{completionPlan:f.plan,requireCurrentContracts:true}),/5973/);
});
test('保护的旧明细不重绑：不匹配则整批拒绝，匹配则只更新本轮明细',async()=>{
  const f=await fixture(),before=contracts(f);await assert.rejects(f.run([f.keys[0]]),e=>e.code==='REPORT_SUMMARY_CONTRACT_MISMATCH');assert.equal(contracts(f),before);
  const protectedSection=f.chapters[0].sections[1];protectedSection.completionContract={...protectedSection.completionContract,planId:f.plan.planId};protectedSection.locked=true;
  const protectedBefore=JSON.stringify(protectedSection);const result=await f.run([f.keys[0]]);
  assert.deepEqual(Array.from(result.sectionKeys),[f.keys[0]]);assert.equal(JSON.stringify(protectedSection),protectedBefore);
});
test('空白、候选、失败、锁定、错误身份不能被当前计划号洗成已通过',async t=>{
  const mutations={empty:s=>s.content='',candidate:s=>s.pendingRevision={after:'未接受的新稿'},failure:s=>s.generationFailure={message:'尚未完成'},locked:s=>s.locked=true,key:s=>s.completionContract.sectionKey='其他项目 / 错误'};
  for(const [name,mutate] of Object.entries(mutations))await t.test(name,async()=>{const f=await fixture();mutate(f.chapters[0].sections[1]);const before=contracts(f);await assert.rejects(f.run());assert.equal(contracts(f),before);});
});
test('旧冻结表被改数值或当前新增必要事实缺失，拒绝全部写入',async t=>{
  await t.test('frozen',async()=>{const f=await fixture();f.chapters[0].sections[0].content=f.chapters[0].sections[0].content.replace('5973','7973');const before=contracts(f);await assert.rejects(f.run(),/原生成要求不符/);assert.equal(contracts(f),before);});
  await t.test('new fact',async()=>{const f=await fixture();f.plan.sections[1].requiredFacts=[{key:'term',label:'经营期限',value:'6年',status:'confirmed',required:true,owner:f.keys[1],source:'原协议'}];const before=contracts(f);await assert.rejects(f.run(),/当前明细仍需核对/);assert.equal(contracts(f),before);});
});
test('财务检查不能被通用正文检查通过掩盖',async()=>{const f=await fixture();f.setFinancial([{severity:'error',message:'测算已变化'}]);const before=contracts(f);await assert.rejects(f.run(),/测算已变化/);assert.equal(contracts(f),before);});
test('保留的旧明细财务来源变了，即使合同匹配也拒绝整批且不改旧稿',async()=>{
  const f=await fixture(),protectedSection=f.chapters[0].sections[1];
  protectedSection.completionContract={...protectedSection.completionContract,planId:f.plan.planId};protectedSection.locked=true;
  f.setFinancial(candidate=>candidate.completionContract.sectionKey===f.keys[1]?[{severity:'error',message:'旧财务测算已失效'}]:[]);
  const before=contracts(f),protectedBefore=JSON.stringify(protectedSection);
  await assert.rejects(f.run([f.keys[0]]),/保留明细的财务来源仍需核对.*旧财务测算已失效/);
  assert.equal(contracts(f),before);assert.equal(JSON.stringify(protectedSection),protectedBefore);
});
test('异步等待期间真实来源变化或运行身份变化，未提交的合同全部保留',async t=>{
  await t.test('source',async()=>{const f=await fixture(),before=contracts(f);let calls=0;await assert.rejects(f.run(f.keys,async()=>{if(++calls===6)f.chapters[0].sections[1].content+=' 新条款。';}),/已变化/);assert.equal(contracts(f),before);});
  await t.test('ownership',async()=>{const f=await fixture(),before=contracts(f);let calls=0;await assert.rejects(f.run(f.keys,async()=>{if(++calls===9)throw Error('已切换项目');}),/已切换项目/);assert.equal(contracts(f),before);});
});
test('重复或未知本轮小节身份拒绝；不能依赖会补表的渲染投影替代正文',async()=>{
  const f=await fixture(),before=contracts(f);await assert.rejects(f.run([f.keys[0],f.keys[0]]),/身份不完整/);await assert.rejects(f.run(['其他 / 小节']),/目录已变化/);
  f.ctx.reportCompletionEntries=()=>{throw Error('禁止拿补齐后的投影冒充正文');};await f.run();assert.notEqual(contracts(f),before);
});
test('超长明细可先核对进入精简，但真正摘要仍严格拒绝同一全文，不截断正文或改写原任务',async t=>{
  for(const [oversized,code] of [['prose','REPORT_SUMMARY_DOCUMENT_BUDGET'],['context','REPORT_SUMMARY_CONTEXT_BUDGET']])await t.test(oversized,async()=>{
    const f=await fixture({oversized}),before=f.chapters[0].sections.map(s=>({content:s.content,task:copy(s.executionTask)}));
    const result=await f.run();assert.equal(result.changed,true);assert.equal(result.sectionKeys.length,32);
    f.chapters[0].sections.forEach((s,i)=>{assert.equal(s.content,before[i].content);assert.deepEqual(s.executionTask,before[i].task);});
    assert.throws(()=>A.summaryContext(f.chapters,'总论','结论',{completionPlan:f.plan,requireCurrentContracts:true}),error=>error.code===code);
  });
});
test('超长不能掩盖当前事实缺失、合同失配或来源变化',async t=>{
  for(const kind of ['fact','contract','source'])await t.test(kind,async()=>{
    const f=await fixture({oversized:'prose'});let owned=f.keys;
    if(kind==='fact')f.plan.sections[1].requiredFacts=[{key:'term',label:'经营期限',value:'6年',status:'confirmed',required:true,owner:f.keys[1],source:'原协议'}];
    if(kind==='contract')owned=f.keys.slice(1);
    const before=contracts(f);let calls=0;
    await assert.rejects(f.run(owned,async()=>{if(kind==='source'&&++calls===6)f.chapters[0].sections[1].content+=' 新条款。';}));
    assert.equal(contracts(f),before);
  });
});
