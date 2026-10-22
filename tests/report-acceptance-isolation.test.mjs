import test from 'node:test';
import assert from 'node:assert/strict';
import {protectIsolatedProjectSave,protectIsolatedProjectWire,taskBelongsToIsolation,SOURCE_IDS} from '../scripts/report-generation-acceptance.mjs';
import {packState} from '../research-state-codec.mjs';

function fixture(){
  const source={name:'Actual business project',sourceIdentity:{kind:'project',projectId:'immutable-original',ownerId:7,sourceSha256:'original-sha'},state:{project:{name:'Actual business project'},calcParams:{area:5973},kb:[{title:'Original material',content:'Complete parsed evidence'}]}};
  const target={id:'isolated-copy',name:'[系统测试]全量报告验收-tax-1234abcd',ownerId:7,sourceIdentity:structuredClone(source.sourceIdentity)};
  return {source,target,user:{id:7},body:{id:target.id,name:source.name,expectedUpdatedAt:123,data:{project:{name:source.name},chapters:[{name:'Chapter',sections:[{t:'Section',content:'New prose',pendingRevision:{content:'Pending prose'},executionTask:{id:'known-task'}}]}],kb:structuredClone(source.state.kb)}}};
}

test('test-only save restores metadata and outer label without changing report facts or section state',()=>{
  const f=fixture(),before=JSON.stringify(f),saved=protectIsolatedProjectSave(f.body,f.source,f.target,f.user);
  assert.equal(JSON.stringify(f),before);
  assert.equal(saved.name,f.target.name);assert.equal(saved.data.project.name,f.source.name);
  assert.deepEqual(saved.data.chapters,f.body.data.chapters);assert.deepEqual(saved.data.kb,f.body.data.kb);
  assert.equal(saved.expectedUpdatedAt,123);assert.deepEqual(saved.data.qaSourceIdentity,f.source.sourceIdentity);
  assert.equal(saved.data.qaAcceptance.id,f.target.id);assert.equal(saved.data.qaAcceptance.name,f.target.name);
  assert.match(saved.data.qaSourceStateSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(protectIsolatedProjectSave(saved,f.source,f.target,f.user),saved);
});

test('different project, action and owner are rejected rather than rewritten',()=>{
  const f=fixture();
  for(const id of [SOURCE_IDS.tax,SOURCE_IDS.longgang,'other-copy'])assert.throws(()=>protectIsolatedProjectSave({...f.body,id},f.source,f.target,f.user),/Non-isolated/);
  assert.throws(()=>protectIsolatedProjectSave({...f.body,action:'createProject'},f.source,f.target,f.user),/Non-isolated/);
  assert.throws(()=>protectIsolatedProjectSave(f.body,f.source,f.target,{id:8}),/Non-isolated/);
});

test('source/receipt mismatch and formal target IDs cannot acquire test provenance',()=>{
  const f=fixture();
  assert.throws(()=>protectIsolatedProjectSave(f.body,f.source,{...f.target,sourceIdentity:{...f.target.sourceIdentity,sourceSha256:'changed'}},f.user),/receipt identity/);
  for(const id of Object.values(SOURCE_IDS))assert.throws(()=>protectIsolatedProjectSave({...f.body,id},f.source,{...f.target,id},f.user),/receipt identity/);
  assert.throws(()=>protectIsolatedProjectSave(f.body,f.source,{...f.target,name:'Actual business project'},f.user),/receipt identity/);
});

test('existing conflicting QA fields are never silently overwritten',()=>{
  const f=fixture(),saved=protectIsolatedProjectSave(f.body,f.source,f.target,f.user);
  for(const [key,value] of [['qaSourceStateSha256','other'],['qaSourceIdentity',{...saved.data.qaSourceIdentity,projectId:'other'}],['qaAcceptance',{...saved.data.qaAcceptance,id:'other'}]])assert.throws(()=>protectIsolatedProjectSave({...saved,data:{...saved.data,[key]:value}},f.source,f.target,f.user),/Conflicting isolation provenance/);
});

test('inner business name and data shape must be correct before metadata is added',()=>{
  const f=fixture();
  assert.throws(()=>protectIsolatedProjectSave({...f.body,data:{project:{name:f.target.name}}},f.source,f.target,f.user),/report name/);
  for(const data of [null,[],undefined])assert.throws(()=>protectIsolatedProjectSave({...f.body,data},f.source,f.target,f.user),/Non-isolated/);
});

test('repair task authorization requires both exact project ID and owner',()=>{
  const f=fixture();
  assert.equal(taskBelongsToIsolation({id:'task',project_id:f.target.id,user_id:7},f.target,f.user),true);
  assert.equal(taskBelongsToIsolation({id:'task',project_id:SOURCE_IDS.tax,user_id:7},f.target,f.user),false);
  assert.equal(taskBelongsToIsolation({id:'task',project_id:f.target.id,user_id:8},f.target,f.user),false);
});

test('production full save then incremental packed saves preserve every body and QA field',async()=>{
  const f=fixture();f.body.data.kb[0].content='Complete original evidence '.repeat(200);
  const first=await protectIsolatedProjectWire(f.body,f.source,f.target,f.user);
  let baseline={id:f.target.id,name:f.target.name,role:'OWNER',updated_at:124,data:first.data};
  const browserBaseline=await packState(f.body.data),next=structuredClone(f.body.data);
  next.chapters[0].sections[0].content='First generated body '.repeat(200);
  const second=await packState(next),delta=[...second.objects].filter(([digest])=>!browserBaseline.objects.has(digest));
  assert.ok(delta.length<second.objects.size,'real production delta must omit existing source objects');
  const saved=await protectIsolatedProjectWire({id:f.target.id,name:f.source.name,expectedUpdatedAt:124,packed:{manifest:second.manifest,objects:delta}},f.source,f.target,f.user,async()=>baseline);
  assert.equal(saved.packed,undefined);assert.equal(saved.name,f.target.name);assert.deepEqual(saved.data.chapters,next.chapters);assert.deepEqual(saved.data.kb,next.kb);assert.deepEqual(saved.data.qaSourceIdentity,f.source.sourceIdentity);
  baseline={...baseline,updated_at:125,data:saved.data};
  next.chapters[0].sections[0].pendingRevision={content:'Candidate retained '.repeat(200)};
  const third=await packState(next),thirdSaved=await protectIsolatedProjectWire({id:f.target.id,expectedUpdatedAt:125,packed:{manifest:third.manifest,objects:[...third.objects].filter(([digest])=>!second.objects.has(digest))}},f.source,f.target,f.user,async()=>baseline);
  assert.deepEqual(thirdSaved.data.chapters,next.chapters);assert.equal(thirdSaved.data.qaAcceptance.id,f.target.id);
});

test('packed saves cannot use another copy, bad QA, stale CAS, missing or forged objects',async()=>{
  const f=fixture(),first=protectIsolatedProjectSave(f.body,f.source,f.target,f.user);
  const packed=await packState({...f.body.data,kb:[{content:'New evidence '.repeat(300)}]});
  const body={id:f.target.id,expectedUpdatedAt:123,packed:{manifest:packed.manifest,objects:[...packed.objects]}};
  const baseline={id:f.target.id,name:f.target.name,role:'OWNER',updated_at:123,data:first.data};
  for(const bad of [{...baseline,id:'other'},{...baseline,name:f.source.name},{...baseline,role:'EDITOR'},{...baseline,updated_at:122},{...baseline,data:{...baseline.data,qaSourceStateSha256:'wrong'}}])await assert.rejects(protectIsolatedProjectWire(body,f.source,f.target,f.user,async()=>bad),/baseline/);
  let reads=0;await assert.rejects(protectIsolatedProjectWire({...body,id:SOURCE_IDS.tax},f.source,f.target,f.user,async()=>{reads++;return baseline;}),/Non-isolated/);assert.equal(reads,0);
  await assert.rejects(protectIsolatedProjectWire({...body,data:{}},f.source,f.target,f.user,async()=>baseline),/Invalid isolated/);
  await assert.rejects(protectIsolatedProjectWire({...body,packed:{...body.packed,objects:[]}},f.source,f.target,f.user,async()=>baseline),/不完整/);
  await assert.rejects(protectIsolatedProjectWire({...body,packed:{...body.packed,objects:[[packed.objects.keys().next().value,'forged']]}},f.source,f.target,f.user,async()=>baseline),/digest/);
});
