// Step 2 pure foundation. No persistence, publication, or automatic risk closure.
const dayMs=86400000;
export function calendarDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('日期须为YYYY-MM-DD');
  const ms=Date.parse(value+'T00:00:00Z');
  if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==value)throw new Error('日期不存在');
  return ms;
}
export function addCalendarYears(value,years){
  const ms=calendarDate(value);
  if(!Number.isInteger(years)||years<0||years>100)throw new Error('年份跨度不合法');
  const d=new Date(ms),year=d.getUTCFullYear()+years,month=d.getUTCMonth();
  const day=Math.min(d.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate());
  return new Date(Date.UTC(year,month,day)).toISOString().slice(0,10);
}
function cents(value){
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(value))throw new Error('金额须使用元字符串且最多两位小数');
  const [integer,fraction='']=value.split('.');return BigInt(integer)*100n+BigInt(fraction.padEnd(2,'0'));
}
function unknown(reason){return {status:'unknown',reason,violation:false};}
function ruleReady(rule){return rule?.status==='published'&&!!rule.id&&!!rule.version&&!!rule.basis&&rule.applicable===true;}
// A verified adapter must supply currentValid; never infer approval from a label.
export function investmentDeviation({rule,baseline,forecast}){
  if(!ruleReady(rule))return unknown('规则未发布、缺少依据或适用范围未确认');
  if(!baseline?.currentValid||baseline.kind!=='original')return unknown('原批准基线未核验或已失效');
  if(!forecast||!['currency','amountBasis','scope'].every(k=>baseline[k]&&baseline[k]===forecast[k]))return unknown('币种、含税口径或范围不一致');
  if(!Number.isSafeInteger(rule.thresholdBps)||rule.thresholdBps<0||!['gt','gte'].includes(rule.operator))return unknown('阈值或比较符号无效');
  try{
    const base=cents(baseline.amount),estimate=cents(forecast.amount);
    if(base===0n)return unknown('原批准金额为零');
    const left=(estimate-base)*10000n,right=base*BigInt(rule.thresholdBps);
    const triggered=rule.operator==='gt'?left>right:left>=right;
    return {status:triggered?'triggered':'clear',violation:false,classification:'forecast',reason:triggered?'预计投资偏差触发阈值，非已发生超支':'预计投资偏差未触发阈值',ruleId:rule.id,ruleVersion:rule.version,baselineId:baseline.id,baselineVersion:baseline.version,comparison:{deltaCents:String(estimate-base),baselineCents:String(base),thresholdBps:rule.thresholdBps,operator:rule.operator}};
  }catch(error){return unknown(error.message);}
}
// Dates represent a configured business date, not server-local timestamps.
// Pauses are [start,end); duplicate versions of the same event are rejected.
export function effectiveDeadline({originalDue,eventId,round,changes=[],asOf,clockStart,stacking}){
  try{
    calendarDate(asOf);let due=calendarDate(originalDue);const seen=new Set(),pauses=[],extensions=[];
    for(const change of changes){
      if(!change.id||seen.has(change.id))return unknown('延期或暂停事件重复，须先选定有效版本');seen.add(change.id);
      if(!change.currentValid||!change.approvalId||!change.sourceHash||change.eventId!==eventId||change.round!==round)return unknown('延期或暂停缺少本事项本轮次的有效批准依据');
      if(change.kind==='extension'){
        const next=calendarDate(change.newDue);if(next<calendarDate(originalDue))return unknown('延期不得提前原截止日期');extensions.push(next);
      }else if(change.kind==='pause'){
        const start=calendarDate(change.start),end=calendarDate(change.end||asOf);
        if(end<start||start>calendarDate(asOf))return unknown('暂停区间无效');
        if(clockStart&&start<calendarDate(clockStart))return unknown('暂停早于计时起点，须核对批准口径');
        pauses.push([start,Math.min(end,calendarDate(asOf))]);
      }else return unknown('未知期限变更类型');
    }
    // Do not silently combine an extension and pauses without a confirmed policy.
    if(new Set(extensions).size>1)return unknown('存在不同延期截止日，须更正同一延期记录或明确取代关系');
    if(extensions.length)due=extensions[0];
    if(pauses.length&&extensions.length&&stacking!=='extension-plus-pauses')return unknown('延期与暂停叠加口径待制度确认');
    pauses.sort((a,b)=>a[0]-b[0]);let paused=0,last=null;
    for(const [start,end] of pauses){if(last&&start<=last[1])last[1]=Math.max(last[1],end);else{if(last)paused+=last[1]-last[0];last=[start,end];}}
    if(last)paused+=last[1]-last[0];
    return {status:'known',originalDue,effectiveDue:new Date(due+paused).toISOString().slice(0,10),pausedDays:paused/dayMs,basisIds:[...seen]};
  }catch(error){return unknown(error.message);}
}
export function constructionDelay({rule,plannedStart,actualStart,asOf}){
  if(!ruleReady(rule)||rule.calendar!=='gregorian-clamp-feb28'||!['gt','gte'].includes(rule.operator))return unknown('日期规则或日历版本未确认');
  try{
    const threshold=addCalendarYears(plannedStart,rule.years),date=actualStart||asOf;
    const current=calendarDate(date),start=calendarDate(plannedStart),limit=calendarDate(threshold);
    if(actualStart&&current>calendarDate(asOf))return unknown('实际开工日期不能晚于检查日期');
    const major=rule.operator==='gt'?current>limit:current>=limit;
    return {status:major?'triggered':current>start?'overdue':'clear',violation:false,thresholdDate:threshold,classification:actualStart?'actual_start_delay':'not_started',ruleId:rule.id,ruleVersion:rule.version};
  }catch(error){return unknown(error.message);}
}
