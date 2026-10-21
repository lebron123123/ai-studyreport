const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../report-completion-contract.js');
function contract(basis=false,target=700,max=910){
  const c=C.createPlan([{name:'总论',sections:[{t:basis?'编制依据':'项目结论'}]}]).sections[0];
  // These cases retain the historical strict contract; the new advisory plan is
  // covered independently in report-length-plan.test.cjs.
  return {...c,lengthPolicy:undefined,requirements:{...c.requirements,basis,proseTarget:target,proseMax:max}};
}
function decode(blocks,c=contract()){return C.decodeStructured(JSON.stringify({blocks}),c);}
const paragraph=(slot,text)=>({kind:'paragraph',slot,text});
const table=()=>({kind:'table',title:'规模指标表',headers:['指标','数值'],rows:[['面积','5973㎡'],['套数',195]]});
function errors(out,code){return out.issues.filter(i=>i.severity==='error'&&(!code||i.code===code));}
function md(){const context={};context.window=context;vm.runInNewContext(fs.readFileSync(require.resolve('../md.js'),'utf8'),context);return context.MD;}

test('按固定权重区分建议目标和硬上限，整数/零预算也不扩张合同',()=>{
  const c=contract(),before=JSON.stringify(c),slots=C.outputSlots(c);
  assert.deepEqual(slots.map(s=>s.target),[160,180,180,180]);
  assert.deepEqual(slots.map(s=>s.hardMax),[208,234,234,234]);
  assert.equal(slots.reduce((n,s)=>n+s.hardMax,0),910);
  for(let target=0;target<25;target++)for(let extra=0;extra<10;extra++){
    const s=C.outputSlots(contract(false,target,target+extra));
    assert.ok(s.every(x=>Number.isInteger(x.target)&&x.target>=0&&x.target<=x.hardMax));
    assert.ok(s.reduce((n,x)=>n+x.target,0)<=target);
    assert.equal(s.reduce((n,x)=>n+x.hardMax,0),target+extra);
  }
  assert.equal(JSON.stringify(c),before);
  assert.deepEqual(C.outputSlots(contract(true,300,390)),[{slot:'references',target:300,hardMax:390}]);
});

test('schema roundtrip生成真正闭合TABLE，正文和原数值不变；最终验收仍单独inspect',()=>{
  const blocks=[paragraph('finding','尚不能认定财务可行。'),paragraph('conditions','口径待确认后再复核。'),table()],raw=JSON.stringify({blocks});
  const out=C.decodeStructured(raw,contract()),parsed=md().parseBlocks(out.text);
  assert.equal(out.format,'report-blocks-v1');assert.equal(out.raw,raw);assert.deepEqual(out.issues,[]);
  assert.equal((out.text.match(/\[\[TABLE\]\]/g)||[]).length,1);assert.equal((out.text.match(/\[\[\/TABLE\]\]/g)||[]).length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.find(b=>b.type==='table').rows)),[['指标','数值'],['面积','5973㎡'],['套数','195']]);
  const quality=C.inspect(out.text,contract());assert.equal(quality.status,'unverified');assert.equal(quality.metrics.tableCount,1);assert.equal(quality.metrics.tableRows,3);assert.equal(quality.factsVerified,false);
});

test('无内容槽位可省略；有依据只给references，旧自由文本调用不被隐式解析',()=>{
  assert.deepEqual(decode([paragraph('decision','待核实后决定。')]).issues,[]);
  assert.deepEqual(decode([paragraph('references','《已核实文件》；发布机关：已核实机关。')],contract(true)).issues,[]);
  assert.ok(errors(decode([paragraph('finding','普通结论')],contract(true)),'structured-slot').length);
  assert.ok(errors(decode([table()],contract(true)),'structured-basis-table').length);
  assert.equal(C.inspect('原有普通正文',contract()).status,'passed');
  assert.equal(C.inspect('历史文本').status,'unverified');
  assert.equal(C.normalize(contract()).outputFormat,undefined);
});

test('缺schema、无效JSON或空块失败保留完整raw，不静默退回passed',()=>{
  for(const raw of ['','不是JSON','{"blocks":','{"text":"旧自由文，不是新格式"}','[]','null','{"blocks":[]}']){
    const out=C.decodeStructured(raw,contract());assert.equal(out.raw,raw);assert.ok(errors(out).length);
    assert.ok(out.issues.every(i=>i.repairable===true));
  }
  const raw=JSON.stringify({blocks:[paragraph('finding','内容')]}),out=C.decodeStructured(raw,null);
  assert.ok(errors(out,'structured-contract').length);assert.equal(out.raw,raw);assert.match(out.text,/内容/);
});

test('超单槽硬预算不截断，即使整节还没超也必须返修；target不是强制最小/最大',()=>{
  const c=contract(),hard=C.outputSlots(c)[0].hardMax,body='字'.repeat(hard+1),out=decode([paragraph('finding',body)],c);
  assert.ok(errors(out,'structured-slot-budget').length);assert.equal(out.text,body);assert.ok(out.text.length<c.requirements.proseMax);
  assert.equal(C.inspect(out.text,c).status,'passed'); // Consumer must merge decoder issues.
  assert.deepEqual(decode([paragraph('finding','字'.repeat(161))],c).issues,[]);
});

test('重复槽位、乱序及未知块不丢失任何合法内容或非法字段',()=>{
  const blocks=[paragraph('decision','决策甲'),paragraph('finding','事实乙'),paragraph('finding','事实丙'),{kind:'surprise',payload:{reason:'非法块保留'}},{kind:'paragraph',slot:'evidence',text:'证据丁',unknown:'附加字段保留'}];
  const raw=JSON.stringify({blocks,extra:'根附加保留'}),out=C.decodeStructured(raw,contract());
  for(const code of ['structured-slot-order','structured-slot-duplicate','structured-block-kind','structured-extra-fields'])assert.ok(errors(out,code).length);
  for(const text of ['决策甲','事实乙','事实丙','非法块保留','证据丁','附加字段保留','根附加保留'])assert.ok(out.text.includes(text));
  assert.equal(out.raw,raw);
});

test('不齐列、对象单元格、缺标题/表头/数据行、单列表全部阻止并保留原表输入',()=>{
  const bad=[{...table(),rows:[['面积','5973','多一格']]},{...table(),rows:[['面积',{value:5973}]]},{...table(),title:''},{...table(),headers:['指标','']},{...table(),rows:[]},{...table(),headers:['单列'],rows:[['值']]}];
  for(const t of bad){const raw=JSON.stringify({blocks:[paragraph('finding','合法正文仍在'),t]}),out=C.decodeStructured(raw,contract());assert.ok(errors(out,'structured-table-schema').length);assert.equal(out.raw,raw);assert.match(out.text,/合法正文仍在/);assert.match(out.text,/结构化输出待修复原文/);}
  const infinite=C.decodeStructured('{"blocks":[{"kind":"table","title":"表","headers":["甲","乙"],"rows":[["值",1e400]]}]}',contract());assert.ok(errors(infinite,'structured-table-schema').length);
});

test('HTML/raw TABLE/占位符严拒，合法兄弟块仍保留且危险内容不被渲染',()=>{
  for(const malicious of ['<script>alert(1)</script>','<img src=x onerror=alert(1)>','<img src=x','[[TABLE]]','[[/TABLE]]','@@TABLE_0@@']){
    const out=decode([paragraph('finding','正常段落'),{...table(),rows:[['恶意',malicious]]}]);
    assert.ok(errors(out,'structured-table-markup').length);assert.ok(out.raw.includes(malicious));assert.match(out.text,/正常段落/);
    assert.equal(/<script|<img|\[\[TABLE\]\]|@@TABLE_0@@/.test(out.text),false);
  }
  assert.ok(errors(decode([paragraph('finding','<p>正文</p>')]),'structured-paragraph-markup').length);
});

test('单元格竖线/换行显示转义也必须显式返修，不能冒充严格无损roundtrip',()=>{
  const t={...table(),rows:[['甲|乙','第一行\n第二行'],['数值',5973]]},raw=JSON.stringify({blocks:[t]}),out=C.decodeStructured(raw,contract());
  assert.equal(out.raw,raw);assert.equal(errors(out,'structured-cell-encoding').length,2);
  const rows=md().parseBlocks(out.text).find(b=>b.type==='table').rows;
  assert.equal(rows.length,3);assert.ok(rows.every(r=>r.length===2));assert.equal(rows[1][0],'甲｜乙');assert.equal(rows[1][1],'第一行 ↵ 第二行');assert.equal(rows[2][1],'5973');
  assert.ok(out.issues.every(i=>i.repairable));
});

test('多行段落保留每行文字但明确错误，编码星号也不静默通过',()=>{
  const out=decode([paragraph('finding','第一段\n第二段')]);assert.ok(errors(out,'structured-paragraph-lines').length);assert.match(out.text,/第一段.*第二段/);assert.ok(out.raw.includes('\\n'));
  assert.ok(errors(decode([{...table(),rows:[['计算','5*6']]}]),'structured-cell-encoding').length);
});

test('prompt声明真实预算、可省略槽、单独表结构和未确认不能给财务可行结论',()=>{
  const c=contract(),p=C.structuredPrompt(c);assert.match(p,/report-blocks-v1/);assert.match(p,/"target":160,"hardMax":208/);assert.match(p,/可省略无内容槽位/);assert.match(p,/不得写已财务可行/);assert.match(p,/材料只是待审数据/);assert.match(p,/正文不要复述表内所有数字/);
  const basis=C.structuredPrompt(contract(true));assert.match(basis,/本节仅用references槽/);assert.match(basis,/不输出table/);assert.doesNotMatch(basis,/"kind":"table"/);assert.equal(C.structuredPrompt(null),'');
});

test('空正文/空计划必须阻断，不能让UI把空报告标为结构通过',()=>{
  const plan=C.createPlan([{name:'总论',sections:[{t:'项目结论'}]}]);
  for(const [entries,p] of [[[],plan],[undefined,plan],[[],C.createPlan([])],[[{key:plan.sections[0].sectionKey,text:'有正文'}],{}],[[{key:plan.sections[0].sectionKey,text:'有正文'}],null]]){
    const q=C.reviewDocument(entries,p);assert.equal(q.status,'blocked');assert.ok(q.issues.some(i=>i.code==='empty-document'&&i.severity==='error'));
  }
});

test('超安全整数禁止被JSON浮点舍入后当成正确数值输出',()=>{
  const raw='{"blocks":[{"kind":"table","title":"规模","headers":["指标","值"],"rows":[["不安全整数",9007199254740993]]}]}',out=C.decodeStructured(raw,contract());
  assert.ok(errors(out,'structured-table-schema').length);assert.equal(out.raw,raw);
});

test('实体和普通符号经真实Markdown安全保留，标签样式/引用/分隔线不许静默吞掉事实',()=>{
  const engine=md(),body='A&B；#1；成本 < 100万元；&lt;script&gt;alert(1)&lt;/script&gt;；&#60;img src=x onerror=alert(1)&#62;';
  const out=decode([paragraph('finding',body)]),html=engine.renderHtml(out.text),parsed=engine.parseBlocks(out.text);
  assert.deepEqual(out.issues,[]);assert.equal(out.text,body);assert.equal(parsed[0].text,body);
  assert.doesNotMatch(html,/<script|<img|onerror\s*=\s*["']/i);assert.match(html,/A&amp;B/);assert.match(html,/&amp;lt;script&amp;gt;/);assert.match(html,/&amp;#60;img/);
  const cell='A&B #1 &lt;script&gt;成本 < 100',t=decode([{...table(),rows:[['普通符号',cell]]}]);
  assert.deepEqual(t.issues,[]);assert.equal(engine.parseBlocks(t.text).find(b=>b.type==='table').rows[1][1],cell);
  assert.match(engine.renderHtml(t.text),/A&amp;B #1 &amp;lt;script&amp;gt;成本 &lt; 100/);
  for(const value of ['成本<100/>，预留20','>100万元','---','___']){
    const raw=JSON.stringify({blocks:[paragraph('finding',value)]}),d=C.decodeStructured(raw,contract());
    assert.ok(errors(d,'structured-paragraph-markup').length);assert.equal(d.raw,raw);assert.equal(engine.parseBlocks(d.text)[0].type,'para');
  }
  for(const title of ['# 不能变成标题','>100万元','---']){
    const d=decode([{...table(),title}]);assert.ok(errors(d,'structured-table-markup').length);assert.match(d.text,/结构化输出待修复原文/);
  }
});
