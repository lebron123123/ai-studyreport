const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../research-session.js');
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
const view=(researchId='research_001',runId='run_test_001')=>({ok:true,userId:1,study:{researchId,status:'active',role:'manager',version:1},run:{researchId,runId,version:1,epoch:1,status:'active',state:{}}});
test('分批上传断线后重复当前批，最终仅提交完整清单',async()=>{
 const entry=view();entry.storageProtocol='parts-v1';entry.storageUploadBatchBytes=300000;
 const objects=new Map();let failed=false,commits=0,stages=0;
 const s=create({request:async input=>{
  if(input.method==='GET')return entry;
  if(input.action==='stageObjects'){stages++;for(const [k,v] of input.objects)objects.set(k,v);if(!failed){failed=true;throw Error('断线');}return {ok:true};}
  commits++;assert.equal(input.packed.objects.length,0);const {unpackState}=await import('../research-state-codec.mjs');assert.equal(unpackState(input.packed.manifest,objects).text.length,500000);
  return {ok:true,researchId:input.researchId,runId:input.runId,epoch:input.epoch,acceptedVersion:2};
 }});
 await s.open(entry.study.researchId);const state={text:'甲乙丙丁戊'.repeat(100000)};
 await assert.rejects(s.save(state),/断线/);assert.equal(commits,0);await s.save(state);assert.equal(commits,1);assert.ok(stages>=2);
});
test('分块协议只发送变化材料，响应丢失后原样重放请求',async()=>{
 const requests=[],entry=view();entry.storageProtocol='parts-v1';let drop=false;
 const s=create({request:async input=>{
  if(input.method==='GET')return entry;
  requests.push(structuredClone(input));if(drop){drop=false;throw Error('response lost');}
  return {ok:true,researchId:input.researchId,runId:input.runId,epoch:input.epoch,acceptedVersion:input.expectedVersion+1};
 }});
 await s.open('research_001');const state={kb:'材料'.repeat(100000),text:'正文'.repeat(3000)};await s.save(state);
 state.text+='改';drop=true;await assert.rejects(s.save(state),/response lost/);await s.save(state);
 const codec=await import('../research-state-codec.mjs');
 assert.deepEqual(codec.unpackState(requests[0].packed.manifest,new Map(requests[0].packed.objects)),{kb:'材料'.repeat(100000),text:'正文'.repeat(3000)});
 assert.equal(requests[1].packed.objects.length,1);
 assert.deepEqual(requests[1],requests[2]);assert.equal(requests[1].state,undefined);
 assert.deepEqual(s.current().run.state,state);
});

test('分块上传遇到版本更新时核对同一研究并以新版本续存',async()=>{
 const initial=view(),latest=view();initial.storageProtocol='parts-v1';initial.storageUploadBatchBytes=300000;
 latest.storageProtocol='parts-v1';latest.storageUploadBatchBytes=300000;latest.run.version=2;latest.run.state={};
 let reads=0,stages=0,commits=0;
 const s=create({request:async input=>{
  if(input.method==='GET')return structuredClone(++reads===1?initial:latest);
  if(input.action==='stageObjects'){
   stages++;
   if(stages===1)return {ok:false,error:'研究输入已有更新，请重新发起保存'};
   assert.equal(input.expectedVersion,2);return {ok:true};
  }
  commits++;assert.equal(input.expectedVersion,2);
  return {ok:true,researchId:input.researchId,runId:input.runId,epoch:input.epoch,acceptedVersion:3};
 }});
 await s.open('research_001');await s.save({text:'新正文'.repeat(100000)});
 assert.ok(stages>1);assert.equal(commits,1);assert.equal(s.current().run.version,3);
});

test('显式冲突恢复仍核对服务器版本和权限，并使用最新版本保存',async()=>{
 for(const mode of ['ok','changed','revoked']){
  let remote=view(),writes=0;const s=create({request:async input=>{if(input.method==='GET')return structuredClone(remote);writes++;assert.equal(input.expectedVersion,2);return {ok:true,researchId:input.researchId,runId:input.runId,epoch:input.epoch,acceptedVersion:3};}});
  await s.open('research_001');remote.run.version=2;remote.run.state={text:'server'};const reviewed=structuredClone(remote);
  if(mode==='changed')remote.run.version=3;if(mode==='revoked')remote.study.role='viewer';
  if(mode==='ok'){await s.recover(reviewed,{text:'local'});assert.equal(s.current().run.state.text,'local');assert.equal(writes,1);}
  else{await assert.rejects(s.recover(reviewed,{text:'local'}));assert.equal(writes,0);}
 }
});

test('版本冲突仅在远端正文与基线相同时安全重试，不覆盖不同正文或撤销权限',async()=>{
 for(const mode of ['same','alreadySaved','different','revoked']){
  let reads=0,writes=0;const remote=view();remote.run.version=2;
  remote.run.state=mode==='alreadySaved'?{text:'new'}:mode==='different'?{text:'colleague'}:{};
  if(mode==='revoked')remote.study.role='viewer';
  const s=create({request:async input=>{
   if(input.method==='GET')return ++reads===1?view():structuredClone(remote);
   writes++;if(writes===1)return {ok:false,error:'已有更新，请重新加载后合并，未覆盖现有内容'};
   assert.equal(input.expectedVersion,2);return {ok:true,researchId:input.researchId,runId:input.runId,epoch:input.epoch,acceptedVersion:3};
  }});
  await s.open('research_001');
  if(['different','revoked'].includes(mode)){await assert.rejects(s.save({text:'new'}),/已有更新/);assert.equal(writes,1);}
  else{await s.save({text:'new'});assert.equal(writes,mode==='same'?2:1);assert.equal(s.current().run.state.text,'new');}
 }
});
test('轻量身份检查不返回正文，调用方修改不会污染会话',async()=>{
 const data=view();data.run.state={report:'长报告'.repeat(100000)};
 const s=create({request:async()=>data});
 assert.equal(s.identity(),null);await s.open('research_001');
 const identity=s.identity();assert.equal(identity.run.state,undefined);
 identity.study.role='viewer';identity.run.version=999;
 assert.equal(s.identity().study.role,'manager');assert.equal(s.identity().run.version,1);
 assert.equal(s.current().run.state.report.length,300000);
});
test('公开令牌检查跨标签废弃及权限撤销，不覆盖未保存快照',async()=>{
 let latest=view();
 const s=create({request:async()=>structuredClone(latest)});
 await s.open('research_001');const token=s.capture('file');
 assert.equal(await s.refreshAuthority(token),true);
 latest.study.status='abandoned';latest.run.epoch++;
 await assert.rejects(s.refreshAuthority(token),/权限或轮次状态/);
 assert.equal(s.current().run.epoch,1);
 latest=view();latest.study.role='viewer';
 await assert.rejects(s.refreshAuthority(token),/权限或轮次状态/);
 s.invalidate();assert.equal(s.accepts(token),false);
});
test('历史轮次只可捕获导出令牌，远端变更后导出也被拦截',async()=>{
 let latest=view();latest.run.status='history';
 const s=create({request:async()=>structuredClone(latest)});
 await s.open('research_001');
 assert.throws(()=>s.capture('chat'),/只读/);
 const token=s.capture('export');assert.equal(await s.refreshAuthority(token),true);
 latest.run.epoch++;
 await assert.rejects(s.refreshAuthority(token),/权限或轮次状态/);
});
test('状态已提交但响应丢失时冻结编辑，重试复用原请求且不保存密码',async()=>{
 const calls=[];let lost=true;
 const s=create({request:async x=>{
  if(x.method==='GET')return view();calls.push(x);
  if(lost){lost=false;throw new Error('响应丢失');}
  return {ok:true};
 }});
 await s.open('research_001');
 await assert.rejects(s.transition('abandon',{password:'first'}),/响应丢失/);
 await assert.rejects(s.save({}),/未确认/);
 await assert.rejects(s.open('research_002'),/未确认/);
 await assert.rejects(s.execute('chat',async()=>1,()=>{}),/未确认/);
 await assert.rejects(s.transition('restore'),/同一/);
 await s.transition('abandon');
 assert.equal(calls[1].requestId,calls[0].requestId);
 assert.equal(calls[1].password,undefined);
 assert.equal(s.current(),null);
});
test('切换未返回期间阻止编辑、重复切换和迟到任务落地',async()=>{
 const wait=deferred(),task=deferred();let reads=0,applied=false;
 const s=create({request:async x=>++reads===1?view():wait.promise});
 await s.open('research_001');
 const running=s.execute('report',()=>task.promise,()=>{applied=true;});
 const opening=s.open('research_002');
 await assert.rejects(s.save({late:true}),/正在切换/);
 await assert.rejects(s.open('research_003'),/正在切换/);
 await assert.rejects(s.execute('chat',async()=>0,()=>{}),/正在切换/);
 task.resolve('旧结果');assert.equal((await running).accepted,false);assert.equal(applied,false);
 wait.resolve(view('research_002'));await opening;assert.equal(s.current().study.researchId,'research_002');
});
test('状态更新期间重复点击只发送一次，失败恢复可操作状态',async()=>{
 const wait=deferred();let writes=0;
 const s=create({request:async x=>{if(x.method==='GET')return view();writes++;return wait.promise;}});
 await s.open('research_001');const changing=s.transition('abandon');
 await assert.rejects(s.transition('abandon'),/请勿重复/);
 await assert.rejects(s.save({}),/正在切换/);
 wait.resolve({ok:false,error:'密码不正确'});await assert.rejects(changing,/密码不正确/);
 assert.equal(writes,1);assert.ok(s.current());
 assert.equal((await s.execute('chat',async()=>1,x=>x)).value,1);
});
test('保存队列使用最新CAS，快照与研究归属固定',async()=>{
 const calls=[];
 const s=create({request:async x=>{if(x.method==='GET')return view();calls.push(x);return {ok:true,...x,acceptedVersion:x.expectedVersion+1};}});
 await s.open('research_001');
 const state={v:1},one=s.save(state);state.v=99;const two=s.save({v:2});
 await Promise.all([one,two]);assert.deepEqual(calls.map(x=>x.expectedVersion),[1,2]);assert.equal(calls[0].state.v,1);assert.equal(s.current().run.version,3);
});
test('失败保存阻止导航；显式重试成功后才允许离开',async()=>{
 let broken=true,gets=0;
 const s=create({request:async x=>{if(x.method==='GET'){gets++;return view(x.researchId);}return broken?{ok:false,error:'断网'}:{ok:true,...x,acceptedVersion:x.expectedVersion+1};}});
 await s.open('research_001');await assert.rejects(s.save({v:1}),/断网/);
 await assert.rejects(s.open('research_002'));assert.equal(gets,1);assert.equal(s.current().study.researchId,'research_001');
 broken=false;await s.save({v:1});await s.open('research_002');assert.equal(gets,2);
});
test('七条链的迟到返回在切换及返回原研究后均不应用',async()=>{
 const s=create({request:async x=>view(x.researchId)});await s.open('research_001');
 const d=deferred(),applied=[];
 const jobs=['chat','parameters','calculation','file','report','autosave','export'].map(chain=>s.execute(chain,()=>d.promise,()=>applied.push(chain)));
 await s.open('research_002');await s.open('research_001');d.resolve('late');
 for(const value of await Promise.all(jobs))assert.equal(value.accepted,false);assert.deepEqual(applied,[]);
});
test('服务端已保存但响应断线，重试复用原请求避免永久CAS冲突',async()=>{
 const receipts=new Map(),calls=[];let disconnect=true;
 const s=create({request:async x=>{
  if(x.method==='GET')return view();calls.push(x);
  if(receipts.has(x.requestId))return receipts.get(x.requestId);
  const result={ok:true,...x,acceptedVersion:x.expectedVersion+1};receipts.set(x.requestId,result);
  if(disconnect){disconnect=false;throw new Error('响应断线');}return result;
 }});
 await s.open('research_001');await assert.rejects(s.save({v:1}),/响应断线/);
 await s.save({v:2});assert.equal(calls[0].requestId,calls[1].requestId);assert.equal(calls[2].expectedVersion,2);assert.equal(s.current().run.state.v,2);
});
test('废弃成功立即隔离迟到任务；拒绝时保留当前研究',async()=>{
 let allowed=false;
 const s=create({request:async x=>x.method==='GET'?view():{ok:allowed,error:'密码不正确'}});
 await s.open('research_001');await assert.rejects(s.transition('abandon'),/密码不正确/);assert.ok(s.current());
 const d=deferred();let applied=false;const task=s.execute('report',()=>d.promise,()=>{applied=true;});
 allowed=true;await s.transition('abandon');d.resolve();assert.equal((await task).accepted,false);assert.equal(applied,false);assert.equal(s.current(),null);
});
test('历史与废弃研究只读，读取失败不会替换当前轮次',async()=>{
 let response=view();response.run.status='history';
 const s=create({request:async()=>response});await s.open('research_001');
 await assert.rejects(s.execute('chat',async()=>1,()=>{}),/只读/);
 await assert.rejects(s.save({}),/只读/);
 // Separate instance avoids treating a rejected write as a successful flush.
 const other=create({request:async()=>response});await other.open('research_001');response={ok:false,error:'撤权'};
 await assert.rejects(other.open('research_002'),/撤权/);assert.equal(other.current().study.researchId,'research_001');
});
