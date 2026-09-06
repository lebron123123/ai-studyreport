// Explicit local-only opt-in. Creates one named test project; never edits a user report.
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
if(!process.argv.includes('--run'))throw new Error('Pass --run for one real model call on localhost:8080');
const db=createD1Shim(process.env.DATABASE_URL),id='system-test-execution-'+crypto.randomUUID(),name='[系统测试]持久化报告生成验收';
try{
 const owner=await db.prepare('SELECT id,username FROM users ORDER BY id LIMIT 1').first();
 const token=await signToken(process.env,owner.id,owner.username),headers={'content-type':'application/json',authorization:'Bearer '+token};
 async function request(path,body){const r=await fetch('http://localhost:8080'+path,{headers,signal:AbortSignal.timeout(20000),...(body?{method:'POST',body:JSON.stringify(body)}:{})}),value=await r.json();if(!r.ok||!value.ok)throw Error(path+': '+(value.error||r.status));return value;}
 await request('/api/projects',{id,name,data:{project:{name,businessScenario:'housing_conversion'},chapters:[]}});
 const logic=(await request('/api/reportlogic?projectType=gaibao')).set;
 const input={projectId:id,projectType:'gaibao',logicVersion:logic.version,sectionKey:'系统测试 / 连通性',system:'只输出一行文字。',user:'请回复：持久化任务验收成功。'};
 const task=(await request('/api/reportexecution',input)).task;
 let state;for(let i=0;i<100;i++){state=(await request('/api/reportexecution?id='+task.id)).task;if(['completed','dead','cancelled','invalidated'].includes(state.status))break;await new Promise(r=>setTimeout(r,1500));}
 assert.equal(state.status,'completed',state.error);assert.ok(state.text);
 assert.equal((await request('/api/reportexecution',input)).task.id,task.id);
 for(let i=0;i<3;i++)assert.equal((await request('/api/reportexecution?id='+task.id)).task.text,state.text);
 assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM agent_call_ledger WHERE run_id=?').bind(task.runId).first()).n),1);
 console.log(JSON.stringify({ok:true,realModel:true,reloads:3,calls:1,graph:state.graph.map(x=>x.status),usageState:state.usage.status,testProject:id}));
 console.log('测试项目与任务审计保留，名称以[系统测试]开头；未修改任何正式报告。');
}finally{await db._close();}
