import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createWorkAdmission,WorkAdmissionError,admitResponse} from '../local-server/work-admission.mjs';

const server=fs.readFileSync(new URL('../local-server/server.js',import.meta.url),'utf8');
const source=server.slice(server.indexOf('for(const [route,gate]'),server.indexOf("app.post('/api/report-pagination'"));
const turn=()=>new Promise(r=>setImmediate(r));
function fixture(options={}){
 const handlers=new Map(),gate=createWorkAdmission({concurrency:1,maxQueued:0,waitMs:20,...options});
 const context={app:{use:(route,handler)=>handlers.set(route,handler)},directGenerationAdmission:gate,documentAdmission:gate,ocrAdmission:gate,verifyAuth:async()=>true,ENV:{},WorkAdmissionError,admitResponse};
 vm.createContext(context);vm.runInContext(source,context);
 return {gate,run:async(route,next,{method='POST',signal}={})=>{
  const headers=new Headers(),c={req:{method,raw:new Request('http://test'+route,{method,signal})},header:(name,value)=>headers.set(name,value),json:(body,status)=>Response.json(body,{status,headers})};
  return handlers.get(route)(c,async()=>{c.res=await next();return c.res;});
 }};
}
const good=()=>new Response('ok');

test('导入准入满额/排队超时/取消都确认尚未进入处理器，GET仍可回查',async t=>{
 for(const kind of ['full','timeout','cancel'])await t.test(kind,async()=>{
  const f=fixture({maxQueued:kind==='full'?0:1}),controller=new AbortController();let release,calls=0;
  const running=f.gate.run(()=>new Promise(r=>release=r));await turn();
  try{
   const pending=f.run('/api/reportimportrequest',()=>{calls++;return good();},{signal:controller.signal});
   if(kind==='cancel')controller.abort();
   const response=await pending,data=await response.json();assert.equal(response.status,{full:429,timeout:503,cancel:499}[kind]);assert.equal(calls,0);assert.equal(data.code,'ADMISSION_NOT_DISPATCHED');assert.equal(data.durable_import_request_protocol,1);assert.equal(data.confirmedNoCharge,true);assert.equal(data.no_dispatch,true);assert.equal(data.retry_allowed,false);assert.equal(data.retryable,false);
   const read=await f.run('/api/reportimportrequest',()=>{calls++;return good();},{method:'GET'});assert.equal(await read.text(),'ok');assert.equal(calls,1);
  }finally{release();await running;}
 });
});

test('已进入处理器的WorkAdmissionError不宣称未调用，旧generate错误契约不变',async()=>{
 const f=fixture();const response=await f.run('/api/reportimportrequest',()=>{throw new WorkAdmissionError('模型之后的异常',503);});const data=await response.json();assert.equal(data.confirmedNoCharge,undefined);assert.equal(data.no_dispatch,undefined);await turn();
 let release;const running=f.gate.run(()=>new Promise(r=>release=r));await turn();
 try{const legacy=await f.run('/api/generate',good);assert.deepEqual(await legacy.json(),{ok:false,error:'当前任务较多，请稍后重试；原内容未修改',retryable:true});}finally{release();await running;}
});

test('运行中的导入请求保留名额直至回执完成，客户取消不提前释放',async()=>{
 const f=fixture(),controller=new AbortController();let release,calls=0;
 const active=f.run('/api/reportimportrequest',async()=>{calls++;await new Promise(r=>release=r);return good();},{signal:controller.signal});await turn();controller.abort();assert.equal(f.gate.stats().active,1);
 const rejected=await f.run('/api/reportimportrequest',()=>{calls++;return good();});assert.equal(rejected.status,429);assert.equal(calls,1);release();assert.equal(await (await active).text(),'ok');await turn();assert.equal(f.gate.stats().active,0);
});
