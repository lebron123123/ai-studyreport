import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {deliveryAction,listDeliveries,deliverySnapshot} from '../functions/api/_delivery.js';
import {approvedCaseSource} from '../functions/api/_report-case-provenance.js';
import {reportEvidenceHash} from '../functions/api/_report-trusted-evaluation.js';
import {changeProjectMember} from '../functions/api/_project-members.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {signToken} from '../functions/api/_auth.js';
import {onRequestGet as readBrain} from '../functions/api/projectbrain.js';
const target=testDatabaseUrl();
test('冻结v1/v2兼容、引用防篡改与显式恢复历史（真实隔离PostgreSQL）',{skip:!target},async t=>{
 const DB=createD1Shim(target),env={DB,SESSION_SECRET:crypto.randomUUID(),DEPLOY_MODE:'local'},pid=crypto.randomUUID();
 try{
  const makeUser=async()=>{const name='[系统测试]delivery-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'not-login','test',Date.now()).run();return Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id);};
  const owner=await makeUser(),reviewer=await makeUser();
  const original={documentRevision:4,signed:true,docNo:'[系统测试]历史编号',chapters:[{cn:1,name:'总论',sections:[{t:'投资',content:'总投资：100万元',prov:{web:[{url:'https://example.test/original',version:'v1',excerpt:'总投资：100万元'}]},logicSnapshot:{version:'19.2'},lineage:{input:'material-v1'}}]}],calcParams:{investment:999},workflow:{reportVersions:[{id:'old-report',version:1,chapters:[{name:'历史保留'}]}],calcSnapshots:[{id:'calc-current',version:1,params:{investment:999}}],currentCalcSnapshotId:'calc-current'}};
  await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(pid,owner,'[系统测试]冻结引用与恢复',JSON.stringify(original),100).run();await changeProjectMember(env,owner,pid,reviewer,'VIEWER');
  const freeze={action:'freeze',projectId:pid,reviewerId:reviewer,contract:{expected:[{label:'总投资',value:100,unit:'万元',sourceRef:'test-calculation',version:1}]}},frozen=await deliveryAction(env,owner,freeze);
  const approval={action:'approve',projectId:pid,id:frozen.id,note:'[系统测试]模拟核查非正式签发',factsReviewed:true,wordLayoutReviewed:true};
  await t.test('只改引用也使新版不再current并阻止审批，正文不变不能绕过',async()=>{
   const detail=await listDeliveries(env,owner,pid,frozen.id);assert.equal(detail.snapshot.schemaVersion,3);assert.equal(detail.snapshot.chapters[0].sections[0].paragraphs[0].id,'c1:s1:p1');
   const changed=structuredClone(original);changed.chapters[0].sections[0].prov.web[0].url='https://example.test/changed';await DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(JSON.stringify(changed),pid).run();
   assert.equal((await listDeliveries(env,owner,pid)).versions[0].current,false);await assert.rejects(()=>deliveryAction(env,reviewer,approval),/变化/);
   await DB.prepare('UPDATE projects SET data=? WHERE id=?').bind(JSON.stringify(original),pid).run();await deliveryAction(env,reviewer,approval);
  });
  const approvedBefore=await DB.prepare('SELECT * FROM report_deliveries WHERE id=?').bind(frozen.id).first();
  await t.test('存储引用篡改使读取和恢复失败，不只校验正文',async()=>{
   const bad=JSON.parse(approvedBefore.snapshot_json);bad.chapters[0].sections[0].prov.web[0].version='tampered';await DB.prepare('UPDATE report_deliveries SET snapshot_json=? WHERE id=?').bind(JSON.stringify(bad),frozen.id).run();
   await assert.rejects(()=>listDeliveries(env,owner,pid,frozen.id),/校验不一致/);
   const current=await listDeliveries(env,owner,pid);await assert.rejects(()=>deliveryAction(env,owner,{action:'restoreWorkingDraft',projectId:pid,id:frozen.id,confirmRestore:true,expectedContentHash:current.currentHash,expectedUpdatedAt:current.updatedAt}),/校验不一致/);
   await DB.prepare('UPDATE report_deliveries SET snapshot_json=? WHERE id=?').bind(approvedBefore.snapshot_json,frozen.id).run();
  });
  const legacy=deliverySnapshot(original,1),legacyHash=await reportEvidenceHash(legacy),legacyId='[系统测试]legacy-'+crypto.randomUUID();
  await DB.prepare("INSERT INTO report_deliveries(id,project_id,author_id,reviewer_id,content_hash,snapshot_json,contract_json,result_json,status,note,created_at,reviewed_at) VALUES(?,?,?,?,?,?,?,?,'approved',?,?,?)").bind(legacyId,pid,owner,reviewer,legacyHash,JSON.stringify(legacy),'{}','{"passed":true}',JSON.stringify({factsReviewed:true,wordLayoutReviewed:true}),100,101).run();
  const legacyBefore=await DB.prepare('SELECT * FROM report_deliveries WHERE id=?').bind(legacyId).first();
  await t.test('旧已签发哈希和Golden登记保持兼容，不回填引用',async()=>{
   const read=await listDeliveries(env,reviewer,pid,legacyId);assert.equal(read.current,true);assert.equal(read.integrity.referenceStatus,'unknown');assert.equal(read.snapshot.schemaVersion,undefined);
   assert.equal((await approvedCaseSource(env,owner,pid,legacyId,{current:true})).contentHash,legacyHash);
  });
  await t.test('恢复需OWNER、明确确认、CAS；保留完整原稿和所有签发历史',async()=>{
   const current=await listDeliveries(env,owner,pid),request={action:'restoreWorkingDraft',projectId:pid,id:legacyId,expectedContentHash:current.currentHash,expectedUpdatedAt:current.updatedAt};
   await assert.rejects(()=>deliveryAction(env,owner,request),/明确确认/);await assert.rejects(()=>deliveryAction(env,reviewer,{...request,confirmRestore:true}),/所有者/);await assert.rejects(()=>deliveryAction(env,owner,{...request,confirmRestore:true,expectedUpdatedAt:0}),/项目已更新/);
   const before=JSON.parse((await DB.prepare('SELECT data FROM projects WHERE id=?').bind(pid).first()).data),result=await deliveryAction(env,owner,{...request,confirmRestore:true});
   assert.equal(result.workingDraft,true);assert.equal(result.calculationsRestored,false);assert.equal(result.versionConsistency,'requires_manual_reconciliation');assert.ok(result.updatedAt>current.updatedAt);assert.equal(result.documentRevision,5);
   const after=JSON.parse((await DB.prepare('SELECT data FROM projects WHERE id=?').bind(pid).first()).data);assert.equal(after.signed,false);assert.equal(after.docNo,null);assert.equal(after.chapters[0].sections[0].syncStatus,'stale');assert.equal(after.chapters[0].sections[0].prov,null);assert.equal(after.workflow.restoredDelivery.referenceStatus,'unknown');assert.deepEqual(after.workflow.reportVersions,before.workflow.reportVersions);assert.deepEqual(after.calcParams,before.calcParams);assert.deepEqual(after.workflow.calcSnapshots,before.workflow.calcSnapshots);
   const event=await DB.prepare("SELECT payload_json FROM project_events WHERE project_id=? AND event_type='report.delivery.restored'").bind(pid).first();assert.deepEqual(JSON.parse(event.payload_json).previousData,before);
   const token=await signToken(env,owner,'[系统测试]'),feedResponse=await readBrain({env,request:new Request('http://test/api/projectbrain?projectId='+pid,{headers:{authorization:'Bearer '+token}})}),feed=await feedResponse.json();
   assert.equal(feedResponse.status,200,JSON.stringify(feed));const summary=feed.context.events.find(e=>e.eventType==='report.delivery.restored');
   assert.ok(summary);assert.equal(summary.payload.backupStored,true);assert.equal(summary.payload.previousData,undefined);assert.equal(JSON.stringify(summary).includes('previousData'),false);
   assert.deepEqual(await DB.prepare('SELECT * FROM report_deliveries WHERE id=?').bind(legacyId).first(),legacyBefore);assert.deepEqual(await DB.prepare('SELECT * FROM report_deliveries WHERE id=?').bind(frozen.id).first(),approvedBefore);
   await assert.rejects(()=>deliveryAction(env,owner,{...request,confirmRestore:true}),/变化|更新/);
  });
  await t.test('新版恢复带引用，重复并发仅一个成功且不改已签发记录',async()=>{
   const current=await listDeliveries(env,owner,pid),request={action:'restoreWorkingDraft',projectId:pid,id:frozen.id,confirmRestore:true,expectedContentHash:current.currentHash,expectedUpdatedAt:current.updatedAt};
   const results=await Promise.allSettled([deliveryAction(env,owner,request),deliveryAction(env,owner,request)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
   const data=JSON.parse((await DB.prepare('SELECT data FROM projects WHERE id=?').bind(pid).first()).data);assert.deepEqual(data.chapters[0].sections[0].prov,original.chapters[0].sections[0].prov);assert.deepEqual(data.chapters[0].sections[0].logicSnapshot,{version:'19.2'});assert.equal(data.signed,false);
   assert.deepEqual(await DB.prepare('SELECT * FROM report_deliveries WHERE id=?').bind(frozen.id).first(),approvedBefore);
  });
 }finally{await DB._close();}
});
