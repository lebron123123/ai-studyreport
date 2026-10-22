// Durable receipt around the existing single-attempt generator; never changes formal projects.
import {verifyAuth,json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {onRequestPost as generate} from './generate.js';
import {importBinding,importRequestId,findImportRequest,claimImportRequest,importReceipt,settleImportRequest,markImportUnknown} from './_report-import-request.js';

function response(value,status=200) {const r=json(value,status);r.headers.set('Cache-Control','no-store');return r;}
function caught(error) {return response({error:error.status?error.message:'请求回执存储暂不可用；请保留工作稿并只回查结果，不要重复生成',code:error.code||'STORAGE',retry_allowed:false},error.status||503);}
function generationBody(value,id) {
  // Only the imported-draft text contract enters generate; no tools, project or alternate providers.
  if (!value || value.single_attempt !== true || value.request_id !== id || value.stream !== false
    || value.kind !== 'batch' || value.latency_profile !== 'standard' || value.max_tokens !== 4000
    || value.response_format?.type !== 'json_object' || typeof value.system !== 'string' || value.system.length > 8000
    || !Array.isArray(value.messages) || value.messages.length !== 1 || value.messages[0]?.role !== 'user'
    || typeof value.messages[0]?.content !== 'string' || value.messages[0].content.length > 64000
    || Object.keys(value).some(k=>!['single_attempt','request_id','stream','kind','latency_profile','max_tokens','response_format','system','messages'].includes(k))) {
    throw Object.assign(new Error('局部候选请求格式无效；未调用模型'),{status:400,code:'INVALID'});
  }
  return value;
}
export async function onRequestGet(context) {
  try {
    const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);
    if (!user) return response({error:'请先登录后回查候选',code:'AUTH'},401);
    const params=new URL(context.request.url).searchParams;
    if (!params.has('id')) return response({capabilities:{durable_import_request_protocol:1,single_attempt:true,single_attempt_protocol:1}});
    const id=importRequestId(params.get('id')),binding=importBinding({draftId:params.get('draftId'),sourceHash:params.get('sourceHash'),contextHash:params.get('contextHash')});
    let row;
    try {row=await findImportRequest(env,user.userId,id,binding);}
    catch(error){if(error.code!=='42P01'&&!/no such table: report_import_requests/i.test(error.message||''))throw error;}
    if (!row) return response({error:'此账号下没有对应持久回执；旧版请求或未送达请求不能自动补发，请先核对结果与费用',code:'NOT_FOUND',retry_allowed:false},404);
    return response(importReceipt(row));
  } catch(error) {return caught(error);}
}
export async function onRequestPost(context) {
  try {
    const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);
    if (!user) return response({error:'请先登录后生成候选',code:'AUTH'},401);
    let body;try {body=await context.request.json();}catch{return response({error:'请求格式无效；未调用模型',code:'INVALID'},400);}
    const id=importRequestId(body?.request_id),binding=importBinding(body?.binding),generation=generationBody(body?.generation,id);
    const {claimed,row}=await claimImportRequest(env,user.userId,id,binding,generation);
    if (!claimed) return response(importReceipt(row),row.status==='running'?202:200);
    // Deliberately do not inherit the browser's abort signal. There is one bounded upstream
    // attempt, and its response must be saved even when the HTTP response is lost.
    const independent=new Request(context.request.url,{method:'POST',headers:context.request.headers,body:JSON.stringify(generation)});
    const work=(async()=>{
      try {await settleImportRequest(env,user.userId,id,await generate({...context,request:independent,env}));}
      catch {await markImportUnknown(env,user.userId,id);}
    })();
    if(typeof context.waitUntil==='function')context.waitUntil(work);
    await work;
    const current=await verifyAuth(context.request,env);
    if(!current||current.userId!==user.userId)return response({error:'登录状态已变化，结果保存在原账号下；请登录原账号只回查结果',code:'AUTH_CHANGED',retry_allowed:false},401);
    return response(importReceipt(await findImportRequest(env,user.userId,id,binding)));
  } catch(error) {return caught(error);}
}
