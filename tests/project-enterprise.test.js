import test from "node:test";
import assert from "node:assert/strict";
import Enterprise from "../project-enterprise.js";

test("数据注册表合并事实指标证据并识别同键冲突",()=>{
  const out=Enterprise.buildDataRegistry({
    facts:[{id:"f1",factType:"FACT",factKey:"rent",label:"租金",value:32,status:"confirmed",sourceType:"manual",sourceRef:"合同",version:1,confidence:1}],
    metrics:[{id:"m1",metricKey:"irr",label:"IRR",value:4.2,unit:"%",version:1}],
    artifacts:[{id:"a1",artifactType:"report",title:"可研报告",status:"current",version:"v1"}],
    extractions:[{id:"x1",fileId:"file1",type:"fact",key:"rent",label:"租金",value:35,reviewStatus:"candidate",confidence:.8,sourceLocation:"Sheet1!B2"}],
    issues:[{item_kind:"fact",item_key:"land_price",issue_type:"missing",severity:"high",status:"open"}]
  });
  assert.equal(out.summary.total,4);assert.equal(out.summary.conflicts,1);assert.equal(out.summary.missing,1);assert.ok(out.rows.filter(x=>x.key==="rent").every(x=>x.status==="conflict"));assert.equal(out.rows.find(x=>x.key==="irr").sourceType,"whitebox");
});
test("文件智能保留版本链并只标记最新版为当前",()=>{
  const out=Enterprise.buildFileIntelligence({files:[{id:"f1",name:"方案.docx",version:1,isCurrent:false,status:"superseded"},{id:"f2",name:"方案.docx",version:2,isCurrent:true,status:"needs_review"}],extractions:[{id:"x",fileId:"f2",key:"area",reviewStatus:"candidate",confidence:.5}]});
  assert.equal(out.summary.total,2);assert.equal(out.summary.current,1);assert.equal(out.files.find(x=>x.id==="f2").isLatest,true);assert.equal(out.files.find(x=>x.id==="f1").isOldVersion,true);assert.equal(out.files.find(x=>x.id==="f2").extractionSummary.lowConfidence,1);
});

test("决策影响链串联参数指标章节和情景",()=>{
  const out=Enterprise.buildImpactChains({decisions:[{id:"d1",topic:"调整租金",scenarioIds:["s1"],evidenceIds:["a1"]}],changes:[{id:"c1",decisionId:"d1",impact:{changedValues:[{key:"rent"}],affectedMetrics:[{key:"irr"}],affectedSections:[{key:"financial"}]}}],scenarios:[{id:"s1"}],artifacts:[{id:"a1"}]});
  assert.equal(out.length,1);assert.equal(out[0].complete,true);assert.equal(out[0].parameters[0].key,"rent");assert.equal(out[0].evidence.length,1);
});

test("空间工作区仅汇总传入的审核数据并形成圈层摘要",()=>{
  const out=Enterprise.buildSpatialWorkspace({scope:{longitude:114.1,latitude:22.6,scope_value:"1,3,5",confirmed_by:"tester"},observations:[{metric_key:"population"}],pois:[{category:"交通"},{category:"交通"},{category:"教育"}],odFlows:[{origin_name:"罗湖",destination_name:"福田",population:100},{origin_name:"龙岗",destination_name:"福田",population:300}],snapshots:[{version:2}]});
  assert.equal(out.configured,true);assert.equal(out.poiCounts[0].category,"交通");assert.equal(out.poiCounts[0].count,2);assert.equal(out.topOrigins[0].origin,"龙岗");assert.equal(out.latestSnapshot.version,2);
});
