const test=require("node:test");
const assert=require("node:assert/strict");
const Assets=require("../ppt-asset-layer.js");
const IR=require("../ppt-design-ir.js");
require("../ppt-components.js");
require("../ppt-core.js");

test("资产准入拒绝远程URL并保留项目图片溯源",()=>{
  assert.equal(Assets.admitAsset({name:"远程图",kind:"photo",dataUrl:"https://example.com/a.png",sourceRef:"网页"}).ok,false);
  const img="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
  const r=Assets.admitAsset({name:"项目建筑效果图.png",kind:"photo",dataUrl:img,width:1200,height:800,sourceRef:"项目资料包/效果图.png",tags:["建筑","项目"]});
  assert.equal(r.ok,true);assert.equal(r.asset.sourceRef,"项目资料包/效果图.png");
});

test("资产目录将项目素材与内置图标分层并进行语义匹配",()=>{
  const img="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",catalog=Assets.buildCatalog({assets:[{id:"p1",name:"项目建筑效果图.png",kind:"image",dataUrl:img,width:1200,height:800,text:"建筑 住房",version:"v2"}]},{accent:"2387C7",pale:"DDECF7"});
  assert.equal(catalog.summary.project,1);assert.ok(catalog.summary.builtin>=6);
  const hit=Assets.matchAsset({layoutId:"cover",title:"保障性住房项目汇报",bullets:[]},catalog,{kind:"photo"});
  assert.equal(hit.assetId,"p1");assert.equal(hit.provider,"local");assert.match(hit.rationale,/语义/);
});

test("Design IR可将准入素材作为统一图片元素交给预览和导出",()=>{
  const icon=Assets.builtinAssets({accent:"2387C7",pale:"DDECF7"})[1],slide={layoutId:"agenda",title:"汇报结构",bullets:["投资","工期"],assetPlan:{...icon,assetId:icon.id,status:"matched",sourceRef:icon.sourceRef}},plan={slides:[slide],designSpec:{}};
  const scene=IR.buildScene(slide,plan,0),html=IR.renderHtml(scene);
  assert.ok(scene.elements.some(x=>x.type==="image"));assert.match(html,/<img/);assert.doesNotMatch(html,/undefined|NaN/);
});

test("视觉导演会为每页写入可解释的资产匹配计划",()=>{
  const plan=globalThis.PptCore.buildDeckPlan({title:"保障房项目",slides:[{layoutId:"cover",title:"保障房项目"},{layoutId:"agenda",title:"汇报结构",bullets:["投资测算","工期计划"]},{layoutId:"conclusion",title:"决策建议"}]});
  assert.ok(plan.slides[0].assetPlan);assert.equal(plan.slides[1].assetPlan.status,"matched");assert.match(plan.slides[1].assetPlan.rationale,/来源/);
});
