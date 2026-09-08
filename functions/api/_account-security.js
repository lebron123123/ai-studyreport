const ready=new WeakSet();
export async function ensureAccountSecurity(env){
  if(!env.DB||ready.has(env.DB))return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS account_security (user_id INTEGER PRIMARY KEY,disabled INTEGER NOT NULL DEFAULT 0,revoked_before BIGINT NOT NULL DEFAULT 0,updated_at BIGINT NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS security_events (id TEXT PRIMARY KEY,actor_id INTEGER NOT NULL,target_id INTEGER NOT NULL,action TEXT NOT NULL,note TEXT NOT NULL,created_at BIGINT NOT NULL)").run();
  ready.add(env.DB);
}
export async function accountSecurity(env,userId){
  await ensureAccountSecurity(env);
  return env.DB?await env.DB.prepare('SELECT disabled,revoked_before FROM account_security WHERE user_id=?').bind(userId).first():null;
}
export async function changeAccountSecurity(env,actorId,targetId,action,note){
  if(!['revoke','disable','enable'].includes(action)||!Number.isSafeInteger(targetId)||targetId<=0||!String(note||'').trim())throw new Error('需要有效账号、操作及原因');
  if(!env.DB?._transaction)throw new Error('账号安全变更需要事务数据库');
  await ensureAccountSecurity(env);
  return env.DB._transaction(async DB=>{
    const user=await DB.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').bind(targetId).first();if(!user)throw new Error('账号不存在');
    const old=await DB.prepare('SELECT disabled,revoked_before FROM account_security WHERE user_id=?').bind(targetId).first();
    const now=Math.max(Date.now(),Number(old?.revoked_before||0)+1),disabled=action==='disable'?1:action==='enable'?0:Number(old?.disabled||0);
    await DB.prepare('INSERT INTO account_security(user_id,disabled,revoked_before,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET disabled=excluded.disabled,revoked_before=excluded.revoked_before,updated_at=excluded.updated_at').bind(targetId,disabled,now,now).run();
    await DB.prepare("UPDATE agent_jobs SET status='cancelled',lease_owner='',lease_expires_at=0,error_text='账号已停用或登录已撤销',updated_at=? WHERE user_id=? AND status IN ('queued','retry','running')").bind(now,targetId).run();
    await DB.prepare("UPDATE agent_runs SET status='cancelled',error_text='账号已停用或登录已撤销',updated_at=?,completed_at=? WHERE user_id=? AND status IN ('running','queued','paused','waiting_approval')").bind(now,now,targetId).run();
    await DB.prepare('INSERT INTO security_events(id,actor_id,target_id,action,note,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actorId,targetId,action,String(note).slice(0,1000),now).run();
    return {userId:targetId,disabled:!!disabled,revokedBefore:now};
  });
}
