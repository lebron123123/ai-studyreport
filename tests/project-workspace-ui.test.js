import test from "node:test";
import assert from "node:assert/strict";
import UI from "../project-workspace-ui.js";

test("独立项目门户路由可解析并拒绝未知视图",()=>{
  assert.deepEqual(UI.parseRoute("#project/project-123/data"),{projectId:"project-123",view:"data"});
  assert.equal(UI.parseRoute("#project/project-123/unknown"),null);
  assert.deepEqual(UI.parseRoute("#investment/projects"),{projectId:null,view:"library"});
  for(const view of Object.keys(UI.VIEWS))assert.deepEqual(UI.parseRoute(UI.route('project-123',view)),{projectId:'project-123',view});
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

test("八阶段链接可刷新定位且兼容旧阶段入口，未知阶段不会转成业务操作",()=>{
  for(const stage of UI.STAGES)assert.deepEqual(UI.parseRoute(UI.route("project-123","stages",stage.key)),{projectId:"project-123",view:"stages",viewStageKey:stage.key});
  assert.deepEqual(UI.parseRoute("#project/project-123/stages"),{projectId:"project-123",view:"stages"});
  assert.equal(UI.parseRoute("#project/project-123/stages/unknown"),null);
  assert.equal(UI.parseRoute("#project/project-123/facts/decision"),null);
  assert.equal(Object.keys(UI.VIEWS).length,12);
});

test("浏览偏好按用户及项目隔离，只保存有效导航值且容忍存储不可用",()=>{
  const entries=new Map(),storage={setItem:(k,v)=>entries.set(k,v),getItem:k=>entries.get(k)};
  assert.equal(UI.writeViewPreference(storage,"a","project-123",{view:"stages",viewStageKey:"decision",secret:"must-not-save"}),true);
  assert.deepEqual(UI.readViewPreference(storage,"a","project-123"),{view:"stages",viewStageKey:"decision"});
  assert.equal(UI.readViewPreference(storage,"b","project-123"),null);assert.equal(UI.readViewPreference(storage,"a","project-456"),null);
  assert.equal(UI.writeViewPreference(storage,null,"project-123",{view:"facts"}),false);
  assert.equal(UI.writeViewPreference(storage,"a","project-123",{view:"data",viewStageKey:"decision"}),false);
  assert.ok(![...entries.values()][0].includes("secret"));
  entries.set(UI.viewPreferenceKey("a","project-123"),"not JSON");assert.equal(UI.readViewPreference(storage,"a","project-123"),null);
  assert.equal(UI.writeViewPreference({setItem(){throw Error("disabled");}},"a","project-123",{view:"facts"}),false);
});

test("阶段汇总使用真实归属及门-里程碑关联，不复制无归属历史记录或改写输入",()=>{
  const brain={facts:[{id:"f1",label:"立项事实",stageKey:"initiation"},{id:"f2",label:"共用事实"},{id:"f3",label:"旧阶段",stageKey:"retired"}]};
  const intelligence={gates:[{id:"g1",stageKey:"initiation"}],gate:{id:"g1",stageKey:"initiation"},milestones:[{id:"m1",gateId:"g1"}],deliverables:[{id:"d1",milestoneId:"m1"}]};
  const ops={tasks:[{id:"t1",stage_key:"initiation"},{id:"t2",stageKey:"decision"}]},before=JSON.stringify({brain,intelligence,ops});
  const model=UI.stageModel("initiation",brain,intelligence,ops);
  assert.deepEqual(model.items.map(x=>x.id).sort(),["d1","f1","g1","m1","t1"]);
  assert.deepEqual(model.shared.map(x=>x.id),["f2","f3"]);
  assert.equal(JSON.stringify({brain,intelligence,ops}),before);
});

test("阶段主要动作按实际编辑权限与已有成果进入现有工具",()=>{
  for(const stage of UI.STAGES){const readonly=UI.primaryAction("stages",stage.key,{generated:1},{edit:false});assert.notEqual(readonly.kind,"report");assert.ok(UI.VIEWS[readonly.view]);}
  assert.deepEqual(UI.primaryAction("stages","feasibility",{generated:1},{edit:true}),{kind:"report",label:"继续报告与候选稿"});
  assert.deepEqual(UI.primaryAction("stages","decision",{},{edit:true}),{kind:"view",view:"scenarios",label:"准备决策包"});
  assert.deepEqual(UI.workStage({investmentStage:"decision"},{lifecycle:{current:"initiation"}},{stage:{key:"feasibility"}}),{key:"feasibility",label:"可研与尽调"});
  assert.deepEqual(UI.workStage({investmentStage:"decision"},{lifecycle:{current:"initiation"}},{stage:{key:null}}),{key:null,label:"待确认"});
});

test("阶段组件隔离失败来源，已有内容继续展示且空数据不伪造完成",()=>{
  const html=UI.stageWorkspace("decision",{brain:{facts:[{id:"one",stageKey:"decision",label:"现有审议事实"}]},intelligenceError:"[系统测试]暂不可用",ops:{}});
  assert.match(html,/现有审议事实/);assert.match(html,/data-pm-retry-source="intelligence"/);assert.match(html,/浏览此阶段不会改变工作阶段/);
  const empty=UI.stageWorkspace("decision",{brain:{},intelligence:{},ops:{}});
  assert.match(empty,/暂无明确关联本阶段/);assert.doesNotMatch(empty,/<em>已完成/);
  assert.match(UI.stageWorkspace("discovery",{}),/role="status"/);
  const nav=UI.stageNavigation("decision","feasibility");assert.equal((nav.match(/aria-current="page"/g)||[]).length,1);
  assert.match(nav,/data-pm-stage-view="decision" class="active"/);assert.match(nav,/可研与尽调<small>项目工作阶段/);
});

test("资料需求使用后台全清单，缺失/条件/假设/冲突/NA独立显示并保留范围及来源",()=>{
  const items=[{factKey:'asset.area',label:'缺失面积',status:'missing',requirement:'required',scopeId:'点位A'},{factKey:'rent',label:'租金假设',factId:'f1',status:'assumption',requirement:'required',scopeId:'点位B',sourceRef:'租金比价原件'},{factKey:'ownership',label:'权属冲突',factId:'f2',status:'conflict',requirement:'required'},{factKey:'parking',label:'停车位',status:'not_applicable',requirement:'conditional',naReason:'<script>没有地下空间</script>'},{factKey:'condition',label:'适用条件',status:'condition_pending',requirement:'conditional'}];
  const brain={requirements:{stageKey:'feasibility',items},facts:[{id:'f1',factKey:'rent',factType:'ASSUMPTION',value:80,unit:'元/㎡·月',basis:'仅用于预演',asOf:'2026-09',sourceLocator:'第3页'},{id:'f2',factKey:'ownership',factType:'FACT',conflictValues:['甲','乙']}]},before=JSON.stringify(brain),html=UI.requirements({brain});
  assert.match(html,/data-requirement-status="missing"/);assert.match(html,/尚未录入/);assert.match(html,/假设 \/ 非事实，仍需核实/);assert.match(html,/租金比价原件/);assert.match(html,/第3页/);assert.match(html,/点位A/);assert.match(html,/不适用理由/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/甲.*乙/);assert.match(html,/适用条件待确认/);
  assert.equal((html.match(/class="pm-requirement-row"/g)||[]).length,5);assert.equal(JSON.stringify(brain),before);assert.doesNotMatch(html,/data-pw-file-save|data-pm-item|通过复核/);
});

test("资料清单优先只读模型，加载/缺省/空清单不冒充资料齐全",()=>{
  const brain={requirements:{items:[{factKey:'old',status:'missing'}]}};
  assert.doesNotMatch(UI.requirements({brain,intelligence:{stage:{key:'discovery'},dataHealth:{requirements:[]}}}),/data-requirement-status/);
  assert.match(UI.requirements({brain,intelligence:{dataHealth:{requirements:[]}}}),/不代表资料自动通过/);
  assert.match(UI.requirements({}),/正在读取资料需求/);assert.match(UI.requirements({brain:{},intelligence:{}}),/没有清单不代表资料齐全/);
  assert.match(UI.requirements({brainError:'offline',intelligenceError:'offline'}),/暂不可读取/);
  assert.match(UI.requirements({brain},true),/<summary>当前工作阶段资料需求/);
});
