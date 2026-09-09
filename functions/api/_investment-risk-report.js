// Draft-only report adapter. Immutable server facts; no risk mutation or formal sign-off.
import {ensureInvestmentWatch,readInvestmentWatch} from './_investment-watch.js';
import {reportEvidenceHash as hash} from './_report-trusted-evaluation.js';
import {deliverySnapshot} from './_delivery-snapshot.js';
import {lifecycleError,lifecycleEvent} from './_lifecycle-integrity.js';
const parse=s=>JSON.parse(s||'{}');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail=(s,m)=>{throw lifecycleError(s,m);};
export const riskReportSchema="CREATE TABLE IF NOT EXISTS investment_risk_reports(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,content_hash TEXT NOT NULL,basis_hash TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_by INTEGER NOT NULL,created_at BIGINT NOT NULL,UNIQUE(project_id,request_id))";
export async function ensureRiskReports(env){await ensureInvestmentWatch(env);await env.DB.prepare(riskReportSchema).run();}
function selection(b){
 if(!['single','project','week','month'].includes(b.scope))fail(400,'请选择单项、项目、本周或本月报告');
 if(b.scope==='single'&&(typeof b.riskId!=='string'||!b.riskId||b.riskId.length>150))fail(400,'请选择当前项目的风险');
 return {scope:b.scope,riskId:b.scope==='single'?b.riskId:''};
}
async function basis(env,actor,access,selected){
 const watch=await readInvestmentWatch(env,actor,access,selected.scope==='month'?'month':'week',['single','project'].includes(selected.scope));
 // Freeze the exact records alongside the last check's own source versions; never relabel current facts as old evidence.
 const rows=(await env.DB.prepare('SELECT id,kind,version,status,payload_json,source_id,source_hash,verified_by,updated_at FROM investment_formal_facts WHERE project_id=? ORDER BY id').bind(access.row.id).all()).results||[];
 const facts=rows.map(r=>({...r,payload:parse(r.payload_json),payload_json:undefined}));
 const sources=(await env.DB.prepare('SELECT id,content_hash,file_name,size_bytes,created_at FROM report_source_artifacts WHERE project_id=? ORDER BY id').bind(access.row.id).all()).results||[];
 const check=(await env.DB.prepare('SELECT id,checked_at,result_json FROM investment_check_runs WHERE project_id=? ORDER BY checked_at DESC,id DESC LIMIT 1').bind(access.row.id).all()).results?.[0];
 const items=selected.scope==='single'?watch.view.items.filter(r=>r.id===selected.riskId):watch.view.items;
 if(selected.scope==='single'&&!items.length)fail(404,'风险不存在或不属于当前项目');
 const referenced=watch.schedule.last.sourceVersions||[];
 const changed=referenced.some(v=>!facts.some(f=>f.id===v.id&&Number(f.version)===Number(v.version)&&f.source_hash===v.sourceHash))||facts.some(f=>!referenced.some(v=>v.id===f.id));
 return {schemaVersion:1,templateVersion:'risk-draft-v1',selection:selected,project:{id:access.row.id,name:access.row.name},asOf:watch.view.asOf,startDate:watch.view.startDate,periodNotice:selected.scope==='project'?'当前项目全部已记录事项，不等于完整业务覆盖。':watch.view.notice,coverage:{...watch.view.coverage,fresh:watch.schedule.fresh,checked:watch.schedule.last.checked??0,expected:watch.schedule.last.expected??null,unknown:watch.schedule.last.unknown??null,watermark:watch.schedule.watermark,notice:watch.schedule.last.notice||'尚无后台检查',sourceChangedSinceCheck:changed},totals:selected.scope==='single'?{unique:items.length,unresolved:items.filter(r=>r.unresolved).length}:watch.view.totals,risks:items,facts,sources,lastCheck:check?{id:check.id,checkedAt:Number(check.checked_at),result:parse(check.result_json)}:null};
}
export function riskDraftDocument(s){
 const titles={single:'单项风险报告',project:'项目风险报告',week:'本周风险清单',month:'本月风险清单'};
 const title=titles[s.selection.scope]+'（草稿·未签发）';
 const p=t=>'<p>'+esc(t)+'</p>';
 const table='<table><thead><tr>'+['风险事项','等级 / 状态','责任人','期限','检查依据与缺口'].map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+s.risks.map(r=>'<tr>'+[r.title,(r.unresolved?'未结':'已复核关闭')+' / '+(r.level||'待核实')+' / '+r.status,r.assignee?'用户 #'+r.assignee:'待明确',r.dueDate||'待核实',r.latest?.reason||'待核对原件'].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 const contents=[{t:'范围与检查覆盖',content:p(s.project.name)+p('截至北京时间 '+s.asOf+'；'+s.periodNotice)+p('已记录事项 '+s.totals.unique+'；未结 '+s.totals.unresolved+'。未记录不表示没有风险。')+p('已核验 '+s.coverage.checked+' / '+(s.coverage.expected??'未知')+'；'+(s.coverage.fresh&&!s.coverage.sourceChangedSinceCheck?'检查记录在有效期内，仍须核对风险':'覆盖待核实或依据已更新，不能判断健康。'))+p(s.coverage.notice)},
 {t:'风险事项表',content:s.risks.length?table:p('暂无已记录事项；请核对检查覆盖，不作无风险结论。')},
 {t:'处置建议与依据',content:s.risks.map(r=>p(r.title+'：'+(r.unresolved?'先核对原件及适用规则，明确责任人和整改计划，提交证据后由独立人员复核。':'保留复核记录，持续关注依据变化和复发。'))+p('规则 '+(r.latest?.ruleId||'待核实')+'；版本 '+(r.latest?.ruleVersion??'待核实')+'；风险轮次 '+(r.round??'历史记录'))).join('')+p('本草稿不代替企业审批，不改变风险等级、期限或关闭状态。')},
 {t:'版本与来源说明',content:p('快照时间 '+new Date(s.frozenAt).toISOString()+'；模板 '+s.templateVersion)+p('检查时的来源版本见冻结检查记录；当前归档事实仅供对照，不冒充旧检查依据。')+s.sources.map(r=>p(r.file_name+'；原件ID '+r.id+'；哈希 '+r.content_hash)).join('')}];
 return deliverySnapshot({project:s.project,chapters:[{name:title,checked:true,sections:contents}],workflow:{evidenceSnapshot:{kind:'investment-risk',scope:s.selection,sourceVersions:s.lastCheck?.result?.sourceVersions||[],frozenAt:s.frozenAt}}});
}
export async function createRiskReport(env,actor,access,b){
 const selected=selection(b);if(typeof b.requestId!=='string'||!/^[\w-]{8,100}$/.test(b.requestId))fail(400,'缺少有效请求标识，请重试');
 const requestHash=await hash(selected),old=await env.DB.prepare('SELECT * FROM investment_risk_reports WHERE project_id=? AND request_id=?').bind(access.row.id,b.requestId).first();
 if(old){if(old.request_hash!==requestHash)fail(409,'同一请求标识不能更换报告范围');return {ok:true,report:await checkedReport(old),reused:true};}
 const input=await basis(env,actor,access,selected),basisHash=await hash(input),frozenAt=Date.now(),snapshot={...input,frozenAt,status:'draft',formal:false};
 snapshot.delivery=riskDraftDocument(snapshot);const contentHash=await hash(snapshot),id='risk-report-'+crypto.randomUUID();
 await env.DB.prepare('INSERT INTO investment_risk_reports(id,project_id,request_id,request_hash,content_hash,basis_hash,snapshot_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,access.row.id,b.requestId,requestHash,contentHash,basisHash,JSON.stringify(snapshot),actor.userId,frozenAt).run();
 await lifecycleEvent(env,actor,access.ownerUserId,access.row.id,'riskReport.drafted',{id,scope:selected.scope,contentHash});
 return {ok:true,report:{id,contentHash,snapshot,createdAt:frozenAt},reused:false};
}
async function checkedReport(row){const snapshot=parse(row.snapshot_json);if(await hash(snapshot)!==row.content_hash)fail(409,'报告快照校验失败，请联系管理员，不能继续使用');return {id:row.id,contentHash:row.content_hash,snapshot,createdAt:Number(row.created_at)};}
export async function readRiskReports(env,actor,access,q){
 if(q.get('id')){
  const row=await env.DB.prepare('SELECT * FROM investment_risk_reports WHERE project_id=? AND id=?').bind(access.row.id,q.get('id')).first();if(!row)fail(404,'报告不存在或无权查看');
  const report=await checkedReport(row);let changed=true;try{changed=await hash(await basis(env,actor,access,report.snapshot.selection))!==row.basis_hash;}catch{}
  return {ok:true,report,currentBasisChanged:changed,notice:changed?'当前风险或依据已变化；以下仍为原冻结草稿，需要重新生成后核对。':'草稿未签发；仅代表生成时的记录。'};
 }
 const offset=Number(q.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)fail(400,'分页参数不合法');
 const rows=(await env.DB.prepare('SELECT id,content_hash,created_at FROM investment_risk_reports WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?').bind(access.row.id,offset).all()).results||[];
 return {ok:true,reports:rows.slice(0,50),nextOffset:rows.length>50?offset+50:null};
}
