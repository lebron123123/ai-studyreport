import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverySnapshot,deliverySchema,restoreDeliveryDraft} from '../functions/api/_delivery-snapshot.js';
import {verifyFrozenDelivery,verifyDeliverySnapshot,deliveryText} from '../functions/api/_delivery.js';
import {scoreReportQuality} from '../functions/api/_report-quality.js';
import {reportEvidenceHash} from '../functions/api/_report-trusted-evaluation.js';
import {DELIVERY_GAP_CONTEXT_VERSION,loadDeliveryGapContext,deliveryGapQuality,deliveryGapNumericSnapshot,hasDeliveryGapHistory} from '../functions/api/_delivery-gaps.js';
import {projectReportWritingPolicy} from '../functions/api/_report-writing-policy.js';

const W=globalThis.ReportGapWorkflow,G=globalThis.ReportGapRegistry;
function fixture({critical=true,projectType='rent',requirementOverrides={},duplicateScope=false}={}){
  const logic={projectType,rules:[{id:'population',chapter:'市场分析',section:'人口需求',displayTitle:'人口需求',importance:critical?'★★★':'★',sourceKinds:['provider'],requiredSources:'常住人口统计',writingLogic:'分析人口需求'}]};
  if(duplicateScope)logic.rules.push({...logic.rules[0],id:'population-previous'});
  const saved={projectId:'p1',calcType:projectType,project:{name:'[系统测试]冻结缺口',location:'龙岗区'},calcParams:{area:10},kb:[{id:'m1',content:'原材料内容',contentHash:'claimed'}],chapters:[{name:'市场分析',sections:[{t:'人口需求',content:'总投资：100万元。'}]}]};
  const policy=projectReportWritingPolicy(logic,saved,projectType,'',{id:'published-'+projectType,version:1}),authority={version:DELIVERY_GAP_CONTEXT_VERSION,projectKey:'p1',projectType,businessScenario:projectType==='gaibao'?'housing_conversion':projectType,policy:{sourceId:policy.authority.sourceId,sourceVersion:1,scope:policy.authority.scope,logicData:policy.logicData},requirementOverrides};
  const ctx=W.fromSaved(saved,{...authority,logicData:policy.logicData}),derived=W.create(ctx);
  saved.workflow=W.apply({},derived.registry,{projectKey:'p1',sourceRevision:derived.sourceRevision,confirmed:true,actorId:'test',sectionKeys:derived.sectionKeys});
  const presentation=W.section(saved.workflow.reportGapRegistry,'市场分析 / 人口需求',{projectKey:'p1',sourceRevision:derived.sourceRevision});
  saved.chapters[0].sections[0].content+=presentation.references.map(x=>x.text).join('');
  return {saved,authority,logic,derived};
}
const contract={expected:[{label:'总投资',value:100,unit:'万元',sourceRef:'fixture-calculation',version:1}]};
async function rowFor(snapshot){const hash=await reportEvidenceHash(snapshot);return {content_hash:hash,snapshot_json:JSON.stringify(snapshot),contract_json:JSON.stringify(contract),result_json:'{"passed":true}'};}

test('无台账仍默认3，显式1/2/3投影保持历史黄金hash，presence而非activation决定4',async()=>{
  const data={project:{name:'compatibility'},chapters:[{name:'market',sections:[{t:'demand',content:'retained prose',prov:{version:1}}]}],calcParams:{area:10},workflow:{currentCalcSnapshotId:'calc1'}};
  const hashes=['aeba169b53ab3453584b0f4dd5dfb29614d0a3e704ec6262ca3571d4d08a54e2','49688d06973a98a57e3a72b39cafbcfc66f2bf1f9feafdf4700316b3d2c1202e','48ebd3db39a6bf3c49aa997031ed18788486e5515104f492281ffadb81fcec47'];
  assert.equal(deliverySchema(deliverySnapshot(data)),3);
  for(const version of [1,2,3])assert.equal(await reportEvidenceHash(deliverySnapshot(data,version)),hashes[version-1]);
  for(const ledger of [null,{},false,{activation:{confirmed:false}}]){
    const withLedger={...data,workflow:{...data.workflow,reportGapRegistry:ledger}},snapshot=deliverySnapshot(withLedger);
    assert.equal(deliverySchema(snapshot),4);assert.equal(deliveryGapQuality(snapshot).passed,false);
    for(const version of [1,2,3])assert.equal(await reportEvidenceHash(deliverySnapshot(withLedger,version)),hashes[version-1]);
  }
});

test('三类项目即使没有红字，关键未核验事项阻止通过；缓存passed和事实复核布尔值不代替台账',async()=>{
  for(const projectType of ['rent','sale','gaibao']){
    const {saved,authority}=fixture({projectType}),before=JSON.stringify(saved),snapshot=deliverySnapshot(saved,4,authority),quality=deliveryGapQuality(snapshot);
    assert.doesNotMatch(snapshot.chapters[0].sections[0].content,/【待补/);assert.equal(quality.passed,false);assert.equal(quality.unresolvedCritical.length,1);assert.ok(quality.issues.some(x=>x.code==='unresolved-critical-gaps'));assert.equal(quality.factsVerified,false);
    const row=await rowFor(snapshot);assert.deepEqual(await verifyDeliverySnapshot(row),snapshot);await assert.rejects(verifyFrozenDelivery(row,row.content_hash),/重新检查未通过/);assert.equal(JSON.stringify(saved),before);
  }
});

test('非关键待核验保留主位置边界可检查通过，但不冒充事实已认证；删除唯一短句仍拒绝',async()=>{
  const {saved,authority}=fixture({critical:false}),snapshot=deliverySnapshot(saved,4,authority),quality=deliveryGapQuality(snapshot);
  assert.equal(quality.passed,true);assert.equal(quality.factsVerified,false);const row=await rowFor(snapshot);assert.equal((await verifyFrozenDelivery(row,row.content_hash)).passed,true);
  saved.chapters[0].sections[0].content='总投资：100万元。';const absent=deliveryGapQuality(deliverySnapshot(saved,4,authority));assert.equal(absent.passed,false);assert.ok(absent.issues.some(x=>x.code==='missing-primary'));
});

test('修改实际原文、项目事实、参数、目录或生效规则均使台账失效；取消应用也不豁免',()=>{
  for(const mutate of [s=>s.kb[0].content+=' changed',s=>s.calcParams.area=20,s=>s.project.location='新地区',s=>s.chapters[0].sections.push({t:'新小节',content:'正文'}),s=>s.workflow.reportGapRegistry.activation.confirmed=false]){
    const {saved,authority}=fixture({critical:false});mutate(saved);const result=deliveryGapQuality(deliverySnapshot(saved,4,authority));assert.equal(result.passed,false);assert.ok(result.issues.some(x=>['stale-gap-source','inactive-gap-registry'].includes(x.code)));
  }
  const {saved,authority}=fixture({critical:false});authority.policy.logicData.rules[0].importance='★★★';const result=deliveryGapQuality(deliverySnapshot(saved,4,authority));assert.equal(result.passed,false);assert.equal(result.unresolvedCritical.length,1);
});

test('删除记录、降级critical、伪造satisfied与自报证据都由已发布需求重建而不能关闭',()=>{
  for(const mutate of [r=>r.records=[],r=>r.records[0].critical=false,r=>Object.assign(r.records[0],{status:'satisfied',evidenceIds:['fake'],approval:{kind:'human',confirmed:true,actorId:'invented',reason:'pretend'}})]){
    const {saved,authority}=fixture();mutate(saved.workflow.reportGapRegistry);saved.workflow.reportGapRegistry.trustedApprovals=[{confirmed:true}];saved.workflow.reportGapRegistry.verifiedEvidence=[{id:'fake',verified:true}];
    const result=deliveryGapQuality(deliverySnapshot(saved,4,authority));assert.equal(result.passed,false);assert.equal(result.unresolvedCritical.length,1);
  }
});

test('台账/上下文参与冻结哈希；恢复不覆盖原资料或沿用旧应用确认',async()=>{
  const {saved,authority}=fixture(),snapshot=deliverySnapshot(saved,4,authority),row=await rowFor(snapshot);
  const changed=structuredClone(snapshot);changed.gapReview.registry.records[0].critical=false;
  await assert.rejects(verifyDeliverySnapshot({...row,snapshot_json:JSON.stringify(changed)}),/校验不一致/);
  const current=structuredClone(saved);current.project.location='当前地址';current.calcParams.area=999;
  const restored=restoreDeliveryDraft(current,snapshot,'delivery-test',row.content_hash);
  assert.equal(restored.project.location,'当前地址');assert.equal(restored.calcParams.area,999);assert.equal(restored.workflow.reportGapRegistry.activation.confirmed,false);assert.equal(snapshot.gapReview.registry.activation.confirmed,true);assert.equal(restored.workflow.reportGapRegistry.records.length,snapshot.gapReview.registry.records.length);
});

test('数据库loader只读已发布配置及独立修订；不读取可写项目中的伪造authority',async()=>{
  const {saved,logic}=fixture(),calls=[];saved.workflow.reportGapRegistry.authority={policy:{sourceId:'forged'},trustedApprovals:[{confirmed:true}]};
  const env={DB:{prepare(sql){calls.push(sql);if(sql.includes('to_regclass')||sql.includes('sqlite_master'))return{first:async()=>({name:null})};return{bind(type){calls.push(type);return{first:async()=>({id:'real-published',version:2,data:JSON.stringify(logic)})};}};}}};
  const context=await loadDeliveryGapContext(env,7,'p1',saved);assert.equal(context.policy.sourceId,'real-published');assert.equal(context.policy.sourceVersion,2);assert.equal(context.projectKey,'p1');assert.deepEqual(context.trustedApprovals,[]);assert.ok(calls.some(x=>x.includes("status='published'")));assert.equal(await loadDeliveryGapContext(env,7,'p1',{}),null);
});

test('服务端历史按项目只读判断启用：schema4冻结或核实审计均不可被删除草稿整键抹去',async()=>{
  for(const [frozen,audit,expected,count] of [[true,false,true,1],[false,true,true,2],[false,false,false,2]]){
    const calls=[],env={DB:{prepare(sql){return{bind(...args){calls.push({sql,args});return{first:async()=>sql.includes('report_deliveries')?(frozen?{id:'frozen4'}:null):(audit?{id:'receipt-audit'}:null)};}};}}};
    assert.equal(await hasDeliveryGapHistory(env,'only-this-project'),expected);assert.equal(calls.length,count);
    assert.ok(calls.every(c=>c.args[0]==='only-this-project'&&c.sql.startsWith('SELECT ')));
    assert.equal(calls[0].args[1],'%"schemaVersion":4%');
    if(count===2)assert.match(calls[1].sql,/event_type='report\.gap\.human-confirmed'/);
  }
});

test('冻结且逐字匹配的核验范围说明不冒充数值事实；其他门禁与正文数字仍完整核验',async()=>{
  const {saved,authority}=fixture({critical:false,duplicateScope:true,requirementOverrides:{population:{version:1,requirement:{timeScope:{kind:'latest_12_months',maxAgeMonths:12}}},'population-previous':{version:1,requirement:{timeScope:{kind:'latest_3_years',maxAgeMonths:36}}}}});
  const snapshot=deliverySnapshot(saved,4,authority),original=JSON.stringify(snapshot),note=snapshot.chapters[0].sections[0].content.replace('总投资：100万元。','');
  assert.match(note,/最近十二个月/);assert.equal(deliveryGapQuality(snapshot).passed,true);
  assert.equal(scoreReportQuality({...contract,noPending:true},deliveryText(snapshot)).coverageComplete,false,'普通数值检查确实会识别范围元信息');
  const numericCopy=deliveryGapNumericSnapshot(snapshot);assert.doesNotMatch(numericCopy.chapters[0].sections[0].content,/最近十二个月/);assert.match(numericCopy.chapters[0].sections[0].content,/总投资：100万元/);assert.equal(JSON.stringify(snapshot),original);
  const row=await rowFor(snapshot);row.contract_json=JSON.stringify({...contract,required:[note]});assert.equal((await verifyFrozenDelivery(row,row.content_hash)).passed,true,'required仍读取原文中的核验说明');
  row.contract_json=JSON.stringify({...contract,forbidden:[note]});await assert.rejects(verifyFrozenDelivery(row,row.content_hash),/重新检查未通过/,'forbidden不因数字副本而被跳过');
  const extra=structuredClone(snapshot);extra.chapters[0].sections[0].content+='项目运营期限为12年。';const extraRow=await rowFor(extra);await assert.rejects(verifyFrozenDelivery(extraRow,extraRow.content_hash),/重新检查未通过/,'未知业务数字不能一起豁免');
  for(const text of [snapshot.chapters[0].sections[0].content.replace('十二个月','十一个月'),snapshot.chapters[0].sections[0].content+note,'总投资：100万元。<!--'+note+'-->']){
    const invalid=structuredClone(snapshot);invalid.chapters[0].sections[0].content=text;
    assert.equal(deliveryGapQuality(invalid).passed,false);assert.deepEqual(deliveryGapNumericSnapshot(invalid),invalid);
    const invalidRow=await rowFor(invalid);await assert.rejects(verifyFrozenDelivery(invalidRow,invalidRow.content_hash),/重新检查未通过/);
  }
});
