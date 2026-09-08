// Invoked only by the isolated recovery drill, never a production worker entry point.
import {createD1Shim} from '../local-server/d1-shim.js';
import {claimAgentJob,executeAgentJob,settleAgentJob} from '../functions/api/_agent-enterprise.js';
const url=new URL(process.env.RECOVERY_DATABASE_URL||'');
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/^\/studyreport_restore_\d+$/.test(url.pathname)||!/^\-c search_path=recovery_[a-f0-9]+$/.test(url.searchParams.get('options')||''))throw new Error('拒绝非隔离演练目标');
const DB=createD1Shim(url.toString()),env={DB,DEEPSEEK_API_KEY:'synthetic-only',DEEPSEEK_API_URL:'http://fixture.invalid/chat/completions'};
try{
  const job=await claimAgentJob(env,'drill-'+process.pid,1500);
  if(!job){process.send?.({event:'empty'});}else{
    process.send?.({event:'claimed',job});
    if(process.env.RECOVERY_MODE==='before-call')await new Promise(()=>{setInterval(()=>{},1000);});
    globalThis.fetch=async()=>{
      process.send?.({event:'model-started'});
      if(process.env.RECOVERY_MODE==='during-call')await new Promise(()=>{setInterval(()=>{},1000);});
      return new Response(JSON.stringify({choices:[{message:{content:'[系统测试]恢复完成'}}],usage:{prompt_tokens:5,completion_tokens:5}}),{headers:{'content-type':'application/json'}});
    };
    try{await executeAgentJob(env,job);await settleAgentJob(env,job,true);}catch(e){await settleAgentJob(env,job,false,e.message);}
  }
}finally{await DB._close();process.disconnect?.();}
