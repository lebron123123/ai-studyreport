import {verifyAuth,json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {ensureOperations,readOperations} from './_operations-monitor.js';
async function handle(c,post){
  const env=adaptEnv(c.env),user=await verifyAuth(c.request,env);if(!user)return json({ok:false,error:'未登录'},401);
  if(!String(env.ADMIN_USERS||'').split(',').map(s=>s.trim()).some(s=>s===user.username||s===String(user.userId))||(env.ADMIN_PASS&&c.request.headers.get('x-admin-pass')!==env.ADMIN_PASS))return json({ok:false,error:'需要管理员验证'},403);
  try{
    await ensureOperations(env);
    const jobs=(await env.DB.prepare('SELECT status,COUNT(*) AS count,MIN(created_at) AS oldest FROM agent_jobs GROUP BY status').all()).results||[];
    const uncertain=Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_call_ledger WHERE status IN ('usage_unknown','outcome_unknown')").first()).n);
    const overdue=Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_jobs WHERE status='running' AND lease_expires_at<?").bind(Date.now()).first()).n);
    const result={observedAt:Date.now(),jobs,uncertainCalls:uncertain,expiredLeases:overdue,runtime:env.RUNTIME_METRICS?.snapshot?.()||null,alerts:[...(uncertain?[{key:'billing',count:uncertain}]:[]),...(overdue?[{key:'expired_lease',count:overdue}]:[])],monitor:await readOperations(env),continuousMonitoringVerified:false};
    if(post){
      if(!env.OPERATIONS_ALERT_URL)throw new Error('尚未配置告警接收地址，不能声称已送达');
      const url=new URL(env.OPERATIONS_ALERT_URL);if(url.protocol!=='https:')throw new Error('告警地址必须使用HTTPS');
      const response=await fetch(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(result),signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error('告警接收端未确认，请检查接收服务');
      result.alertReceipt={httpStatus:response.status,receivedAt:Date.now(),humanReadVerified:false};
    }
    return json({ok:true,result});
  }catch(e){return json({ok:false,error:e.name==='TimeoutError'?'告警接收超时，请重试':e.message},409);}
}
export const onRequestGet=c=>handle(c,false);
export const onRequestPost=c=>handle(c,true);
