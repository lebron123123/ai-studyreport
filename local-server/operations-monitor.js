import {ensureOperations,operationsSnapshot,observeOperations,dispatchOperations} from '../functions/api/_operations-monitor.js';
export async function startOperationsMonitor(env){
  await ensureOperations(env);
  if(String(env.OPERATIONS_MONITOR_ENABLED)==='false')return {stop(){},enabled:false};
  let busy=false,stopped=false;
  async function tick(){if(busy||stopped)return;busy=true;try{await observeOperations(env,await operationsSnapshot(env));await dispatchOperations(env);}catch{console.error('[operations] 自动监控失败，请检查数据库或告警配置');}finally{busy=false;}}
  const timer=setInterval(tick,Math.max(10000,Number(env.OPERATIONS_MONITOR_INTERVAL_MS)||60000));timer.unref();void tick();
  return {enabled:true,stop(){stopped=true;clearInterval(timer);}};
}
