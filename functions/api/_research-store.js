// All writes lock the study first. Membership changes must use this same lock.
// PostgreSQL's existing transaction adapter is required; never emulate atomicity.
import {readStoredState,storedObjectIds,storePackedState,storeObjects} from './_research-state-objects.js';
import {readStoredSlice} from './_research-state-slice.js';
import {RESEARCH_SAVE_ENVELOPE_MAX_BYTES,RESEARCH_OBJECT_UPLOAD_REQUEST_MAX_BYTES,RESEARCH_RUN_OBJECT_MAX_BYTES} from '../../research-storage-policy.mjs';
export class ResearchError extends Error {
 constructor(status,message){super(message);this.status=status;}
}
// Report text, candidates and undo history share this budget; original files stay in the material store.
// Backward-compatible name: this is the small HTTP/manifest envelope, not the
// total logical size of a chunked study.
export const RESEARCH_STATE_MAX_BYTES=RESEARCH_SAVE_ENVELOPE_MAX_BYTES;
const fail=(status,message)=>{throw new ResearchError(status,message);};
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(value)?value:fail(400,'研究、轮次或请求标识无效');
const actor=value=>Number.isSafeInteger(value)&&value>0?value:fail(401,'请先登录');
const expectedActor=(userId,input)=>{actor(userId);if(input?.userId!==undefined&&Number(input.userId)!==userId)fail(409,'登录账号已变化，请重新打开当前研究');};
const parse=value=>JSON.parse(value);
const key=()=>crypto.randomUUID();
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export async function researchHash(value){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
const tx=(db,work)=>typeof db?._transaction==='function'?db._transaction(work):fail(503,'研究功能需要已验证的事务存储，当前环境尚未启用');
async function access(db,userId,researchId,write=false,lock=false){
 actor(userId);id(researchId);
 if(lock)await run(db,'UPDATE research_studies SET version=version WHERE id=?',researchId);
 const study=await first(db,'SELECT * FROM research_studies WHERE id=?',researchId);
 if(!study)fail(404,'研究不存在或无权访问');
 let role=Number(study.owner_user_id)===userId?'manager':null;
 if(!role&&study.visibility==='shared'){
  const member=await first(db,"SELECT role FROM research_members WHERE research_id=? AND user_id=? AND status='active'",researchId,userId);
  role=member?.role;
 }
 if(!role)fail(404,'研究不存在或无权访问');
 if(write&&role==='viewer')fail(403,'当前研究为只读');
 return {study,role};
}
async function round(db,researchId,runId){
 const row=await first(db,'SELECT * FROM research_runs WHERE research_id=? AND id=?',id(researchId),id(runId));
 if(!row)fail(404,'轮次不存在或不属于当前研究');
 return row;
}
const writable=(study,row,input)=>{
 if(study.status!=='active'||row.status!=='active')fail(409,'研究或轮次已停用，旧任务不能写入');
 if(!Number.isSafeInteger(input.epoch)||input.epoch!==Number(row.epoch))fail(409,'轮次已变更，请重新打开');
};
const view=async(db,row)=>({researchId:row.research_id,runId:row.id,version:Number(row.version),epoch:Number(row.epoch),ordinal:Number(row.ordinal),status:row.status,state:await readStoredState(db,row),storedObjects:storedObjectIds(row)});

// Execute inside the caller's transaction (including a worker lease transaction).
// The study lock fences restart/abandon/revoke until the consumer has committed.
// Never trust a userId carried in a browser token; use the authenticated actor.
export async function authorizeResearchTask(db,userId,input,{checkVersion=true}={}){
 expectedActor(userId,input);
 const {study,role}=await access(db,userId,input?.researchId,true,true);
 const row=await round(db,study.id,input.runId);
 writable(study,row,input);
 if(checkVersion&&(!Number.isSafeInteger(input.expectedVersion)||Number(row.version)!==input.expectedVersion))fail(409,'研究输入已有更新，请重新发起任务');
 return {study,role,run:await view(db,row)};
}

export async function createResearch(db,userId,input){
 expectedActor(userId,input);
 actor(userId);id(input.requestId);
 const title=String(input.title||'新研究').trim();
 if(!title||title.length>200)fail(400,'研究名称应为1至200字');
 // Formal links are server-resolved by the caller, never inferred from names.
 const formalProjectId=input.formalProjectId==null?null:id(input.formalProjectId);
 const hash=await researchHash({title,formalProjectId});
 return tx(db,async d=>{
  const researchId=key(),runId=key();
  const inserted=await run(d,"INSERT INTO research_studies(id,owner_user_id,title,visibility,formal_project_id,created_at,create_request,create_hash) VALUES(?,?,?,'private',?,?,?,?) ON CONFLICT(owner_user_id,create_request) DO NOTHING",researchId,userId,title,formalProjectId,Date.now(),input.requestId,hash);
  if(!inserted.meta.changes){
   const old=await first(d,'SELECT * FROM research_studies WHERE owner_user_id=? AND create_request=?',userId,input.requestId);
   if(old.create_hash!==hash)fail(409,'相同请求编号不能用于不同内容');
   const initial=await first(d,'SELECT * FROM research_runs WHERE research_id=? AND ordinal=1',old.id);
   return {researchId:old.id,runId:initial.id,replayed:true};
  }
  await run(d,'INSERT INTO research_runs(id,research_id,ordinal,created_at) VALUES(?,?,1,?)',runId,researchId,Date.now());
  await run(d,'INSERT INTO research_selections(research_id,user_id,run_id) VALUES(?,?,?)',researchId,userId,runId);
  return {researchId,runId,replayed:false};
 });
}

export async function readResearch(db,userId,researchId,runId,{metadataOnly=false}={}){
 return tx(db,async d=>{
  const {study,role}=await access(d,userId,researchId,false,true);
  let selected=runId;
  if(!selected)selected=(await first(d,'SELECT run_id FROM research_selections WHERE research_id=? AND user_id=?',researchId,userId))?.run_id;
  if(!selected)selected=(await first(d,'SELECT id FROM research_runs WHERE research_id=? ORDER BY ordinal DESC LIMIT 1',researchId))?.id;
  const row=await round(d,researchId,selected);
  const active=await first(d,'SELECT run_id,version FROM research_shared_active WHERE research_id=?',researchId);
  const resultRun=metadataOnly?{researchId:row.research_id,runId:row.id,version:Number(row.version),epoch:Number(row.epoch),status:row.status,ordinal:Number(row.ordinal)}:await view(d,row);
  return {userId,study:{researchId:study.id,title:study.title,visibility:study.visibility,formalProjectId:study.formal_project_id,status:study.status,version:Number(study.version),role},run:resultRun,sharedActive:active||null};
 });
}

export async function readResearchSlice(db,userId,input){
 expectedActor(userId,input);
 if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1||!Number.isSafeInteger(input.epoch)||input.epoch<1)fail(400,'按需读取必须指定轮次版本');
 if(!Array.isArray(input.path)||!input.path.length||input.path.length>20||input.path.some(k=>!(typeof k==='string'&&k.length<=200)&&!(Number.isSafeInteger(k)&&k>=0)))fail(400,'读取路径无效');
 return tx(db,async d=>{
  await access(d,userId,input.researchId,false,true);
  const row=await round(d,input.researchId,input.runId);
  if(Number(row.version)!==input.expectedVersion||Number(row.epoch)!==input.epoch)fail(409,'研究版本已变化，请重新读取；未覆盖当前内容');
  const slice=await readStoredSlice(d,row,input.path);
  return {storageView:'research-slice-v1',researchId:row.research_id,runId:row.id,version:Number(row.version),epoch:Number(row.epoch),path:input.path,...slice};
 });
}

export async function selectResearchRun(db,userId,input){
 expectedActor(userId,input);
 return tx(db,async d=>{
  await access(d,userId,input.researchId,false,true);
  await round(d,input.researchId,input.runId);
  await run(d,'INSERT INTO research_selections(research_id,user_id,run_id) VALUES(?,?,?) ON CONFLICT(research_id,user_id) DO UPDATE SET run_id=excluded.run_id',input.researchId,userId,input.runId);
  return {researchId:input.researchId,runId:input.runId};
 });
}
// Immutable uploads never advance the draft version. Commit only after all
// blocks are present, through the existing version-checked save transaction.
export async function stageResearchObjects(db,userId,input){
 expectedActor(userId,input);
 if(!Array.isArray(input.objects)||new TextEncoder().encode(JSON.stringify(input.objects)).length>RESEARCH_OBJECT_UPLOAD_REQUEST_MAX_BYTES)fail(413,'每批资料超过2MiB，请分批保存');
 return tx(db,async d=>{
  const {study}=await access(d,userId,input.researchId,true,true),row=await round(d,study.id,input.runId);
  writable(study,row,input);
  if(Number(row.version)!==input.expectedVersion)fail(409,'研究输入已有更新，请重新发起保存');
  await storeObjects(d,row,input.objects);
  const size=await first(d,'SELECT COALESCE(SUM(octet_length(content)),0) AS bytes FROM research_state_objects WHERE research_id=? AND run_id=?',study.id,row.id);
  if(Number(size.bytes)>RESEARCH_RUN_OBJECT_MAX_BYTES)fail(413,'本轮资料块存储已达256MiB，请将大附件放入资料库；原稿保留');
  return {uploaded:input.objects.map(entry=>entry[0])};
 });
}

// Step 3's sharing UI must use this transaction, not a direct membership UPDATE.
export async function updateResearchMember(db,userId,input){
 actor(input.userId);
 if(!['viewer','editor','manager'].includes(input.role)||!['active','revoked'].includes(input.status))fail(400,'成员角色或状态无效');
 return tx(db,async d=>{
  const {study,role}=await access(d,userId,input.researchId,true,true);
  if(role!=='manager'||study.visibility!=='shared')fail(403,'需要当前共享研究管理权限');
  if(study.status!=='active'||Number(study.version)!==input.expectedVersion)fail(409,'研究状态或权限版本已更新');
  if(Number(study.owner_user_id)===input.userId)fail(400,'不能通过成员表改变所有者');
  await run(d,'INSERT INTO research_members(research_id,user_id,role,status) VALUES(?,?,?,?) ON CONFLICT(research_id,user_id) DO UPDATE SET role=excluded.role,status=excluded.status,version=research_members.version+1',study.id,input.userId,input.role,input.status);
  await run(d,'UPDATE research_studies SET version=version+1 WHERE id=?',study.id);
  return {researchId:study.id,version:input.expectedVersion+1};
 });
}

export async function saveResearchRun(db,userId,input){
 expectedActor(userId,input);
 if(input.storageView==='research-slice-v1'||input.state?.storageView==='research-slice-v1')fail(400,'局部读取内容不能作为完整研究保存，原稿未修改');
 id(input.requestId);
 if(!input.packed&&(!input.state||typeof input.state!=='object'||Array.isArray(input.state)))fail(400,'研究状态必须为对象');
 let state=stable(input.packed||input.state);
 if(new TextEncoder().encode(state).length>RESEARCH_STATE_MAX_BYTES)fail(413,input.packed?'可研保存清单超过20MiB，请减少过多的零散字段；已分块正文不受此限制，原稿未修改':'未启用分块的可研草稿超过20MiB；原内容未删除，请启用分块存储后重试');
 if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)fail(400,'缺少有效轮次版本');
 const hash=await researchHash({state:input.packed||input.state,version:input.expectedVersion,epoch:input.epoch});
 return tx(db,async d=>{
  const {study}=await access(d,userId,input.researchId,true,true);
  const row=await round(d,input.researchId,input.runId);writable(study,row,input);
  const old=await first(d,'SELECT * FROM research_requests WHERE research_id=? AND run_id=? AND actor_id=? AND request_id=?',study.id,row.id,userId,input.requestId);
  if(old){if(old.payload_hash!==hash)fail(409,'相同请求编号不能用于不同内容');return {...parse(old.result_json),replayed:true};}
  if(Number(row.version)!==input.expectedVersion)fail(409,'已有更新，请重新加载后合并，未覆盖现有内容');
  if(input.packed){try{state=await storePackedState(d,row,input.packed);}catch(error){if(/草稿/.test(error.message))fail(400,error.message);throw error;}}
  const changed=await run(d,"UPDATE research_runs SET state_json=?,version=version+1 WHERE research_id=? AND id=? AND version=? AND epoch=? AND status='active'",state,study.id,row.id,input.expectedVersion,input.epoch);
  if(changed.meta.changes!==1)fail(409,'已有更新，请重新加载后合并，未覆盖现有内容');
  const result={researchId:study.id,runId:row.id,acceptedVersion:input.expectedVersion+1,epoch:input.epoch};
  await run(d,'INSERT INTO research_requests(research_id,run_id,actor_id,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?)',study.id,row.id,userId,input.requestId,hash,JSON.stringify(result),Date.now());
  return result;
 });
}

// All inheritance is explicit and fail-closed; unverified flags in client state confer no trust.
export async function researchInheritance(state,mode,verify){
 if(!['blank','verified'].includes(mode))fail(400,'未知重启模式');
 if(mode==='blank')return {};
 if(typeof verify!=='function')fail(503,'资料与事实继承需要权限及有效性复核');
 const next={materialRefs:[],confirmedFacts:[]};
 for(const ref of Array.isArray(state.materialRefs)?state.materialRefs:[]){
  const trusted=await verify('material',ref);if(trusted)next.materialRefs.push(trusted);
 }
 for(const fact of Array.isArray(state.confirmedFacts)?state.confirmedFacts:[]){
  const trusted=await verify('fact',fact);if(trusted)next.confirmedFacts.push(trusted);
 }
 return next;
}

// Internal foundation for step 3. Shared switching/abandonment stay unavailable until
// action-bound reauthentication is connected; no password-less fallback is exposed.
export async function restartResearch(db,userId,input,verify,authorize){
 expectedActor(userId,input);
 id(input.requestId);
 const hash=await researchHash({restart:input.mode,version:input.expectedVersion,epoch:input.epoch});
 return tx(db,async d=>{
  const {study,role}=await access(d,userId,input.researchId,true,true);
  if(study.visibility==='shared'){
   if(role!=='manager'||typeof authorize!=='function')fail(403,'共享轮次切换须使用管理员审核入口');
   await authorize({study,action:'restart',db:d});
  }
  const row=await round(d,study.id,input.runId);
  if(study.status!=='active')fail(409,'研究已停用');
  const old=await first(d,'SELECT * FROM research_requests WHERE research_id=? AND run_id=? AND actor_id=? AND request_id=?',study.id,row.id,userId,input.requestId);
  if(old){if(old.payload_hash!==hash)fail(409,'相同请求编号不能用于不同内容');return parse(old.result_json);}
  writable(study,row,input);
  if(Number(row.version)!==input.expectedVersion)fail(409,'轮次已更新');
  const inherited=await researchInheritance(await readStoredState(d,row),input.mode,verify);
  const latest=await first(d,'SELECT MAX(ordinal) AS n FROM research_runs WHERE research_id=?',study.id);
  const runId=key();
  await run(d,"UPDATE research_runs SET status='history',epoch=epoch+1 WHERE research_id=? AND id=?",study.id,row.id);
  await run(d,'INSERT INTO research_runs(id,research_id,ordinal,state_json,created_at) VALUES(?,?,?,?,?)',runId,study.id,Number(latest.n)+1,stable(inherited),Date.now());
  await run(d,'UPDATE research_selections SET run_id=? WHERE research_id=? AND user_id=?',runId,study.id,userId);
  await run(d,'UPDATE research_studies SET version=version+1 WHERE id=?',study.id);
  if(study.visibility==='shared')await run(d,'INSERT INTO research_shared_active(research_id,run_id) VALUES(?,?) ON CONFLICT(research_id) DO UPDATE SET run_id=excluded.run_id,version=research_shared_active.version+1',study.id,runId);
  const result={researchId:study.id,runId,version:1,epoch:1};
  await run(d,'INSERT INTO research_requests(research_id,run_id,actor_id,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?)',study.id,row.id,userId,input.requestId,hash,JSON.stringify(result),Date.now());
  return result;
 });
}

export const restartPrivateResearch=(db,userId,input,verify)=>restartResearch(db,userId,input,verify);

// Pagination exposes metadata only, never another user's draft or chat.
export async function listResearch(db,userId,{offset=0,status='active'}={}){
 actor(userId);
 if(!Number.isSafeInteger(offset)||offset<0||!['active','abandoned'].includes(status))fail(400,'列表参数无效');
 const rows=await db.prepare("SELECT s.id,s.title,s.visibility,s.formal_project_id,s.status,s.version,s.created_at,CASE WHEN s.owner_user_id=? THEN 'manager' ELSE (SELECT m.role FROM research_members m WHERE m.research_id=s.id AND m.user_id=? AND m.status='active') END AS role FROM research_studies s WHERE s.status=? AND (s.owner_user_id=? OR (s.visibility='shared' AND EXISTS (SELECT 1 FROM research_members m WHERE m.research_id=s.id AND m.user_id=? AND m.status='active'))) ORDER BY s.created_at DESC,s.id LIMIT 51 OFFSET ?").bind(userId,userId,status,userId,userId,offset).all();
 return {userId,items:rows.results.slice(0,50),nextOffset:rows.results.length>50?offset+50:null};
}

export async function listResearchRuns(db,userId,researchId){
 return tx(db,async d=>{
  await access(d,userId,researchId,false,true);
  const rows=await d.prepare('SELECT id,ordinal,status,version,epoch,created_at FROM research_runs WHERE research_id=? ORDER BY ordinal DESC').bind(researchId).all();
  return {researchId,items:rows.results};
 });
}

// Authorization callback is server-owned and runs under the same parent lock.
// Both abandoning and restoring invalidate every outstanding callback, including
// callbacks from a round that happens to be selected again after restoration.
export async function changeResearchStatus(db,userId,input,authorize){
 expectedActor(userId,input);
 if(!['abandon','restore'].includes(input.action))fail(400,'研究状态操作无效');
 id(input.requestId);
 if(typeof authorize!=='function')fail(403,'需要验证操作权限');
 const hash=await researchHash({action:input.action,version:input.expectedVersion});
 return tx(db,async d=>{
  const {study,role}=await access(d,userId,input.researchId,true,true);
  if(role!=='manager')fail(403,'需要研究管理权限');
  const row=await round(d,study.id,input.runId);
  await authorize({study,action:input.action,db:d});
  const old=await first(d,'SELECT * FROM research_requests WHERE research_id=? AND run_id=? AND actor_id=? AND request_id=?',study.id,row.id,userId,input.requestId);
  if(old){if(old.payload_hash!==hash)fail(409,'相同请求编号不能用于不同内容');return parse(old.result_json);}
  if(!Number.isSafeInteger(input.expectedVersion)||Number(study.version)!==input.expectedVersion)fail(409,'研究已更新，请刷新后重试');
  const from=input.action==='abandon'?'active':'abandoned',to=input.action==='abandon'?'abandoned':'active';
  if(study.status!==from)fail(409,'研究状态已改变，请刷新后重试');
  await run(d,'UPDATE research_studies SET status=?,version=version+1 WHERE id=?',to,study.id);
  await run(d,'UPDATE research_runs SET epoch=epoch+1 WHERE research_id=?',study.id);
  const result={researchId:study.id,status:to,version:input.expectedVersion+1};
  await run(d,'INSERT INTO research_requests(research_id,run_id,actor_id,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?)',study.id,row.id,userId,input.requestId,hash,JSON.stringify({...result,action:input.action}),Date.now());
  return {...result,action:input.action};
 });
}

export async function importLegacyResearch(db,userId,input){
 expectedActor(userId,input);
 actor(userId);id(input.legacyProjectId);
 return tx(db,async d=>{
  // Lock the source to serialize two import requests without changing its content.
  await run(d,'UPDATE aireport_project_sessions SET updated_at=updated_at WHERE user_id=? AND project_id=?',userId,input.legacyProjectId);
  const source=await first(d,'SELECT data FROM aireport_project_sessions WHERE user_id=? AND project_id=?',userId,input.legacyProjectId);
  if(!source)fail(404,'没有本人可导入的旧会话');
  const old=await first(d,'SELECT * FROM research_legacy_links WHERE user_id=? AND legacy_project_id=?',userId,input.legacyProjectId);
  if(old)return {researchId:old.research_id,runId:old.run_id,replayed:true};
  // Imported history is explicitly labelled; it is not a confirmed fact or formal project.
  const created=await createResearch(d,userId,{requestId:'legacy_'+input.legacyProjectId,title:input.title||'旧研究副本'});
  if(created.replayed)fail(409,'导入请求标识已被使用，未覆盖任何研究');
  // Caller snapshot is an editable private draft, never a published artifact or
  // verified reference. Keep the server-owned legacy source alongside it.
  const importedState={legacySnapshot:parse(source.data),requiresReview:true};
  if(input.draft&&typeof input.draft==='object'&&!Array.isArray(input.draft))importedState.draft=input.draft;
  if(new TextEncoder().encode(JSON.stringify(importedState)).length>RESEARCH_STATE_MAX_BYTES)fail(413,'旧可研导入包超过20MiB，请先在旧页面保存并启用分块迁移；原内容未删除');
  await run(d,'UPDATE research_runs SET state_json=? WHERE research_id=? AND id=?',JSON.stringify(importedState),created.researchId,created.runId);
  await run(d,'INSERT INTO research_legacy_links(user_id,legacy_project_id,research_id,run_id,source_hash,created_at) VALUES(?,?,?,?,?,?)',userId,input.legacyProjectId,created.researchId,created.runId,await researchHash(parse(source.data)),Date.now());
  return created;
 });
}
