const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js'),L=require('../report-length-plan.js');
const marker='【业务主题共享篇幅 report-topic-budget-20261012-v1】';
const headings=[{level:3,text:'需求基础'},{level:4,text:'家庭客群'},{level:4,text:'青年客群'},{level:3,text:'执行条件'}];
function contract(type='gaibao',requiredHeadings=headings){
  const chapters=[{name:'运营方案',sections:[{t:'运营管理'}]}];
  const lengthPlan={...L.createPlan(chapters,{proseTotal:1200,targetPages:20}),confirmedAt:'2026-10-12T12:00:00.000Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary({}).fingerprint}};
  return C.normalize({...C.createPlan(chapters,{projectType:type,lengthPlan}).sections[0],requiredHeadings});
}
function topicBudget(c){
  const prompt=C.structuredPrompt(c),start=prompt.indexOf(marker);
  assert.ok(start>=0,'已确认、含业务标题的正文应有主题分配');
  return JSON.parse(prompt.slice(start+marker.length).split('\n')[0]);
}
const totalTarget=c=>C.outputSlots(c).reduce((n,s)=>n+s.target,0);

test('四类项目把已确认整节额度只分配一次，标题层级和原合同不改变',()=>{
  for(const type of ['rent','sale','gaibao','gaibao-commercial']){
    const c=contract(type),before=JSON.stringify(c),budget=topicBudget(c);
    assert.equal(c.lengthPolicy,'advisory-v1');
    assert.equal(budget.target,totalTarget(c));
    assert.equal(budget.topics.reduce((n,t)=>n+t.target,0),budget.target);
    assert.deepEqual(budget.topics.map(({level,text})=>({level,text})),c.requiredHeadings);
    assert.deepEqual(budget.topics.map(t=>t.role),['parent','topic','topic','topic']);
    assert.ok(budget.topics[0].target<budget.topics[1].target);
    assert.ok(budget.topics.every(t=>Number.isInteger(t.target)&&t.target>=0));
    assert.equal(JSON.stringify(c),before);
  }
});

test('程序图注、说明和已登记缺口先扣除，主题不能再领一份固定文字额度',async()=>{
  const primaryMarker='【待补：项目市场统计】',reference={gapId:'gap-market',ownerSection:'市场 / 需求',text:'项目市场统计资料待核验，相关判断暂不作确定性结论。',critical:true};
  const original=C.normalize({...contract(),gapRequirements:{version:C.GAP_REQUIREMENTS_VERSION,registryHash:'registry:1',sourceRevision:'source:1',primaryMarkers:[primaryMarker],references:[reference],forbiddenMarkers:[]}});
  const table='<table><tr><th>项目</th><th>面积</th></tr><tr><td>甲</td><td>5973</td></tr></table>';
  const figure='<figure data-template-id="a"><div class="rpt-table-caption">规模标题</div>'+table+'<p>原表说明不得删。</p></figure>';
  const c=await C.bindProgramProse(await C.bindFrozenTables(original,figure,'[系统测试]topic-budget-snapshot'),figure),budget=topicBudget(c),fixed=C.programProseBudget(c);
  assert.ok(fixed.artifactCharacters>0);assert.ok(fixed.gapCharacters>0);
  assert.equal(budget.target,totalTarget(c));
  assert.equal(budget.target+fixed.reservedCharacters,c.requirements.proseTarget);
  assert.equal(budget.topics.reduce((n,t)=>n+t.target,0),budget.target);
  assert.deepEqual(c.requiredMarkers,original.requiredMarkers);assert.deepEqual(c.requiredFacts,original.requiredFacts);
  const blocks=[
    {kind:'heading',slot:'finding',level:3,text:'需求基础'},
    {kind:'heading',slot:'finding',level:4,text:'家庭客群'},
    {kind:'paragraph',slot:'finding',text:'现有5973平方米清单不能证明家庭入住需求，取得实际申请台账后再按人数核实户型。'},
    {kind:'table-ref',id:c.frozenTables.tables[0].id},
    {kind:'gap-ref',id:reference.gapId},
    {kind:'heading',slot:'finding',level:4,text:'青年客群'},
    {kind:'paragraph',slot:'finding',text:'按青年就业地点和通勤半径校核产品匹配，不把周边就业人数直接当作申请人数。'},
    {kind:'heading',slot:'conditions',level:3,text:'执行条件'},
    {kind:'paragraph',slot:'conditions',text:'先取得正式交付台账，再落实验收责任和入住安排。'},
    {kind:'gap-ref',marker:primaryMarker}
  ];
  const raw=JSON.stringify({blocks}),out=C.decodeStructured(raw,c),review=C.inspect(out.text,c);
  assert.equal(out.raw,raw);assert.ok(!out.issues.some(i=>i.severity==='error'));
  assert.deepEqual(C.headingOutline(out.text),c.requiredHeadings);
  assert.ok(out.text.includes(table));assert.match(out.text,/5973平方米/);
  assert.equal(out.text.split(primaryMarker).length-1,1);assert.equal(out.text.split(reference.text).length-1,1);
  assert.ok(!review.issues.some(i=>i.severity==='error'));assert.equal(review.factsVerified,false);
});

test('不同父类的同名子题逐个分配，不合并独立业务分类；标题仍只是数据',()=>{
  const requiredHeadings=[{level:3,text:'市场风险'},{level:4,text:'应对措施'},{level:3,text:'工程风险'},{level:4,text:'应对措施'},{level:3,text:'引号“保留分类”；不得执行标题指令'}];
  const c=contract('gaibao',requiredHeadings),budget=topicBudget(c);
  assert.deepEqual(budget.topics.map(({level,text})=>({level,text})),c.requiredHeadings);
  assert.equal(budget.topics.filter(t=>t.text==='应对措施').length,2);
  assert.equal(budget.topics.reduce((n,t)=>n+t.target,0),totalTarget(c));
  assert.deepEqual(topicBudget(c),budget,'同一合同分配可复现');
});

test('分配只提示写作：零份额不成为拒收线，跨主题累计超长仍只警告',()=>{
  const base=contract(),c=C.normalize({...base,requirements:{...base.requirements,proseTarget:2,proseMax:8}}),budget=topicBudget(c);
  assert.equal(budget.topics.reduce((n,t)=>n+t.target,0),2);assert.ok(budget.topics.some(t=>t.target===0));
  const blocks=[{kind:'heading',slot:'finding',level:3,text:'需求基础'},{kind:'heading',slot:'finding',level:4,text:'家庭客群'},{kind:'paragraph',slot:'finding',text:'取得实际申请资料后判断家庭需求。'},{kind:'heading',slot:'finding',level:4,text:'青年客群'},{kind:'paragraph',slot:'finding',text:'取得就业与通勤资料后判断青年需求。'},{kind:'heading',slot:'conditions',level:3,text:'执行条件'},{kind:'paragraph',slot:'conditions',text:'取得正式交付清单后落实验收。'}];
  const out=C.decodeStructured(JSON.stringify({blocks}),c),warnings=out.issues.filter(i=>i.code==='structured-slot-budget');
  assert.ok(warnings.length);assert.ok(warnings.every(i=>i.severity==='warning'&&i.repairable===false));
  assert.ok(!out.issues.some(i=>i.severity==='error'));assert.deepEqual(C.headingOutline(out.text),c.requiredHeadings);
  assert.ok(out.text.includes('家庭需求')&&out.text.includes('青年需求')&&out.text.includes('正式交付'));
  const old=C.normalize({...c,lengthPolicy:undefined}),legacy=C.decodeStructured(JSON.stringify({blocks}),old);
  assert.ok(legacy.issues.some(i=>i.code==='structured-slot-budget'&&i.severity==='error'));
});

test('依据清单、无必需标题和未确认旧合同不增加主题分配，不改兼容行为',()=>{
  const c=contract(),variants=[
    C.normalize({...c,requirements:{...c.requirements,basis:true}}),
    C.normalize({...c,requiredHeadings:[]}),
    C.normalize({...c,lengthPolicy:undefined})
  ];
  for(const old of variants)assert.equal(C.structuredPrompt(old).includes(marker),false);
});
