import {verifyAuth,json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {ResearchError,readResearch,authorizeResearchTask,researchHash} from './_research-store.js';

const fail=(status,message)=>{throw new ResearchError(status,message);};
const safeId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(x);
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();

// These immutable receipts live in the additive research transaction journal, not
// editable state_json. A browser-supplied path or "verified" flag grants no access.
async function trustedReceipt(db,researchId,ref){
 if(!ref||!safeId(ref.runId)||!/^material_[a-f0-9]{64}$/.test(ref.fileId||'')||!Number.isSafeInteger(Number(ref.actorId))||Number(ref.actorId)<1)return null;
 const row=await first(db,'SELECT result_json FROM research_requests WHERE research_id=? AND run_id=? AND request_id=? AND actor_id=?',researchId,ref.runId,ref.fileId,Number(ref.actorId));
 if(!row)return null;
 let data;try{data=JSON.parse(row.result_json);}catch{return null;}
 return data?.kind==='research.original.v1'&&data.materialRef?.researchId===researchId?data:null;
}

export function researchMaterialVerifier(env,userId,researchId){
 return async(kind,ref)=>{
  // Formal facts need their own authorized facts resolver; never trust draft facts.
  if(kind!=='material')return null;
  // restartResearch has already locked and authorized this study. Do not start
  // another locking transaction here: it would deadlock against that fence.
  const data=await trustedReceipt(env.DB,researchId,ref);
  if(!data||!env.RAG_OBJECTS?.verify)return null;
  // Exact metadata and digest come from the server receipt (not ref).
  const verified=await env.RAG_OBJECTS.verify(data.object.storageKey,data.object.contentHash);
  return verified.ok&&verified.sizeBytes===data.object.sizeBytes?data.materialRef:null;
 };
}

export async function storeResearchOriginal(env,userId,input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'请求格式错误');
 if(!env.RAG_OBJECTS?.put||!env.RAG_OBJECTS?.verify)fail(503,'未配置研究原件存储，请联系管理员；本次未标记上传成功');
 const name=String(input.name||'source.bin').replace(/[\x00-\x1f]/g,'').slice(0,220),mimeType=String(input.mimeType||'application/octet-stream').slice(0,120),base64=String(input.dataBase64||'');
 if(!base64||base64.length>70*1024*1024||base64.length%4||/[^A-Za-z0-9+/=]/.test(base64)||/=/.test(base64.slice(0,-2))||!/[A-Za-z0-9+/](?:[A-Za-z0-9+/]|=)(?:[A-Za-z0-9+/]|=)$/.test(base64))fail(400,'原件为空、格式错误或超过50MB');
 const binary=atob(base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 if(!bytes.length||bytes.length>50*1024*1024)fail(413,'单个原件不能超过50MB');
 // Hold the study fence through object verification and receipt commit. File work
// does not depend on report autosave revision, but still must match the epoch.
 return env.DB._transaction(async db=>{
  const current=await readResearch(db,userId,input.researchId,input.runId);
  const allowed=await authorizeResearchTask(db,userId,{...input,expectedVersion:current.run.version});
  const namespace='research/'+allowed.study.owner_user_id+'/'+input.researchId+'/'+input.runId;
  const object=await env.RAG_OBJECTS.put({bytes,fileName:name,mimeType,namespace});
  if(!object.storageKey.startsWith(namespace+'/'))fail(503,'当前对象存储不支持研究隔离，未确认上传成功');
  const verified=await env.RAG_OBJECTS.verify(object.storageKey,object.contentHash);
  if(!verified.ok||verified.sizeBytes!==bytes.length)fail(500,'原件校验不一致，未确认上传成功');
  const hash=await researchHash({contentHash:object.contentHash,name,mimeType}),fileId='material_'+hash;
  const materialRef={researchId:input.researchId,runId:input.runId,fileId,actorId:userId,name,contentHash:object.contentHash};
  const result={kind:'research.original.v1',ok:true,stored:true,object,fileId,version:1,materialRef};
  await db.prepare('INSERT INTO research_requests(research_id,run_id,actor_id,request_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(research_id,run_id,actor_id,request_id) DO NOTHING').bind(input.researchId,input.runId,userId,fileId,hash,JSON.stringify(result),Date.now()).run();
  const saved=await trustedReceipt(db,input.researchId,materialRef);
  if(!saved)fail(409,'原件回执冲突，请联系管理员');
  return saved;
 });
}

async function handle({request,env},write){
 try{
  env=adaptEnv(env);const user=await verifyAuth(request,env);if(!user)return json({ok:false,error:'请先登录'},401);
  if(env.RESEARCH_IDENTITY_ENABLED!=='1'||!env.DB?._transaction)return json({ok:false,error:'研究功能尚未启用'},503);
  if(write){const raw=await request.text();if(raw.length>71*1024*1024)fail(413,'原件请求过大');let input;try{input=JSON.parse(raw);}catch{fail(400,'请求格式错误');}return json(await storeResearchOriginal(env,user.userId,input));}
  const q=new URL(request.url).searchParams,researchId=q.get('researchId'),ref={runId:q.get('runId'),fileId:q.get('fileId'),actorId:Number(q.get('actorId'))};
  await readResearch(env.DB,user.userId,researchId,ref.runId);
  const data=await trustedReceipt(env.DB,researchId,ref);if(!data)fail(404,'原件不存在或无权访问');
  const verified=await env.RAG_OBJECTS.verify(data.object.storageKey,data.object.contentHash);if(!verified.ok||verified.sizeBytes!==data.object.sizeBytes)fail(409,'原件校验失败，请联系管理员');
  const object=await env.RAG_OBJECTS.openStream(data.object.storageKey);
  return new Response(object.body,{headers:{'content-type':'application/octet-stream','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(data.object.fileName),'cache-control':'no-store','x-content-type-options':'nosniff'}});
 }catch(e){return json({ok:false,error:e instanceof ResearchError?e.message:'研究原件操作失败，请保留文件并重试'},e instanceof ResearchError?e.status:500);}
}
export const onRequestPost=c=>handle(c,true);
export const onRequestGet=c=>handle(c,false);
