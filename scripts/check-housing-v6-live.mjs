import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {ensureSeeds,validateSet} from '../functions/api/reportlogic.js';
const url=new URL(process.env.DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
const db=createD1Shim(url.toString());
const current=()=>db.prepare("SELECT id,version,data FROM report_logic_sets WHERE project_type='gaibao' AND status='published' ORDER BY version DESC LIMIT 1").first();
try{
 const before=await current(),old=JSON.parse(before.data);
 console.log(JSON.stringify({before:{version:before.version,logicVersions:old.logicVersions,baseline:old.source?.baselineId,rules:old.rules.length}}));
 console.log(JSON.stringify({structure:old.structure?.scenarioStructures,housingChapters:[...new Set(old.rules.filter(r=>r.scenarios?.includes('housing_conversion')).map(r=>r.scenarioVariants?.housing_conversion?.chapter||r.chapter))]}));
 if(process.argv.includes('--publish')){
  await ensureSeeds({DB:db});const after=await current(),data=JSON.parse(after.data);
  assert.equal(data.source.baselineId,'housing-manager-v6-20260908-table-fix');
  const project=(d,s)=>d.rules.filter(r=>r.scenarios?.includes(s)).map(r=>({id:r.id,...r.scenarioVariants?.[s]}));
  assert.ok(JSON.stringify(project(data,'commercial_renovation'))===JSON.stringify(project(validateSet(old,'gaibao'),'commercial_renovation')),'Commercial effective rules changed');
  await ensureSeeds({DB:db});assert.equal((await current()).id,after.id);
  console.log(JSON.stringify({after:{version:after.version,logicVersions:data.logicVersions,rules:data.rules.length},commercialUnchanged:true,idempotent:true}));
 }
}finally{await db._close();}
