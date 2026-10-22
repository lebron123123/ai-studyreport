import { claimAgentJob,heartbeatAgentJob,executeAgentJob,settleAgentJob,reauthorizeAgentJob } from "../functions/api/_agent-enterprise.js";

export function startAgentWorker(env,opt={}){
  const workerId="local-"+process.pid+"-"+Math.random().toString(36).slice(2,8),pollMs=Math.max(500,Number(opt.pollMs)||1500),leaseMs=Math.max(10000,Number(opt.leaseMs)||45000);
  const concurrency=agentWorkerConcurrency(opt.concurrency??opt.admission?.stats().concurrency),lanes=Array.from({length:concurrency},()=>({busy:false,controller:null}));
  let stopped=false,timer=null;
  const stopController=new AbortController();
  async function tick(lane){
    if(stopped||lane.busy)return;lane.busy=true;let job=null,heartbeat=null;
    try{
      const execute=async()=>{
      if(stopped)return;
      job=await claimAgentJob(env,workerId,leaseMs);if(!job)return;
      const controller=new AbortController();lane.controller=controller;job.abortSignal=controller.signal;
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
    finally{if(heartbeat)clearInterval(heartbeat);lane.controller=null;lane.busy=false;}
  }
  const poll=()=>{for(const lane of lanes)tick(lane).catch(()=>{});};
  timer=setInterval(poll,pollMs);timer.unref&&timer.unref();poll();
  return {workerId,concurrency,stop(){stopped=true;if(timer)clearInterval(timer);stopController.abort();for(const lane of lanes)lane.controller?.abort();}};
}

export function agentWorkerConcurrency(value){
  const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?Math.max(1,Math.min(6,Math.floor(parsed))):4;
}
