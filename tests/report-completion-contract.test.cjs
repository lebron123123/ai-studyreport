const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../report-completion-contract.js');
const chapters=[{name:'总论',sections:[{t:'项目概况'},{t:'编制依据'}]},{name:'财务',sections:[{t:'现金流',numeric:true}]}];
test('需求职责同时约束业务比较而非只统计字数，定性匹配不要求虚构数字',()=>{
  for(const projectType of ['gaibao','rent','sale']){
    const contract=C.createPlan([{name:'市场分析',sections:[{t:'需求分析：人口、就业与租赁市场基础'}]}],{projectType}).sections[0];
    assert.equal(contract.requirements.tableMax,2);
    assert.ok(C.inspect('已分析人口就业。',contract).issues.some(i=>i.code==='missing-table'));
    const table='<table><tr><th>需求类型</th><th>已知产品</th><th>匹配条件</th></tr><tr><td>家庭整租</td><td>材料登记大户型</td><td>预算与资格须核对，不推定需求数量</td></tr></table>';
    assert.ok(!C.inspect(table,contract).issues.some(i=>i.code==='missing-table'));
  }
});
test('三类计划不受材料数量、旧正文长度影响；预算、事实版本可追踪',()=>{for(const projectType of ['gaibao','rent','sale']){const a=C.createPlan(chapters,{projectType}),b=C.createPlan(JSON.parse(JSON.stringify(chapters)).map(c=>({...c,sections:c.sections.map(s=>({...s,content:'长材料'.repeat(10000)}))})),{projectType});assert.deepEqual(a,b);assert.equal(a.maxPages,130);assert.equal(a.targetPages,120);assert.deepEqual(a.targetPageRange,{min:110,max:130});assert.equal(a.lengthProfileVersion,C.LENGTH_PROFILE.version);assert.notEqual(a.planId,C.createPlan(chapters,{projectType,facts:[{key:'area',value:'5973',status:'pending'}]}).planId);}});
test('超正文、表格膨胀、缺结构不截断，保存原始值',()=>{const c=C.createPlan(chapters).sections[0],source='长'.repeat(c.requirements.proseMax+1)+'\n[[TABLE]]\n指标|值\n面积|5973|平方米',before=source;const q=C.inspect(source,c);assert.equal(q.status,'blocked');assert.ok(q.issues.some(i=>i.code==='budget-proseCharacters'));assert.ok(q.issues.some(i=>i.code==='table-shape'));assert.ok(q.issues.some(i=>i.code==='table-markers'));assert.equal(q.factsVerified,false);assert.equal(source,before);});
test('Markdown与HTML表格独立计量；单元格膨胀不能逃过正文预算',()=>{const c=C.createPlan(chapters).sections[0];for(const text of ['指标|值\n---|---\n备注|'+('字'.repeat(181)),'<table><tr><th>指标</th><th>值</th></tr><tr><td>备注</td><td>'+('字'.repeat(181))+'</td></tr></table>']){const q=C.inspect(text,c);assert.equal(q.metrics.proseCharacters,0);assert.equal(q.metrics.tableRows,2);assert.ok(q.issues.some(x=>x.code==='budget-maxCellCharacters'));}});
test('缺证据不能标记事实核验完成；关键事实及必要表不许因压缩消失',()=>{const plan=C.createPlan(chapters,{facts:[{key:'area',label:'面积',value:'5973',status:'pending',source:'协议1.5',owner:'总论 / 项目概况',required:true}]}),c=plan.sections[0];c.requiredTables=[{title:'规模表',headers:['指标','值']}];const q=C.inspect('简洁结论',c);assert.equal(q.status,'blocked');assert.ok(q.issues.some(i=>i.code==='missing-fact'));assert.ok(q.issues.some(i=>i.code==='missing-table'));assert.ok(q.issues.some(i=>i.code==='fact-pending'));assert.equal(C.inspect('旧稿').status,'unverified');assert.throws(()=>C.normalize({...c,version:'old'}));});
test('全篇查重和漏节不会删改材料；局部替换后全节同样复核',()=>{const plan=C.createPlan(chapters),text='保留人工核查的关键说明'.repeat(20),entries=plan.sections.map(s=>({key:s.sectionKey,text})),before=JSON.stringify(entries),q=C.reviewDocument(entries,plan);assert.equal(q.status,'blocked');assert.ok(q.issues.some(i=>i.code==='duplicate-paragraph'));assert.equal(JSON.stringify(entries),before);assert.ok(C.reviewDocument(entries.slice(1),plan).issues.some(i=>i.code==='missing-section'));});
test('检索命中后段条款而非文首，提供原文位置，重复材料不增加证据预算',()=>{const body='背景'.repeat(3000)+'协议经营期限6年。实际面积5973平方米。',entries=[{title:'协议',content:body}];const out=C.evidenceWindows(entries,['期限','面积']);assert.ok(out[0].offset>5000);assert.match(out[0].text,/期限6年/);assert.ok(out.reduce((n,x)=>n+x.text.length,0)<=2600);assert.deepEqual(C.evidenceWindows(entries,['无命中']),[]);});
test('合并单元格按占位网格核验，不将合法 rowspan/colspan 误判为缺列',()=>{
  const valid='<table><tr><th rowspan="2">项目</th><th colspan="2">金额</th></tr><tr><td>含税</td><td>不含税</td></tr><tr><td>收入</td><td>109</td><td>100</td></tr></table>';
  assert.equal(C.measure(valid).malformedTables,0);
  assert.equal(C.measure(valid.replace('<td>100</td>','')).malformedTables,1);
  assert.equal(C.measure('<table><tr><td rowspan="3">项目</td><td>金额</td></tr></table>').malformedTables,1);
});
test('职责必要表可引用确实存在的标准表，但不能引用空节或无关表冒充',()=>{
  const plan=C.createPlan([{name:'财务',sections:[{t:'现金流汇总'},{t:'现金流评价'}]}]);
  const entries=[{key:plan.sections[0].sectionKey,number:'1.1',text:'<table><tr><th>现金流量</th><th>金额</th></tr><tr><td>净现金流</td><td>12</td></tr></table>'},{key:plan.sections[1].sectionKey,number:'1.2',text:'<p class="rpt-table-reference">详见第1.1节现金流量表。</p>'}];
  assert.equal(C.reviewDocument(entries,plan).status,'passed');
  const inline=structuredClone(entries);inline[1].text=inline[1].text.replace('<p class=', '<p><span class=').replace('</p>','</span></p>');assert.equal(C.reviewDocument(inline,plan).status,'passed');
  for(const target of ['1.3','1.2']){const bad=structuredClone(entries);bad[1].text=bad[1].text.replace('1.1',target);assert.ok(C.reviewDocument(bad,plan).reviews[1].issues.some(i=>i.code==='missing-table'));}
  const bad=structuredClone(entries);bad[0].text='<table><tr><td>面积</td><td>5973</td></tr></table>';assert.ok(C.reviewDocument(bad,plan).reviews[1].issues.some(i=>i.code==='missing-table'));
});
test('同数值表仅提示核对，测算输入变化使原计划失效；调预算须留原因',()=>{
  const p=C.createPlan(chapters,{inputVersion:'loan-2.6'});assert.notEqual(p.planId,C.createPlan(chapters,{inputVersion:'loan-3.0'}).planId);
  const table='<table><tr><td>甲</td><td>10</td></tr></table>',c={...p.sections[0],requirements:{...p.sections[0].requirements,tableMax:3}};
  const q=C.inspect(table+table,c);assert.equal(q.status,'unverified');assert.ok(q.issues.some(i=>i.code==='duplicate-table'));assert.equal(q.factsVerified,false);
  assert.throws(()=>C.createPlan(chapters,{budgets:{[p.sections[0].sectionKey]:{proseMax:2000}}}),/原因/);
});
test('数值差异不自动补回长段或修改事实；证据窗口跳过目录命中',()=>{
  const before='面积5,973平方米、经营6年，项目总投资2000万元。',after='面积5973平方米、经营6年。';
  const q=C.compareFacts(before,after);assert.deepEqual(q.missing,['2000万元']);assert.equal(q.factsVerified,false);assert.equal(q.issues[0].repairable,false);
  const body='目录\n经营期限............12\n'+'普通内容。'.repeat(1000)+'双方约定首期经营期限6年，投入优先抵扣。';
  const out=C.evidenceWindows([{title:'协议稿',content:body}],['经营期限']);assert.match(out[0].text,/首期经营期限6年/);assert.ok(out[0].offset>4000);
});
