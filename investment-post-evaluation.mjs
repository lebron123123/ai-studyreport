// Deterministic post-evaluation contract. No model may calculate these results.
const invalid=message=>{throw Object.assign(new Error(message),{status:400});};
const text=(v,max=1000)=>{if(typeof v!=='string'||v.length>max)invalid('字段类型或长度不合法');return v.trim();};
export function evaluationDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)invalid('日期无效');
 return value;
}
export function normalizeEvaluationMetric(input){
 const x=input||{},metricKey=text(x.metricKey,80),unit=text(x.unit,40),currency=text(x.currency,20),basis=text(x.basis,500);
 if(!metricKey||!unit||!currency||!basis)invalid('指标、单位、币种和口径不可为空');
 const periodStart=evaluationDate(x.periodStart),periodEnd=evaluationDate(x.periodEnd);
 if(periodEnd<periodStart)invalid('期间结束不能早于开始');
 if(/irr|内部收益率/i.test(metricKey))invalid('本期不把预测IRR作为已实现实际值，也不平均IRR');
 return {metricKey,unit,currency,basis,periodStart,periodEnd};
}
const identity=x=>JSON.stringify([x.metricKey,x.unit,x.currency,x.basis,x.periodStart,x.periodEnd]);
export function buildEvaluationComparison(targets,actuals,exclusions=[]){
 if(!Array.isArray(targets)||!targets.length||targets.length>100||!Array.isArray(actuals)||actuals.length>5000||!Array.isArray(exclusions))invalid('评价需1至100项目标和有效实际列表');
 const seen=new Set(),actualLatest=new Map(),excludedByIdentity=new Map();
 for(const exclusion of exclusions){
  const key=identity(normalizeEvaluationMetric(exclusion)),reason=text(exclusion.reason,1000);
  if(!reason)invalid('不适用必须说明原因');
  if(excludedByIdentity.has(key))invalid('同指标不适用说明重复');
  excludedByIdentity.set(key,reason);
 }
 for(const a of actuals){const key=identity(a),old=actualLatest.get(key);if(!old||Number(a.version)>Number(old.version))actualLatest.set(key,a);else if(Number(a.version)===Number(old.version)&&a.id!==old.id)invalid('同口径实际存在重复版本，须先核对');}
 const rows=targets.map(t=>{
  const m=normalizeEvaluationMetric(t),key=identity(m);if(seen.has(key))invalid('目标指标口径重复');seen.add(key);
  if(typeof t.value!=='number'||!Number.isFinite(t.value))invalid('目标值必须为有限数字，不能用空值代替0');
  if(excludedByIdentity.has(key))return {...m,target:t.value,actual:null,delta:null,status:'not_applicable',reason:excludedByIdentity.get(key)};
  const a=actualLatest.get(key);
  if(!a)return {...m,target:t.value,actual:null,delta:null,status:'missing',reason:'缺少相同期间、单位、币种和口径的实际；不摊分或折算'};
  if(a.requiresReview||a.currentSourceStatus&&a.currentSourceStatus!=='valid')return {...m,target:t.value,actual:null,delta:null,status:'source_invalid',actualId:a.id,reason:'实际来源已变化或失效，待重新核验'};
  if(typeof a.value!=='number'||!Number.isFinite(a.value))invalid('实际值无效，不能将缺失值计为0');
  return {...m,target:t.value,actual:a.value,delta:a.value-t.value,relativeDelta:t.value===0?null:(a.value-t.value)/Math.abs(t.value),status:'comparable',actualId:a.id,actualVersion:a.version,sourceEvidenceId:a.sourceEvidenceId,sourceHash:a.sourceHash,reason:''};
 });
 for(const key of excludedByIdentity.keys())if(!seen.has(key))invalid('不适用说明未匹配目标的完整口径，请核对单位、币种、期间和计量口径');
 const applicable=rows.filter(x=>x.status!=='not_applicable').length,compared=rows.filter(x=>x.status==='comparable').length;
 return {rows,coverage:{total:rows.length,applicable,compared,missing:rows.filter(x=>x.status==='missing').length,invalid:rows.filter(x=>x.status==='source_invalid').length,notApplicable:rows.length-applicable,ratio:applicable?compared/applicable:null},score:null,warning:'覆盖率不是绩效分；评价发布不等于整改完成。'};
}
export function normalizeContractClause(input){
 const x=input||{},clauseId=text(x.clauseId,100),title=text(x.title,500),quote=text(x.quote,12000),locator=text(x.locator,1000),obligor=text(x.obligor,300),condition=text(x.condition,2000);
 if(!clauseId||!title||!quote||!locator||!obligor)invalid('条款需稳定编号、标题、原文、定位和义务人');
 if(!['unknown','unmet','met','unconditional'].includes(x.conditionStatus))invalid('条件状态不合法');
 if(!['signed','effective','changed','terminated'].includes(x.lifecycle))invalid('协议状态不合法');
 if(x.conditionStatus!=='unconditional'&&!condition)invalid('条件事项须说明前置条件');
 const date=x.triggerDate?evaluationDate(x.triggerDate):null;
 if(x.offsetDays!==null&&x.offsetDays!==undefined&&(!Number.isSafeInteger(x.offsetDays)||x.offsetDays<0||x.offsetDays>36500))invalid('期限天数无效');
 const activated=['effective','changed'].includes(x.lifecycle)&&['met','unconditional'].includes(x.conditionStatus)&&!!date;
 if(activated&&(!text(x.triggerEvidenceId||'',100)||!text(x.triggerLocator||'',1000)))invalid('起算必须有已经核验的触发证据及定位');
 const deadline=activated&&Number.isSafeInteger(x.offsetDays)?new Date(Date.parse(date)+x.offsetDays*86400000).toISOString().slice(0,10):null;
 return {clauseId,title,quote,locator,obligor,condition,conditionStatus:x.conditionStatus,lifecycle:x.lifecycle,triggerDate:date,triggerEvidenceId:x.triggerEvidenceId||'',triggerLocator:x.triggerLocator||'',offsetDays:x.offsetDays??null,deadline,activated};
}
export const evaluationTableHeaders=Object.freeze({comparison:['指标','目标','实际','差异','单位','期间','口径','状态/原因'],evidence:['指标','证据ID','证据版本','原文定位','核验状态'],rectification:['问题','责任人','期限及依据','整改任务','状态'],review:['整改任务','提交证据','复核人','复核结论','复核时间']});
