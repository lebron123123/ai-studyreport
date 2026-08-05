// /api/officechat  AI办公助手·云端对话记忆（需登录，每人一份，覆盖式保存）
// GET    读取当前用户保存的办公助手对话
// POST   {chat:[{role,content,...}]} 保存（服务端二次截断兜底，防止异常客户端把数据无限撑大）
// DELETE 清空当前用户的办公助手对话（"清空对话"按钮用）
import { verifyAuth, json } from "./_auth.js";

import { adaptEnv } from "./_adapters.js";
const MAX_MESSAGES = 30; // 服务端兜底上限（约15轮问答）；客户端也做同样截断，这里是双保险

export async function onRequestGet(context){
  const { request } = context;
  const env = adaptEnv(context.env);   // 云端原样返回，行为零变化；本地才切到本地实现
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  const row = await env.DB.prepare("SELECT chat, updated_at FROM office_chats WHERE user_id=?")
    .bind(user.userId).first();
  if(!row) return json({ok:true, chat:[], updated_at:0});
  let chat = [];
  try{ chat = JSON.parse(row.chat) || []; }catch(e){ chat = []; }
  return json({ok:true, chat, updated_at: row.updated_at});
}

export async function onRequestPost(context){
  const { request } = context;
  const env = adaptEnv(context.env);   // 云端原样返回，行为零变化；本地才切到本地实现
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  let body;
  try{ body = await request.json(); }catch(e){ return json({ok:false, error:"请求格式有误"}, 400); }
  let chat = Array.isArray(body.chat) ? body.chat : [];
  if(chat.length > MAX_MESSAGES) chat = chat.slice(-MAX_MESSAGES);
  const dataStr = JSON.stringify(chat);
  if(dataStr.length > 300000) return json({ok:false, error:"对话内容过大，无法保存，请先清空对话"}, 413);

  const exist = await env.DB.prepare("SELECT user_id FROM office_chats WHERE user_id=?").bind(user.userId).first();
  if(exist){
    await env.DB.prepare("UPDATE office_chats SET chat=?, updated_at=? WHERE user_id=?")
      .bind(dataStr, Date.now(), user.userId).run();
  }else{
    await env.DB.prepare("INSERT INTO office_chats(user_id, chat, updated_at) VALUES(?,?,?)")
      .bind(user.userId, dataStr, Date.now()).run();
  }
  return json({ok:true});
}

export async function onRequestDelete(context){
  const { request } = context;
  const env = adaptEnv(context.env);   // 云端原样返回，行为零变化；本地才切到本地实现
  const user = await verifyAuth(request, env);
  if(!user) return json({ok:false, error:"未登录或登录已过期"}, 401);
  await env.DB.prepare("DELETE FROM office_chats WHERE user_id=?").bind(user.userId).run();
  return json({ok:true});
}
