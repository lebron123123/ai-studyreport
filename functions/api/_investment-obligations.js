// Meeting identity is stable; evidence revisions never form part of an obligation key.
import {resolveProjectAccess,ensureProjectMemberships} from './_project-access.js';
import {readFormalFacts} from './_investment-formal-facts.js';
import {contractObligationCurrent} from './_investment-contract-access.js';
import {lifecycleError,lifecycleEvent,ensureLifecycleIntegrity} from './_lifecycle-integrity.js';
const fail=(s,m)=>{throw lifecycleError(s,m);};
const parse=s=>JSON.parse(s||'{}');
const text=(s,max)=>{if(typeof s!=='string'||s.length>max)fail(400,'文字字段缺失或过长');return s.trim();};
export const obligationActions=new Set(['saveHandoff','assignHandoff','acceptHandoff','returnHandoff']);
export async function ensureObligations(env){
  await ensureProjectMemberships(env);
  await ensureLifecycleIntegrity(env);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS project_obligations (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,event_id TEXT NOT NULL,obligation_type TEXT NOT NULL,round INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,detail_json TEXT NOT NULL,status TEXT NOT NULL,assignee_id INTEGER,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,UNIQUE(project_id,event_id,obligation_type,round))").run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_project_obligations_project ON project_obligations(project_id,updated_at)').run();
}
async function eligible(env,projectId,id){return id?!!(await resolveProjectAccess(env,id,projectId))?.permissions.edit:false;}
function expected(b,row){if(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0)fail(428,'请读取当前版本后重试');if(b.expectedVersion!==Number(row?.version||0))fail(409,'事项已变化，请刷新核对后重新提交');}
export async function readObligations(env,actor,access){
  const projectId=access.row.id;
  const records=(await env.DB.prepare('SELECT * FROM project_obligations WHERE project_id=? ORDER BY updated_at DESC,id').bind(projectId).all()).results||[];
  const meetings=(await env.DB.prepare('SELECT id,title,content,extraction_json FROM project_meetings WHERE project_id=? ORDER BY updated_at DESC,id').bind(projectId).all()).results||[];
  const members=(await env.DB.prepare("SELECT user_id,role FROM project_memberships WHERE project_id=? AND status='active' AND role='EDITOR'").bind(projectId).all()).results||[];
  const items=[];
  const formal=await readFormalFacts(env,actor,access);
  for(const row of records){const active=await eligible(env,projectId,Number(row.assignee_id));items.push({...parse(row.detail_json),id:row.id,eventId:row.event_id,type:row.obligation_type,round:Number(row.round),version:Number(row.version),status:active?row.status:'unassigned',storedStatus:row.status,assigneeId:active?Number(row.assignee_id):null,assignmentInvalid:!!row.assignee_id&&!active});}
  for(const item of items){const fact=formal.items.find(f=>f.id===item.formalFactId);item.requiresReview=!!item.formalFactId&&(!fact?.currentValid||Number(fact.version)!==item.formalFactVersion)||!await contractObligationCurrent(env,access,item);item.formalEvidenceLinked=!!item.formalFactId;}
  return {items,meetings:meetings.map(m=>({id:m.id,title:m.title,content:m.content})),members:[{userId:access.ownerUserId,role:'OWNER'},...members.map(m=>({userId:Number(m.user_id),role:m.role}))],canManage:access.permissions.manage,canEdit:access.permissions.edit,actorId:Number(actor.userId)};
}
export async function mutateObligation(env,actor,access,b){
  const projectId=access.row.id,now=Date.now();
  let row,detail,id,status,assigneeId;
  if(b.action==='saveHandoff'){
    if(!access.permissions.manage)fail(403,'仅项目负责人可确认或更正交接事项；这不等同正式报告审批');
    const eventId=text(b.eventId,100),type=text(b.type,100),round=b.round;
    if(!eventId||!type||!Number.isSafeInteger(round)||round<1)fail(400,'请选择会议、义务类型和有效轮次');
    const meeting=await env.DB.prepare('SELECT * FROM project_meetings WHERE id=? AND project_id=?').bind(eventId,projectId).first();
    if(!meeting)fail(404,'会议不存在或无权访问');
    row=await env.DB.prepare('SELECT * FROM project_obligations WHERE project_id=? AND event_id=? AND obligation_type=? AND round=?').bind(projectId,eventId,type,round).first();
    expected(b,row);
    if(!row&&b.newRoundConfirmed!==true)fail(400,'请明确确认首次交接或新的业务轮次；更正请选择原事项');
    const title=text(b.title,500),basis=text(b.basis,10000),dueDate=text(b.dueDate??'',10),dueBasis=text(b.dueBasis??'',1000),reason=text(b.reason,1000);
    if(!title||!basis||!reason)fail(400,'请填写事项、已核对的会议依据及确认/更正原因');
    if(dueDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||Number.isNaN(Date.parse(dueDate))||new Date(dueDate).toISOString().slice(0,10)!==dueDate))fail(400,'截止日期不合法');
    if(dueDate&&!dueBasis)fail(400,'填写期限时必须注明依据；制度未确认时请留空');
    if(!['follow_up','conditional','deferred','rejected'].includes(b.result))fail(400,'请选择已核对的会议结果');
    if(['deferred','rejected'].includes(b.result))fail(409,'暂缓或未通过不能直接生成正式后续义务；保留为会议候选待核对');
    assigneeId=b.assigneeId==null||b.assigneeId===''?null:Number(b.assigneeId);
    if(assigneeId!==null&&(!Number.isSafeInteger(assigneeId)||!await eligible(env,projectId,assigneeId)))fail(400,'责任人须为当前项目有效负责人或编辑者');
    if(row&&!['unassigned','pending','accepted','returned'].includes(row.status))fail(409,'事项已履行或正在复核，不能静默更正或重开');
    id=row?.id||'obligation-'+crypto.randomUUID();
    // Any changed basis requires acknowledgement again; no silent accepted-date changes.
    status=assigneeId?'pending':'unassigned';
    detail={title,basis,dueDate,dueBasis,result:b.result,reason,meetingTitle:meeting.title,sourceMeetingContent:meeting.content,factVersion:Number(row?.version||0)+1};
    const formal=await readFormalFacts(env,actor,access),decisions=formal.items.filter(f=>f.event_id===eventId&&f.kind==='decision'&&Number(f.round)===round);
    if(decisions.length){const decision=decisions.find(f=>f.currentValid);if(!decision||!['passed','conditional'].includes(decision.payload.result))fail(409,'本轮正式决议尚未有效核验、暂缓或未通过，不能建立后续交接');if((decision.payload.result==='conditional')!==(b.result==='conditional'))fail(409,'交接结果须与正式决议一致');detail.formalFactId=decision.id;detail.formalFactVersion=Number(decision.version);}
    else if(parse(row?.detail_json).formalFactId)fail(409,'原关联事实缺失，不允许通过更正解除核验约束');
    await env.DB.prepare('INSERT INTO project_obligations(id,project_id,event_id,obligation_type,round,version,detail_json,status,assignee_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,event_id,obligation_type,round) DO UPDATE SET version=excluded.version,detail_json=excluded.detail_json,status=excluded.status,assignee_id=excluded.assignee_id,updated_at=excluded.updated_at').bind(id,projectId,eventId,type,round,Number(row?.version||0)+1,JSON.stringify(detail),status,assigneeId,row?.created_at||now,now).run();
  }else{
    id=text(b.id,100);row=await env.DB.prepare('SELECT * FROM project_obligations WHERE id=? AND project_id=?').bind(id,projectId).first();if(!row)fail(404,'事项不存在或无权访问');expected(b,row);detail=parse(row.detail_json);
    if(['assignHandoff','acceptHandoff'].includes(b.action)&&!await contractObligationCurrent(env,access,detail))fail(409,'协议条件或来源已变化，请负责人重新核对条款，不能直接分派或承接');
    if(b.action==='acceptHandoff'&&detail.formalFactId){const fact=(await readFormalFacts(env,actor,access)).items.find(f=>f.id===detail.formalFactId);if(!fact?.currentValid||Number(fact.version)!==detail.formalFactVersion)fail(409,'交接依据已变化，请负责人核对更正后重新承接');}
    if(!['unassigned','pending','accepted','returned'].includes(row.status))fail(409,'当前状态不允许交接');
    assigneeId=row.assignee_id==null?null:Number(row.assignee_id);
    if(b.action==='assignHandoff'){
      if(!access.permissions.manage)fail(403,'仅项目负责人可分派');
      assigneeId=b.assigneeId==null||b.assigneeId===''?null:Number(b.assigneeId);
      if(assigneeId!==null&&(!Number.isSafeInteger(assigneeId)||!await eligible(env,projectId,assigneeId)))fail(400,'请选择有效项目负责人或编辑者');
      status=assigneeId?'pending':'unassigned';
    }else{
      if(Number(actor.userId)!==assigneeId||!await eligible(env,projectId,assigneeId))fail(403,'仅当前有效责任人可承接或退回');
      if(b.action==='acceptHandoff'&&row.status!=='pending')fail(409,'仅待承接事项可以承接');
      if(b.action==='returnHandoff'&&!['pending','accepted'].includes(row.status))fail(409,'当前事项不可退回');
      status=b.action==='acceptHandoff'?'accepted':'returned';
    }
    const reason=text(b.reason??'',1000);if(status!=='accepted'&&!reason)fail(400,'请填写分派或退回原因');
    detail={...detail,lastActionReason:reason};
    await env.DB.prepare('UPDATE project_obligations SET version=?,detail_json=?,status=?,assignee_id=?,updated_at=? WHERE id=? AND project_id=?').bind(Number(row.version)+1,JSON.stringify(detail),status,assigneeId,now,id,projectId).run();
  }
  await lifecycleEvent(env,actor,access.ownerUserId,projectId,'obligation.'+b.action,{id,before:row?{...parse(row.detail_json),version:Number(row.version),status:row.status,assigneeId:row.assignee_id}:null,after:{...detail,status,assigneeId,version:Number(row?.version||0)+1}});
  return {ok:true,id,version:Number(row?.version||0)+1,status};
}
