// Separate schema inside an existing disposable restore DB; no business records are touched.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {readdir,readFile} from 'node:fs/promises';
import pg from '../local-server/node_modules/pg/lib/index.js';
import {createD1Shim} from '../local-server/d1-shim.js';
import {createAgentRun} from '../functions/api/_agent-runtime.js';
import {upsertRunGovernance,enqueueAgentJob,settleAgentJob} from '../functions/api/_agent-enterprise.js';
if(!process.argv.includes('--run'))throw new Error('使用 --run 显式启动隔离故障演练');
const source=new URL(process.env.DATABASE_URL||'');assert.ok(['localhost','127.0.0.1','[::1]'].includes(source.hostname));
const client=new pg.Client({connectionString:source.toString()});await client.connect();
let DB;const children=new Set(),schema='recovery_'+crypto.randomUUID().replaceAll('-','');
try{
 const name=(await client.query("SELECT datname FROM pg_database WHERE datname ~ '^studyreport_restore_[0-9]+$' ORDER BY datname DESC LIMIT 1")).rows[0]?.datname;assert.ok(name,'必须先创建隔离恢复库');source.pathname='/'+name;
 const setup=new pg.Client({connectionString:source.toString()});await setup.connect();try{await setup.query('CREATE SCHEMA '+schema);await setup.query('SET search_path TO '+schema);for(const f of (await readdir('migrations')).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort())await setup.query(await readFile('migrations/'+f,'utf8'));}finally{await setup.end();}
 source.searchParams.set('options','-c search_path='+schema);
 const baseSetup=new pg.Client({connectionString:source.toString()});await baseSetup.connect();try{
   await baseSetup.query("CREATE TABLE users(id SERIAL PRIMARY KEY,username TEXT UNIQUE,pass_hash TEXT,salt TEXT,created_at BIGINT,department TEXT DEFAULT '',clearance INTEGER DEFAULT 1)");
   await baseSetup.query('CREATE TABLE projects(id TEXT PRIMARY KEY,user_id INTEGER,name TEXT,data TEXT,updated_at BIGINT)');
 }finally{await baseSetup.end();}
 DB=createD1Shim(source.toString());const env={DB};
 await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind('system_recovery','invalid','test',Date.now()).run();const uid=Number((await DB.prepare('SELECT id FROM users').first()).id),pid=crypto.randomUUID();
 await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(pid,uid,'[系统测试]故障演练','{}',Date.now()).run();
 function worker(mode,onMessage=()=>{}){
  const child=fork('scripts/recovery-worker-fixture.mjs',[],{execArgv:[],env:{...process.env,RECOVERY_DATABASE_URL:source.toString(),RECOVERY_MODE:mode},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});children.add(child);
  return new Promise((resolve,reject)=>{const messages=[],timer=setTimeout(()=>{child.kill();reject(new Error('演练子进程超时'));},15000);child.on('message',m=>{messages.push(m);onMessage(child,m);});child.on('error',reject);child.on('exit',()=>{clearTimeout(timer);children.delete(child);resolve(messages);});});
 }
 async function enqueue(){const {run}=await createAgentRun(env,uid,{query:'[系统测试]恢复',projectId:pid,idempotencyKey:crypto.randomUUID()});await upsertRunGovernance(env,uid,run.id,{budgetOutputTokens:1000});return enqueueAgentJob(env,uid,run.id,{maxAttempts:3,payload:{projectId:pid,query:'回复完成',maxTokens:200}});}
 async function expired(job){const end=Date.now()+5000;while(Date.now()<end){const r=await DB.prepare('SELECT lease_expires_at FROM agent_jobs WHERE id=?').bind(job.id).first();if(Number(r.lease_expires_at)<Date.now())return;await new Promise(r=>setTimeout(r,100));}throw new Error('租约未按期失效');}
 const first=await enqueue();let old;
 await worker('before-call',(child,m)=>{if(m.event==='claimed'){old=m.job;child.kill();}});await expired(first);
 const pair=await Promise.all([worker('finish'),worker('finish')]);
 assert.equal(pair.flat().filter(x=>x.event==='model-started').length,1);
 assert.equal((await DB.prepare('SELECT status FROM agent_jobs WHERE id=?').bind(first.id).first()).status,'completed');assert.equal(await settleAgentJob(env,old,true),'lease_lost');
 const second=await enqueue();await worker('during-call',(child,m)=>{if(m.event==='model-started')child.kill();});await expired(second);
 const resumed=await worker('finish');assert.equal(resumed.filter(x=>x.event==='model-started').length,0);
 const final=await DB.prepare('SELECT status FROM agent_jobs WHERE id=?').bind(second.id).first();assert.equal(final.status,'dead');
 console.log(JSON.stringify({ok:true,database:name,schema,crashBeforeCallRecovered:true,concurrentWorkersSingleModelCall:true,staleWriterRejected:true,crashDuringCallNotResent:true,syntheticProvider:true,productionRecoveryVerified:false,isolatedFixturesRetained:true}));
}finally{for(const child of children)child.kill();if(DB)await DB._close();await client.end();}
