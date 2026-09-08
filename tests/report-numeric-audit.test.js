const test=require('node:test'),assert=require('node:assert/strict'),N=require('../report-numeric-audit.js');
const investment={key:'totalInvestment',label:'总投资',aliases:['项目总投资'],value:15000,unit:'万元',sourceRef:'测算快照A',version:2};
test('整篇各次出现都核查：不截前40字、不只检查首处',()=>{
  const r=N.audit({text:'总投资'+('经核对正式项目材料、'.repeat(20))+'为1.5亿元。\n总投资为一亿五千万元。\n总投资为14,000万元。',expected:[investment]});
  assert.equal(r.checked[0].occurrences.length,3);assert.equal(r.checked[0].status,'mismatch');assert.ok(r.findings.some(x=>x.kind==='conflicting_occurrences'));
});
test('中文数字与元/万元/亿元归一，百分比和百分点严格区分',()=>{
  for(const [v,n] of [['壹亿零伍佰万元'.slice(0,-1),105000000],['负一百二十三点四五',-123.45],['二〇二六',2026],['十',10],['一万零一',10001]])assert.equal(N.normalizeNumber(v),n);
  assert.equal(N.audit({text:'总投资1.5亿元；总投资一亿五千万元；总投资150,000,000元。',expected:[investment]}).declaredNumbersPassed,true);
  const pct=N.audit({text:'利润率百分之五点二。利润率增加5.2个百分点。',expected:[{label:'利润率',value:5.2,unit:'%'}]});assert.equal(pct.checked[0].status,'unit_mismatch');
});
test('Markdown横表、列式表、HTML表格与括号单位能识别',()=>{
  for(const raw of ['| 指标 | 数值 | 单位 |\n| --- | --- | --- |\n| 总投资 | 15000 | 万元 |','| 总投资（万元） | 项目名称 |\n| --- | --- |\n| 15000 | 项目A |','| 总投资（万元） | 15000 |','<table><tr><th>指标</th><th>数值</th><th>单位</th></tr><tr><td>总投资</td><td>15000</td><td>万元</td></tr></table>']){
    const r=N.audit({text:raw,expected:[investment]});assert.equal(r.declaredNumbersPassed,true,raw+JSON.stringify(r));
  }
});
test('缺失不是零，未声明的数值与无指标来源不宣称核验成功',()=>{
  const r=N.audit({text:'总投资尚待测算。营业收入500万元。',expected:[{label:'总投资',value:0,unit:'万元'}]});assert.equal(r.checked[0].status,'missing');assert.equal(r.unmatched.length,1);assert.equal(r.passed,false);
  const missing=N.audit({text:'总投资0万元',expected:[{label:'总投资',unit:'万元'}]});assert.equal(missing.checked[0].status,'invalid_expected');
  assert.equal(N.audit({text:'总投资10万元'}).passed,false);
});
test('税前税后、项目资本金IRR及净利润/收入不串口径',()=>{
  const r=N.audit({text:'税前项目IRR8%。税后项目IRR5%。资本金IRR12%。收入300万元，净利润50万元。',expected:[{key:'projectIrrAfterTax',label:'税后项目IRR',aliases:['IRR'],value:5,unit:'%'},{key:'netProfit',label:'净利润',value:50,unit:'万元'}]});
  assert.equal(r.checked[0].occurrences.length,1);assert.equal(r.checked[0].occurrences[0].value,5);assert.equal(r.checked[1].occurrences.length,1);assert.equal(r.declaredNumbersPassed,true);assert.ok(r.unmatched.length>=3);
});
test('中途出现其他指标时不把该指标数值强配给前项',()=>{
  const r=N.audit({text:'总投资待确认，营业收入500万元。',expected:[investment]});assert.equal(r.checked[0].occurrences.length,0);assert.equal(r.unmatched[0].kind,'ambiguous_metric');
});
test('容差按原期望单位转换，租金年月及面积能换算但不混量纲',()=>{
  const r=N.audit({text:'总投资1.50001亿元。租金504元/平方米/年。建筑面积二万平方米。',expected:[{...investment,tolerance:1},{label:'租金',value:42,unit:'元/平方米/月'},{label:'建筑面积',value:20000,unit:'平方米'}]});assert.equal(r.declaredNumbersPassed,true);assert.equal(r.semanticAccuracyVerified,false);assert.equal(r.wordLayoutVerified,false);
});
test('裸数字未核验不会全绿，空表格单元格不移位绑定',()=>{
  const r=N.audit({text:'总投资1.5亿元，另外500尚待确认。',expected:[investment]});assert.equal(r.declaredNumbersPassed,true);assert.equal(r.passed,false);assert.equal(r.unmatched[0].raw,'500');
  const empty=N.audit({text:'| 项目 | 总投资（万元） | 收入（万元） |\n|---|---|---|\n| A | | 15000 |',expected:[investment]});assert.equal(empty.checked[0].status,'missing');
  const paren=N.audit({text:'总投资15000（万元）。',expected:[investment]});assert.equal(paren.passed,true);
});
