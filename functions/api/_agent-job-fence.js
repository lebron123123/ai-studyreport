// attempts is the monotonically increasing lease generation; owner alone is not sufficient.
export class AgentLeaseLostError extends Error {
  constructor(){super('任务已取消、租约已失效或被其他执行器接管；未写入迟到成果');this.name='AgentLeaseLostError';}
}
export async function withAgentJobLease(env,job,work){
  if(job.abortSignal?.aborted)throw new AgentLeaseLostError();
  const transactional=typeof env.DB._transaction==='function';
  const guarded=async DB=>{
    const row=await DB.prepare('SELECT * FROM agent_jobs WHERE id=?'+(transactional?' FOR UPDATE':'')).bind(job.id).first();
    if(!row||row.status!=='running'||row.lease_owner!==job.lease_owner||Number(row.attempts)!==Number(job.attempts)||Number(row.lease_expires_at)<=Date.now())throw new AgentLeaseLostError();
    return work({...env,DB});
  };
  // Legacy D1 keeps its preflight check. Only the PostgreSQL path provides atomic fencing.
  return transactional?env.DB._transaction(guarded):guarded(env.DB);
}

export function agentJobFetch(job){
  return (url,options={})=>{
    if(job.abortSignal?.aborted)throw new AgentLeaseLostError();
    const signals=[options.signal,job.abortSignal].filter(Boolean);
    return fetch(url,{...options,...(signals.length?{signal:AbortSignal.any(signals)}:{})});
  };
}
