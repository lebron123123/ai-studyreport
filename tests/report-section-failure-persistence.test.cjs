'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const WF=require('../project-workflow.js');
const report=fs.readFileSync(require.resolve('../report.js'),'utf8');
const air=fs.readFileSync(require.resolve('../aireport.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const failure={code:'request-timeout',message:'[系统测试]上游请求超时',at:'2026-10-12T10:00:00.000Z'};
const candidateFailure={sectionKey:'运营方案 / 合作安排',code:'provider-credit',message:'[系统测试]额度不足',createdAt:'2026-10-12T10:01:00.000Z'};
function section(title){return {t:title,numeric:false,content:'原始正文：'+title,editedHtml:'<p>人工正文：'+title+'</p>',locked:false,syncStatus:'stale',staleKind:'logic',staleKeys:['report_logic'],staleReason:'规则更新',
  pendingRevision:{id:'candidate-'+title,before:'原始正文：'+title,after:'完整待审稿：'+title,completionContract:{planId:'candidate-plan',requirements:{proseTarget:100}},quality:{status:'blocked',factsVerified:false}},
  executionTask:{taskId:'task-'+title,runId:'run-1',status:'completed',context:{hash:'context-1'}},completionContract:{planId:'accepted-plan',requirements:{proseTarget:80}},completionQuality:{status:'unverified',factsVerified:false},
  undoStack:[{content:'更早的正文'}],prov:{snapshotId:'financial-1'},logicSnapshot:{version:7,rules:[{id:'rule-1'}]},outputPolicyVersion:'policy-1',generationFailure:{...failure},candidateGenerationFailure:{...candidateFailure}};}
function fixture(){return [{cn:'一',name:'运营方案',checked:true,sections:[section('合作安排'),section('运营安排')]}];}
const unchangedFields=['t','numeric','content','editedHtml','locked','pendingRevision','executionTask','completionContract','completionQuality','undoStack','prov','logicSnapshot','outputPolicyVersion'];
function bodyIdentity(s){return Object.fromEntries(unchangedFields.map(key=>[key,s[key]]));}
function runtime(initial=fixture()){
  const ctx={window:{ProjectWorkflow:WF},ProjectWorkflow:WF,chapters:initial,project:{name:'[系统测试]失败持久化'},projectWorkflow:WF.ensureState({}),domainKey:'baozhang_gaibao',
    appMode:'aireport',aiReportExtracted:{},reportDocumentRevision:0,STEPS:[0],currentStep:0,signed:false,docNo:null,calcParams:null,kbEntries:[],
    loadDomain(){ctx.chapters=[{cn:'一',name:'运营方案',checked:true,sections:[{t:'合作安排',content:''},{t:'运营安排',content:''}]}];},
    renderTOC(){},renderSheet(){},reportDraftMergeOptions(){return {};},scheduleCloudSave(){},
    localStorage:{setItem(_key,value){ctx.saved=value;}},DRAFT_KEY:'[系统测试]failure-persistence',reportDraftStoreKey(){return '[系统测试]failure-persistence';},
    reportLocalPersistedRevision:-1,reportCloudPersistedRevision:-1,reportLocalSavePending:Promise.resolve(false),reportLocalSaveQueue:Promise.resolve()};
  vm.createContext(ctx);vm.runInContext(report.slice(report.indexOf('function buildDraftData('),report.indexOf('function draftBarHtml(')),ctx);return ctx;
}

test('共享错误归一化仅保留有界字符串和对应时间字段，返回独立对象',()=>{
  const original={...failure,raw:{secret:'不得保存'},stack:'不得保存',sectionKey:'不属于初稿错误',createdAt:'不属于初稿错误'};
  const saved=WF.persistentSectionFailure(original);
  assert.deepEqual(saved,failure);assert.notEqual(saved,original);saved.message='修改副本';assert.equal(original.message,failure.message);
  assert.deepEqual(WF.persistentSectionFailure({...candidateFailure,at:'不得保存',raw:'不得保存'},'candidate'),candidateFailure);
  const oversized={code:'c'.repeat(200),message:'m'.repeat(5000),sectionKey:'k'.repeat(2000),createdAt:'t'.repeat(100)};
  const bounded=WF.persistentSectionFailure(oversized,'candidate');
  assert.equal(bounded.code.length,128);assert.equal(bounded.message.length,4096);assert.equal(bounded.sectionKey.length,1024);assert.equal(bounded.createdAt.length,64);
  assert.deepEqual(WF.persistentSectionFailure({message:'历史简略错误',code:42,at:{value:'不是字符串'}}),{message:'历史简略错误'});
  assert.deepEqual(WF.persistentSectionFailure(vm.runInNewContext('({code:"cross-realm",message:"跨上下文错误",at:"2026-10-12"})')),{code:'cross-realm',message:'跨上下文错误',at:'2026-10-12'});
});

test('Error、非普通对象、继承字段、访问器和循环raw不会进入持久错误',()=>{
  for(const value of [null,undefined,'错误',42,[],new Error('不得保存'),vm.runInNewContext('new Error("不得保存")'),new Date(),new (class Failure{constructor(){this.message='不得保存';}})()])assert.equal(WF.persistentSectionFailure(value),null);
  let reads=0;const raw={};raw.self=raw;
  const original={message:'安全错误',raw,stack:'不得保存',toJSON(){throw Error('不能调用toJSON');}};
  Object.defineProperty(original,'code',{enumerable:true,get(){reads++;throw Error('不能读取访问器');}});
  Object.defineProperty(original,'at',{enumerable:true,get(){reads++;throw Error('不能读取访问器');}});
  assert.deepEqual(WF.persistentSectionFailure(original),{message:'安全错误'});assert.equal(reads,0);
  assert.equal(WF.persistentSectionFailure(Object.create({message:'继承错误'})),null);
  assert.equal(WF.persistentSectionFailure({message:'',code:false}),null);
});

test('真实build→JSON→restore/save三轮保留两类错误及正文、候选、任务和合同',async()=>{
  const original=fixture(),expected=clone(original),ctx=runtime(original);
  let draft=JSON.parse(JSON.stringify(ctx.buildDraftData()));
  for(let round=0;round<3;round++){
    ctx.restoreDraft(draft,{deferRender:true,openHome:round===1});
    const template=[{cn:'一',name:'运营方案',checked:true,sections:[{t:'运营安排',numeric:false},{t:'合作安排',numeric:false}]}];
    ctx.chapters=WF.mergeReportDraft(template,ctx.chapters);
    assert.equal(await ctx.saveDraft(),true);draft=JSON.parse(ctx.saved);
    for(const s of draft.chapters[0].sections){
      const before=expected[0].sections.find(item=>item.t===s.t);
      assert.deepEqual(s.generationFailure,failure);assert.deepEqual(s.candidateGenerationFailure,candidateFailure);
      assert.deepEqual(bodyIdentity(s),bodyIdentity(before));
    }
  }
  assert.deepEqual(original,expected,'原输入不能被保存或恢复修改');
});

test('同名章节和小节换序保留错误且不共享任何可变对象',()=>{
  const saved=fixture();saved.push({cn:'二',name:'财务方案',sections:[section('财务评价')]});
  const before=clone(saved),template=[{cn:'一',name:'财务方案',sections:[{t:'财务评价',numeric:false}]},{cn:'二',name:'运营方案',sections:[{t:'运营安排',numeric:false},{t:'合作安排',numeric:false}]}];
  const merged=WF.mergeReportDraft(template,saved);
  for(const c of merged)for(const s of c.sections){
    const prior=saved.find(item=>item.name===c.name).sections.find(item=>item.t===s.t);
    assert.deepEqual(s.generationFailure,prior.generationFailure);assert.deepEqual(s.candidateGenerationFailure,prior.candidateGenerationFailure);
    assert.deepEqual(bodyIdentity(s),bodyIdentity(prior));
    assert.notEqual(s.generationFailure,prior.generationFailure);assert.notEqual(s.candidateGenerationFailure,prior.candidateGenerationFailure);
    s.generationFailure.message='副本修改';s.candidateGenerationFailure.message='副本修改';s.executionTask.context.hash='副本修改';s.pendingRevision.after='副本修改';
  }
  assert.deepEqual(saved,before);
});

test('章节或小节改名迁移清除旧错误和旧任务，但保留完整正文及候选合同',()=>{
  for(const renameChapter of [false,true]){
    const saved=fixture(),before=clone(saved),prior=saved[0].sections[0],name=renameChapter?'新运营方案':'运营方案',title=renameChapter?'合作安排':'新合作安排';
    const template=[{cn:'一',name,sections:[{t:title,numeric:false,executionTask:{taskId:'模板旧任务'},generationFailure:{...failure},candidateGenerationFailure:{...candidateFailure}}]}];
    const merged=WF.mergeReportDraft(template,saved,{chapterAliases:{[name]:['运营方案']},sectionAliases:{[name+'|'+title]:[{chapter:'运营方案',title:'合作安排'}]}}),s=merged[0].sections[0];
    for(const field of ['generationFailure','candidateGenerationFailure','executionTask'])assert.equal(Object.hasOwn(s,field),false,field);
    for(const field of unchangedFields.filter(key=>!['t','executionTask'].includes(key)))assert.deepEqual(s[field],prior[field],field);
    assert.equal(s.structureMigrated,true);assert.equal(s.syncStatus,'stale');assert.deepEqual(saved,before);
  }
});

test('build和merge均丢弃恶意raw/stack与错误对象，不触发序列化或访问器',async()=>{
  const rows=fixture(),raw={};raw.self=raw;let reads=0;
  for(const s of rows[0].sections){
    s.generationFailure={...failure,raw,stack:'secret',toJSON(){throw Error('不应序列化原错误');}};
    s.candidateGenerationFailure={...candidateFailure,raw,stack:'secret'};
    Object.defineProperty(s.generationFailure,'createdAt',{enumerable:true,get(){reads++;throw Error('不应读取额外字段');}});
  }
  rows[0].sections[1].candidateGenerationFailure=new Error('不要存Error');
  const ctx=runtime(rows);assert.equal(await ctx.saveDraft(),true);
  const draft=JSON.parse(ctx.saved);assert.equal(reads,0);
  assert.deepEqual(draft.chapters[0].sections[0].generationFailure,failure);assert.deepEqual(draft.chapters[0].sections[0].candidateGenerationFailure,candidateFailure);
  assert.equal(draft.chapters[0].sections[1].candidateGenerationFailure,null);
  const merged=WF.mergeReportDraft([{cn:'一',name:'运营方案',sections:[{t:'合作安排'},{t:'运营安排'}]}],rows);
  assert.doesNotThrow(()=>JSON.stringify(merged));assert.equal(reads,0);
  assert.deepEqual(merged[0].sections[0].generationFailure,failure);assert.deepEqual(merged[0].sections[0].candidateGenerationFailure,candidateFailure);
  assert.equal(merged[0].sections[1].candidateGenerationFailure,undefined);
  assert.equal(draft.chapters[0].sections[0].pendingRevision.after,rows[0].sections[0].pendingRevision.after);
  assert.equal(draft.chapters[0].sections[0].content,rows[0].sections[0].content);
});

test('没有错误字段的旧稿仍可恢复保存，不制造失败或改变正文任务',async()=>{
  const rows=fixture();for(const s of rows[0].sections){delete s.generationFailure;delete s.candidateGenerationFailure;}
  const before=clone(rows),ctx=runtime();ctx.restoreDraft({domainKey:'baozhang_gaibao',chapters:rows},{deferRender:true});assert.equal(await ctx.saveDraft(),true);
  const draft=JSON.parse(ctx.saved),merged=WF.mergeReportDraft([{cn:'一',name:'运营方案',sections:[{t:'合作安排',numeric:false},{t:'运营安排',numeric:false}]}],draft.chapters);
  for(const [i,s] of merged[0].sections.entries()){
    assert.equal(s.generationFailure,undefined);assert.equal(s.candidateGenerationFailure,undefined);assert.deepEqual(bodyIdentity(s),bodyIdentity(before[0].sections[i]));
  }
});

test('真实候选重试只清成功当前节错误，锁定或已有候选仍保留错误和邻节',()=>{
  const rows=fixture(),target=rows[0].sections[0],other=rows[0].sections[1],otherBefore=clone(other),ctx={ProjectWorkflow:WF};
  vm.createContext(ctx);vm.runInContext(air.slice(air.indexOf('function airStoreNewCandidate('),air.indexOf('async function airProposeSectionRevision(')),ctx);
  assert.throws(()=>ctx.airStoreNewCandidate({section:target},'新候选','重试'),/已有待审候选/);assert.deepEqual(target.candidateGenerationFailure,candidateFailure);
  target.pendingRevision=null;target.locked=true;assert.throws(()=>ctx.airStoreNewCandidate({section:target},'新候选','重试'),/已锁定/);assert.deepEqual(target.candidateGenerationFailure,candidateFailure);
  target.locked=false;assert.ok(ctx.airStoreNewCandidate({section:target},'新候选','重试'));
  assert.equal(target.candidateGenerationFailure,undefined);assert.deepEqual(target.generationFailure,failure);assert.deepEqual(other,otherBefore);
  assert.equal(target.content,'原始正文：合作安排');assert.equal(target.editedHtml,'<p>人工正文：合作安排</p>');
});
