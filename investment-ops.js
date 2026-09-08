/* Investment OS阶段4—6：会议行动化、情景决策包和生产验收。纯函数可在浏览器/Node/API复用。 */
(function(root){
  "use strict";
  const arr=x=>Array.isArray(x)?x:[];
  const txt=(x,n=600)=>String(x==null?"":x).trim().slice(0,n);
  const id=p=>(p||"io")+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,9);
  const METRICS=[
    ["irr","全投资IRR","%"],["capitalIrr","资本金IRR","%"],["npv","全投资NPV","万元"],["payback","全投资回收期","年"],["capitalPayback","资本金回收期","年"],
    ["totalInvestment","总投资","万元"],["fundingGap","资金缺口","万元"],["riskScore","风险评分","分"]
  ];
  function stableId(value){let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,"0");}
  function finite(value){return (typeof value==="number"||typeof value==="string"&&value.trim()!=="")&&Number.isFinite(Number(value));}
  function lines(value){return txt(value,20000).split(/\r?\n|[；;]/).map(x=>x.replace(/^[-*•\d.、()（）\s]+/,"").trim()).filter(Boolean);}
  function parseMeeting(value){
    const out={agenda:[],decisions:[],tasks:[],risks:[]};
    lines(value).forEach((line,i)=>{
      const source={sourceLine:i+1,text:line,sourceId:"line-"+(i+1)+"-"+stableId(line)};let matched=false;
      if(/风险|隐患|不确定|可能导致|需防范|预警/.test(line)){matched=true;out.risks.push({...source,id:"risk-"+source.sourceId,level:/重大|严重|红线|阻断/.test(line)?"high":/较大|重点/.test(line)?"medium":"normal",status:"candidate"});}
      if(/责任人|牵头|配合|完成|前提交|待办|跟进|落实|办理/.test(line)){matched=true;out.tasks.push({...source,id:"task-"+source.sourceId,owner:(line.match(/(?:责任人|牵头|由)[:：]?([^，,。；;]{2,18})/)||[])[1]||"待指定",due:(line.match(/(\d{4}[-年]\d{1,2}(?:[-月]\d{1,2}日?)?前?)/)||[])[1]||"",status:"candidate"});}
      if(/决定|同意|明确|审议通过|原则通过|形成结论|会议要求/.test(line)){matched=true;out.decisions.push({...source,id:"decision-"+source.sourceId,status:"candidate"});}
      if(!matched)out.agenda.push(source);
    });
    return {...out,summary:{agenda:out.agenda.length,decisions:out.decisions.length,tasks:out.tasks.length,risks:out.risks.length,requiresConfirmation:out.decisions.length+out.tasks.length+out.risks.length}};
  }
  function normalizeScenario(input){
    input=input||{};const kind=["baseline","optimistic","prudent","custom"].includes(input.kind)?input.kind:"custom",metrics={},invalidMetrics=[];
    const source=input.metrics||{},aliases={irr:["irr","projectIrr"],capitalIrr:["capitalIrr"],npv:["npv","totalNpv"],payback:["payback","paybackPeriod"],capitalPayback:["capitalPayback"],totalInvestment:["totalInvestment","totalInvest"],fundingGap:["fundingGap","fundGap"],riskScore:["riskScore"]};
    METRICS.forEach(([key])=>{const hit=aliases[key].find(k=>source[k]!==undefined);if(hit===undefined)return;const v=source[hit];if(finite(v))metrics[key]=Number(v);else invalidMetrics.push(key);});
    return {id:txt(input.id,100)||id("scenario"),name:txt(input.name,120)||({baseline:"基准情景",optimistic:"乐观情景",prudent:"审慎情景",custom:"自定义情景"}[kind]),kind,calcType:txt(input.calcType,30),calcSnapshotId:txt(input.calcSnapshotId,120),engine:txt(input.engine||"unverified",40),params:input.params||{},metrics,invalidMetrics:[...new Set(invalidMetrics.concat(arr(input.invalidMetrics)))],metricMeta:input.metricMeta||{},verification:input.verification||{status:"legacy_unverified"},risks:arr(input.risks).map(x=>txt(x,240)),status:["draft","selected","archived"].includes(input.status)?input.status:"draft"};
  }
  function compareScenarios(items){
    const scenarios=arr(items).map(normalizeScenario),columns=METRICS.map(([key,label,unit])=>({key,label:key==='irr'&&scenarios.some(s=>s.metricMeta.irr?.irrType==='operating')?'经营现金流IRR（非全投资）':label,unit,values:scenarios.map(s=>s.metrics[key]??null)}));
    const basis=s=>METRICS.filter(([k])=>Number.isFinite(s.metrics[k])).map(([k])=>{const m=s.metricMeta[k]||{};return [k,m.unit,m.currency,m.period,m.cashFlow,m.irrType,m.discountRate,m.engineVersion,m.configHash];});
    const reasons=[];if(scenarios.length<2)reasons.push("至少选择两个情景");
    if(scenarios.some(s=>s.verification.status!=="server_recomputed"||s.invalidMetrics.length))reasons.push("存在未经服务端复算或无效指标的情景");
    if(scenarios.some(s=>!['irr','npv','payback'].every(k=>Number.isFinite(s.metrics[k])&&s.metricMeta[k]?.unit&&s.metricMeta[k]?.currency&&s.metricMeta[k]?.period&&s.metricMeta[k]?.cashFlow&&s.metricMeta[k]?.engineVersion)))reasons.push("关键指标或单位、币种、期间、现金流口径不完整");
    if(scenarios.some(s=>s.calcType!==scenarios[0]?.calcType||JSON.stringify(basis(s))!==JSON.stringify(basis(scenarios[0]))))reasons.push("指标类型、单位、期间、币种、折现率或引擎版本不同，不能直接比较");
    return {scenarios,columns,hasBaseline:scenarios.some(x=>x.kind==="baseline"),comparable:reasons.length===0,reasons};
  }
  function auditDecisionPackage(input){
    input=input||{};const scenario=normalizeScenario(input.scenario||{}),context=input.context||{},blockers=[],warnings=[],checks=[];
    const add=(ok,label,level="blocker",detail="")=>{checks.push({ok,label,level,detail});if(!ok)(level==="blocker"?blockers:warnings).push(detail||label);};
    add(!!scenario.calcSnapshotId,"绑定白箱测算快照","blocker","情景尚未绑定可重复计算的测算快照");
    add(scenario.engine==="whitebox"&&scenario.verification.status==="server_recomputed"&&context.snapshotVerified===true,"关键数字经过服务端白箱复算","blocker","旧白箱标签或客户端指标不能证明数值来源，请重新保存可信情景");
    const required=['irr','npv','payback'].concat(scenario.calcType==='gaibao'?[]:['totalInvestment']);
    add(required.every(k=>Number.isFinite(scenario.metrics[k]))&&!scenario.invalidMetrics.length,"关键指标为有限有效值","blocker","全投资IRR、NPV、回收期及适用总投资必须完整有效，无法计算不能视为0");
    add(required.every(k=>scenario.metricMeta[k]?.unit&&scenario.metricMeta[k]?.currency&&scenario.metricMeta[k]?.period&&scenario.metricMeta[k]?.cashFlow&&scenario.metricMeta[k]?.engineVersion),"指标口径完整","blocker","指标缺少单位、币种、期间或现金流口径");
    add(arr(input.evidenceIds).length>0&&context.evidenceVerified===true,"决策证据已核实归属和状态","blocker","决策证据不存在、失效或尚未核实，不能仅以ID放行");
    add(arr(context.artifacts).some(x=>x.artifactType==="report"),"已关联可研报告","warning","尚未关联可研报告版本");
    add(arr(context.artifacts).some(x=>x.artifactType==="calculation"),"已登记测算成果","warning","Project Brain尚未登记测算成果");
    add(context.consistencyVerified===true&&!arr(input.consistencyIssues).some(x=>x.severity==="blocker"),"已完成独立复核","blocker","尚无当前正文与测算版本的独立正式复核，空问题列表不代表已审查");
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
      {key:"golden-count",label:"至少5个独立真实黄金项目",ok:new Set(projects.map(x=>x.id)).size>=5},
      {key:"type-coverage",label:"覆盖出租、出售、非居改保",ok:["rent","sale","gaibao"].every(x=>types.has(x))},
      {key:"numeric-errors",label:"受信运行确认关键数字错误为0",ok:projects.length>0&&projects.every(x=>x.serverVerified===true&&x.runId&&finite(x.numericErrors)&&Number(x.numericErrors)===0)},
      {key:"slo",label:"受信运行确认核心路径达到SLO",ok:slo.serverVerified===true&&!!slo.runId&&slo.passed===true}
    ];
    return {passed:checks.every(x=>x.ok),checks,goldenCount:projects.length,slo};
  }
  const lifecycleMounts=new WeakMap();
  function mountLifecycle(container,options){
    options=options||{};if(!container||!options.projectId)throw new Error('投资生命周期缺少项目或容器');
    lifecycleMounts.get(container)?.dispose();const controller=new AbortController(),state={closed:false,sequence:0,unbind:null},projectId=String(options.projectId),mode=options.mode==='operations'?'operations':'plan';
    const headers=()=>typeof options.headers==='function'?options.headers():options.headers||{};
    const active=()=>!state.closed&&lifecycleMounts.get(container)===state;
    const failure=message=>{if(!active())return;container.innerHTML='<section class="pm-ops-block"><p data-il-error role="alert"></p><button type="button" class="ub-btn ghost" data-il-retry>重新加载</button></section>';container.querySelector('[data-il-error]').textContent=message;container.querySelector('[data-il-retry]').onclick=()=>state.refresh();};
    state.refresh=async()=>{
      if(!active())return;const sequence=++state.sequence;state.unbind?.();state.unbind=null;
      if(!root.InvestmentLifecycle){failure('投资生命周期模块尚未加载，请刷新页面后重试');return;}
      container.innerHTML=root.InvestmentLifecycle.render(null,mode);
      try{
        const response=await fetch('/api/investmentops?projectId='+encodeURIComponent(projectId)+'&view=lifecycle',{headers:headers(),signal:controller.signal}),body=await response.json();
        if(!active()||sequence!==state.sequence)return;if(!response.ok||!body.ok)throw new Error(body.error||'投资版本与实际值暂时不可用，请重试');
        if(body.lifecycle?.projectId!==projectId)throw new Error('项目响应不匹配，已阻止显示，请重新加载');
        const namespace=body.lifecycle.actorUserId??options.userId??('isolated-'+Math.random());
        container.innerHTML=root.InvestmentLifecycle.render(body.lifecycle,mode,namespace);
        state.unbind=root.InvestmentLifecycle.bind(container,{projectId,data:body.lifecycle,namespace,refresh:state.refresh,post:async payload=>{
          if(!active())throw new Error('项目已切换，请在当前项目重新操作');const result=await fetch('/api/investmentops',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({...payload,projectId}),signal:controller.signal}),saved=await result.json();
          if(!result.ok||!saved.ok)throw new Error(saved.error||'投资记录未保存，请重试');return saved;
        }});
      }catch(error){if(active()&&sequence===state.sequence)failure(error.name==='AbortError'?'读取已取消，请重试':error.message||'投资版本与实际值加载失败，请重试');}
    };
    state.dispose=()=>{if(state.closed)return;state.closed=true;controller.abort();state.unbind?.();if(lifecycleMounts.get(container)===state)lifecycleMounts.delete(container);};
    lifecycleMounts.set(container,state);state.ready=state.refresh();return state;
  }
  const api={METRICS,parseMeeting,normalizeScenario,compareScenarios,auditDecisionPackage,buildDecisionPackage,evaluateSlo,productionGate,mountLifecycle,id};
  root.InvestmentOps=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
