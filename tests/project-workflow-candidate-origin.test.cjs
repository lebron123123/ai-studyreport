const test=require('node:test');
const assert=require('node:assert/strict');
const WF=require('../project-workflow.js');

const options={inputPlanId:'plan-current',outputPolicyVersion:'policy-current'};
const candidate=()=>({id:'candidate-original',before:'旧正文',after:'完整候选正文',completionInputPlanId:'plan-current',completionContract:{id:'contract-original',version:'contract-v1'},outputPolicyVersion:'policy-current',quality:{status:'passed'},createdAt:'2026-10-09T09:00:00.000Z'});
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('current requires the matching recorded input plan and an existing contract',()=>{
  const result=WF.candidateOrigin(candidate(),options);
  assert.equal(result.status,'current');
  assert.match(result.message,/质量仍须另行核验/);
  const withoutPolicy=candidate();delete withoutPolicy.outputPolicyVersion;
  assert.equal(WF.candidateOrigin(withoutPolicy,options).status,'current');
});

test('legacy candidates stay legacy even with recent timestamps and passed quality',()=>{
  for(const absent of ['completionInputPlanId','completionContract']){
    const old=candidate();delete old[absent];
    const before=JSON.stringify(old),result=WF.candidateOrigin(freeze(old),freeze({...options}));
    assert.equal(result.status,'legacy');
    assert.equal(JSON.stringify(old),before);
    assert.equal(Object.hasOwn(old,absent),false);
  }
  const old={after:'保留旧稿',inputPlanId:options.inputPlanId,quality:{status:'passed'},createdAt:new Date().toISOString()};
  assert.equal(WF.candidateOrigin(old,options).status,'legacy');
  assert.equal(Object.hasOwn(old,'completionInputPlanId'),false);
  assert.equal(Object.hasOwn(old,'completionContract'),false);
});

test('recorded input or policy changes classify the candidate as stale',()=>{
  assert.equal(WF.candidateOrigin(candidate(),{...options,inputPlanId:'plan-new'}).status,'stale');
  assert.equal(WF.candidateOrigin({...candidate(),outputPolicyVersion:'policy-old'},options).status,'stale');
  assert.equal(WF.candidateOrigin({...candidate(),completionInputPlanId:'plan-old'},options).status,'stale');
});

test('unavailable current context cannot classify a persisted candidate as current',()=>{
  for(const context of [undefined,null,{}, {outputPolicyVersion:options.outputPolicyVersion}, {...options,inputPlanId:''}, {...options,inputPlanId:'   '}]){
    assert.equal(WF.candidateOrigin(candidate(),context).status,'legacy');
  }
  assert.equal(WF.candidateOrigin(candidate(),{inputPlanId:options.inputPlanId}).status,'legacy');
});

test('missing or malformed candidate fields are compatible and never fabricated',()=>{
  for(const value of [undefined,null,{},false,'old candidate',[],{completionInputPlanId:' '},{completionInputPlanId:42,completionContract:{}},{completionInputPlanId:options.inputPlanId,completionContract:[]},{completionInputPlanId:options.inputPlanId,completionContract:'old-contract'}]){
    assert.equal(WF.candidateOrigin(value,options).status,'legacy');
  }
});

test('JSON restore and cloning preserve origin without mutating candidate or options',()=>{
  const cases=[candidate(),{...candidate(),completionInputPlanId:'plan-old'}, {id:'legacy',before:'原文',after:'旧候选',quality:{status:'passed'}}];
  for(const value of cases){
    const serialized=JSON.stringify(value),context=freeze({...options}),source=freeze(value);
    const expected=WF.candidateOrigin(source,context);
    assert.deepEqual(WF.candidateOrigin(JSON.parse(serialized),options),expected);
    assert.deepEqual(WF.candidateOrigin(WF.clone(source),options),expected);
    assert.equal(JSON.stringify(source),serialized);
    assert.deepEqual(context,options);
    assert.notEqual(WF.candidateOrigin(source,context),expected);
  }
});
