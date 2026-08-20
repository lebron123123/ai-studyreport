/* 财务测算结果 -> AI PPT 可编辑指标与图表。只转换白箱结果，不生成或猜测数字。 */
(function(root){
  "use strict";
  const clone=x=>JSON.parse(JSON.stringify(x==null?{}:x));
  const num=v=>Number.isFinite(Number(v))?Number(v):null;
  const r2=v=>Math.round(Number(v||0)*100)/100;
  const TYPE_NAMES={gaibao:"非居改保",rent:"出租类",sale:"出售类"};
  const COST_LABELS={deco:"装修及重置",manage:"管理费用",maint:"维修费用",property:"物业费用",vac:"空置物业费用",fund:"专项维修资金",insurance:"保险费",ins:"保险费",landTax:"土地使用税",tax:"税费",finBuild:"建设期财务费用",finOp:"运营期财务费用",depreciation:"折旧摊销",devDep:"开发间接费"};
  function yearsOf(result={}){return (Array.isArray(result.allYears)?result.allYears:Object.keys(result.cf||{})).map(String).filter(x=>/^\d{4}$/.test(x)).sort();}
  function typeOf(result={},hint){return hint||result.__ctype||"";}
  function metric(label,value,unit,sourceKey){return num(value)==null?null:{label,value:r2(value),unit:unit||"",sourceKey};}
  function metricsOf(result={},type){
    const s=result.summary||{},rows=[
      metric("全周期收入",s.totalIncome,"万元","summary.totalIncome"),
      metric("全周期成本",s.totalCost,"万元","summary.totalCost"),
      metric("净利润",s.totalNetProfit,"万元","summary.totalNetProfit"),
      metric("财务净现值",s.totalNpv,"万元","summary.totalNpv"),
      metric("项目IRR",s.irr,"%","summary.irr"),
      metric("资本金IRR",s.capitalIrr,"%","summary.capitalIrr"),
      metric("利息保障倍数",s.icr,"倍","summary.icr")
    ].filter(Boolean);
    if(type==="sale"&&num(s.totalSaleIncome)!=null)rows.splice(1,0,metric("销售收入",s.totalSaleIncome,"万元","summary.totalSaleIncome"));
    return rows.slice(0,6);
  }
  function annualNet(result={}){return yearsOf(result).map(y=>({label:y,value:r2(result.cf&&result.cf[y]&&result.cf[y].net),sourceKey:"cf."+y+".net"})).filter(x=>num(x.value)!=null);}
  function annualIncomeCost(result={}){
    const out=[];for(const y of yearsOf(result)){const income=num(result.income&&result.income[y]&&result.income[y].total),cost=num((result.totalCost&&result.totalCost[y]&&result.totalCost[y].total)||(result.cost&&result.cost[y]&&result.cost[y].total));if(income!=null)out.push({label:y+"收入",value:r2(income),group:y,kind:"income",sourceKey:"income."+y+".total"});if(cost!=null)out.push({label:y+"成本",value:r2(cost),group:y,kind:"cost",sourceKey:"cost."+y+".total"});}return out;
  }
  function costStructure(result={}){
    const totals={};for(const y of yearsOf(result)){const row=(result.cost&&result.cost[y])||{};for(const [k,v] of Object.entries(row)){if(k==="total"||num(v)==null||Number(v)===0)continue;totals[k]=(totals[k]||0)+Number(v);}}
    return Object.entries(totals).map(([key,value])=>({label:COST_LABELS[key]||key,value:r2(value),sourceKey:"cost.*."+key})).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,7);
  }
  function analyze(result,opts={}){
    const type=typeOf(result,opts.calcType),years=yearsOf(result||{}),metrics=metricsOf(result||{},type),cashflow=annualNet(result||{}),incomeCost=annualIncomeCost(result||{}),costs=costStructure(result||{});
    const available=!!result&&metrics.length>0&&years.length>0;
    return{schemaVersion:1,available,calcType:type,calcTypeName:TYPE_NAMES[type]||type||"财务测算",years,metrics,cashflow,incomeCost,costs,source:{kind:"white-box-calc",label:(TYPE_NAMES[type]||type||"项目")+"白箱测算结果",snapshotId:opts.snapshotId||"",confirmedAt:opts.confirmedAt||Date.now()},createdAt:Date.now()};
  }
  function slide(id,title,layoutId,content,analysis){return{id,order:0,type:"content",title,layoutId,pageRole:"finance",claim:"以下数字均来自已完成的白箱测算结果",content,bullets:[],sources:[analysis.source.label],calcGenerated:true,calcSource:clone(analysis.source),locked:false};}
  function buildSlides(analysis={}){
    if(!analysis.available)return[];const out=[];
    if(analysis.metrics.length)out.push(slide("calc_metrics","财务评价核心指标","metric",{metrics:analysis.metrics},analysis));
    if(analysis.cashflow.length>1)out.push(slide("calc_cashflow","年度净现金流趋势","chart-line",{series:analysis.cashflow,unit:"万元"},analysis));
    if(analysis.costs.length>1)out.push(slide("calc_costs","成本构成分析","chart-bar",{series:analysis.costs,unit:"万元"},analysis));
    if(analysis.incomeCost.length>1)out.push(slide("calc_income_cost","年度收入与成本对照","chart-bar",{series:analysis.incomeCost,unit:"万元",grouped:true},analysis));
    return out;
  }
  function attach(plan={},result,opts={}){
    const out=clone(plan),analysis=analyze(result,opts);if(!analysis.available)return{plan:out,analysis,added:0};
    const generated=buildSlides(analysis),old=(out.slides||[]).filter(s=>!s.calcGenerated),end=old.findIndex(s=>s.layoutId==="conclusion"),at=end>=0?Math.max(1,end):old.length;
    old.splice(at,0,...generated);old.forEach((s,i)=>s.order=i+1);
    out.slides=old;out.calcAnalysis=analysis;out.workflow={...(out.workflow||{}),calcAttachedAt:Date.now(),calcAttachedType:analysis.calcType};out.updatedAt=Date.now();return{plan:out,analysis,added:generated.length};
  }
  function current(){
    let result=null,params=null,type="";
    try{if(typeof calcResult!=="undefined")result=calcResult;}catch(_){/* global lexical binding may not exist */}
    try{if(typeof calcParams!=="undefined")params=calcParams;}catch(_){}
    try{if(typeof calcType!=="undefined")type=calcType;}catch(_){}
    result=result||root.calcResult||root.scResult||null;params=params||root.calcParams||root.scParams||null;type=type||root.calcType||(result&&result.__ctype)||"";
    return{result,params,calcType:type,analysis:analyze(result,{calcType:type})};
  }
  const api={TYPE_NAMES,yearsOf,metricsOf,annualNet,annualIncomeCost,costStructure,analyze,buildSlides,attach,current};root.PptCalcBridge=api;if(root.document)root.document.documentElement.dataset.pptCalcBridge="loaded";if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
