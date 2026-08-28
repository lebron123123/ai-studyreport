import { ensureAgentEnterprise } from "./_agent-enterprise.js";

const PERM_RANK={read:1,write:2,approve:3,admin:4};
export async function resolveAgentPrincipal(env,user){
  await ensureAgentEnterprise(env);
  let row=null;
  try{ row=await env.DB.prepare("SELECT department,clearance FROM users WHERE id=?").bind(user.userId).first(); }catch(_){ }
  return {userId:Number(user.userId),username:String(user.username||""),department:String(row&&row.department||""),clearance:Math.max(1,Number(row&&row.clearance)||1)};
}

export async function authorizeAgentAction(env,principal,req={}){
  const projectId=String(req.projectId||""), action=String(req.action||"read"), level=Math.max(1,Number(req.securityLevel)||1);
  if(level>principal.clearance) return {ok:false,reason:"资料密级超过当前用户权限"};
  if(!projectId) return {ok:true,scope:"personal"};
  const owned=await env.DB.prepare("SELECT id FROM projects WHERE id=? AND user_id=?").bind(projectId,principal.userId).first();
  if(owned) return {ok:true,scope:"owner"};
  const grant=await env.DB.prepare("SELECT * FROM agent_project_access WHERE user_id=? AND project_id=?").bind(principal.userId,projectId).first();
  if(!grant) return {ok:false,reason:"无该项目访问授权"};
  if(grant.department&&principal.department&&grant.department!==principal.department) return {ok:false,reason:"项目仅限指定部门使用"};
  if(level>(Number(grant.max_security_level)||1)) return {ok:false,reason:"项目授权密级不足"};
  if((PERM_RANK[grant.permission]||0)<(PERM_RANK[action]||1)) return {ok:false,reason:"项目授权不包含本次操作"};
  return {ok:true,scope:"grant",permission:grant.permission};
}

