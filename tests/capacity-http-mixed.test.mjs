// Explicit, expensive lab test; normal regression does not register a skipped test.
// Uses the complete local server, real HTTP/auth/PG/object storage/LibreOffice.
// It is NOT a browser rendering or external AI provider benchmark.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir,cpus,totalmem} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
import {packState} from '../research-state-codec.mjs';
import JSZip from '../local-server/node_modules/jszip/lib/index.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

if(process.env.CAPACITY_HTTP_MIXED==='1')test('独立环境：持续浏览、编辑保存、上传与真实排版HTTP混合负载',{timeout:7200000},async()=>{
 const target=process.env.AGENT_TEST_DATABASE_URL;
 assert.match(new URL(target).pathname,/^\/studyreport_restore_\d+$/,'必须使用测试脚本创建的独立库');
 const count=Number(process.env.CAPACITY_USERS||30),seconds=Number(process.env.CAPACITY_SECONDS||60),thinkMs=Number(process.env.CAPACITY_THINK_MS||5000);
 assert.ok(Number.isInteger(count)&&count>=1&&count<=300);
 assert.ok(seconds>=10&&seconds<=3600&&thinkMs>=1000);
 const root=fileURLToPath(new URL('../',import.meta.url)),folder=await mkdtemp(path.join(tmpdir(),'studyreport-http-capacity-'));
 const DB=createD1Shim(target),secret=crypto.randomUUID(),authEnv={DB,SESSION_SECRET:secret};
 const metrics={},errors=[],users=[],samples=[];let child,log='',sampling,progress,previousCpu=null;
 const port=18765,base='http://127.0.0.1:'+port;
 function record(kind,ms,status,bytes){const m=metrics[kind]||(metrics[kind]={times:[],statuses:{},bytes:0});m.times.push(ms);m.statuses[status]=(m.statuses[status]||0)+1;m.bytes+=bytes;}
 async function request(user,kind,url,body,raw=false){
  const start=performance.now();
  const response=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+user.token,...(body===undefined||raw?{}:{'content-type':'application/json'})},body:body===undefined?undefined:raw?body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  const text=await response.text();record(kind,performance.now()-start,response.status,Buffer.byteLength(text));
  let data;try{data=JSON.parse(text);}catch{data=null;}
  if(!response.ok)throw new Error(kind+' HTTP '+response.status+': '+String(data?.error||text).slice(0,120));
  return data;
 }
 async function save(user){
  const packed=await packState(user.state),missing=[...packed.objects].filter(([key])=>!user.objects.has(key));
  for(let i=0;i<missing.length;i+=8)await request(user,'stage','/api/research',{action:'stageObjects',...user.ids,epoch:1,expectedVersion:user.version,objects:missing.slice(i,i+8)});
  const result=await request(user,'save','/api/research',{action:'save',...user.ids,epoch:1,expectedVersion:user.version,requestId:crypto.randomUUID(),packed:{manifest:packed.manifest,objects:[]}});
  user.version=result.acceptedVersion;missing.forEach(([key])=>user.objects.add(key));
 }
 try{
  // A private process env: no inherited model keys, production .env or documents.
  child=spawn(process.execPath,['local-server/server.js'],{cwd:root,env:{PATH:process.env.PATH,HOME:folder,TMPDIR:folder,SystemRoot:process.env.SystemRoot,DATABASE_URL:target,SESSION_SECRET:secret,RESEARCH_IDENTITY_ENABLED:'1',RESEARCH_STORAGE_V2:'1',PORT:String(port),RAG_OBJECT_ROOT:path.join(folder,'objects'),OPERATIONS_MONITOR_ENABLED:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',v=>{log=(log+v).slice(-12000);});child.stderr.on('data',v=>{log=(log+v).slice(-12000);});
  let ready=false;
  for(let i=0;i<90;i++){if(child.exitCode!==null)throw Error('测试服务退出：'+log);try{const r=await fetch(base+'/api/research?action=list',{signal:AbortSignal.timeout(1000)});await r.arrayBuffer();if(r.status===401){ready=true;break;}}catch{}await sleep(1000);}
  assert.ok(ready,'独立服务未启动：'+log);
  for(let i=0;i<count;i++){
   const name='[系统测试]HTTP混合'+crypto.randomUUID();
   await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','disabled',Date.now()).run();
   const row=await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first();
   const user={id:Number(row.id),token:await signToken(authEnv,Number(row.id),name),version:1,objects:new Set(),state:{draft:{project:{name},chapters:Array.from({length:43},(_,s)=>({cn:String(s),sections:[{t:'测试小节'+s,content:('账号'+i+'小节'+s+'合成正文。').repeat(400)}]}))}}};
   user.ids=await request(user,'setup','/api/research',{action:'create',requestId:crypto.randomUUID(),title:name});await save(user);users.push(user);
  }
  // A genuine small OOXML document, not a mocked page-count response.
  const zip=new JSZip();zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+Array.from({length:80},(_,i)=>'<w:p><w:r><w:t>系统测试 '+i+' 合成报告：验证真实排版与下载前页数核验。</w:t></w:r></w:p>').join('')+'<w:sectPr/></w:body></w:document>');
  const docx=await zip.generateAsync({type:'nodebuffer'});
  const firstExport=await request(users[0],'export-preflight','/api/report-pagination',docx,true);assert.ok(firstExport.pages>0);assert.equal(firstExport.renderer,process.platform==='linux'?'LibreOffice':'WPS');
  Object.keys(metrics).forEach(key=>delete metrics[key]);
  sampling=setInterval(async()=>{try{
   const [status,memory,cpu]=await Promise.all([readFile('/proc/'+child.pid+'/status','utf8'),readFile('/proc/meminfo','utf8'),readFile('/proc/stat','utf8')]);
   const ticks=cpu.split('\n')[0].trim().split(/\s+/).slice(1,9).map(Number),total=ticks.reduce((n,v)=>n+v,0),idle=ticks[3]+ticks[4];
   const cpuPercent=previousCpu&&total>previousCpu.total?100*(1-(idle-previousCpu.idle)/(total-previousCpu.total)):null;
   previousCpu={total,idle};
   samples.push({at:Date.now(),rssKiB:Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]||0),usedMemoryBytes:(Number(memory.match(/^MemTotal:\s+(\d+)/m)?.[1])-Number(memory.match(/^MemAvailable:\s+(\d+)/m)?.[1]))*1024,cpuPercent});
  }catch{}},2000);
  const start=performance.now(),until=start+seconds*1000;
  console.log('CAPACITY_HTTP_START '+JSON.stringify({users:count,seconds,thinkMs,cpuLogical:cpus().length,memoryBytes:totalmem(),sectionsPerUser:43,uploadBytes:131072,exportFixtureBytes:docx.length,ai:false,browser:false}));
  progress=setInterval(()=>console.log('CAPACITY_HTTP_PROGRESS '+JSON.stringify({elapsedSeconds:Math.round((performance.now()-start)/1000),targetSeconds:seconds,requests:Object.values(metrics).reduce((n,m)=>n+m.times.length,0),errors:errors.length})),30000);
  await Promise.all(users.map(async(user,i)=>{
   await sleep(Math.floor(i/count*thinkMs));let step=0;
   while(performance.now()<until){
    // Deterministic mixed actions, staggered across accounts: 65% browse,
    // 30% edits, 4% 128KiB uploads, 1% actual document pagination.
    const choice=(i*37+step*13)%100;step++;
    try{
     if(choice<65){const section=step%43;const q=new URLSearchParams({action:'slice',researchId:user.ids.researchId,runId:user.ids.runId,epoch:'1',version:String(user.version),path:JSON.stringify(['draft','chapters',section])});const result=await request(user,'browse','/api/research?'+q);assert.deepEqual(result.value,user.state.draft.chapters[section]);}
     else if(choice<95){user.state.draft.chapters[step%43].sections[0].content+=' 编辑'+step;await save(user);}
     else if(choice<99){const data=Buffer.alloc(131072,i%256);const result=await request(user,'upload','/api/researchmaterials',{...user.ids,epoch:1,name:'[系统测试]'+step+'.txt',mimeType:'text/plain',dataBase64:data.toString('base64')});assert.equal(result.stored,true);assert.equal(result.object.sizeBytes,data.length);}
     else{const result=await request(user,'export','/api/report-pagination',docx,true);assert.ok(result.pages>0);}
    }catch(error){const detail={user:i,step,error:error.message};errors.push(detail);if(errors.length<=20)console.log('CAPACITY_HTTP_ERROR '+JSON.stringify(detail));}
    await sleep(thinkMs);
   }
  }));
  // Compare every final saved report; success counts alone cannot prove no loss.
  for(const user of users){const q=new URLSearchParams({researchId:user.ids.researchId,runId:user.ids.runId});const result=await request(user,'final-verify','/api/research?'+q);assert.deepEqual(result.run.state,user.state);}
  const summary={users:count,elapsedSeconds:Math.round((performance.now()-start)/1000),serverPeakRssBytes:Math.max(0,...samples.map(s=>s.rssKiB))*1024,errors:errors.slice(0,20),errorCount:errors.length,metrics:Object.fromEntries(Object.entries(metrics).map(([key,m])=>{m.times.sort((a,b)=>a-b);return [key,{count:m.times.length,p50Ms:Math.round(m.times[Math.floor(m.times.length*.5)]),p95Ms:Math.round(m.times[Math.ceil(m.times.length*.95)-1]),statuses:m.statuses,responseBytes:m.bytes}];}))};
  summary.vmPeakUsedMemoryBytes=Math.max(0,...samples.map(s=>s.usedMemoryBytes));
  const cpuSamples=samples.map(s=>s.cpuPercent).filter(Number.isFinite);
  summary.vmCpuMeanPercent=cpuSamples.length?Math.round(cpuSamples.reduce((a,b)=>a+b,0)/cpuSamples.length):null;
  summary.vmCpuPeakPercent=cpuSamples.length?Math.round(Math.max(...cpuSamples)):null;
  console.log('CAPACITY_HTTP_RESULT '+JSON.stringify(summary));
  assert.equal(errors.length,0,'发现真实错误/排队拒绝，不能宣布容量达标');
 }finally{
  clearInterval(sampling);
  clearInterval(progress);
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([exited,sleep(5000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
  await DB._close();
  // Only the uniquely created scratch directory contains this test's originals.
  await rm(folder,{recursive:true,force:true});
 }
});
