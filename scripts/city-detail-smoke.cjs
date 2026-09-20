const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve('project-map');const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/^\/project-map/,''));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(p)]||'application/octet-stream');fs.createReadStream(p).on('error',()=>res.destroy()).pipe(res);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],requests=[];
 // Isolate gestures from third-party tile availability; uses the real MapLibre engine.
 await page.route('https://tiles.openfreemap.org/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(route.request().url().includes('/styles/')?{version:8,sources:{},layers:[]}:{tilejson:'3.0.0',tiles:[],vector_layers:[]})}));
 await page.addInitScript(()=>{let lib;Object.defineProperty(window,'maplibregl',{configurable:true,get:()=>lib,set:value=>{lib=value;const Original=value.Map;value.Map=class extends Original{constructor(...args){super(...args);window.testMap=this;}};}});});
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});page.on('request',r=>{requests.push(r.url());if(/buildings.glb|landmark-detail.glb|\.hdr/.test(r.url()))console.log('LOAD',r.url());});
 try{await page.goto(`http://127.0.0.1:${server.address().port}/project-map/index.html`);await page.locator('[data-landmark]').first().waitFor();assert.equal(requests.filter(x=>/\.glb|\.hdr|babylon/.test(x)).length,0);
 await page.waitForFunction(()=>window.testMap?.loaded());
 for(let i=0;i<5;i++){
  const before=await page.evaluate(()=>testMap.getCenter().toArray());
  await page.mouse.move(900,500);await page.mouse.down();await page.mouse.move(1100,550,{steps:12});await page.mouse.up();await page.waitForTimeout(400);
  const after=await page.evaluate(()=>testMap.getCenter().toArray());assert.notDeepEqual(after,before);
 }
 await page.evaluate(()=>testMap.jumpTo({center:[113.5,22.4],zoom:16}));await page.mouse.click(1000,600);
 await page.locator('#nearby').click();assert.equal(await page.locator('#city').getAttribute('aria-pressed'),'true');assert.match(await page.locator('#status').textContent(),/不会跳转/);
 await page.evaluate(()=>testMap.jumpTo({center:[114.025,22.536],zoom:16}));await page.mouse.click(1000,600);
 const picked=await page.evaluate(()=>testMap.unproject([1000-testMap.getContainer().getBoundingClientRect().left,600-testMap.getContainer().getBoundingClientRect().top]).toArray());
 await page.getByRole('button',{name:'查看此处三维',exact:true}).click();
 await page.waitForFunction(()=>!!window.BABYLON?.Engine.Instances.length);
 await page.locator('#city').click();await page.waitForFunction(()=>window.testMap?.loaded());
 const returned=await page.evaluate(()=>testMap.getCenter().toArray());assert.ok(Math.abs(returned[0]-picked[0])<1e-6&&Math.abs(returned[1]-picked[1])<1e-6);
 console.log('PASS five real 2D drags; selected-point 3D round trip; out-of-coverage guard');
 await page.locator('[data-landmark]').filter({hasText:'腾讯'}).first().click();console.log('CLICKED');
 await page.waitForTimeout(5000);console.log('EARLY STATUS',await page.locator('#status').textContent());
 try{await page.waitForFunction(()=>document.querySelector('#map').dataset.details==='ready',null,{timeout:180000});}catch(e){console.log('STATUS',await page.locator('#status').textContent());await page.screenshot({path:'outputs/city-load-failure.png'});throw e;}
 await page.waitForTimeout(3000);await page.screenshot({path:'outputs/city-original-tencent.png'});
 assert.ok(await page.locator('.map-place-labels button').count()>0);
 for(let i=0;i<5;i++){await page.getByRole('button',{name:'地名标注：开',exact:true}).click();assert.equal(await page.locator('.map-place-labels').isVisible(),false);await page.getByRole('button',{name:'地名标注：关',exact:true}).click();}
 console.log('PASS original city labels and five visibility cycles');
 const canvas=page.locator('#map canvas');await canvas.focus();const position=()=>page.evaluate(()=>BABYLON.Engine.Instances[0].scenes[0].activeCamera.position.asArray());const before=await position();await page.keyboard.down('KeyW');await page.waitForTimeout(500);await page.keyboard.up('KeyW');assert.notDeepEqual(await position(),before);
 for(const speed of [1,5,10,20,40]){await page.locator('#speed').selectOption(String(speed));assert.equal(await page.locator('#speed').inputValue(),String(speed));await page.locator('#ground').click();await page.locator('#aerial').click();await canvas.focus();await page.keyboard.down('KeyW');await page.waitForTimeout(100);await page.keyboard.up('KeyW');await page.keyboard.press('ArrowRight');}await page.locator('#speed').selectOption('1');await page.locator('#aerial').click();
 for(let i=0;i<5;i++){
  const start=await position();await page.locator('#rise').click();await page.waitForTimeout(100);assert.ok((await position())[1]>start[1]);
  await page.locator('#descend').click();await page.locator('#look-up').click();await page.locator('#look-down').click();
  await canvas.hover();await page.mouse.wheel(0,100000);await page.waitForTimeout(100);const far=await position();await page.mouse.wheel(0,-120);await page.waitForTimeout(100);assert.notDeepEqual(await position(),far);
  await page.locator('#reset').click();
 }
 await page.locator('#day').click();await page.waitForTimeout(2000);await page.screenshot({path:'outputs/city-original-day.png'});
 await page.waitForTimeout(2000);
 await page.evaluate(()=>{window.cityIdleFrames=0;BABYLON.Engine.Instances[0].scenes[0].onAfterRenderObservable.add(()=>window.cityIdleFrames++);});
 await page.waitForTimeout(5000);
 const idleFrames=await page.evaluate(()=>window.cityIdleFrames);assert.ok(idleFrames<=7,`idle rendered ${idleFrames} frames in 5 seconds`);
 assert.deepEqual(errors,[]);console.log('PASS',JSON.stringify(await page.evaluate(()=>({meshes:BABYLON.Engine.Instances[0].scenes[0].meshes.length,idleFramesIn5Seconds:window.cityIdleFrames}))));
 const box=await canvas.boundingBox(),cx=box.x+box.width*.5,cy=box.y+box.height*.65;
 for(let i=0;i<5;i++){await page.mouse.click(cx,cy);await page.locator('#back-point').waitFor({state:'visible'});}
 await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+60,cy,{steps:6});await page.mouse.up();assert.equal(await page.locator('#back-point').isVisible(),false);
 await page.waitForTimeout(1200);await page.mouse.click(cx,cy);await page.locator('#back-point').waitFor({state:'visible'});
 const expectedPoint=await page.evaluate(async()=>{const c=await(await fetch('models/catalog.json')).json();const s=BABYLON.Engine.Instances[0].scenes[0];const r=document.querySelector('#map canvas').getBoundingClientRect();const h=s.pick(r.width*.5,r.height*.65,m=>m.name!=='atmosphere'&&m.isEnabled()&&m.isVisible&&m.getTotalVertices()>0).pickedPoint;return [c.origin[0]+h.x/c.scale/(111320*Math.cos(c.origin[1]*Math.PI/180)),c.origin[1]+h.z/c.scale/111320];});
 await page.locator('#back-point').click();await page.locator('.maplibregl-canvas').waitFor();await page.waitForFunction(()=>window.testMap?.loaded());const actualPoint=await page.evaluate(()=>testMap.getCenter().toArray());assert.ok(Math.abs(actualPoint[0]-expectedPoint[0])<1e-6&&Math.abs(actualPoint[1]-expectedPoint[1])<1e-6,JSON.stringify({actualPoint,expectedPoint}));
 assert.equal(await page.evaluate(()=>BABYLON.Engine.Instances.length),0);console.log('PASS 5 geometry picks, drag cancellation, exact picked location returned to 2D; resource disposal');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
