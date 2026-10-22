// Read-only minimal diagnostics. Never prints report prose, prompts, or credentials.
import pg from '../local-server/node_modules/pg/lib/index.js';
import {reportCandidateQuality} from '../functions/api/reportexecution.js';
const id=process.argv[2]||'1bb24013-18ce-4819-9588-09fe98e5e0c0';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
const parse=v=>typeof v==='string'?JSON.parse(v):v||{};
await db.connect();
try {
  await db.query('BEGIN READ ONLY');
  const rows=(await db.query(`SELECT t.id,t.section_key,t.created_at,t.run_id,
    jsonb_build_object('qualityContract',t.input_json::jsonb->'qualityContract',
      'qualitySlotPatch',t.input_json::jsonb->'qualitySlotPatch','outputFormat',t.input_json::jsonb->'outputFormat',
      'generationPolicyVersion',t.input_json::jsonb->'generationPolicyVersion','qualityRepair',t.input_json::jsonb->'qualityRepair',
      'outputBudget',t.input_json::jsonb->'outputBudget') AS input_json,
    j.status,l.status AS call_status,
    jsonb_build_object('text',l.response_json::jsonb->'text','finishReason',l.response_json::jsonb->'finishReason',
      'truncated',l.response_json::jsonb->'truncated') AS response_json
    FROM report_section_tasks t LEFT JOIN agent_jobs j ON j.run_id=t.run_id
    LEFT JOIN agent_call_ledger l ON l.run_id=t.run_id
    WHERE t.project_id=$1 ORDER BY t.created_at DESC LIMIT 160`,[id])).rows;
  const latest=new Map();
  for(const row of rows)if(!latest.has(row.section_key))latest.set(row.section_key,row);
  const output=[...latest.values()].map(row=>{
    const s=parse(row.input_json),response=parse(row.response_json),q=reportCandidateQuality(s,response.text||'',row.status==='completed'?'completed':row.status,response);
    const contract=s.qualityContract||{},errors=q.issues.filter(i=>i.severity==='error');
    let structured=null,jsonError=null;try{structured=JSON.parse((response.text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch(e){jsonError={parseable:false,position:Number(String(e.message).match(/position (\d+)/)?.[1]??-1),startsWithJson:/^[{[]/.test((response.text||'').trim())};}
    return {id:row.id,section:row.section_key,createdAt:row.created_at,status:row.status,error:row.error_text,policy:s.generationPolicyVersion,repair:s.qualityRepair||null,
      finishReason:response.finishReason,truncated:response.truncated,outputChars:response.text?.length||0,quality:q.status,
      errors:[...new Map(errors.map(i=>[i.code+'|'+i.message,{code:i.code,message:i.message,repairable:i.repairable}])).values()],
      headings:errors.some(i=>/heading/.test(i.code))?{required:contract.requiredHeadings,actual:structured?.blocks?.filter(b=>b.kind==='heading').map(({level,slot,text})=>({level,slot,text}))}:undefined,
      jsonError:errors.some(i=>i.code==='structured-json')?jsonError:undefined,
      maxOutputTokens:s.outputBudget?.maxTokens};
  });
  const counts=output.reduce((a,r)=>(a[r.status+':'+r.quality]=(a[r.status+':'+r.quality]||0)+1,a),{});
  const issueCounts=output.reduce((a,r)=>(r.errors.forEach(i=>a[i.code]=(a[i.code]||0)+1),a),{});
  console.log(JSON.stringify({projectId:id,inspectedTasks:rows.length,latestSections:output.length,counts,issueCounts,sections:output.filter(r=>r.quality==='blocked').map(({id,createdAt,status,error,policy,repair,maxOutputTokens,...r})=>r)},null,2));
  await db.query('ROLLBACK');
} finally {await db.end();}
