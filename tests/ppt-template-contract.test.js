import test from "node:test";
import assert from "node:assert/strict";
import { buildShapeFillPlan, buildTemplateContract, scoreTemplateContract, selectTemplateContract, YOUTH_HOUSING_PROFILES } from "../local-server/ppt-template-contract.js";

test("占位符合同保留原始shape id并生成确定性填充计划",()=>{
  const page={id:"demo:1",page:1,role:"analysis",layoutId:"bullets",slotContract:{slots:[
    {shapeId:"shape_7",sourceId:"7",nativeKey:"shape:7",role:"title",capacity:40,required:true},
    {shapeId:"shape_9",sourceId:"9",nativeKey:"shape:9",role:"label",capacity:30},
    {shapeId:"shape_10",sourceId:"10",nativeKey:"shape:10",role:"body",capacity:120}
  ]}};
  const contract=buildTemplateContract(page),fill=buildShapeFillPlan(contract,{title:"项目价值",content:{items:[{label:"交通条件",text:"轨道站点覆盖良好"}]}});
  assert.equal(fill.complete,true);
  assert.deepEqual(fill.actions.slice(0,3).map(action=>[action.sourceId,action.action,action.value]),[
    ["7","replace-text","项目价值"],["9","replace-text","交通条件"],["10","replace-text","轨道站点覆盖良好"]
  ]);
});

test("青年人才住房模板会优先选择具备地图图片槽位的页面",()=>{
  const slide={layoutId:"image-hero",title:"项目区位与周边教育资源",content:{image:"data:image/png;base64,x",items:[{label:"学校",text:"1公里内3所"}]}};
  const selected=selectTemplateContract(YOUTH_HOUSING_PROFILES,slide);
  assert.ok(selected);
  assert.equal(selected.contract.hasImage,true);
  assert.ok(selected.score>scoreTemplateContract(YOUTH_HOUSING_PROFILES.find(item=>item.page===14),slide));
});

test("图片数据不会在Shape ID填充计划中被截断",()=>{
  const data="data:image/png;base64,"+"A".repeat(4000),contract=buildTemplateContract({id:"image:1",page:1,slotContract:{slots:[{sourceId:"9",shapeId:"shape_9",role:"picture"}]}}),fill=buildShapeFillPlan(contract,{content:{image:data}});
  assert.equal(fill.actions[0].action,"replace-image");
  assert.equal(fill.actions[0].value.length,data.length);
});
