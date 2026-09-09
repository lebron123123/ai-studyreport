// Risk reports share delivery review, but never borrow the feasibility working draft.
import {readRiskReports,riskDraftDocument} from './_investment-risk-report.js';
import {reportEvidenceHash as hash} from './_report-trusted-evaluation.js';
export const riskSource=s=>s?.references?.evidenceSnapshot?.reportId;
export async function riskDeliverySource(env,userId,access,id,{requireCurrent=false}={}){
 const d=await readRiskReports(env,{userId},access,new URLSearchParams({id}));
 if(requireCurrent&&d.currentBasisChanged)throw Error('风险或依据已变化，请重新生成风险报告后送审');
 const snapshot=riskDraftDocument(d.report.snapshot);
 snapshot.chapters[0].name=snapshot.chapters[0].name.replace('（草稿·未签发）','');
 for(const section of snapshot.chapters[0].sections)section.content=section.content.replace('本草稿不代替企业审批','本报告不代替项目投资审批');
 snapshot.references.evidenceSnapshot={...snapshot.references.evidenceSnapshot,reportId:id,reportHash:d.report.contentHash,frozenRiskSnapshot:d.report.snapshot};
 return {snapshot,hash:await hash(snapshot),current:!d.currentBasisChanged};
}
export function riskDeliveryQuality(snapshot){
 const s=snapshot.references.evidenceSnapshot.frozenRiskSnapshot;
 const valid=!!s&&Array.isArray(s.risks)&&s.totals.unique===s.risks.length;
 return {passed:valid,score:null,coverageComplete:false,humanReviewed:false,method:'immutable-risk-snapshot-v1',scope:'仅核对冻结模板和事项数量；不代表风险覆盖完整、事实或制度效力已核验',checks:[{kind:'risk_snapshot',passed:valid}],coverage:s?.coverage};
}
