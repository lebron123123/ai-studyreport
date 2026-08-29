import test from "node:test";
import assert from "node:assert/strict";
import {summarizeProjectRow} from "../functions/api/projects.js";

test("项目索引从既有JSON提取进度、版本、资料与风险",()=>{
  const data={project:{name:"A",type:"rent",location:"龙岗",owner:"投资部"},calcParams:{rent:42},kb:[{title:"资料"}],
    workflow:{calcSnapshots:[{version:1,calcType:"rent"}],reportVersions:[],management:{tags:["重点"]}},
    chapters:[{sections:[{content:"正文",locked:true,syncStatus:"locked-stale"},{content:"",syncStatus:"current"}]}]};
  const out=summarizeProjectRow({id:"project-123",name:"A项目",data:JSON.stringify(data),updated_at:123});
  assert.equal(out.stage,"逐章生成");assert.equal(out.generated,1);assert.equal(out.sections,2);assert.equal(out.stale,1);assert.equal(out.locked,1);
  assert.equal(out.materials,1);assert.equal(out.calcVersions,1);assert.deepEqual(out.tags,["重点"]);
});

test("归档状态与报告完成阶段可从管理元数据恢复",()=>{
  const data={signed:true,workflow:{management:{archived:true,archivedAt:99}},chapters:[]};
  const out=summarizeProjectRow({id:"project-456",name:"已签发项目",data:JSON.stringify(data),updated_at:456});
  assert.equal(out.archived,true);assert.equal(out.archivedAt,99);assert.equal(out.stage,"已签发");assert.equal(out.progress,100);
});

test("投资全周期显式阶段优先显示且不被旧可研进度覆盖",()=>{
  const data={project:{name:"实施中项目"},workflow:{management:{investmentStage:"implementation"}},chapters:[{sections:[{content:"正文"}]}]};
  const out=summarizeProjectRow({id:"project-789",name:"实施中项目",data:JSON.stringify(data),updated_at:789});
  assert.equal(out.stage,"项目实施");assert.equal(out.progress,78);assert.equal(out.status,"implementation");
});
