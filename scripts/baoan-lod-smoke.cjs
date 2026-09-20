const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[],requested=[];const url='http://127.0.0.1:8080/project-map/baoan-lod.html?benchmark=1';
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,200));});page.on('request',r=>requested.push(r.url()));
 try{
 await page.goto(url);await page.waitForFunction(()=>document.body.dataset.ready==='true',null,{timeout:120000});await page.waitForTimeout(5000);
 assert.ok(await page.evaluate(()=>__baoanTilesets[0].totalMemoryUsageInBytes>0));await page.screenshot({path:'outputs/baoan-lod-known.png'});
 for(let i=0;i<5;i++){await page.locator('#estimate').check();await page.waitForFunction(()=>!document.querySelector('#estimate').disabled);await page.locator('#estimate').uncheck();await page.locator('#quality').selectOption(i%2?'32':'8');await page.locator('#reset').click();}
 await page.locator('#estimate').check();await page.waitForFunction(()=>__baoanTilesets?.length===2&&__baoanTilesets.every(t=>t.tilesLoaded),null,{timeout:120000});await page.waitForTimeout(2000);await page.screenshot({path:'outputs/baoan-lod-estimated.png'});
 const near=requested.filter(x=>x.endsWith('-fine.glb')).length;
 let picked=false;
 for(const [x,y] of [[850,500],[1050,500],[650,650],[850,650],[1050,350],[650,350]]){await page.mouse.click(x,y);await page.waitForTimeout(300);await page.waitForFunction(()=>!document.querySelector('#info').textContent.includes('正在核对'));if(/OSM|非实测/.test(await page.locator('#info').innerText())){picked=true;break;}}
 assert.ok(picked,'a rendered building must expose its actual height provenance on click');
 for(let i=0;i<5;i++){
 await page.evaluate(()=>{const v=__baoanViewer;v.camera.setView({destination:Cesium.Cartesian3.fromDegrees(113.88,22.65,25000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});});
 try{await page.waitForFunction(()=>document.body.dataset.overview==='true'&&__baoanTilesets.filter(t=>t.show).every(t=>t.tilesLoaded&&t.totalMemoryUsageInBytes>0),null,{timeout:60000});}catch(e){console.log('FAR_DIAGNOSTIC',await page.evaluate(()=>({status:document.querySelector('#status').textContent,overview:document.body.dataset.overview,height:__baoanViewer.camera.positionCartographic.height,tiles:__baoanTilesets.map(t=>({show:t.show,loaded:t.tilesLoaded,bytes:t.totalMemoryUsageInBytes,stats:t.statistics}))})));await page.screenshot({path:'outputs/baoan-far-failure.png'});throw e;}
 assert.equal(await page.evaluate(()=>__baoanTilesets.filter(t=>t.show).length),2,'only the two overview layers are drawn');
 assert.ok(await page.evaluate(()=>{__baoanTilesets[0].show=true;document.body.dataset.overview='false';__baoanTilesets[2].allTilesLoaded.raiseEvent();return document.body.dataset.overview==='true'&&!__baoanTilesets[0].show;}),'tile completion must update visibility without waiting for camera movement');
 await page.locator('#reset').click();await page.waitForFunction(()=>document.body.dataset.overview==='false'&&__baoanTilesets[0].show&&__baoanTilesets[0].tilesLoaded&&__baoanTilesets[0].totalMemoryUsageInBytes>0,null,{timeout:120000});
 console.log('Far/near cycle completed',i+1);
 }
 assert.ok(requested.some(x=>x.endsWith('-coarse.glb')));assert.ok(near>0);
 // Failure boundary via catalog reload. Existing model remains visible.
 await page.route('**/baoan-lod-v2/index.json',r=>r.fulfill({status:503,body:'test failure'}));
 await page.evaluate(()=>document.querySelector('#retry').hidden=false);await page.locator('#retry').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('读取失败'));assert.ok(await page.evaluate(()=>__baoanTilesets[0].totalMemoryUsageInBytes>0));
 await page.unroute('**/baoan-lod-v2/index.json');await page.locator('#retry').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('加载完成'),null,{timeout:120000});
 await page.reload();await page.waitForFunction(()=>document.body.dataset.ready==='true',null,{timeout:120000});
 // A failed high-altitude catalog must leave the ordinary grid layer usable.
 await page.route('**/baoan-lod-v2/overview-known.json',r=>r.fulfill({status:503,body:'test failure'}));
 await page.evaluate(()=>__baoanViewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(113.88,22.65,25000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}}));
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('远景合批读取失败'),null,{timeout:60000});
 assert.ok(await page.evaluate(()=>__baoanTilesets[0].show));
 await page.unroute('**/baoan-lod-v2/overview-known.json');await page.locator('#retry').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('加载完成'),null,{timeout:120000});
 // No-building areas still have offline context and an explicit empty pick.
 await page.evaluate(()=>{const s=document.querySelector('#area'),o=[...s.options].find(o=>o.textContent.includes('底图区域'));if(!o)throw Error('Missing context-only cells');s.value=o.value;s.dispatchEvent(new Event('change'));});
 await page.waitForFunction(()=>__baoanTilesets[0].tilesLoaded&&__baoanTilesets[0].totalMemoryUsageInBytes>0,null,{timeout:120000});
 assert.deepEqual(errors,[]);assert.equal(requested.filter(x=>/^https?:/.test(x)&&!x.startsWith('http://127.0.0.1:8080')).length,0);
 const result={pass:true,errors,nearFineRequests:near,coarseRequests:requested.filter(x=>x.endsWith('-coarse.glb')).length,repeatCount:5,farNearCycles:5};fs.writeFileSync('outputs/baoan-lod-smoke.json',JSON.stringify(result));console.log(result);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
