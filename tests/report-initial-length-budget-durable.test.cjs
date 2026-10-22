require('../scripts/windows-browser-lockout-guard.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const Contract=require('../report-completion-contract.js');
const report=fs.readFileSync(require.resolve('../report.js'),'utf8');
const part=(from,to)=>report.slice(report.indexOf(from),report.indexOf(to,report.indexOf(from)));
const production=part('// A length-only edit','// 按用户修改意见改写小节')+'\n'+part('async function reportDurableSectionCall(','async function reportRecoverInitialDeliveryTask(');
const originalCore='<h3>经营边界</h3><p>历史租金75元，不能当当前成交价。若消防未落实不得开业，必须先完成核验。</p><h4>实施条件</h4><p>需完成验收后方可运营，否则将影响交付节点。</p><table><tr><th>项目</th><th>规模</th></tr><tr><td rowspan="2">甲</td><td>75</td></tr><tr><td>待核</td></tr></table>';
const sourceOfSize=n=>originalCore+'<p>'+'核'.repeat(n-Contract.measure(originalCore).proseCharacters)+'</p>';
const original=sourceOfSize(1700);
const hash=s=>createHash('sha256').update(s).digest('hex'),copy=o=>JSON.parse(JSON.stringify(o));
function fixture({source=original,proseTarget=3000,proseMax=3900,target=1200}={}){
  const ctx={console,TextEncoder,Uint8Array,AbortController,setTimeout,clearTimeout,crypto:webcrypto};
  ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require.resolve('../report-completion-contract.js'),'utf8'),ctx);
  vm.runInContext(`
    var s={t:'风险分析',content:${JSON.stringify(source)},editedHtml:null,pendingRevision:null},c={name:'运营',sections:[s]},chapters=[c];
    var currentProjectId='[系统测试]initial-length-budget',projectWorkflow={management:{legacyResearchEpoch:0}},calls=[],receipts=[],assertions=0;
    var expectedSource=s.content,sourceCheckHook=null,transportHook=null;
    var base=ReportCompletionContract.normalize({version:ReportCompletionContract.VERSION,planId:'original-confirmed-plan',sectionKey:'运营 / 风险分析',lengthPolicy:'advisory-v1',projectType:'gaibao',requirements:{proseTarget:${proseTarget},proseMax:${proseMax},tableMax:1,tableRowsMax:4,tableCharsMax:300},requiredHeadings:[{level:3,text:'经营边界'},{level:4,text:'实施条件'}],structureBinding:{version:'business-structure-v2',sourceHash:'original-structure'},requiredFacts:[{key:'rent',label:'历史租金',value:'75',required:true,status:'pending'}],requiredTables:[]});
    var options={source:s.content,instruction:'在原业务标题内精炼重复表达',referenceBudget:{referenceOnly:true,target:${target},actual:ReportCompletionContract.measure(s.content).proseCharacters,min:1000,scope:'details',documentSha256:'${'a'.repeat(64)}',measuredPages:137,targetPages:120,targetPageRange:{min:110,max:130},confirmedProseTotal:84500},permitId:'permit-1',idempotencyKey:'idempotency-1',batchId:'batch-1'};
    var expectedPermit=JSON.parse(JSON.stringify(options));delete expectedPermit.instruction;
    var ReportInitialDeliveryRuntime={assertDraftSource:async(_c,_s,text)=>{assertions++;if(sourceCheckHook)await sourceCheckHook();if(text!==expectedSource)throw Error('原文或许可已变化');},assertLengthConvergence:async(_c,_s,value)=>{await ReportInitialDeliveryRuntime.assertDraftSource(_c,_s,value.source);for(const k of ['permitId','idempotencyKey','batchId','referenceBudget'])if(JSON.stringify(value[k])!==JSON.stringify(expectedPermit[k]))throw Error('许可绑定已变化');},accepts:()=>false};
    var ProjectWorkflow={rememberGeneratedContract:(_s,text,contract)=>receipts.push({text,contract})};
    var rlProjectType=()=> 'gaibao',reportCandidateInputIdentity=()=> 'current-facts-and-plan',reportAssertCompletionPlan=x=>x;
    var reportCompletionPlan=()=>({planId:base.planId,sections:[base]});
    var reportCompletionEntries=override=>[{key:base.sectionKey,number:'1.1',text:override?.html||s.content}];
    var reportFinancialCandidateIssues=()=>[],renderContent=x=>x,saveDraft=()=>{};
    var ReportOrchestrationClient={generateSection:async(input,onTask)=>{calls.push(input);if(transportHook)await transportHook();const result={id:'[系统测试]task',runId:'[系统测试]run',status:'completed',text:options.source};onTask(result);return result;}};
  `,ctx);
  vm.runInContext(production,ctx);
  return {ctx,run:()=>ctx.reportConvergeInitialDeliverySection(ctx.c,ctx.s,ctx.options),normal:()=>ctx.reportDurableSectionCall(ctx.c,ctx.s,'普通首稿','输入',null,{autoRepair:false})};
}
test('真实durable链路：本次目标贯穿前后端合同/槽位/主题；原计划、表、事实及额度不变',async()=>{
  const f=fixture(),before=JSON.stringify(f.ctx.base);await f.run();
  assert.equal(f.ctx.calls.length,1);const sent=copy(f.ctx.calls[0]),bound=Contract.normalize(sent.qualityContract);
  assert.equal(bound.planId,'original-confirmed-plan');assert.equal(bound.requirements.proseTarget,3000);assert.equal(bound.requirements.proseMax,3900);
  assert.equal(bound.initialLengthConvergence.referenceBudget.target,1200);assert.equal(bound.initialLengthConvergence.sourceHash,hash(original));
  assert.equal(sent.initialLengthSource,original);
  assert.equal(bound.initialLengthConvergence.permitId,'permit-1');assert.deepEqual(bound.requiredHeadings,copy(f.ctx.base.requiredHeadings));
  assert.deepEqual(bound.requiredFacts,copy(f.ctx.base.requiredFacts));assert.deepEqual(bound.structureBinding,copy(f.ctx.base.structureBinding));
  assert.equal(bound.frozenTables.tables.length,1);assert.match(bound.frozenTables.tables[0].html,/rowspan="2"/);
  assert.equal(Contract.outputSlots(bound).reduce((n,s)=>n+s.target,0),1200);
  const backend=Contract.structuredPrompt(bound);assert.match(sent.system,/本次收敛正文参考目标1200字/);assert.match(backend,/"target":1200,"topics"/);
  assert.doesNotMatch(backend,/evidence最多选直接支撑判断的两至三项决定性事实/);
  assert.doesNotMatch(sent.system+backend,/正文目标3000字|target是用户已确认|接近已确认目标完成详实分析/);
  const unbound={...bound};delete unbound.initialLengthConvergence;
  assert.deepEqual(Contract.outputSlots(bound).map(s=>s.hardMax),Contract.outputSlots(unbound).map(s=>s.hardMax));
  const {reportSectionOutputBudget}=await import('../functions/api/reportexecution.js');
  assert.deepEqual(reportSectionOutputBudget(bound),reportSectionOutputBudget(unbound));assert.ok(reportSectionOutputBudget(bound).maxTokens>4000);
  assert.notEqual(Contract.fingerprint(bound),Contract.fingerprint(unbound));assert.equal(JSON.stringify(f.ctx.base),before);
  assert.equal(f.ctx.s.content,original);assert.equal(f.ctx.s.pendingRevision,null);assert.equal(f.ctx.receipts.length,1);assert.ok(f.ctx.assertions>=5);
});
test('正常首稿仍沿用原计划，不获得收敛许可或短字数目标',async()=>{
  const f=fixture();await f.normal();const sent=copy(f.ctx.calls[0]);
  assert.equal(sent.qualityContract.initialLengthConvergence,undefined);assert.match(sent.system,/正文目标3000字/);
  assert.equal(sent.initialLengthSource,undefined);
  assert.equal(Contract.outputSlots(sent.qualityContract).reduce((n,s)=>n+s.target,0),3000);
});
test('收敛原文在异步准备或返回时变化，拒绝发出或接收结果',async t=>{
  await t.test('before transport',async()=>{const f=fixture();f.ctx.sourceCheckHook=()=>{if(f.ctx.assertions===4)f.ctx.expectedSource='已更改';};await assert.rejects(f.run(),/原文或许可已变化/);assert.equal(f.ctx.calls.length,0);assert.equal(f.ctx.receipts.length,0);});
  await t.test('after transport',async()=>{const f=fixture();f.ctx.transportHook=()=>f.ctx.expectedSource='已更改';await assert.rejects(f.run(),/原文或许可已变化/);assert.equal(f.ctx.calls.length,1);assert.equal(f.ctx.receipts.length,0);assert.equal(f.ctx.s.content,original);});
});
test('空许可、跨节/跨计划、伪造字数或排版证明均拒绝',async()=>{
  const f=fixture();await f.run();const bound=copy(f.ctx.calls[0].qualityContract);
  const budget=bound.initialLengthConvergence.referenceBudget;
  for(const change of [{permitId:''},{sectionKey:'别章 / 别节'},{planId:'other-plan'},{sourceHash:'wrong'},{sourceProseCharacters:9999},{referenceBudget:{...budget,target:1700}},{referenceBudget:{...budget,documentSha256:'fake'}},{referenceBudget:{...budget,measuredPages:129}}])assert.throws(()=>Contract.normalize({...bound,initialLengthConvergence:{...bound.initialLengthConvergence,...change}}));
  const other=fixture();other.ctx.options.referenceBudget.actual=4500;other.ctx.expectedPermit.referenceBudget.actual=4500;await assert.rejects(other.run(),/完整原文字数不符/);assert.equal(other.ctx.calls.length,0);
});
test('接收端从完整原文自算哈希与字数，不信一致伪造的metadata数字',async()=>{
  const f=fixture();await f.run();const bound=copy(f.ctx.calls[0].qualityContract);
  assert.deepEqual(await Contract.verifyInitialLengthConvergence(bound,original),Contract.normalize(bound));
  for(const source of [undefined,'',original+'改',original.replace('75元','76元')])await assert.rejects(Contract.verifyInitialLengthConvergence(bound,source),/完整原文.*不一致/);
  const forged=copy(bound);forged.initialLengthConvergence.sourceProseCharacters=9000;forged.initialLengthConvergence.referenceBudget.actual=9000;
  assert.ok(Contract.normalize(forged));await assert.rejects(Contract.verifyInitialLengthConvergence(forged,original),/完整原文.*不一致/);
  assert.deepEqual(await Contract.verifyInitialLengthConvergence(copy(f.ctx.base)),Contract.normalize(copy(f.ctx.base)));
});
test('真实LG6.3形状：原1598/2078，原文4302，实排137页，收敛2900不改确认计划或压低传输量',async()=>{
  const f=fixture({source:sourceOfSize(4302),proseTarget:1598,proseMax:2078,target:2900}),before=JSON.stringify(f.ctx.base);await f.run();
  const bound=copy(f.ctx.calls[0].qualityContract),unbound={...bound};delete unbound.initialLengthConvergence;
  assert.equal(JSON.stringify(f.ctx.base),before);assert.deepEqual(bound.requirements,copy(f.ctx.base.requirements));
  assert.equal(bound.initialLengthConvergence.sourceProseCharacters,4302);assert.equal(bound.initialLengthConvergence.referenceBudget.confirmedProseTotal,84500);
  assert.equal(Contract.outputSlots(bound).reduce((n,s)=>n+s.target,0),2900);assert.equal(Contract.programProseBudget(bound).outputProseMax,4302);
  assert.equal(Contract.outputSlots(bound).reduce((n,s)=>n+s.hardMax,0),2078);
  const {reportSectionOutputBudget}=await import('../functions/api/reportexecution.js');
  assert.equal(reportSectionOutputBudget(bound).maxTokens,4302*2+2048+4*8+100);
  assert.ok(reportSectionOutputBudget(bound).maxTokens>reportSectionOutputBudget(unbound).maxTokens);
  assert.match(Contract.structuredPrompt(bound),/本次收敛正文参考目标2900字/);
  assert.equal(f.ctx.s.content,sourceOfSize(4302));assert.equal(f.ctx.s.pendingRevision,null);
});
test('任意用户JSON不能获取开放许可：逐项身份/预算变化或缺校验模块均不请求',async()=>{
  for(const key of ['permitId','idempotencyKey','batchId','referenceBudget']){
    const f=fixture();if(key==='referenceBudget')f.ctx.options.referenceBudget.target=1300;else f.ctx.options[key]='foreign';
    await assert.rejects(f.run(),/许可绑定已变化/);assert.equal(f.ctx.calls.length,0);
  }
  const f=fixture();delete f.ctx.ReportInitialDeliveryRuntime.assertLengthConvergence;await assert.rejects(f.run(),/入口或指令未就绪/);assert.equal(f.ctx.calls.length,0);
});
test('来源确需超过16384 Token时仍显式拒绝，不截断或缩小输出安全量',async()=>{
  const f=fixture({source:sourceOfSize(9000),proseTarget:1598,proseMax:2078,target:6000});await f.run();
  const {reportSectionOutputBudget}=await import('../functions/api/reportexecution.js');
  assert.throws(()=>reportSectionOutputBudget(copy(f.ctx.calls[0].qualityContract)),/16384 Token 上限/);
});
