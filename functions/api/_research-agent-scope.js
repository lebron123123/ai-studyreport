import {authorizeResearchTask, ResearchError} from './_research-store.js';
import {resolveProjectAccess} from './_project-access.js';

export function researchScopeFromRun(run){
  try{return JSON.parse(run?.input_json||'{}').research||null;}catch{return null;}
}

export async function requireResearchAgentScope(env,userId,scope,{checkVersion=false}={}){
  if(env.RESEARCH_IDENTITY_ENABLED!=='1'||!env.DB)throw new ResearchError(503,'研究轮次功能尚未启用');
  const access=await authorizeResearchTask(env.DB,userId,scope,{checkVersion});
  if(access.study.formal_project_id){
    const project=await resolveProjectAccess(env,userId,access.study.formal_project_id);
    if(!project?.permissions?.view)throw new ResearchError(403,'关联正式项目的访问权限已变化');
  }
  return access;
}
