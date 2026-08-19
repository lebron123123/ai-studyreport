const test=require("node:test");const assert=require("node:assert/strict");
const E=require("../ppt-agent-eval.js");
test("three-axis evaluator reports content, design and coherence",()=>{const r=E.inspect({slides:[{title:"封面",layoutId:"cover",sources:[]},{title:"",layoutId:"bullets",bullets:[],sources:[]},{title:"结论",layoutId:"bullets",bullets:["推进"],sources:[]}]});assert.deepEqual(Object.keys(r.dimensions),["content","design","coherence"]);assert.equal(r.ok,false);assert.ok(r.issues.some(x=>x.code==="missing_title"));});
