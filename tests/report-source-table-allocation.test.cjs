'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
require('../scripts/windows-browser-lockout-guard.cjs');
const source=fs.readFileSync(path.resolve(__dirname,'../report.js'),'utf8');
function part(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
const production=[part('function reportCompletionFacts(','async function reportBasisMaterialItems('),part('function reportFinancialContext(','function reportCompletionReviewHtml('),part('async function reportDurableSectionCall(','async function callGen(')].join('\n');
function waitForBinding(started,pending){let timer;return Promise.race([started,pending.then(()=>{throw Error('未进入绑定关卡');},e=>{throw e;}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('绑定关卡超时')),5000);})]).finally(()=>clearTimeout(timer));}

// Exercise the production entry, complete document composer, allocation, binding,
// structured decoder and workflow receipts. No service or paid model is called.
test('已核验初稿/候选的完整表在请求前参加全篇预算，而不写入正式正文',{timeout:90000},async t=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main></main>'}));
    await page.goto('http://localhost:8080/[system-test]-source-table-allocation');
    for(const file of ['md.js','report-table-templates.js','report-section-layout.js','report-length-plan.js','report-completion-contract.js','report-business-structure.js','report-financial-tables.js','project-workflow.js'])await page.addScriptTag({path:path.resolve(__dirname,'..',file)});
    await page.addScriptTag({content:production+'\n'+waitForBinding.toString()});
    async function reset(mode='initial'){
      await page.evaluate(mode=>{
        window.ReportCompletionContract=window.originalContract||ReportCompletionContract;window.originalContract=ReportCompletionContract;
        window.ReportTableTemplates={forSection:()=>[],exportTemplate:()=>null};
        window.chapters=[{cn:'一',name:'项目说明',checked:true,sections:Array.from({length:43},(_,i)=>({t:'事项'+(i+1),content:''}))}];
        window.project={name:'[系统测试]完整表预算',desc:'已收到项目事实'};window.currentProjectId='[系统测试]allocation';window.kbEntries=[];window.calcParams={};window.calcResult=null;window.projectWorkflow={reportCompletion:{facts:[],budgets:{}}};
        window.ReportLogicCore=null;window.ReportOutputPolicy=null;window.ReportLengthUI=null;window.ReportWritingStandard=null;window.ResearchUI=null;window.ReportGapUI=null;
        window.rlProjectType=()=> 'gaibao';window.rlBusinessScenario=()=> 'housing_conversion';window.rlProjectText=()=>project.name;window.reportTableProjectType=()=> 'gaibao';window.sectionFormalTemplates=()=>[];window.renderContent=text=>MD.renderHtml(text);window.saveDraft=()=>{};
        window.makeTable=(rows,chars)=>'<table>'+Array.from({length:rows},()=>'<tr><td>'+('字'.repeat(chars))+'</td><td>'+('项'.repeat(chars))+'</td></tr>').join('')+'</table>';
        window.standardTable='<table>'+Array.from({length:8},(_,r)=>'<tr>'+Array.from({length:2},(_,col)=>'<td>'+('条'.repeat(r*2+col<12?59:58))+'</td>').join('')+'</tr>').join('')+'</table>';
        window.draftSource='完整合作条款分析。\n\n'+standardTable;window.expectedDraft=draftSource;window.generated=[];window.transportOptions=[];window.newRequests=0;window.taskContexts=[];window.runtimeChecks=0;
        window.ReportInitialDeliveryRuntime={assertDraftSource:async(c,s,value)=>{runtimeChecks++;if(value!==expectedDraft)throw Error('本轮初稿来源已变化');},assertRecoveryTask:async(c,s,recovery)=>{if(recovery!==window.expectedRecovery)throw Error('原任务身份已变化');},accepts:()=>true,rememberTask:(c,s,task)=>{taskContexts.push(task.recoveryContext);return true;}};
        window.ReportOrchestrationClient={generateSection:async(args,onTask,options)=>{
          generated.push(args);transportOptions.push(options||null);if(!options?.recovery)newRequests++;
          const contract=args.qualityContract,blocks=[{kind:'paragraph',slot:'finding',text:'依据实际合作条款核对项目责任、履约条件及后续行动。'},...(contract.frozenTables?.tables||[]).map(table=>({kind:'table-ref',id:table.id}))];
          const decoded=ReportCompletionContract.decodeStructured(JSON.stringify({blocks}),contract),quality=ReportCompletionContract.inspect(decoded.text,contract);quality.issues.push(...decoded.issues);if(quality.issues.some(i=>i.severity==='error'))quality.status='blocked';
          const result={id:'[系统测试]task',runId:'[系统测试]run',status:'completed',text:decoded.text,quality,outputFormat:ReportCompletionContract.OUTPUT_FORMAT};onTask(result);return result;
        }};
        if(mode==='repair')chapters[0].sections[0].pendingRevision={id:'[系统测试]candidate',before:'',after:draftSource,completionContract:reportSectionContract(chapters[0],chapters[0].sections[0])};
      },mode);
    }
    for(const mode of ['initial','repair'])await t.test(mode+'：940字8行完整表不再被空正文的旧预分配误挡',async()=>{
      await reset(mode);const r=await page.evaluate(async mode=>{
        const c=chapters[0],s=c.sections[0],before=JSON.stringify(chapters),old=reportSectionContract(c,s),input=reportCandidateInputIdentity();
        const frozenOld=await ReportCompletionContract.bindFrozenTables(old,standardTable,'[系统测试]old');
        const oldQuality=ReportCompletionContract.inspect(standardTable,frozenOld);
        const text=await reportDurableSectionCall(c,s,'s','u',null,mode==='initial'?{initialDraftSource:draftSource}:{candidateRepair:s.pendingRevision});
        const contract=generated[0].qualityContract,receipt=ProjectWorkflow.generatedContract(s,text);
        const bodyUnchanged=chapters.every((ch,ci)=>ch.sections.every((sec,si)=>sec.content===JSON.parse(before)[ci].sections[si].content&&!sec.editedHtml&&!sec.completionContract));
        return {mode,count:generated.length,newRequests,oldLimit:old.requirements.tableCharsMax,oldQuality,metrics:ReportCompletionContract.measure(standardTable),frozenMetrics:ReportCompletionContract.measure(contract.frozenTables.tables[0].html),contract,receipt,input,receiptInput:ProjectWorkflow.generatedInputPlanId(s,text),sameCandidate:JSON.stringify(s.pendingRevision||null)===JSON.stringify(JSON.parse(before)[0].sections[0].pendingRevision||null),bodyUnchanged,text,runtimeChecks};
      },mode);
      assert.equal(r.metrics.tableCharacters,940);assert.equal(r.metrics.tableRows,8);assert.ok(r.oldLimit<940);assert.ok(r.oldQuality.issues.some(i=>i.code==='budget-tableCharacters'&&i.repairable===false));
      assert.equal(r.count,1);assert.equal(r.newRequests,1);assert.equal(r.bodyUnchanged,true);assert.equal(r.sameCandidate,true);assert.deepEqual(r.contract.requiredTables,[]);assert.ok(r.contract.requirements.tableCharsMax>=940);assert.equal(r.contract.frozenTables.tableCount,1);assert.equal(r.frozenMetrics.tableRows,8);assert.equal(r.frozenMetrics.tableCharacters,940);
      assert.deepEqual(r.receipt,r.contract);assert.equal(r.receiptInput,r.input);assert.equal(r.contract.programProse.planId,r.contract.planId);assert.equal(r.contract.programProse.sectionKey,r.contract.sectionKey);assert.match(r.text,/条{58}/);if(mode==='initial')assert.ok(r.runtimeChecks>=3);
    });
    await t.test('预算组合同时包含全篇已采用表，且输出计划变化不使相邻候选失效',async()=>{
      await reset();const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0];c.sections[1].editedHtml=makeTable(40,50);c.sections[1].content='已采用的完整台账';
        const oldPlan=reportCompletionPlan(),input=reportCandidateInputIdentity(),formal=JSON.stringify({content:c.sections[1].content,editedHtml:c.sections[1].editedHtml});
        const sibling=c.sections[2],siblingText='既有分析候选。';ProjectWorkflow.rememberGeneratedContract(sibling,siblingText,oldPlan.sections[2],{completionInputPlanId:input});ProjectWorkflow.setCandidate(sibling,siblingText,'[系统测试]既有候选');
        const candidateBefore=JSON.stringify(sibling.pendingRevision),projection={sectionKey:c.name+' / '+s.t,html:draftSource},plan=reportCompletionPlan(projection),entries=reportCompletionEntries(projection),text=await reportDurableSectionCall(c,s,'s','u',null,{initialDraftSource:draftSource});
        const candidateSame=candidateBefore===JSON.stringify(sibling.pendingRevision);
        return {total:plan.tableAllocation.totals.actual,source:ReportCompletionContract.measure(entries[0].text),sibling:ReportCompletionContract.measure(entries[1].text),global:[plan.tableRowsTotal,plan.tableCharactersTotal],allocated:[plan.sections.reduce((n,s)=>n+s.requirements.tableRowsMax,0),plan.sections.reduce((n,s)=>n+s.requirements.tableCharsMax,0)],oldPlan:oldPlan.planId,newPlan:plan.planId,input,inputAfter:reportCandidateInputIdentity(),quality:reportReviewCandidate(c,sibling),candidateSame,formalSame:formal===JSON.stringify({content:c.sections[1].content,editedHtml:c.sections[1].editedHtml}),receipt:ProjectWorkflow.generatedContract(s,text)};
      });
      assert.equal(r.total.tableCharacters,r.source.tableCharacters+r.sibling.tableCharacters);assert.equal(r.total.tableRows,48);assert.deepEqual(r.global,[600,30000]);assert.deepEqual(r.allocated,r.global);assert.notEqual(r.oldPlan,r.newPlan);assert.equal(r.input,r.inputAfter);assert.equal(r.candidateSame,true);assert.equal(r.formalSame,true);assert.doesNotMatch(JSON.stringify(r.quality.issues),/candidate-input-changed|candidate-generation-receipt-missing/);assert.ok(r.receipt);
    });
    for(const mode of ['rows','characters','manual','cell'])await t.test(mode+' 真正超限仍零请求且不删表',async()=>{
      await reset();const r=await page.evaluate(async mode=>{
        const c=chapters[0],s=c.sections[0];
        if(mode==='rows')c.sections[1].editedHtml=makeTable(593,1);
        if(mode==='characters')c.sections[1].editedHtml=makeTable(100,150);
        if(mode==='manual')projectWorkflow.reportCompletion.budgets[c.name+' / '+s.t]={reason:'人工审签的固定表格上限',tableCharsMax:900};
        if(mode==='cell'){draftSource=makeTable(1,181);expectedDraft=draftSource;}
        const before=JSON.stringify(chapters);let error;try{await reportDurableSectionCall(c,s,'s','u',null,{initialDraftSource:draftSource});}catch(e){error=e.message;}
        const plan=reportCompletionPlan({sectionKey:c.name+' / '+s.t,html:draftSource});return {error,count:generated.length,unchanged:before===JSON.stringify(chapters),allocation:plan.tableAllocation,cellLimit:plan.sections[0].requirements.cellCharsMax,manualLimit:plan.sections[0].requirements.tableCharsMax,global:[plan.tableRowsTotal,plan.tableCharactersTotal]};
      },mode);
      assert.match(r.error,/全篇必要表格预算/);assert.equal(r.count,0);assert.equal(r.unchanged,true);assert.equal(r.allocation.status,'blocked');assert.deepEqual(r.global,[600,30000]);assert.ok(r.allocation.issues.some(i=>i.code===(mode==='manual'?'table-allocation-manual':mode==='cell'?'table-allocation-cell':'table-allocation-capacity')));if(mode==='manual')assert.equal(r.manualLimit,900);if(mode==='cell')assert.equal(r.cellLimit,180);
    });
    for(const mode of ['initial','repair'])await t.test(mode+' 来源在异步绑定期间变化，零请求且不登记迟到回执',async()=>{
      await reset(mode);const r=await page.evaluate(async mode=>{
        const c=chapters[0],s=c.sections[0],original=ReportCompletionContract;let signal,release;const started=new Promise(resolve=>signal=resolve),gate=new Promise(resolve=>release=resolve);
        window.ReportCompletionContract={...original,async bindProgramProse(...args){const contract=await original.bindProgramProse(...args);signal();await gate;return contract;}};
        const pending=reportDurableSectionCall(c,s,'s','u',null,mode==='initial'?{initialDraftSource:draftSource}:{candidateRepair:s.pendingRevision});
        try{await waitForBinding(started,pending);}catch(e){release();pending.catch(()=>{});throw e;}
        if(mode==='initial')expectedDraft+='人工更新';else s.pendingRevision.after+='人工更新';
        const before=JSON.stringify(chapters);release();let error;try{await pending;}catch(e){error=e.message;}return {error,count:generated.length,unchanged:before===JSON.stringify(chapters),receipts:s.generatedContracts||s._generatedContracts||null};
      },mode);
      assert.match(r.error,/来源已变化|准备期间/);assert.equal(r.count,0);assert.equal(r.unchanged,true);assert.equal(r.receipts,null);
    });
    await t.test('恢复原任务使用原合同和原身份，不因邻节完成而再次发起AI',async()=>{
      await reset();const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0],text=await reportDurableSectionCall(c,s,'s','u',null,{initialDraftSource:draftSource}),contract=ProjectWorkflow.generatedContract(s,text),context=taskContexts[0];
        window.expectedRecovery={id:'[系统测试]task',runId:'[系统测试]run',context};c.sections[1].editedHtml=makeTable(20,25);
        const before=JSON.stringify(chapters.map(c=>c.sections.map(s=>({content:s.content,editedHtml:s.editedHtml,pendingRevision:s.pendingRevision})))),after=await reportDurableSectionCall(c,s,'s','u',null,{initialDraftSource:draftSource,initialDeliveryRecoveryTask:expectedRecovery});
        const unchanged=before===JSON.stringify(chapters.map(c=>c.sections.map(s=>({content:s.content,editedHtml:s.editedHtml,pendingRevision:s.pendingRevision}))));
        return {text,after,contract,recoveredContract:generated[1].qualityContract,contextSame:taskContexts[1]===context,transport:transportOptions[1],newRequests,count:generated.length,unchanged};
      });
      assert.equal(r.text,r.after);assert.deepEqual(r.recoveredContract,r.contract);assert.equal(r.contextSame,true);assert.equal(r.transport.autoRepair,false);assert.equal(r.transport.recovery.id,'[系统测试]task');assert.equal(r.newRequests,1);assert.equal(r.count,2);assert.equal(r.unchanged,true);
    });
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
