// 参数变化触发的重新评估台账。记录“为什么要重跑”，不自动修改敏感等级或正式参数。
function parse(v,f){try{return JSON.parse(v||"");}catch(e){return f;}}
const IMPORTANT_FIELDS=new Set(["ruleValue","min","max","impactLevel","role","sourcePolicy","region","projectType","effectiveDate","expiryDate","enabled","hasExpertOverride","expertValue","input","derived"]);
export function governanceTrigger(type,changes){
  const fields=[...new Set((changes||[]).flatMap(x=>x.fields||[]))],important=fields.filter(x=>IMPORTANT_FIELDS.has(x));
  if(!important.length)return null;
  let triggerType=type.startsWith("coeff_")?"formula_coefficient_change":"parameter_rule_change";
  if(important.includes("input")||important.includes("derived"))triggerType="input_schema_change";
  else if(important.includes("impactLevel"))triggerType="impact_classification_change";
  return {calcType:type.startsWith("coeff_")?type.slice(6):type,triggerType,severity:type.startsWith("coeff_")?"high":"medium",sourceKey:"param_governance",summary:"参数治理发布影响白箱校核口径",detail:{governanceType:type,fields,parameters:(changes||[]).map(x=>x.key)}};
}
function rankKeys(data){
  const out={};for(const [type,result] of Object.entries(data||{})){const rows=Array.isArray(result&&result.table)?result.table:[];out[type]=rows.slice().sort((a,b)=>(a.combinedRank||9999)-(b.combinedRank||9999)).slice(0,15).map(x=>x.key||x.k);}
  return out;
}
export function configTrigger(key,before,after){
  if(JSON.stringify(before??null)===JSON.stringify(after??null))return null;
  if(["rent","sale","gaibao","invest"].includes(key))return{calcType:key,triggerType:"formula_coefficient_change",severity:"high",sourceKey:"calc_"+key,summary:"白箱公式系数配置发生变化",detail:{configKey:key}};
  if(key==="paramrules"||key==="paramdefaults")return{calcType:"all",triggerType:"parameter_rule_change",severity:"medium",sourceKey:"calc_"+key,summary:"参数规则或默认值发生变化",detail:{configKey:key}};
  if(key==="sensitivity"){
    const a=rankKeys(before),b=rankKeys(after),changed={};
    for(const type of new Set([...Object.keys(a),...Object.keys(b)])){const old=a[type]||[],now=b[type]||[],diff=now.filter((x,i)=>old[i]!==x).length;if(diff)changed[type]={positionsChanged:diff,before:old,after:now};}
    return{calcType:Object.keys(changed).join(",")||"all",triggerType:"sensitivity_result_change",severity:"medium",sourceKey:"calc_sensitivity",summary:"敏感性结果或参数排名发生变化",detail:{rankChanges:changed}};
  }
  return null;
}
export async function ensureReviewSchema(env){
  const ts=env.DEPLOY_MODE==="local"?"BIGINT":"INTEGER";
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS param_review_events (id TEXT PRIMARY KEY,calc_type TEXT NOT NULL,trigger_type TEXT NOT NULL,severity TEXT NOT NULL DEFAULT 'medium',source_key TEXT DEFAULT '',summary TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'open',created_by TEXT DEFAULT '',created_at "+ts+" NOT NULL,handled_by TEXT DEFAULT '',handled_at "+ts+" DEFAULT 0)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_param_review_events_status ON param_review_events(status,created_at DESC)").run();
}
export async function recordReviewEvent(env,event,user="系统"){
  if(!event)return null;try{await ensureReviewSchema(env);const now=Date.now(),id="pre_"+now+"_"+Math.random().toString(36).slice(2,9);await env.DB.prepare("INSERT INTO param_review_events(id,calc_type,trigger_type,severity,source_key,summary,detail,status,created_by,created_at,handled_by,handled_at) VALUES(?,?,?,?,?,?,?,'open',?,?, '',0)").bind(id,event.calcType||"all",event.triggerType||"parameter_rule_change",event.severity||"medium",event.sourceKey||"",event.summary||"参数口径发生变化",JSON.stringify(event.detail||{}),user,now).run();return id;}catch(e){return null;}
}
export async function listReviewEvents(env,calcType){
  try{await ensureReviewSchema(env);const q=calcType&&calcType!=="all"?await env.DB.prepare("SELECT * FROM param_review_events WHERE status='open' AND (calc_type=? OR calc_type='all') ORDER BY created_at DESC LIMIT 100").bind(calcType).all():await env.DB.prepare("SELECT * FROM param_review_events WHERE status='open' ORDER BY created_at DESC LIMIT 100").all();return(q.results||[]).map(x=>({...x,detail:parse(x.detail,{})}));}catch(e){return[];}
}
