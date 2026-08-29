/* AI可研参数—指标—章节依赖图。纯函数，浏览器与Node测试共用。 */
(function(root){
  "use strict";
  const RD_METRICS={
    totalInvestment:"总投资",totalCost:"全周期总成本",totalIncome:"全周期总收入",totalNetProfit:"净利润合计",
    irr:"全投资IRR",capitalIrr:"资本金IRR",totalNpv:"累计净现值",payback:"静态投资回收期",
    dynamicPayback:"动态投资回收期",icr:"利息备付率",dscr:"偿债备付率",totalTax:"税费合计"
  };
  const RD_PARAM_RULES={
    rent:["totalIncome","totalNetProfit","irr","capitalIrr","totalNpv","payback","dynamicPayback","icr","dscr"],
    rentRate:["totalIncome","totalNetProfit","irr","capitalIrr","totalNpv","payback"],
    rentSpan:["totalIncome","totalNetProfit","irr","totalNpv"],stableOcc:["totalIncome","totalNetProfit","irr","totalNpv"],
    rampOcc:["totalIncome","totalNetProfit","irr","totalNpv"],saleAvgPrice:["totalIncome","totalNetProfit","irr","capitalIrr","totalNpv"],
    rate1:["totalIncome","irr","totalNpv"],rate2:["totalIncome","irr","totalNpv"],rate3:["totalIncome","irr","totalNpv"],
    buildStart:["totalInvestment","totalCost","irr","totalNpv","payback"],buildYears:["totalInvestment","totalCost","irr","totalNpv","payback","dynamicPayback"],
    operateYears:["totalIncome","totalCost","totalNetProfit","irr","totalNpv"],loanRate:["totalCost","totalNetProfit","irr","capitalIrr","totalNpv","icr","dscr"],
    loanAmount:["totalCost","capitalIrr","icr","dscr"],discount:["totalNpv","dynamicPayback"],discountPct:["totalNpv","dynamicPayback"],
    totalInvestment:["totalInvestment","totalCost","irr","capitalIrr","totalNpv","payback"],constructionCost:["totalInvestment","totalCost","irr","totalNpv"],
    landCost:["totalInvestment","totalCost","irr","totalNpv"],area:["totalInvestment","totalIncome","totalCost","totalNetProfit","irr","totalNpv"],
    saleArea:["totalIncome","totalNetProfit","irr","totalNpv"],totalBuildArea:["totalInvestment","totalCost","totalIncome","irr","totalNpv"]
  };
  const RD_METRIC_PATTERNS={
    totalInvestment:/投资估算|总投资|资金筹措|投资计划|主要技术经济指标/,
    totalCost:/成本|费用|投资估算|财务评价|经济评价/,
    totalIncome:/收入|市场|租金|售价|销售|运营|财务评价|经济评价/,
    totalNetProfit:/利润|盈利|财务评价|经济评价|结论|建议/,
    irr:/内部收益率|IRR|财务评价|经济评价|敏感性|结论|建议|可行性/,
    capitalIrr:/资本金|财务评价|经济评价|结论|建议/,
    totalNpv:/净现值|NPV|财务评价|经济评价|敏感性|结论|建议/,
    payback:/回收期|财务评价|经济评价|结论|建议/,
    dynamicPayback:/回收期|财务评价|经济评价|结论|建议/,
    icr:/利息备付|偿债|财务评价|经济评价|风险/,
    dscr:/偿债备付|偿债|财务评价|经济评价|风险/,
    totalTax:/税|财务评价|经济评价|投资估算/
  };
  function rdUniq(xs){return [...new Set((xs||[]).filter(Boolean))];}
  function metricsForParameter(key){
    if(RD_PARAM_RULES[key])return RD_PARAM_RULES[key].slice();
    if(/rent|price|occ|rate|income|sale/i.test(key))return RD_PARAM_RULES.rent.slice();
    if(/loan|repay|finance/i.test(key))return ["totalCost","totalNetProfit","irr","capitalIrr","totalNpv","icr","dscr"];
    if(/build|area|cost|invest|deco|land/i.test(key))return ["totalInvestment","totalCost","irr","totalNpv","payback"];
    return ["totalInvestment","totalCost","irr","totalNpv"];
  }
  function sectionsForMetric(metric,chapters){
    const re=RD_METRIC_PATTERNS[metric]||/财务评价|经济评价|结论|建议/;const out=[];
    (chapters||[]).forEach(c=>(c.sections||[]).forEach((s,si)=>{const text=String(c.name||"")+" "+String(s.t||"");if(s.numeric||re.test(text))out.push({id:"section:"+c.cn+":"+si,cn:c.cn,si,title:s.t,chapter:c.name,locked:!!s.locked});}));
    return out;
  }
  function buildGraph(input){
    input=input||{};const params=rdUniq(input.paramKeys||[]),chapters=input.chapters||[],nodes=[],edges=[],seen=new Set();
    const add=(id,type,label,meta)=>{if(seen.has(id))return;seen.add(id);nodes.push({id,type,label,...(meta||{})});};
    params.forEach(key=>{const pid="param:"+key;add(pid,"parameter",(input.paramLabels&&input.paramLabels[key])||key,{key});metricsForParameter(key).forEach(metric=>{const mid="metric:"+metric;add(mid,"metric",RD_METRICS[metric]||metric,{key:metric});edges.push({from:pid,to:mid,kind:"drives"});sectionsForMetric(metric,chapters).forEach(sec=>{add(sec.id,"section",sec.title,sec);edges.push({from:mid,to:sec.id,kind:"appears_in"});});});});
    return {schemaVersion:1,calcType:input.calcType||"",nodes,edges,parameters:params.length,metrics:nodes.filter(x=>x.type==="metric").length,sections:nodes.filter(x=>x.type==="section").length};
  }
  function traceParameter(key,chapters,label){const graph=buildGraph({paramKeys:[key],chapters,paramLabels:{[key]:label||key}}),metrics=graph.nodes.filter(x=>x.type==="metric"),sections=graph.nodes.filter(x=>x.type==="section");return {key,label:label||key,metrics,sections,graph};}
  function impactFromChanges(input){
    input=input||{};const changed=rdUniq(input.changedKeys||[]),graph=buildGraph({...input,paramKeys:changed});
    const before=input.beforeSummary||{},after=input.afterSummary||{},metricChanges=graph.nodes.filter(x=>x.type==="metric").map(x=>{const a=Number(before[x.key]),b=Number(after[x.key]);return {key:x.key,label:x.label,before:Number.isFinite(a)?a:null,after:Number.isFinite(b)?b:null,delta:Number.isFinite(a)&&Number.isFinite(b)?b-a:null};});
    return {changedKeys:changed,metricChanges,sections:graph.nodes.filter(x=>x.type==="section"),graph};
  }
  const api={METRICS:RD_METRICS,PARAM_RULES:RD_PARAM_RULES,METRIC_PATTERNS:RD_METRIC_PATTERNS,metricsForParameter,sectionsForMetric,buildGraph,traceParameter,impactFromChanges};
  root.ReportDependency=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
