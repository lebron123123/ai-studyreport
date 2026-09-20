import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {createD1Shim} from '../local-server/d1-shim.js';
import {createResearch,saveResearchRun,readResearch,updateResearchMember} from '../functions/api/_research-store.js';
import {onRequestGet} from '../functions/api/research.js';
import {signToken} from '../functions/api/_auth.js';
import {packState} from '../research-state-codec.mjs';
const target=testDatabaseUrl();
test('按需API隔离账号、轮次、版本，撤权生效且切片不能覆盖整稿',{skip:!target},async()=>{
 const DB=createD1Shim(target),env={DB,DEPLOY_MODE:'local',SESSION_SECRET:crypto.randomUUID(),RESEARCH_IDENTITY_ENABLED:'1',RESEARCH_STORAGE_V2:'1'};
 try{
  const users=[];
  for(let i=0;i<2;i++){
   const name='[系统测试]切片权限'+crypto.randomUUID();
   await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','disabled',Date.now()).run();
   const row=await DB.prepare('SELECT id,username FROM users WHERE username=?').bind(name).first();users.push({...row,id:Number(row.id)});
  }
  const [owner,other]=users;
  const ids=await createResearch(DB,owner.id,{requestId:crypto.randomUUID(),title:'[系统测试]按需读取'});
  const state={draft:{chapters:[{content:'正文'.repeat(5000)}],materials:'材料'.repeat(20000)},history:['旧稿']};
  const packed=await packState(state);
  await saveResearchRun(DB,owner.id,{...ids,expectedVersion:1,epoch:1,requestId:crypto.randomUUID(),packed:{manifest:packed.manifest,objects:[...packed.objects]}});
  async function get(user,params={},authenticated=true){
   const query=new URLSearchParams({action:'slice',...ids,version:'2',epoch:'1',path:JSON.stringify(['draft','chapters',0]),...params});
   const headers=authenticated?{authorization:'Bearer '+await signToken(env,user.id,user.username)}:{};
   const response=await onRequestGet({env,request:new Request('http://test/api/research?'+query,{headers})});return {status:response.status,body:await response.json()};
  }
  assert.equal((await get(owner,{},false)).status,401);
  assert.equal((await get(other)).status,404);
  assert.equal((await get(owner,{version:'1'})).status,409);
  assert.equal((await get(owner,{epoch:'2'})).status,409);
  assert.equal((await get(owner,{runId:crypto.randomUUID()})).status,404);
  const slice=await get(owner);assert.equal(slice.status,200);assert.deepEqual(slice.body.value,state.draft.chapters[0]);assert.equal(slice.body.state,undefined);
  await assert.rejects(saveResearchRun(DB,owner.id,{...ids,expectedVersion:2,epoch:1,requestId:crypto.randomUUID(),state:slice.body}),/局部/);
  assert.deepEqual((await readResearch(DB,owner.id,ids.researchId,ids.runId)).run.state,state);
  await DB.prepare("UPDATE research_studies SET visibility='shared' WHERE id=?").bind(ids.researchId).run();
  const study=await readResearch(DB,owner.id,ids.researchId,ids.runId);
  const grant=await updateResearchMember(DB,owner.id,{researchId:ids.researchId,userId:other.id,role:'viewer',status:'active',expectedVersion:study.study.version});
  assert.equal((await get(other)).status,200);
  await updateResearchMember(DB,owner.id,{researchId:ids.researchId,userId:other.id,role:'viewer',status:'revoked',expectedVersion:grant.version});
  assert.equal((await get(other)).status,404);
 }finally{await DB._close();}
});
