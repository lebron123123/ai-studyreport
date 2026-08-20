const test=require("node:test");
const assert=require("node:assert/strict");
const gov=require("../ppt-asset-governance.js");
const providers=require("../ppt-image-providers.js");

test("素材候选只有人工采用后才进入页面",async()=>{
  const plan={templateId:"anju-blue",slides:[{id:"s1",title:"项目区位与住房形象",content:{}}]};
  const rows=await providers.search("项目区位与住房形象",{plan,accent:"2387C7"},["local-illustration"]);
  const pending=gov.addCandidates(plan,"s1",rows);
  assert.equal(pending.slides[0].assetPlan,undefined);
  assert.equal(pending.slides[0].assetCandidates[0].status,"candidate");
  const approved=gov.decide(pending,"s1",pending.slides[0].assetCandidates[0].id,"approve");
  assert.equal(approved.slides[0].assetPlan.status,"matched");
  assert.match(approved.slides[0].content.image,/^data:image\/svg\+xml/);
});

test("部门素材必须已审核才可检索",async()=>{
  const plan={departmentAssets:[{id:"a",name:"已审建筑图",status:"approved",dataUrl:"data:image/png;base64,AA",tags:["建筑"]},{id:"b",name:"草稿图",status:"draft",dataUrl:"data:image/png;base64,AA",tags:["建筑"]}]};
  const rows=await providers.search("建筑",{plan},["department-assets"]);
  assert.deepEqual(rows.map(x=>x.id),["a"]);
});
