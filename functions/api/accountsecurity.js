import {verifyAuth,json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {changeAccountSecurity,accountSecurity} from './_account-security.js';
import {ensureAgentRuntime} from './_agent-runtime.js';
import {ensureAgentEnterprise} from './_agent-enterprise.js';
export async function onRequestPost(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:'未登录'},401);
  try{
    const b=await context.request.json(),target=Number(b.userId||user.userId);
    const admin=String(env.ADMIN_USERS||'').split(',').map(x=>x.trim()).some(x=>x===user.username||x===String(user.userId));
    if(!(b.action==='revoke'&&target===user.userId)&&(!admin||(env.ADMIN_PASS&&context.request.headers.get('x-admin-pass')!==env.ADMIN_PASS)))return json({ok:false,error:'仅管理员可管理其他账号'},403);
    if(target===user.userId&&b.action==='disable')return json({ok:false,error:'不能停用当前管理账号'},409);
    await ensureAgentRuntime(env);await ensureAgentEnterprise(env);
    return json({ok:true,result:await changeAccountSecurity(env,user.userId,target,b.action,b.note)});
  }catch(e){return json({ok:false,error:e.message},409);}
}
export async function onRequestGet(context){const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!user)return json({ok:false,error:'未登录'},401);return json({ok:true,userId:user.userId,state:await accountSecurity(env,user.userId)});}
