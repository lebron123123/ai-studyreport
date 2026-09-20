// Isolated browser. Metrics are measured, never inferred from targetFrameRate.
const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
const duration=Number(process.env.BAOAN_SECONDS||120),label=process.env.BAOAN_LABEL||'baseline';let activeBrowser;
const hashAssets=()=>Object.fromEntries(['project-map/baoan-lod.mjs','project-map/baoan-lod-v2/known.json','project-map/baoan-lod-v2/overview-known.json'].filter(f=>fs.existsSync(f)).map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
(async()=>{
 const assetHashes=hashAssets(),journal=`outputs/baoan-performance-${label}.jsonl`;fs.writeFileSync(journal,JSON.stringify({kind:'start',label,durationSeconds:duration,startedAt:new Date().toISOString(),assetHashes})+'\n');
 const browser=activeBrowser=await chromium.launch({headless:true,channel:'msedge'});const context=await browser.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{let C;Object.defineProperty(window,'Cesium',{configurable:true,get:()=>C,set:v=>{C=v;const Original=v.Viewer;v.Viewer=class extends Original{constructor(...a){super(...a);window.__baoanViewer=this;}};}});});
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');const browserSession=await browser.newBrowserCDPSession();const hardware=await browserSession.send('SystemInfo.getInfo');
 const started=Date.now();await page.goto(process.env.BAOAN_URL||'http://127.0.0.1:8080/project-map/baoan.html?benchmark=1');await page.waitForFunction(()=>document.body.dataset.ready==='true',null,{timeout:120000});
 const firstReadyMs=Date.now()-started;
 if(process.env.BAOAN_ESTIMATE==='1'){await page.locator('#estimate').check();await page.waitForFunction(()=>!document.querySelector('#estimate').disabled);}
 if(process.env.BAOAN_FAR==='1')await page.evaluate(()=>__baoanViewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(113.88,22.65,25000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}}));
 if(process.env.BAOAN_OVERVIEW==='1')try{await page.waitForFunction(()=>document.body.dataset.overview==='true'&&__baoanTilesets.filter(t=>t.show).every(t=>t.tilesLoaded),null,{timeout:120000});}catch(e){console.log('LOAD_DIAGNOSTIC',await page.evaluate(()=>({status:document.querySelector('#status').textContent,overview:document.body.dataset.overview,tiles:__baoanTilesets.map(t=>({show:t.show,loaded:t.tilesLoaded,bytes:t.totalMemoryUsageInBytes}))})));throw e;}
 await page.waitForTimeout(10000);
 const sceneReadyMs=Date.now()-started;
 if(process.env.BAOAN_OVERVIEW==='1')await page.screenshot({path:`outputs/baoan-${label}.png`});
 await page.evaluate(()=>{const v=__baoanViewer;window.__perf={frames:0,times:[],last:0,moving:false,base:v.camera.position.clone(),heading:v.camera.heading,pitch:v.camera.pitch};v.scene.postRender.addEventListener(()=>{const p=__perf,t=performance.now();p.frames++;if(p.last)p.times.push(t-p.last);p.last=t;});function animate(t){const p=__perf;if(p.moving){v.camera.setView({destination:p.base,orientation:{heading:p.heading+Math.sin(t/3000)*.08,pitch:p.pitch+Math.sin(t/5000)*.04,roll:0}});v.scene.requestRender();}requestAnimationFrame(animate);}requestAnimationFrame(animate);});
 const samples=[];let lastFrames=0,lastArea=-1;const start=Date.now();let tick=0;
 while(Date.now()-start<duration*1000){
  const mode=Math.floor((Date.now()-start)/30000)%2?'idle':'move';
  const areaStep=Math.floor((Date.now()-start)/60000);
  if(process.env.BAOAN_MIXED==='1'&&areaStep!==lastArea){lastArea=areaStep;await page.evaluate(({step,altitudeMix})=>{const select=document.getElementById('area');select.selectedIndex=(step*17)%select.options.length;select.dispatchEvent(new Event('change'));const v=__baoanViewer;if(altitudeMix&&step%3===2)v.camera.setView({destination:Cesium.Cartesian3.fromDegrees(113.88,22.65,25000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});__perf.base=v.camera.position.clone();__perf.heading=v.camera.heading;__perf.pitch=v.camera.pitch;},{step:areaStep,altitudeMix:process.env.BAOAN_ALTITUDE_MIX==='1'});}
  await page.evaluate(m=>{__perf.moving=m==='move';},mode);
  await page.waitForTimeout(250);
  if(++tick%20!==0)continue;
  const sample=await page.evaluate(()=>{const v=__baoanViewer,p=__perf;const times=p.times.splice(0);return {frames:p.frames,times,entities:v.entities.values.length,primitives:v.scene.primitives.length,altitude:v.camera.positionCartographic.height,overview:document.body.dataset.overview,tilesBytes:window.__baoanTilesets?.reduce((n,t)=>n+t.totalMemoryUsageInBytes,0)||0};});
  const metrics=(await cdp.send('Performance.getMetrics')).metrics;sample.heapBytes=metrics.find(x=>x.name==='JSHeapUsedSize')?.value;sample.elapsed=(Date.now()-start)/1000;sample.mode=mode;sample.windowFrames=sample.frames-lastFrames;lastFrames=sample.frames;
  if(samples.length%6===0){const processes=await browserSession.send('SystemInfo.getProcessInfo');const ids=processes.processInfo.map(p=>Number(p.id)).filter(Number.isInteger);sample.processCpuSeconds=processes.processInfo.reduce((n,p)=>n+p.cpuTime,0);try{sample.browserWorkingSetBytes=Number(cp.execFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`],{encoding:'utf8',windowsHide:true}).trim());}catch(e){sample.browserWorkingSetBytes=null;sample.memoryError=e.message.slice(0,100);}}
  samples.push(sample);fs.appendFileSync(journal,JSON.stringify(sample)+'\n');if(sample.browserWorkingSetBytes!==undefined)console.log(JSON.stringify({elapsed:Math.round(sample.elapsed),mode,heapMiB:(sample.heapBytes/1048576).toFixed(1),browserMiB:sample.browserWorkingSetBytes?Math.round(sample.browserWorkingSetBytes/1048576):null,memoryError:sample.memoryError,tilesMiB:Math.round(sample.tilesBytes/1048576)}));
 }
 if(JSON.stringify(assetHashes)!==JSON.stringify(hashAssets()))throw Error('Map assets changed during measurement; results are not a single-version acceptance');
 const result={label,durationSeconds:duration,firstReadyMs,sceneReadyMs,assetHashes,profile:{mixed:process.env.BAOAN_MIXED==='1',altitudeMix:process.env.BAOAN_ALTITUDE_MIX==='1',estimated:process.env.BAOAN_ESTIMATE==='1',far:process.env.BAOAN_FAR==='1'},hardware:hardware.gpu,errors,samples};fs.writeFileSync(`outputs/baoan-performance-${label}.json`,JSON.stringify(result,null,2));
 console.log('RESULT '+JSON.stringify({label,firstReadyMs,samples:samples.length,errors}));await browser.close();
})().catch(async e=>{console.error(e);await activeBrowser?.close();process.exitCode=1;});
