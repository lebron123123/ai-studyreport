const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(overrides={}){
  const source=fs.readFileSync('auth.js','utf8'),match=source.match(/preserveDraft:(async\(\)=>\{[\s\S]*?\n    \}),\r?\n    headers:/);
  assert.ok(match,'真实导航保存回调缺失');let saves=0;
  const ctx={currentProjectId:'test',projectCanEdit:()=>true,cloudTimer:null,cloudSaveInFlight:Promise.resolve(true),reportDocumentRevision:1,reportCloudPersistedRevision:1,reportHasUnsavedChanges:()=>false,flushCloudSave:async()=>{saves++;return true;},...overrides};
  vm.createContext(ctx);return {ctx,run:vm.runInContext('('+match[1]+')',ctx),saves:()=>saves};
}
test('阶段浏览不隐式保存；只读角色不触发写入',async()=>{
  const a=fixture();assert.equal(await a.run(),true);assert.equal(a.saves(),0);
  const b=fixture({projectCanEdit:()=>false,cloudTimer:1});assert.equal(await b.run(),true);assert.equal(b.saves(),0);
});
test('本地已存但后台未确认的正文，切页前仍等待后台保存',async()=>{
  const a=fixture({reportDocumentRevision:2});assert.equal(await a.run(),true);assert.equal(a.saves(),1);
  const b=fixture({cloudTimer:1,flushCloudSave:async()=>false});assert.equal(await b.run(),false);
});
test('在途保存完成前不允许切换，失败不伪装为已保存',async()=>{
  let settle;const a=fixture({cloudSaveInFlight:new Promise(resolve=>{settle=resolve;}),reportDocumentRevision:2,reportHasUnsavedChanges:()=>true,flushCloudSave:async()=>false});
  let finished=false;const pending=a.run().then(value=>{finished=true;return value;});await Promise.resolve();assert.equal(finished,false);settle(false);assert.equal(await pending,false);
});
