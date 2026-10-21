const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js');
const L=require('../report-length-plan.js');
const make=(type='gaibao')=>{const chapters=[{name:'运营',sections:[{t:'管理方案'}]}],lengthPlan={...L.createPlan(chapters),confirmedAt:'2026-10-08T12:00:00Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary({}).fingerprint}};return C.createPlan(chapters,{projectType:type,lengthPlan}).sections[0];};
const decode=(blocks,c=make())=>C.decodeStructured(JSON.stringify({blocks}),c);
test('普通列表为真实ol/ul，start和文字保留，不混入业务标题，所有项目类型兼容',()=>{
  for(const type of ['gaibao','rent','sale','gaibao-commercial']){
    const c={...make(type),requiredHeadings:[{level:3,text:'职责分工'}]};
    const d=decode([{kind:'heading',slot:'finding',level:3,text:'职责分工'},{kind:'paragraph',slot:'finding',text:'按已确认分工执行。'},{kind:'list',slot:'finding',ordered:true,start:3,items:['合同核对','A&B条件核实']},{kind:'list',slot:'finding',ordered:false,items:['落实维护责任']}],c);
    assert.deepEqual(d.issues,[]);assert.match(d.text,/<ol start="3"><li>合同核对<\/li><li>A&amp;B条件核实<\/li><\/ol>/);
    assert.match(d.text,/<ul><li>落实维护责任<\/li><\/ul>/);assert.deepEqual(C.headingOutline(d.text),c.requiredHeadings);
    assert.ok(!C.inspect(d.text,c).issues.some(i=>i.code==='heading-structure-missing'));
    assert.ok(C.measure(d.text).proseCharacters>C.measure('职责分工').proseCharacters);
  }
  assert.deepEqual(C.headingOutline('<ul><li>一、普通事项</li><li><ol><li>（一）嵌套事项</li></ol></li></ul>\n### 业务标题'),[{level:3,text:'业务标题'}]);
});
test('列表不扩大槽位预算，不以列表冒充必需业务标题，顺序错误可定位',()=>{
  const c=make(),max=C.outputSlots(c)[0].hardMax;
  const d=decode([{kind:'paragraph',slot:'finding',text:'甲'},{kind:'list',slot:'finding',ordered:true,items:['乙'.repeat(max)]}],c);
  assert.ok(d.issues.some(i=>i.code==='structured-slot-budget'&&i.severity==='warning'));
  assert.equal(d.text.match(/乙/g).length,max);
  const strict={...c};delete strict.lengthPolicy;
  assert.ok(decode([{kind:'list',slot:'finding',ordered:true,items:['乙'.repeat(max+1)]}],strict).issues.some(i=>i.code==='structured-slot-budget'&&i.severity==='error'));
  assert.ok(decode([{kind:'list',slot:'evidence',ordered:false,items:['事实']},{kind:'list',slot:'finding',ordered:false,items:['判断']}],c).issues.some(i=>i.code==='structured-slot-order'));
  const required={...c,requiredHeadings:[{level:3,text:'业务类别'}]};
  assert.ok(C.inspect(decode([{kind:'list',slot:'finding',ordered:true,items:['业务类别']}],required).text,required).issues.some(i=>i.code==='heading-structure-missing'));
});
test('非法列表保留raw及可见审计文字，不执行标记，依据目录不可添加普通列表',()=>{
  for(const change of [{ordered:'true'},{items:[]},{items:['第一项\n第二项']},{items:['<script>alert(1)</script>']},{items:['1. 手写编号']},{items:[{text:'对象'}]},{start:0},{start:1.5},{start:2,ordered:false},{slot:'unknown'}]){
    const raw=JSON.stringify({blocks:[{kind:'list',slot:'finding',ordered:true,items:['事项'],...change}]}),d=C.decodeStructured(raw,make());
    assert.equal(d.raw,raw);assert.ok(d.issues.some(i=>i.code==='structured-list'));assert.match(d.text,/结构化输出待修复原文/);assert.ok(!d.text.includes('<script>'));
  }
  const basis=C.createPlan([{name:'总论',sections:[{t:'编制依据'}]}]).sections[0];
  assert.ok(decode([{kind:'list',slot:'references',ordered:true,items:['政策分析']}],basis).issues.some(i=>i.code==='structured-list'));
});
