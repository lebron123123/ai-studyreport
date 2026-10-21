(function(root){
 'use strict';
 const clone=v=>JSON.parse(JSON.stringify(v));
 const facts=new Set(['area','units','mode','rampIntervalMonths']);
 const eligible=r=>!r.reason&&!facts.has(r.key)&&r.kind!=='month'&&!r.key.startsWith('rampRates.');
 const median=a=>{const b=a.slice().sort((x,y)=>x-y),i=Math.floor(b.length/2);return b.length?(b.length%2?b[i]:(b[i-1]+b[i])/2):null;};
 function valid(r,v){
  return typeof v==='number'&&Number.isFinite(v)&&(r.kind!=='integer'||Number.isInteger(v)&&v>=1)&&(r.kind!=='ratio'||v>=0&&v<=1)&&(r.kind!=='percent'||v>=0&&v<=100)&&(v>=0||['rentRate','costRate'].includes(r.key)&&v> -100);
 }
 function identity(r){return String(r.projectId||r.id);}
 function calibrate(base,references,validation=[]){
  const excluded=new Set(validation.map(identity));
  const seen=new Set(),refs=references.filter(r=>{const id=identity(r);if(excluded.has(id)||seen.has(id))return false;seen.add(id);return true;});
  const comparable=refs.filter(r=>r.projectType===base.projectType&&r.params?.mode===base.params.mode&&r.params?.occupancyMode===base.params.occupancyMode&&r.params?.debtModel===base.params.debtModel);
  if(!comparable.length)throw Error('没有可比参考项目：须同类型、合作模式及模型；验证项目已排除');
  const rows=root.ProjectSensitivity.inventory(base.params).filter(eligible).map(row=>{
   const values=comparable.map(r=>root.ProjectSensitivity.inventory(r.params).find(item=>item.key===row.key&&!item.reason)?.value).filter(v=>valid(row,v));
   const mid=median(values),value=row.kind==='integer'&&mid!==null?Math.round(mid):mid;
   return {...row,count:values.length,median:mid,value,min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,calibrated:values.length>=3&&Math.min(...values)<Math.max(...values)};
  });
  return {version:'anju-validation-v1',references:comparable.map(r=>({id:r.id,identity:identity(r),revision:r.revision})),excluded:references.filter(r=>excluded.has(identity(r))).map(r=>r.id),rows};
 }
 function summarize(rows){
  const independent=rows.filter(r=>r.independent),n=independent.length,k=independent.filter(r=>r.pass).length;
  if(!n)return {n:0,passed:0,rate:null,interval:null};
  const p=k/n,z=1.959963984540054,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return {n,passed:k,rate:p,interval:[Math.max(0,c-h),Math.min(1,c+h)]};
 }
 async function validate(base,projects,calibration,values,keys,cfg,options={}){
  const irrTol=options.irrTolerance??.1,npvTol=options.npvTolerance??.1,absTol=options.npvAbsoluteTolerance??1;
  if(![irrTol,npvTol,absTol].every(v=>Number.isFinite(v)&&v>=0))throw Error('误差容限必须为非负数');
  if(!projects.length)throw Error('请选择验证项目');
  const refs=new Set(calibration.references.map(r=>r.identity)),used=new Set(options.usedIdentities||[]),seen=new Set();
  if(projects.some(r=>refs.has(identity(r))))throw Error('验证项目不得参与经验值计算，请重新生成中位数');
  const selected=new Set(keys),rows=[];
  for(const project of projects){
   if(options.cancelled?.())throw Error('验证已取消，未改变任何项目');
   if(seen.has(identity(project)))throw Error('同一项目重复，不能作为独立样本计数');seen.add(identity(project));
   const entry={id:project.id,name:project.projectName,revision:project.revision,independent:identity(project)!==identity(base)&&!used.has(identity(project))};
   try{
    if(project.projectType!==base.projectType||project.params.mode!==base.params.mode||project.params.occupancyMode!==base.params.occupancyMode||project.params.debtModel!==base.params.debtModel)throw Error('项目类型/合作模式/模型不同，不可比');
    let params=clone(project.params);const replaced=[];
    for(const row of root.ProjectSensitivity.inventory(params).filter(eligible)){
     if(selected.has(row.key))continue;
     if(!calibration.rows.some(r=>r.key===row.key))throw Error(row.label+'没有参考定义');
     const value=values[row.key];if(!valid(row,value))throw Error(row.label+'缺少有效经验值，请填写后重试');
     params=root.ProjectSensitivity.change(params,row.key,value);replaced.push({key:row.key,original:row.value,value});
    }
    const compact=p=>{const r=root.ProjectSensitivity.evaluate(p,cfg);if(!Number.isFinite(r.irr)||!Number.isFinite(r.npv))throw Error('无有效IRR或NPV');return {irr:r.irr,npv:r.npv};};
    const full=compact(project.params),reduced=compact(params),irrError=Math.abs(full.irr-reduced.irr),npvError=Math.abs(full.npv-reduced.npv),npvRelative=Math.abs(full.npv)<1?null:npvError/Math.abs(full.npv);
    rows.push({...entry,full,reduced,replaced,irrError,npvError,npvRelative,pass:irrError<=irrTol&&(npvRelative===null?npvError<=absTol:npvRelative<=npvTol)});
   }catch(e){rows.push({...entry,pass:false,error:e.message});}
   options.progress?.(rows.length,projects.length);await new Promise(resolve=>setTimeout(resolve,0));
  }
  return {version:'anju-validation-v1',createdAt:new Date().toISOString(),criteria:{irrTol,npvTol,absTol},keys:keys.slice(),references:clone(calibration.references),values:clone(values),rows,summary:summarize(rows)};
 }
 async function stability(params,cfg,ranges,criteria,options={}){
  const repeats=options.repeats??3,seed=options.seed??20260921;
  if(!Number.isInteger(repeats)||repeats<2||repeats>10||!Number.isInteger(seed)||seed<0||seed>4294967285)throw Error('重复次数须为2—10；种子须为0—4294967285整数');
  const runs=[];
  for(let i=0;i<repeats;i++){
   const r=await root.ProjectSensitivityGlobal.analyze(params,cfg,{...options,ranges,seed:seed+i,progress:(n,t)=>options.progress?.(i+1,repeats,n,t)});
   const scored=root.ProjectSensitivityGlobal.scoreImpacts(r.table,r.baseline.npv).map(r=>({...r,policy:options.policies?.[r.key]||root.ProjectSensitivityGlobal.policy?.(r.key)})).sort((a,b)=>b.weightedScore-a.weightedScore||b.irrImpact.maxDeviation-a.irrImpact.maxDeviation||a.combinedRank-b.combinedRank||a.key.localeCompare(b.key));
   runs.push({seed:seed+i,N:r.N,table:scored.map((r,j)=>({key:r.key,label:r.label,rank:j+1,STi:r.STi,Si:r.Si,sobolRank:r.sobolRank,selected:root.ProjectSensitivityGlobal.recommend(r,criteria)}))});
  }
  const table=runs[0].table.map(row=>{const points=runs.map(r=>r.table.find(x=>x.key===row.key));return {key:row.key,label:row.label,rankMin:Math.min(...points.map(r=>r.rank)),rankMax:Math.max(...points.map(r=>r.rank)),stiMin:Math.min(...points.map(r=>r.STi)),stiMax:Math.max(...points.map(r=>r.STi)),sobolRankMin:Math.min(...points.map(r=>r.sobolRank)),sobolRankMax:Math.max(...points.map(r=>r.sobolRank)),interactionMax:Math.max(...points.map(r=>r.STi-r.Si)),selectionFrequency:points.filter(r=>r.selected).length/repeats};});
  return {runs,table,criteria:clone(criteria)};
 }
 root.ProjectSensitivityValidation={calibrate,validate,stability,median,identity,summarize};
})(typeof window==='undefined'?globalThis:window);
