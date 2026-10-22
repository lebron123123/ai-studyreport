const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../report-gap-registry.js');
const context=()=>({projectKey:'test:tax',sourceRevision:'materials:1',projectType:'gaibao'});
const req=(section='s1',geo='龙岗区')=>({requirementId:'req:'+section,sectionKey:section,sectionLabel:section+'需求分析',objectKey:'population',geoScope:{level:'district',value:geo},timeScope:{period:'2025'},fields:[{key:'residentPopulation',label:'常住人口'}],critical:true,quality:{minScore:80}});
const ledger=()=>G.fromRequirements([req()],context());
const proposal=(r,status='missing')=>({gapId:r.id,projectKey:'test:tax',sourceRevision:'materials:1',requirementRevision:r.requirementRevision,status,reason:'缺少对应统计期的已核实字段',evidenceIds:[]});
const evidence=r=>({id:'e1',verified:true,projectKey:'test:tax',sourceRevision:'materials:1',requirementRevision:r.requirementRevision,identityKey:G.identityKey(r.identity),locator:'材料1，第3页',claim:'2025年龙岗区常住人口为测试值'});

test('same explicit identity across five sections has one primary and four consequential references',()=>{
  const reg=G.fromRequirements(['s1','s2','s3','s4','s5'].map(s=>req(s)),context());assert.equal(reg.valid,true);assert.equal(reg.records.length,1);assert.equal(reg.records[0].sectionKeys.length,5);
  reg.records[0].status='missing';
  const rows=['s1','s2','s3','s4','s5'].map(sectionKey=>{const p=G.presentation(reg,sectionKey,context());return{sectionKey,text:p.primaryMarkers.concat(p.references.map(r=>r.text)).join('\n'),gapRefs:p.references.map(r=>r.gapId)};});
  assert.equal(rows.filter(r=>r.text.includes('【待补：')).length,1);const check=G.inspect(rows,reg,context());assert.equal(check.ok,true);assert.equal(check.canFinalize,false);assert.equal(check.unresolvedCritical.length,1);
  rows[2].text='本节无问题。';assert.ok(G.inspect(rows,reg,context()).issues.some(x=>x.code==='missing-boundary'));
});
test('distinct geography, time, object and generic unscoped fields are never merged by equal labels',()=>{
  const a=req('s1'),b=req('s2','布吉街道'),c={...req('s3'),timeScope:{period:'2024'}},d={...req('s4'),objectKey:'workers'};
  assert.equal(G.fromRequirements([a,b,c,d],context()).records.length,4);
  delete a.objectKey;delete b.objectKey;b.geoScope=a.geoScope;
  assert.equal(G.fromRequirements([a,b],context()).records.length,2);
});
test('upload/channel flags and a model asserted verified flag cannot close a requirement',()=>{
  const reg=ledger(),p=proposal(reg.records[0],'satisfied');p.evidenceIds=['e1'];p.verified=true;
  const result=G.reconcile(reg,[p],{...context(),hasManualMaterial:true,hasKnowledge:true,evidenceByRule:{all:true}});
  assert.equal(result.accepted.length,0);assert.equal(result.rejected[0].code,'verified-proof-required');assert.equal(result.registry.records[0].status,'unverified');
});
test('verified field-bound evidence can close facts; stale source and requirement proof reopen them',()=>{
  const reg=ledger(),r=reg.records[0],ctx={...context(),verifiedEvidence:[evidence(r)]},p=proposal(r,'satisfied');p.evidenceIds=['e1'];
  const closed=G.reconcile(reg,[p],ctx).registry;assert.equal(closed.records[0].status,'satisfied');assert.equal(G.normalize(closed,ctx).records[0].status,'satisfied');
  assert.equal(G.normalize(closed,{...ctx,sourceRevision:'materials:2'}).records[0].status,'unverified');
  const changed=req();changed.quality={minScore:90};assert.equal(G.fromRequirements([changed],ctx,closed).records[0].status,'unverified');
  assert.equal(G.normalize(closed,{...ctx,verifiedEvidence:[{...evidence(r),identityKey:'another field'}]}).records[0].status,'unverified');
});
test('AI cannot exempt critical requirements; scoped human approval is versioned and auditable',()=>{
  const reg=ledger(),r=reg.records[0],p=proposal(r,'not-applicable');p.reason='该数据不适用于本项目';
  assert.equal(G.reconcile(reg,[p],context()).rejected[0].code,'approval-required');
  const ctx={...context(),humanApproval:{confirmed:true,actorId:'reviewer',reason:'已复核项目范围',sourceRevision:'materials:1',gapIds:[r.id],at:'2026-09-23T00:00:00Z'}};
  const result=G.reconcile(reg,[p],ctx);assert.equal(result.registry.records[0].status,'not-applicable');assert.equal(result.registry.audit.length,1);
  assert.equal(G.normalize(result.registry,context()).records[0].status,'unverified');
  assert.equal(G.normalize(result.registry,{...context(),trustedApprovals:[result.registry.records[0].approval]}).records[0].status,'not-applicable');
  assert.equal(G.normalize(result.registry,{...context(),sourceRevision:'materials:2'}).records[0].status,'unverified');
  assert.equal(G.reconcile(reg,[p],{...ctx,humanApproval:{...ctx.humanApproval,gapIds:[]}}).accepted.length,0);
});
test('corrupt and foreign ledgers fail closed instead of yielding a clean empty report',()=>{
  for(const raw of ['not-json',{schemaVersion:88,records:[]},{...ledger(),projectKey:'other'}, {...ledger(),records:[{id:'bad',status:'satisfied'}]}]){
    const n=G.normalize(raw,context());assert.equal(n.valid,false);assert.equal(G.inspect([],n,context()).canFinalize,false);assert.equal(G.reconcile(n,[],context()).accepted.length,0);
  }
  assert.equal(G.normalize(null,{}).valid,false);
});
test('stale proposals, unknown references, duplicate primary and orphaned requirements stay visible',()=>{
  const reg=ledger(),r=reg.records[0];r.status='missing';assert.equal(G.reconcile(reg,[{...proposal(r),sourceRevision:'old'}],context()).rejected[0].code,'stale-proposal');
  const marker=G.presentation(reg,'s1',context()).primaryMarkers[0];const report=[{sectionKey:'s1',text:marker},{sectionKey:'s2',text:marker,gapRefs:['unknown']}];
  const check=G.inspect(report,reg,context());assert.ok(check.issues.some(x=>x.code==='duplicate-primary'));assert.ok(check.issues.some(x=>x.code==='invalid-reference'));
  const orphan=G.fromRequirements([],context(),reg);assert.equal(orphan.records.length,1);assert.equal(orphan.records[0].orphaned,true);
});
test('legacy markers are migration candidates only, even identical markers in several sections',()=>{
  const c=G.legacyCandidates([{sectionKey:'s1',text:'【待补：资料】'},{sectionKey:'s2',text:'【待补：资料】'}]);assert.equal(c.length,2);assert.ok(c.every(r=>r.requiresIdentityReview));assert.notEqual(c[0].candidateId,c[1].candidateId);
});
test('HTML projection escapes labels and does not mutate source or silently overwrite content',()=>{
  const q=req();q.fields[0].label='<img src=x onerror=alert(1)>';const reg=G.fromRequirements([q],context()),snapshot=JSON.stringify(reg),p=G.presentation(reg,'s1',context());
  assert.ok(!p.html.includes('<img'));assert.match(p.html,/&lt;img/);assert.equal(JSON.stringify(reg),snapshot);assert.match(G.assessmentPrompt(reg,context()),/上传文件、检索渠道存在不等于字段已核实/);
});
test('all unresolved lifecycle states are explicit and cannot become satisfied through normalization',()=>{
  for(const status of G.STATES.filter(x=>!['satisfied','not-applicable'].includes(x))){const reg=ledger(),result=G.reconcile(reg,[proposal(reg.records[0],status)],context());assert.equal(result.registry.records[0].status,status);assert.equal(G.inspect([],result.registry,context()).canFinalize,false);}
});
test('unverified and unlocated are verification boundaries, not false missing-data red blocks',()=>{
  for(const status of ['unverified','unlocated']){
    const reg=ledger();reg.records[0].status=status;const p=G.presentation(reg,'s1',context());assert.equal(p.primaryMarkers.length,0);assert.equal(p.references.length,1);assert.equal(p.forbiddenMarkers.length,1);
    const entries=[{sectionKey:'s1',text:p.references[0].text}];assert.equal(G.inspect(entries,reg,context()).ok,true);assert.equal(G.inspect(entries,reg,context()).canFinalize,false);
    entries[0].text+=p.forbiddenMarkers[0];assert.ok(G.inspect(entries,reg,context()).issues.some(x=>x.code==='unverified-as-missing'));
  }
});
test('changed materials or requirements invalidate previous missing claims, not just approvals',()=>{
  const reg=ledger(),missing=G.reconcile(reg,[proposal(reg.records[0],'missing')],context()).registry;
  assert.equal(G.normalize(missing,{...context(),sourceRevision:'materials:2'}).records[0].status,'unverified');
  const changed=req();changed.quality={minScore:95};const next=G.fromRequirements([changed],context(),missing);assert.equal(next.records[0].status,'unverified');assert.equal(next.records[0].assessment,null);
});

test('distinct identities cannot accidentally share one textual verification boundary',()=>{
  const a=req('s1'),b=req('s1','布吉街道'),reg=G.fromRequirements([a,b],context());
  assert.equal(reg.valid,true);const notices=G.presentation(reg,'s1',context()).references.map(r=>r.text);assert.equal(new Set(notices).size,2);
  assert.equal(G.inspect([{sectionKey:'s1',text:notices[0]}],reg,context()).ok,false);
  assert.equal(G.inspect([{sectionKey:'s1',text:notices.join('\n')}],reg,context()).ok,true);
  const sameLabelDifferentObject={...req('s1'),objectKey:'workers'};
  const ambiguous=G.fromRequirements([a,sameLabelDifferentObject],context());assert.equal(ambiguous.records.length,2);assert.equal(ambiguous.valid,false);
  assert.ok(ambiguous.issues.some(x=>x.code==='ambiguous-display-identity'));assert.equal(G.presentation(ambiguous,'s1',context()).valid,false);
  const fixed={...sameLabelDifferentObject,fields:[{key:'residentPopulation',label:'职工常住人口'}]};assert.equal(G.fromRequirements([a,fixed],context(),ambiguous).valid,true);
});

test('internal time scope enum is rendered as a business label when disambiguation needs it',()=>{
  const rule={...req(),timeScope:{kind:'latest_12_months',maxAgeMonths:12}},other={...req('s2'),timeScope:{kind:'latest_3_years',maxAgeMonths:36}},reg=G.fromRequirements([rule,other],context()),p=G.presentation(reg,'s1',context());
  assert.match(p.references[0].text,/最近十二个月/);assert.doesNotMatch(p.references[0].text,/latest_|12/);
});

test('same heading in distinct sections uses existing owner labels, not automatic merging',()=>{
  const a=req('s1'),b={...req('s2'),objectKey:'workers'},reg=G.fromRequirements([a,b],context());assert.equal(reg.valid,true);assert.equal(reg.records.length,2);
  const rows=['s1','s2'].map(sectionKey=>({sectionKey,text:G.presentation(reg,sectionKey,context()).references.map(r=>r.text).join('')}));assert.notEqual(rows[0].text,rows[1].text);assert.equal(G.inspect(rows,reg,context()).ok,true);
});
