// Bounded in-process observations; intentionally not a substitute for external monitoring.
export function createRuntimeMetrics(){
  const started=Date.now(),durations=[];let requests=0,failures=0,inflight=0;
  return {begin(){requests++;inflight++;const at=performance.now();let ended=false;return status=>{if(ended)return;ended=true;inflight--;if(status>=500)failures++;durations.push(performance.now()-at);if(durations.length>1000)durations.shift();};},snapshot(){const sorted=[...durations].sort((a,b)=>a-b);return {startedAt:started,requests,failures,inflight,sampleCount:sorted.length,p95Ms:sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:null,rssBytes:process.memoryUsage().rss,uptimeSeconds:process.uptime()};}};
}
