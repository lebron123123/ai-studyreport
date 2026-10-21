const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const A=require('../report-argument.js'),C=require('../report-completion-contract.js'),L=require('../report-length-plan.js');
const copy=value=>structuredClone(value);
function fixture({proseTotal=50000,targetPages=80,actual=66000,confirmed=true,budgets={},structures={}}={}){
  const chapters=[{name:'经营分析',sections:Array.from({length:32},(_,i)=>({t:'经营事项'+i,content:''}))},{name:'项目研究结论及建议',sections:[{t:'研究结论',content:''}]}];
  let lengthPlan=L.createPlan(chapters,{proseTotal,targetPages});
  if(confirmed)lengthPlan={...lengthPlan,confirmedAt:'2026-10-08T12:00:00.000Z',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary(budgets).fingerprint}};
  const plan=C.createPlan(chapters,{lengthPlan,budgets,structures});
  for(const [i,section] of chapters[0].sections.entries()){
    const contract=plan.sections.find(c=>c.sectionKey===chapters[0].name+' / '+section.t);
    section.completionContract=copy(contract);
    const size=Math.floor(actual/32)+(i<actual%32?1:0),opening='第'+i+'项业务事实。',middle='中部独有论证'+i+'：',tail='末尾限制'+i+'：协议核实后才能作出判断。';
    section.content=opening+'\n\n'+middle+'甲'.repeat(Math.max(0,size-opening.length-middle.length-tail.length))+'\n\n'+tail;
    const metrics=C.measure(section.content);assert.equal(metrics.proseCharacters,size);
    const errors=C.inspect(section.content,contract).issues.filter(x=>x.severity==='error');
    if(confirmed)assert.deepEqual(errors,[]);
    else assert.ok(errors.every(x=>x.code==='budget-proseCharacters'),'未确认夹具仅允许正文硬预算错误，其他事实/结构错误仍应失败');
  }
  return {chapters,plan};
}
const call=(f,options={})=>A.summaryContext(f.chapters,'项目研究结论及建议','研究结论',{completionPlan:f.plan,...options});
function complete(f){const before=JSON.stringify(f),text=call(f);assert.match(text,/合同就绪正文的全量论证上下文/);assert.doesNotMatch(text,/普通块省略|开头完整句节选/);for(let i=0;i<32;i++){assert.ok(text.includes('中部独有论证'+i+'：'));assert.ok(text.includes('末尾限制'+i+'：协议核实后才能作出判断。'));}assert.equal(JSON.stringify(f),before);return text;}

test('确认80页5万字参考后，6.6万字真实正文仍全量进入总结，不因1.3倍警戒机械精简',()=>{const f=fixture();assert.ok(C.reviewDocument(f.chapters.flatMap(c=>c.sections.map(s=>({key:c.name+' / '+s.t,text:s.content}))),f.plan).issues.some(i=>i.code==='document-budget'&&i.severity==='warning'));assert.ok(complete(f).length>66000);});
test('确认默认120页7.5万字后，10万字正文不被旧全篇参考硬挡',()=>{assert.ok(complete(fixture({proseTotal:75000,targetPages:120,actual:100000})).length>100000);});
test('自定义10万字有效确认计划不退回旧7.5万字池或摘要节选',()=>{const f=fixture({proseTotal:100000,targetPages:140,actual:100000});assert.ok(f.plan.proseTotal>C.LENGTH_PROFILE.proseTotal);complete(f);});
test('保留旧人工正文预算但确认新计划优先；预算指纹发生变化拒绝全量',()=>{const budgets={'经营分析 / 经营事项0':{proseTarget:300,proseMax:400,reason:'历史缩写预算'}},f=fixture({budgets});complete(f);f.plan.budgetOverrides['经营分析 / 经营事项0'].proseMax=401;assert.throws(()=>call(f,{requireCurrentContracts:true}),e=>e.code==='REPORT_SUMMARY_CONTRACT_MISMATCH');});
test('未确认计划继续单节硬预算和全篇参考保护，不靠advisory字段放大',()=>{const f=fixture({confirmed:false}),before=JSON.stringify(f);assert.throws(()=>call(f),e=>e.code==='REPORT_SUMMARY_CONTRACT_BLOCKED'&&e.issues.some(i=>i.code==='budget-proseCharacters'));assert.equal(JSON.stringify(f),before);});
test('旧无确认或未知版本的大目标仍不能启用全量输入',()=>{for(const mode of ['unconfirmed','unknown']){const f=fixture({proseTotal:100000,targetPages:140,actual:100000});if(mode==='unconfirmed'){delete f.plan.lengthPlan.confirmedAt;delete f.plan.lengthPlan.budgetResolution;}else f.plan.lengthPlan.version='unshipped';assert.throws(()=>call(f,{requireCurrentContracts:true}),e=>e.code==='REPORT_SUMMARY_CONTRACT_MISMATCH');}});
test('目录、计划ID、总目标、确认时间、分配、合同策略或结构失配不启用新篇幅通道',async t=>{
  const changes={outline:f=>{f.chapters[0].sections[0].t='变更后的真实业务主题';},lengthPlanId:f=>{f.plan.lengthPlanId='another-length-plan';},lengthIdentity:f=>{f.plan.lengthPlan.planId='forged';},proseTotal:f=>{f.plan.proseTotal++;},confirmation:f=>{f.plan.lengthPlan.confirmedAt='not-a-time';},allocation:f=>{f.plan.sections[0].requirements.proseTarget++;f.chapters[0].sections[0].completionContract.requirements.proseTarget++;},planId:f=>{f.chapters[0].sections[0].completionContract.planId='another-completion-plan';},policy:f=>{delete f.chapters[0].sections[0].completionContract.lengthPolicy;},headings:f=>{f.plan.sections[0].requiredHeadings=[{level:3,text:'业务标题'}];},structureBinding:f=>{f.plan.sections[0].structureBinding={version:'business-structure-v1',sourceHash:'test-structure'};}};
  for(const [name,change] of Object.entries(changes))await t.test(name,()=>{const f=fixture(),before=JSON.stringify(f);change(f);const changed=JSON.stringify(f);assert.notEqual(changed,before);assert.throws(()=>call(f,{requireCurrentContracts:true}),e=>e.code==='REPORT_SUMMARY_CONTRACT_MISMATCH');assert.equal(JSON.stringify(f),changed);});
});
test('numeric元数据不废弃已确认全文计划，当前表格合同仍须重建并逐节一致',()=>{
  const f=fixture(),receipt=JSON.stringify(f.plan.lengthPlan);f.chapters[0].sections[0].numeric=true;
  assert.equal(L.validatePlan(f.plan.lengthPlan,f.chapters).valid,true);
  f.plan=C.createPlan(f.chapters,{lengthPlan:f.plan.lengthPlan});
  assert.throws(()=>call(f,{requireCurrentContracts:true}),e=>e.code==='REPORT_SUMMARY_CONTRACT_MISMATCH','旧表格合同不能冒充调用方重建的当前合同');
  for(const chapter of f.chapters)for(const section of chapter.sections)section.completionContract=copy(f.plan.sections.find(c=>c.sectionKey===chapter.name+' / '+section.t));
  assert.equal(JSON.stringify(f.plan.lengthPlan),receipt);complete(f);
});
test('新计划仍重查事实和待补约束；不能把错误绑定当作已通过正文',()=>{for(const kind of ['fact','marker']){const f=fixture(),c=f.plan.sections[0];if(kind==='fact')c.requiredFacts=[{key:'term',label:'协议期限',value:'6年',status:'confirmed',required:true,owner:c.sectionKey,source:'[系统测试]'}];else c.requiredMarkers=['【待补：协议签约状态】'];f.chapters[0].sections[0].completionContract=copy(c);assert.throws(()=>call(f),e=>e.code==='REPORT_SUMMARY_CONTRACT_BLOCKED');}});
test('绝对正文容量不因新确认或高目标放宽，失败保留全文而不要求按参考字数精简',()=>{const f=fixture({proseTotal:100000,targetPages:140,actual:A.SUMMARY_FULL_LIMITS.proseCharacters+1}),before=JSON.stringify(f);assert.throws(()=>call(f),e=>e.code==='REPORT_SUMMARY_DOCUMENT_BUDGET'&&e.metric==='proseCharacters'&&e.budget===A.SUMMARY_FULL_LIMITS.proseCharacters&&/绝对安全容量/.test(e.message)&&!/先逐节精简/.test(e.message));assert.equal(JSON.stringify(f),before);});
test('新确认仍保持全篇表格字符及行数硬预算，不静默删除表格',()=>{for(const metric of ['tableCharacters','tableRows']){const f=fixture({actual:50000}),s=f.chapters[0].sections[0];s.content+='<table><tr><td>完整原表待核对</td></tr><tr><td>第二行</td></tr></table>';f.plan[metric==='tableCharacters'?'tableCharactersTotal':'tableRowsTotal']=1;const before=JSON.stringify(f);assert.throws(()=>call(f),e=>e.code==='REPORT_SUMMARY_DOCUMENT_BUDGET'&&e.metric===metric);assert.equal(JSON.stringify(f),before);}});
test('全量规范化标签计入160000字符绝对输入容量，失败不截断正文',()=>{const f=fixture({actual:50000});for(const s of f.chapters[0].sections)s.content=Array.from({length:400},()=>'<p>甲。</p>').join('');const before=JSON.stringify(f);assert.throws(()=>call(f),e=>e.code==='REPORT_SUMMARY_CONTEXT_BUDGET'&&e.budget===A.SUMMARY_FULL_LIMITS.context);assert.equal(JSON.stringify(f),before);});
test('浏览器全局和CommonJS消费者使用同一已确认全量路径',()=>{const f=fixture(),box=vm.createContext({});for(const file of ['md.js','report-length-plan.js','report-completion-contract.js','report-argument.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),box);assert.equal(box.ReportArgument.summaryContext(f.chapters,'项目研究结论及建议','研究结论',{completionPlan:f.plan}),complete(f));});
