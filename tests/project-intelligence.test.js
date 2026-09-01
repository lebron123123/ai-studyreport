const test=require("node:test");
const assert=require("node:assert/strict");
const PI=require("../project-intelligence.js");

test("项目成员权限保持OWNER/EDITOR/VIEWER三级边界",()=>{
  assert.deepEqual(PI.permissionsFor("OWNER"),{role:"OWNER",view:true,edit:true,manage:true,approve:true});
  assert.equal(PI.permissionsFor("EDITOR").edit,true);assert.equal(PI.permissionsFor("EDITOR").manage,false);
  assert.equal(PI.permissionsFor("VIEWER").view,true);assert.equal(PI.permissionsFor("VIEWER").edit,false);
});

test("真实进度只由里程碑和必需阶段成果计算，不使用生命周期固定百分比",()=>{
  const out=PI.realProgress([{name:"可研初稿",progress:60,weight:2},{name:"专题会",progress:20,weight:1}],[{name:"可研报告",status:"done",required:true},{name:"决策包",status:"not_started",required:true},{name:"参考附件",status:"done",required:false}]);
  assert.equal(out.milestoneProgress,47);assert.equal(out.deliverableProgress,50);assert.equal(out.value,48);assert.equal(out.source,"milestones_and_deliverables");
  assert.deepEqual(PI.realProgress([],[]),{value:null,source:"not_configured",milestoneProgress:null,deliverableProgress:null,configured:false});
});

test("Project Context Contract继承项目、页面、当前对象、快照和权限",()=>{
  const out=PI.contextContract({profile:{projectId:"project-1",organizationId:"org-1",lifecycleStage:"feasibility"},membership:{projectId:"project-1",userId:7,role:"EDITOR"},currentPage:"finance",currentObjectType:"metric",currentObjectId:"irr",brain:{facts:[{factType:"ASSUMPTION",factKey:"rent"}],metrics:[{metricKey:"irr"}],artifacts:[{id:"report-v1"}],decisions:[{id:"d1"}]},ops:{risks:[{id:"r1",status:"open"}],scenarios:[{id:"s1",status:"active"}]}});
  assert.equal(out.projectId,"project-1");assert.equal(out.currentPage,"finance");assert.equal(out.currentObjectId,"irr");assert.equal(out.parametersSnapshot.length,1);assert.equal(out.openRisks.length,1);assert.equal(out.permissions.edit,true);assert.equal(out.permissions.manage,false);
});

test("Read Model V1统一Gate、KPI、数据健康、风险、决策和下一步事项",()=>{
  const out=PI.buildReadModel({project:{id:"project-1",name:"真实项目",type:"rent",location:"深圳"},profile:{projectId:"project-1",lifecycleStage:"feasibility",currentGateId:"g1"},membership:{projectId:"project-1",userId:1,role:"OWNER"},gates:[{id:"g1",name:"可研审查",status:"in_progress"}],milestones:[{id:"m1",name:"可研初稿",progress:65}],deliverables:[{id:"d1",name:"测算表",status:"done"}],brain:{lifecycle:{label:"可研与尽调"},summary:{materials:3},facts:[{status:"confirmed"},{status:"candidate"}],artifacts:[],decisions:[{id:"decision-1",status:"candidate"}],changes:[]},ops:{tasks:[{id:"t1",title:"补材料",status:"open",dueDate:"2000-01-01"}],risks:[{id:"r1",status:"open"}]},kpis:{totalInvestment:12000,irr:4.2}});
  assert.equal(out.gate.name,"可研审查");assert.equal(out.progress.value,83);assert.equal(out.kpis.totalInvestment,12000);assert.equal(out.kpis.irr,4.2);assert.equal(out.kpis.overdueTaskCount,1);assert.equal(out.dataHealth.score,50);assert.equal(out.contextContract.currentGate.name,"可研审查");
});
