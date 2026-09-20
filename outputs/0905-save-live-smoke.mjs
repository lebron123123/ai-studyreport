import pg from '../local-server/node_modules/pg/lib/index.js';
import {signToken} from '../functions/api/_auth.js';
import assert from 'node:assert/strict';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
const id='system-test-save-'+crypto.randomUUID(),name='[系统测试]大报告保存闭环';let created=false;
try{
  const owner=(await db.query('SELECT p.user_id,u.username FROM projects p JOIN users u ON u.id=p.user_id WHERE p.id=$1',['1bb24013-18ce-4819-9588-09fe98e5e0c0'])).rows[0];
  if(!owner)throw Error('Scoped owner missing');
  const token=await signToken(process.env,owner.user_id,owner.username);
  const headers={'content-type':'application/json',authorization:'Bearer '+token};
  const request=(path,body)=>fetch('http://localhost:8080'+path,{headers,signal:AbortSignal.timeout(45000),...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  if(!process.argv.includes('--adjacent-only')){
  const data={documentRevision:2,project:{name},chapters:[{name:'总论',sections:Array.from({length:41},(_,i)=>({t:'小节'+i,content:'已接受'+i+'正文'.repeat(13000),pendingRevision:null,syncStatus:'current'}))}],workflow:{reportVersions:[]}};
  data.workflow.reportVersions=[{id:'v2',version:2,reason:'批量接受35份候选',chapters:data.chapters}];
  let r=await request('/api/projects',{id,name,data});assert.equal(r.status,200);const result=await r.json();assert.equal(result.ok,true);created=true;
  for(let i=0;i<3;i++){r=await request('/api/projects?id='+id);const saved=(await r.json()).project;assert.deepEqual(saved.data,data);assert.equal(saved.data.chapters[0].sections.filter(s=>s.pendingRevision).length,0);}
  console.log(JSON.stringify({projectSave:'PASS',bytes:Buffer.byteLength(JSON.stringify(data)),reloads:3,versions:1,sections:41}));
  r=await request('/api/projects',{id,name,data,expectedUpdatedAt:1});assert.equal(r.status,409);console.log('conflict-protection: PASS');
  }
  let r;
  for(const path of ['/','/api/outlines','/api/calcconfig']){r=await request(path);assert.equal(r.status,200);console.log(path+': 200');}
  r=await request('/api/rag',{action:'query',query:'保障性租赁住房',topK:1});assert.equal(r.status,200);assert.equal((await r.json()).ok,true);console.log('RAG query: PASS');
  r=await request('/api/generate',{messages:[{role:'user',content:'系统连通性测试，只回复OK'}],max_tokens:200,stream:false});
  const output=await r.json();assert.equal(r.status,200);assert.ok(output.content?.[0]?.text);console.log('real AI generate: PASS');
}finally{
  if(created){const row=(await db.query('SELECT name FROM projects WHERE id=$1',[id])).rows[0];if(row?.name===name){await db.query('DELETE FROM projects WHERE id=$1 AND name=$2',[id,name]);console.log('scoped test project removed');}}
  await db.end();
}
