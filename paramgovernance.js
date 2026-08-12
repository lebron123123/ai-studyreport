// 白箱测算参数治理层：只决定“参数从哪里来、是否需确认、是否异常、怎样做场景验证”，
// 永远不替代 NRCalc / RentCalc / SaleCalc 的确定性计算结果。
(function(root, factory){
  if(typeof module==="object" && module.exports) module.exports = factory();
  else root.ParamGovernance = factory();
})(typeof self!=="undefined"?self:this, function(){
"use strict";

const SOURCE_LEVELS = [
  {code:"project_excel", level:1, label:"项目Excel/测算底稿", confidence:"高", manual:false},
  {code:"project_document", level:2, label:"项目正式资料", confidence:"高", manual:false},
  {code:"binding_rule", level:3, label:"适用政策/公司硬规则", confidence:"高", manual:false},
  {code:"regional_case", level:4, label:"同区域同类型案例中位数", confidence:"中", manual:true},
  {code:"general_case", level:5, label:"其他同类型案例中位数", confidence:"中", manual:true},
  {code:"industry_fallback", level:6, label:"行业规则兜底", confidence:"低", manual:true},
  {code:"expert_default", level:7, label:"专家默认值", confidence:"低", manual:true},
  {code:"manual_override", level:0, label:"人工修改/确认", confidence:"高", manual:false},
];
const SOURCE_BY_CODE = Object.fromEntries(SOURCE_LEVELS.map(x=>[x.code,x]));

// 无案例时使用的“有名称、有适用范围、有依据说明”的兜底规则，而不是伪装成模型预测。
// value 是建议初值；min/max 是硬/软边界。实际项目正式资料一旦有值，必须覆盖这里。
const FALLBACK_RULES = {
  rent: [
    {key:"buildYears",label:"建设期",value:4,min:1,max:4,unit:"年",basis:"公司审查指引：建设期原则上不超过4年"},
    {key:"loanRate",label:"贷款年利率",value:3,min:2.7,max:3.3,unit:"%",basis:"公司审查指引：3%并允许±0.3个百分点校核"},
    {key:"discountPct",label:"折现率",value:3.5,min:2,max:6,unit:"%",basis:"保障房项目常用审慎区间；仍须按项目性质确认"},
    {key:"rampOcc",label:"首年出租率",value:0.7,min:0,max:0.75,unit:"比例",basis:"公司审查指引：首年出租率不高于75%"},
    {key:"stableOcc",label:"稳定期出租率",value:0.9,min:0.8,max:0.95,unit:"比例",basis:"公司审查指引：稳定期出租率不高于95%"},
    {key:"rentRate",label:"租金递增率",value:5,min:0,max:8,unit:"%",basis:"行业兜底区间；须结合租赁合同/政策确认"},
    {key:"manageCoeff",label:"管理系数",value:0.9,min:0.5,max:1,unit:"系数",allowed:[1,0.95,0.9,0.85,0.8,0.75,0.5],basis:"公司分区域七档管理系数"},
  ],
  gaibao: [
    {key:"buildYears",label:"建设期",value:1,min:1,max:4,unit:"年",basis:"公司审查指引：建设期原则上不超过4年"},
    {key:"loanRate",label:"贷款年利率",value:3,min:2.7,max:3.3,unit:"%",basis:"公司审查指引：3%并允许±0.3个百分点校核"},
    {key:"discount",label:"折现率",value:6,min:2,max:8,unit:"%",basis:"行业兜底区间；须按项目性质确认"},
    {key:"rampOcc",label:"首年出租率",value:0.75,min:0,max:0.75,unit:"比例",basis:"公司审查指引：首年出租率不高于75%"},
    {key:"stableOcc",label:"稳定期出租率",value:0.95,min:0.5,max:0.95,unit:"比例",basis:"公司审查指引：稳定期出租率不高于95%"},
    {key:"rentRate",label:"租金递增率",value:5,min:0,max:8,unit:"%",basis:"行业兜底区间；须结合租赁合同确认"},
  ],
  sale: [
    {key:"buildYears",label:"建设期",value:5,min:1,max:6,unit:"年",basis:"出售类项目暂按行业区间，需项目进度计划确认"},
    {key:"loanRate",label:"贷款年利率",value:3,min:2.7,max:3.3,unit:"%",basis:"公司审查指引：3%并允许±0.3个百分点校核"},
    {key:"discountPct",label:"折现率",value:3.5,min:2,max:6,unit:"%",basis:"行业兜底区间；须按项目性质确认"},
    {key:"rate1",label:"首年销售率",value:1,min:0,max:1,unit:"比例",basis:"销售计划必须在0~100%内，具体值由营销计划确认"},
    {key:"commStableOcc",label:"商业稳定出租率",value:0.96,min:0,max:0.96,unit:"比例",basis:"行业审慎上限，需市场调研确认"},
  ],
};

function sourceMeta(code){ return SOURCE_BY_CODE[code] || SOURCE_BY_CODE.expert_default; }
function fallbackRuleTable(type, overrides){
  const base = (FALLBACK_RULES[type]||[]).map(x=>Object.assign({},x));
  const byKey = Object.fromEntries(base.map(x=>[x.key,x]));
  (Array.isArray(overrides)?overrides:[]).forEach(x=>{ if(x&&x.key) byKey[x.key]=Object.assign({},byKey[x.key]||{},x); });
  return Object.values(byKey);
}
function ruleMap(type, overrides){ return Object.fromEntries(fallbackRuleTable(type,overrides).map(x=>[x.key,x])); }

function resolveParameter(input){
  input=input||{};
  const candidates = [
    ["project_excel",input.projectExcel], ["project_document",input.projectDocument],
    ["binding_rule",input.bindingRule], ["regional_case",input.regionalCase],
    ["general_case",input.generalCase], ["industry_fallback",input.industryFallback],
    ["expert_default",input.expertDefault],
  ];
  for(const pair of candidates){
    const raw=pair[1], value=(raw&&typeof raw==="object"&&"value" in raw)?raw.value:raw;
    if(typeof value==="number" && isFinite(value)){
      const m=sourceMeta(pair[0]);
      return {value,sourceCode:m.code,sourceLevel:m.level,sourceLabel:m.label,confidence:m.confidence,
        requiresManualConfirmation:m.manual,evidence:(raw&&raw.evidence)||[],basis:(raw&&raw.basis)||""};
    }
  }
  return {value:null,sourceCode:"missing",sourceLevel:99,sourceLabel:"缺少可靠来源",confidence:"低",
    requiresManualConfirmation:true,evidence:[],basis:"不得猜测，请人工录入并注明依据"};
}

function metricStrength(row){
  if(row&&Number.isFinite(row.STi)) return Math.max(0,Math.abs(row.STi));
  if(row&&Number.isFinite(row.spearmanRho)) return Math.abs(row.spearmanRho);
  if(row&&Number.isFinite(row.src)) return Math.abs(row.src);
  return 0;
}
function classifyParameters(table){
  const rows=(Array.isArray(table)?table:[]).slice().sort((a,b)=>{
    const ar=Number.isFinite(a.combinedRank)?a.combinedRank:Infinity;
    const br=Number.isFinite(b.combinedRank)?b.combinedRank:Infinity;
    return ar-br || metricStrength(b)-metricStrength(a);
  });
  const n=rows.length;
  return rows.map((r,i)=>{
    const q=n? (i+1)/n : 1;
    let level=q<=0.15?"core":q<=0.35?"important":q<=0.7?"general":"low";
    const strength=metricStrength(r);
    if(strength>=0.25) level="core";
    else if(strength>=0.1 && level!=="core") level="important";
    const labels={core:"核心",important:"重要",general:"一般",low:"低影响"};
    return Object.assign({},r,{impactLevel:level,impactLabel:labels[level],impactRank:i+1});
  });
}

function anomalyChecks(type, params, paramDefs, overrides){
  params=params||{}; const out=[]; const defs=Array.isArray(paramDefs)?paramDefs:[];
  const add=(severity,key,label,message,rule,extra)=>out.push(Object.assign({severity,key,label:label||key,message,rule:rule||"",layer:"hard_rule"},extra||{}));
  defs.forEach(d=>{
    const key=d.k||d.key, v=params[key];
    // 没有补贴面积时，补贴单价/折扣/出租率不参与现金流，也不应制造无意义报警。
    if(type==="rent"&&["subsidyPrice","subsidyDiscount","subsidyStableOcc"].includes(key)&&!(Number(params.subsidyArea)>0))return;
    if(v===undefined||v===null||v==="") return;
    if(typeof v!=="number" || !isFinite(v)){ add("error",key,d.label,"不是有效数字","类型校验",{layer:"type",currentValue:v}); return; }
    if(Number.isFinite(d.lo)&&v<d.lo) add("warn",key,d.label,"低于敏感性分析有效域下限 "+d.lo,"有效域校验",{layer:"range",currentValue:v,referenceValue:d.lo});
    if(Number.isFinite(d.hi)&&v>d.hi) add("warn",key,d.label,"高于敏感性分析有效域上限 "+d.hi,"有效域校验",{layer:"range",currentValue:v,referenceValue:d.hi});
  });
  fallbackRuleTable(type,overrides).forEach(r=>{
    const v=params[r.key]; if(typeof v!=="number"||!isFinite(v)) return;
    if(Array.isArray(r.allowed)&&!r.allowed.some(x=>Math.abs(x-v)<1e-8)){const nearest=r.allowed.slice().sort((a,b)=>Math.abs(a-v)-Math.abs(b-v))[0];add("error",r.key,r.label,"不属于允许档位："+r.allowed.join("、"),r.basis,{layer:"rule",currentValue:v,referenceValue:nearest});return;}
    if(Number.isFinite(r.min)&&v<r.min) add("error",r.key,r.label,"低于规则下限 "+r.min+(r.unit||""),r.basis,{layer:"rule",currentValue:v,referenceValue:Number.isFinite(r.value)?r.value:r.min});
    if(Number.isFinite(r.max)&&v>r.max) add("error",r.key,r.label,"超过规则上限 "+r.max+(r.unit||""),r.basis,{layer:"rule",currentValue:v,referenceValue:Number.isFinite(r.value)?r.value:r.max});
  });
  const pairs = type==="rent" ? [["rampOcc","stableOcc","首年出租率不能高于稳定期出租率"]]
    : type==="gaibao" ? [["rampOcc","stableOcc","首年出租率不能高于稳定期出租率"]] : [];
  pairs.forEach(([a,b,msg])=>{ if(Number.isFinite(params[a])&&Number.isFinite(params[b])&&params[a]>params[b]) add("error",a,a,msg,"参数关系校验",{layer:"relation",currentValue:params[a],referenceValue:params[b]}); });
  if(Number.isFinite(params.loanAmount)&&Number.isFinite(params.totalInvestment)&&params.totalInvestment>0&&params.loanAmount>params.totalInvestment)
    add("error","loanAmount","总借款额","总借款额不能高于总投资","融资关系校验");
  if(type==="sale"){
    const sr=[params.rate1,params.rate2,params.rate3].filter(Number.isFinite).reduce((s,v)=>s+v,0);
    if(sr>1.000001) add("error","rate1","销售率","三年销售率合计超过100%","销售计划关系校验");
  }
  // 同一参数已有更严格的公司/政策规则报警时，隐藏重复的敏感性有效域提醒。
  const hardKeys=new Set(out.filter(x=>x.layer==="rule").map(x=>x.key));
  return out.filter(x=>!(x.layer==="range"&&hardKeys.has(x.key)));
}

// 异常解释只能由规则目标值与白箱复算产生，不能让 AI 自由编写因果。
function explainAnomalyImpacts(params, issues, evaluate){
  if(typeof evaluate!=="function") return (issues||[]).map(x=>Object.assign({},x,{impactAvailable:false}));
  const base=evaluate(params||{}),baseIrr=base&&base.summary?base.summary.irr:null;
  return (issues||[]).map(issue=>{
    if(!Number.isFinite(baseIrr)||!Number.isFinite(issue.referenceValue)||!issue.key||!Number.isFinite(params&&params[issue.key])) return Object.assign({},issue,{impactAvailable:false,baseIrr});
    const corrected=Object.assign({},params,{[issue.key]:issue.referenceValue}),result=evaluate(corrected),correctedIrr=result&&result.summary?result.summary.irr:null;
    if(!Number.isFinite(correctedIrr)) return Object.assign({},issue,{impactAvailable:false,baseIrr});
    const delta=correctedIrr-baseIrr;
    return Object.assign({},issue,{impactAvailable:true,baseIrr,correctedIrr,irrDeltaPp:delta,
      explanation:"按规则将“"+(issue.label||issue.key)+"”从 "+issue.currentValue+" 调整为 "+issue.referenceValue+" 后，白箱IRR由 "+baseIrr.toFixed(2)+"% 变为 "+correctedIrr.toFixed(2)+"%（"+(delta>=0?"+":"")+delta.toFixed(2)+"个百分点）"});
  });
}

function anomalyLayerStatus(caseCount,modelReady){
  caseCount=Math.max(0,Number(caseCount)||0);
  return [
    {level:1,code:"type",label:"单位与类型",status:"active"},
    {level:2,code:"range",label:"合法区间与档位",status:"active"},
    {level:3,code:"relation",label:"参数关系与硬规则",status:"active"},
    {level:4,code:"case_quantile",label:"同类项目分位数",status:caseCount>=20?"ready":"waiting",reason:caseCount>=20?"":"至少需要20个已确认案例"},
    {level:5,code:"multivariate",label:"多变量历史分布",status:caseCount>=50?"ready":"waiting",reason:caseCount>=50?"":"至少需要50个已确认案例"},
    {level:6,code:"model_residual",label:"RF/GBM残差哨兵",status:caseCount>=100&&modelReady?"ready":"waiting",reason:caseCount<100?"至少需要100个高质量案例并通过留出验证":modelReady?"":"模型尚未通过留出验证"},
  ];
}

// 只填补有明确内置规则的空白字段，绝不替用户发布，也不猜测项目事实。
function suggestDraftRows(rows,type,evidenceRefs){
  const rules=ruleMap(type),refs=Array.isArray(evidenceRefs)?evidenceRefs:[];
  return Object.fromEntries(Object.entries(rows||{}).map(([key,original])=>{
    const row=Object.assign({},original),rule=rules[key],filled=[];
    if(!rule) return [key,row];
    if(!Number.isFinite(row.ruleValue)&&Number.isFinite(rule.value)){row.ruleValue=rule.value;filled.push("行业建议值");}
    if(!Number.isFinite(row.min)&&Number.isFinite(rule.min)){row.min=rule.min;filled.push("下限");}
    if(!Number.isFinite(row.max)&&Number.isFinite(rule.max)){row.max=rule.max;filled.push("上限");}
    if(!row.basis&&rule.basis){row.basis=rule.basis;filled.push("规则依据");}
    if(!Array.isArray(row.evidenceRefs)||!row.evidenceRefs.length){
      const matched=refs.filter(x=>((x.label||"")+" "+(x.sourceRef||"")).includes(rule.label)).slice(0,3);
      if(matched.length){row.evidenceRefs=matched;filled.push("知识依据");}
    }
    // 已展示但尚未纳入版本库的内置规则，也要先转成“待审核草稿”，不能静默长期生效。
    if(row.status==="builtin")filled.push("内置基线转待审核版本");
    if(filled.length){row.enabled=true;row.manualRequired=["核心","重要"].includes(row.impactLevel)||row.confirmation!=="automatic";row.status="draft";row.suggestionReason="依据内置审查口径补充："+filled.join("、");}
    return [key,row];
  }));
}

function singleParameterCurve(params, key, def, evaluate, points){
  points=Math.max(3,Math.min(21,points||9));
  const base=Number(params[key]);
  if(!isFinite(base)||typeof evaluate!=="function") return [];
  let lo=def&&Number.isFinite(def.lo)?def.lo:base*0.8, hi=def&&Number.isFinite(def.hi)?def.hi:base*1.2;
  if(lo===hi){ lo=base-1; hi=base+1; }
  const out=[];
  for(let i=0;i<points;i++){
    const value=lo+(hi-lo)*i/(points-1), result=evaluate(Object.assign({},params,{[key]:value}));
    out.push({value,irr:result&&result.summary?result.summary.irr:null,npv:result&&result.summary?result.summary.totalNpv:null});
  }
  return out;
}

function jointLowSensitivityValidation(params, classified, defs, evaluate, opts){
  opts=opts||{}; const perturb=Number.isFinite(opts.perturb)?Math.abs(opts.perturb):0.1;
  const samples=Math.max(8,Math.min(256,opts.samples||64));
  const maxDelta=Number.isFinite(opts.maxIrrDeltaPp)?opts.maxIrrDeltaPp:0.5;
  const defMap=Object.fromEntries((defs||[]).map(d=>[d.k||d.key,d]));
  const low=(classified||[]).filter(x=>x.impactLevel==="low"&&Number.isFinite(params[x.key])&&params[x.key]!==0);
  const baseRes=evaluate(params), baseIrr=baseRes&&baseRes.summary?baseRes.summary.irr:null;
  if(!low.length||!Number.isFinite(baseIrr)) return {available:false,reason:"没有可验证的低影响参数或基准IRR不可计算",baseIrr,parameterCount:low.length};
  const deltas=[];
  for(let s=0;s<samples;s++){
    const p=Object.assign({},params);
    low.forEach((x,j)=>{
      const sign=((s*1103515245+j*12345)>>>j%16)&1?1:-1;
      let v=params[x.key]*(1+sign*perturb), d=defMap[x.key];
      if(d&&Number.isFinite(d.lo)) v=Math.max(d.lo,v);
      if(d&&Number.isFinite(d.hi)) v=Math.min(d.hi,v);
      p[x.key]=v;
    });
    const r=evaluate(p), irr=r&&r.summary?r.summary.irr:null;
    if(Number.isFinite(irr)) deltas.push(Math.abs(irr-baseIrr));
  }
  deltas.sort((a,b)=>a-b);
  const pick=q=>deltas.length?deltas[Math.min(deltas.length-1,Math.floor((deltas.length-1)*q))]:null;
  const p95=pick(0.95), max=deltas.length?deltas[deltas.length-1]:null;
  return {available:!!deltas.length,baseIrr,parameterCount:low.length,parameters:low.map(x=>x.key),samples:deltas.length,
    perturb,p50:pick(0.5),p95,max,threshold:maxDelta,pass:Number.isFinite(p95)&&p95<=maxDelta};
}

return {SOURCE_LEVELS,SOURCE_BY_CODE,FALLBACK_RULES,sourceMeta,fallbackRuleTable,ruleMap,resolveParameter,
  classifyParameters,anomalyChecks,explainAnomalyImpacts,anomalyLayerStatus,suggestDraftRows,singleParameterCurve,jointLowSensitivityValidation};
});
