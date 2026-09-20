import {verifyAuth,json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {resolveProjectAccess} from './_project-access.js';
import {ResearchError,RESEARCH_STATE_MAX_BYTES,createResearch,readResearch,selectResearchRun,saveResearchRun,importLegacyResearch,listResearch,listResearchRuns,restartResearch,changeResearchStatus} from './_research-store.js';
import {researchAuthorizer} from './_research-authorization.js';
import {researchMaterialVerifier} from './researchmaterials.js';
import {stageResearchObjects} from './_research-store.js';
import {readResearchSlice} from './_research-store.js';
import {RESEARCH_STORAGE_CAPABILITIES} from '../../research-storage-policy.mjs';

async function handle({request,env},write){
 try{
  env=adaptEnv(env);
  const user=await verifyAuth(request,env);
  if(!user)return json({ok:false,error:'请先登录'},401);
  // Only the locally verified transactional adapter can enable the foundation.
  if(env.RESEARCH_IDENTITY_ENABLED!=='1'||typeof env.DB?._transaction!=='function')return json({ok:false,error:'研究轮次功能尚未启用，原有研究不受影响'},503);
  if(!write){
   const url=new URL(request.url);
   if(url.searchParams.get('action')==='slice'){
    let path;try{path=JSON.parse(url.searchParams.get('path'));}catch{return json({ok:false,error:'读取路径无效'},400);}
    return json({ok:true,...await readResearchSlice(env.DB,user.userId,{researchId:url.searchParams.get('researchId'),runId:url.searchParams.get('runId'),expectedVersion:Number(url.searchParams.get('version')),epoch:Number(url.searchParams.get('epoch')),path})});
   }
   if(url.searchParams.get('action')==='list')return json({ok:true,...await listResearch(env.DB,user.userId,{offset:Number(url.searchParams.get('offset')||0),status:url.searchParams.get('status')||'active'})});
   if(url.searchParams.get('action')==='rounds')return json({ok:true,...await listResearchRuns(env.DB,user.userId,url.searchParams.get('researchId'))});
   const enabled=env.RESEARCH_STORAGE_V2==='1';
   return json({ok:true,storageProtocol:enabled?RESEARCH_STORAGE_CAPABILITIES.protocol:null,storageUploadBatchBytes:enabled?RESEARCH_STORAGE_CAPABILITIES.uploadBatchBytes:0,storageLogicalStateBytes:enabled?RESEARCH_STORAGE_CAPABILITIES.logicalStateBytes:RESEARCH_STATE_MAX_BYTES,storageRunObjectBytes:enabled?RESEARCH_STORAGE_CAPABILITIES.runObjectBytes:0,...await readResearch(env.DB,user.userId,url.searchParams.get('researchId'),url.searchParams.get('runId'),{metadataOnly:url.searchParams.get('action')==='authority'})});
  }
  const text=await request.text();
  if(new TextEncoder().encode(text).length>RESEARCH_STATE_MAX_BYTES+100000)return json({ok:false,error:'单次可研请求超过20MiB；项目总容量已支持128MiB，请使用分块保存，原内容未修改'},413);
  let input;try{input=JSON.parse(text);}catch{return json({ok:false,error:'请求格式错误'},400);}
  if(!input||typeof input!=='object'||Array.isArray(input))return json({ok:false,error:'请求格式错误'},400);
  if((input.packed||input.action==='stageObjects')&&env.RESEARCH_STORAGE_V2!=='1')return json({ok:false,error:'分块存储尚未启用，请保留当前内容并刷新后重试'},503);
  let result;
  if(input.action==='create'){
   if(input.formalProjectId){
    const allowed=await resolveProjectAccess(env,user.userId,input.formalProjectId);
    if(!allowed)return json({ok:false,error:'无权关联该项目'},403);
   }
   result=await createResearch(env.DB,user.userId,input);
  }else if(input.action==='stageObjects')result=await stageResearchObjects(env.DB,user.userId,input);
  else if(input.action==='save')result=await saveResearchRun(env.DB,user.userId,input);
  else if(input.action==='select')result=await selectResearchRun(env.DB,user.userId,input);
  else if(input.action==='importLegacy')result=await importLegacyResearch(env.DB,user.userId,input);
  else if(input.action==='restart'){
   const current=await readResearch(env.DB,user.userId,input.researchId,input.runId);
   const authorize=current.study.visibility==='shared'?await researchAuthorizer(env,user,input.password):undefined;
   result=await restartResearch(env.DB,user.userId,input,researchMaterialVerifier(env,user.userId,input.researchId),authorize);
  }else if(input.action==='abandon'||input.action==='restore'){
   await readResearch(env.DB,user.userId,input.researchId,input.runId);
   const authorize=await researchAuthorizer(env,user,input.password);
   result=await changeResearchStatus(env.DB,user.userId,input,authorize);
  }
  else return json({ok:false,error:'不支持的研究操作'},400);
  return json({ok:true,...result});
 }catch(error){
  if(error instanceof ResearchError)return json({ok:false,error:error.message},error.status);
  // Do not expose SQL, connection strings or private state in errors.
  return json({ok:false,error:'研究操作未完成，请保留当前内容并重试；持续失败请联系管理员'},500);
 }
}
export const onRequestGet=context=>handle(context,false);
export const onRequestPost=context=>handle(context,true);
