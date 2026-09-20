import test from 'node:test';
import assert from 'node:assert/strict';
import {bindContextLifecycle} from '../project-map/context-lifecycle.mjs';
test('one owner pauses and restores once; disposed owner ignores events',async()=>{
 const canvas=new EventTarget(),controller=new AbortController();let pauses=0,restores=0;
 bindContextLifecycle(canvas,{signal:controller.signal,pause:()=>pauses++,restore:()=>restores++,notify:()=>{}});
 const lost=new Event('webglcontextlost',{cancelable:true});canvas.dispatchEvent(lost);
 assert.equal(lost.defaultPrevented,true);assert.equal(pauses,1);
 canvas.dispatchEvent(new Event('webglcontextrestored'));canvas.dispatchEvent(new Event('webglcontextrestored'));
 await Promise.resolve();assert.equal(restores,1);
 controller.abort();canvas.dispatchEvent(new Event('webglcontextlost'));assert.equal(pauses,1);
});
