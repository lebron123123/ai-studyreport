const test=require("node:test"),assert=require("node:assert/strict");
globalThis.ProjectContextContract=require("../project-context-contract.js");
const G=require("../report-task-graph.js");

function finish(graph,key,input,output){return G.complete(graph,key,input,output).graph;}
test("可研任务图按业务依赖推进并在关键节点等待人工审批",()=>{
  let g=G.create({workflowId:"w1",projectId:"p1",contextId:"c1",contextHash:"h1"});
  assert.deepEqual(G.readyNodes(g).map(x=>x.key),["material_parse"]);
  g=finish(g,"material_parse",{file:"a.docx"},{facts:3});
  const pending=G.complete(g,"fact_confirm",{facts:3},{confirmed:3});g=pending.graph;
  assert.equal(pending.node.status,G.STATUS.WAITING_APPROVAL);
  g=G.approve(g,"fact_confirm","经理确认");
  assert.deepEqual(G.readyNodes(g).map(x=>x.key),["data_gap"]);
});
test("相同输入重复完成节点复用结果且不增加版本",()=>{
  let g=G.create({workflowId:"w2"});const first=G.complete(g,"material_parse",{fileHash:"x"},{facts:1});
  const second=G.complete(first.graph,"material_parse",{fileHash:"x"},{facts:999});
  assert.equal(second.reused,true);assert.equal(second.node.resultVersion,1);assert.deepEqual(second.node.output,{facts:1});
});
test("基础事实变化只失效依赖链并保留材料解析成果",()=>{
  let g=G.create({workflowId:"w3"});g=finish(g,"material_parse",{},{});g=G.complete(g,"fact_confirm",{}, {approved:true}).graph;g=finish(g,"data_gap",{},{});g=finish(g,"data_acquire",{},{});g=G.complete(g,"evidence_adopt",{}, {approved:true}).graph;g=finish(g,"financial_calc",{},{});g=finish(g,"content_generate",{},{});
  const result=G.invalidate(g,["financialParameters"]);
  assert.equal(result.graph.nodes.find(x=>x.key==="material_parse").status,G.STATUS.COMPLETED);
  assert.ok(result.invalidated.includes("data_gap"));assert.ok(result.invalidated.includes("financial_calc"));assert.ok(result.invalidated.includes("content_generate"));
});
test("暂停后的任务可从已有完成节点继续",()=>{let g=G.create({workflowId:"w4"});g=G.pause(g,"用户离开");assert.equal(g.nodes[0].status,G.STATUS.PAUSED);g=G.resume(g);assert.equal(G.readyNodes(g)[0].key,"material_parse");});
