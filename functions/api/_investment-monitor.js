// Step 2 front half: explicit, persisted checks. Scheduling and remediation stay separate.
import {checkedRows,ensureFormalFacts,obligationTimingHash} from './_investment-formal-facts.js';
import {ensureObligations} from './_investment-obligations.js';
import {investmentDeviation,constructionDelay,effectiveDeadline,calendarDate} from './_investment-rule-engine.mjs';
import {lifecycleError,lifecycleEvent} from './_lifecycle-integrity.js';
const parse=s=>JSON.parse(s||'{}');
const unknown=reason=>({status:'unknown',violation:false,reason});
export async function ensureInvestmentMonitor(env){
 await ensureFormalFacts(env);await ensureObligations(env);
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS investment_check_runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,request_id TEXT NOT NULL,checked_at BIGINT NOT NULL,actor_id INTEGER NOT NULL,result_json TEXT NOT NULL,UNIQUE(project_id,request_id))').run();
}
export function investmentBusinessDate(now=Date.now()){return new Date(now+8*3600000).toISOString().slice(0,10);}
// No floating point percentage comparison; reject sub-cent or unsupported units.
export function investmentMetricYuan(value,unit){
 const text=String(value);if(!/^(0|[1-9]\d{0,13})(\.\d{1,6})?$/.test(text))throw Error('投资指标缺失或精度不能确认');
 const [a,b='']=text.split('.'),scale=unit==='元'?2:unit==='万元'?6:-1;
 if(scale<0||b.length>scale)throw Error('投资指标单位或精度不能确认');
 const c=BigInt(a)*10n**BigInt(scale)+BigInt(b.padEnd(scale,'0')||'0');
 return (c/100n)+'.'+String(c%100n).padStart(2,'0');
}
function ruleFor(facts,type,asOf){
 const candidates=facts.filter(f=>f.kind==='rule'&&f.payload.ruleType===type&&f.payload.validFrom<=asOf&&(!f.payload.validUntil||f.payload.validUntil>=asOf));
 if(candidates.length!==1||!candidates[0].currentValid)return null;
 const r=candidates[0];return {...r.payload,id:r.id,version:Number(r.version),basis:r.source_hash,status:'published',applicable:true};
}
export async function evaluateInvestmentChecks(env,access,{verifyScenario,now=Date.now()}={}){
 const asOf=investmentBusinessDate(now),facts=await checkedRows(env,access.row.id,{physical:true});
 const obligations=(await env.DB.prepare('SELECT * FROM project_obligations WHERE project_id=? ORDER BY id').bind(access.row.id).all()).results||[];
 const results=[],sourceVersions=facts.map(f=>({id:f.id,version:Number(f.version),currentValid:f.currentValid,sourceHash:f.source_hash}));
 const add=(key,title,result,extra={})=>results.push({key,title,...result,...extra});
 const clockRule=ruleFor(facts,'deadline',asOf);
 if(!obligations.length)add('deadline:coverage','交接期限',unknown('尚无交接事项，未核验覆盖范围'));
 for(const row of obligations){
  const d=parse(row.detail_json),key='deadline:'+row.id;
  try{
   const decision=facts.find(f=>f.id===d.formalFactId);
   if(!clockRule||!decision?.currentValid||Number(decision.version)!==d.formalFactVersion||!d.dueBasis){add(key,d.title,unknown('期限规则或原交接依据未核验、失效'));continue;}
   const timingHash=await obligationTimingHash(row),changes=facts.filter(f=>['extension','pause'].includes(f.kind)&&f.payload.obligationId===row.id);
   const adapted=changes.map(f=>({...f.payload,id:f.id,kind:f.kind,eventId:f.payload.targetEventId,round:f.payload.targetRound,approvalId:f.payload.decisionId,sourceHash:f.source_hash,currentValid:f.currentValid&&f.payload.targetHash===timingHash}));
   const deadline=effectiveDeadline({originalDue:d.dueDate,eventId:row.event_id,round:Number(row.round),changes:adapted,asOf,clockStart:clockRule.clockStart,stacking:clockRule.stacking});
   if(deadline.status!=='known'){add(key,d.title,deadline,{originalDue:d.dueDate,originalDeadlineExceeded:asOf>d.dueDate});continue;}
   const delta=calendarDate(asOf)-calendarDate(deadline.effectiveDue),late=clockRule.operator==='gt'?delta>0:delta>=0;
   add(key,d.title,{...deadline,status:late?'overdue':'clear',violation:false,reason:late?'交接事项超出有效期限，需核查履行情况':'尚未超出有效期限，不表示事项已履行'}, {ruleId:clockRule.id,ruleVersion:clockRule.version,obligationVersion:Number(row.version)});
  }catch{add(key,d.title,unknown('本事项检查失败，请核对日期与依据后重试'));}
 }
 const original=facts.find(f=>f.kind==='original'&&f.currentValid),baseline=original?{...original.payload,id:original.id,version:Number(original.version),kind:'original',currentValid:true}:null;
 try{
  const rule=ruleFor(facts,'investment',asOf);let forecast;
  if(rule){
   const scenarios=(await env.DB.prepare("SELECT * FROM project_scenarios WHERE project_id=? AND status='selected'").bind(access.row.id).all()).results||[];
   if(scenarios.length!==1||scenarios[0].id!==rule.scenarioId)throw Error('规则关联的唯一采纳情景已变化，请重新核对口径');
   if(!verifyScenario||!await verifyScenario(env,scenarios[0],parse(access.row.data)))throw Error('采纳情景未通过服务端复算');
   const metrics=parse(scenarios[0].metrics_json);const unit=metrics.metricMeta?.totalInvestment?.unit;
   if(unit!==rule.metricUnit||metrics.metricMeta?.totalInvestment?.currency!==rule.currency)throw Error('核验的投资单位或币种与复算引擎不一致');
   forecast={amount:investmentMetricYuan(metrics.values?.totalInvestment,unit),currency:rule.currency,amountBasis:rule.amountBasis,scope:rule.scope};
  }
  add('investment','预计总投资相对原批准偏差',investmentDeviation({rule,baseline,forecast}));
 }catch(e){add('investment','预计总投资相对原批准偏差',unknown(e.status?e.message:'采纳情景或金额口径未通过检查，请重新核对并复算'));}
 try{
  const rule=ruleFor(facts,'construction',asOf),starts=facts.filter(f=>f.kind==='started');
  if(!original||!baseline.plannedStart||rule?.scope!==baseline.scope)throw Error('原批准开工日期或适用范围未核验');
  if(starts.length>1||starts.length===1&&(!starts[0].currentValid||starts[0].payload.originalId!==original.id))throw Error('实际开工记录冲突或失效');
  add('construction','开工时间检查',constructionDelay({rule,plannedStart:baseline.plannedStart,actualStart:starts[0]?.payload.date,asOf}));
 }catch(e){add('construction','开工时间检查',unknown(e.message));}
 const unknownCount=results.filter(r=>r.status==='unknown').length;
 return {asOf,timezone:'Asia/Shanghai',status:unknownCount?'partial':'complete',expected:results.length,checked:results.length-unknownCount,unknown:unknownCount,results,sourceVersions,notice:'本次人工触发检查，非自动定时扫描；未触发不等于合规或风险关闭。历史结果不会被覆盖。'};
}
export async function runInvestmentCheck(env,actor,access,b,services){
 if(!access.permissions.manage)throw lifecycleError(403,'仅项目负责人可发起检查');
 if(typeof b.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(b.requestId))throw lifecycleError(400,'缺少有效检查请求标识');
 const old=await env.DB.prepare('SELECT * FROM investment_check_runs WHERE project_id=? AND request_id=?').bind(access.row.id,b.requestId).first();
 if(old)return {ok:true,id:old.id,reused:true,result:parse(old.result_json)};
 let result;
 try{result=await evaluateInvestmentChecks(env,access,services);}catch{result={status:'failed',expected:null,checked:0,unknown:null,results:[],notice:'本次检查读取失败，覆盖范围未知；上一轮结果仅作历史参考，请重试。'};}
 const id='check-'+crypto.randomUUID(),now=Date.now();
 await env.DB.prepare('INSERT INTO investment_check_runs(id,project_id,request_id,checked_at,actor_id,result_json) VALUES(?,?,?,?,?,?)').bind(id,access.row.id,b.requestId,now,actor.userId,JSON.stringify(result)).run();
 await lifecycleEvent(env,actor,access.ownerUserId,access.row.id,'investment.check',{id,status:result.status,expected:result.expected,checked:result.checked});
 return {ok:true,id,result};
}
export async function readInvestmentChecks(env,access){
 const rows=(await env.DB.prepare('SELECT id,checked_at,result_json FROM investment_check_runs WHERE project_id=? ORDER BY checked_at DESC,id DESC LIMIT 20').bind(access.row.id).all()).results||[];
 return {canRun:access.permissions.manage,runs:rows.map(r=>({id:r.id,checkedAt:Number(r.checked_at),...parse(r.result_json)}))};
}
