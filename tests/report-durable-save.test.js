const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const WF=require('../project-workflow.js');
function runtime(options={}){
  const disk=options.disk||new Map(),messages=[],el={dataset:{},style:{}};
  const ctx={window:{ProjectWorkflow:WF,addEventListener(){}},ProjectWorkflow:WF,console,Promise,AbortSignal,setTimeout,clearTimeout,
    document:{getElementById:id=>id==='saveState'?el:null},localStorage:{getItem:k=>disk.get(k)||null,setItem(k,v){if(options.quota)throw Error('QuotaExceededError');disk.set(k,v);}},
    appMode:'aireport',currentStep:0,calcParams:null,STEPS:[0],confirm:()=>true,alert:s=>messages.push(s)};
  vm.createContext(ctx);
  for(const f of ['report.js','auth.js','aireport.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+f),'utf8'),ctx,{filename:f});
  ctx.getToken=()=> 'fixture';ctx.getUser=()=> '[系统测试]';ctx.scheduleCloudSave=()=>{};
  ctx.renderTOC=ctx.renderSheet=ctx.airSaveState=ctx.airBuildDocPane=()=>{};
  ctx.currentReportVersionMeta=reason=>({reason});
  ctx.reportDraftStore=async(mode,key,val)=>{if(options.idbFail)throw Error('Storage failed');if(mode==='get')return disk.get(key);if(mode==='put')disk.set(key,structuredClone(val));return true;};
  ctx.fetch=async(url,opts)=>{if(options.offline)throw Error('offline');const body=JSON.parse(opts.body);disk.set('server',body.data);return {status:200,json:async()=>({ok:true,updatedAt:Date.now()})};};
  vm.runInContext(`currentProjectId='test-project';project.name='[系统测试]';chapters=[{name:'总论',checked:true,sections:Array.from({length:41},(_,i)=>({t:'小节'+i,content:'旧正文'+i,syncStatus:'current'}))}];
    ProjectWorkflow.createReportVersion(projectWorkflow,chapters,{reason:'旧版本'});
    chapters[0].sections.slice(6).forEach((s,i)=>{s.staleKind='logic';s.syncStatus='stale';ProjectWorkflow.setCandidate(s,'新版正文'+i,'修改',{logicRevision:{rules:[{id:String(i)}]}});});`,ctx);
  return {ctx,disk,messages,el,read:expr=>vm.runInContext(expr,ctx)};
}
test('真实批量接受入口：配额满且服务器离线，35份修改落入大草稿；三次恢复不被旧进度覆盖',async()=>{
  const r=runtime({quota:true,offline:true});
  await Promise.all([r.ctx.airAcceptAllCandidates(),r.ctx.airAcceptAllCandidates()]);
  assert.match(r.messages[0],/本机已保存/);assert.equal(r.read('projectWorkflow.reportVersions.length'),2);
  for(let i=0;i<3;i++){
    const fresh=runtime({disk:r.disk,quota:true,offline:true}),d=await fresh.ctx.loadDurableDraft();fresh.ctx.restoreDraft(d);
    fresh.read(`const recovered=ProjectWorkflow.recoverCompletedReport(chapters,projectWorkflow,{total:41,done:41,reportVersionId:projectWorkflow.reportVersions[0].id});if(recovered.recovered)chapters=recovered.chapters;`);
    assert.equal(fresh.read('chapters[0].sections.filter(s=>s.pendingRevision).length'),0);
    assert.equal(fresh.read('chapters[0].sections[6].content'),'新版正文0');
    assert.equal(fresh.read('projectWorkflow.reportVersions.length'),2);
    await fresh.ctx.saveDraft();
  }
});
test('两个存储都失败，绝不报已保存；页面保留正文和版本，重试不重复接受',async()=>{
  const r=runtime({quota:true,idbFail:true,offline:true});await r.ctx.airAcceptAllCandidates();
  assert.match(r.messages[0],/均未保存成功/);assert.equal(r.el.textContent,'尚未保存成功 · 请勿刷新');
  assert.equal(r.read('reportHasUnsavedChanges()'),true);assert.equal(r.read('chapters[0].sections[6].content'),'新版正文0');
  assert.equal(r.read('projectWorkflow.reportVersions.length'),2);
  r.ctx.fetch=async()=>({status:200,json:async()=>({ok:true,updatedAt:123})});await r.ctx.flushCloudSave();
  assert.equal(r.read('reportHasUnsavedChanges()'),false);assert.match(r.el.textContent,/已保存到项目库/);
});
test('云端队列的快照不可被排队后的版本变动污染',async()=>{
  const r=runtime();const pending=r.ctx.cloudSaveNow();r.read(`projectWorkflow.reportVersions.push({id:'later'});project.name='稍后改名';`);await pending;
  assert.equal(r.disk.get('server').workflow.reportVersions.length,1);assert.equal(r.disk.get('server').project.name,'[系统测试]');
});
test('旧完成进度只能补空白，不能覆盖人工新正文、候选、锁定和删除编辑',()=>{
  const current=[{name:'总论',sections:[{t:'a',content:'新正文'},{t:'b',content:''},{t:'c',content:'',undoStack:[{content:'主动删除'}]}]}];
  const state={reportVersions:[{id:'old',version:1,chapters:[{name:'总论',sections:[{t:'a',content:'旧正文'},{t:'b',content:'补全'},{t:'c',content:'不可复活'}]}]}]};
  const result=WF.recoverCompletedReport(current,state,{done:3,total:3});assert.equal(result.recovered,false);assert.equal(current[0].sections[0].content,'新正文');
});
