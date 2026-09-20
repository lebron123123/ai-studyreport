import {resolveProjectAccess} from './_project-access.js';
import {parseJson} from './_report-orchestration.js';
import {deliverySnapshot,deliveryText,ensureDelivery,verifyDeliverySnapshot} from './_delivery.js';
import {deliverySchema} from './_delivery-snapshot.js';
import {reportEvidenceHash} from './_report-trusted-evaluation.js';

// A note from a client is not an approval. Bind to an independently reviewed immutable version.
export async function approvedCaseSource(env,userId,projectId,deliveryId,{current=false}={}){
  if(!deliveryId)throw new Error('必须选择已独立审签的冻结版本，不能仅凭批准说明登记Golden');
  const access=await resolveProjectAccess(env,userId,projectId);
  if(!access?.permissions.view)throw new Error('无权访问评测来源项目');
  await ensureDelivery(env);
  const row=await env.DB.prepare('SELECT * FROM report_deliveries WHERE id=? AND project_id=?').bind(deliveryId,projectId).first();
  const note=parseJson(row?.note,{});
  if(!row||row.status!=='approved'||Number(row.author_id)===Number(row.reviewer_id)||!row.reviewed_at||!note.factsReviewed||!note.wordLayoutReviewed)throw new Error('来源版本尚未完成独立事实和版式审签');
  const snapshot=await verifyDeliverySnapshot(row);
  if(current&&await reportEvidenceHash(deliverySnapshot(parseJson(access.row.data,{}),deliverySchema(snapshot)))!==row.content_hash)throw new Error('正文已变化，请重新冻结审签后登记');
  return {deliveryId:row.id,contentHash:row.content_hash,reviewerId:Number(row.reviewer_id),reviewedAt:Number(row.reviewed_at),contract:parseJson(row.contract_json,{}),approvedText:deliveryText(snapshot)};
}
