// Replay real frozen inputs in a uniquely named test project, never accept a
// candidate or alter the original project. Retain every raw response for audit.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
import {reportCandidateQuality} from '../functions/api/reportexecution.js';
const C=globalThis.ReportCompletionContract,db=createD1Shim(process.env.DATABASE_URL);
const probe=process.argv.includes('--probe');
const sourceId='1bb24013-18ce-4819-9588-09fe98e5e0c0',id=crypto.randomUUID(),name='[系统测试]并发成稿恢复-'+id.slice(0,8);
const directory=path.resolve('outputs/report-standardization/recovery-'+new Date().toISOString().replace(/[:.]/g,'-'));
await fs.mkdir(directory,{recursive:true});
const parse=x=>typeof x==='string'?JSON.parse(x):x,hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const audit={scope:'real durable API/provider; isolated test project; no candidate acceptance',sourceId,testProjectId:id,name,directory,sections:[],checks:[],factsVerified:false};
const save=(file,value)=>fs.writeFile(path.join(directory,file),JSON.stringify(value,null,2));
let created=false,authorization='',before,started=Date.now();
async function request(url,body,method=body?'POST':'GET'){const r=await fetch('http://localhost:8080'+url,{method,headers:{authorization,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(/generate|rag/.test(url)?90000:30000)});const data=await r.json();if(!r.ok||data.error||data.ok===false)throw Error(url.split('?')[0]+': '+(data.error||r.status));return data;}
try{
 const user=await db.prepare('SELECT id,username FROM users WHERE username=?').bind('zgbyd').first();assert.ok(user);authorization='Bearer '+await signToken(process.env,user.id,user.username);
 const source=await db.prepare('SELECT data,updated_at FROM projects WHERE id=?').bind(sourceId).first();assert.ok(source);before=hash(source);const data=parse(source.data);
 const rows=(await db.prepare('SELECT t.*,l.response_json,l.created_at AS call_at FROM report_section_tasks t LEFT JOIN agent_call_ledger l ON l.run_id=t.run_id WHERE t.project_id=? AND t.created_at>(SELECT MAX(created_at)-86400000 FROM report_section_tasks WHERE project_id=?) ORDER BY t.created_at').bind(sourceId,sourceId).all()).results;
 const roots=new Map(),latest=new Map();for(const row of rows){const snap=parse(row.input_json);latest.set(row.section_key,row);if(!snap.qualityRepair)roots.set(row.section_key,row);}
 audit.before={sections:latest.size,calls:rows.length,repairCalls:rows.filter(r=>parse(r.input_json).qualityRepair).length,results:[...latest.values()].map(r=>({section:r.section_key,quality:reportCandidateQuality(parse(r.input_json),parse(r.response_json||'{}').text||'')}))};
 await save('before.json',audit.before);assert.equal(roots.size,43,'Expected the exact affected 43-section batch');
 await request('/api/projects',{action:'createProject',id,name});created=true;const opened=await request('/api/projects?id='+id);
 // Keep calculation/material evidence, not the source report, project identity,
 // management permissions, browser draft, or signed report state.
 await request('/api/projects',{id,name,expectedUpdatedAt:opened.project.updated_at,data:{project:{...data.project,name},calcType:'gaibao',calcParams:data.calcParams,kb:data.kb||[],workflow:{management:opened.project.data.workflow.management,calcSnapshots:data.workflow?.calcSnapshots},chapters:[]}});
 const baseline=await request('/api/projects?id='+id),logic=await db.prepare("SELECT version FROM report_logic_sets WHERE project_type='gaibao' AND status='published' ORDER BY version DESC LIMIT 1").first();
 const allEntries=[...roots.values()],probePatterns=[/改造实施计划/,/需求分析/,/财务.*(?:基础数据|假设|参数)/,/结论/];
 const entries=probe?[...new Map(probePatterns.map(re=>{const row=allEntries.find(r=>re.test(r.section_key));assert.ok(row,'Missing representative section '+re);return [row.id,row];})).values()]:allEntries;
 audit.mode=probe?'four-section-probe':'43-section-batch';audit.expectedSections=entries.length;audit.modelCallBudget=entries.length*3;
 // Verify the paid provider before dispatching; never blindly resend jobs of unknown charge.
 const smoke=await request('/api/generate',{kind:'batch',system:'只输出一句中文。',messages:[{role:'user',content:'[系统测试]回答生成接口正常。'}],max_tokens:80});
 assert.ok(smoke.content?.some(c=>c.type==='text'&&c.text?.trim()));audit.checks.push({name:'paid-provider-preflight',passed:true});
 let cursor=0;
 await Promise.all(Array.from({length:4},async()=>{while(cursor<entries.length){const row=entries[cursor++],snap=parse(row.input_json),contract=structuredClone(snap.qualityContract);const start=Date.now(),attempts=[];let task;
  try{
   contract.requiredFacts=contract.requiredFacts.map(f=>f.key==='mode'?{...f,value:({lease:'每月固定单价收楼','rent-percent':'按当月实收租金比例收楼',share:'减租合作分成'}[f.value]||f.value)}:f);
   if(/财务.*(?:基础数据|假设|参数)/.test(contract.sectionKey))contract.requiredTables=contract.requiredTables.map(t=>t.title==='财务评价指标表'?{title:'财务测算参数与假设表',headers:[],terms:['参数','假设','租金','面积']}:t);
   let sourceHtml,sourceSnapshotId;if(contract.frozenTables){sourceHtml=contract.frozenTables.tables.map(t=>t.html).join('');sourceSnapshotId='[系统测试]'+id+':'+row.section_key;Object.assign(contract,await C.bindFrozenTables({...contract,frozenTables:undefined},sourceHtml,sourceSnapshotId));}else if(contract.basisCatalog)sourceSnapshotId=contract.basisCatalog.sourceSnapshotId;
   task=(await request('/api/reportexecution',{projectId:id,projectType:'gaibao',logicVersion:logic.version,sectionKey:row.section_key,qualityContract:contract,...(sourceHtml!==undefined?{sourceHtml,sourceSnapshotId}:sourceSnapshotId?{sourceSnapshotId}:{}),system:snap.system,user:snap.user})).task;
   const deadline=Date.now()+600000;
   while(Date.now()<deadline){task=(await request('/api/reportexecution?id='+encodeURIComponent(task.id))).task;if(task.status==='completed'){attempts.push(task);if(task.quality.status==='blocked'&&task.repair.canRetry){task=(await request('/api/reportexecution',{action:'repair',id:task.id})).task;continue;}break;}if(['failed','dead','cancelled','invalidated'].includes(task.status))throw Error(task.error||task.status);await new Promise(r=>setTimeout(r,1200));}
   assert.equal(task.status,'completed');await save('section-'+row.id+'.json',{section:row.section_key,attempts});
   const writing=globalThis.ReportWritingStandard.inspect(task.text||'');
   audit.sections.push({section:row.section_key,status:task.quality.status,metanarration:writing.issues.length,attempts:attempts.length,elapsedMs:Date.now()-start,runIds:attempts.map(t=>t.runId),errors:task.quality.issues.filter(i=>i.severity==='error'),taskId:task.id});
  }catch(e){audit.sections.push({section:row.section_key,status:'error',error:e.message,taskId:task?.id,elapsedMs:Date.now()-start});}
  console.log(JSON.stringify(audit.sections.at(-1)));await save('progress.json',audit);
 }}));
 assert.deepEqual((await request('/api/projects?id='+id)).project.data,baseline.project.data);audit.checks.push({name:'test-project-report-never-mutated',passed:true});
 const calls=(await db.prepare('SELECT l.created_at,u.latency_ms FROM agent_call_ledger l JOIN agent_run_usage u ON u.run_id=l.run_id JOIN report_section_tasks t ON t.run_id=l.run_id WHERE t.project_id=? ORDER BY l.created_at').bind(id).all()).results;
 const events=calls.flatMap(c=>[[Number(c.created_at),1],[Number(c.created_at)+Number(c.latency_ms),-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let active=0,peak=0;for(const [,delta]of events){active+=delta;peak=Math.max(peak,active);}
 audit.modelCalls=calls.length;audit.recordedModelOverlap=peak;audit.elapsedMs=Date.now()-started;
 for(const [url,body]of [['/api/generate',{kind:'batch',system:'只输出一句中文。',messages:[{role:'user',content:'[系统测试]回答生成接口正常。'}],max_tokens:80}],['/api/rag',{action:'query',query:'保障性租赁住房政策',topK:2}],['/api/reporttables?projectType=rent',null]]){const response=await request(url,body);assert.ok(url==='/api/generate'?response.content?.some(c=>c.type==='text'&&c.text?.trim()):response.ok);audit.checks.push({name:url,passed:true});}
}catch(e){audit.error=e.message;process.exitCode=1;}
finally{
 const after=await db.prepare('SELECT data,updated_at FROM projects WHERE id=?').bind(sourceId).first();audit.sourceUnchanged=before===hash(after);
 if(created){const remaining=await db.prepare("SELECT COUNT(*) AS n FROM agent_jobs j JOIN report_section_tasks t ON t.run_id=j.run_id WHERE t.project_id=? AND j.status IN ('queued','running','leased','retry')").bind(id).first();if(Number(remaining.n)===0){const target=await request('/api/projects?id='+id);assert.equal(target.project.name,name);await request('/api/projects?id='+id,null,'DELETE');audit.testProjectRemoved=true;}else audit.cleanupDeferred='Active jobs retained; exact test project ID recorded';}
 audit.passed=audit.sections.length===audit.expectedSections&&audit.sections.every(s=>!['blocked','error'].includes(s.status)&&s.metanarration===0)&&audit.sourceUnchanged&&audit.recordedModelOverlap>=Math.min(4,audit.expectedSections)&&audit.modelCalls<=audit.modelCallBudget&&!audit.error;
 await save('summary.json',audit);await db._close();console.log(JSON.stringify({directory,passed:audit.passed,sections:audit.sections.length,blocked:audit.sections.filter(s=>s.status==='blocked').length,errors:audit.sections.filter(s=>s.status==='error').length,elapsedMs:audit.elapsedMs,recordedModelOverlap:audit.recordedModelOverlap,sourceUnchanged:audit.sourceUnchanged,testProjectRemoved:audit.testProjectRemoved}));if(!audit.passed)process.exitCode=1;
}
