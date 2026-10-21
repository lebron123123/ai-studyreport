const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const L=require('../report-length-plan.js'),C=require('../report-completion-contract.js'),policy=require('../report-output-policy.js');
function outline(){return [{name:'总论',sections:[{t:'编制依据'},{t:'项目事实'}]},{name:'市场',sections:Array.from({length:20},(_,i)=>({t:'需求分析'+i}))},{name:'风险与财务',sections:Array.from({length:21},(_,i)=>({t:'经营判断'+i,numeric:true}))}];}
test('旧正文预算摘要只作优先级确认，不删除或吸收表图限额，指纹随人工改动失效',()=>{
  const budgets={'市场 / 需求分析0':{proseTarget:800,proseMax:'1200',tableMax:5,reason:'保留旧人工审签'},'总论 / 项目事实':{tableRowsMax:40,reason:'表格尺寸'}};
  const before=JSON.stringify(budgets),s=L.legacyBudgetSummary(budgets);assert.equal(s.count,1);assert.equal(s.rows[0].proseTarget,'800');assert.equal(s.rows[0].proseMax,'1200');assert.equal(JSON.stringify(budgets),before);
  const same=structuredClone(budgets);same['市场 / 需求分析0'].tableMax=9;assert.equal(L.legacyBudgetSummary(same).fingerprint,s.fingerprint);
  same['市场 / 需求分析0'].proseTarget=900;assert.notEqual(L.legacyBudgetSummary(same).fingerprint,s.fingerprint);
  assert.equal(L.legacyBudgetSummary(null).count,0);
});
test('低高字数警戒由同一模型提供，只告警，不丢弃用户的正常目录目标',()=>{
  const chapters=outline(),low=L.createPlan(chapters,{targetPages:80,proseTotal:50000}),high=L.createPlan(chapters,{targetPages:150,proseTotal:100000});
  assert.equal(low.totalTarget,50000);assert.equal(high.totalTarget,100000);assert.ok(low.warnings.some(w=>w.code==='low-length-advisory'));assert.ok(high.warnings.some(w=>w.code==='high-length-advisory'));assert.ok([...low.warnings,...high.warnings].every(w=>w.severity==='warning'));
});
test('默认75000/120是可确认目标而非实际分页，完整分配精确、重点多于普通、依据低预算',()=>{
  const chapters=outline(),before=JSON.stringify(chapters),p=L.createPlan(chapters),s=L.summary(p);
  assert.equal(p.targetPages,120);assert.equal(p.proseTotal,75000);assert.equal(p.totalTarget,75000);assert.equal(p.lengthScope,'full-report');
  assert.equal(p.sections.reduce((n,s)=>n+s.target,0),75000);assert.equal(p.chapters.reduce((n,c)=>n+c.target,0),75000);
  assert.equal(p.sections[0].target,600);assert.ok(p.sections.at(-1).target>p.sections[1].target);
  assert.equal(p.estimatedPages,75000*105/73950);assert.ok(p.warnings.some(w=>w.code==='estimated-under-target'));
  assert.equal(s.actualPaginationRequired,true);assert.equal(s.professionalQualityVerified,false);assert.equal(p.maxPages,130);
  assert.deepEqual(s.targetPageRange,{min:110,max:130});assert.equal(s.planningPriority,'words');assert.equal(s.recommendedProseTotal,84500);
  assert.equal(p.chapters[0].estimatedStartPage,1);assert.ok(p.chapters.at(-1).estimatedEndPage>=106);
  assert.equal(JSON.stringify(chapters),before);assert.equal(L.validatePlan(p,chapters).valid,true);
});
test('页数优先按V9粗估校准，字数优先与显式字数保持原值，均不作为实际分页证据',()=>{
  const chapters=outline();assert.equal(L.DEFAULTS.proseTotal,75000);assert.equal(L.recommendedProse(120),84500);
  const pages=L.createPlan(chapters,{planningPriority:'pages'}),words=L.createPlan(chapters,{planningPriority:'words'}),explicit=L.createPlan(chapters,{planningPriority:'pages',proseTotal:50000});
  assert.equal(pages.proseTotal,84500);assert.equal(pages.totalTarget,84500);assert.deepEqual(pages.targetPageRange,{min:110,max:130});
  assert.equal(words.proseTotal,75000);assert.equal(explicit.proseTotal,50000);assert.equal(L.createPlan(chapters,{targetPages:80,planningPriority:'words',proseTotal:50000}).proseTotal,50000);
  assert.equal(L.recommendedProse(80),56500);assert.deepEqual(L.createPlan(chapters,{targetPages:80}).targetPageRange,{min:72,max:88});
  for(const plan of [pages,words,explicit]){assert.equal(L.validatePlan(plan,chapters).valid,true);assert.equal(plan.actualPaginationRequired,true);assert.equal(plan.professionalQualityVerified,false);}
  assert.notEqual(L.createPlan(chapters,{planningPriority:'pages',proseTotal:75000}).planId,words.planId);
  assert.throws(()=>L.createPlan(chapters,{planningPriority:'automatic'}),/优先项/);
});
test('v2旧确认计划不静默迁移，保留目标等待人工重确认；核对范围篡改不通过',()=>{
  const chapters=outline(),old={...L.createPlan(chapters,{targetPages:120,proseTotal:75000}),version:'20261008-confirmed-length-v2',confirmedAt:'2026-10-08T12:00:00Z'},before=JSON.stringify(old);
  assert.equal(L.validatePlan(old,chapters).valid,false);assert.equal(L.validatePlan(old,chapters).errors[0].code,'plan-version');assert.equal(JSON.stringify(old),before);
  const altered=L.createPlan(chapters);altered.targetPageRange.max=120;assert.equal(L.validatePlan(altered,chapters).valid,false);
});
test('目录和必要参数决定预算，材料和旧正文不扩张；浏览器与CommonJS同源',()=>{
  const chapters=outline(),p=L.createPlan(chapters),changed=structuredClone(chapters);changed.forEach(c=>c.sections.forEach(s=>{s.content='材料'.repeat(10000);s.materials=Array(100).fill('引用');}));
  assert.deepEqual(L.createPlan(changed),p);
  const box=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../report-length-plan.js'),'utf8'),box);
  assert.deepEqual(JSON.parse(JSON.stringify(box.ReportLengthPlan.createPlan(chapters))),p);
});
test('锁定章节目标后重分配其余章节，逐节合同和旧policy精确消费，人工预算仍优先',()=>{
  const chapters=outline(),p=L.createPlan(chapters,{targetPages:100,proseTotal:70000,chapterTargets:{总论:3000,市场:25000}});
  assert.equal(p.chapters[0].target,3000);assert.equal(p.chapters[1].target,25000);assert.equal(p.chapters[2].target,42000);assert.equal(p.totalTarget,70000);
  const confirmed={...p,confirmedAt:'2026-10-08T12:00:00.000Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary({}).fingerprint}};
  const c=C.createPlan(chapters,{lengthPlan:confirmed}),rows=policy.sectionPlan(chapters,{lengthPlan:confirmed});
  assert.equal(c.lengthPlanId,p.planId);assert.equal(c.targetPages,100);assert.equal(c.proseTotal,70000);
  assert.deepEqual(c.sections.map(s=>s.requirements.proseTarget),p.sections.map(s=>s.target));assert.deepEqual(rows.map(s=>s.target),p.sections.map(s=>s.target));
  assert.ok(c.sections.every(s=>s.lengthPolicy==='advisory-v1'));
  const key=c.sections[1].sectionKey,manual=C.createPlan(chapters,{lengthPlan:p,budgets:{[key]:{proseTarget:800,proseMax:1200,reason:'保留旧人工审签预算'}}});
  assert.equal(manual.sections[1].requirements.proseTarget,800);assert.equal(manual.sections[1].requirements.proseMax,1200);assert.equal(manual.totalTarget,70000-p.sections[1].target+800);
  assert.ok(manual.sections.every(s=>s.lengthPolicy===undefined));
  assert.notEqual(manual.planId,c.planId);assert.equal(p.sections[1].target,2400);
});
test('所有章节目标合计须匹配，非法/超安全容量不静默砍输入，合法短目录明确不足',()=>{
  const chapters=outline();assert.throws(()=>L.createPlan(chapters,{chapterTargets:{总论:50000}}),/安全分配容量/);
  assert.throws(()=>L.createPlan(chapters,{chapterTargets:{不存在:200}}),/未启用或已变更/);
  assert.throws(()=>L.createPlan(chapters,{proseTotal:10000,chapterTargets:{市场:12000}}),/合计超过/);
  assert.throws(()=>L.createPlan(chapters,{chapterTargets:{总论:1000,市场:20000,风险与财务:20000}}),/合计须等于/);
  for(const bad of ['',0,-1,12.5,Infinity])assert.throws(()=>L.createPlan(chapters,{proseTotal:bad}),/整数/);
  for(const count of [1,2,10,20,43]){
    const p=L.createPlan([{name:'业务',sections:Array.from({length:count},(_,i)=>({t:(i%2?'市场':'运营')+i,numeric:true}))}]);
    assert.equal(p.totalTarget,Math.min(75000,count*3600));assert.ok(p.sections.every(s=>s.target<=3600));
    assert.ok(p.sections.every(s=>2*(Math.ceil(s.target*1.3)+2200)+2488<=16384));
    if(p.totalTarget<75000){assert.equal(p.lengthScope,'partial-outline');assert.ok(p.warnings.some(w=>w.code==='partial-outline'));}
  }
  assert.equal(L.createPlan([]).totalTarget,0);assert.equal(L.createPlan([{name:'政策依据',sections:[{t:'国家文件'},{t:'地方文件'}]}]).totalTarget,1200);
});
test('确认身份随目标或目录变化失效，篡改分配/估计不通过，确认元数据可独立保留',()=>{
  const chapters=outline(),p=L.createPlan(chapters);assert.equal(L.identity(p),p.planId);
  assert.notEqual(L.createPlan(chapters,{proseTotal:74000}).planId,p.planId);
  assert.notEqual(L.createPlan(chapters,{chapterTargets:{总论:3000}}).planId,p.planId);
  const modified=structuredClone(chapters);modified[1].sections[0].t='不同业务主题';assert.equal(L.validatePlan(p,modified).valid,false);
  for(const edit of [x=>x.sections[1].target++,x=>x.estimatedPages=120,x=>x.warnings=[],x=>x.chapters[0].estimatedEndPage=120]){
    const bad=structuredClone(p);edit(bad);assert.equal(L.validatePlan(bad,chapters).valid,false);assert.equal(L.validatePlan(bad).valid,false);
  }
  const confirmed={...p,confirmedAt:'2026-09-30T00:00:00Z',confirmedIdentity:p.planId};assert.equal(L.validatePlan(confirmed,chapters).valid,true);assert.equal(L.validatePlan(confirmed).valid,true);
  assert.throws(()=>C.createPlan(modified,{lengthPlan:p}),/目录或小节权重已改变/);
});

test('numeric补写只兼容原篇幅分配，保留确认收据而由当前元数据重建表格合同',()=>{
  const chapters=outline(),plan={...L.createPlan(chapters,{planningPriority:'pages',chapterTargets:{总论:3000}}),confirmedAt:'2026-10-10T02:13:02.948Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary({}).fingerprint}},beforePlan=JSON.stringify(plan);
  chapters[0].sections[1].numeric=true;chapters[2].sections[0].numeric=false;
  const beforeChapters=JSON.stringify(chapters),fresh=L.createPlan(chapters,{targetPages:plan.targetPages,proseTotal:plan.proseTotal,planningPriority:plan.planningPriority,chapterTargets:plan.chapterTargets});
  assert.notEqual(fresh.outlineIdentity,plan.outlineIdentity);assert.notEqual(fresh.planId,plan.planId);
  assert.equal(L.validatePlan(plan).valid,true);assert.equal(L.validatePlan(plan,chapters).valid,true);
  const current=C.createPlan(chapters,{lengthPlan:plan}),key='总论 / 项目事实',contract=current.sections.find(s=>s.sectionKey===key);
  assert.equal(current.lengthPlanId,plan.planId);assert.equal(current.lengthPlan.confirmedAt,plan.confirmedAt);assert.equal(current.proseTotal,84500);
  assert.deepEqual(current.sections.map(s=>s.requirements.proseTarget),plan.sections.map(s=>s.target));assert.ok(current.sections.every(s=>s.lengthPolicy==='advisory-v1'));
  assert.equal(contract.requirements.tableMax,2);assert.equal(contract.requirements.tableRowsMax,30);assert.equal(contract.requiredTables.length,0,'numeric本身不新增业务表职责');
  assert.equal(current.sections.find(s=>s.sectionKey==='风险与财务 / 经营判断0').requirements.tableMax,1);
  assert.ok(C.inspect('甲'.repeat(contract.requirements.proseMax+1),contract).issues.some(i=>i.code==='budget-proseCharacters'&&i.severity==='warning'&&!i.repairable));
  const required={...contract,requiredFacts:[{key:'area',label:'面积',value:'5973㎡',owner:key,required:true,status:'confirmed'}],requiredHeadings:[{level:3,text:'原业务分类'}]};
  const errors=C.inspect('甲。',required).issues.filter(i=>i.severity==='error');assert.ok(errors.some(i=>i.code==='heading-structure-missing'));assert.ok(errors.some(i=>i.code==='missing-fact'));
  const unconfirmed=structuredClone(plan);delete unconfirmed.confirmedAt;delete unconfirmed.budgetResolution;assert.equal(C.createPlan(chapters,{lengthPlan:unconfirmed}).sections[1].lengthPolicy,undefined);
  const box=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../report-length-plan.js'),'utf8'),box);assert.equal(box.ReportLengthPlan.validatePlan(plan,chapters).valid,true);
  assert.equal(JSON.stringify(plan),beforePlan);assert.equal(JSON.stringify(chapters),beforeChapters);
});

test('numeric兼容不能吞掉真实目录变化或原计划篡改',()=>{
  const chapters=outline(),plan=L.createPlan(chapters,{planningPriority:'pages'}),changed=structuredClone(chapters);changed[0].sections[1].numeric=true;
  const changes={chapterName:x=>{x[0].name='新总论';},sectionName:x=>{x[0].sections[1].t='新业务主题';},chapterOrder:x=>{[x[0],x[1]]=[x[1],x[0]];},sectionOrder:x=>{[x[1].sections[0],x[1].sections[1]]=[x[1].sections[1],x[1].sections[0]];},basis:x=>{x[0].sections[1].basis=true;},enabled:x=>{x[0].checked=false;},added:x=>{x[1].sections.push({t:'新增业务'});},removed:x=>{x[1].sections.pop();}};
  for(const [label,change] of Object.entries(changes)){const current=structuredClone(changed);change(current);const before=JSON.stringify(current);assert.equal(L.validatePlan(plan,current).valid,false,label);assert.equal(JSON.stringify(current),before,label);}
  const forgedId={...plan,planId:'forged'};assert.equal(L.validatePlan(forgedId,changed).valid,false);
  for(const edit of [x=>x.sections[1].target++,x=>x.sections[1].weight++,x=>x.sections[1].basis=true,x=>x.proseTotal++,x=>x.chapterTargets.总论=3000,x=>x.estimatedPages++,x=>x.warnings=[{code:'forged',severity:'warning',message:'伪造警告'}],x=>x.outlineIdentity='forged']){
    const bad=structuredClone(plan);edit(bad);assert.equal(L.validatePlan(bad,changed).valid,false);
    bad.planId=L.identity(bad);assert.equal(L.validatePlan(bad,changed).valid,false,'重新计算哈希仍不能伪造分配或目录');
  }
});
test('已确认目录失效不能回退成未确认计划或悄悄替换用户的字数目标',()=>{
  const chapters=outline(),saved={...L.createPlan(chapters,{proseTotal:50000}),confirmedAt:'2026-10-09T12:00:00.000Z',budgetResolution:{policy:'confirmed-length-plan'}},status={status:'stale-confirmed',plan:saved,message:'目录已改变，请重新确认原目标。'};
  const result=C.reviewLength([],L.createPlan(chapters),status);
  assert.equal(result.applicable,true);assert.equal(result.status,'stale-plan');assert.equal(result.target,50000);assert.equal(result.min,45000);assert.equal(result.planId,saved.planId);assert.equal(result.professionalQualityVerified,false);
  const plan=C.createPlan(chapters,{lengthPlanStatus:status}),review=C.reviewDocument([],plan);
  assert.equal(review.lengthReview.status,'stale-plan');assert.equal(review.lengthReview.target,50000);assert.notEqual(review.status,'ready');
});
test('超页/过量仅告警不删预算，估算不替代真实排版下载门禁',()=>{
  const p=L.createPlan(outline(),{targetPages:150,proseTotal:100000});assert.equal(p.totalTarget,100000);assert.equal(p.targetPages,150);assert.equal(p.maxPages,130);
  assert.ok(p.warnings.some(w=>w.code==='download-page-boundary'));assert.equal(p.professionalQualityVerified,false);
  assert.ok(L.createPlan(outline(),{targetPages:60}).warnings.some(w=>w.code==='estimated-over-target'));
});
test('外层标题编号统一归一化，两种生成结果均保留业务文本与原级别；删主题仍阻断',()=>{
  const initial=C.createPlan([{name:'风险',sections:[{t:'风险分析'}]}]).sections[0];
  const c={...initial,requiredHeadings:[{level:3,text:'1. 政策风险'},{level:4,text:'（一） 应对条件'},{level:3,text:'2. 市场风险'}]};
  assert.deepEqual(C.normalize(c).requiredHeadings,[{level:3,text:'政策风险'},{level:4,text:'应对条件'},{level:3,text:'市场风险'}]);
  for(const numbered of [true,false]){
    const texts=numbered?['1. 政策风险','（一） 应对条件','2. 市场风险']:['政策风险','应对条件','市场风险'];
    const raw=JSON.stringify({blocks:texts.flatMap((text,i)=>[{kind:'heading',slot:'finding',level:i===1?4:3,text},{kind:'paragraph',slot:'finding',text:'核对已登记的业务约束及必要条件。'}])}),d=C.decodeStructured(raw,c),q=C.inspect(d.text,c);
    assert.equal(d.raw,raw);assert.ok(!d.issues.some(i=>i.severity==='error'));assert.ok(!q.issues.some(i=>i.code==='heading-structure-missing'));
    assert.deepEqual(C.headingOutline(d.text),C.normalize(c).requiredHeadings);
  }
  assert.ok(C.inspect('### 政策风险\n\n约束仍须审签。',c).issues.some(i=>i.code==='heading-structure-missing'));
  assert.equal(C.canonicalHeadingText('3.5%收益率条件'),'3.5%收益率条件');
});
test('新计划字数和段数只警戒，历史严格合同不迁移；事实和表协议仍拒收',()=>{
  const chapters=[{name:'业务',sections:[{t:'方案'}]}],lengthPlan={...L.createPlan(chapters),confirmedAt:'2026-10-08T12:00:00.000Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary({}).fingerprint}};
  const c=C.createPlan(chapters,{lengthPlan}).sections[0],slot=C.outputSlots(c)[0],blocks=Array.from({length:5},()=>({kind:'paragraph',slot:slot.slot,text:'甲'.repeat(slot.hardMax+1)})),raw=JSON.stringify({blocks}),d=C.decodeStructured(raw,c),q=C.inspect(d.text,c);
  assert.equal(c.lengthPolicy,'advisory-v1');
  assert.ok(d.issues.some(i=>i.code==='structured-slot-budget'&&i.severity==='warning'&&!i.repairable));assert.ok(!d.issues.some(i=>i.severity==='error'));
  assert.ok(q.issues.some(i=>i.code==='budget-proseCharacters'&&i.severity==='warning'&&!i.repairable));assert.notEqual(q.status,'blocked');
  const old={...c};delete old.lengthPolicy;assert.ok(C.decodeStructured(raw,old).issues.some(i=>i.code==='structured-slot-budget'&&i.severity==='error'));assert.equal(C.inspect(d.text,old).status,'blocked');
  const required={...c,requiredFacts:[{key:'area',label:'面积',value:'5973㎡',owner:c.sectionKey,required:true,status:'confirmed'}]};assert.equal(C.inspect('项目仍须审签。',required).status,'blocked');
  assert.ok(C.decodeStructured('{not-json}',c).issues.some(i=>i.severity==='error'));
  const table=C.decodeStructured(JSON.stringify({blocks:[{kind:'table',title:'规模',headers:['指标','值'],rows:[['面积']]}]}),c);assert.ok(table.issues.some(i=>i.code==='structured-table-schema'&&i.severity==='error'));
  assert.match(C.structuredPrompt(c),/并非拒收门槛/);assert.match(C.repairPrompt({issues:[]},c),/不能因字数或段数警告机械缩写/);
});
