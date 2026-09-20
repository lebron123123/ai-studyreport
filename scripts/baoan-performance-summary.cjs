const fs=require('node:fs');
const file=process.argv[2];if(!file)throw Error('Provide a benchmark JSON path');
const r=JSON.parse(fs.readFileSync(file));
const percentile=(a,p)=>{a=[...a].sort((x,y)=>x-y);return a.length?a[Math.floor((a.length-1)*p)]:null;};
let before=0;const active=[],idle=[],near=[],far=[];
for(const s of r.samples){const elapsed=s.elapsed-before;
 // Exclude windows crossing move/idle boundaries instead of counting idle as slow rendering.
 if(Math.floor(before/30)===Math.floor(s.elapsed/30)){const fps=s.windowFrames/elapsed;(s.mode==='move'?active:idle).push(fps);if(s.mode==='move'&&Number.isFinite(s.altitude))(s.altitude>8000?far:near).push(fps);}
 before=s.elapsed;
}
const mib=x=>Math.round(x/1048576*100)/100;
const values=key=>r.samples.map(s=>s[key]).filter(x=>Number.isFinite(x)&&x>0);
const range=key=>{const a=values(key);return a.length?{firstMiB:mib(a[0]),lastMiB:mib(a.at(-1)),minMiB:mib(Math.min(...a)),maxMiB:mib(Math.max(...a)),samples:a.length}:null;};
const fpsSummary=a=>({p05:percentile(a,.05),median:percentile(a,.5),p95:percentile(a,.95),windows:a.length});
const memoryByFiveMinutes=[];for(let i=0;i<Math.ceil(r.durationSeconds/300);i++){const a=r.samples.filter(s=>Math.floor(s.elapsed/300)===i&&Number.isFinite(s.browserWorkingSetBytes));memoryByFiveMinutes.push({fromMinute:i*5,toMinute:(i+1)*5,medianMiB:a.length?mib(percentile(a.map(s=>s.browserWorkingSetBytes),.5)):null});}
console.log(JSON.stringify({label:r.label,durationSeconds:r.durationSeconds,firstReadyMs:r.firstReadyMs,sceneReadyMs:r.sceneReadyMs,activeFps:fpsSummary(active),nearFps:fpsSummary(near),farFps:fpsSummary(far),idleFpsMedian:percentile(idle,.5),heap:range('heapBytes'),modelResources:range('tilesBytes'),browserWorkingSet:range('browserWorkingSetBytes'),memoryByFiveMinutes,errors:r.errors},null,2));
