const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../agent-core.js'),'utf8');
for(const switchContext of [false,true])test('研究Agent隔离工具与运行轨迹 '+switchContext,async()=>{
 let current=true,executed=0,round=0;const calls=[];
 const ctx={window:{},setTimeout,clearTimeout,fetch:async(url,opt)=>{
  const body=JSON.parse(opt.body);calls.push({url,body});
  let data={ok:true};
  if(url==='/api/agentruns'&&body.action==='create')data.run={id:'runtime'};
  if(url==='/api/agentruns'&&body.action==='authorize'&&switchContext)current=false;
  if(url==='/api/generate'){round++;data=round===1?{tool_calls:[{id:'1',function:{name:'lookup',arguments:'{}'}}]}:{content:[{text:'answer'}]};}
  return {ok:true,json:async()=>data};
 }};vm.runInNewContext(source,ctx);
 ctx.window.AgentCore.registerTool('lookup',{schema:{type:'function',function:{name:'lookup',parameters:{type:'object'}}},run:async()=>{executed++;return 'evidence';}});
 const scope={researchId:'r',runId:'round',epoch:1,expectedVersion:1};
 const promise=ctx.window.AgentCore.run({research:scope,isContextCurrent:()=>current,tools:['lookup'],useMemory:false,selfCheck:false,deferRuntime:true});
 if(switchContext){await assert.rejects(promise,/轮次已切换/);assert.equal(executed,0);}
 else {assert.equal((await promise).text,'answer');assert.equal(executed,1);assert.equal(calls.find(x=>x.url==='/api/generate').body.researchRuntime,'runtime');}
 assert.equal(calls.some(x=>x.url==='/api/agent'),false);
});
