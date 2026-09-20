import {ensureInvestmentWatch,claimInvestmentWatch,executeInvestmentWatch} from '../functions/api/_investment-watch.js';
import {verifyInvestmentScenario} from '../functions/api/_investment-ops-service.js';
import {ensureInvestmentTables} from '../functions/api/investmentops.js';
import {ensureStep4,tickStep4} from '../functions/api/_investment-step4.js';
export async function startInvestmentWorker(env){
 await ensureInvestmentTables(env);await ensureInvestmentWatch(env);await ensureStep4(env);let busy=false,stopped=false,step4Busy=false;
 async function tick(){if(busy||stopped)return;busy=true;try{for(let i=0;i<10&&!stopped;i++){const job=await claimInvestmentWatch(env);if(!job)break;try{await executeInvestmentWatch(env,job,{verifyScenario:verifyInvestmentScenario});}catch{console.error('[investment-worker] 检查失败，覆盖标为未知并保留旧风险，等待重试');}}}catch{console.error('[investment-worker] 无法领取检查，待下轮重试');}finally{busy=false;}}
 const scan=async()=>{if(stopped||step4Busy)return;step4Busy=true;try{await tickStep4(env);}catch{console.error('[investment-worker] 后评价检查暂不可用，下轮重试');}finally{step4Busy=false;}};
 const step4Timer=setInterval(scan,60000);step4Timer.unref();void scan();
 const timer=setInterval(tick,5000);timer.unref();void tick();return {stop(){stopped=true;clearInterval(timer);clearInterval(step4Timer);}};
}
