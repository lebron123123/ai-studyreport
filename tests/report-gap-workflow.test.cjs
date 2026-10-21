const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../report-gap-workflow.js');
const sample=()=>({projectKey:'p1',projectType:'gaibao',businessScenario:'housing_conversion',project:{name:'测试项目',location:'龙岗区'},calcParams:{area:100},materials:[{id:'m1',title:'材料',content:'实际材料原文'}],chapters:[{name:'市场分析',sections:[{t:'人口需求',content:'旧报告【待补：旧数据】'}]}],logicData:{rules:[{id:'pop',chapter:'市场分析',section:'人口需求',displayTitle:'人口需求',importance:'★★★',sourceKinds:['provider'],requiredSources:'常住人口统计',writingLogic:'分析人口需求'}]},context:{requirementOverrides:{}}});
test('derive from effective shared logic without mutating inputs or declaring every metadata field missing',()=>{
  const ctx=sample(),before=JSON.stringify(ctx),result=W.create(ctx);assert.equal(result.registry.valid,true);assert.equal(result.registry.records.length,1);assert.equal(result.registry.records[0].status,'unverified');assert.ok(result.requirements[0].fieldInventory.length>1);assert.equal(result.requirements[0].fields.length,1);assert.equal(result.legacyCandidates.length,1);assert.equal(result.active,false);assert.equal(JSON.stringify(ctx),before);
});
test('source revision ignores report prose but binds materials, effective overrides, type and input parameters',()=>{
  const ctx=sample(),revision=W.sourceRevision(ctx);ctx.chapters[0].sections[0].content='完全改写的报告';ctx.chapters[0].sections[0].candidate='候选';assert.equal(W.sourceRevision(ctx),revision);
  ctx.materials[0].content='更正后的材料';assert.notEqual(W.sourceRevision(ctx),revision);
  for(const update of [c=>c.calcParams.area=200,c=>c.projectType='sale',c=>c.context.requirementOverrides.pop={version:2,requirement:{fields:[{key:'one',label:'具体事实'}]}}]){const c=sample();update(c);assert.notEqual(W.sourceRevision(c),revision);}
});
test('manual refined requirement is used; identical rule references share an owner, distinct scenario remains separate',()=>{
  const c=sample();c.context.requirementOverrides.pop={version:2,requirement:{fields:[{key:'workers',label:'就业人口'}],geoScope:{value:'布吉街道'}}};c.chapters[0].sections.push({t:'人口需求补充'});
  const r=W.create(c);assert.equal(r.registry.records.length,1);assert.equal(r.registry.records[0].sectionKeys.length,2);assert.equal(r.requirements[0].fieldInventory[0].label,'就业人口');assert.equal(r.registry.records[0].identity.geo.value,'布吉街道');
  const oldId=r.registry.records[0].id;c.businessScenario='commercial_renovation';assert.notEqual(W.create(c).registry.records[0].id,oldId);
});
test('explicit application returns a cloned workflow; stale/invalid/unassigned application does not overwrite',()=>{
  const ctx=sample(),r=W.create(ctx),workflow={reportVersions:[{id:'v9'}]},saved=W.apply(workflow,r.registry,{projectKey:'p1',sourceRevision:r.sourceRevision,confirmed:true,actorId:'reviewer',sectionKeys:r.sectionKeys,at:'2026-09-23'});
  assert.equal(workflow.reportGapRegistry,undefined);assert.equal(saved.reportVersions[0].id,'v9');assert.ok(saved.reportGapRegistry.activation.confirmed);assert.equal(W.create({...ctx,previous:saved.reportGapRegistry}).active,true);
  assert.throws(()=>W.apply(workflow,r.registry,{projectKey:'p1',sourceRevision:'old',confirmed:true,actorId:'reviewer'}),/已变化/);
  assert.throws(()=>W.apply(workflow,r.registry,{projectKey:'p1',sourceRevision:r.sourceRevision,confirmed:true,actorId:'reviewer',sectionKeys:[]}),/主位置/);
  ctx.calcParams.area=400;assert.equal(W.create({...ctx,previous:saved.reportGapRegistry}).active,false);
});
test('saved draft adapter has the same canonical source revision as browser context',()=>{
  const c=sample(),saved={projectId:'p1',project:c.project,calcType:c.projectType,calcParams:c.calcParams,kb:c.materials,chapters:c.chapters};saved.project.businessScenario=c.businessScenario;
  const server=W.fromSaved(saved,{projectKey:'p1',logicData:c.logicData,requirementOverrides:c.context.requirementOverrides});assert.equal(W.sourceRevision(server),W.sourceRevision(c));
});
test('no matching requirements and deleted owner are not treated as successful empty coverage',()=>{
  const c=sample();c.logicData.rules=[];const none=W.create(c);assert.equal(none.registry.valid,false);assert.equal(none.coverage.unmatched.length,1);
  const before=W.create(sample());c.previous=before.registry;c.chapters=[];const changed=W.create(c);assert.ok(changed.registry.issues.some(i=>i.code==='owner-section-missing'));
});
test('basis-only duties remain explicit in coverage and do not get ordinary narrative gaps',()=>{
  const c=sample();c.chapters[0].sections.push({t:'政策依据'});c.logicData.rules.push({id:'basis',chapter:'市场分析',section:'政策依据',displayTitle:'政策依据',writingLogic:'仅文件清单'});
  const r=W.create(c);assert.equal(r.coverage.managedByBasisCatalog.length,1);assert.equal(r.registry.records.length,1);assert.ok(!r.registry.records[0].sectionKeys.includes('市场分析 / 政策依据'));
  const contract=W.contract(r.registry,r.sectionKeys[0]);assert.equal(contract.version,'report-gap-requirements-v1');assert.equal(contract.primaryMarkers.length,0);assert.equal(contract.references.length,1);
});
test('published rental and conversion rule pools keep every identity and have unambiguous display labels',()=>{
  const fs=require('node:fs'),path=require('node:path');
  for(const type of ['rent','gaibao']){
    const logicData=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/report-logic-'+type+'-v1.json'),'utf8')),chapters=[];
    for(const rule of logicData.rules){
      if(!rule.chapter||!rule.section)continue;
      let chapter=chapters.find(c=>c.name===rule.chapter);if(!chapter)chapters.push(chapter={name:rule.chapter,sections:[]});
      if(!chapter.sections.some(s=>s.t===rule.section))chapter.sections.push({t:rule.section});
    }
    const before=JSON.stringify(logicData),result=W.create({projectKey:'seed-'+type,projectType:type,project:{name:'测试项目',location:'龙岗区'},chapters,logicData});
    assert.equal(result.registry.valid,true,JSON.stringify(result.registry.issues));assert.equal(JSON.stringify(logicData),before);
    const ids=new Set(result.registry.records.map(r=>r.id));assert.equal(ids.size,result.registry.records.length);
    assert.equal(new Set(result.registry.records.map(r=>r.presentationLabel)).size,result.registry.records.length);
    if(type==='rent'){
      const rows=result.registry.records.filter(r=>['rule:rent-v1-130','rule:rent-v1-131'].includes(r.identity.object));
      assert.equal(rows.length,2);assert.ok(rows.some(r=>r.label.includes('核心指标')));assert.ok(rows.some(r=>r.label.includes('投资汇总')));
    }
  }
});
