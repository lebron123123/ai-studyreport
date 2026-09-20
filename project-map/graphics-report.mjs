// Acceptance analysis must distinguish wall time from observed active time.
export function analyzeGraphicsReport(report,{requiredMs=3600000,maxGapMs=30000}={}){
 const samples=report.samples||[],gaps=[],fps=[];let activeMs=0;
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i],dt=b.at-a.at,frames=b.renderedFrames-a.renderedFrames;
  if(dt<=0||dt>maxGapMs){gaps.push({from:a.at,to:b.at,ms:dt});continue;}
  if(a.hidden||b.hidden)continue;
  activeMs+=dt;
  if(Number.isFinite(frames)&&frames>=0)fps.push(frames*1000/dt);
 }
 const range=values=>values.length?{min:Math.min(...values),max:Math.max(...values),first:values[0],last:values.at(-1)}:null;
 const ordered=[...fps].sort((a,b)=>a-b),quantile=p=>ordered.length?ordered[Math.floor((ordered.length-1)*p)]:null;
 const errors=report.errors||[],events=report.events||[];
 const wallMs=samples.length>1?samples.at(-1).at-samples[0].at:0;
 const hiddenSamples=samples.filter(s=>s.hidden).length;
 return {samples:samples.length,wallMs,activeMs,gaps,hiddenSamples,errors,events,
  fps:{count:fps.length,p05:quantile(.05),median:quantile(.5),p95:quantile(.95)},
  heapBytes:range(samples.map(s=>s.heap).filter(Number.isFinite)),
  meshCount:range(samples.map(s=>s.meshes).filter(Number.isFinite)),
  observedDurationPassed:activeMs>=requiredMs&&gaps.length===0&&hiddenSamples===0&&errors.length===0&&!events.some(e=>e.type==='lost'),
  boundary:'Observed duration only; not physical GPU memory, real driver recovery, or production certification'};
}
