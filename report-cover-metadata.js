// Cover presentation only: never rewrites a project, a calculation or a report.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.ReportCoverMetadata=factory();
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const VERSION='report-cover-metadata-20261013-v1';
  const text=value=>value==null?'':String(value).trim();
  function amount(value){
    if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
    const s=text(value).replace(/,/g,'').replace(/万元$/,'').trim();
    return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)?Number(s):null;
  }
  const sameAmount=(a,b)=>amount(a)!==null&&amount(b)!==null&&amount(a)===amount(b);
  function calculation(raw,type,id,version){
    const p=raw||{},summary=p.investEstimate?.summary||{};
    return {calcType:text(type),id:text(id),version:version??null,loan:amount(p.loan),
      totalInvestment:amount(p.totalInvestment),invest:amount(p.invest),
      buildInvestment:amount(summary.buildInvestment),
      buildComponents:['landCostTotal','preConstructionCostTotal','constructionCostTotal','indirectCostTotal','contingency'].map(key=>amount(summary[key]))};
  }
  function constructionInvestment(c){
    // These fields are construction investment / depreciation base in calc.js,
    // NOT an approved all-in investment including every cost and financing.
    if(!c||c.buildInvestment===null||!Array.isArray(c.buildComponents)||c.buildComponents.length!==5||c.buildComponents.some(x=>x===null))return null;
    // Independent estimate breakdown, not merely three aliases copied from loan.
    if(Math.round(c.buildComponents.reduce((sum,x)=>sum+x,0)*10000)!==Math.round(c.buildInvestment*10000))return null;
    const values=[c.totalInvestment,c.invest].filter(x=>x!==null);
    return values.every(x=>sameAmount(x,c.buildInvestment))?c.buildInvestment:null;
  }
  function captureContext(project,options){
    const p=project||{},o=options||{},historical=o.historical===true;
    const context={version:VERSION,mode:historical?'historical':'current',currentCalculation:null,matchingCalculations:[]};
    // Old report versions never borrow today's financial calculation. Their
    // legacy registration remains an estimate, not a newly certified total.
    if(historical)return context;
    const workflow=o.workflow||{},snapshots=Array.isArray(workflow.calcSnapshots)?workflow.calcSnapshots:[];
    const selected=snapshots.find(s=>s.id===workflow.currentCalcSnapshotId);
    context.currentCalculation=calculation(o.calcParams,o.calcType,selected?.id,selected?.version);
    // Only matching scalar evidence is exported. No materials, history bodies,
    // financial rows or complete parameter snapshots enter this metadata.
    context.matchingCalculations=snapshots.filter(Boolean).map(s=>calculation(s.params,s.calcType,s.id,s.version))
      .filter(s=>(s.calcType==='gaibao'&&sameAmount(p.scale,s.loan))||sameAmount(p.scale,constructionInvestment(s)));
    return context;
  }
  function resolve(project,context){
    const p=project||{},c=context?.version===VERSION&&context.mode==='current'?context:null;
    const fields=[],diagnostics=[];
    const add=(key,label,value,status)=>{if(text(value))fields.push({key,label,value:text(value),status});};
    add('owner','建设/委托单位',p.owner,'registered');
    const internalRule=/(?:生成逻辑|逐小节|双场景.*规则|(?:生成|编写)规则)/i;
    const scenario={housing_conversion:'非居改保（住房改造）',commercial_renovation:'商业自持改造'};
    let industry=text(p.industry);
    if(internalRule.test(industry)){
      diagnostics.push({code:'internal-rule-label',field:'industry'});
      industry=scenario[p.businessScenario]||(!internalRule.test(text(p.type))?text(p.type):'');
    }
    add('industry','报告领域',industry,'registered');
    const sites=Array.isArray(p.analysisSites)?p.analysisSites:[];
    const confirmed=[...new Set(sites.filter(s=>s?.confirmed===true).map(s=>{
      // Geocoding's "address" may contain an explanation rather than a place.
      const address=text(s.name)||text(s.query)||text(s.location)||text(s.address);
      return /(?:按.*解析|精度门址|精度住宅区)/.test(address)?'':address;
    }).filter(Boolean))];
    if(sites.length>1){
      add('location','已确认项目点位',confirmed.length?confirmed.join('；'):'【待补：确认项目各点位】',confirmed.length?'confirmed-sites':'unverified');
      if(confirmed.length<sites.length)diagnostics.push({code:'unconfirmed-sites-not-exported',field:'location'});
    }else add('location','建设地点',confirmed[0]||p.location,'registered');
    const scale=text(p.scale),scaleAmount=amount(p.scale);
    const current=c?.currentCalculation||null;
    const matches=[current,...(Array.isArray(c?.matchingCalculations)?c.matchingCalculations:[])].filter(Boolean);
    const matchedLoans=matches.filter(x=>x.calcType==='gaibao'&&sameAmount(p.scale,x.loan));
    const automaticDescription=/【参数说明】本报告(?:关键测算参数由系统|采用专门财务测算界面)/.test(text(p.desc));
    const independentConstruction=matches.some(x=>sameAmount(scaleAmount,constructionInvestment(x)));
    const ambiguousLoan=scaleAmount!==null&&automaticDescription&&matchedLoans.length>0&&!independentConstruction;
    if(ambiguousLoan){
      add('investment','投资规模','【待补：核实投资规模；原登记值与借款口径重合，未作为总投资】','unverified-loan-overlap');
      diagnostics.push({code:'legacy-ai-loan-overlap',field:'scale',registeredValue:p.scale,
        matchingSnapshotIds:matchedLoans.map(x=>x.id).filter(Boolean)});
    }else if(scale){
      add('investment','登记估算投资',scaleAmount!==null&&!/万元$/.test(scale)?scale+'万元':scale,'registered-estimate');
    }
    const build=constructionInvestment(current);
    if(build!==null){
      add('constructionInvestment','测算建设投资',String(build)+'万元（不等于批准总投资）','calculated-construction-investment');
    }else if(!scale&&current?.calcType){
      add('investment','投资规模','【待补：登记有依据的投资规模】','unverified');
    }
    return {version:VERSION,fields,lines:fields.map(f=>f.label+'：'+f.value),diagnostics};
  }
  return {version:VERSION,captureContext,resolve};
});
