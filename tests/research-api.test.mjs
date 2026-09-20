import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {onRequestGet,onRequestPost} from '../functions/api/research.js';
import {hashPassword,signToken} from '../functions/api/_auth.js';
import {updateResearchMember,listResearch} from '../functions/api/_research-store.js';
import {onRequestPost as aiPost} from '../functions/api/aireport.js';
import {onRequestPost as runtimePost} from '../functions/api/agentruns.js';
import {onRequestPost as generatePost} from '../functions/api/generate.js';
const target=testDatabaseUrl();
test('研究HTTP生命周期、幂等和共享选择权限',{skip:!target},async t=>{
 const DB=createD1Shim(target),env={DB,RESEARCH_IDENTITY_ENABLED:'1',RESEARCH_STORAGE_V2:'1',SESSION_SECRET:crypto.randomUUID()},password='isolated-test-password',salt='isolated-test-salt';
 const rid=()=>crypto.randomUUID();
 try{
  async function actor(){const username='test-'+rid();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(username,await hashPassword(password,salt),salt,Date.now()).run();const id=Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(username).first()).id);return {id,token:await signToken(env,id,username)};}
  const owner=await actor(),peer=await actor();
  async function call(user,body,extra={}){const response=await onRequestPost({env:{...env,...extra},request:new Request('http://test/api/research',{method:'POST',headers:{authorization:'Bearer '+user.token},body:JSON.stringify(body)})});return {status:response.status,...await response.json()};}
  async function get(user,params){const response=await onRequestGet({env,request:new Request('http://test/api/research?'+new URLSearchParams(params),{headers:{authorization:'Bearer '+user.token}})});return {http:response.status,...await response.json()};}
  let created,history,newRun;
  await t.test('Agent运行绑定轮次：自动保存继续，重启后工具及完成均拒绝',async()=>{
   const study=await call(peer,{action:'create',requestId:rid(),title:'[系统测试]Agent研究'});
   const scope={researchId:study.researchId,runId:study.runId,epoch:1,expectedVersion:1};
   async function runtime(body){const response=await runtimePost({env,request:new Request('http://test/api/agentruns',{method:'POST',headers:{authorization:'Bearer '+peer.token},body:JSON.stringify(body)})});return {http:response.status,...await response.json()};}
   const task=await runtime({action:'create',research:scope,projectId:'must-not-use',idempotencyKey:rid(),input:{}});
   assert.equal(task.ok,true);assert.equal(task.run.project_id,'');assert.equal(JSON.parse(task.run.input_json).research.runId,scope.runId);
   assert.equal((await call(peer,{action:'save',...scope,requestId:rid(),state:{chat:['saved']}})).ok,true);
   assert.equal((await runtime({action:'step',runId:task.run.id,kind:'model',output:{ok:true}})).ok,true);
   assert.equal((await call(peer,{action:'restart',...scope,expectedVersion:2,requestId:rid(),mode:'blank'})).ok,true);
   assert.equal((await runtime({action:'authorize',runId:task.run.id,toolName:'anything'})).http,409);
   assert.equal((await runtime({action:'complete',runId:task.run.id,output:{text:'late'}})).http,409);
   const response=await generatePost({env,request:new Request('http://test/api/generate',{method:'POST',headers:{authorization:'Bearer '+peer.token},body:JSON.stringify({research:scope,messages:[]})})});assert.equal(response.status,409);
   const saved=await DB.prepare('SELECT output_json FROM agent_runs WHERE id=?').bind(task.run.id).first();assert.equal(saved.output_json,'{}');
  });
  await t.test('默认关闭；新建始终私人且不隐式创建正式项目',async()=>{
   const n=Number((await DB.prepare('SELECT COUNT(*) AS n FROM projects').first()).n);
   assert.equal((await call(owner,{action:'create',requestId:rid()},{RESEARCH_IDENTITY_ENABLED:'0'})).status,503);
   created=await call(owner,{action:'create',requestId:rid(),title:'[系统测试]HTTP研究',visibility:'shared'});assert.equal(created.ok,true);
   const loaded=await get(owner,created);assert.equal(loaded.study.visibility,'private');assert.equal(loaded.study.formalProjectId,null);
   assert.equal(loaded.storageProtocol,'parts-v1');assert.equal(loaded.storageUploadBatchBytes,1024*1024);
   assert.equal(loaded.storageLogicalStateBytes,128*1024*1024);assert.equal(loaded.storageRunObjectBytes,256*1024*1024);
   assert.equal(Number((await DB.prepare('SELECT COUNT(*) AS n FROM projects').first()).n),n);
   assert.equal((await get(peer,{researchId:created.researchId})).http,404);
  });
  await t.test('保存、重新开始幂等、旧轮次只读且内容保留',async()=>{
   const saved=await call(owner,{action:'save',...created,requestId:rid(),epoch:1,expectedVersion:1,state:{draft:{project:{name:'保留历史'}}}});assert.equal(saved.ok,true);
   const input={action:'restart',researchId:created.researchId,runId:created.runId,requestId:rid(),epoch:1,expectedVersion:2,mode:'blank'};
   newRun=await call(owner,input);assert.equal(newRun.ok,true);assert.equal((await call(owner,input)).runId,newRun.runId);
   history=await get(owner,{researchId:created.researchId,runId:created.runId});assert.equal(history.run.status,'history');assert.equal(history.run.state.draft.project.name,'保留历史');
   assert.equal((await call(owner,{action:'save',researchId:created.researchId,runId:created.runId,requestId:rid(),epoch:history.run.epoch,expectedVersion:2,state:{}})).status,409);
  });
  await t.test('解析必须绑定活动轮次；普通保存允许返回，重启时拒绝迟到结果',async()=>{
   const fresh=await call(peer,{action:'create',requestId:rid(),title:'[系统测试]解析轮次'});
   const scope={researchId:fresh.researchId,runId:fresh.runId,epoch:1,expectedVersion:1};
   async function ai(body,parse){const response=await aiPost({env:{...env,AI:{toMarkdown:parse}},request:new Request('http://test/api/aireport',{method:'POST',headers:{authorization:'Bearer '+peer.token},body:JSON.stringify(body)})});return {status:response.status,...await response.json()};}
   assert.equal((await ai({action:'saveState',research:scope,state:{}},()=>{})).status,400);
   const input={action:'parseLegacyDoc',research:scope,name:'test.doc',dataBase64:'YWJj'};
   const normal=await ai(input,async()=>{assert.equal((await call(peer,{action:'save',...scope,requestId:rid(),state:{chat:['保存中']}})).ok,true);return [{data:'解析结果'}];});assert.equal(normal.text,'解析结果');
   scope.expectedVersion=2;
   const late=await ai({...input,research:scope},async()=>{assert.equal((await call(peer,{action:'restart',...scope,requestId:rid(),mode:'blank'})).ok,true);return [{data:'不能返回的旧结果'}];});
   assert.equal(late.status,409);assert.equal(late.text,undefined);
  });
  await t.test('错误密码不变更；废弃与恢复重复HTTP请求幂等',async()=>{
   const status=await get(owner,{researchId:created.researchId,runId:newRun.runId});
   const abandon={action:'abandon',researchId:created.researchId,runId:newRun.runId,expectedVersion:status.study.version,requestId:rid(),password};
   assert.equal((await call(owner,{...abandon,password:'wrong'})).status,403);
   assert.equal((await call(owner,abandon)).ok,true);assert.equal((await call(owner,abandon)).ok,true);
   const current=await get(owner,{researchId:created.researchId,runId:newRun.runId});assert.equal(current.study.status,'abandoned');
   const restore={...abandon,action:'restore',expectedVersion:current.study.version,requestId:rid()};
   assert.equal((await call(owner,restore)).ok,true);assert.equal((await call(owner,restore)).ok,true);
  });
  await t.test('共享个人选择不改变同事选择；撤权即刻禁止读取与保存',async()=>{
   await DB.prepare("UPDATE research_studies SET visibility='shared' WHERE id=?").bind(created.researchId).run();
   const current=await get(owner,{researchId:created.researchId});
   const membership=await updateResearchMember(DB,owner.id,{researchId:created.researchId,userId:peer.id,role:'editor',status:'active',expectedVersion:current.study.version});
   const shared=await get(peer,{researchId:created.researchId,runId:newRun.runId});
   assert.equal((await listResearch(DB,owner.id)).items.find(x=>x.id===created.researchId).role,'manager');
   assert.equal((await listResearch(DB,peer.id)).items.find(x=>x.id===created.researchId).role,'editor');
   assert.equal((await call(peer,{action:'save',researchId:created.researchId,runId:newRun.runId,userId:owner.id,expectedVersion:shared.run.version,epoch:shared.run.epoch,requestId:rid(),state:{}})).status,409);
   assert.equal((await call(peer,{action:'select',researchId:created.researchId,runId:created.runId})).ok,true);
   assert.equal((await get(peer,{researchId:created.researchId})).run.runId,created.runId);
   assert.equal((await get(owner,{researchId:created.researchId})).run.runId,newRun.runId);
   await updateResearchMember(DB,owner.id,{researchId:created.researchId,userId:peer.id,role:'editor',status:'revoked',expectedVersion:membership.version});
   assert.equal((await get(peer,{researchId:created.researchId})).http,404);
   assert.equal((await listResearch(DB,peer.id)).items.some(x=>x.id===created.researchId),false);
   assert.equal((await call(peer,{action:'save',researchId:created.researchId,runId:newRun.runId,expectedVersion:1,epoch:1,requestId:rid(),state:{}})).status,404);
  });
 }finally{await DB._close();}
});
