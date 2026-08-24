const test=require("node:test");
const assert=require("node:assert/strict");
const C=require("../ppt-conversation-core.js");

test("material planning prompt requires grounded, non-empty slide content",()=>{
  const prompt=C.materialPlanningPrompt({title:"项目汇报",audience:"经营班子",purpose:"决策",slideCount:8,layouts:["metric","timeline"],evidenceText:"总投资100万元，来源：测算表Sheet1"});
  assert.match(prompt,/严禁生成只有标题没有内容的空页面/);assert.match(prompt,/总投资100万元/);assert.match(prompt,/sources/);assert.match(prompt,/目标页数：8/);
});
test("slide patch updates one page and preserves the original snapshot",()=>{
  const plan={slides:[{title:"旧标题",bullets:["旧要点"],layoutId:"bullets",locked:false}]};
  const result=C.applySlidePatch(plan,{page:1,title:"新标题",bullets:["要点一","要点二"],layoutId:"timeline"});
  assert.equal(result.ok,true);assert.equal(result.before.title,"旧标题");assert.equal(result.plan.slides[0].title,"新标题");assert.deepEqual(result.plan.slides[0].bullets,["要点一","要点二"]);assert.equal(result.plan.slides[0].layoutId,"timeline");assert.equal(plan.slides[0].title,"旧标题");
});
test("locked slide rejects an unforced agent modification",()=>{
  const result=C.applySlidePatch({slides:[{title:"人工锁定",locked:true}]},{page:1,title:"不应修改"});assert.equal(result.ok,false);assert.match(result.error,/人工锁定/);
});
test("grounding gate fills empty body pages and source references from materials",()=>{
  const result=C.groundDeck({evidencePack:{assets:[{id:"a",name:"正式材料.docx",text:"项目采用分阶段推进方式。\n第一阶段完成资料归集与审核。\n第二阶段完成系统入库和权限配置。"}]},slides:[{type:"cover",title:"封面"},{type:"content",title:"实施安排",bullets:[],content:{},sources:[]}]});
  assert.equal(result.contentCoverage,100);assert.equal(result.sourceCoverage,100);assert.ok(result.plan.slides[1].bullets.length>0);assert.deepEqual(result.plan.slides[1].sources,["正式材料.docx"]);
});
test("image slide selector skips cover, locked and data-heavy pages",()=>{
  const rows=C.selectImageSlides({slides:[{type:"cover",title:"封面"},{title:"项目区位与住房愿景",layoutId:"bullets",bullets:["要点"]},{title:"测算表",layoutId:"table"},{title:"锁定页",layoutId:"bullets",locked:true}]},2);
  assert.deepEqual(rows.map(x=>x.page),[2]);
});
test("generated image is applied to preview/export content and keeps provenance",()=>{
  const image={id:"img1",dataUrl:"data:image/png;base64,AAAA",provider:"nano-banana",sourceRef:"Nano Banana · test",label:"主视觉"};
  const result=C.applyGeneratedImage({slides:[{title:"封面"},{id:"s2",title:"项目背景",layoutId:"bullets",content:{}}]},2,image);
  assert.equal(result.ok,true);assert.equal(result.plan.slides[1].layoutId,"image-hero");assert.equal(result.plan.slides[1].content.image,image.dataUrl);assert.equal(result.plan.slides[1].assetPlan.provider,"nano-banana");assert.equal(result.plan.slides[1].assetCandidates[0].status,"approved");
});

test("common PPT questions are answered from the current white-box project",()=>{
  const plan={slides:[{type:"cover",title:"封面"},{title:"指标",bullets:[],content:{},sources:[]}],evidencePack:{summary:{assetCount:2,factCount:6,tableCount:1}}};
  assert.match(C.localProjectAnswer(plan,"这个PPT一共有多少页？"),/2 页/);
  assert.match(C.localProjectAnswer(plan,"材料和数字情况怎么样？"),/2 份材料/);
  assert.match(C.localProjectAnswer(plan,"感觉文字不够"),/内容/);
});
