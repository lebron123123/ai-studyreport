const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../report-gap-workflow.js'),U=require('../report-gap-ui.js');
const G=require('../report-gap-registry.js');
const ctx=()=>({projectKey:'p1',projectType:'gaibao',businessScenario:'housing_conversion',project:{name:'测试项目',location:'龙岗区'},calcParams:{area:100},materials:[{id:'m1',title:'材料',content:'项目改造面积为100平方米，租期尚待双方书面确认。'}],chapters:[{name:'市场分析',sections:[{t:'人口需求',content:'原报告不改'}]}],logicData:{rules:[{id:'pop',chapter:'市场分析',section:'人口需求',displayTitle:'人口需求',importance:'★★★',sourceKinds:['provider'],requiredSources:'常住人口统计',writingLogic:'分析人口需求'}]},context:{requirementOverrides:{}}});
function setup(){const context=ctx(),bundle=W.create(context),registry=bundle.registry,r=registry.records[0];return {context,bundle,registry,p:{gapId:r.id,projectKey:registry.projectKey,sourceRevision:registry.sourceRevision,requirementRevision:r.requirementRevision,status:'unverified',reason:'项目资料尚需核实',evidenceIds:[]}};}
test('AI assessment binds selected IDs and exact evidence; quote is candidate only',()=>{
  const {context,registry,p}=setup(),input=U.assessmentInput(registry,context,[p.gapId]);assert.match(input.prompt,/材料节选/);
  p.candidateEvidence=[{sourceId:'m1',sourceHash:input.sources[0].sourceHash,locator:'材料第1段',quote:'项目改造面积为100平方米'}];
  const parsed=U.parseAssessment(JSON.stringify({proposals:[p]}),registry,input),assessed=W.assess(registry,parsed,{projectKey:registry.projectKey,sourceRevision:registry.sourceRevision});
  assert.equal(assessed.registry.records[0].status,'unverified');assert.equal(assessed.registry.records[0].assessment.candidateEvidence[0].verified,false);
  p.candidateEvidence[0].quote='项目面积为另一虚构数值';assert.throws(()=>U.parseAssessment(JSON.stringify({proposals:[p]}),registry,input),/精确匹配/);
});
test('incomplete excerpts cannot be used to declare confirmed missing; malformed/partial/stale batches rejected',()=>{
  const {context,registry,p}=setup();context.materials[0].content='长资料'.repeat(3000);const input=U.assessmentInput(registry,context,[p.gapId]);assert.equal(input.incomplete,true);
  p.status='missing';assert.equal(U.parseAssessment(JSON.stringify({proposals:[p]}),registry,input)[0].status,'unlocated');
  for(const value of ['bad','{}',JSON.stringify({proposals:[]}),JSON.stringify({proposals:[p,p]}),JSON.stringify({proposals:[{...p,sourceRevision:'stale'}]})])assert.throws(()=>U.parseAssessment(value,registry,input));
});
test('application is explicit, guarded and restores original workflow when both stores fail',async()=>{
  const {context,registry,bundle}=setup(),owner={reportVersions:[{id:'v9'}]},session={identity:'p1',owner,context,sourceRevision:bundle.sourceRevision,sectionKeys:bundle.sectionKeys};let now={...session};
  const deps={current:()=>now,set:workflow=>{now={...now,owner:workflow};},persist:async()=>({ok:false}),actorId:'reviewer'};
  await assert.rejects(U.commit(registry,session,deps),/保存均未成功/);assert.equal(now.owner,owner);assert.equal(owner.reportGapRegistry,undefined);assert.equal(context.chapters[0].sections[0].content,'原报告不改');
  deps.persist=async()=>({ok:true,local:true,remote:false});const saved=await U.commit(registry,session,deps);assert.equal(saved.workflow.reportVersions[0].id,'v9');assert.ok(now.owner.reportGapRegistry.activation.confirmed);
});
test('late save failures and success do not replace newly switched project state',async()=>{
  for(const ok of [false,true]){
    const {context,registry,bundle}=setup(),session={identity:'p1',owner:{},context,sourceRevision:bundle.sourceRevision,sectionKeys:bundle.sectionKeys},other={identity:'p2',owner:{keep:true},context:{...context,projectKey:'p2'}};let now={...session};
    await assert.rejects(U.commit(registry,session,{current:()=>now,set:owner=>{now={...now,owner};},actorId:'reviewer',persist:async()=>{now=other;return{ok};}}));assert.equal(now,other);assert.equal(now.owner.keep,true);
  }
});
test('material changes reject stale sessions and rendered user input is escaped',async()=>{
  const {context,registry,bundle}=setup(),owner={},session={identity:'p1',owner,context,sourceRevision:bundle.sourceRevision,sectionKeys:bundle.sectionKeys};context.materials[0].content='新材料';let writes=0;
  await assert.rejects(U.commit(registry,session,{current:()=>({identity:'p1',owner,context}),set:()=>writes++,persist:async()=>true,actorId:'reviewer'}),/已变化/);assert.equal(writes,0);
  registry.records[0].label='<img src=x onerror=alert(1)>';assert.ok(!U.rowsHtml(registry.records).includes('<img'));assert.match(U.rowsHtml(registry.records),/&lt;img/);
});
test('human confirmation requires explicit scope reason and exact source quotation, while exemptions remain human judgments',()=>{
  const {context,registry,p}=setup(),proposal={gapId:p.gapId,status:'satisfied',confirmed:true,reason:'已经核对项目地域、统计时期及文件正文的适用范围',evidence:{materialId:'m1',quote:'项目改造面积为100平方米',locator:'材料第1段'}};
  const input=U.confirmationInput(registry,proposal,context);assert.equal(input.action,'confirmGap');assert.equal(input.sourceRevision,registry.sourceRevision);
  assert.throws(()=>U.confirmationInput(registry,{...proposal,confirmed:false},context),/明确确认/);
  assert.throws(()=>U.confirmationInput(registry,{...proposal,reason:'已核实'},context),/12至2000/);
  assert.throws(()=>U.confirmationInput(registry,{...proposal,evidence:{...proposal.evidence,quote:'完全不在资料中的其他内容'}},context),/精确匹配/);
  const exemption=U.confirmationInput(registry,{...proposal,status:'not-applicable',evidence:null},context);assert.equal(exemption.evidence,undefined);
  delete context.materials[0].id;proposal.evidence.materialId=W.materialId(context.materials[0]);assert.match(proposal.evidence.materialId,/^material-content:/);assert.equal(U.confirmationInput(registry,proposal,context).evidence.materialId,proposal.evidence.materialId);
  context.materials.push({...context.materials[0]});assert.throws(()=>U.confirmationInput(registry,proposal,context),/唯一编号/);
});
test('closed rows show their current judgment without defaulting to a reopened status',()=>{
  const {registry}=setup();
  for(const status of ['satisfied','not-applicable']){
    registry.records[0].status=status;const html=U.rowsHtml(registry.records);
    assert.ok(html.includes('<option value="" selected disabled>当前：'+U.labels[status]));
    assert.ok(!html.includes('<option value="unverified" selected>'));
  }
});
function closureFixture(key){
  const context=ctx();context.projectKey=key;const bundle=W.create(context),registry=bundle.registry,r=registry.records[0],reason='人工核对该项目的对象与统计期后确认本事项无需另行补充',at='2026-09-23T00:00:00.000Z';
  const closed=G.reconcile(registry,[{gapId:r.id,projectKey:key,sourceRevision:bundle.sourceRevision,requirementRevision:r.requirementRevision,status:'not-applicable',reason,evidenceIds:[]}],{projectKey:key,sourceRevision:bundle.sourceRevision,humanApproval:{confirmed:true,actorId:'reviewer',reason,at,sourceRevision:bundle.sourceRevision,gapIds:[r.id]}}).registry;
  const approval=closed.records[0].approval,receipt={gapId:r.id,approval,signature:'server-test-signature'},gaps={registry:closed,approval,receipt,trustedApprovals:[approval],sourceRevision:bundle.sourceRevision};
  const owner={reportVersions:[{id:'v9'}]},session={identity:key,owner,context,sourceRevision:bundle.sourceRevision,sectionKeys:bundle.sectionKeys};return {context,session,gaps};
}
test('signed closures take effect only after remote persistence; failed sync preserves prior workflow and no new trust',async()=>{
  const {session,gaps}=closureFixture('closure-failure');let now={...session};
  await assert.rejects(U.commitConfirmation(gaps,session,{current:()=>now,set:owner=>{now={...now,owner};},persist:async()=>({ok:true,local:true,remote:false}),actorId:'reviewer'}),/服务器尚未确认/);
  assert.equal(now.owner,session.owner);assert.deepEqual(U.trustedContext(session.context.projectKey,session.sourceRevision).trustedApprovals,[]);
});
test('remote-confirmed closure preserves proof and receipt; trust is version bound and cannot be taken from raw ledger',async()=>{
  const {session,gaps}=closureFixture('closure-success');let now={...session};
  assert.equal(G.normalize(gaps.registry,{projectKey:session.context.projectKey,sourceRevision:session.sourceRevision}).records[0].status,'unverified');
  const saved=await U.commitConfirmation(gaps,session,{current:()=>now,set:owner=>{now={...now,owner};},persist:async()=>({ok:true,remote:true}),actorId:'reviewer'});
  assert.equal(saved.workflow.reportGapRegistry.records[0].status,'not-applicable');assert.equal(saved.workflow.reportVersions[0].id,'v9');assert.deepEqual(saved.workflow.reportGapReceipts[gaps.receipt.gapId],gaps.receipt);
  const trust=U.trustedContext(session.context.projectKey,session.sourceRevision,saved.workflow);assert.equal(trust.trustedApprovals.length,1);trust.trustedApprovals.length=0;assert.equal(U.trustedContext(session.context.projectKey,session.sourceRevision,saved.workflow).trustedApprovals.length,1);
  assert.equal(U.trustedContext(session.context.projectKey,'changed-source').trustedApprovals.length,0);
  assert.throws(()=>U.validateReply({...gaps,sourceRevision:'stale'},session),/资料版本/);
});
test('refresh verification uses server receipts, deduplicates requests and does not mutate saved state',async()=>{
  const {session,gaps}=closureFixture('verify-refresh'),owner={reportGapRegistry:gaps.registry,reportGapReceipts:{[gaps.receipt.gapId]:gaps.receipt}},before=JSON.stringify(owner);let calls=0;
  const previous=Object.fromEntries(['ReportStandardsUI','ResearchUI','reportGapContext','fetch'].map(k=>[k,global[k]]));
  global.ReportStandardsUI={current:()=>({identity:session.identity,owner,sections:session.sectionKeys.map(key=>({key}))})};global.reportGapContext=()=>session.context;global.ResearchUI={active:()=>true,capture:()=>({researchId:'verify',runId:'refresh',epoch:1,expectedVersion:3})};
  global.fetch=async(url,request)=>{calls++;assert.equal(url,'/api/reportexecution');const input=JSON.parse(request.body);assert.equal(input.action,'verifyGaps');assert.equal(input.research.expectedVersion,3);return {ok:true,json:async()=>({ok:true,gaps})};};
  try{assert.equal(U.trustedContext(session.context.projectKey,session.sourceRevision).trustedApprovals.length,0);const result=await Promise.all([U.ensureVerified(),U.ensureVerified()]);assert.equal(calls,1);assert.equal(result[0].verified,true);assert.equal(JSON.stringify(owner),before);assert.equal((await U.ensureVerified()).cached,true);assert.equal(calls,1);}
  finally{for(const[k,v]of Object.entries(previous)){if(v===undefined)delete global[k];else global[k]=v;}}
});
test('verification failure or late response after project switch cannot create trust',async()=>{
  const {session,gaps}=closureFixture('verify-switch'),owner={reportGapRegistry:gaps.registry,reportGapReceipts:{[gaps.receipt.gapId]:gaps.receipt}};let identity=session.identity;
  const previous=Object.fromEntries(['ReportStandardsUI','ResearchUI','reportGapContext','fetch'].map(k=>[k,global[k]]));
  global.ReportStandardsUI={current:()=>({identity,owner,sections:session.sectionKeys.map(key=>({key}))})};global.reportGapContext=()=>session.context;global.ResearchUI={active:()=>true,capture:()=>({researchId:'verify',runId:'switch',epoch:1,expectedVersion:3})};
  try{global.fetch=async()=>{throw new TypeError('fetch failed');};await assert.rejects(U.ensureVerified(),/连接超时或中断/);assert.equal(U.trustedContext(session.context.projectKey,session.sourceRevision).trustedApprovals.length,0);
    global.fetch=async()=>{identity='other-project';return {ok:true,json:async()=>({ok:true,gaps})};};await assert.rejects(U.ensureVerified(),/项目、资料或核实收据已变化/);assert.equal(U.trustedContext(session.context.projectKey,session.sourceRevision).trustedApprovals.length,0);
  }finally{for(const[k,v]of Object.entries(previous)){if(v===undefined)delete global[k];else global[k]=v;}}
});
test('receipt or approval changes revoke cached trust; force failure and late receipt edits cannot retain it',async()=>{
  const {session,gaps}=closureFixture('verify-revocation'),owner={reportGapRegistry:gaps.registry,reportGapReceipts:{[gaps.receipt.gapId]:gaps.receipt}};
  const previous=Object.fromEntries(['ReportStandardsUI','ResearchUI','reportGapContext','fetch'].map(k=>[k,global[k]]));
  global.ReportStandardsUI={current:()=>({identity:session.identity,owner,sections:session.sectionKeys.map(key=>({key}))})};global.reportGapContext=()=>session.context;global.ResearchUI={active:()=>true,capture:()=>({researchId:'verify',runId:'revoke',epoch:1,expectedVersion:3})};
  const success=async()=>({ok:true,json:async()=>({ok:true,gaps})});
  try{
    global.fetch=success;await U.ensureVerified();assert.equal(U.trustedContext(session.identity,session.sourceRevision).trustedApprovals.length,1);
    const receipt=owner.reportGapReceipts[gaps.receipt.gapId];delete owner.reportGapReceipts[gaps.receipt.gapId];assert.equal(U.trustedContext(session.identity,session.sourceRevision).trustedApprovals.length,0);assert.equal((await U.ensureVerified({force:true})).skipped,true);
    owner.reportGapReceipts[gaps.receipt.gapId]=receipt;await U.ensureVerified();global.fetch=async()=>{throw new TypeError('offline');};await assert.rejects(U.ensureVerified({force:true}),/连接超时/);assert.equal(U.trustedContext(session.identity,session.sourceRevision).trustedApprovals.length,0);
    global.fetch=success;await U.ensureVerified();owner.reportGapReceipts[gaps.receipt.gapId]={...receipt,signature:'changed'};assert.equal(U.trustedContext(session.identity,session.sourceRevision).trustedApprovals.length,0);
    owner.reportGapReceipts[gaps.receipt.gapId]=receipt;await U.ensureVerified();owner.reportGapRegistry.records[0].approval={...gaps.approval,reason:'changed'};assert.equal(U.trustedContext(session.identity,session.sourceRevision).trustedApprovals.length,0);owner.reportGapRegistry.records[0].approval=gaps.approval;
    global.fetch=async()=>{delete owner.reportGapReceipts[gaps.receipt.gapId];return success();};await assert.rejects(U.ensureVerified({force:true}),/核实收据已变化/);assert.equal(U.trustedContext(session.identity,session.sourceRevision).trustedApprovals.length,0);
  }finally{for(const[k,v]of Object.entries(previous)){if(v===undefined)delete global[k];else global[k]=v;}}
});
