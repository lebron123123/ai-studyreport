// Experience-only normalization; existing finance engines remain the single calculation source.
export const resultLabels={totalInvestment:'总投资',totalIncome:'全周期总收入',totalRevenue:'全周期总收入',totalCost:'总成本',totalTax:'税费合计',totalNetProfit:'净利润合计',totalProfit:'利润合计',totalNpv:'累计净现值',npv:'净现值',irr:'全投资IRR'};
export const finite=value=>value===null||value===undefined||value===''||typeof value==='boolean'?null:(Number.isFinite(Number(value))?Number(value):null);
export const monthFields={buildStartMonth:'建设开始年月',buildEndMonth:'建设结束年月',operateStartMonth:'运营开始年月',operateEndMonth:'运营结束年月'};
export function validateMonths(params){
  const keys=Object.keys(monthFields),filled=keys.filter(key=>params[key]);
  if(!filled.length)return params;
  for(const key of keys)if(!/^(19\d{2}|20\d{2}|21\d{2}|2200)-(0[1-9]|1[0-2])$/.test(params[key]||''))throw new Error('请完整填写有效的'+monthFields[key]);
  if(params.buildEndMonth<params.buildStartMonth||params.operateEndMonth<params.operateStartMonth)throw new Error('结束年月不得早于开始年月');
  if(params.operateStartMonth<params.buildStartMonth)throw new Error('运营开始年月不得早于建设开始年月');
  return params;
}
export function isResult(metric){return Object.hasOwn(resultLabels,metric.metricKey)||metric.note==='测算结果'||metric.resultVersion==='excel'||metric.resultVersion==='system';}
export function normalizeMetric(metric){
  const out={...metric},value=finite(metric.metricValue??metric.value);
  if(/^(rampOcc|stableOcc|occupancyRamp(?:\.\d{4})?)$/.test(metric.metricKey)||/^(首年|稳定期|分年)出租率$/.test(metric.metricName)){
    // Historical manual rows stored 100 with unit=比例; engines store 1. Both mean 100%.
    const percentage=metric.unit==='比例'&&value!==null&&value>=0&&value<=1?value*100:value;
    out.metricValue=percentage;out.value=percentage;out.unit='%';out.ratioPct=percentage;
  }
  return out;
}
export function parameterValue(metric){
  const normalized=normalizeMetric(metric),value=finite(normalized.metricValue??normalized.value);
  return /^(rampOcc|stableOcc|occupancyRamp(?:\.\d{4})?)$/.test(metric.metricKey)&&normalized.unit==='%'?value/100:value;
}
export function buildParameters(metrics,original={}){
  const params=JSON.parse(JSON.stringify(original||{}));
  for(const metric of metrics){
    if(isResult(metric)&&metric.metricKey!=='totalInvestment')continue;
    const value=parameterValue(metric);if(value===null)continue;
    const match=String(metric.metricKey).match(/^(.+)\.(\d{4})$/);
    if(match){params[match[1]]={...(params[match[1]]||{}),[match[2]]:value};}else params[metric.metricKey]=value;
  }
  return params;
}
export function compareResults(metrics,system={}){
  const reference=new Map(metrics.filter(isResult).filter(x=>x.note!=='测算结果'&&x.resultVersion!=='system').map(x=>[x.metricKey,x]));
  const keys=[...new Set([...Object.keys(resultLabels),...reference.keys(),...Object.keys(system||{}).filter(k=>finite(system[k])!==null)])].filter(key=>!['totalRevenue','npv','totalProfit'].includes(key)||reference.has(key)||finite(system?.[key])!==null);
  return keys.map(key=>{const row=reference.get(key),computed=finite(system?.[key]),excel=row?finite(row.metricValue??row.value):null;return {key,name:row?.metricName||resultLabels[key]||key,unit:row?.unit||(key==='irr'?'%':'万元'),computed,excel,difference:computed!==null&&excel!==null?computed-excel:null};});
}
