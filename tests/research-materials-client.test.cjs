const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup({switchWhileReading=false,denied=false}={}){
 const requests=[],downloads=[];let current='current_round';
 const ctx={URLSearchParams,AbortSignal,Blob,File,URL:{createObjectURL:()=>'/blob',revokeObjectURL(){}},authHeaders:()=>({Authorization:'Bearer test'}),
 ResearchUI:{active:()=>true,editable:()=>false,capture:chain=>({researchId:'research_123',runId:current,chain}),accepts:t=>t.runId===current},
 document:{body:{appendChild(){}},createElement:()=>({click(){downloads.push(this.download);},remove(){}})},
 fetch:async(url,options)=>{requests.push({url,options});return {ok:!denied,json:async()=>({error:'原件不存在或无权访问'}),blob:async()=>{if(switchWhileReading)current='new_round';return new Blob(['preserved bytes']);}}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../research-materials.js'),'utf8'),ctx);return {ctx,requests,downloads};
}
const ref={researchId:'research_123',runId:'historical_round',fileId:'material_abc',actorId:12,name:'保留原件.txt'};
test('read-only historical original uses authenticated source-run receipt and downloads',async()=>{const f=setup();await f.ctx.ResearchMaterials.download(ref);assert.deepEqual(f.downloads,['保留原件.txt']);assert.match(f.requests[0].url,/runId=historical_round/);assert.equal(f.requests[0].options.headers.Authorization,'Bearer test');});
test('cross-research forged reference is blocked before network',async()=>{const f=setup();await assert.rejects(f.ctx.ResearchMaterials.download({...ref,researchId:'someone_else'}),/不属于/);assert.equal(f.requests.length,0);});
test('denied access and late response after round switch never download',async()=>{for(const options of [{denied:true},{switchWhileReading:true}]){const f=setup(options);await assert.rejects(f.ctx.ResearchMaterials.download(ref));assert.equal(f.downloads.length,0);}});
