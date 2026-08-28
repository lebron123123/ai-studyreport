import { verifyAuth, json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
import { ensureAgentRuntime,agentId,agentJson,parseAgentJson } from "./_agent-runtime.js";
import { ensureAgentEnterprise } from "./_agent-enterprise.js";

function isAdmin(env,user,request){
  const xs=String(env.ADMIN_USERS||"").split(",").map(x=>x.trim());
  return (xs.includes(user.username)||xs.includes(String(user.userId))) && (!env.ADMIN_PASS||request.headers.get("x-admin-pass")===env.ADMIN_PASS);
}
export async function onRequestGet(context){
  const env=adaptEnv(context.env), user=await verifyAuth(context.request,env);
  if(!user) return json({ok:false,error:"未登录"},401); await ensureAgentRuntime(env);await ensureAgentEnterprise(env);
  const u=new URL(context.request.url), all=u.searchParams.get("scope")==="admin"&&isAdmin(env,user,context.request);
  const rows=all
    ? await env.DB.prepare("SELECT * FROM agent_skill_candidates ORDER BY updated_at DESC LIMIT 100").all()
    : await env.DB.prepare("SELECT * FROM agent_skill_candidates WHERE user_id=? OR status='published' ORDER BY updated_at DESC LIMIT 100").bind(user.userId).all();
  const releases=await env.DB.prepare("SELECT * FROM agent_skill_releases").all();
  return json({ok:true,skills:rows.results||[],releases:releases.results||[]});
}
export function evaluateCandidate(row,cases){
  const evidence=parseAgentJson(row.evidence_json,[]),checks=[
    {id:"instruction",ok:String(row.instruction_md||"").trim().length>=80,weight:35,note:"技能说明不少于80字"},
    {id:"description",ok:String(row.description||"").trim().length>=20,weight:15,note:"用途与边界说明不少于20字"},
    {id:"evidence",ok:Array.isArray(evidence)&&evidence.length>0,weight:20,note:"至少有一条来源证据"},
    {id:"cases",ok:Array.isArray(cases)&&cases.length>=2,weight:30,note:"至少两个评测用例"},
  ];
  const score=checks.reduce((n,x)=>n+(x.ok?x.weight:0),0);return {passed:score>=80,score,checks};
}
export async function onRequestPost(context){
  const env=adaptEnv(context.env), user=await verifyAuth(context.request,env);
  if(!user) return json({ok:false,error:"未登录"},401); await ensureAgentRuntime(env);await ensureAgentEnterprise(env);
  let b={}; try{b=await context.request.json();}catch(e){return json({ok:false,error:"格式有误"},400);}
  if(b.action==="candidateCreate"){
    const name=String(b.name||"").trim(); if(!name) return json({ok:false,error:"技能名称不能为空"},400);
    const id=agentId("skill"), now=Date.now();
    await env.DB.prepare("INSERT INTO agent_skill_candidates(id,user_id,name,scene,description,instruction_md,source_run_id,evidence_json,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id,user.userId,name.slice(0,100),String(b.scene||"general").slice(0,50),String(b.description||"").slice(0,1000),String(b.instruction||"").slice(0,20000),String(b.sourceRunId||"").slice(0,100),agentJson(b.evidence||[],10000),"candidate",1,now,now).run();
    await env.DB.prepare("INSERT INTO agent_skill_versions(id,skill_id,version,instruction_md,evidence_json,status,created_by,created_at) VALUES(?,?,?,?,?,'draft',?,?)")
      .bind(agentId("skillv"),id,1,String(b.instruction||"").slice(0,30000),agentJson(b.evidence||[],15000),user.userId,now).run();
    return json({ok:true,id,status:"candidate"});
  }
  const id=String(b.id||""),row=id?await env.DB.prepare("SELECT * FROM agent_skill_candidates WHERE id=?").bind(id).first():null;
  if(["evaluate","versionCreate"].includes(b.action)&&(!row||Number(row.user_id)!==Number(user.userId)))return json({ok:false,error:"技能不存在或无权操作"},404);
  if(b.action==="versionCreate"){
    const last=await env.DB.prepare("SELECT MAX(version) version FROM agent_skill_versions WHERE skill_id=?").bind(id).first(),version=(Number(last&&last.version)||0)+1,now=Date.now();
    await env.DB.prepare("INSERT INTO agent_skill_versions(id,skill_id,version,instruction_md,evidence_json,status,created_by,created_at) VALUES(?,?,?,?,?,'draft',?,?)")
      .bind(agentId("skillv"),id,version,String(b.instruction||row.instruction_md||"").slice(0,30000),agentJson(b.evidence||parseAgentJson(row.evidence_json,[]),15000),user.userId,now).run();
    return json({ok:true,version,status:"draft"});
  }
  if(b.action==="evaluate"){
    let version=Number(b.version)||Number(row.version)||1,source={...row};const vr=await env.DB.prepare("SELECT * FROM agent_skill_versions WHERE skill_id=? AND version=?").bind(id,version).first();if(vr)source={...row,instruction_md:vr.instruction_md,evidence_json:vr.evidence_json};
    const result=evaluateCandidate(source,b.cases||[]),now=Date.now();
    await env.DB.prepare("INSERT INTO agent_skill_evals(id,skill_id,version,passed,score,cases_json,result_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(agentId("eval"),id,version,result.passed?1:0,result.score,agentJson(b.cases||[],15000),agentJson(result,10000),user.userId,now).run();
    await env.DB.prepare("UPDATE agent_skill_versions SET eval_json=? WHERE skill_id=? AND version=?").bind(agentJson(result,10000),id,version).run();
    return json({ok:true,version,...result});
  }
  if(b.action==="publish"){
    if(!isAdmin(env,user,context.request))return json({ok:false,error:"仅管理员可发布技能"},403);if(!row)return json({ok:false,error:"技能不存在"},404);
    const version=Number(b.version)||Number(row.version)||1,ev=await env.DB.prepare("SELECT * FROM agent_skill_evals WHERE skill_id=? AND version=? ORDER BY created_at DESC LIMIT 1").bind(id,version).first();
    if(!ev||Number(ev.passed)!==1)return json({ok:false,error:"该版本尚未通过评测，不能发布"},409);
    const old=await env.DB.prepare("SELECT active_version FROM agent_skill_releases WHERE skill_id=?").bind(id).first(),now=Date.now();
    await env.DB.prepare("INSERT INTO agent_skill_releases(skill_id,active_version,previous_version,published_by,published_at) VALUES(?,?,?,?,?) ON CONFLICT(skill_id) DO UPDATE SET previous_version=agent_skill_releases.active_version,active_version=excluded.active_version,published_by=excluded.published_by,published_at=excluded.published_at")
      .bind(id,version,Number(old&&old.active_version)||0,user.username,now).run();
    await env.DB.prepare("UPDATE agent_skill_candidates SET status='published',version=?,reviewed_by=?,review_note=?,updated_at=? WHERE id=?").bind(version,user.username,String(b.note||"评测通过后发布"),now,id).run();
    await env.DB.prepare("UPDATE agent_skill_versions SET status=CASE WHEN version=? THEN 'published' ELSE status END WHERE skill_id=?").bind(version,id).run();return json({ok:true,status:"published",version});
  }
  if(b.action==="rollback"){
    if(!isAdmin(env,user,context.request))return json({ok:false,error:"仅管理员可回滚技能"},403);const rel=await env.DB.prepare("SELECT * FROM agent_skill_releases WHERE skill_id=?").bind(id).first();if(!rel||!rel.previous_version)return json({ok:false,error:"没有可回滚的上一版本"},409);
    await env.DB.prepare("UPDATE agent_skill_releases SET active_version=?,previous_version=?,published_by=?,published_at=? WHERE skill_id=?").bind(rel.previous_version,rel.active_version,user.username,Date.now(),id).run();
    await env.DB.prepare("UPDATE agent_skill_candidates SET version=?,reviewed_by=?,review_note=?,updated_at=? WHERE id=?").bind(rel.previous_version,user.username,String(b.note||"回滚到上一版本"),Date.now(),id).run();return json({ok:true,status:"rolled_back",version:rel.previous_version});
  }
  if(["approve","reject"].includes(b.action)){
    if(!isAdmin(env,user,context.request)) return json({ok:false,error:"仅管理员可审核技能"},403);
    const status=b.action==="approve"?"reviewed":"rejected";
    await env.DB.prepare("UPDATE agent_skill_candidates SET status=?,reviewed_by=?,review_note=?,updated_at=? WHERE id=?")
      .bind(status,user.username,String(b.note||"").slice(0,1000),Date.now(),String(b.id||"")).run();
    return json({ok:true,status,note:b.action==="approve"?"已通过人工初审；仍需评测通过后发布":""});
  }
  return json({ok:false,error:"未知操作"},400);
}
