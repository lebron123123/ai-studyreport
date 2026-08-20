const test=require("node:test");
const assert=require("node:assert/strict");
const Scenes=require("../ppt-scene-presets.js");
global.PptScenePresets=Scenes;
const Pipeline=require("../ppt-agent-pipeline.js");

test("五类部门场景均提供不同故事线和推荐模板",()=>{
  const list=Scenes.list();assert.equal(list.length,5);assert.equal(new Set(list.map(x=>x.name)).size,5);
  const business=Scenes.buildOutline("business-review",8),party=Scenes.buildOutline("party-building",8);
  assert.equal(business.length,8);assert.notDeepEqual(business.map(x=>x.title),party.map(x=>x.title));
  assert.ok(business.some(x=>x.layoutId==="chart-line"));assert.ok(party.some(x=>/党建/.test(x.title)||/理论学习/.test(x.title)));
});

test("场景可从用户用途文本中推荐但不强制覆盖",()=>{
  assert.equal(Scenes.recommend("请生成一份经营分析汇报，重点分析同比和环比").id,"business-review");
  assert.equal(Scenes.recommend("没有明确部门场景的普通材料"),null);
  const base={title:"普通汇报",templateId:"anju-blue"},same=Scenes.apply(base,"unknown"),applied=Scenes.apply(base,"leadership-review");
  assert.deepEqual(same,base);assert.equal(applied.templateId,"business-blue-160");assert.equal(base.templateId,"anju-blue");
});

test("场景大纲会保留已确认接入的财务页面",()=>{
  const rows=Pipeline.buildOutline({sceneId:"leadership-review",slideCount:8,slides:[{id:"calc_metrics",title:"财务评价核心指标",layoutId:"metric",calcGenerated:true}]});
  assert.ok(rows.some(x=>x.id==="calc_metrics"&&x.role==="finance"));
  assert.equal(rows[0].layoutId,"cover");assert.equal(rows.at(-1).layoutId,"conclusion");
});
