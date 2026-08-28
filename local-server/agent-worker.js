import { claimAgentJob,heartbeatAgentJob,executeAgentJob,settleAgentJob,reauthorizeAgentJob } from "../functions/api/_agent-enterprise.js";

export function startAgentWorker(env,opt={}){
  const workerId="local-"+process.pid+"-"+Math.random().toString(36).slice(2,8),pollMs=Math.max(500,Number(opt.pollMs)||1500),leaseMs=Math.max(10000,Number(opt.leaseMs)||45000);let busy=false,stopped=false,timer=null;
  async function tick(){
    if(stopped||busy)return;busy=true;let job=null,heartbeat=null;
    try{job=await claimAgentJob(env,workerId,leaseMs);if(!job)return;heartbeat=setInterval(()=>heartbeatAgentJob(env,job.id,workerId,leaseMs).catch(()=>{}),Math.floor(leaseMs/3));const auth=await reauthorizeAgentJob(env,job);if(!auth.ok)throw new Error(auth.error);await executeAgentJob(env,job);await settleAgentJob(env,job,true);}
    catch(e){if(job)await settleAgentJob(env,job,false,e&&e.message||e);console.error("[agent-worker]",e&&e.message||e);}
    finally{if(heartbeat)clearInterval(heartbeat);busy=false;}
  }
  timer=setInterval(()=>tick().catch(()=>{}),pollMs);timer.unref&&timer.unref();tick().catch(()=>{});
  return {workerId,stop(){stopped=true;if(timer)clearInterval(timer);}};
}
