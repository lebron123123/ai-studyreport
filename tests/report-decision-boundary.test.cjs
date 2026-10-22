const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js');
const chapters=[{name:'项目',sections:[{t:'规模'},{t:'编制依据'}]},{name:'财务',sections:[{t:'财务口径'},{t:'项目可行性结论'}]}];
const fact={key:'calculation-conflict',label:'旧测算口径冲突',value:'旧模型为12年固定租金；协议为首期6年抵扣后分成，尚待确认',owner:'财务 / 财务口径',required:true,status:'conflict',source:'已登记协议稿和旧测算快照'};
const plan=()=>C.createPlan(chapters,{facts:[fact]});
test('必要事实须有合法唯一归属，不得静默降为非必要；只在owner完整保留',()=>{
  for(const owner of ['', '不存在 / 不存在'])assert.throws(()=>C.createPlan(chapters,{facts:[{...fact,owner}]}),/唯一职责/);
  const p=plan();assert.deepEqual(p.sections.map(s=>s.requiredFacts.filter(f=>f.required).length),[0,0,1,0]);
  assert.ok(C.inspect('口径尚待确认',p.sections[2]).issues.some(i=>i.code==='missing-fact'));
  assert.ok(!C.inspect('口径存在冲突，尚不能认定财务可行。',p.sections[3]).issues.some(i=>i.code==='missing-fact'));
});
test('冲突限制跨owner传播到财务职责，但不扩散到依据、规模章节',()=>{
  const p=plan();assert.deepEqual(p.sections.map(s=>s.decisionConstraints?.length||0),[0,0,1,1]);
  assert.ok(C.structuredPrompt(p.sections[3]).includes('不可省略的决策限制'));
  assert.notEqual(p.planId,C.createPlan(chapters,{facts:[{...fact,status:'confirmed'}]}).planId);
});
test('缺决策限制及相反肯定结论被拦截，冻结旧表与程序警告不能代替正文',()=>{
  const c=plan().sections[3],boundary='旧测算口径存在冲突，尚不能认定财务可行，须重核后审签。';
  assert.ok(C.inspect('本项目按审批程序实施。',c).issues.some(i=>i.code==='financial-decision-boundary'));
  assert.ok(C.inspect('项目具备财务可行性基础。'+boundary,c).issues.some(i=>i.code==='financial-affirmative-conflict'));
  const marked='<p data-report-conflict-warning="true">'+boundary+'</p>';
  assert.ok(C.inspect(marked+'只保留常识',c).issues.some(i=>i.code==='financial-decision-boundary'));
  const table='<table><tr><th>旧稿结论</th><th>判断</th></tr><tr><td>本项目具备财务可行性基础</td><td>满足</td></tr></table>';
  const q=C.inspect(boundary+table,c);assert.equal(q.status,'unverified');assert.equal(q.factsVerified,false);
  assert.ok(!q.issues.some(i=>i.code==='financial-affirmative-conflict'));
});
test('显式待确认限制可用于尚未登记数值冲突的项目，未知规则拒绝',()=>{
  const p=C.createPlan(chapters,{decisionConstraints:{'财务 / 项目可行性结论':[{kind:'unconfirmed-financial-basis',factKeys:['pending-business-mode'],reason:'收益口径尚待人工确认'}]}});
  assert.ok(p.sections[3].decisionConstraints);assert.equal(C.inspect('收益口径待确认，尚不能认定财务可行。',p.sections[3]).status,'unverified');
  assert.throws(()=>C.normalize({...p.sections[3],decisionConstraints:[{kind:'unknown',factKeys:['x']}]}),/决策限制/);
});
test('真实 8.2 / 9.2 / 9.3 的明确否定句不被判为肯定，仍为事实未核验',()=>{
  const sentences=[
    '上述限制未解除前，不得认定财务可行或具备财务可行性基础。',
    '协议经营口径仍待确认，旧测算在范围、运营年限和收益安排上与协议存在冲突，故尚不能认定本项目财务可行，须待口径重核后再作判断。',
    '财务口径尚待重核，现阶段不能认定本项目财务可行。',
    '不得认定财务可行。','本项目不具备财务可行性基础。',
    '暂无法认定本项目财务可行。','尚不能认定本项目具备财务可行性基础。',
    '不能据旧测算结果直接认定财务可行。','不能作出财务可行的结论。'
  ];
  for(const sentence of sentences){const q=C.inspect('经营口径待确认。'+sentence,plan().sections[3]);assert.equal(q.status,'unverified',sentence);assert.equal(q.factsVerified,false);assert.ok(q.issues.some(i=>i.code==='financial-basis-unverified'));assert.ok(!q.issues.some(i=>/financial-(?:decision-boundary|affirmative-conflict)/.test(i.code)),sentence);}
});
test('否定仅作用于局部谓词：先肯定后免责、转折后肯定、标点后的新肯定仍阻断',()=>{
  const boundary='口径待确认，尚不能认定财务可行。';
  for(const sentence of [
    '项目具备财务可行性基础。'+boundary,
    boundary+'但项目具备财务可行性基础。',
    '口径待确认，不得认定财务可行或具备财务可行性基础，但项目在财务上可行。',
    '口径待确认，不得认定财务可行，具备财务可行性基础。',
    '口径待确认，不得认定财务可行\n具备财务可行性基础。',
    boundary+'财务评价结论：可行。',boundary+'不存在财务障碍。',
    boundary+'可以认定本项目财务可行。'
  ])assert.ok(C.inspect(sentence,plan().sections[3]).issues.some(i=>i.code==='financial-affirmative-conflict'),sentence);
});
test('双重否定和否定后反驳不能被有限否定兼容放行',()=>{
  for(const sentence of [
    '并非不具备财务可行性基础。','不是不具备财务可行性基础。',
    '不能说不具备财务可行性基础。','不能不认定财务可行。',
    '并非尚不能认定本项目财务可行。','不具备财务可行性基础的说法并不成立。'
  ]){const q=C.inspect('口径待确认。'+sentence,plan().sections[3]);assert.equal(q.status,'blocked',sentence);assert.ok(q.issues.some(i=>i.code==='financial-affirmative-conflict'),sentence);assert.ok(q.issues.some(i=>i.code==='financial-decision-boundary'),sentence);}
});
test('HTML 行内样式不影响明确否定，表格和程序边界仍不能替代正文',()=>{
  const c=plan().sections[3];
  assert.equal(C.inspect('<p>口径待确认。尚不能认定<strong>本项目</strong>财务可行。</p>',c).status,'unverified');
  for(const html of ['<table><tr><td>口径待确认，尚不能认定本项目财务可行。</td></tr></table>','<p data-report-conflict-warning="true">口径待确认，尚不能认定本项目财务可行。</p>'])assert.ok(C.inspect(html+'<p>待人工审阅</p>',c).issues.some(i=>i.code==='financial-decision-boundary'));
});

// Complete affected paragraphs from the QA-only 2026-09-22 offline-revalidation
// corpus full-review-2026-09-22T06-24-30-398Z-f9dc0f. No live project dependency.
const realNegativeParagraphs=[
  ['2.3','限制集中于三类：一是财务口径未确认，旧测算的范围、运营年限和收益安排与协议约定冲突，测算中利息采用年度平均占用算法、利息备付率为参考口径，均须财务复核，不得据此认定财务可行；二是市场与需求验证不足，周边竞品租金及出租率字段为空，无法完成定价对标，住户调研与消费者调研数据缺失，新市民、青年人可负担性待验证；三是运营与流动性风险，运营前期净现金流为负，需安排流动资金储备或协商灵活还款安排，1楼配套改造不在合作范围内、其业态与运营情况待明确。'],
  ['4.1','下一项推进动作：以不动产权证、政府主管部门测绘报告及主管部门批复的改造方案为基准，先行核对面积口径与用地手续路径，并同步启动财务口径重核。触发节点为上述核对与重核完成并审签；在此之前，本节结论仅作待确认审阅副本，不构成投资审批依据，不得据旧测算认定财务可行。'],
  ['4.2','下一项推进动作：以协议口径重核为触发节点，先完成财务口径统一与重算审签，再据重核结果决定是否推进竞品调研、改造专项评估及协议衔接条款谈判；在口径重核完成前，不作出投资审批结论，不认定财务可行。'],
  ['6.1','主要限制：一是财务口径未确认，旧测算与协议在范围、运营年限、收益模式上不一致，不得据此认定财务可行；二是户型配比、单套面积、得房率、层高利用方案等关键设计参数未定，改造方案批复、消防设计审查等前置程序尚未取得；三是周边竞品租金及出租率数据待补充，出租率与租金预测的准确性待验证；四是改造投入总额须经第三方造价审核及可能的政府复核，投资估算存在调整可能。'],
  ['9.1','下一项推进动作：以协议待确认基准为准，对计租面积、套数、运营年限、收益模式及租金、融资、税费、项目性质等假设逐项重核，重算后再复核财务评价结论。触发节点为口径重核完成并取得相应确认文件；决策边界为在重核审签前，本节仅作为待确认审阅副本，不得据此作出投资审批结论或认定财务可行。'],
  ['11.2','下一项推进动作：在设计阶段同步开展现场查勘检测与图纸复核，并提前对接规划、消防、住建等主管部门开展方案预审；以取得设计图纸、施工图预算、施工进度计划及专项风险评估报告为触发节点，完成工程风险量化复核后提交审签。决策边界：在协议经营口径重核完成前，本节仅作为待确认审阅副本，不得据此认定财务可行或作出投资审批结论。']
];
test('六节真实完整段落的据此、据旧测算、不认定及共享否定动作不再误判',async t=>{
  for(const [number,text] of realNegativeParagraphs)await t.test(number,()=>{
    const q=C.inspect(text,plan().sections[3]);
    assert.equal(q.status,'unverified',JSON.stringify(q.issues));
    assert.equal(q.factsVerified,false);
    assert.ok(q.issues.some(i=>i.code==='financial-basis-unverified'));
    assert.ok(!q.issues.some(i=>/^financial-(decision-boundary|affirmative-conflict)$/.test(i.code)));
  });
});
test('真实段落附加新肯定不能借用已有否定免责，表内否定也不能覆盖正文肯定',()=>{
  const c=plan().sections[3];
  for(const [number,text] of realNegativeParagraphs){
    for(const affirmative of ['但可以认定财务可行。','然而项目具备财务可行性基础。','可以认定本项目财务可行。']){
      assert.ok(C.inspect(text+affirmative,c).issues.some(i=>i.code==='financial-affirmative-conflict'),number+' '+affirmative);
      assert.ok(C.inspect(affirmative+text,c).issues.some(i=>i.code==='financial-affirmative-conflict'),number+' prepend '+affirmative);
    }
  }
  const q=C.inspect('口径待确认，但可以认定财务可行。<table><tr><td>不得据此认定财务可行。</td></tr></table>',c);
  assert.ok(q.issues.some(i=>i.code==='financial-affirmative-conflict'));
  assert.ok(q.issues.some(i=>i.code==='financial-decision-boundary'));
});
test('有限依据词组和并列动作不得跨标点、转折或双重否定扩大作用域',()=>{
  const c=plan().sections[3];
  for(const text of [
    '不得据此作出投资审批结论，但认定财务可行。',
    '不得据此作出投资审批结论，认定财务可行。',
    '不得据此作出投资审批结论\n认定财务可行。',
    '不得据旧测算认定财务可行，但据新测算认定财务可行。',
    '不认定财务可行，然而本项目具备财务可行性基础。',
    '不得据此认定财务可行或作出投资审批结论，不过现在认定本项目财务可行。',
    '并非不得据此认定财务可行。','不能据此不认定财务可行。',
    '不能据旧测算不认定财务可行。','不是不认定财务可行。',
    '不得不认定财务可行。','不可以不认定财务可行。',
    '不得据此认定财务可行的说法并不成立。',
    '不能据此但可根据新依据认定财务可行。'
  ])assert.ok(C.inspect('口径待确认。'+text,c).issues.some(i=>i.code==='financial-affirmative-conflict'),text);
  for(const text of ['不得据此作出投资审批结论。','不作出投资审批结论。']){
    const q=C.inspect('口径待确认。'+text,c);
    assert.ok(q.issues.some(i=>i.code==='financial-decision-boundary'),'审批否定不能替代财务否定：'+text);
  }
});
