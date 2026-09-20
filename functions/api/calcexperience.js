// /api/calcexperience 财务测算经验库。待审核数据不会进入经验区间。
import {verifyAuth,json,randomHex} from './_auth.js';
import {adaptEnv} from './_adapters.js';
import {normalizeMetric,finite} from '../../calc-experience-model.mjs';

const TYPES={gaibao:'非居改保',rent:'出租类',sale:'出售类',commercial:'商业经营',other:'其他类型'};
const CATEGORIES={income:'收入',cost:'成本',tax:'税费',profit:'利润',investment:'投资',operation:'运营',parameter:'测算参数',other:'其他'};
const clean=(value,max=160)=>String(value??'').trim().slice(0,max);
const number=finite;
function admin(env,user){const users=String(env.ADMIN_USERS||'').split(',').map(x=>x.trim()).filter(Boolean);return users.includes(user.username)||users.includes(String(user.userId));}
function parseMetric(row,index){
  const metricName=clean(row.metric_name??row.metricName??row['指标名称']??row['指标'],120);
  const metricValue=number(row.metric_value??row.metricValue??row.value??row['数值']);
  if(!metricName||metricValue===null)throw new Error('第'+(index+1)+'行缺少指标名称或有效数值');
  const category=clean(row.category??row['类别']??row['指标类别'],30)||'other';
  const metricKey=clean(row.metric_key??row.metricKey??row['指标键'],100)||metricName.toLowerCase().replace(/\s+/g,'_').slice(0,100);
  let ratio=number(row.ratio_pct??row.ratioPct??row['占比%']??row['占比']);
  if(ratio!==null&&(ratio< -100000||ratio>100000))throw new Error('第'+(index+1)+'行占比超出允许范围');
  const metric=normalizeMetric({category:CATEGORIES[category]?category:'other',metricKey,metricName,metricValue,
    unit:clean(row.unit??row['单位'],24),ratioPct:ratio,periodLabel:clean(row.period_label??row.periodLabel??row['期间'],40),
    note:clean(row.note??row['备注'],300),sortOrder:index});
  if(metric.unit==='%'&&/出租率/.test(metric.metricName)&&(metric.metricValue<0||metric.metricValue>100))throw new Error('出租率须在0%至100%之间');
  return metric;
}
function presentRecord(row,user){return {id:row.id,projectId:row.project_id||'',projectName:row.project_name,projectType:row.project_type,
  typeName:TYPES[row.project_type]||row.project_type,region:row.region||'',baseYear:row.base_year,currency:row.currency,
  sourceKind:row.source_kind,sourceNote:row.source_note||'',status:row.status,username:row.username||'',createdAt:row.created_at,
  reviewedAt:row.reviewed_at,reviewedBy:row.reviewed_by||'',reviewNote:row.review_note||'',ownedByMe:Number(row.user_id)===Number(user.userId)};}

export async function onRequestGet(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);
  if(!user)return json({ok:false,error:'未登录或登录已过期'},401);
  const url=new URL(context.request.url),type=clean(url.searchParams.get('type'),30),isAdmin=admin(env,user);
  const scope=url.searchParams.get('scope')==='private'?'private':'group';
  let sql="SELECT r.*,w.scope,w.revision,w.payload FROM calc_experience_records r LEFT JOIN calc_experience_workspaces w ON w.record_id=r.id WHERE r.status<>'deleted' AND COALESCE(w.scope,'group')=?";
  const binds=[scope];
  if(scope==='private'){sql+=' AND r.user_id=?';binds.push(user.userId);}
  else if(!isAdmin){sql+=" AND (r.status='confirmed' OR r.user_id=?)";binds.push(user.userId);}
  if(type){sql+=' AND r.project_type=?';binds.push(type);}
  sql+=' ORDER BY r.created_at DESC LIMIT 300';
  const result=await env.DB.prepare(sql).bind(...binds).all(),records=(result.results||[]).map(row=>({...presentRecord(row,user),scope:row.scope||'group',revision:Number(row.revision)||1,payload:JSON.parse(row.payload||'{}')}));
  let metrics=[];
  if(records.length){
    const slots=records.map(()=>'?').join(',');
    const found=await env.DB.prepare('SELECT * FROM calc_experience_metrics WHERE record_id IN ('+slots+') ORDER BY record_id,sort_order').bind(...records.map(x=>x.id)).all();
    metrics=(found.results||[]).map(row=>normalizeMetric({id:row.id,recordId:row.record_id,category:row.category,categoryName:CATEGORIES[row.category]||row.category,
      metricKey:row.metric_key,metricName:row.metric_name,value:Number(row.metric_value),unit:row.unit||'',ratioPct:row.ratio_pct==null?null:Number(row.ratio_pct),periodLabel:row.period_label||'',note:row.note||''}));
  }
  const occupancy="(metric_key IN ('rampOcc','stableOcc') OR metric_key LIKE 'occupancyRamp.%' OR metric_name IN ('首年出租率','稳定期出租率','分年出租率'))";
  const percent="CASE WHEN unit='比例' AND metric_value BETWEEN 0 AND 1 THEN metric_value*100 ELSE metric_value END";
  const normalized="(SELECT record_id,metric_key,metric_name,category,CASE WHEN "+occupancy+" THEN '%' ELSE unit END AS unit,CASE WHEN "+occupancy+" THEN "+percent+" ELSE metric_value END AS metric_value,CASE WHEN "+occupancy+" THEN "+percent+" ELSE ratio_pct END AS ratio_pct FROM calc_experience_metrics)";
  let benchmarkSql="SELECT r.project_type,m.metric_key,m.metric_name,m.category,m.unit,COUNT(*) AS sample_count,AVG(m.metric_value) AS avg_value,MIN(m.metric_value) AS min_value,MAX(m.metric_value) AS max_value,AVG(m.ratio_pct) AS avg_ratio,MIN(m.ratio_pct) AS min_ratio,MAX(m.ratio_pct) AS max_ratio FROM "+normalized+" m JOIN calc_experience_records r ON r.id=m.record_id WHERE r.status='confirmed'";
  benchmarkSql+=" AND NOT EXISTS (SELECT 1 FROM calc_experience_workspaces w WHERE w.record_id=r.id AND w.scope='private')";
  const benchmarkBinds=[];if(type){benchmarkSql+=' AND r.project_type=?';benchmarkBinds.push(type);}benchmarkSql+=' GROUP BY r.project_type,m.metric_key,m.metric_name,m.category,m.unit ORDER BY r.project_type,m.category,m.metric_name';
  const benchmarkResult=await env.DB.prepare(benchmarkSql).bind(...benchmarkBinds).all();
  const benchmarks=(benchmarkResult.results||[]).map(x=>({projectType:x.project_type,metricKey:x.metric_key,metricName:x.metric_name,category:x.category,unit:x.unit||'',sampleCount:Number(x.sample_count),avgValue:number(x.avg_value),minValue:number(x.min_value),maxValue:number(x.max_value),avgRatio:number(x.avg_ratio),minRatio:number(x.min_ratio),maxRatio:number(x.max_ratio)}));
  let deleteRequests=[];
  if(isAdmin){const pending=await env.DB.prepare("SELECT d.*,r.project_name FROM calc_experience_delete_requests d JOIN calc_experience_records r ON r.id=d.record_id WHERE d.status='pending' ORDER BY d.created_at DESC LIMIT 200").all();deleteRequests=pending.results||[];}
  return json({ok:true,isAdmin,scope,types:TYPES,categories:CATEGORIES,records,metrics,benchmarks,deleteRequests});
}

export async function onRequestPost(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);
  if(!user)return json({ok:false,error:'未登录或登录已过期'},401);
  let body;try{body=await context.request.json();}catch{return json({ok:false,error:'请求格式有误'},400);}
  if(body.action==='requestDelete'){
    const recordId=clean(body.recordId,80),reason=clean(body.reason,300);if(!recordId||!reason)return json({ok:false,error:'请填写删除原因'},400);
    const record=await env.DB.prepare("SELECT r.id,r.user_id,r.status,w.scope FROM calc_experience_records r LEFT JOIN calc_experience_workspaces w ON w.record_id=r.id WHERE r.id=? AND r.status<>'deleted'").bind(recordId).first();
    if(!record)return json({ok:false,error:'记录不存在或已删除'},404);
    if(record.scope==='private')return json({ok:false,error:'自测项目不进入集团删除审核'},403);
    if(Number(record.user_id)!==Number(user.userId)&&!admin(env,user))return json({ok:false,error:'只能申请删除自己上传的记录'},403);
    const existing=await env.DB.prepare("SELECT id FROM calc_experience_delete_requests WHERE record_id=? AND status='pending'").bind(recordId).first();
    if(existing)return json({ok:true,id:existing.id,existing:true,message:'该记录已有待处理的删除申请'});
    const id='cedr_'+randomHex(10),now=Date.now();
    await env.DB.prepare("INSERT INTO calc_experience_delete_requests(id,record_id,reason,status,requester_user_id,requester_username,created_at) VALUES(?,?,?,'pending',?,?,?)").bind(id,recordId,reason,user.userId,user.username||'',now).run();
    return json({ok:true,id,message:'删除申请已提交，原记录在管理员处理前继续保留'});
  }
  const projectName=clean(body.projectName??body.project_name,120),projectType=clean(body.projectType??body.project_type,30);
  if(!projectName)return json({ok:false,error:'请填写项目名称'},400);
  if(!TYPES[projectType])return json({ok:false,error:'请选择有效的项目类型'},400);
  const rows=Array.isArray(body.metrics)?body.metrics:[];if(!rows.length)return json({ok:false,error:'至少需要一项收入、成本、税费或其他测算数据'},400);
  if(rows.length>800)return json({ok:false,error:'单次最多上传800项指标，请拆分后上传'},413);
  let metrics;try{metrics=rows.map(parseMetric);}catch(error){return json({ok:false,error:error.message},400);}
  const baseYear=number(body.baseYear??body.base_year);if(baseYear!==null&&(baseYear<1900||baseYear>2200))return json({ok:false,error:'基准年份不合法'},400);
  const editing=body.action==='edit',scope=body.scope==='private'?'private':'group';
  const payload=body.payload&&typeof body.payload==='object'&&!Array.isArray(body.payload)?body.payload:{};
  if(JSON.stringify(payload).length>200000)return json({ok:false,error:'测算快照过大'},413);
  const id=editing?clean(body.recordId,80):'ce_'+randomHex(12),now=Date.now(),status=scope==='private'?'confirmed':'pending';
  if(editing&&(!Number.isInteger(body.revision)||body.revision<1))return json({ok:false,error:'缺少编辑版本，请重新打开记录'},400);
  if(typeof env.DB._transaction!=='function')return json({ok:false,error:'当前存储不支持安全事务保存，请联系管理员'},503);
  const run=async db=>{
    if(editing){
      const previous=await db.prepare("SELECT r.*,w.scope,w.revision,w.payload FROM calc_experience_records r LEFT JOIN calc_experience_workspaces w ON w.record_id=r.id WHERE r.id=? AND r.status<>'deleted'").bind(id).first();
      const fail=(message,statusCode)=>{throw Object.assign(new Error(message),{statusCode});};
      if(!previous)fail('记录不存在或已删除',404);
      if(Number(previous.user_id)!==Number(user.userId)&&!(admin(env,user)&&(previous.scope||'group')==='group'))fail('无权编辑该项目',403);
      if((previous.scope||'group')!==scope)fail('不能通过编辑改变项目归属，请另行导入',400);
      await db.prepare("INSERT INTO calc_experience_workspaces(record_id,scope,revision,payload,updated_at,updated_by) VALUES(?,?,1,'{}',?,?) ON CONFLICT(record_id) DO NOTHING").bind(id,scope,now,user.userId).run();
      const reserved=await db.prepare('UPDATE calc_experience_workspaces SET revision=revision+1,payload=?,updated_at=?,updated_by=? WHERE record_id=? AND revision=?').bind(JSON.stringify(payload),now,user.userId,id,body.revision).run();
      if(Number(reserved.meta?.changes??reserved.changes??0)!==1)fail('记录已被其他操作更新，请重新打开后编辑；当前输入未保存',409);
      const oldMetrics=await db.prepare('SELECT * FROM calc_experience_metrics WHERE record_id=?').bind(id).all();
      await db.prepare('INSERT INTO calc_experience_history(id,record_id,revision,snapshot,actor_id,created_at) VALUES(?,?,?,?,?,?)').bind('ceh_'+randomHex(12),id,body.revision,JSON.stringify({record:previous,metrics:oldMetrics.results||[]}),user.userId,now).run();
      await db.prepare("UPDATE calc_experience_records SET project_name=?,project_type=?,region=?,base_year=?,source_note=?,status=?,reviewed_at=NULL,reviewed_by='',review_note='' WHERE id=?").bind(projectName,projectType,clean(body.region,120),baseYear,clean(body.sourceNote,300),status,id).run();
      await db.prepare('DELETE FROM calc_experience_metrics WHERE record_id=?').bind(id).run();
    }else{
    await db.prepare("INSERT INTO calc_experience_records(id,project_id,project_name,project_type,region,base_year,currency,source_kind,source_note,status,user_id,username,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id,clean(body.projectId??body.project_id,100),projectName,projectType,clean(body.region,120),baseYear,clean(body.currency,12)||'CNY',clean(body.sourceKind??body.source_kind,30)||'manual',clean(body.sourceNote??body.source_note,300),status,user.userId,user.username||'',now).run();
    await db.prepare('INSERT INTO calc_experience_workspaces(record_id,scope,revision,payload,updated_at,updated_by) VALUES(?,?,1,?,?,?)').bind(id,scope,JSON.stringify(payload),now,user.userId).run();
    }
    for(const metric of metrics)await db.prepare("INSERT INTO calc_experience_metrics(id,record_id,category,metric_key,metric_name,metric_value,unit,ratio_pct,period_label,note,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind('cem_'+randomHex(12),id,metric.category,metric.metricKey,metric.metricName,metric.metricValue,metric.unit,metric.ratioPct,metric.periodLabel,metric.note,metric.sortOrder).run();
  };
  try{await env.DB._transaction(run);}catch(error){if(error.statusCode)return json({ok:false,error:error.message},error.statusCode);throw error;}
  return json({ok:true,id,status,saved:metrics.length,message:scope==='private'?'自测项目已保存，仅本人可见，可立即使用':'集团项目已保存，管理员审核后进入经验区间'});
}

export async function onRequestPatch(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);
  if(!user)return json({ok:false,error:'未登录或登录已过期'},401);
  if(!admin(env,user))return json({ok:false,error:'仅管理员可审核经验数据和删除申请'},403);
  let body;try{body=await context.request.json();}catch{return json({ok:false,error:'请求格式有误'},400);}
  const now=Date.now(),note=clean(body.note,300);
  if(body.action==='confirm'||body.action==='reject'){
    const id=clean(body.recordId,80),status=body.action==='confirm'?'confirmed':'rejected';if(!id)return json({ok:false,error:'缺少记录编号'},400);
    const workspace=await env.DB.prepare('SELECT scope FROM calc_experience_workspaces WHERE record_id=?').bind(id).first();
    if(workspace?.scope==='private')return json({ok:false,error:'自测项目不参与共享审核'},403);
    await env.DB.prepare("UPDATE calc_experience_records SET status=?,reviewed_at=?,reviewed_by=?,review_note=? WHERE id=? AND status<>'deleted'").bind(status,now,user.username||String(user.userId),note,id).run();
    return json({ok:true,status});
  }
  if(body.action==='approveDelete'||body.action==='rejectDelete'){
    const requestId=clean(body.requestId,80),requestRow=await env.DB.prepare("SELECT id,record_id,status FROM calc_experience_delete_requests WHERE id=?").bind(requestId).first();
    if(!requestRow||requestRow.status!=='pending')return json({ok:false,error:'删除申请不存在或已处理'},404);
    const status=body.action==='approveDelete'?'approved':'rejected';
    const run=async db=>{await db.prepare("UPDATE calc_experience_delete_requests SET status=?,reviewed_at=?,reviewed_by=?,review_note=? WHERE id=?").bind(status,now,user.username||String(user.userId),note,requestId).run();if(status==='approved')await db.prepare("UPDATE calc_experience_records SET status='deleted',deleted_at=?,deleted_by=? WHERE id=?").bind(now,user.username||String(user.userId),requestRow.record_id).run();};
    if(typeof env.DB._transaction==='function')await env.DB._transaction(run);else await run(env.DB);
    return json({ok:true,status});
  }
  return json({ok:false,error:'不支持的审核操作'},400);
}

export async function onRequestDelete(context){
  const env=adaptEnv(context.env),user=await verifyAuth(context.request,env);
  if(!user)return json({ok:false,error:'未登录或登录已过期'},401);
  const id=clean(new URL(context.request.url).searchParams.get('id'),80);if(!id)return json({ok:false,error:'缺少记录编号'},400);
  const record=await env.DB.prepare('SELECT r.user_id,w.scope FROM calc_experience_records r LEFT JOIN calc_experience_workspaces w ON w.record_id=r.id WHERE r.id=?').bind(id).first();
  if(!record)return json({ok:false,error:'记录不存在'},404);
  if(record.scope==='private'?Number(record.user_id)!==Number(user.userId):!admin(env,user))return json({ok:false,error:'无权删除；集团项目请申请管理员审核'},403);
  await env.DB.prepare("UPDATE calc_experience_records SET status='deleted',deleted_at=?,deleted_by=? WHERE id=? AND status<>'deleted'").bind(Date.now(),user.username||String(user.userId),id).run();
  return json({ok:true,message:'记录已从经验库移除，审计记录仍保留'});
}
