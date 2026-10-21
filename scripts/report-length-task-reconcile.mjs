// Read-only reconciliation of exactly the retained QA artifact tasks.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {projectReportGapPolicy,loadReportWritingPolicy,loadReportRequirementOverrides} from '../functions/api/_report-writing-policy.js';
import {loadReportGapApprovals} from '../functions/api/_report-gap-approval.js';
import {toPgPlaceholders} from '../local-server/d1-shim.js';
const require=createRequire(import.meta.url),pg=require('../local-server/node_modules/pg');
const target='2884b7a3-960f-40c0-af89-5d19e0284836';
const dir=path.resolve('outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5/generation-runner/lg-length-one-round-20261013');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try {
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const project=(await client.query('SELECT name,data,user_id FROM projects WHERE id=$1',[target])).rows[0];
 if(!project?.name?.startsWith('[系统测试]'))throw Error('QA identity mismatch');
 const data=typeof project.data==='string'?JSON.parse(project.data):project.data;
 const db={prepare(sql){let args=[];const prepared={bind(...values){args=values;return prepared;},async all(){return {results:(await client.query(toPgPlaceholders(sql),args)).rows};},async first(){return (await prepared.all()).results[0]||null;}};return prepared;}};
 const env={DB:db,DEPLOY_MODE:'local'};
 const logic=(await client.query("SELECT project_type,version FROM report_logic_sets WHERE status='published' AND project_type='gaibao' ORDER BY version DESC")).rows;
 const rows=[];
 for(const file of (await fs.readdir(dir)).filter(f=>f.endsWith('-intent.json'))){
  const bytes=await fs.readFile(path.join(dir,file)),intent=JSON.parse(bytes);
  if(intent.projectId!==target)throw Error('Intent outside QA');
  const tasks=(await client.query('SELECT t.id,t.run_id,t.input_json,j.status,j.error_text FROM report_section_tasks t LEFT JOIN agent_jobs j ON j.run_id=t.run_id WHERE t.project_id=$1 AND t.section_key=$2',[target,intent.body.sectionKey])).rows;
  const writing=await loadReportWritingPolicy(env,data,'gaibao',intent.body.sectionKey),requirementOverrides=await loadReportRequirementOverrides(env,project.user_id,target,data);
  const options={projectKey:target,projectType:'gaibao',logicData:writing.logicData,requirementOverrides,sectionKey:intent.body.sectionKey};
  const trustedApprovals=await loadReportGapApprovals(env,data,globalThis.ReportGapWorkflow.fromSaved(data,options));
  let gapError;try{projectReportGapPolicy(data,{...options,trustedApprovals});}catch(e){gapError=e.message;}
  const [ci,si]=intent.job.split('-')[0].split('.').map(n=>+n-1),chapter=data.chapters[ci],section=chapter.sections[si];
  const correctedSectionKey=chapter.name+' / '+section.t;
  let correctedGapError;try{projectReportGapPolicy(data,{...options,trustedApprovals,sectionKey:correctedSectionKey});}catch(e){correctedGapError=e.message;}
  rows.push({file,intentSha256:crypto.createHash('sha256').update(bytes).digest('hex'),requestCharacters:JSON.stringify(intent.body).length,logicVersion:intent.body.logicVersion,gapError,correctedSectionKey,correctedGapError,tasks:tasks.map(t=>{const input=typeof t.input_json==='string'?JSON.parse(t.input_json):t.input_json;return {id:t.id,runId:t.run_id,status:t.status,error:t.error_text,promptMatches:input.system===intent.body.system&&input.user===intent.body.user};})});
 }
 const result={at:new Date().toISOString(),projectId:target,projectName:project.name,legacyResearchEpoch:data.workflow?.management?.legacyResearchEpoch,management:data.workflow?.management,logic,rows,projectBodyWrites:0,paidCalls:0};
 await client.query('ROLLBACK');
 const file=path.join(dir,'reconciliation-'+Date.now()+'.json');await fs.writeFile(file,JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify({...result,file}));
}finally{await client.end();}
