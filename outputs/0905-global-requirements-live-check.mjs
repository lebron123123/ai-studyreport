// 只读核对：不发布、不修改任何用户项目或正式逻辑。
import pg from '../local-server/node_modules/pg/lib/index.js';
import {signToken} from '../functions/api/_auth.js';
import policy from '../report-writing-policy.js';
import assert from 'node:assert/strict';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
  const owner=(await db.query('SELECT p.user_id,u.username FROM projects p JOIN users u ON u.id=p.user_id WHERE p.id=$1',['1bb24013-18ce-4819-9588-09fe98e5e0c0'])).rows[0];
  assert.ok(owner,'Scoped owner missing');
  const token=await signToken(process.env,owner.user_id,owner.username);
  const response=await fetch('http://localhost:8080/api/reportlogic?projectType=gaibao',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200);const {set}=await response.json();
  assert.ok(set.data.globalRequirements.housing_conversion.includes('层级连续编号'));
  const housing=set.data.rules.filter(r=>r.scenarios?.includes('housing_conversion'));
  assert.ok(housing.every(r=>!String(r.scenarioVariants?.housing_conversion?.writingLogic||r.writingLogic).includes('全篇执行：')));
  const raw=(await db.query('SELECT data FROM report_logic_sets WHERE id=$1',[set.id])).rows[0];
  assert.deepEqual(set.data,policy.normalize(JSON.parse(raw.data)));
  console.log(JSON.stringify({api:'PASS',version:set.version,logicVersion:set.data.logicVersions?.housing_conversion||'legacy',housingRules:housing.length,wholeRequirementsChars:set.data.globalRequirements.housing_conversion.length,dbReadProjection:'PASS',userDataWrites:0}));
}finally{await db.end();}
