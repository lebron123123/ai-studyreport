import {verifyAuth,json} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {ensureAgentBudget,reconcileAgentCall} from './_agent-budget.js';
async function handle(c,post){
  const env=adaptEnv(c.env),user=await verifyAuth(c.request,env);if(!user)return json({ok:false,error:'未登录'},401);
  const admin=String(env.ADMIN_USERS||'').split(',').map(s=>s.trim()).some(s=>s===user.username||s===String(user.userId));
  if(!admin||(env.ADMIN_PASS&&c.request.headers.get('x-admin-pass')!==env.ADMIN_PASS))return json({ok:false,error:'需要管理员验证'},403);
  try{await ensureAgentBudget(env);if(post){const b=await c.request.json();return json({ok:true,result:await reconcileAgentCall(env,user.userId,String(b.id||''),b)});}
    return json({ok:true,items:(await env.DB.prepare("SELECT id,run_id,user_id,status,provider,model,reserved_input,reserved_output,actual_input,actual_output,actual_cost,updated_at FROM agent_call_ledger WHERE status IN ('usage_unknown','outcome_unknown') OR (status='settled' AND actual_cost IS NULL) ORDER BY updated_at LIMIT 100").all()).results||[]});
  }catch(e){return json({ok:false,error:e.message},409);}
}
export const onRequestPost=c=>handle(c,true);
export const onRequestGet=c=>handle(c,false);
