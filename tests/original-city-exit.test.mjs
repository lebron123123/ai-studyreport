import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalCityStream} from '../project-map/original-city-stream.mjs';

test('late directory response cannot resurrect disposed scene metadata',async t=>{
 const original=globalThis.fetch;let finish,signal;
 t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async(_,options)=>{signal=options.signal;return {ok:true,json:()=>new Promise(resolve=>{finish=resolve;})};};
 const scene={metadata:{}},stream=createOriginalCityStream(scene,()=>{},()=>{});
 const pending=stream.init();await Promise.resolve();
 stream.dispose();scene.metadata=null;finish({tiles:[{bounds:[0,0,1,1]}]});
 await pending;assert.equal(signal.aborted,true);assert.deepEqual(stream.bounds,[]);
 stream.update({x:0,y:0,z:0},{x:0,z:0});assert.equal(scene.metadata,null);
});
