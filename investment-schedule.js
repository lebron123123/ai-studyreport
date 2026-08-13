/* 工期横道图与投资计划白箱内核。
   单一数据源是 taskSchedule（季度格）+ costMappings（费用映射）；颜色和表格都是派生视图。 */
(function(root,factory){
  const api=factory();root.InvestmentSchedule=api;
  if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis,function(){
"use strict";
const r4=x=>Math.round((Number(x)||0)*10000)/10000;
const DEFAULT_TEMPLATE={id:"housing-standard",name:"保障房标准工期",baseQuarters:16,tasks:[
  {id:"land",name:"土地成本",startRatio:0,durationRatio:.08,color:"#F4D889"},
  {id:"preliminary",name:"前期工程",startRatio:0,durationRatio:.20,color:"#F4D889"},
  {id:"underground",name:"地下建筑部分",startRatio:.12,durationRatio:.34,color:"#F2C7A6"},
  {id:"earthwork",name:"土石方工程",startRatio:.12,durationRatio:.25,color:"#F2C7A6",group:"underground"},
  {id:"pile",name:"桩基工程",startRatio:.12,durationRatio:.25,color:"#F2C7A6",group:"underground"},
  {id:"basement",name:"地下室建筑工程",startRatio:.18,durationRatio:.28,color:"#F2C7A6",group:"underground"},
  {id:"above",name:"地上建筑部分",startRatio:.28,durationRatio:.375,startQuarterNo:5,durationQuarters:6,color:"#F2C7A6"},
  {id:"installation",name:"安装工程",startRatio:.55,durationRatio:.24,color:"#F2C7A6"},
  {id:"decoration",name:"精装修工程",startRatio:.60,durationRatio:.22,color:"#F2C7A6"},
  {id:"outdoor",name:"室外工程",startRatio:.72,durationRatio:.20,color:"#F2C7A6"},
  {id:"completion",name:"竣工验收",startRatio:.92,durationRatio:.08,color:"#F2C7A6"},
]};
const DEFAULT_MAPPINGS=[
  {id:"land",name:"土地成本费用",costPath:"land.landCostTotal",taskIds:["land"],curve:"once_start"},
  {id:"pre",name:"前期工程费用",costPath:"preConstruction.total",taskIds:["preliminary"],curve:"average"},
  {id:"underground",name:"地下建筑结构工程",costPath:"construction.undergroundTotal",taskIds:["underground"],curve:"s_curve"},
  {id:"above",name:"地上建筑结构工程",costPath:"construction.aboveGroundTotal",taskIds:["above"],curve:"s_curve"},
  {id:"install",name:"安装工程",costPath:"construction.installTotal",taskIds:["installation"],curve:"back_loaded"},
  {id:"decoration",name:"装修工程",costPath:"construction.decorationTotal",taskIds:["decoration"],curve:"back_loaded"},
  {id:"outdoor",name:"基础设施建设费",costPath:"construction.outdoorTotal",taskIds:["outdoor"],curve:"front_loaded"},
  {id:"newreg",name:"新规增量成本",costPath:"construction.newRegTotal",taskIds:["above","installation"],curve:"average"},
  {id:"indirect",name:"工程建设其他费用",costPath:"indirect.total",taskIds:["underground","above","installation","decoration","outdoor"],curve:"average"},
  {id:"contingency",name:"不可预见费",costPath:"contingency",taskIds:["underground","above","installation","decoration","outdoor"],curve:"average"},
];
const SALE_COEFFICIENT_ROWS=[
  {no:"1",name:"土地成本费用",taskIds:["land","preliminary"],annualPattern:[],level:0},
  {no:"1.1",name:"地价",taskIds:["land"],annualPattern:[],level:1},
  {no:"1.2",name:"土地税费",taskIds:["land"],annualPattern:[],level:1},
  {no:"1.3",name:"拆迁等其他费用",taskIds:["preliminary"],annualPattern:[1],yearOffset:1,level:1},
  {no:"1.4",name:"红线外市政设施费",taskIds:["preliminary"],annualPattern:[1],yearOffset:1,level:1},
  {no:"1.5",name:"其他费用",taskIds:["preliminary"],annualPattern:[1],yearOffset:1,level:1},
  {no:"2.1",name:"建筑安装工程费",taskIds:["underground","above","installation","decoration"],annualPattern:[],level:0},
  {no:"2.2",name:"地下建筑结构工程",taskIds:["underground"],annualPattern:[.6,.4],yearOffset:1,level:1},
  {no:"2.3",name:"地上建筑结构工程",taskIds:["above"],annualPattern:[.2,.4,.4],yearOffset:1,level:1},
  {no:"2.4",name:"安装工程",taskIds:["installation"],annualPattern:[1],yearOffset:3,level:1},
  {no:"2.5",name:"装修工程",taskIds:["decoration"],annualPattern:[1],yearOffset:3,level:1},
  {no:"3",name:"基础设施建设费",taskIds:["outdoor"],annualPattern:[.6,.4],yearOffset:3,level:0},
  {no:"4",name:"工程建设其他费用",taskIds:["preliminary","underground","above","installation","decoration","outdoor"],annualPattern:[.25,.25,.25,.25],yearOffset:1,level:0},
  {no:"5",name:"不可预见费",taskIds:["underground","above","installation","decoration","outdoor"],annualPattern:[.25,.25,.25,.25],yearOffset:1,level:0},
  {no:"6",name:"前期归集的物业专项维修资金",taskIds:["completion"],annualPattern:[1],yearOffset:4,level:0},
  {no:"7",name:"销售费用",taskIds:["sales"],annualPattern:[.4,.4,.2],anchorTaskId:"sales",yearOffset:4,level:0},
];
const SALE_STAGE={id:"sales",name:"销售阶段",startQuarterNo:17,durationQuarters:12,startRatio:1,durationRatio:.75,color:"#C9A000",group:"sales"};
function clone(v){return JSON.parse(JSON.stringify(v));}
function saleTimelineQuarters(buildQuarters,saleQuarters,startQuarterNo){const build=Math.max(1,Math.round(Number(buildQuarters)||1)),duration=Math.max(1,Math.round(Number(saleQuarters)||12)),start=Math.max(1,Math.round(Number(startQuarterNo)||build+1));return Math.max(build,start+duration-1);}
function ensureSaleTemplate(template,buildQuarters){
  const src=clone(template||DEFAULT_TEMPLATE),oldBase=Math.max(1,Math.round(Number(src.baseQuarters)||16)),build=Math.max(1,Math.round(Number(buildQuarters)||oldBase));
  src.tasks=(src.tasks||clone(DEFAULT_TEMPLATE.tasks)).map(t=>{if(t.id==="sales")return t;const out=Object.assign({},t);if(!Number.isFinite(Number(out.startQuarterNo)))out.startQuarterNo=Math.round((Number(out.startRatio)||0)*(oldBase-1))+1;if(!Number.isFinite(Number(out.durationQuarters)))out.durationQuarters=Math.max(1,Math.round((Number(out.durationRatio)||.1)*oldBase));return out;});
  const completion=src.tasks.find(t=>t.id==="completion"),completionEnd=completion?(Number(completion.startQuarterNo)||build)+(Number(completion.durationQuarters)||1)-1:build;
  let sales=src.tasks.find(t=>t.id==="sales");if(!sales){sales=clone(SALE_STAGE);sales.startQuarterNo=completionEnd+1;src.tasks.push(sales);}else if(sales.autoAfterBuild!==false)sales.startQuarterNo=completionEnd+1;
  sales.durationQuarters=Math.max(1,Math.round(Number(sales.durationQuarters)||12));sales.autoAfterBuild=sales.autoAfterBuild!==false;src.baseQuarters=saleTimelineQuarters(build,sales.durationQuarters,sales.startQuarterNo);return src;
}
function get(obj,path){return String(path||"").split(".").reduce((v,k)=>v&&v[k],obj);}
function defaultTasks(totalQuarters,template){
  const tq=Math.max(1,Math.round(Number(totalQuarters)||1)),tpl=template||DEFAULT_TEMPLATE,src=tpl.tasks||DEFAULT_TEMPLATE.tasks,base=Math.max(1,Math.round(Number(tpl.baseQuarters)||Number(DEFAULT_TEMPLATE.baseQuarters)||16));
  return src.map((t,i)=>{const explicitStart=Number(t.startQuarterNo),explicitDuration=Number(t.durationQuarters);
    // 旧模板只有比例字段时，也必须先按模板基准建设期换算成绝对季度数；不能再随当前项目20/24季度二次放大。
    const start=Math.min(tq-1,Math.max(0,Number.isFinite(explicitStart)&&explicitStart>=1?Math.round(explicitStart)-1:Math.round((t.startRatio||0)*(base-1))));
    const duration=Math.max(1,Number.isFinite(explicitDuration)&&explicitDuration>=1?Math.round(explicitDuration):Math.round((t.durationRatio||.1)*base));
    const end=Math.min(tq-1,start+duration-1);
    return {id:t.id||"task"+i,name:t.name||t.id,startQuarter:start,endQuarter:end,activeQuarters:Array.from({length:end-start+1},(_,q)=>start+q),color:t.color||"#F2C7A6",group:t.group||null};});
}
function activePeriods(task,total){
  if(Array.isArray(task.activeQuarters))return [...new Set(task.activeQuarters.map(Number).filter(q=>Number.isInteger(q)&&q>=0&&q<total))].sort((a,b)=>a-b);
  const a=Math.max(0,task.startQuarter|0),b=Math.min(total-1,task.endQuarter|0),out=[];for(let i=a;i<=b;i++)out.push(i);return out;
}
function normalizeTask(task,total){
  const qs=activePeriods(task,total);task.activeQuarters=qs;task.startQuarter=qs.length?qs[0]:0;task.endQuarter=qs.length?qs[qs.length-1]:-1;return task;
}
function setTaskQuarter(tasks,taskId,quarter,active,total){
  const out=clone(tasks||[]),task=out.find(t=>t.id===taskId);if(!task)return out;
  const qs=new Set(activePeriods(task,total));if(active===undefined)active=!qs.has(quarter);active?qs.add(quarter):qs.delete(quarter);
  task.activeQuarters=[...qs];normalizeTask(task,total);return out;
}
function shiftTasks(tasks,delta,total){
  return clone(tasks||[]).map(task=>{task.activeQuarters=activePeriods(task,total).map(q=>q+delta).filter(q=>q>=0&&q<total);return normalizeTask(task,total);});
}
function weights(curve,n,custom){
  if(n<=0)return[];if(curve==="once_start")return [1].concat(Array(n-1).fill(0));if(curve==="once_end")return Array(n-1).fill(0).concat([1]);
  if(curve==="manual"&&Array.isArray(custom)&&custom.length===n){const s=custom.reduce((a,b)=>a+Math.max(0,Number(b)||0),0);if(s>0)return custom.map(x=>Math.max(0,Number(x)||0)/s);}
  let raw;if(curve==="front_loaded")raw=Array.from({length:n},(_,i)=>n-i);else if(curve==="back_loaded")raw=Array.from({length:n},(_,i)=>i+1);else if(curve==="s_curve")raw=Array.from({length:n},(_,i)=>Math.sin(Math.PI*(i+.5)/n));else raw=Array(n).fill(1);
  const s=raw.reduce((a,b)=>a+b,0);return raw.map(x=>x/s);
}
function periodLabel(startYear,startQuarter,index){const z=(Number(startQuarter)||1)-1+index;return {year:(Number(startYear)||new Date().getFullYear())+Math.floor(z/4),quarter:z%4+1,label:((Number(startYear)||new Date().getFullYear())+Math.floor(z/4))+"Q"+(z%4+1)};}
function coefficientPlan(tasks,periods,rowDefs,totalQuarters){
  const total=Math.max(1,Math.round(Number(totalQuarters)||periods.length||1)),taskMap=Object.fromEntries((tasks||[]).map(t=>[t.id,t])),baseYear=Number(periods&&periods[0]&&periods[0].year)||new Date().getFullYear();
  const defs=rowDefs||SALE_COEFFICIENT_ROWS,maxPatternYear=Math.max(0,...defs.flatMap(d=>(d.annualPattern||[]).map((_,i)=>(Number(d.yearOffset)||0)+i))),years=[...new Set((periods||[]).map(p=>p.year).concat(Array.from({length:maxPatternYear+1},(_,i)=>baseYear+i)))].sort((a,b)=>a-b);
  const rows=defs.map(def=>{
    const active=[...new Set((def.taskIds||[]).flatMap(id=>taskMap[id]?activePeriods(taskMap[id],total):[]))].sort((a,b)=>a-b),ws=weights(def.curve,active.length,def.manualWeights),quarterCoefficients=Array(total).fill(0);
    active.forEach((q,i)=>quarterCoefficients[q]=ws[i]||0);const annualCoefficients=Object.fromEntries(years.map(y=>[y,0])),pattern=Array.isArray(def.annualPattern)?def.annualPattern:null;
    if(pattern){
      const anchorTask=def.anchorTaskId&&taskMap[def.anchorTaskId],anchorPeriods=anchorTask?activePeriods(anchorTask,total):[],anchorPeriod=anchorPeriods.length&&periods&&periods[anchorPeriods[0]],patternBaseYear=anchorPeriod?Number(anchorPeriod.year):baseYear+(Number(def.yearOffset)||0);
      pattern.forEach((v,i)=>annualCoefficients[patternBaseYear+i]=Number(v)||0);
    }else (periods||[]).forEach((p,i)=>annualCoefficients[p.year]=(annualCoefficients[p.year]||0)+(quarterCoefficients[i]||0));
    const sum=Object.values(annualCoefficients).reduce((a,b)=>a+b,0);
    return Object.assign({},def,{quarterCoefficients,annualCoefficients,totalCoefficient:sum,valid:pattern&&pattern.length===0?true:(active.length>0&&Math.abs(sum-1)<1e-9)});
  });
  return {years,rows,valid:rows.every(r=>r.valid)};
}
/* 出售类“45.投资计划表”数据内核。
   叶子金额优先读取现有白箱输入/结果；尚无独立字段的项目明确为0，避免猜数。
   annualMode=coefficient 时按后台年度系数拆分；direct 时直接引用还本付息结果。 */
function saleInvestmentPlan(params,result,coeffPlan){
  const p=params||{},R=result||{},cp=coeffPlan||{years:[],rows:[]},years=(cp.years||[]).map(Number);
  const coeffByNo=Object.fromEntries((cp.rows||[]).map(r=>[r.no,r]));
  const sumCost=key=>Object.values(R.cost||{}).reduce((s,x)=>s+(Number(x&&x[key])||0),0);
  const buildYears=new Set(Array.from({length:Math.max(0,Math.round(Number(p.buildYears)||0))},(_,i)=>Number(p.buildStart)+i));
  const leaf=(no,name,amount,coeffNo,source,mode)=>({no,name,amount:r4(amount),coeffNo:coeffNo||null,source:source||"待补充",annualMode:mode||"coefficient"});
  const rows=[
    {no:"45",name:"投资计划合计",children:["45.1","45.2","45.3"]},
    {no:"45.1",name:"小计",children:["45.1.1","45.1.2","45.1.3","45.1.4","45.1.5","45.1.6","45.1.7"]},
    {no:"45.1.1",name:"土地成本费用",children:["45.1.1.1","45.1.1.2","45.1.1.3","45.1.1.4","45.1.1.5"]},
    leaf("45.1.1.1","地价",p.landCost,"1.1","现有出售参数 landCost"),
    leaf("45.1.1.2","税费",0,"1.2","待接入土地税费明细"),
    leaf("45.1.1.3","管线迁改费",0,"1.3","待接入管线迁改费明细"),
    leaf("45.1.1.4","红线外市政设施费",0,"1.4","待接入红线外市政设施费明细"),
    leaf("45.1.1.5","其他费用",0,"1.5","待接入土地其他费用明细"),
    {no:"45.1.2",name:"建筑安装工程费",children:["45.1.2.1","45.1.2.2","45.1.2.3","45.1.2.4"]},
    leaf("45.1.2.1","地下建筑部分",p.constructionCost,"2.2","现有非配售建安总额临时映射"),
    leaf("45.1.2.2","地上建筑部分",p.saleConstructionCost,"2.3","现有配售建安总额临时映射"),
    leaf("45.1.2.3","安装工程",0,"2.4","待接入安装工程独立金额"),
    leaf("45.1.2.4","装修工程",0,"2.5","待接入装修工程独立金额"),
    leaf("45.1.3","基础设施建设费",(Number(p.infraCost)||0)+(Number(p.saleInfraCost)||0),"3","现有配售及非配售基础设施费"),
    leaf("45.1.4","前期工程费",0,null,"待补充前期工程费及其年度比例"),
    leaf("45.1.5","开发间接费",p.otherEngCost,"4","现有工程建设其他费用临时映射"),
    leaf("45.1.6","物业维修基金",0,"6","待接入物业维修基金独立金额"),
    leaf("45.1.7","不可预见费",0,"5","待接入不可预见费独立金额"),
    leaf("45.2","销售费用",sumCost("saleFee"),"7","出售测算引擎销售费用合计；按销售阶段40%/40%/20%分摊"),
    leaf("45.3","建设期财务费用",years.reduce((s,y)=>s+(buildYears.has(y)?Number(R.loan&&R.loan[y]&&R.loan[y].interest)||0:0),0),null,"还本付息表·本期利息","direct"),
  ];
  const byNo=Object.fromEntries(rows.map(r=>[r.no,r]));
  rows.filter(r=>!r.children).forEach(r=>{
    const coeff=coeffByNo[r.coeffNo],annual={};
    years.forEach(y=>annual[y]=r.annualMode==="direct"?(buildYears.has(y)?r4(Number(R.loan&&R.loan[y]&&R.loan[y].interest)||0):0):r4(r.amount*Number(coeff&&coeff.annualCoefficients&&coeff.annualCoefficients[y]||0)));
    r.annual=annual;r.allocated=r.annualMode==="direct"||!!(coeff&&(coeff.annualPattern||[]).length);
  });
  [...rows].reverse().filter(r=>r.children).forEach(r=>{r.amount=r4(r.children.reduce((s,no)=>s+(Number(byNo[no]&&byNo[no].amount)||0),0));r.annual=Object.fromEntries(years.map(y=>[y,r4(r.children.reduce((s,no)=>s+(Number(byNo[no]&&byNo[no].annual&&byNo[no].annual[y])||0),0))]));r.source="公式汇总";r.allocated=true;});
  return {years,rows,valid:rows.filter(r=>!r.children&&r.amount).every(r=>r.allocated),unallocated:rows.filter(r=>!r.children&&r.amount&&!r.allocated).map(r=>({no:r.no,name:r.name,amount:r.amount}))};
}
function allocate(est,opt){
  opt=opt||{};const total=Math.max(1,Math.round(Number(opt.totalQuarters)||Number(opt.buildYears)*4||1));const tasks=clone(opt.tasks&&opt.tasks.length?opt.tasks:defaultTasks(total,opt.template));
  const mappings=clone(opt.mappings&&opt.mappings.length?opt.mappings:DEFAULT_MAPPINGS),taskMap=Object.fromEntries(tasks.map(x=>[x.id,x]));
  const periods=Array.from({length:total},(_,i)=>periodLabel(opt.startYear,opt.startQuarter,i)),rows=[],quarterTotals=Array(total).fill(0),errors=[],unmapped=[];
  mappings.forEach(m=>{const amount=Number(get(est,m.costPath));if(!Number.isFinite(amount)){unmapped.push({id:m.id,name:m.name,costPath:m.costPath});return;}
    const ids=[...new Set((m.taskIds||[]).flatMap(id=>taskMap[id]?activePeriods(taskMap[id],total):[]))].sort((a,b)=>a-b);if(!ids.length){errors.push({type:"no_period",id:m.id,message:m.name+"没有有效工期季度"});return;}
    const ws=weights(m.curve,ids.length,m.manualWeights),amounts=Array(total).fill(0);let used=0;ids.forEach((pi,j)=>{const v=j===ids.length-1?r4(amount-used):r4(amount*ws[j]);amounts[pi]=v;used=r4(used+v);quarterTotals[pi]=r4(quarterTotals[pi]+v);});
    rows.push({id:m.id,name:m.name,costPath:m.costPath,amount:r4(amount),curve:m.curve,taskIds:m.taskIds,percentages:amount?amounts.map(x=>x/amount):amounts,amounts});});
  const annualPlan={},quarterPlan={};periods.forEach((p,i)=>{quarterPlan[p.label]=quarterTotals[i];annualPlan[p.year]=r4((annualPlan[p.year]||0)+quarterTotals[i]);});
  const expected=r4(rows.reduce((s,x)=>s+x.amount,0)),actual=r4(quarterTotals.reduce((s,x)=>s+x,0));if(Math.abs(expected-actual)>.01)errors.push({type:"total_mismatch",message:"季度投资合计与映射费用合计不一致",expected,actual});
  rows.forEach(x=>{const sum=x.percentages.reduce((s,v)=>s+v,0);if(x.amount&&Math.abs(sum-1)>1e-6)errors.push({type:"percentage",id:x.id,message:x.name+"分摊比例合计不等于100%"});});
  tasks.forEach(t=>{if(!activePeriods(t,total).length)errors.push({type:"task_range",id:t.id,message:t.name+"没有安排有效季度"});});
  const completion=taskMap.completion,above=taskMap.above,completionQs=completion?activePeriods(completion,total):[],aboveQs=above?activePeriods(above,total):[];
  if(completionQs.length&&aboveQs.length&&Math.max(...completionQs)<Math.max(...aboveQs))errors.push({type:"dependency",id:"completion",message:"竣工验收不得早于地上建筑完成"});
  return {startYear:Number(opt.startYear),startQuarter:Number(opt.startQuarter)||1,totalQuarters:total,periods,tasks,mappings,rows,quarterTotals,quarterPlan,annualPlan,investPlan:annualPlan,totalInvestment:actual,validation:{ok:!errors.length,errors,unmappedCosts:unmapped}};
}
return {DEFAULT_TEMPLATE,DEFAULT_MAPPINGS,SALE_COEFFICIENT_ROWS,SALE_STAGE,clone,get,saleTimelineQuarters,ensureSaleTemplate,defaultTasks,activePeriods,normalizeTask,setTaskQuarter,shiftTasks,weights,periodLabel,coefficientPlan,saleInvestmentPlan,allocate};
});
