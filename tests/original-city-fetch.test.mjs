import test from 'node:test';import assert from 'node:assert/strict';
import {readOriginalBlock} from '../project-map/original-city-stream.mjs';
test('original block transient fetch recovers once; permanent and repeated errors propagate',async t=>{
 const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);let calls=0;
 globalThis.fetch=async()=>{if(++calls===1)throw new DOMException('timeout','AbortError');return{ok:true,arrayBuffer:async()=>new Uint8Array([1,2]).buffer};};
 assert.deepEqual(await readOriginalBlock('/block'),new Uint8Array([1,2]));assert.equal(calls,2);
 calls=0;globalThis.fetch=async()=>{calls++;return{ok:false,status:404};};await assert.rejects(readOriginalBlock('/missing'),/404/);assert.equal(calls,1);
 calls=0;globalThis.fetch=async()=>{calls++;throw Error('offline');};await assert.rejects(readOriginalBlock('/offline'),/offline/);assert.equal(calls,2);
});
