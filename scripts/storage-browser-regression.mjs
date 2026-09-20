// Isolated browser only: never touches the user's browser profile or project.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:8080/research-state-codec.mjs');
 await page.evaluate(()=>{
  window.getUser=()=> '[系统测试]浏览器存储';window.currentProjectId='test-legacy-storage';
  window.appMode='report';window.currentStep=0;window.calcParams=null;
  window.scheduleCloudSave=()=>{};window.setSaveState=()=>{};
 });
 await page.addScriptTag({url:'http://localhost:8080/aireport.js'});
 const aiRoundtrip=await page.evaluate(async()=>{
  const value={savedAt:Date.now(),chat:[{content:'历史对话'.repeat(5000)}]};
  await airSaveLocalState(value);
  if(JSON.stringify(await airLoadDurableLocalState())!==JSON.stringify(value))throw Error('AI对话本机恢复失败');
  return true;
 });
 await page.addScriptTag({url:'http://localhost:8080/report.js'});
 const result=await page.evaluate(async()=>{
  // Seed an old whole-record database before opening v2; verify compatibility.
  const seed={project:{name:'旧格式测试'},chapters:[{sections:[{content:'完整正文'}]}]};
  await new Promise((resolve,reject)=>{const r=indexedDB.open('ai-studyreport-drafts',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(seed,'legacy');tx.oncomplete=()=>{db.close();resolve();};};});
  if(JSON.stringify(await reportDraftStore('get','legacy'))!==JSON.stringify(seed))throw Error('旧数据读取失败');
  const value={text:'连续正文'.repeat(10000),material:'不改变的资料'.repeat(20000),history:[seed]};
  await reportDraftStore('put','a',value);await reportDraftStore('put','b',value);
  if(JSON.stringify(await reportDraftStore('get','a'))!==JSON.stringify(value))throw Error('完整回读失败');
  const next={...value,text:value.text+'修改'};await reportDraftStore('put','a',next);
  if(JSON.stringify(await reportDraftStore('get','a'))!==JSON.stringify(next))throw Error('修改回读失败');
  await reportDraftStore('delete','a');
  if(JSON.stringify(await reportDraftStore('get','b'))!==JSON.stringify(value))throw Error('误删其他项目');
  const budget=await import('/report-cache-budget.mjs');
  await reportDraftStore('put','budget/project',value);await reportDraftStore('put','other/project',value);
  if(await budget.acknowledgeReportCache('budget/project',next,{budgetBytes:0}))throw Error('不同草稿错误授权回收');
  if(!await reportDraftStore('get','budget/project'))throw Error('误删未同步草稿');
  await budget.acknowledgeReportCache('budget/project',value,{budgetBytes:0});
  if(await reportDraftStore('get','budget/project')||!await reportDraftStore('get','other/project'))throw Error('正式项目缓存预算隔离失败');
  project.name='[系统测试]';chapters=[{name:'总论',sections:[{t:'概述',content:'正文'}]}];
  let snapshots=0;const build=buildDraftData;buildDraftData=()=>{snapshots++;return build();};
  for(let i=0;i<100;i++){chapters[0].sections[0].content='最后输入'+i;saveDraft();}
  if(snapshots!==0)throw Error('输入触发了全量快照');
  await saveDraft(true);
  if(snapshots!==1)throw Error('输入没有合并');
  const restored=await reportDraftStore('get',reportDraftStoreKey());
  if(restored.chapters[0].sections[0].content!=='最后输入99')throw Error('最新输入丢失');
  const oldDraft={...restored,ts:restored.ts-1};
  localStorage.setItem(DRAFT_KEY,JSON.stringify(oldDraft));
  await loadDurableDraft();
  if(localStorage.getItem(DRAFT_KEY)!==null)throw Error('已校验旧草稿仍占用同步缓存');
  if(JSON.stringify(await reportDraftStore('get',reportDraftStoreKey()))!==JSON.stringify(restored))throw Error('迁移覆盖了新草稿');
  const store=await import('/research-local-state.mjs');
  const scope={userId:'test',run:{researchId:'test',runId:'run',epoch:1,version:1}};
  const id=await store.saveLocal(scope,value);await store.acknowledgeLocal(scope,id,2);
  const pending=await store.saveLocal(scope,next);
  await store.compactAcknowledged(scope);
  if(!(await store.loadLocal(scope,pending))||await store.loadLocal({...scope,userId:'other'},pending))throw Error('草稿保护失败');
  await store.compactAcknowledged(scope,{budgetBytes:0});
  if(await store.loadLocal(scope,id)||!(await store.loadLocal(scope,pending)))throw Error('零预算未正确保留未同步草稿');
  const second={...scope,run:{...scope.run,researchId:'second'}},other={...scope,userId:'other'};
  const secondId=await store.saveLocal(second,value);await store.acknowledgeLocal(second,secondId,2);
  const otherId=await store.saveLocal(other,value);await store.acknowledgeLocal(other,otherId,2);
  await store.compactAccountAcknowledged(scope,{budgetBytes:0});
  if(await store.loadLocal(second,secondId)||!await store.loadLocal(scope,pending)||!await store.loadLocal(other,otherId))throw Error('跨研究预算或账户隔离失败');
  return {oldFormat:true,lossless:true,otherProjectPreserved:true,inputs:100,snapshots,identity:scope,id:pending};
 });
 await page.reload();
 assert.ok(await page.evaluate(async({identity,id})=>(await import('/research-local-state.mjs')).loadLocal(identity,id),result));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({...result,identity:undefined,id:undefined,aiRoundtrip,refresh:true,pageErrors:0}));
}finally{await browser.close();}
