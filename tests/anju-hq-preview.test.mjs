import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../project-map/anju-hq-preview.html',import.meta.url),'utf8');
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import .*?;\n/,'');
function harness(){
 const nodes=Object.fromEntries(['#start','#dispose','#status','#view'].map(k=>[k,{}]));
 let resolve,requests=0,engines=0;
 const context={document:{querySelector:k=>nodes[k]},AbortSignal,devicePixelRatio:1,
  fetch:()=>{requests++;return new Promise(r=>{resolve=r;});},
  window:{addEventListener(){},BABYLON:{Engine:class{constructor(){engines++;throw Error('unexpected GPU creation');}}}}};
 vm.runInNewContext(script,context);
 return {nodes,respond:()=>resolve({ok:true,json:async()=>({})}),counts:()=>({requests,engines})};
}
test('preview ignores duplicate load and discards response after release',async()=>{
 const h=harness(),first=h.nodes['#start'].onclick();
 await h.nodes['#start'].onclick();
 assert.deepEqual(h.counts(),{requests:1,engines:0});
 h.nodes['#dispose'].onclick();h.respond();await first;
 assert.equal(h.counts().engines,0);
 assert.equal(h.nodes['#status'].textContent,'已释放独立场景。');
});
test('preview can load again after cancellation without stale UI errors',async()=>{
 const h=harness(),first=h.nodes['#start'].onclick();
 h.nodes['#dispose'].onclick();h.respond();await first;
 const second=h.nodes['#start'].onclick();h.respond();await second;
 assert.equal(h.counts().requests,2);
 assert.equal(h.nodes['#status'].textContent,'未通过：unexpected GPU creation');
});
