// A contract handoff cannot outlive its confirmed clause or its trigger evidence.
import {verifyInvestmentEvidence} from './_investment-lifecycle.js';
import {reportEvidenceHash} from './_report-trusted-evaluation.js';

export async function contractObligationCurrent(env,access,detail){
 if(!detail.contractClauseId)return true;
 const row=await env.DB.prepare('SELECT version,status,payload_json FROM investment_contract_clauses WHERE id=? AND project_id=?').bind(detail.contractClauseId,access.row.id).first();
 if(!row||row.status!=='confirmed'||Number(row.version)!==detail.contractClauseVersion)return false;
 const payload=JSON.parse(row.payload_json);
 if(!payload.activated||!payload.source||!payload.trigger)return false;
 for(const proof of [payload.source,payload.trigger]){
  let current;
  try{current=await verifyInvestmentEvidence(env,access,proof.id);}
  catch(error){if([400,403,404,409].includes(error.status))return false;throw error;}
  if(await reportEvidenceHash(current)!==proof.hash)return false;
 }
 return true;
}
