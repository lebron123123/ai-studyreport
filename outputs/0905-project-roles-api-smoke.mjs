import pg from '../local-server/node_modules/pg/lib/index.js';
import {signToken} from '../functions/api/_auth.js';
import assert from 'node:assert/strict';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
  const id='1bb24013-18ce-4819-9588-09fe98e5e0c0';
  const row=(await db.query('SELECT u.id,u.username FROM users u JOIN projects p ON p.user_id=u.id WHERE p.id=$1',[id])).rows[0];
  assert.ok(row);const token=await signToken(process.env,row.id,row.username);
  const get=async path=>{const r=await fetch('http://localhost:8080'+path,{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);return r.json();};
  const detail=await get('/api/projects?id='+id);assert.equal(detail.project.role,'OWNER');assert.equal(detail.project.permissions.edit,true);
  const list=await get('/api/projects');assert.equal(list.list.find(x=>x.id===id).role,'OWNER');
  await get('/api/agentruns');await get('/api/agentjobs');
  console.log('PASS: 正式服务OWNER详情/索引角色、运行历史、任务列表；只读检查，无正文写入');
}finally{await db.end();}
