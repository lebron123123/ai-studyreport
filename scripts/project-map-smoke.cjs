const {chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
 const root=path.resolve('project-map');
 const server=http.createServer((req,res)=>{
 if(req.url==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<button id="open" onclick="openProjectCityMap()">打开地图</button><script>window.project={name:"[系统测试]深圳项目",poiLoc:"114.0559,22.5385"};window.authHeaders=()=>({});</script><script src="/poi.js"></script>');return;}
 if(req.url==='/poi.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync('poi.js'));return;}
 if(req.url==='/api/poi'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,candidates:[{name:'[系统测试]位置',location:'114.0559,22.5385',address:'深圳'}]}));return;}
 const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/project-map/,''));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary'};res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const page=await browser.newPage({viewport:{width:1400,height:900}});const errors=[];const requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/project-map/index.html');
 await page.waitForTimeout(15000);
 console.log('map',await page.locator('#status').textContent());
 console.log('initial3DRequests',requests.filter(x=>/babylon|\.glb/.test(x)).length);
 assert.equal(requests.filter(x=>/babylon|\.glb/.test(x)).length,0);
 await page.screenshot({path:'outputs/project-map-city.png'});
 await page.locator('#landmarks button').first().waitFor();
 const n=await page.locator('#landmarks button').filter({hasText:'三维模型'}).count();console.log('models',n);
 assert.equal(n,10);
 await page.locator('#landmarks button').first().click();
 await page.waitForFunction(()=>document.querySelector('#map').dataset.details==='ready',null,{timeout:60000});
 console.log('model',await page.locator('#status').textContent());
 await page.waitForTimeout(2000);
 console.log('scene',await page.evaluate(()=>({engines:BABYLON.Engine.Instances.length,meshes:BABYLON.Engine.Instances[0]?.scenes[0]?.meshes.length})));
 await page.screenshot({path:'outputs/project-map-model.png'});
 for(let i=1;i<n;i++){
  await page.locator('#landmarks button').filter({hasText:'三维模型'}).nth(i).click();
  await page.waitForTimeout(1000);
 }
 await page.screenshot({path:'outputs/project-map-detail.png'});
 for(let i=0;i<5;i++){await page.locator('#tour').click();assert.equal(await page.locator('#tour').getAttribute('aria-pressed'),'true');await page.locator('#tour').click();await page.locator('#city').click();await page.locator('#nearby').click();await page.waitForFunction(()=>document.querySelector('#map').dataset.details==='ready');}
 await page.locator('#landmark-query').fill('不存在的位置');assert.equal(await page.locator('#landmarks button').count(),0);await page.locator('#landmark-query').fill('市民中心');await page.locator('#landmarks button').click();await page.waitForTimeout(2000);await page.screenshot({path:'outputs/project-map-unified-civic.png'});
 await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');
 for(let i=0;i<5;i++){
  await page.locator('#open').click();const frame=page.frameLocator('iframe');
  await frame.locator('#project-name').filter({hasText:'系统测试'}).waitFor();
  await frame.locator('#query').fill('深圳测试');await frame.locator('#search').click();
  await frame.locator('#results button').click();
  if(i===0){await page.waitForTimeout(12000);await page.screenshot({path:'outputs/project-map-nearby.png'});}
  await frame.locator('#close').click();await page.locator('dialog').waitFor({state:'detached'});
 }
 console.log('hostOpenSearchCloseCycles',5);
 await page.locator('#open').click();
 let frame=page.frameLocator('iframe');
 await frame.locator('#project-name').filter({hasText:'系统测试'}).waitFor();
 await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});
 await page.reload();await page.locator('#open').click();frame=page.frameLocator('iframe');
 await frame.locator('#landmarks button').first().waitFor();
 await page.route('**/landmarks.glb',route=>route.abort());
 await frame.locator('#landmarks button').first().click();
 await frame.locator('#status').filter({hasText:'精细模型加载失败'}).waitFor({timeout:60000});
 await frame.locator('#close').click();await page.locator('dialog').waitFor({state:'detached'});
 console.log('refreshEscapeFailureRecovery',true);
 console.log('errors',errors);
 if(errors.length)process.exitCode=1;
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
