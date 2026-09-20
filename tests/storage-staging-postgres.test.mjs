import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {createD1Shim} from '../local-server/d1-shim.js';
import {createResearch,stageResearchObjects,saveResearchRun,readResearch,restartResearch} from '../functions/api/_research-store.js';
import {packState} from '../research-state-codec.mjs';
const target=testDatabaseUrl();
test('分批上传可重复、半途不改正文、跨轮次拒绝、完整回读',{skip:!target},async()=>{
 const db=createD1Shim(target);
 try{
  const user=Number((await db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').first()).id);
  const ids=await createResearch(db,user,{requestId:crypto.randomUUID(),title:'[系统测试]分批保存'});
  const scope={...ids,epoch:1,expectedVersion:1};
  const state={material:'大材料甲乙丙丁'.repeat(1600000),section:'正文'};
  const packed=await packState(state),objects=[...packed.objects];
  for(const object of objects){await stageResearchObjects(db,user,{...scope,objects:[object]});await stageResearchObjects(db,user,{...scope,objects:[object]});}
  assert.deepEqual((await readResearch(db,user,ids.researchId,ids.runId)).run.state,{});
  await assert.rejects(stageResearchObjects(db,user,{...scope,objects:[[objects[0][0],'corrupt']]}));
  await assert.rejects(stageResearchObjects(db,user,{...scope,epoch:2,objects:[]}));
  const result=await saveResearchRun(db,user,{...scope,requestId:crypto.randomUUID(),packed:{manifest:packed.manifest,objects:[]}});
  assert.equal(result.acceptedVersion,2);
  assert.deepEqual((await readResearch(db,user,ids.researchId,ids.runId)).run.state,state);
  await assert.rejects(stageResearchObjects(db,user,{...scope,objects:[]}));
 }finally{await db._close();}
});
