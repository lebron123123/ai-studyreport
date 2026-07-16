// /api/adminpass  管理员二次密码校验 
import { verifyAuth, json } from "./_auth.js";

function isAdmin(env, user){
  const admins = (env.ADMIN_USERS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return admins.includes(user.username) || admins.includes(String(user.userId));
}

export async function onRequestPost(context){
  const { request, env } = context;
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录"}, 401);
  if(!isAdmin(env, user)) return json({ok:false, error:"非管理员账号"}, 403);
  if(!env.ADMIN_PASS) return json({ok:true, disabled:true});   // 未配置则不启用二次密码
  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"格式有误"}, 400); }
  if(String(body.pass||"") !== env.ADMIN_PASS) return json({ok:false, error:"管理员密码错误"}, 403);
  return json({ok:true});
}
