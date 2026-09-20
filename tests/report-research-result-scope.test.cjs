const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('report.js','utf8').split('async function reportDurableSectionCall')[1].split('async function callGen')[0];
function setup(research=true){
 let accepted=true,guarded=0,saved=0,finish;
 const ctx={currentProjectId:research?null:'p1',projectWorkflow:{},rlProjectType:()=> 'gaibao',saveDraft:()=>saved++};
 ctx.window=ctx;
 ctx.ResearchUI={active:()=>research,flush:async()=>{},capture:()=>({researchId:'r1',runId:'round1'}),accepts:()=>accepted,guard:async()=>{guarded++;}};
 ctx.ReportOrchestrationClient={generateSection:async(input,onTask)=>{onTask({id:'task1',status:'running'});await new Promise(resolve=>finish=resolve);onTask({id:'task1',status:'completed'});return {text:'真实正文',model:'test'};}};
 vm.runInNewContext('async function reportDurableSectionCall'+source,ctx);
 return {ctx,reject:()=>accepted=false,finish:()=>finish(),saved:()=>saved,guarded:()=>guarded};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('私人研究没有正式项目ID仍能接收正文与任务状态',async()=>{
 const r=setup(),s={},chunks=[];const pending=r.ctx.reportDurableSectionCall({name:'市场'},s,'s','u',x=>chunks.push(x));await tick();r.finish();
 assert.equal(await pending,'真实正文');assert.equal(s.executionTask.status,'completed');assert.equal(r.saved(),2);assert.equal(r.guarded(),1);assert.deepEqual(chunks,['真实正文']);
});
test('研究轮次变化拒绝旧结果，不更新完成状态或正文',async()=>{
 const r=setup(),s={},chunks=[];const pending=r.ctx.reportDurableSectionCall({name:'市场'},s,'s','u',x=>chunks.push(x));await tick();r.reject();r.finish();
 await assert.rejects(pending,/已切换/);assert.equal(s.executionTask.status,'running');assert.deepEqual(chunks,[]);
});
test('服务端权限复核期间切换研究也拒绝写入',async()=>{
 const r=setup(),s={};r.ctx.ResearchUI.guard=async()=>r.reject();const pending=r.ctx.reportDurableSectionCall({name:'市场'},s,'s','u');await tick();r.finish();await assert.rejects(pending,/已切换/);assert.equal(s.executionTask.model,undefined);
});
test('正式项目同ID成功，切换项目拒绝写入',async()=>{
 for(const switched of [false,true]){const r=setup(false),s={};const pending=r.ctx.reportDurableSectionCall({name:'市场'},s,'s','u');await tick();if(switched)r.ctx.currentProjectId='p2';r.finish();if(switched)await assert.rejects(pending,/已切换/);else assert.equal(await pending,'真实正文');}
});
