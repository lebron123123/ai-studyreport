// One project-role decision shared by the workspace, report storage and tasks.
// A removed member must never regain access through a legacy task grant.
export function projectRolePermissions(role) {
  return {view:['OWNER','EDITOR','VIEWER'].includes(role),edit:['OWNER','EDITOR'].includes(role),manage:role==='OWNER'};
}

export async function ensureProjectMemberships(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS project_memberships (project_id TEXT NOT NULL,user_id INTEGER NOT NULL,role TEXT NOT NULL DEFAULT 'VIEWER',status TEXT NOT NULL DEFAULT 'active',created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,PRIMARY KEY(project_id,user_id))").run();
}

export async function resolveProjectAccess(env,userId,projectId) {
  const row=await env.DB.prepare('SELECT id,name,data,updated_at,user_id FROM projects WHERE id=?').bind(projectId).first();
  if(!row)return null;
  if(Number(row.user_id)===Number(userId))return {row,role:'OWNER',ownerUserId:Number(row.user_id),permissions:projectRolePermissions('OWNER')};
  await ensureProjectMemberships(env);
  const member=await env.DB.prepare('SELECT * FROM project_memberships WHERE project_id=? AND user_id=?').bind(projectId,userId).first();
  const role=member?.status==='active'?String(member.role).toUpperCase():'';
  const permissions=projectRolePermissions(role);
  return permissions.view?{row,member,role,ownerUserId:Number(row.user_id),permissions}:null;
}
