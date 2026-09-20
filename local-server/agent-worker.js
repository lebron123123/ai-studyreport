import { claimAgentJob,heartbeatAgentJob,executeAgentJob,settleAgentJob,reauthorizeAgentJob } from "../functions/api/_agent-enterprise.js";

export function startAgentWorker(env,opt={}){
  const workerId="local-"+process.pid+"-"+Math.random().toString(36).slice(2,8),pollMs=Math.max(500,Number(opt.pollMs)||1500),leaseMs=Math.max(10000,Number(opt.leaseMs)||45000);let busy=false,stopped=false,timer=null,activeController=null;
  const stopController=new AbortController();
  async function tick(){
    if(stopped||busy)return;busy=true;let job=null,heartbeat=null;
    try{
      const execute=async()=>{
      if(stopped)return;
      job=await claimAgentJob(env,workerId,leaseMs);if(!job)return;
      const controller=new AbortController();activeController=controller;job.abortSignal=controller.signal;
      if(stopped)controller.abort();
      heartbeat=setInterval(()=>heartbeatAgentJob(env,job.id,workerId,leaseMs,job.attempts).then(ok=>{if(!ok){clearInterval(heartbeat);controller.abort();console.error('[agent-worker] 租约失效，已停止请求并拒绝迟到成果');}}).catch(()=>{clearInterval(heartbeat);controller.abort();console.error('[agent-worker] 续租失败，已停止请求；外部费用可能仍需对账');}),Math.floor(leaseMs/3));
      const auth=await reauthorizeAgentJob(env,job);if(!auth.ok)throw new Error(auth.error);await executeAgentJob(env,job);await settleAgentJob(env,job,true);
      };
      // Acquire process-wide generation capacity BEFORE claiming a durable job.
      // Waiting for capacity must not spend an attempt or let a job lease expire.
      if(opt.admission)await opt.admission.run(execute,{signal:stopController.signal});
      else await execute();
    }
    catch(e){if(job)await settleAgentJob(env,job,false,e&&e.message||e);if(job||![429,499,503].includes(e?.status))console.error("[agent-worker]",e&&e.message||e);}
    finally{if(heartbeat)clearInterval(heartbeat);activeController=null;busy=false;}
  }
  timer=setInterval(()=>tick().catch(()=>{}),pollMs);timer.unref&&timer.unref();tick().catch(()=>{});
  return {workerId,stop(){stopped=true;if(timer)clearInterval(timer);stopController.abort();activeController?.abort();}};
}
