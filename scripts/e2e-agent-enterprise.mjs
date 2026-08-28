import http from "node:http";
import { createD1Shim } from "../local-server/d1-shim.js";
import { ensureAgentRuntime,createAgentRun } from "../functions/api/_agent-runtime.js";
import { ensureAgentEnterprise,upsertRunGovernance,enqueueAgentJob } from "../functions/api/_agent-enterprise.js";
import { startAgentWorker } from "../local-server/agent-worker.js";

const connectionString=process.env.DATABASE_URL;if(!connectionString)throw new Error("缺少DATABASE_URL");
const db=createD1Shim(connectionString);let server,worker,rootId="";
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
  await ensureAgentRuntime({DB:db});await ensureAgentEnterprise({DB:db});const user=await db.prepare("SELECT id,username,department,clearance FROM users ORDER BY id LIMIT 1").first();if(!user)throw new Error("没有可用于测试的本地用户");
  server=http.createServer(async(req,res)=>{let raw="";for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||"{}");const last=(body.messages||[]).at(-1);res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({choices:[{message:{role:"assistant",content:"[系统测试]已处理："+String(last&&last.content||"").slice(0,40)}}],usage:{prompt_tokens:40,completion_tokens:12}}));});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const port=server.address().port;
  const env={DB:db,LLM_DEFAULT_PROVIDER:"deepseek",COMPANY_DEEPSEEK_API_URL:`http://127.0.0.1:${port}/v1/chat/completions`,COMPANY_DEEPSEEK_API_KEY:"system-test",COMPANY_DEEPSEEK_MODEL:"system-test-model"};
  const root=(await createAgentRun(env,user.id,{agentType:"orchestrator",query:"[系统测试]后台多Agent续跑"})).run;rootId=root.id;
  await upsertRunGovernance(env,user.id,root.id,{department:user.department,securityLevel:1,executionMode:"server",budgetInputTokens:1000,budgetOutputTokens:1000});
  const job=await enqueueAgentJob(env,user.id,root.id,{kind:"multi_agent",maxAttempts:2,payload:{tasks:[{role:"research",query:"核查资料"},{role:"review",query:"复核结论"}],synthesisSystem:"合并结果",securityLevel:1}});
  worker=startAgentWorker(env,{pollMs:500,leaseMs:10000});let state;
  for(let i=0;i<30;i++){state=await db.prepare("SELECT * FROM agent_jobs WHERE id=?").bind(job.id).first();if(state&&state.status==="completed")break;await wait(250);}
  if(!state||state.status!=="completed")throw new Error("后台Worker未在时限内完成："+(state&&state.status));
  const run=await db.prepare("SELECT * FROM agent_runs WHERE id=?").bind(root.id).first(),children=await db.prepare("SELECT COUNT(*) cnt FROM agent_run_governance WHERE parent_run_id=?").bind(root.id).first(),usage=await db.prepare("SELECT SUM(input_tokens) input_tokens,SUM(output_tokens) output_tokens FROM agent_run_usage WHERE run_id=? OR run_id IN (SELECT run_id FROM agent_run_governance WHERE root_run_id=?)").bind(root.id,root.id).first(),cp=await db.prepare("SELECT COUNT(*) cnt FROM agent_checkpoints WHERE run_id=?").bind(root.id).first();
  if(run.status!=="completed"||Number(children.cnt)!==2||Number(usage.input_tokens)!==120||Number(usage.output_tokens)!==36||Number(cp.cnt)<1)throw new Error("后台续跑勾稽失败");
  console.log(JSON.stringify({ok:true,job:state.status,run:run.status,children:Number(children.cnt),inputTokens:Number(usage.input_tokens),outputTokens:Number(usage.output_tokens),checkpoints:Number(cp.cnt)}));
}finally{
  if(worker)worker.stop();if(server)await new Promise(resolve=>server.close(resolve));
  if(rootId){const rows=await db.prepare("SELECT run_id FROM agent_run_governance WHERE root_run_id=? OR run_id=?").bind(rootId,rootId).all(),ids=[...new Set((rows.results||[]).map(x=>x.run_id).concat(rootId))];for(const id of ids){await db.prepare("DELETE FROM agent_run_usage WHERE run_id=?").bind(id).run();await db.prepare("DELETE FROM agent_run_steps WHERE run_id=?").bind(id).run();await db.prepare("DELETE FROM agent_checkpoints WHERE run_id=?").bind(id).run();await db.prepare("DELETE FROM agent_approvals WHERE run_id=?").bind(id).run();await db.prepare("DELETE FROM agent_jobs WHERE run_id=?").bind(id).run();await db.prepare("DELETE FROM agent_run_governance WHERE run_id=?").bind(id).run();await db.prepare("DELETE FROM agent_runs WHERE id=?").bind(id).run();}}
  await db._close();
}
