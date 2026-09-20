// Step 2 back-half foundation. Caller must supply only authorized projects.
// Current retrospective view, never presented as a historical end-of-period snapshot.
import {calendarDate} from './_investment-rule-engine.mjs';
const day=86400000;
const validDate=value=>{try{return typeof value==='string'&&Number.isFinite(calendarDate(value));}catch{return false;}};
export function investmentRiskPeriod({asOf,period='week',risks=[],coverage=[]}){
 const stamp=calendarDate(asOf);
 if(!Number.isFinite(stamp)||!['week','month'].includes(period))throw Error('无效的期间或截至日期');
 const date=new Date(stamp),start=period==='month'?Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1):stamp-((date.getUTCDay()+6)%7)*day;
 const startDate=new Date(start).toISOString().slice(0,10);
 const inPeriod=value=>validDate(value)&&value>=startDate&&value<=asOf;
 const keys=new Set(),items=[];
 for(const risk of risks){
  if(!risk.projectId||!risk.id)throw Error('风险缺少项目或事项标识');
  const key=JSON.stringify([risk.projectId,risk.id]);
  if(keys.has(key))throw Error('风险记录重复，必须先按版本核对，不能重复计数');
  keys.add(key);
  // Legacy closed/mitigated without valid independent review remains unresolved.
  const closed=risk.status==='closed'&&risk.closureVerified===true;
  const createdValid=validDate(risk.createdDate);
  if(createdValid&&risk.createdDate>asOf)continue;
  const added=createdValid&&inPeriod(risk.createdDate),escalated=inPeriod(risk.escalatedDate),due=inPeriod(risk.dueDate);
  if(closed&&!added&&!escalated&&!due)continue;
  items.push({...risk,unresolved:!closed,added,escalated,due,carryover:!closed&&createdValid&&risk.createdDate<startDate,dateUnknown:!createdValid});
 }
 const uncovered=coverage.filter(c=>c.status!=='complete'||!Number.isFinite(c.checkedAt)||!Number.isFinite(c.maxAgeMs)||c.maxAgeMs<=0||!Number.isFinite(c.now)||c.checkedAt>c.now||c.now-c.checkedAt>c.maxAgeMs);
 return {period,startDate,asOf,semantics:'current-retrospective',notice:'按当前处置状态回看；不是历史期末快照。新增、升级、到期指标可能重叠，不能相加。',items,
  totals:{unique:items.length,unresolved:items.filter(x=>x.unresolved).length,carryover:items.filter(x=>x.carryover).length,added:items.filter(x=>x.added).length,escalated:items.filter(x=>x.escalated).length,due:items.filter(x=>x.due).length},
  coverage:{status:coverage.length&&uncovered.length===0?'complete':'unknown',expected:coverage.length,uncovered:uncovered.length,empty:coverage.length===0}};
}
