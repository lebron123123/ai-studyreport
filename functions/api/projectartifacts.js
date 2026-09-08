import {verifyAuth,json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {resolveProjectAccess} from './_project-access.js';
export async function ensureProjectArtifacts(env){await env.DB.prepare('CREATE TABLE IF NOT EXISTS report_source_artifacts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,content_hash TEXT NOT NULL,storage_key TEXT NOT NULL,file_name TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes BIGINT NOT NULL,created_at BIGINT NOT NULL)').run();}
export async function onRequestPost(c){
  const env=adaptEnv(c.env),user=await verifyAuth(c.request,env);if(!user)return json({ok:false,error:'未登录'},401);
  try{
    const url=new URL(c.request.url),projectId=url.searchParams.get('projectId'),access=await resolveProjectAccess(env,user.userId,projectId);if(!access?.permissions.edit)return json({ok:false,error:'无项目编辑权限'},403);
    if(!env.RAG_OBJECTS?.putStream||!env.DB._transaction)throw new Error('服务器未配置流式对象存储');
    await ensureProjectArtifacts(env);
    const object=await env.RAG_OBJECTS.putStream({stream:c.request.body,fileName:url.searchParams.get('name')||'原件',mimeType:c.request.headers.get('content-type')||'application/octet-stream'});
    // Upload may take minutes: recheck membership under the same project lock as revocation.
    return await env.DB._transaction(async DB=>{
      await DB.prepare('SELECT id FROM projects WHERE id=? FOR UPDATE').bind(projectId).first();
      if(!await verifyAuth(c.request,{...env,DB}))throw new Error('上传期间登录已撤销；未建立项目文件引用');
      if(!(await resolveProjectAccess({...env,DB},user.userId,projectId))?.permissions.edit)throw new Error('上传期间权限已撤销；未建立项目文件引用');
      const id=crypto.randomUUID();await DB.prepare('INSERT INTO report_source_artifacts(id,project_id,user_id,content_hash,storage_key,file_name,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,projectId,user.userId,object.contentHash,object.storageKey,object.fileName,object.mimeType,object.sizeBytes,Date.now()).run();
      return json({ok:true,artifact:{id,contentHash:object.contentHash,sizeBytes:object.sizeBytes}});
    });
  }catch(e){return json({ok:false,error:e.message},409);}
}
export async function onRequestGet(c){
  const env=adaptEnv(c.env),user=await verifyAuth(c.request,env);if(!user)return json({ok:false,error:'未登录'},401);
  const projectId=new URL(c.request.url).searchParams.get('projectId');if(!(await resolveProjectAccess(env,user.userId,projectId))?.permissions.view)return json({ok:false,error:'无项目权限'},403);
  await ensureProjectArtifacts(env);
  const id=new URL(c.request.url).searchParams.get('id');
  if(id){
    const row=await env.DB.prepare('SELECT * FROM report_source_artifacts WHERE project_id=? AND id=?').bind(projectId,id).first();
    if(!row)return json({ok:false,error:'原件不存在'},404);
    try{
      const object=await env.RAG_OBJECTS.openStream(row.storage_key);
      return new Response(object.body,{headers:{'content-type':'application/octet-stream','content-length':String(object.sizeBytes),'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(row.file_name),'cache-control':'no-store','x-content-type-options':'nosniff'}});
    }catch{return json({ok:false,error:'原件读取失败，请检查服务器存储或备份'},503);}
  }
  return json({ok:true,items:(await env.DB.prepare('SELECT id,content_hash,file_name,mime_type,size_bytes,created_at FROM report_source_artifacts WHERE project_id=? ORDER BY created_at DESC LIMIT 100').bind(projectId).all()).results||[]});
}
