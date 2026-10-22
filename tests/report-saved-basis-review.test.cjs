'use strict';
require('../scripts/windows-browser-lockout-guard.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../report-completion-contract.js'),A=require('../report-argument.js'),B=require('../report-business-structure.js');
const source=fs.readFileSync(require.resolve('../report.js'),'utf8'),exportSource=fs.readFileSync(require.resolve('../export.js'),'utf8');
const part=(text,a,b)=>text.slice(text.indexOf(a),text.indexOf(b,text.indexOf(a)));
const entry=part(source,'function reportBusinessStructureBinding(','\nfunction reportBusinessHeadings(')+'\n'+part(source,'function reportCompletionPlan(','\nfunction reportBasisGroupOptions(');
const key='项目总论 / 编制依据与编制说明';
const taxonomy=[{level:3,text:'编制依据'},{level:4,text:'法律法规层面'},{level:4,text:'政策文件层面'},{level:5,text:'国家层面依据'},{level:4,text:'技术标准与规范层面'},{level:4,text:'项目专项依据'}];
const gaps=['法律法规层面','技术标准与规范层面'].map(text=>'【待补：编制依据 / '+text+'尚未登记可引用依据文件】');
const plain=x=>JSON.parse(JSON.stringify(x));
async function fixture({research=false}={}){
  const section={t:'编制依据与编制说明',content:taxonomy.map(h=>'#'.repeat(h.level)+' '+h.text).join('\n\n'),editedHtml:null,executionTask:{id:'original-task'},pendingRevision:null};
  const chapters=[{cn:'一',name:'项目总论',checked:true,sections:[section]}];
  const box={chapters,projectWorkflow:{reportCompletion:{basisCatalogs:{}}},project:{name:'[系统测试]依据复核'},currentProjectId:research?null:'[系统测试]项目',calcParams:{},ruleVersion:'before',
    kbEntries:[{fileId:'fixture-doc',title:'项目投资请示.docx',content:'根据《关于加快发展保障性租赁住房的意见》（国办发〔2021〕22号）开展。'}],ReportArgument:A,ReportBusinessStructure:B,ReportCompletionContract:C,
    ReportLogicCore:{match:()=>[],current:()=>({data:{}})},reportCompletionFacts:()=>[],reportGenerationRulesIdentity:()=>({version:box.ruleVersion}),reportFinancialIdentity:()=>({}),rlProjectType:()=> 'gaibao',rlProjectText:()=>'',rlBusinessScenario:()=> 'housing_conversion',
    reportCompletionEntries:override=>box.chapters.flatMap(c=>c.sections.map(s=>({key:c.name+' / '+s.t,text:override?.sectionKey===c.name+' / '+s.t?override.html:s.editedHtml||s.content||''})))};
  if(research){box.researchRun='run-fixture';box.ResearchUI={active:()=>true,capture:()=>({researchId:'research-fixture',runId:box.researchRun}),accepts:t=>t.runId===box.researchRun,guard:async t=>{if(t.runId!==box.researchRun)throw Error('研究轮次已变化');}};}
  box.window=box;vm.createContext(box);vm.runInContext(entry,box);
  const raw=box.reportCompletionPlan().sections[0],catalog=await box.reportBasisCatalogFor(raw);
  catalog.items=catalog.items.map(({classification,...item})=>({...item,groups:item.status==='received'?[taxonomy[0],taxonomy[5]]:[taxonomy[0],taxonomy[2],taxonomy[3]]}));
  box.projectWorkflow.reportCompletion.basisCatalogs[key]=plain(catalog);
  const old=box.reportCompletionPlan().sections[0];
  section.completionContract=await C.bindBasisCatalog(old,catalog,(research?box.researchRun:box.currentProjectId)+':'+key);
  section.content=C.decodeStructured(JSON.stringify({blocks:section.completionContract.basisCatalog.items.map(x=>({kind:'basis-ref',id:x.id}))}),section.completionContract).text;
  box.ruleVersion='after';
  const snapshot=()=>JSON.stringify({project:box.project,chapters:box.chapters,workflow:box.projectWorkflow,materials:box.kbEntries});
  return {box,section,snapshot};
}
const errors=r=>r.issues.filter(x=>x.severity==='error');

test('saved review verifies current sources across a changed plan without reviving old contract fields',async()=>{
  const h=await fixture(),fresh=h.box.reportCompletionPlan(),before=h.snapshot();
  assert.notEqual(fresh.planId,h.section.completionContract.planId);
  assert.equal(fresh.sections[0].basisCatalog,undefined);
  assert.deepEqual(errors(C.inspect(h.section.content,fresh.sections[0])).map(x=>x.code),['heading-structure-missing','heading-structure-missing']);
  const receipt=await h.box.reportSavedCompletionReviewPlan(),plan=receipt.takePlan(),contract=plan.sections[0];
  assert.equal(plan.planId,fresh.planId);assert.deepEqual(plain(contract.requirements),plain(fresh.sections[0].requirements));
  assert.deepEqual(plain(contract.requiredHeadings),plain(fresh.sections[0].requiredHeadings));
  const {basisCatalog,...other}=contract;assert.deepEqual(plain(other),plain(fresh.sections[0]));
  assert.deepEqual(plain(basisCatalog),plain(h.section.completionContract.basisCatalog));
  const result=C.inspect(h.section.content,contract);assert.deepEqual(errors(result),[]);
  for(const code of ['basis-coverage-unconfirmed','basis-catalog-unverified','pending-evidence'])assert.ok(result.issues.some(x=>x.code===code),code);
  for(const gap of gaps)assert.ok(h.section.content.includes(gap));
  assert.equal(h.snapshot(),before);assert.equal(h.section.executionTask.id,'original-task');
  assert.throws(()=>receipt.takePlan(),/已使用/);
});

test('verified catalogue does not excuse removed missing-input notices, file entries, headings or added analysis',async()=>{
  const h=await fixture(),contract=(await h.box.reportSavedCompletionReviewPlan()).takePlan().sections[0];
  for(const body of [h.section.content.replace(gaps[0],''),h.section.content.replace('《项目投资请示.docx》',''),h.section.content.replace('国家层面依据','其他分类'),h.section.content+'\n\n上述政策已确认适用本项目。'])
    assert.ok(errors(C.inspect(body,contract)).length,'actual content remains checked');
});

test('stale, corrupted or cross-owner catalogues are rejected without writing saved state',async()=>{
  const cases=[
    h=>h.box.kbEntries[0].content+=' 材料已修订',
    h=>h.box.kbEntries=[],
    h=>h.box.projectWorkflow.reportCompletion.basisCatalogs[key].items[0].title='另一份材料',
    h=>h.section.completionContract.basisCatalog.items[0].title='摘要被篡改',
    h=>h.section.completionContract.basisCatalog.sourceSnapshotId='其他项目:'+key,
    h=>h.section.completionContract.projectType='rent',
    h=>h.box.projectWorkflow.reportCompletion.basisCatalogs['其他章节 / 依据']=plain(h.box.projectWorkflow.reportCompletion.basisCatalogs[key]),
    h=>h.box.chapters[0].sections.push(plain(h.section))
  ];
  for(const change of cases){const h=await fixture();change(h);const before=h.snapshot();await assert.rejects(h.box.reportSavedCompletionReviewPlan());assert.equal(h.snapshot(),before);}
});

test('every asynchronous verification and final consumption reject changed project, body, catalogue, material or plan',async()=>{
  const changes=[h=>h.box.currentProjectId='switched',h=>h.box.project.name+=' changed',h=>h.section.content+=' changed',h=>h.section.editedHtml='<p>edited</p>',h=>h.box.projectWorkflow.reportCompletion.basisCatalogs[key].items[0].title+=' changed',h=>h.box.kbEntries[0].content+=' changed',h=>h.box.ruleVersion='newer',h=>h.box.chapters=plain(h.box.chapters),h=>h.box.projectWorkflow=plain(h.box.projectWorkflow)];
  for(const change of changes){
    const h=await fixture(),receipt=await h.box.reportSavedCompletionReviewPlan();change(h);assert.throws(()=>receipt.takePlan(),/已变化/);
    const p=await fixture(),original=p.box.reportBasisCatalogFor;p.box.reportBasisCatalogFor=async c=>{const out=await original(c);change(p);return out;};
    await assert.rejects(p.box.reportSavedCompletionReviewPlan(),/已变化/);
  }
  for(const boundary of ['verifyBasisCatalog','reportVerifyBasisMaterials']){
    const h=await fixture();
    if(boundary==='verifyBasisCatalog')h.box.ReportCompletionContract={...C,verifyBasisCatalog:async(...args)=>{const result=await C.verifyBasisCatalog(...args);h.section.content+=' changed';return result;}};
    else{const original=h.box.reportVerifyBasisMaterials;h.box.reportVerifyBasisMaterials=async c=>{await original(c);h.section.content+=' changed';};}
    await assert.rejects(h.box.reportSavedCompletionReviewPlan(),/已变化/);
  }
});

test('private research with null project id is valid only for the same research round',async()=>{
  const h=await fixture({research:true}),receipt=await h.box.reportSavedCompletionReviewPlan();
  assert.deepEqual(errors(C.inspect(h.section.content,receipt.takePlan().sections[0])),[]);
  const r=await h.box.reportSavedCompletionReviewPlan();h.box.researchRun='other-round';assert.throws(()=>r.takePlan(),/已变化/);
  await assert.rejects(h.box.reportSavedCompletionReviewPlan(),/工作稿快照/);
  const switched=await fixture();const p=await switched.box.reportSavedCompletionReviewPlan();switched.box.ResearchUI={active:()=>true};assert.throws(()=>p.takePlan(),/已变化/);
});

test('unbound legacy body cannot borrow a pending or QA catalogue and remains unverified',async()=>{
  const h=await fixture(),contract=h.section.completionContract;delete h.section.completionContract;
  h.section.pendingRevision={completionContract:contract};h.section.qa={currentContract:contract};
  const plan=(await h.box.reportSavedCompletionReviewPlan()).takePlan();assert.equal(plan.sections[0].basisCatalog,undefined);
  const review=C.inspect(h.section.content,plan.sections[0]);
  assert.ok(review.issues.some(x=>x.code==='basis-catalog-unverified'));
  assert.notEqual(review.status,'passed');
});

function loadExportPayload(box){
  Object.assign(box,{document:{querySelectorAll:()=>[]},calcResult:null,renderContent:x=>x,htmlToBlocks:x=>[{type:'p',text:x}],exportProvenance:()=>null,getDocNo:()=>'',exportReportPaginationTarget:()=>({min:110,max:130})});
  vm.runInContext(part(exportSource,'function buildExportPayload(){','/* ===== 图表转PNG'),box);
}

test('real export payload consumes verified current review, while historical export never consumes it',async()=>{
  const h=await fixture();loadExportPayload(h.box);
  const savedCompletionReview=await h.box.reportSavedCompletionReviewPlan();
  const payload=h.box.buildExportPayload({stateOnly:true,savedCompletionReview});
  assert.equal(payload.completionReview.planId,h.box.reportCompletionPlan().planId);
  assert.equal(payload.completionReview.issues.some(x=>x.severity==='error'),false);
  assert.equal(payload.completionReview.reviews.flatMap(x=>x.issues).some(x=>x.code==='heading-structure-missing'),false);
  assert.ok(payload.completionReview.reviews.flatMap(x=>x.issues).some(x=>x.code==='basis-catalog-unverified'));
  assert.equal(payload.signed,false);
  let consumed=false;const historical=h.box.buildExportPayload({version:{version:9,chapters:plain(h.box.chapters)},savedCompletionReview:{takePlan(){consumed=true;throw Error('must not use current basis');}}});
  assert.equal(consumed,false);assert.ok(historical.completionReview.issues.some(x=>x.code==='historical-version'));
});

test('export entry awaits review before current payload and does not prepare it for historical versions',async()=>{
  for(const historical of [false,true]){
    const seen=[],version={id:'v9',version:9,chapters:[]},receipt={tag:'fresh'};
    const box={projectWorkflow:{reportVersions:[version]},currentProjectId:'same',document:{getElementById:()=>null},ensureDocxLib:async()=>{},ensureReportTableTemplates:async()=>{},
      reportSavedCompletionReviewPlan:async()=>{await Promise.resolve();seen.push('verified');return receipt;},
      buildExportPayload:options=>{seen.push('payload');assert.equal(options.savedCompletionReview,historical?null:receipt);throw Error('stop-before-export');},alert:message=>seen.push(message)};
    box.window=box;vm.createContext(box);vm.runInContext(part(exportSource,'async function exportWord(){','\nfunction exportReportCompletionGate('),box);
    await box.exportWord(historical?{versionId:'v9'}:{});
    assert.deepEqual(seen.slice(0,-1),historical?['payload']:['verified','payload']);assert.match(seen.at(-1),/stop-before-export/);
  }
});

test('actual pagination uses the same saved review entry and aborts if its source changes',async()=>{
  for(const change of [false,true]){
    const h=await fixture();loadExportPayload(h.box);const original=h.box.buildExportPayload,seen=[],plan=require('../report-length-plan.js').createPlan(h.box.chapters);
    Object.assign(h.box,{ReportLengthUI:{savedPlan:()=>plan},reportInitialDeliveryBodyHash:async()=>h.section.content,ensureDocxLib:async()=>{},ensureReportTableTemplates:async()=>{},
      buildExportPayload:options=>{assert.equal(options.stateOnly,true);assert.ok(options.savedCompletionReview);seen.push('payload');return original(options);},
      buildDocxDocument:(_,p)=>p,docx:{Packer:{toBlob:async p=>{seen.push('packed');return p;}}},verifyReportPageLimit:async()=>({pages:120,receipt:{documentSha256:'actual-sha'}})});
    vm.runInContext(part(exportSource,'async function reportMeasureInitialDeliveryDocument(','/* ================= 测算说明书 Word 导出'),h.box);
    const review=h.box.reportSavedCompletionReviewPlan;h.box.reportSavedCompletionReviewPlan=async()=>{const receipt=await review();if(change)h.box.kbEntries[0].content+=' changed';return receipt;};
    if(change){await assert.rejects(h.box.reportMeasureInitialDeliveryDocument({expectedPlanId:plan.planId}),/已变化/);assert.deepEqual(seen,['payload']);}
    else{const result=await h.box.reportMeasureInitialDeliveryDocument({expectedPlanId:plan.planId});assert.equal(result.pages,120);assert.deepEqual(seen,['payload','packed']);assert.equal(result.qualityReview.reviews.flatMap(x=>x.issues).some(x=>x.code==='heading-structure-missing'),false);}
  }
});

test('isolated browser validates real crypto, rendering and export review after refresh, without suppressing missing-source warnings',{timeout:45000},async()=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true}),h=await fixture();
  const saved=plain({chapters:h.box.chapters,project:h.box.project,projectWorkflow:h.box.projectWorkflow,kbEntries:h.box.kbEntries,currentProjectId:h.box.currentProjectId});
  try{
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(e.message));
    await context.route('**/*',route=>route.request().url()==='https://saved-basis.test/'?route.fulfill({contentType:'text/html',body:'<!doctype html><main id="sheet"></main>'}):route.abort());
    const setup=async()=>{
      await page.goto('https://saved-basis.test/');
      for(const file of ['md.js','report-length-plan.js','report-completion-contract.js','report-argument.js','report-business-structure.js','report-section-layout.js','report-table-templates.js','export.js'])await page.addScriptTag({path:require.resolve('../'+file)});
      await page.evaluate(saved=>{
        Object.assign(window,saved,{calcParams:{},calcResult:null,ruleVersion:'after',renderContent:MD.renderHtml,getDocNo:()=>'',ReportLogicCore:{match:()=>[],current:()=>({data:{}})},reportCompletionFacts:()=>[],reportGenerationRulesIdentity:()=>({version:window.ruleVersion}),reportFinancialIdentity:()=>({}),rlProjectType:()=> 'gaibao',rlProjectText:()=>'',rlBusinessScenario:()=> 'housing_conversion'});
        window.reportCompletionEntries=override=>chapters.flatMap(c=>c.sections.map(s=>({key:c.name+' / '+s.t,text:override?.sectionKey===c.name+' / '+s.t?override.html:s.editedHtml||s.content||''})));
        document.querySelector('#sheet').innerHTML='<div class="section-block" data-cn="一" data-si="0"><div class="body">'+MD.renderHtml(chapters[0].sections[0].content)+'</div></div>';
      },saved);
      await page.addScriptTag({content:entry});
    };
    const inspect=()=>page.evaluate(async()=>{
      const before=JSON.stringify({chapters,projectWorkflow,kbEntries}),receipt=await reportSavedCompletionReviewPlan();
      const payload=buildExportPayload({savedCompletionReview:receipt}),issues=payload.completionReview.reviews.flatMap(x=>x.issues);
      return {errors:issues.filter(x=>x.severity==='error'),warnings:issues.filter(x=>x.severity==='warning').map(x=>x.code),signed:payload.signed,unchanged:before===JSON.stringify({chapters,projectWorkflow,kbEntries}),blocks:payload.chapters[0].sections[0].blocks};
    });
    await setup();const first=await inspect();assert.deepEqual(first.errors,[]);assert.equal(first.signed,false);assert.equal(first.unchanged,true);
    assert.ok(first.warnings.includes('basis-catalog-unverified'));assert.ok(first.warnings.includes('basis-coverage-unconfirmed'));
    for(const gap of gaps)assert.ok(JSON.stringify(first.blocks).includes(gap));
    assert.deepEqual(await inspect(),first);await setup();assert.deepEqual(await inspect(),first);
    await page.evaluate(gap=>{const body=document.querySelector('#sheet .body');body.innerHTML=body.innerHTML.replace(gap,'');},gaps[0]);
    assert.ok((await inspect()).errors.some(x=>x.code==='basis-catalog-content'));
    await setup();const changed=await page.evaluate(async()=>{const receipt=await reportSavedCompletionReviewPlan();kbEntries[0].content+=' revised';try{buildExportPayload({savedCompletionReview:receipt});return 'unexpected success';}catch(error){return error.message;}});assert.match(changed,/已变化/);
    await setup();const historic=await page.evaluate(()=>buildExportPayload({version:{version:9,chapters:JSON.parse(JSON.stringify(chapters))},savedCompletionReview:{takePlan(){throw Error('historical must not borrow current');}}}));
    assert.ok(historic.completionReview.issues.some(x=>x.code==='historical-version'));assert.deepEqual(pageErrors,[]);
    await context.close();
  }finally{await browser.close();}
});
