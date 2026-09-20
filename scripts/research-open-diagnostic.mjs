// Read-only live report diagnostic; API writes are intercepted in an isolated browser.
import {createRequire} from 'node:module';
import {createD1Shim} from '../local-server/d1-shim.js';
import {readResearch} from '../functions/api/_research-store.js';
const require=createRequire(import.meta.url);
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require('C:/Users/HP/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));}
const db=createD1Shim(process.env.DATABASE_URL);
let fixture;
try{const row=await db.prepare('SELECT id,owner_user_id FROM research_studies WHERE title=?').bind('龙岗布吉盈信大楼').first();fixture={ok:true,...await readResearch(db,row.owner_user_id,row.id)};}finally{await db._close();}
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage();
 page.on('pageerror',e=>console.log('pageerror',e.message));
 await page.addInitScript(()=>localStorage.setItem('fs_token','isolated-diagnostic'));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/api/research')return route.fulfill({json:fixture});
  if(req.method()!=='GET')return route.fulfill({json:{ok:false,error:'只读诊断：未执行写入'}});
  return route.continue();
 });
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 await page.goto('http://localhost:8080/?research='+fixture.study.researchId+'&run='+fixture.run.runId+'#aireport',{waitUntil:'commit'});
 await new Promise(r=>setTimeout(r,5000));
 const {profile}=await cdp.send('Profiler.stop');
 console.log('hot',profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,12).map(n=>({fn:n.callFrame.functionName,file:n.callFrame.url.split('/').pop(),line:n.callFrame.lineNumber+1,hits:n.hitCount})));
 console.log('dom',await page.evaluate(()=>({sheet:document.getElementById('sheet')?.innerText.slice(0,100),panels:document.querySelectorAll('#airDocPane').length})));
}finally{await browser.close();}
