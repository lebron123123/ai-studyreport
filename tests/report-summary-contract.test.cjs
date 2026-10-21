const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('../report-argument.js'),C=require('../report-completion-contract.js');
const copy=x=>structuredClone(x),body=s=>s.editedHtml||s.content||'';
const call=f=>A.summaryContext(f.chapters,'项目研究结论及建议','研究结论',{completionPlan:f.plan});
const details=f=>A.generationOrder(f.chapters).filter(x=>!A.contract(x.chapter.name,x.section.t).summary);
let outline;
async function fixture(){
  if(!outline){
    const seed=JSON.parse(fs.readFileSync(require.resolve('../data/report-logic-gaibao-v1.json'),'utf8'));
    const box=vm.createContext({window:{},fetch:async()=>({ok:true,json:async()=>({ok:true,set:{id:'summary-fixture',version:seed.version,projectType:'gaibao',data:seed}})})});
    vm.runInContext(fs.readFileSync(require.resolve('../report-logic-core.js'),'utf8'),box);
    await box.window.ReportLogicCore.load('gaibao');
    outline=JSON.parse(JSON.stringify(box.window.ReportLogicCore.outline('gaibao',{businessScenario:'housing_conversion'}).chapters));
  }
  const chapters=copy(outline),plan=C.createPlan(chapters),f={chapters,plan};
  for(const [index,row] of A.generationOrder(chapters).entries()){
    const c=plan.sections.find(x=>x.sectionKey===row.chapter.name+' / '+row.section.t);
    row.section.completionContract=copy(c);
    row.section.completionQuality={status:'passed',factsVerified:false};
    if(A.contract(row.chapter.name,row.section.t).summary){row.section.content='';continue;}
    if(c.requirements.basis){row.section.content='《[系统测试]项目资料目录》';continue;}
    const opening='第'+index+'节项目事实。',middle='普通中部独有信息'+index+'：'+('条件需按原协议核实。'.repeat(65)),risk='本节末尾限制'+index+'：尚不能认定财务可行，须待协议口径重核后审签。';
    row.section.content=opening+'\n\n## 本节情况\n'+middle+'\n\n'+risk;
    for(const rule of c.requiredTables)row.section.content+='\n\n<table><tr><th>'+rule.terms[0]+'</th><th>口径</th></tr><tr><td>123.45</td><td>须待原件核实</td></tr></table>';
    const errors=C.inspect(row.section.content,c).issues.filter(x=>x.severity==='error');
    assert.deepEqual(errors,[],c.sectionKey+' fixture must satisfy its real section contract');
  }
  return f;
}
function legacyBudget(fn){assert.throws(fn,error=>error.code==='REPORT_SUMMARY_CONTEXT_BUDGET'&&error.budget===20000);}
function smallFixture(){
  const chapters=[{name:'经营分析',sections:[{t:'经营口径',numeric:true,content:'项目现状。'}]},{name:'总论',sections:[{t:'结论',content:''}]}],plan=C.createPlan(chapters);
  chapters[0].sections[0].completionContract=copy(plan.sections[0]);
  return {chapters,plan};
}

test('真实43节目录合规新稿超过20k时全量规范化，保留所有明细结尾限制与中部正文',async()=>{
  const f=await fixture(),original=JSON.stringify(f),rows=details(f);
  assert.equal(f.plan.sections.length,43);assert.equal(rows.length,34);
  const text=call(f);
  assert.ok(text.length>20000&&text.length<100000,'full context remains bounded');
  assert.match(text,/合同就绪正文的全量论证上下文/);assert.doesNotMatch(text,/普通块省略|开头完整句节选/);
  for(const row of rows){
    const risk=body(row.section).match(/本节末尾限制\d+：[^\n]+/);
    if(risk)assert.ok(text.includes(risk[0]),row.section.t);
    const middle=body(row.section).match(/普通中部独有信息\d+/);
    if(middle)assert.ok(text.includes(middle[0]),row.section.t);
  }
  assert.match(text,/《\[系统测试\]项目资料目录》/);
  assert.match(text,/机械验收不证明事实/);assert.equal(JSON.stringify(f),original);
  legacyBudget(()=>A.summaryContext(f.chapters,'总论','建议'));
});

test('全量路径优先当前编辑稿，完整保留HTML合并格/Markdown表及标题，不采用候选或任务正文',()=>{
  const f=smallFixture(),s=f.chapters[0].sections[0];
  s.content='旧正文原内容';
  s.editedHtml='<h2>现状标题</h2><p>当前编辑稿事实。</p><table><caption>实际测算口径</caption><tr><th rowspan="2">事项</th><th>条件</th></tr><tr><td>须以六年协议为准</td></tr><tr><td>IRR</td><td>11.08%</td></tr></table>\n\n| 事项 | 范围 |\n| --- | --- |\n| 期限 | 6年 |\n\n<h3>原末尾标题</h3><p>尚不能认定财务可行，必须先核实经营口径。</p>';
  s.pendingRevision={after:'错误候选：已审定可行。'};s.executionTask={text:'错误任务正文',structuredText:'不可采用结构化旧输出'};
  assert.equal(C.inspect(s.editedHtml,s.completionContract).status,'passed');
  const original=JSON.stringify(f),text=call(f);
  for(const expected of ['现状标题','实际测算口径','rowspan=2','须以六年协议为准','11.08%','[期限] | [6年]','原末尾标题','尚不能认定财务可行，必须先核实经营口径。','未接受候选未采用'])assert.ok(text.includes(expected),expected);
  assert.doesNotMatch(text,/旧正文原内容|错误候选|错误任务正文|结构化旧输出/);assert.equal(JSON.stringify(f),original);
});

test('新详实合同超过60k的明细正文完整进入总论，不沿用36k正文池或静默节选',async()=>{
  const f=await fixture();let total=0;
  for(const [i,row] of details(f).entries()){
    const c=row.section.completionContract;if(c.requirements.basis)continue;
    const start='[系统测试]第'+i+'项完整分析。',end='末尾限制'+i+'：必须核实协议后再作投资判断。';
    row.section.content=start+'甲'.repeat(c.requirements.proseTarget-start.length-end.length)+end;
    for(const rule of c.requiredTables)row.section.content+='\n\n<table><tr><th>'+rule.terms[0]+'</th><th>口径</th></tr><tr><td>123.45</td><td>须待原件核实</td></tr></table>';
    const quality=C.inspect(row.section.content,c);assert.notEqual(quality.status,'blocked',c.sectionKey);total+=quality.metrics.proseCharacters;
  }
  assert.ok(total>60000);const before=JSON.stringify(f),text=call(f);
  for(const [i,row] of details(f).entries())if(!row.section.completionContract.requirements.basis)assert.ok(text.includes('末尾限制'+i+'：必须核实协议后再作投资判断。'));
  assert.ok(text.length>60000&&text.length<A.SUMMARY_FULL_LIMITS.context);assert.doesNotMatch(text,/普通块省略|开头完整句节选/);assert.equal(JSON.stringify(f),before);
});

test('当前正文重新验收而非旧passed回执，必要事实/待补/当前编辑超预算均不能进入总结',async t=>{
  for(const kind of ['fact','marker','budget'])await t.test(kind,()=>{
    const f=smallFixture(),s=f.chapters[0].sections[0],c=f.plan.sections[0];
    if(kind==='fact')c.requiredFacts=[{key:'term',label:'协议期限',value:'6年',status:'confirmed',required:true,owner:c.sectionKey,source:'test'}];
    if(kind==='marker')c.requiredMarkers=['【待补：核实协议】'];
    s.completionContract=copy(c);s.completionQuality={status:'passed',factsVerified:true};
    s.pendingRevision={after:'6年。【待补：核实协议】'};
    s.editedHtml=kind==='budget'?'甲'.repeat(c.requirements.proseMax+1):'当前编辑稿删除了约束。';
    const original=JSON.stringify(f);
    assert.throws(()=>call(f),error=>error.code==='REPORT_SUMMARY_CONTRACT_BLOCKED'&&error.issues.some(x=>x.severity==='error'));
    assert.equal(JSON.stringify(f),original);
  });
});

test('旧/混合/过期/预算及事实责任不匹配不能启用全量通道，固定总池不能被伪造放大',async t=>{
  const cases={
    unbound:f=>{delete details(f)[0].section.completionContract;},
    oldVersion:f=>{f.plan.version='old';},
    wrongPlan:f=>{details(f)[0].section.completionContract.planId='old-plan';},
    wrongSection:f=>{details(f)[0].section.completionContract.sectionKey='另一个小节';},
    wrongBudget:f=>{details(f)[0].section.completionContract.requirements.proseMax++;},
    wrongResponsibility:f=>{details(f)[0].section.completionContract.responsibility='任意职责';},
    wrongFacts:f=>{details(f)[0].section.completionContract.requiredFacts.push({key:'new',value:'不能伪造',status:'confirmed'});},
    missingMarker:f=>{f.plan.sections.find(c=>c.sectionKey===details(f)[1].section.completionContract.sectionKey).requiredMarkers=['【待补：仍须核实】'];},
    expandedProse:f=>{f.plan.proseTotal=C.LENGTH_PROFILE.proseTotal+1;},
    unknownProfile:f=>{f.plan.lengthProfileVersion='unshipped-larger-pool';},
    expandedTables:f=>{f.plan.tableCharactersTotal=30001;},
    expandedRows:f=>{f.plan.tableRowsTotal=601;},
    materialDependent:f=>{f.plan.materialIndependent=false;},
    duplicateSection:f=>{f.plan.sections[1]=copy(f.plan.sections[0]);},
    missingSection:f=>{f.plan.sections.pop();}
  };
  for(const [name,change] of Object.entries(cases))await t.test(name,async()=>{const f=await fixture();change(f);legacyBudget(()=>call(f));});
});

test('当前已接受冻结表/新增待补绑定可以晚于计划，仍逐格验收，不要求旧冻结收据逐字相同',async()=>{
  const f=smallFixture(),s=f.chapters[0].sections[0],table='<table><tr><th>指标</th><th>值</th></tr><tr><td>面积</td><td>128.56平方米</td></tr></table>';
  s.content='当前项目事实。【待补：协议口径未确认】\n\n'+table;
  s.completionContract=await C.bindFrozenTables({...s.completionContract,requiredMarkers:['【待补：协议口径未确认】']},s.content,'accepted-body-v2');
  assert.match(call(f),/128\.56平方米/);assert.match(call(f),/【待补：协议口径未确认】/);
  s.editedHtml=s.content.replace('128.56','256.12');
  assert.throws(()=>call(f),error=>error.code==='REPORT_SUMMARY_CONTRACT_BLOCKED'&&error.issues.some(x=>x.code==='frozen-table-missing'));
});

test('引用已免除必要表时仍核对原表职责，绑定引用不得丢失',async()=>{
  const chapters=[{name:'经营分析',sections:[{t:'规模台账',content:''},{t:'范围摘要',content:''}]},{name:'总论',sections:[{t:'结论',content:''}]}],plan=C.createPlan(chapters),f={chapters,plan};
  const rule={title:'规模表',headers:['项目','面积'],terms:[]},table='<table><tr><th>项目</th><th>面积</th></tr><tr><td>甲</td><td>5973</td></tr></table>',hash=C.fingerprint([[['项目',1,1],['面积',1,1]],[['甲',1,1],['5973',1,1]]]);
  plan.sections[1].requiredTables=[rule];
  const [target,source]=chapters[0].sections;target.content='项目规模。\n\n'+table;target.completionContract=copy(plan.sections[0]);
  const ref='<span class="rpt-table-reference" data-report-ref-section="'+plan.sections[0].sectionKey+'" data-report-ref-scope="document" data-report-ref-table-kind="cells-v1" data-report-ref-table-hash="'+hash+'">详见第1.1节规模台账。</span>';
  source.content='项目范围。'+ref;
  source.completionContract=await C.bindDocumentReferences(plan.sections[1],[{key:plan.sections[0].sectionKey,number:'1.1',text:target.content},{key:plan.sections[1].sectionKey,number:'1.2',text:source.content}]);
  assert.deepEqual(source.completionContract.requiredTables,[]);
  assert.match(call(f),/合同就绪正文/);assert.match(call(f),/详见第1\.1节规模台账/);
  source.content='项目范围，但已删除引用。';
  assert.throws(()=>call(f),error=>error.code==='REPORT_SUMMARY_CONTRACT_BLOCKED'&&error.issues.some(x=>x.code==='bound-reference-missing'));
});

test('全文聚合budget不因每节各自通过而放大，安全硬限计入全部块和章节标签',async t=>{
  await t.test('prose pool',()=>{
    const f=smallFixture();f.plan.proseTotal=10;f.chapters[0].sections[0].content='条件需按原协议核实。'.repeat(20);
    assert.throws(()=>call(f),error=>error.code==='REPORT_SUMMARY_DOCUMENT_BUDGET'&&error.metric==='proseCharacters'&&error.budget===13);
  });
  await t.test('table pool',()=>{
    const f=smallFixture();f.plan.tableCharactersTotal=5;f.chapters[0].sections[0].content='项目事实。<table><tr><td>完整的原表内容必须保留</td></tr></table>';
    assert.throws(()=>call(f),error=>error.code==='REPORT_SUMMARY_DOCUMENT_BUDGET'&&error.metric==='tableCharacters');
  });
  await t.test('row pool',()=>{
    const f=smallFixture();f.plan.tableRowsTotal=1;f.chapters[0].sections[0].content='项目事实。<table><tr><td>第一行</td></tr><tr><td>第二行</td></tr></table>';
    assert.throws(()=>call(f),error=>error.code==='REPORT_SUMMARY_DOCUMENT_BUDGET'&&error.metric==='tableRows');
  });
  await t.test('labels count towards fixed safety limit',async()=>{
    const f=await fixture();for(const row of details(f))if(!row.section.completionContract.requirements.basis){
      const c=row.section.completionContract;
      row.section.content=Array.from({length:400},()=>'<p>甲。</p>').join('')+(c.requiredTables.length?'<table><tr><td>'+c.requiredTables.map(x=>x.terms[0]).join(' / ')+'</td></tr></table>':'');
      assert.equal(C.inspect(row.section.content,c).issues.filter(x=>x.severity==='error').length,0);
    }
    assert.throws(()=>call(f),error=>error.code==='REPORT_SUMMARY_CONTEXT_BUDGET'&&error.budget===A.SUMMARY_FULL_LIMITS.context&&error.requiredChars>A.SUMMARY_FULL_LIMITS.context);
  });
});

test('当前失效正文与未就绪的表格/事实职责分配明确阻断，旧总结不参与聚合预算',async t=>{
  const f=await fixture();for(const row of A.generationOrder(f.chapters))if(A.contract(row.chapter.name,row.section.t).summary)row.section.content='旧总结'.repeat(100000);
  assert.match(call(f),/合同就绪正文/);
  for(const field of ['tableAllocation','factAllocation'])await t.test(field,async()=>{const g=await fixture();g.plan[field]={status:'blocked',issues:[]};assert.throws(()=>call(g),e=>e.code==='REPORT_SUMMARY_CONTRACT_BLOCKED');});
  const s=details(f)[0].section;s.syncStatus='stale';assert.throws(()=>call(f),/等待正文完成/);
});

test('浏览器全局路径消费同一个新合同通道，不依赖持久缓存或候选结构字段',async()=>{
  const f=await fixture(),box=vm.createContext({});
  for(const file of ['md.js','report-completion-contract.js','report-argument.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),box);
  assert.equal(box.ReportArgument.summaryContext(f.chapters,'总论','建议',{completionPlan:f.plan}),call(f));
});

test('严格调用方显式拒绝缺失或混合合同，默认旧稿仍走兼容路径',()=>{
  const f=smallFixture();delete f.chapters[0].sections[0].completionContract;
  assert.match(call(f),/已完成正文的论证上下文/);
  assert.throws(()=>A.summaryContext(f.chapters,'总论','建议',{completionPlan:f.plan,requireCurrentContracts:true}),e=>e.code==='REPORT_SUMMARY_CONTRACT_MISMATCH');
  assert.match(A.summaryContext(f.chapters,'总论','建议',null),/已完成正文的论证上下文/);
});
