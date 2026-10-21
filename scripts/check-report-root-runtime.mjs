// Scoped runtime acceptance. Reads identity, generates one tiny diagnostic reply,
// queries retrieval, and paginates isolated QA files. Never saves a user report.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const sourceDir=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!sourceDir.startsWith(path.resolve('outputs/report-standardization')+path.sep))throw Error('Use an exact isolated QA directory within outputs/report-standardization');
const resultFile=path.join(sourceDir,'runtime-'+Date.now()+'.json');
const db=createD1Shim(process.env.DATABASE_URL),checks=[];
const base='http://localhost:8080';
try{
 const rows=(await db.prepare('SELECT id,username FROM users WHERE username=?').bind('zgbyd').all()).results||[];
 if(rows.length!==1)throw Error('Expected exactly one previously verified local account; no guessed identity');
 const token=await signToken(process.env,rows[0].id,rows[0].username);
 async function request(name,url,body,timeout=60000){
  const start=Date.now(),response=await fetch(base+url,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeout)});
  const data=await response.json();checks.push({name,status:response.status,ok:response.ok,durationMs:Date.now()-start});
  if(!response.ok)throw Error(name+' failed: '+response.status+' '+String(data.error||''));return data;
 }
 const site=await fetch(base,{signal:AbortSignal.timeout(10000)});assert.equal(site.status,200);assert.match(await site.text(),/report-completion-contract\.js\?v=20260922.root2/);checks.push({name:'final-static-version',status:site.status,ok:true});
 const gen=await request('actual-ai-generation','/api/generate',{kind:'batch',system:'你是接口诊断助手。只输出一句中文。',messages:[{role:'user',content:'[系统测试]只回答：报告生成接口正常。不要调用任何工具。'}],max_tokens:80},90000);
 const reply=(gen.content||[]).map(x=>x.text||'').join('');assert.ok(reply.trim());checks.at(-1).responseCharacters=reply.length;
 const rag=await request('adjacent-rag-retrieval','/api/rag',{action:'query',query:'[系统测试]保障性租赁住房政策',topK:2},90000);assert.equal(rag.ok,true);checks.at(-1).matches=rag.matches?.length||0;
 for(const type of ['gaibao-housing','rent','sale']){const tables=await request('table-template-'+type,'/api/reporttables?projectType='+type);assert.equal(tables.ok,true);checks.at(-1).publishedVersion=tables.config?.version;}
 for(const name of ['tax','longgang','longgang-candidate']){
  const filename=path.join(sourceDir,name+'.docx');try{await fs.access(filename);}catch{continue;}
  const body=await fs.readFile(filename),sha=crypto.createHash('sha256').update(body).digest('hex'),start=Date.now();
  const response=await fetch(base+'/api/report-pagination',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},body,signal:AbortSignal.timeout(75000)});
  const data=await response.json();assert.ok([200,422].includes(response.status),JSON.stringify(data));assert.equal(data.receipt?.documentSha256,sha);assert.equal(data.receipt?.versionsMatch,true);assert.equal(data.receipt?.contentQualityCertified,false);assert.ok(data.pages>0);
  checks.push({name:'pagination-'+name,status:response.status,ok:true,pageLimitPassed:response.status===200,durationMs:Date.now()-start,...data});
  console.log(name+': '+data.pages+' pages; diagnostics '+data.diagnostics.status+', '+data.diagnostics.sections.length+' sections, '+data.diagnostics.tables.length+' tables');
 }
 await fs.writeFile(resultFile,JSON.stringify({at:new Date().toISOString(),scope:'real service + isolated files; no report writes',checks},null,2),{flag:'wx'});console.log('PASS '+resultFile);
}catch(error){await fs.writeFile(resultFile,JSON.stringify({at:new Date().toISOString(),checks,error:error.message},null,2),{flag:'wx'}).catch(()=>{});throw error;}
finally{await db._close();}
