import test from 'node:test';
import assert from 'node:assert/strict';
import {packState} from '../research-state-codec.mjs';
import {readStoredState,storePackedState} from '../functions/api/_research-state-objects.js';
function database(){const rows=new Map();return {rows,prepare(sql){return{bind(...args){return{async run(){const [r,id,hash,content]=args;rows.set(JSON.stringify([r,id,hash]),{digest:hash,content});return {meta:{changes:1}};},async all(){const [r,id,...hashes]=args;return {results:hashes.map(hash=>rows.get(JSON.stringify([r,id,hash]))).filter(Boolean)};}}}}}};}
test('stored manifest is lossless and cannot resolve another run objects',async()=>{
 const db=database(),row={research_id:'research_1',id:'run_1'},state={text:'完整正文'.repeat(3000)};
 const packed=await packState(state),wire={manifest:packed.manifest,objects:[...packed.objects]};
 const state_json=await storePackedState(db,row,wire);
 assert.deepEqual(await readStoredState(db,{...row,state_json}),state);
 await assert.rejects(readStoredState(db,{...row,id:'run_2',state_json}),/不完整/);
 assert.deepEqual(await readStoredState(db,{...row,state_json:JSON.stringify(state)}),state);
});
test('bad hashes and incomplete manifests cannot be committed',async()=>{
 const db=database(),row={research_id:'research_1',id:'run_1'},packed=await packState({text:'材料'.repeat(2000)});
 await assert.rejects(storePackedState(db,row,{manifest:packed.manifest,objects:[['0'.repeat(64),'corrupt']]}),/校验失败/);
 await assert.rejects(storePackedState(db,row,{manifest:packed.manifest,objects:[]}),/不完整/);
 assert.equal(db.rows.size,0);
});
