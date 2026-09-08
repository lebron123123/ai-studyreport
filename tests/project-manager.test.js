const test=require("node:test");
const assert=require("node:assert/strict");
const UI=require("../project-workspace-ui.js");
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
  return Object.assign({id:"project-123",name:"测试项目",type:"rent",location:"龙华区",owner:"负责人",role:"OWNER",permissions:{edit:true,manage:true,delete:true,duplicate:true},investmentStage:"feasibility",status:"collecting",stage:"资料准备",generated:3,sections:10,materials:2,calcVersions:1,reportVersions:2,activity:[]},overrides);
}

test("项目标题区按当前页面提供主要动作并将归档删除收纳项目管理",()=>{
  const html=PM.renderDetail(project(),null,null,null,null,null,null,null,"overview",null);
  assert.doesNotMatch(html,/data-pm-ai="project-123"/);
  assert.match(html,/查看当前阶段工作/);
  assert.match(html,/pm-project-management/);
  assert.match(html,/data-pm-archive="project-123" data-value="1"/);
  assert.match(html,/data-pm-purge="project-123"/);
});

test("归档项目在标题区可恢复也可彻底删除",()=>{
  const html=PM.renderDetail(project({archived:true}),null,null,null,null,null,null,null,"overview",null);
  assert.match(html,/data-pm-archive="project-123" data-value="0"/);
  assert.match(html,/>恢复<\/button>/);
  assert.match(html,/删除项目/);
});

test("成果版本页为当前稿和每个历史报告版本提供独立预览入口",()=>{
  const html=PM.renderDetail(project({reportVersionItems:[{id:"report-1",version:1,reason:"初稿",createdAt:"2026-09-01",current:false},{id:"report-2",version:2,reason:"复核稿",createdAt:"2026-09-02",current:true}]}),null,null,null,null,null,null,null,"versions",null);
  assert.match(html,/data-pm-preview-version="current"/);assert.match(html,/data-pm-preview-version="report-1"/);assert.match(html,/data-pm-preview-version="report-2"/);assert.match(html,/只读预览/);
});

test("总览不再堆放版本、会议、事实和阶段表单",()=>{
  const html=PM.renderDetail(project(),null,{},null,{},null,{},null,"overview",null);
  for(const id of ['pmMeetingText','pmOptTitle','pmDecisionTopic','data-pm-preview-version','data-pi-gate'])assert.ok(!html.includes(id),id);
  assert.match(html,/data-pw-view="versions"/);
});
test("行动、方案、验收分别只挂载自己的业务表单",()=>{
  const markers={actions:'pmMeetingText',scenarios:'pmScenarioKind',acceptance:'pmOptTitle'};
  for(const [view,marker] of Object.entries(markers)){
    const html=PM.renderDetail(project(),null,{},null,{},null,{},null,view,null);
    assert.ok(html.includes(marker),view);
    for(const other of Object.values(markers).filter(x=>x!==marker))assert.ok(!html.includes(other),view+':'+other);
  }
});
test("事实页保留只读阶段导航但不混入修改阶段和新建决策",()=>{
  const html=PM.renderDetail(project(),null,{facts:[{label:'建筑面积',factType:'FACT',status:'confirmed'}]},null,{},null,{},null,'facts',null);
  assert.match(html,/建筑面积/);assert.doesNotMatch(html,/data-pm-stage=|pmDecisionTopic/);
  assert.match(html,/data-pm-stage-view="discovery"/);
});

test("八阶段内容与实际工作阶段标识相互独立，VIEWER无管理入口",()=>{
  const html=PM.renderDetail(project({role:"VIEWER",permissions:{edit:false,manage:false}}),null,{facts:[]},null,{},null,{stage:{key:"feasibility",version:4}},null,"stages",null,"decision");
  assert.match(html,/正在查看/);assert.match(html,/投资决策/);assert.match(html,/项目工作阶段：<b>可研与尽调/);
  assert.doesNotMatch(html,/data-pm-ai=|data-pm-work-stage|data-pm-purge/);
  assert.equal((html.match(/data-pm-stage-view=/g)||[]).length,8);
});

test("实施与投后仅挂载各自投资组件，沿用既有八阶段和十二入口",()=>{
  for(const [stageKey,mode] of [['implementation','plan'],['post_investment','operations']]){
    const html=PM.renderDetail(project(),null,{},null,{},null,{},null,'stages',null,stageKey);
    assert.match(html,new RegExp('data-pm-lifecycle-host="'+mode+'"'));
    assert.equal((html.match(/data-pm-lifecycle-host=/g)||[]).length,1);
  }
  const html=PM.renderDetail(project(),null,{},null,{},null,{},null,'stages',null,'decision');
  assert.doesNotMatch(html,/data-pm-lifecycle-host/);
  assert.equal(Object.keys(UI.VIEWS).length,12);
});

test("阶段导航保护器等待保存，失败不跳转，较旧异步请求不能覆盖新导航",async()=>{
  const guard=PM.navigationGuard(),commits=[],errors=[];let release;
  const older=guard.run(()=>new Promise(resolve=>release=resolve),()=>commits.push("old"));
  assert.deepEqual(commits,[]);
  assert.equal(await guard.run(null,()=>commits.push("new")),true);release();
  assert.equal(await older,false);assert.deepEqual(commits,["new"]);
  assert.equal(await guard.run(()=>Promise.reject(new Error("保存失败")),()=>commits.push("bad"),e=>errors.push(e.message)),false);
  assert.deepEqual(commits,["new"]);assert.deepEqual(errors,["保存失败"]);
  let finish;const cancelled=guard.run(()=>new Promise(resolve=>finish=resolve),()=>commits.push("cancelled"));guard.cancel();finish();
  assert.equal(await cancelled,false);assert.deepEqual(commits,["new"]);
});
