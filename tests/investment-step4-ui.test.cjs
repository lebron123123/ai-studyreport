const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('investment-step4-ui.js','utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(fetcher){
 const listeners=new Map(),host={innerHTML:'',isConnected:true,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:(k,f)=>{if(listeners.get(k)===f)listeners.delete(k);}};
 const data={ok:true,permissions:{edit:true,manage:true},notices:[],records:[],proofs:[],members:[],evaluations:[],clauses:[],approvals:[]};
 const context=vm.createContext({AbortController,AbortSignal,fetch:fetcher||(async()=>({ok:true,json:async()=>data}))});vm.runInContext(source,context);return {host,listeners,api:context.InvestmentStep4,data};
}
test('four section views render only their own module; default remains compatible',async()=>{
 const expected={contracts:['协议条款','后评价</h4>','经验Wiki / RAG</h4>','保存计划'],evaluations:['后评价</h4>','协议条款</h4>','经验Wiki / RAG</h4>','保存计划'],lessons:['经验Wiki / RAG</h4>','协议条款</h4>','后评价</h4>','保存计划'],plans:['保存计划','协议条款</h4>','后评价</h4>','经验Wiki / RAG</h4>']};
 for(const [section,[yes,...no]] of Object.entries(expected)){const h=harness();const instance=h.api.mount(h.host,{projectId:'p',section});await tick();assert.ok(h.host.innerHTML.includes(yes),section);for(const text of no)assert.ok(!h.host.innerHTML.includes(text),section+': '+text);instance.dispose();}
 const h=harness();h.api.mount(h.host,{projectId:'p'});await tick();for(const text of ['协议条款</h4>','后评价</h4>','经验Wiki / RAG</h4>','保存计划'])assert.ok(h.host.innerHTML.includes(text));
});
test('dispose removes handlers and ignores both late success and failure',async()=>{
 for(const failed of [false,true]){let resolve,reject;const wait=new Promise((a,b)=>{resolve=a;reject=b;});const h=harness(()=>wait),instance=h.api.mount(h.host,{projectId:'p',section:'plans'});instance.destroy();h.host.innerHTML='replacement';if(failed)reject(new Error('late'));else resolve({ok:true,json:async()=>h.data});await tick();assert.equal(h.host.innerHTML,'replacement');assert.equal(h.listeners.size,0);}
});
test('missing optional form/dialog is safe after section filtering and failed load is recoverable',async()=>{
 const h=harness();h.api.mount(h.host,{projectId:'p',section:'plans'});await tick();for(const action of ['cancel','addTarget','clauseChange','experienceEdit','extract'])await h.listeners.get('click')({target:{closest:()=>({dataset:{s4Action:action,id:'missing'}})}});
 const bad=harness(async()=>{throw Error('offline');});bad.api.mount(bad.host,{projectId:'p',section:'contracts'});await tick();assert.match(bad.host.innerHTML,/offline/);assert.match(bad.host.innerHTML,/重新加载/);
});
