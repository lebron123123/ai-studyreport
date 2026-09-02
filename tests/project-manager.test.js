const test=require("node:test");
const assert=require("node:assert/strict");
const PM=require("../project-manager.js");

test("项目管理搜索覆盖名称、区域、负责人和标签",()=>{
  const p={name:"龙岗保障房",location:"坂田街道",owner:"投资部",type:"rent",stage:"资料准备",tags:["重点项目"]};
  assert.equal(PM.matches(p,"坂田"),true);
  assert.equal(PM.matches(p,"重点项目"),true);
  assert.equal(PM.matches(p,"南山"),false);
});

test("项目健康状态不伪造结果并提示关键缺口",()=>{
  assert.deepEqual(PM.health({location:"",calcVersions:0,stale:2,materials:0}),["位置待补","未形成测算快照","2节待同步"]);
  assert.deepEqual(PM.health({location:"深圳",calcVersions:1,stale:0,materials:3}),[]);
});

test("业务类型显示使用中文且保留未知类型",()=>{
  assert.equal(PM.displayType("rent"),"出租类");
  assert.equal(PM.displayType("gaibao"),"中资产（非居改保/商业改造等）");
  assert.equal(PM.displayType("自定义"),"自定义");
});

function project(overrides={}){
  return Object.assign({id:"project-123",name:"测试项目",type:"rent",location:"龙华区",owner:"负责人",status:"collecting",stage:"资料准备",generated:3,sections:10,materials:2,calcVersions:1,reportVersions:2,activity:[]},overrides);
}

test("项目标题区始终提供AI可研、归档和删除入口",()=>{
  const html=PM.renderDetail(project(),null,null,null,null,null,null,null,"overview",null);
  assert.match(html,/data-pm-ai="project-123"/);
  assert.match(html,/进入 AI 可研/);
  assert.match(html,/查看生成过程与报告版本/);
  assert.match(html,/data-pm-archive="project-123" data-value="1"/);
  assert.match(html,/data-pm-purge="project-123"/);
});

test("归档项目在标题区可恢复也可彻底删除",()=>{
  const html=PM.renderDetail(project({archived:true}),null,null,null,null,null,null,null,"overview",null);
  assert.match(html,/data-pm-archive="project-123" data-value="0"/);
  assert.match(html,/>恢复<\/button>/);
  assert.match(html,/删除项目/);
});
