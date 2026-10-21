import test from 'node:test';
import assert from 'node:assert/strict';
import {projectReportWritingPolicy,savedReportWritingType,reportWritingScope,loadReportWritingPolicy,REPORT_WRITING_POLICY_VERSION,projectReportGapPolicy,reportGapPolicySource,loadReportRequirementOverrides} from '../functions/api/_report-writing-policy.js';

const rule={id:'test-market',chapter:'第三章 市场分析',section:'3.2需求分析',writingLogic:'只分析已核实的有效需求。',sourceNo:1};
test('写作类型与场景优先使用已保存项目，三类隔离且旧无类型草稿兼容',()=>{
  for(const type of ['sale','rent','gaibao'])assert.equal(savedReportWritingType({calcType:type}),type);
  assert.equal(savedReportWritingType({calcResult:{__ctype:'sale'}}),'sale');
  assert.throws(()=>savedReportWritingType({calcType:'sale'},'rent'),/不一致/);
  assert.equal(savedReportWritingType({},'sale'),'sale');assert.equal(savedReportWritingType({}),'');
  assert.equal(reportWritingScope({project:{businessScenario:'commercial_renovation'}},'gaibao'),'commercial_renovation');
  assert.equal(reportWritingScope({},'gaibao'),'housing_conversion');
  assert.equal(reportWritingScope({project:{businessScenario:'housing_conversion'}},'sale'),'sale');
});
test('服务端复用纯规则匹配，已发布全篇要求、场景小节与可编辑行文标准共同进入提示词',()=>{
  const data={projectType:'gaibao',globalRequirements:{housing_conversion:'保租项目通用要求',commercial_renovation:'商办项目通用要求'},writingStandard:{globalInstructions:'组织已发布行文要求'},rules:[{...rule,scenarioVariants:{housing_conversion:{writingLogic:'分析保租客户实际需求'},commercial_renovation:{writingLogic:'分析商办客户实际需求'}}}]};
  const before=JSON.stringify(data),a=projectReportWritingPolicy(data,{project:{businessScenario:'housing_conversion'}},'gaibao','第三章 市场分析 / 3.2需求分析',{id:'published-test',version:4});
  assert.equal(a.authority.version,REPORT_WRITING_POLICY_VERSION);assert.equal(a.authority.sourceVersion,4);
  assert.deepEqual(a.authority.ruleIds,['test-market']);assert.equal(a.binding.context.writingLogic,'分析保租客户实际需求');
  assert.match(a.prompt,/保租项目通用要求/);assert.match(a.prompt,/组织已发布行文要求/);assert.match(a.prompt,/分析保租客户实际需求/);assert.doesNotMatch(a.prompt,/商办客户/);
  const b=projectReportWritingPolicy(data,{project:{businessScenario:'commercial_renovation'}},'gaibao','第三章 市场分析 / 3.2需求分析');
  assert.match(b.prompt,/商办项目通用要求/);assert.match(b.prompt,/分析商办客户实际需求/);assert.doesNotMatch(b.prompt,/保租客户/);assert.equal(JSON.stringify(data),before);
});
test('管理员明确清空全篇要求不被旧小节重新补回；旧配置缺省跨类别应用且不引入出租项目事实',()=>{
  const a=projectReportWritingPolicy({projectType:'sale',globalRequirements:{sale:''},rules:[{...rule,writingLogic:'全篇执行：已删除的旧全篇要求\n项目去化分析'}]}, {},'sale','第三章 市场分析 / 3.2需求分析');
  assert.equal(a.authority.globalRequirements,'');assert.doesNotMatch(a.prompt,/已删除的旧全篇要求/);assert.match(a.prompt,/项目去化分析/);assert.equal(a.binding.context.projectType,'sale');
  for(const type of ['sale','rent','gaibao']){
    const policy=projectReportWritingPolicy({}, {},type,'第三章 市场分析 / 需求分析');
    assert.equal(policy.binding.config.version,'report-writing-standard-v1');
    assert.equal(policy.authority.version,REPORT_WRITING_POLICY_VERSION);
    assert.match(policy.prompt,/直接成稿硬要求/);
  }
  assert.throws(()=>projectReportWritingPolicy({writingStandard:{forgedSetting:true}}, {},'sale','章节 / 小节'),/未知|不支持|无效/);
});
test('数据库只读取相应类别已发布版本，损坏配置失败关闭，legacy无类型不误取出租规则',async()=>{
  const calls=[],env={DB:{prepare(sql){calls.push(sql);return {bind(type){calls.push(type);return {async first(){return {id:'test',version:2,data:JSON.stringify({projectType:type,rules:[rule]})};}};}};}}};
  const result=await loadReportWritingPolicy(env,{},'sale','第三章 市场分析 / 3.2需求分析');
  assert.equal(calls[1],'sale');assert.match(calls[0],/status='published'/);assert.equal(result.authority.sourceVersion,2);
  await loadReportWritingPolicy(env,{},'','章节 / 小节');assert.equal(calls.length,2);
  const bad={DB:{prepare(){return {bind(){return {async first(){return {data:'invalid-json'};}};}};}}};
  await assert.rejects(loadReportWritingPolicy(bad,{},'sale','章节 / 小节'),/损坏/);
});

const W=globalThis.ReportGapWorkflow;
function savedGapFixture(){
  const data={projectType:'rent',rules:[{id:'population',chapter:'市场分析',section:'人口需求',displayTitle:'人口需求',importance:'★★★',sourceKinds:['provider'],requiredSources:'常住人口统计',writingLogic:'分析人口需求'}]};
  const saved={project:{name:'[系统测试]缺口归属',location:'龙岗区'},calcType:'rent',calcParams:{area:100},kb:[{id:'m1',content:'原始材料'}],chapters:[{name:'市场分析',sections:[{t:'人口需求'},{t:'人口需求补充'}]}]};
  const opts={projectKey:'p1',projectType:'rent',logicData:projectReportWritingPolicy(data,saved,'rent','市场分析 / 人口需求').logicData,requirementOverrides:{},sectionKey:'市场分析 / 人口需求'},d=W.create(W.fromSaved(saved,opts));
  d.registry.records[0].status='missing';
  saved.workflow=W.apply({},d.registry,{projectKey:'p1',sourceRevision:d.sourceRevision,confirmed:true,actorId:'reviewer',sectionKeys:d.sectionKeys});
  return {saved,opts};
}
test('服务器以已保存且应用的台账重新推导：主位置一条红标，其余节仅引用；拒绝旧资料、跨项目和伪造关闭',()=>{
  const {saved,opts}=savedGapFixture(),before=JSON.stringify(saved),primary=projectReportGapPolicy(saved,opts);
  assert.equal(primary.binding.version,'report-gap-requirements-v1');assert.equal(primary.binding.primaryMarkers.length,1);assert.equal(primary.binding.references.length,0);assert.match(primary.prompt,/待补/);
  const other=projectReportGapPolicy(saved,{...opts,sectionKey:'市场分析 / 人口需求补充'});assert.equal(other.binding.primaryMarkers.length,0);assert.equal(other.binding.references.length,1);assert.equal(other.binding.references[0].critical,true);
  assert.equal(JSON.stringify(saved),before);assert.equal(projectReportGapPolicy({},opts).binding,null);
  assert.throws(()=>projectReportGapPolicy(saved,{...opts,projectKey:'p2'}),/台账/);
  const altered=structuredClone(saved);altered.kb[0].content='已变更的原始材料';assert.throws(()=>projectReportGapPolicy(altered,opts),/已变化/);
  const unconfirmed=structuredClone(saved);delete unconfirmed.workflow.reportGapRegistry.activation;assert.throws(()=>projectReportGapPolicy(unconfirmed,opts),/尚未应用/);
  const forged=structuredClone(saved);forged.workflow.reportGapRegistry.records[0].status='satisfied';forged.workflow.reportGapRegistry.records[0].approval={actorId:'forged',confirmed:true};
  const rebound=projectReportGapPolicy(forged,opts);assert.equal(rebound.registry.records[0].status,'unverified');assert.notEqual(rebound.binding.registryHash,primary.binding.registryHash);
  assert.notDeepEqual(reportGapPolicySource(altered,opts),reportGapPolicySource(saved,opts));
});
test('需求修订只从实际用户/项目的持久化记录读取；不存在表只做安全检查不尝试写库',async()=>{
  const calls=[],env={DEPLOY_MODE:'local',DB:{prepare(sql){calls.push(sql);return {first:async()=>({name:null})};}}};
  assert.deepEqual(await loadReportRequirementOverrides(env,3,'p1',{}),{});assert.equal(calls.length,1);assert.match(calls[0],/to_regclass/);
  const rows=[{id:'r2',logic_id:'one',version:2,requirement_json:'{"title":"新版"}',updated_at:10},{id:'r1',logic_id:'one',version:1,requirement_json:'{}',updated_at:1}],bindings=[];
  const exists={DEPLOY_MODE:'local',DB:{prepare(sql){return sql.includes('to_regclass')?{first:async()=>({name:'data_requirement_refinements'})}:{bind(...values){bindings.push(values);return{all:async()=>({results:rows})};}};}}};
  const actual=await loadReportRequirementOverrides(exists,3,'p1',{});assert.deepEqual(bindings[0],[3,'p1']);assert.equal(actual.one.version,2);assert.equal(actual.one.requirement.title,'新版');
  await loadReportRequirementOverrides(exists,3,'',{project:{name:'私人研究'}});assert.deepEqual(bindings[1],[3,'私人研究']);
});
