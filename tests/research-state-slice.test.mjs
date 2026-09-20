import test from 'node:test';
import assert from 'node:assert/strict';
import {packState} from '../research-state-codec.mjs';
import {readStoredSlice} from '../functions/api/_research-state-slice.js';
test('小节读取不取材料或历史块，且查询固定研究与轮次',async()=>{
 const state={draft:{chapters:[{sections:[{content:'当前正文'.repeat(1000)}]}],kb:[{content:'材料'.repeat(200000)}],history:['历史'.repeat(200000)]}};
 const packed=await packState(state),requested=[];
 const row={research_id:'research-a',id:'run-a',state_json:JSON.stringify({storageFormat:'research-parts-v1',manifest:packed.manifest})};
 const db={prepare(){return {bind(research,run,...ids){assert.equal(research,row.research_id);assert.equal(run,row.id);requested.push(...ids);return {async all(){return {results:ids.map(digest=>({digest,content:packed.objects.get(digest)}))};}};}};}};
 assert.deepEqual(await readStoredSlice(db,row,['draft','chapters',0,'sections',0]),{found:true,value:state.draft.chapters[0].sections[0]});
 assert.equal(requested.length,1);assert.ok(packed.objects.size>requested.length);
 assert.deepEqual(await readStoredSlice(db,row,['draft','chapters',9]),{found:false});
 assert.equal(requested.length,1);
});
test('缺失块不能当空正文返回，旧JSON及路径校验兼容',async()=>{
 const packed=await packState({text:'正文'.repeat(2000)});
 const row={research_id:'a',id:'b',state_json:JSON.stringify({storageFormat:'research-parts-v1',manifest:packed.manifest})};
 const db={prepare(){return {bind(){return {async all(){return {results:[]};}};}};}};
 await assert.rejects(readStoredSlice(db,row,['text']),/不完整/);
 await assert.rejects(readStoredSlice(db,row,[]),/路径/);
 await assert.rejects(readStoredSlice(db,row,[-1]),/路径/);
 const old={state_json:JSON.stringify({list:[{text:'旧正文'}]})};
 assert.deepEqual(await readStoredSlice(db,old,['list',0]),{found:true,value:{text:'旧正文'}});
 assert.deepEqual(await readStoredSlice(db,old,['constructor']),{found:false});
});
