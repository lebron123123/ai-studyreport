// Read-only diagnostics, except normal provider request/audit records. No knowledge submissions.
import pg from '../local-server/node_modules/pg/lib/index.js';
import {signToken} from '../functions/api/_auth.js';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try {
 const u=(await db.query('SELECT u.id,u.username FROM projects p JOIN users u ON u.id=p.user_id WHERE p.id=$1',['1bb24013-18ce-4819-9588-09fe98e5e0c0'])).rows[0];assert.ok(u);
 const headers={authorization:'Bearer '+await signToken(process.env,u.id,u.username),'content-type':'application/json'};
 async function call(path,body){const r=await fetch('http://localhost:8080'+path,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});assert.equal(r.status,200,path);return r.json();}
 await call('/api/projects');console.log('projects: PASS');
 const ocr=await call('/api/local-ocr',{dataBase64:(await readFile(process.argv[2])).toString('base64')});assert.ok(ocr.text.length>30);console.log('real image OCR transport: PASS, chars='+ocr.text.length+'; visual accuracy requires manual correction');
 const query=('深圳市保障性租赁住房项目认定办法 官方原文 最新有效版本 政策文件名称 文号 发布机关 适用范围 ').repeat(30).slice(0,1000)+' site:gov.cn';
 const search=await call('/api/webresearch',{action:'search',query,requirement:'后台资料寻源',maxQueries:1,maxResults:1,limit:1});assert.equal(search.plan.queries[0].query,query);console.log('long query preserved: PASS, chars='+query.length);
 const generation=await call('/api/generate',{system:'只输出一行',messages:[{role:'user',content:'请回复测试通过'}],max_tokens:200});assert.ok(generation);console.log('real generation: PASS');
} finally {await db.end();}
