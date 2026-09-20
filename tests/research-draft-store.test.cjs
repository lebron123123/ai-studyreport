const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../research-draft-store.js');
const scope={userId:'a',researchId:'r',runId:'one',epoch:1};
function fixture(){
 const rows=new Map();let time=1,serial=0;
 const adapter={
  async put(row){rows.set(row.id,structuredClone(row));},
  async list(){return structuredClone([...rows.values()]);},
  async acknowledge(id,key,receipt){const row=rows.get(id);if(row?.scope!==key)return false;row.receipt=receipt;return true;},
  async prune(key,before){let n=0;for(const [id,row]of rows)if(row.scope===key&&row.receipt&&row.receipt.confirmedAt<before&&!row.conflict){rows.delete(id);n++;}return n;}
 };
 return {store:create({adapter,now:()=>time,id:()=>String(++serial)}),rows,adapter,advance:()=>{time+=10*86400000;}};
}
test('draft immutable snapshot and user/run/epoch isolation',async()=>{
 const {store}=fixture(),state={text:'original'};await store.save(scope,state);state.text='changed';
 assert.equal((await store.list(scope))[0].state.text,'original');
 for(const other of [{userId:'b'},{runId:'two'},{epoch:2}])assert.equal((await store.list({...scope,...other})).length,0);
 await assert.rejects(store.save({},state),/身份/);
});
test('only confirmed matching drafts expire; conflicts and unsynced survive',async()=>{
 const {store,advance}=fixture(),state={text:'body'};
 const a=await store.save(scope,state),b=await store.save(scope,state,{conflict:true});await store.save(scope,{text:'unsynced'});
 await store.acknowledge(scope,a,{serverVersion:2,state});await store.acknowledge(scope,b,{serverVersion:2,state});
 advance();assert.equal(await store.cleanup(scope),1);assert.equal((await store.list(scope)).length,2);
});
test('wrong receipt and different account cannot authorize cleanup',async()=>{
 const {store,advance}=fixture(),a=await store.save(scope,{text:'body'});
 await assert.rejects(store.acknowledge(scope,a,{serverVersion:2,state:{text:'other'}}),/不一致/);
 await assert.rejects(store.acknowledge({...scope,userId:'b'},a,{serverVersion:2,state:{text:'body'}}),/不一致/);
 advance();assert.equal(await store.cleanup(scope),0);await assert.rejects(store.cleanup(scope,{retentionMs:0}),/一天/);
});
test('storage write failure is not reported as durable success',async()=>{
 const {store,adapter}=fixture();adapter.put=async()=>{throw new Error('quota');};await assert.rejects(store.save(scope,{text:'body'}),/quota/);
});
