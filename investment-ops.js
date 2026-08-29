/* Investment OS阶段4—6：会议行动化、情景决策包和生产验收。纯函数可在浏览器/Node/API复用。 */
(function(root){
  "use strict";
  const arr=x=>Array.isArray(x)?x:[];
  const txt=(x,n=600)=>String(x==null?"":x).trim().slice(0,n);
  const id=p=>(p||"io")+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,9);
  const METRICS=[
    ["irr","IRR","%"],["npv","NPV","万元"],["payback","回收期","年"],
    ["totalInvestment","总投资","万元"],["fundingGap","资金缺口","万元"],["riskScore","风险评分","分"]
  ];
  function lines(value){return txt(value,20000).split(/\r?\n|[；;]/).map(x=>x.replace(/^[-*•\d.、()（）\s]+/,"").trim()).filter(Boolean);}
  function parseMeeting(value){
    const out={agenda:[],decisions:[],tasks:[],risks:[]};
    lines(value).forEach((line,i)=>{
      const source={sourceLine:i+1,text:line};
      if(/风险|隐患|不确定|可能导致|需防范|预警/.test(line))out.risks.push({...source,id:id("risk"),level:/重大|严重|红线|阻断/.test(line)?"high":/较大|重点/.test(line)?"medium":"normal",status:"candidate"});
      else if(/责任人|牵头|配合|完成|前提交|待办|跟进|落实|办理/.test(line))out.tasks.push({...source,id:id("task"),owner:(line.match(/(?:责任人|牵头|由)[:：]?([^，,。；;]{2,18})/)||[])[1]||"待指定",due:(line.match(/(\d{4}[-年]\d{1,2}(?:[-月]\d{1,2}日?)?前?)/)||[])[1]||"",status:"candidate"});
      else if(/决定|同意|明确|审议通过|原则通过|形成结论|会议要求/.test(line))out.decisions.push({...source,id:id("decision"),status:"candidate"});
      else out.agenda.push(source);
    });
    return {...out,summary:{agenda:out.agenda.length,decisions:out.decisions.length,tasks:out.tasks.length,risks:out.risks.length,requiresConfirmation:out.decisions.length+out.tasks.length+out.risks.length}};
  }
  function normalizeScenario(input){
    input=input||{};const kind=["baseline","optimistic","prudent","custom"].includes(input.kind)?input.kind:"custom",metrics={};
    const source=input.metrics||{},aliases={irr:["irr","capitalIrr"],npv:["npv","totalNpv"],payback:["payback","paybackPeriod","capitalPayback"],totalInvestment:["totalInvestment","totalInvest","buildInvestment"],fundingGap:["fundingGap","fundGap","capitalGap"],riskScore:["riskScore"]};
    METRICS.forEach(([key])=>{const hit=aliases[key].find(k=>source[k]!==undefined&&source[k]!==null&&source[k]!==""),v=hit&&source[hit];if(v!==undefined&&v!==null&&v!=="")metrics[key]=Number(v);});
    return {id:txt(input.id,100)||id("scenario"),name:txt(input.name,120)||({baseline:"基准情景",optimistic:"乐观情景",prudent:"审慎情景",custom:"自定义情景"}[kind]),kind,calcType:txt(input.calcType,30),calcSnapshotId:txt(input.calcSnapshotId,120),engine:txt(input.engine||"whitebox",40),params:input.params||{},metrics,risks:arr(input.risks).map(x=>txt(x,240)),status:["draft","selected","archived"].includes(input.status)?input.status:"draft"};
  }
  function compareScenarios(items){
    const scenarios=arr(items).map(normalizeScenario),columns=METRICS.map(([key,label,unit])=>({key,label,unit,values:scenarios.map(s=>s.metrics[key]??null)}));
    return {scenarios,columns,hasBaseline:scenarios.some(x=>x.kind==="baseline"),comparable:scenarios.length>=2&&columns.some(c=>c.values.filter(Number.isFinite).length>=2)};
  }
  function auditDecisionPackage(input){
    input=input||{};const scenario=normalizeScenario(input.scenario||{}),context=input.context||{},blockers=[],warnings=[],checks=[];
    const add=(ok,label,level="blocker",detail="")=>{checks.push({ok,label,level,detail});if(!ok)(level==="blocker"?blockers:warnings).push(detail||label);};
    add(!!scenario.calcSnapshotId,"绑定白箱测算快照","blocker","情景尚未绑定可重复计算的测算快照");
    add(scenario.engine==="whitebox","关键数字来自白箱引擎","blocker","关键财务数字不能由AI直接计算");
    add(Object.keys(scenario.metrics).length>=3,"关键指标完整","blocker","IRR、NPV、回收期、总投资、资金缺口等指标至少应有3项");
    add(arr(input.evidenceIds).length>0,"决策证据已关联","blocker","决策包尚未关联政策、材料或数据证据");
    add(arr(context.artifacts).some(x=>x.artifactType==="report"),"已关联可研报告","warning","尚未关联可研报告版本");
    add(arr(context.artifacts).some(x=>x.artifactType==="calculation"),"已登记测算成果","warning","Project Brain尚未登记测算成果");
    add(!arr(input.consistencyIssues).some(x=>x.severity==="blocker"),"报告/PPT/测算口径一致","blocker","存在阻断级口径或勾稽问题");
    return {passed:blockers.length===0,status:blockers.length?"blocked":warnings.length?"conditional":"passed",blockers,warnings,checks,scenarioId:scenario.id,auditedAt:Date.now()};
  }
  function buildDecisionPackage(input){
    input=input||{};const scenario=normalizeScenario(input.scenario),audit=auditDecisionPackage({...input,scenario});
    return {schemaVersion:1,id:txt(input.id,100)||id("package"),title:txt(input.title,200)||"投资决策包",projectId:txt(input.projectId,100),scenario,comparison:compareScenarios(input.scenarios||[scenario]),decisionId:txt(input.decisionId,100),evidenceIds:arr(input.evidenceIds),artifactIds:arr(input.artifactIds),audit,status:audit.passed?"ready":"blocked",createdAt:Date.now()};
  }
  function evaluateSlo(input){
    input=input||{};const samples=arr(input.samples).map(x=>({latencyMs:Number(x.latencyMs)||0,ok:x.ok!==false,recovered:x.recovered===true})),sorted=samples.map(x=>x.latencyMs).sort((a,b)=>a-b),pct=p=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]:0;
    const target={p95Ms:Number(input.target&&input.target.p95Ms)||5000,successRate:Number(input.target&&input.target.successRate)||.99,recoveryRate:Number(input.target&&input.target.recoveryRate)||.95,concurrency:Number(input.target&&input.target.concurrency)||50};
    const result={sampleCount:samples.length,concurrency:Number(input.concurrency)||0,p50Ms:pct(.5),p95Ms:pct(.95),successRate:samples.length?samples.filter(x=>x.ok).length/samples.length:0,recoveryRate:samples.length?samples.filter(x=>x.recovered).length/samples.length:0};
    const checks=[{key:"concurrency",ok:result.concurrency>=target.concurrency},{key:"p95",ok:result.p95Ms<=target.p95Ms},{key:"success",ok:result.successRate>=target.successRate},{key:"recovery",ok:result.recoveryRate>=target.recoveryRate}];
    return {target,result,checks,passed:samples.length>0&&checks.every(x=>x.ok)};
  }
  function productionGate(input){
    input=input||{};const projects=arr(input.goldenProjects),slo=input.slo||evaluateSlo({}),types=new Set(projects.map(x=>x.type)),checks=[
      {key:"golden-count",label:"真实黄金项目5—20个",ok:projects.length>=5&&projects.length<=20},
      {key:"type-coverage",label:"覆盖出租、出售、非居改保",ok:["rent","sale","gaibao"].every(x=>types.has(x))},
      {key:"numeric-errors",label:"关键数字错误为0",ok:projects.length>0&&projects.every(x=>Number(x.numericErrors||0)===0)},
      {key:"slo",label:"50人核心路径达到SLO",ok:slo.passed===true}
    ];
    return {passed:checks.every(x=>x.ok),checks,goldenCount:projects.length,slo};
  }
  const api={METRICS,parseMeeting,normalizeScenario,compareScenarios,auditDecisionPackage,buildDecisionPackage,evaluateSlo,productionGate,id};
  root.InvestmentOps=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
