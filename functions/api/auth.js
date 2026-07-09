// POST /api/auth  身份接口
// {action:"register", username, password, invite}  凭邀请码注册
// {action:"login",    username, password}          登录
import { hashPassword, randomHex, signToken, json } from "./_auth.js";

export async function onRequestPost(context){
  const { request, env } = context;
  if(!env.DB) return json({ok:false, error:"数据库未绑定：请在Pages设置中绑定D1数据库(变量名DB)"}, 500);
  if(!env.SESSION_SECRET) return json({ok:false, error:"缺少SESSION_SECRET环境变量"}, 500);

  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"请求格式有误"}, 400); }
  const action = body.action;
  const username = String(body.username||"").trim();
  const password = String(body.password||"");

  if(!/^[\w\u4e00-\u9fa5]{2,20}$/.test(username))
    return json({ok:false, error:"用户名需为2-20位中英文、数字或下划线"}, 400);
  if(password.length < 6)
    return json({ok:false, error:"密码至少6位"}, 400);

  if(action === "register"){
    if(!env.ACCESS_CODE || String(body.invite||"").trim() !== env.ACCESS_CODE)
      return json({ok:false, error:"邀请码错误，请向管理员索取"}, 403);
    const exist = await env.DB.prepare("SELECT id FROM users WHERE username=?").bind(username).first();
    if(exist) return json({ok:false, error:"该用户名已被注册"}, 409);
    const salt = randomHex(16);
    const hash = await hashPassword(password, salt);
    const r = await env.DB.prepare("INSERT INTO users(username, pass_hash, salt, created_at) VALUES(?,?,?,?)")
      .bind(username, hash, salt, Date.now()).run();
    const userId = r.meta.last_row_id;
    const token = await signToken(env, userId, username);
    return json({ok:true, token, username});
  }

  if(action === "login"){
    const u = await env.DB.prepare("SELECT id, pass_hash, salt FROM users WHERE username=?").bind(username).first();
    if(!u) return json({ok:false, error:"用户名或密码错误"}, 401);
    const hash = await hashPassword(password, u.salt);
    if(hash !== u.pass_hash) return json({ok:false, error:"用户名或密码错误"}, 401);
    const token = await signToken(env, u.id, username);
    return json({ok:true, token, username});
  }

  return json({ok:false, error:"未知操作"}, 400);
}
