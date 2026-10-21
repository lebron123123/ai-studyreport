import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Shim} from '../local-server/d1-shim.js';
import {testDatabaseUrl} from '../scripts/require-test-database.mjs';
import {deliveryAction,listDeliveries} from '../functions/api/_delivery.js';
import {changeProjectMember} from '../functions/api/_project-members.js';
import {loadReportWritingPolicy} from '../functions/api/_report-writing-policy.js';
import {reviewReportGaps} from '../functions/api/_report-gap-approval.js';
import {approvedCaseSource} from '../functions/api/_report-case-provenance.js';
import {hasDeliveryGapHistory} from '../functions/api/_delivery-gaps.js';
const target=testDatabaseUrl(),W=globalThis.ReportGapWorkflow;

test('隔离PostgreSQL：结构化缺口冻结、签名核实、独立复核及历史兼容',{skip:!target},async t=>{
  const DB=createD1Shim(target),env={DB,SESSION_SECRET:crypto.randomUUID(),DEPLOY_MODE:'local'},pid=crypto.randomUUID();
  try{
    const makeUser=async()=>{const name='[系统测试]gap-delivery-'+crypto.randomUUID();await DB.prepare('INSERT INTO users(username,pass_hash,salt,created_at) VALUES(?,?,?,?)').bind(name,'disabled','test',Date.now()).run();return Number((await DB.prepare('SELECT id FROM users WHERE username=?').bind(name).first()).id);};
    const owner=await makeUser(),reviewer=await makeUser();
    const saved={calcType:'rent',project:{name:'[系统测试]缺口冻结',location:'隔离地区'},calcParams:{area:10},kb:[{id:'material1',content:'本测试材料的人口统计为100人，统计范围是隔离地区。',contentHash:'declared-hash'}],chapters:[{name:'市场分析',sections:[{t:'人口需求',content:'总投资：100万元。'}]}]};
    let updatedAt=100;
    await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(pid,owner,saved.project.name,JSON.stringify(saved),updatedAt).run();await changeProjectMember(env,owner,pid,reviewer,'VIEWER');
    const persist=async()=>{updatedAt++;await DB.prepare('UPDATE projects SET data=?,updated_at=? WHERE id=?').bind(JSON.stringify(saved),updatedAt,pid).run();};
    const freeze={action:'freeze',projectId:pid,reviewerId:reviewer,contract:{expected:[{label:'总投资',value:100,unit:'万元',sourceRef:'isolated-test',version:1}]}};
    const approve=id=>({action:'approve',projectId:pid,id,note:'[系统测试]独立复核模拟，不是正式签发',factsReviewed:true,wordLayoutReviewed:true});
    const historic=await deliveryAction(env,owner,freeze);await deliveryAction(env,reviewer,approve(historic.id));
    saved.chapters[0].sections[0].content+='保留历史。';await persist();const pending3=await deliveryAction(env,owner,freeze);
    await DB.prepare("CREATE TABLE IF NOT EXISTS report_logic_sets (id TEXT PRIMARY KEY,project_type TEXT NOT NULL,name TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'draft',data TEXT NOT NULL,source_name TEXT DEFAULT '',created_at BIGINT NOT NULL,created_by TEXT DEFAULT '',published_at BIGINT)").run();
    const logic={projectType:'rent',rules:[{id:'delivery-population',chapter:'市场分析',section:'人口需求',displayTitle:'人口需求',importance:'★★★',sourceKinds:['provider'],requiredSources:'常住人口统计',writingLogic:'分析人口需求'}]},logicId='[系统测试]delivery-policy-'+crypto.randomUUID();
    await DB.prepare("INSERT INTO report_logic_sets(id,project_type,name,version,status,data,created_at) VALUES(?,'rent',?,?,'published',?,?)").bind(logicId,'[系统测试]交付需求',2000000001,JSON.stringify(logic),Date.now()).run();
    const policy=await loadReportWritingPolicy(env,saved,'rent',''),ctx=W.fromSaved(saved,{projectKey:pid,projectType:'rent',logicData:policy.logicData,requirementOverrides:{}}),derived=W.create(ctx);
    saved.workflow=W.apply({},derived.registry,{projectKey:pid,sourceRevision:derived.sourceRevision,confirmed:true,actorId:String(owner),sectionKeys:derived.sectionKeys});
    saved.chapters[0].sections[0].content='总投资：100万元。'+W.section(saved.workflow.reportGapRegistry,'市场分析 / 人口需求',{projectKey:pid,sourceRevision:derived.sourceRevision}).references.map(r=>r.text).join('');await persist();
    await t.test('旧已批准3保持历史下载，旧pending3不得借原哈希绕开新台账',async()=>{
      const old=await listDeliveries(env,reviewer,pid,historic.id);assert.equal(old.formalExportAllowed,true);assert.equal(old.current,false);assert.equal(old.snapshot.schemaVersion,3);
      assert.equal((await listDeliveries(env,owner,pid,pending3.id)).current,false);await assert.rejects(deliveryAction(env,reviewer,approve(pending3.id)),/重新冻结包含台账/);
    });
    const frozen=await deliveryAction(env,owner,freeze);
    await t.test('正文无红字仍拦截关键未核验；伪造通过缓存不影响重新检查',async()=>{
      assert.equal(frozen.result.passed,false);assert.equal(frozen.result.gapReview.unresolvedCritical.length,1);
      await DB.prepare('UPDATE report_deliveries SET result_json=? WHERE id=?').bind('{"passed":true,"score":100}',frozen.id).run();
      const detail=await listDeliveries(env,reviewer,pid,frozen.id);assert.equal(detail.snapshot.schemaVersion,4);assert.equal(detail.current,true);assert.equal(detail.formalExportAllowed,false);assert.equal(detail.result.passed,false);assert.doesNotMatch(detail.snapshot.chapters[0].sections[0].content,/【待补/);
      await assert.rejects(deliveryAction(env,reviewer,approve(frozen.id)),/重新检查未通过/);
    });
    await t.test('删除整个台账不能回退schema3或批准旧pending，已批准历史仍可下载但不是current',async()=>{
      const ledger=saved.workflow.reportGapRegistry;delete saved.workflow.reportGapRegistry;await persist();
      assert.equal(await hasDeliveryGapHistory(env,pid),true);
      await assert.rejects(deliveryAction(env,owner,freeze),/台账被移除/);
      await assert.rejects(deliveryAction(env,reviewer,approve(pending3.id)),/重新冻结包含台账/);
      const old=await listDeliveries(env,reviewer,pid,historic.id);assert.equal(old.formalExportAllowed,true);assert.equal(old.current,false);
      await assert.rejects(approvedCaseSource(env,owner,pid,historic.id,{current:true}),/资料核验规则已启用/);
      assert.equal((await approvedCaseSource(env,owner,pid,historic.id)).deliveryId,historic.id);
      saved.workflow.reportGapRegistry=ledger;await persist();
    });
    await t.test('真实材料逐字引文经权限、CAS与签名核实后才允许关闭并重新冻结',async()=>{
      const input={action:'confirmGap',projectId:pid,expectedUpdatedAt:updatedAt,confirmed:true,sourceRevision:derived.sourceRevision,gapId:derived.registry.records[0].id,status:'satisfied',reason:'[系统测试]人工逐字核对了当前项目人口字段、统计对象和适用范围。',evidence:{materialId:'material1',quote:'本测试材料的人口统计为100人',locator:'第1段'}};
      await assert.rejects(reviewReportGaps(env,reviewer,input),/编辑权限/);
      const reviewed=await reviewReportGaps(env,owner,input);assert.equal(reviewed.trustedApprovals.length,1);assert.equal(reviewed.requiresSave,true);
      saved.workflow.reportGapRegistry=reviewed.registry;saved.workflow.reportGapReceipts={[input.gapId]:reviewed.receipt};saved.chapters[0].sections[0].content='总投资：100万元。';await persist();
      const clean=await deliveryAction(env,owner,freeze);assert.equal(clean.result.passed,true,JSON.stringify(clean.result));assert.equal(clean.result.gapReview.factsVerified,false);
      await deliveryAction(env,reviewer,approve(clean.id));const approved=await listDeliveries(env,reviewer,pid,clean.id);assert.equal(approved.current,true);assert.equal(approved.formalExportAllowed,true);assert.equal(approved.snapshot.gapReview.authority.trustedApprovals.length,1);
      const before=await DB.prepare('SELECT snapshot_json FROM report_deliveries WHERE id=?').bind(clean.id).first();saved.kb[0].content+='修改材料但保持自报contentHash不变。';await persist();
      assert.equal((await listDeliveries(env,reviewer,pid,clean.id)).current,false);const stale=await deliveryAction(env,owner,freeze);assert.equal(stale.result.passed,false);assert.equal(stale.result.gapReview.unresolvedCritical.length,1);assert.ok(stale.result.gapReview.issues.some(i=>i.code==='stale-gap-source'));
      assert.deepEqual(await DB.prepare('SELECT snapshot_json FROM report_deliveries WHERE id=?').bind(clean.id).first(),before);
    });
    await t.test('仅有真实核实审计、尚无schema4冻结的项目同样不可整键删除后降级',async()=>{
      const auditPid=crypto.randomUUID(),auditSaved={...saved,workflow:{},project:{name:'[系统测试]仅审计防降级'}};
      await DB.prepare('INSERT INTO projects(id,user_id,name,data,updated_at) VALUES(?,?,?,?,?)').bind(auditPid,owner,auditSaved.project.name,JSON.stringify(auditSaved),1).run();
      await DB.prepare('INSERT INTO project_events(id,project_id,user_id,event_type,actor,payload_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),auditPid,owner,'report.gap.human-confirmed',String(owner),JSON.stringify({testOnly:true}),Date.now()).run();
      assert.equal(await hasDeliveryGapHistory(env,auditPid),true);
      await assert.rejects(deliveryAction(env,owner,{...freeze,projectId:auditPid}),/台账被移除/);
      const rows=await DB.prepare('SELECT id FROM report_deliveries WHERE project_id=?').bind(auditPid).all();assert.equal(rows.results.length,0);
    });
    await DB.prepare('DELETE FROM report_logic_sets WHERE id=?').bind(logicId).run();
  }finally{await DB._close();}
});
