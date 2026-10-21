const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../report-completion-contract.js');
const base=()=>C.createPlan([{name:'总论',sections:[{t:'项目概况'}]}]).sections[0];
const marker='【待补：协议经营期限和经营模式须核对】';

test('关键缺口在生成前进入合同且预留字数，总预算不增长',()=>{
  const original=base(),before=JSON.stringify(original),c=C.normalize({...original,requiredMarkers:[marker,marker]});
  assert.deepEqual(c.requiredMarkers,[marker]);assert.equal(JSON.stringify(original),before);
  const slots=C.outputSlots(c),plainSlots=C.outputSlots(original);
  assert.equal(slots.reduce((n,x)=>n+x.hardMax,0),c.requirements.proseMax);
  assert.ok(slots.reduce((n,x)=>n+x.target,0)<=c.requirements.proseTarget);
  assert.ok(slots.find(x=>x.slot==='conditions').hardMax>plainSlots.find(x=>x.slot==='conditions').hardMax);
  assert.match(C.structuredPrompt(c),/已登记关键缺口/);
});

test('缺口丢失必须阻断，完整保留仍是待核实而非事实认证',()=>{
  const c=C.normalize({...base(),requiredMarkers:[marker]});
  const missing=C.inspect('协议经营口径尚待核实。',c);
  assert.equal(missing.status,'blocked');assert.ok(missing.issues.some(x=>x.code==='missing-evidence-marker'&&x.repairable));
  const decoded=C.decodeStructured(JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'项目口径待确认。'},{kind:'paragraph',slot:'conditions',text:marker}]}),c);
  assert.deepEqual(decoded.issues,[]);const quality=C.inspect(decoded.text,c);
  assert.equal(quality.status,'unverified');assert.equal(quality.factsVerified,false);
  assert.ok(!quality.issues.some(x=>x.code==='missing-evidence-marker'));
});

test('无效或超预算缺口在请求前拒绝，不截断为前三项',()=>{
  for(const requiredMarkers of [marker,['普通说明'],['【待补：跨\n行】'],Array(201).fill(0).map((_,i)=>'【待补：'+i+'】')])assert.throws(()=>C.normalize({...base(),requiredMarkers}),/待补约束/);
  const c=base();c.requirements.proseMax=110;c.requirements.proseTarget=80;
  assert.throws(()=>C.normalize({...c,requiredMarkers:[marker,'【待补：第二个必须保留的重大口径冲突】']}),/未删除任何缺口/);
  const markers=Array.from({length:5},(_,i)=>'【待补：事项'+i+'】');
  assert.deepEqual(C.normalize({...base(),requiredMarkers:markers}).requiredMarkers,markers);
  const basis=C.createPlan([{name:'总论',sections:[{t:'编制依据'}]}]).sections[0];
  assert.throws(()=>C.normalize({...basis,requiredMarkers:[marker]}),/职责无效/);
});

test('验收回执之后不再追加缺口或用兜底正文替换；旧文本兼容路径仍可用',()=>{
  const source=fs.readFileSync(require.resolve('../report.js'),'utf8');
  const code=source.slice(source.indexOf('  if(!text || text === "（未返回内容）"'),source.indexOf('  // 生成完成：把溯源档案'));
  const fixture=(text,structured)=>{
    let appends=0,fallbacks=0,chunks=0;
    const context={text,logicRules:[],c:{name:'总论'},s:{t:'概况'},calcParams:{},calcResult:null,reportBodyContainsInternalLogic:t=>t==='内部逻辑',rlProjectType:()=>'',rlProjectText:()=>'',onChunk:()=>chunks++};
    context.window=context;context.ReportCompletionContract=structured?C:null;
    context.ReportLogicCore={fallbackDraft:()=>{fallbacks++;return '兜底';},ensureMissingMarkers:t=>{appends++;return t+marker;}};
    const run=()=>vm.runInNewContext(code,context);return {context,run,counts:()=>({appends,fallbacks,chunks})};
  };
  const valid=fixture('已验收正文',true);valid.run();assert.equal(valid.context.text,'已验收正文');assert.deepEqual(valid.counts(),{appends:0,fallbacks:0,chunks:0});
  for(const body of ['', '（未返回内容）','内部逻辑']){const f=fixture(body,true);assert.throws(f.run,/未用兜底文字替换/);assert.equal(f.context.text,body);assert.deepEqual(f.counts(),{appends:0,fallbacks:0,chunks:0});}
  const legacy=fixture('',false);legacy.run();assert.equal(legacy.context.text,'兜底'+marker);assert.equal(legacy.counts().appends,1);
});
