// Real HTTP + disk checks. Only UUID-scoped synthetic records are changed.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createD1Shim} from '../local-server/d1-shim.js';
import {createRagObjectStore} from '../local-server/rag-object-store.js';
import {signToken} from '../functions/api/_auth.js';
const url=new URL(process.env.DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
const DB=createD1Shim(url.toString()),projectId=crypto.randomUUID(),users=[];let artifact;
try{
 for(let i=0;i<2;i++){const name='[系统测试]formal-live-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','test-only',Date.now()).run();const id=Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id);users.push({id,name,token:await signToken({...process.env,DB},id,name)});}
 await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(projectId,users[0].id,'[系统测试]正式事实真实接口','{}',Date.now()).run();
 await DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,'EDITOR','active',?,?)").bind(projectId,users[1].id,Date.now(),Date.now()).run();
 const headers=u=>({authorization:'Bearer '+users[u].token,'content-type':'application/json'});
 async function api(body,u=0,status=200){const r=await fetch('http://localhost:8080/api/investmentops?view=formalFacts&projectId='+projectId,{method:body?'POST':'GET',headers:headers(u),body:body?JSON.stringify({...body,projectId}):undefined,signal:AbortSignal.timeout(20000)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
 const first=await api();assert.ok(first.formalFacts);assert.equal(first.formalFacts.items.length,0);
 const meeting=await api({action:'extractMeeting',title:'[系统测试]会议',content:'测试正式事实，不属于真实批准。'});
 const content='[系统测试]原件完整性 '+crypto.randomUUID();
 const upload=await fetch('http://localhost:8080/api/projectartifacts?projectId='+projectId+'&name=test-fact.txt',{method:'POST',headers:{...headers(0),'content-type':'text/plain'},body:content,signal:AbortSignal.timeout(20000)});assert.equal(upload.status,200);artifact=(await upload.json()).artifact;
 const download=await fetch('http://localhost:8080/api/projectartifacts?projectId='+projectId+'&id='+artifact.id,{headers:headers(0)});assert.equal(await download.text(),content);
 await api({action:'grantFactVerifier',userId:users[1].id,active:true,basis:'系统测试独立核验',expectedVersion:0});
 const base={action:'saveFormalFact',eventId:meeting.id,sourceId:artifact.id,round:1,expectedVersion:0,newRoundConfirmed:true,title:'[系统测试]事实',date:'2026-01-02',locator:'第1行',reason:'接口验收'};
 const verify=id=>api({action:'verifyFormalFact',id,expectedVersion:1,confirmed:true,reason:'已核对测试原件'},1);
 const held=await api({...base,kind:'held'});await api({...base,kind:'held'},0,409);await verify(held.id);
 const decision=await api({...base,kind:'decision',result:'passed'});await verify(decision.id);
 const money={amount:'100.25',currency:'CNY',amountBasis:'含税总投资',decisionId:decision.id};
 const original=await api({...base,...money,kind:'original'});await verify(original.id);
 const adjustment=await api({...base,...money,kind:'adjustment',amount:'120.25',originalId:original.id});await verify(adjustment.id);
 let state=(await api()).formalFacts;assert.equal(state.approvedBaseline.id,original.id);assert.equal(state.approvedAdjustment.id,adjustment.id);
 await api({...base,kind:'held',expectedVersion:2,reason:'测试更正'});state=(await api()).formalFacts;assert.equal(state.approvedBaseline,null);assert.equal(state.approvedAdjustment,null);
 console.log('PASS real HTTP: source upload/download/hash verification, independent verification, original/adjustment separation, duplicate409, correction invalidation.');
}finally{
 if(artifact){const row=await DB.prepare('SELECT storage_key FROM report_source_artifacts WHERE project_id=? AND id=?').bind(projectId,artifact.id).first();await DB.prepare('DELETE FROM report_source_artifacts WHERE project_id=? AND id=?').bind(projectId,artifact.id).run();if(row&&!await DB.prepare('SELECT id FROM report_source_artifacts WHERE storage_key=? LIMIT 1').bind(row.storage_key).first())await createRagObjectStore(process.env.RAG_OBJECT_ROOT||path.resolve('local-data/rag-objects')).remove(row.storage_key);}
 for(const table of ['investment_formal_facts','investment_fact_verifiers','project_events','project_meetings','project_memberships','project_profiles','project_work_stages'])await DB.prepare('DELETE FROM '+table+' WHERE project_id=?').bind(projectId).run();
 await DB.prepare('DELETE FROM projects WHERE id=?').bind(projectId).run();for(const u of users)await DB.prepare('DELETE FROM users WHERE id=? AND username=?').bind(u.id,u.name).run();await DB._close();console.log('Synthetic records and uniquely uploaded test object removed.');
}
