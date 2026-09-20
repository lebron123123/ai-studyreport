const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({headless:true,channel:'msedge'}),p=await b.newPage(),errors=[],whole=[];
p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/\/city\/(buildings|roads)\.glb/.test(r.url()))whole.push(r.url());});
try{await p.goto('http://127.0.0.1:8080/project-map/index.html');await p.locator('#baoan-enter').click();
await p.waitForFunction(()=>document.querySelector('#map').dataset.details==='ready',null,{timeout:180000});
await p.locator('#landmark-query').fill('腾讯');await p.locator('[data-landmark]').first().click();
await p.waitForFunction(()=>BABYLON.Engine.Instances[0].scenes[0].metadata.originalFine>0,null,{timeout:120000});
await p.evaluate(()=>{const s=BABYLON.Engine.Instances[0].scenes[0];window.testFine=s.meshes.filter(m=>m.metadata?.lod==='fine');});
await p.getByLabel('片区全貌').selectOption('original');await p.waitForFunction(()=>BABYLON.Engine.Instances[0].scenes[0].metadata.originalFine===0);
assert.ok(await p.evaluate(()=>window.testFine.length>0&&window.testFine.every(m=>m.isDisposed())));
await p.waitForFunction(()=>{const m=BABYLON.Engine.Instances[0].scenes[0].metadata;return m.originalCoarse===m.originalBlocks;},null,{timeout:180000});
for(let i=0;i<5;i++){await p.getByLabel('片区全貌').selectOption('baoan');await p.waitForFunction(()=>BABYLON.Engine.Instances[0].scenes[0].metadata.baoanLoaded===0);assert.ok(await p.evaluate(()=>BABYLON.Engine.Instances[0].scenes[0].metadata.baoanOverview));await p.locator('#baoan-enter').click();await p.waitForFunction(()=>BABYLON.Engine.Instances[0].scenes[0].metadata.baoanLoaded>0,null,{timeout:30000});}
console.log('PASS: fine meshes disposed, all 159 coarse blocks loaded, 5 Baoan overview/close cycles, no full original GLB requests');
await p.locator('#city').click();assert.equal(await p.evaluate(()=>BABYLON.Engine.Instances.length),0);assert.deepEqual(errors,[]);assert.deepEqual(whole,[]);
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
