import { verifyAuth,json } from "./_auth.js";
import { adaptEnv } from "./_adapters.js";
import { claimAgentJob,reauthorizeAgentJob,executeAgentJob,settleAgentJob } from "./_agent-enterprise.js";

function permitted(env,request,user){const secret=String(request.headers.get("x-agent-worker-secret")||"");if(env.AGENT_WORKER_SECRET&&secret===env.AGENT_WORKER_SECRET)return true;const admins=String(env.ADMIN_USERS||"").split(",").map(x=>x.trim());return !!user&&(admins.includes(user.username)||admins.includes(String(user.userId)))&&(!env.ADMIN_PASS||request.headers.get("x-admin-pass")===env.ADMIN_PASS);}
export async function onRequestPost(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);if(!permitted(env,context.request,user))return json({ok:false,error:"无Worker执行权限"},403);
  const workerId="api-"+Date.now();const job=await claimAgentJob(env,workerId,45000);if(!job)return json({ok:true,processed:false});
  try{const auth=await reauthorizeAgentJob(env,job);if(!auth.ok)throw new Error(auth.error);const output=await executeAgentJob(env,job);await settleAgentJob(env,job,true);return json({ok:true,processed:true,jobId:job.id,output});}
  catch(e){const status=await settleAgentJob(env,job,false,e.message||e);return json({ok:false,processed:true,jobId:job.id,status,error:e.message||String(e)},500);}
}
