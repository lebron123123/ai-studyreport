const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../report-completion-contract.js'),policy=require('../report-output-policy.js');

async function housingOutline(){
  const seed=JSON.parse(fs.readFileSync(require.resolve('../data/report-logic-gaibao-v1.json'),'utf8'));
  const box=vm.createContext({window:{},fetch:async()=>({ok:true,json:async()=>({ok:true,set:{id:'depth-fixture',version:seed.version,projectType:'gaibao',data:seed}})})});
  vm.runInContext(fs.readFileSync(require.resolve('../report-logic-core.js'),'utf8'),box);
  await box.window.ReportLogicCore.load('gaibao');
  return JSON.parse(JSON.stringify(box.window.ReportLogicCore.outline('gaibao',{businessScenario:'housing_conversion'}).chapters));
}

test('真实43节详实计划精确分配75k：依据只清单、重点分配更多、旧入口同池',async()=>{
  const chapters=await housingOutline(),before=JSON.stringify(chapters),plan=C.createPlan(chapters),rows=policy.sectionPlan(chapters);
  assert.equal(plan.sections.length,43);assert.equal(plan.proseTotal,75000);assert.equal(plan.totalTarget,75000);assert.equal(plan.lengthScope,'full-report');
  assert.equal(plan.totalTarget,plan.sections.reduce((n,s)=>n+s.requirements.proseTarget,0));
  assert.equal(rows.reduce((n,r)=>n+r.target,0),plan.totalTarget);
  for(const row of rows){
    const c=plan.sections.find(s=>s.sectionKey===row.key);assert.equal(c.requirements.proseTarget,row.target);assert.equal(c.requirements.basis,row.basis);
    assert.ok(row.basis?row.target===600:row.weight===1.5?[2125,2126].includes(row.target):row.target===1417);
  }
  assert.equal(JSON.stringify(chapters),before);
  assert.deepEqual(plan.targetPageRange,{min:110,max:130});assert.equal(plan.maxPages,130);
});

test('取整不丢总池，材料量和旧文长度不扩张预算；依据继承与纯目录不注水',()=>{
  const chapters=[{name:'总论',sections:[{t:'政策依据'},{t:'项目事实'}]},{name:'市场',sections:[{t:'需求分析'},{t:'竞争分析'},{t:'定价分析'}]},{name:'风险',sections:[{t:'融资风险'}]}];
  const plan=C.createPlan(chapters),changed=structuredClone(chapters);
  changed.forEach(c=>c.sections.forEach(s=>{s.content='长资料'.repeat(10000);s.materials=Array(20).fill({text:'其他项目历史资料'});}));
  assert.deepEqual(C.createPlan(changed),plan);assert.equal(plan.totalTarget,18600);assert.equal(plan.lengthScope,'partial-outline');
  const basis=C.createPlan([{name:'法规依据',sections:[{t:'国家文件'},{t:'地方文件'}]}]);
  assert.ok(basis.sections.every(c=>c.requirements.basis));assert.equal(basis.totalTarget,1200);assert.ok(basis.totalTarget<basis.proseTotal);
  assert.equal(C.createPlan([]).totalTarget,0);
});

test('人工预算有原因才覆盖，totalTarget取实际合同；旧合同归一化不自动升预算',()=>{
  const chapters=[{name:'业务',sections:[{t:'方案'},{t:'安排'}]}],base=C.createPlan(chapters),key=base.sections[0].sectionKey;
  const plan=C.createPlan(chapters,{budgets:{[key]:{proseTarget:1800,proseMax:2400,reason:'人工核验后保留短方案'}}});
  assert.equal(plan.sections[0].requirements.proseTarget,1800);assert.equal(plan.totalTarget,5400);assert.notEqual(plan.planId,base.planId);
  const textInput=C.createPlan(chapters,{budgets:{[key]:{proseTarget:'1800',proseMax:'2400',reason:'输入框数值归一化'}}});
  assert.equal(textInput.sections[0].requirements.proseTarget,1800);assert.equal(textInput.totalTarget,5400);
  const old={version:C.VERSION,planId:'legacy-36k-plan',sectionKey:key,requirements:{proseTarget:900,proseMax:1200},requiredFacts:[],requiredTables:[]};
  const before=structuredClone(old),normalized=C.normalize(old);
  assert.equal(normalized.requirements.proseTarget,900);assert.equal(normalized.requirements.proseMax,1200);assert.equal(normalized.planId,old.planId);assert.deepEqual(old,before);
});

test('短正文只是独立深度提示，不强制扩写、不当作专业合格；足够字数仍须人工审签',()=>{
  const plan=C.createPlan([{name:'业务',sections:[{t:'经营判断'}]}]),c=plan.sections[0],short=[{key:c.sectionKey,text:'已登记事实仍须核验。'}];
  const q=C.reviewDocument(short,plan);assert.equal(q.status,'passed');assert.equal(q.depthAdvisory.severity,'warning');assert.equal(q.depthAdvisory.repairable,false);assert.equal(q.professionalQualityVerified,false);assert.equal(q.factsVerified,false);
  assert.match(q.depthAdvisory.message,/不是最低字数门槛/);assert.match(q.depthAdvisory.message,/不为字数或页数注水/);
  const long=[{key:c.sectionKey,text:'甲'.repeat(Math.ceil(c.requirements.proseTarget*C.LENGTH_PROFILE.depthAdvisoryRatio))}],enough=C.reviewDocument(long,plan);
  assert.equal(enough.depthAdvisory,null);assert.equal(enough.professionalQualityVerified,false);assert.equal(enough.paginationRequired,true);
  const old={...plan,lengthProfileVersion:undefined,proseTotal:36000};assert.equal(C.reviewDocument(short,old).depthAdvisory,null);
  const missing=C.reviewDocument([{key:c.sectionKey,text:'【待补：经营条件】'}],plan);assert.equal(missing.status,'unverified');assert.ok(missing.depthAdvisory);assert.equal(missing.factsVerified,false);
});

test('详实生成与问题修复不预先缩量，保留业务结构、事实、表格和未知限制',()=>{
  const c=C.createPlan([{name:'市场',sections:[{t:'产品定位'}]}]).sections[0],prompt=C.structuredPrompt(c),repair=C.repairPrompt({issues:[{repairable:true,message:'修正第三段的套话'}],depthAdvisory:{message:'核对比较论证是否充分'}},c);
  assert.doesNotMatch(prompt,/target的70%/);assert.match(prompt,/不预先按比例缩减正文/);assert.match(prompt,/不压成一两句摘要/);assert.match(prompt,/target不是最低字数/);
  assert.match(repair,/非超长问题不得顺带缩减已合规正文/);assert.match(repair,/保留有效比较、因果和论证/);assert.match(repair,/有真实证据时可补齐本节必要分析/);assert.match(repair,/不能删除业务标题或压平结构/);assert.match(repair,/不能删表/);assert.match(repair,/修正第三段的套话/);assert.match(repair,/核对比较论证是否充分/);
  assert.match(policy.sectionPrompt([{name:'市场',sections:[{t:'定位'}]}],{},{}),/^$/);
  const basis=C.createPlan([{name:'总论',sections:[{t:'编制依据'}]}]).sections[0];assert.match(C.structuredPrompt(basis),/本节仅列依据文件清单/);
});

test('浏览器旧展示入口消费同一模块，缺模块明确阻断而非退回36k',()=>{
  const box=vm.createContext({});box.window=box;
  vm.runInContext(fs.readFileSync(require.resolve('../report-output-policy.js'),'utf8'),box);
  assert.throws(()=>box.ReportOutputPolicy.sectionPlan([{name:'业务',sections:[{t:'方案'}]}]),/统一篇幅计划模块未加载/);
  vm.runInContext(fs.readFileSync(require.resolve('../report-completion-contract.js'),'utf8'),box);
  vm.runInContext(fs.readFileSync(require.resolve('../report-length-plan.js'),'utf8'),box);
  const chapters=[{name:'业务',sections:[{t:'方案'}]}],rows=box.ReportOutputPolicy.sectionPlan(chapters);
  assert.equal(rows[0].target,C.proseBudgetPlan(chapters)[0].target);assert.equal(rows[0].target,3600);
});

test('短目录不会把整本预算塞进一次生成，混合权重封顶后重新分配且无丢数',()=>{
  for(const count of [1,2,10,20,43]){
    const chapters=[{name:'业务',sections:Array.from({length:count},(_,i)=>({t:(i%2?'市场':'经营')+i,numeric:true}))}],plan=C.createPlan(chapters);
    assert.equal(plan.totalTarget,Math.min(75000,count*3600));
    assert.ok(plan.sections.every(c=>c.requirements.proseTarget<=3600));
    assert.ok(plan.sections.every(c=>2*(c.requirements.proseMax+c.requirements.tableCharsMax)+2488<=16384));
    assert.equal(plan.lengthScope,count*3600>=75000?'full-report':'partial-outline');
  }
});
