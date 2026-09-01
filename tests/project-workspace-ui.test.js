import test from "node:test";
import assert from "node:assert/strict";
import UI from "../project-workspace-ui.js";

test("独立项目门户路由可解析并拒绝未知视图",()=>{
  assert.deepEqual(UI.parseRoute("#project/project-123/data"),{projectId:"project-123",view:"data"});
  assert.equal(UI.parseRoute("#project/project-123/unknown"),null);
  assert.equal(UI.route("project-123","files"),"#project/project-123/files");
});

test("数据注册表渲染包含来源和两次点击溯源",()=>{
  const html=UI.render("data",{context:{role:"OWNER"},data:{summary:{total:1,confirmed:1},rows:[{kind:"metric",key:"irr",label:"IRR",value:4.2,unit:"%",status:"confirmed",sourceType:"whitebox",sourceRef:"snap-1",version:2,confidence:1,lineage:{calc:"snap-1"}}]}});
  assert.match(html,/项目数据注册表/);assert.match(html,/两次点击溯源/);assert.match(html,/snap-1/);assert.match(html,/whitebox/);
});

test("成员视图按manage权限显示管理入口",()=>{
  const managed=UI.render("members",{context:{role:"OWNER"},data:{members:[{userId:1,role:"OWNER",status:"active"}],profile:{visibility:"private"},permissions:{manage:true}}});
  const readonly=UI.render("members",{context:{role:"VIEWER"},data:{members:[],profile:{},permissions:{manage:false}}});
  assert.match(managed,/添加或更新成员/);assert.doesNotMatch(readonly,/添加或更新成员/);
});
