import {resolveProjectAccess,ensureProjectMemberships} from './_project-access.js';
import {ensureAgentRuntime} from './_agent-runtime.js';
import {ensureAgentEnterprise} from './_agent-enterprise.js';

// Membership change and revocation of queued/running work commit together.
export async function changeProjectMember(env,actorId,projectId,targetId,role,remove=false){
  if(!Number.isSafeInteger(targetId)||targetId<=0||(!remove&&!['OWNER','EDITOR','VIEWER'].includes(role)))return {ok:false,status:400,error:'成员或角色无效'};
  if(!env.DB._transaction)return {ok:false,status:503,error:'当前数据库尚不支持原子权限变更，请联系管理员使用本地或服务器 PostgreSQL 部署'};
  await ensureProjectMemberships(env);await ensureAgentRuntime(env);await ensureAgentEnterprise(env);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS project_events (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id INTEGER NOT NULL,event_type TEXT NOT NULL,actor TEXT DEFAULT '',payload_json TEXT NOT NULL DEFAULT '{}',created_at BIGINT NOT NULL)").run();
  return env.DB._transaction(async DB=>{
    await DB.prepare('SELECT id FROM projects WHERE id=? FOR UPDATE').bind(projectId).first();
    const access=await resolveProjectAccess({...env,DB},actorId,projectId);
    if(!access?.permissions.manage)return {ok:false,status:403,error:'仅项目所有者可管理成员'};
    if(targetId===access.ownerUserId&&(remove||role!=='OWNER'))return {ok:false,status:400,error:'不能移除或降级项目创建者'};
    const target=await DB.prepare('SELECT id FROM users WHERE id=?').bind(targetId).first();
    if(!target)return {ok:false,status:404,error:'该用户不存在，请核对用户 ID'};
    const now=Date.now();
    if(remove)await DB.prepare("UPDATE project_memberships SET status='inactive',updated_at=? WHERE project_id=? AND user_id=?").bind(now,projectId,targetId).run();
    else await DB.prepare("INSERT INTO project_memberships(project_id,user_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role,status='active',updated_at=excluded.updated_at").bind(projectId,targetId,role,'active',now,now).run();
    await DB.prepare('UPDATE projects SET updated_at=? WHERE id=?').bind(Math.max(now,Number(access.row.updated_at)+1),projectId).run();
    if(remove||role==='VIEWER'){
      await DB.prepare("UPDATE agent_jobs SET status='cancelled',lease_owner='',lease_expires_at=0,error_text='项目编辑权限已撤销',updated_at=? WHERE user_id=? AND status IN ('queued','retry','running') AND run_id IN (SELECT id FROM agent_runs WHERE project_id=? AND user_id=?)").bind(now,targetId,projectId,targetId).run();
      await DB.prepare("UPDATE agent_runs SET status='cancelled',error_text='项目编辑权限已撤销',updated_at=?,completed_at=? WHERE user_id=? AND project_id=? AND status IN ('running','queued','paused','waiting_approval')").bind(now,now,targetId,projectId).run();
    }
    // Audit failure rolls back the permission change, rather than disappearing.
    await DB.prepare('INSERT INTO project_events(id,project_id,user_id,event_type,payload_json,created_at) VALUES(?,?,?,?,?,?)').bind('member-'+crypto.randomUUID(),projectId,actorId,remove?'project.member.removed':'project.member.updated',JSON.stringify({userId:targetId,role:remove?null:role}),now).run();
    return {ok:true,userId:targetId,role:remove?null:role};
  });
}
