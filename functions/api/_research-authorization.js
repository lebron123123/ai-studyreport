import {hashPassword} from './_auth.js';
import {ResearchError} from './_research-store.js';

// Reserve an attempt in its own committed transaction, so a rejected password
// cannot roll back the limiter. No password or credential is stored or logged.
export async function researchAuthorizer(env,user,password,now=Date.now()){
 if(typeof password!=='string'||!password||password.length>1024)throw new ResearchError(400,'请输入本人登录密码');
 const allowed=await env.DB._transaction(async db=>{
  await db.prepare('INSERT INTO research_auth_attempts(user_id,window_start,attempts) VALUES(?,?,0) ON CONFLICT(user_id) DO NOTHING').bind(user.userId,now).run();
  await db.prepare('UPDATE research_auth_attempts SET attempts=attempts WHERE user_id=?').bind(user.userId).run();
  const row=await db.prepare('SELECT window_start,attempts FROM research_auth_attempts WHERE user_id=?').bind(user.userId).first();
  const reset=now-Number(row.window_start)>=60000;
  if(!reset&&Number(row.attempts)>=5)return false;
  await db.prepare('UPDATE research_auth_attempts SET window_start=?,attempts=? WHERE user_id=?').bind(reset?now:Number(row.window_start),reset?1:Number(row.attempts)+1,user.userId).run();
  return true;
 });
 if(!allowed)throw new ResearchError(429,'安全验证过于频繁，请一分钟后重试');
 const credential=await env.DB.prepare('SELECT pass_hash,salt FROM users WHERE id=?').bind(user.userId).first();
 if(!credential||await hashPassword(password,credential.salt)!==credential.pass_hash)throw new ResearchError(403,'本人登录密码不正确');
 const admins=String(env.ADMIN_USERS||'').split(',').map(x=>x.trim()).filter(Boolean);
 return async({study,db})=>{
  // Check current credential again under the mutation transaction. A concurrent
// password change invalidates this in-memory proof; proof never reaches client.
  const current=await db.prepare('SELECT pass_hash,salt FROM users WHERE id=?').bind(user.userId).first();
  if(!current||current.pass_hash!==credential.pass_hash||current.salt!==credential.salt)throw new ResearchError(403,'登录凭据已更新，请重新验证');
  if(study.visibility==='shared'&&!admins.includes(String(user.userId))&&!admins.includes(user.username))throw new ResearchError(403,'共享研究操作需要管理员权限');
  if(study.visibility==='private'&&Number(study.owner_user_id)!==user.userId)throw new ResearchError(403,'只能操作本人私人研究');
 };
}
