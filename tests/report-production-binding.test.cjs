const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
require('../scripts/windows-browser-lockout-guard.cjs');
const source=fs.readFileSync(path.resolve('report.js'),'utf8');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const production=[part('function reportCompletionFacts(','async function reportBasisMaterialItems('),part('function reportFinancialContext(','function reportReviewCandidate('),part('async function reportDurableSectionCall(','async function callGen(')].join('\n');
const table='<table><tr><th>项目</th><th>面积</th></tr><tr><td>甲</td><td>5973</td></tr></table>';
function reportBindingWaitForStart(started,pending,label,timeoutMs=5000){
  let timer;
  const ended=pending.then(()=>{throw new Error(label+' 未进入预期绑定关卡就已完成');},error=>{throw error;});
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' 等待绑定关卡超时，未悬挂测试')),timeoutMs);});
  return Promise.race([started,ended,deadline]).finally(()=>clearTimeout(timer));
}
test('绑定 fixture 等待安全关卡：前置异常、无信号完成及超时都明确结束，不掩盖原错误',async()=>{
  const never=new Promise(()=>{}),failure=new Error('[系统测试]绑定前的具体异常');
  await assert.rejects(reportBindingWaitForStart(never,Promise.reject(failure),'前置异常'),error=>error===failure);
  await assert.rejects(reportBindingWaitForStart(never,Promise.resolve(),'错误完成'),/未进入预期绑定关卡/);
  await assert.rejects(reportBindingWaitForStart(never,never,'超时',5),/等待绑定关卡超时/);
  await reportBindingWaitForStart(Promise.resolve(),never,'正常关卡');
});

test('生产生成入口将当前成稿计划交给总结上下文，而非仅传目录',async()=>{
  const vm=require('node:vm'),plan={planId:'[系统测试]current-plan'},chapters=[{name:'总论',sections:[{t:'项目概况'}]}];
  let received,releaseTemplates,signalStarted,templatesReady=false;
  const events=[],templatesGate=new Promise(resolve=>{releaseTemplates=resolve;}),started=new Promise(resolve=>{signalStarted=resolve;});
  const stop=new Error('stop-before-model'),ctx={chapters,window:{ReportArgument:true,ReportCompletionContract:true},
    async ensureReportTableTemplates(){events.push('templates:start');signalStarted();await templatesGate;templatesReady=true;events.push('templates:ready');},
    reportCompletionPlan(){assert.equal(templatesReady,true);events.push('plan');return plan;},
    ReportArgument:{summaryContext(...args){events.push('summary');received=args;throw stop;}}};
  vm.createContext(ctx);vm.runInContext(part('async function generateSection(','// 报告逐节生成与逐节AI评审'),ctx);
  const pending=ctx.generateSection(chapters[0],chapters[0].sections[0]),rejected=assert.rejects(pending,e=>e===stop);
  await reportBindingWaitForStart(started,pending,'模板准备');
  assert.deepEqual(events,['templates:start']);assert.equal(received,undefined);
  releaseTemplates();await rejected;
  assert.deepEqual(events,['templates:start','templates:ready','plan','summary']);
  assert.equal(received[0],chapters);assert.equal(received[3].completionPlan,plan);
});

test('生产生成入口模板加载失败时不取得旧计划或调用总结，保留原正文与候选',async()=>{
  const vm=require('node:vm'),section={t:'项目概况',content:'[系统测试]原正文',pendingRevision:{after:'[系统测试]原候选'}},chapters=[{name:'总论',sections:[section]}];
  const failure=Object.assign(new Error('[系统测试]模板未准备好'),{code:'REPORT_TABLE_TEMPLATES_NOT_READY'}),before=JSON.stringify(chapters),events=[];
  const ctx={chapters,window:{ReportArgument:true,ReportCompletionContract:true},
    async ensureReportTableTemplates(){events.push('templates');await Promise.resolve();throw failure;},
    reportCompletionPlan(){events.push('plan');},ReportArgument:{summaryContext(){events.push('summary');}}};
  vm.createContext(ctx);vm.runInContext(part('async function generateSection(','// 报告逐节生成与逐节AI评审'),ctx);
  await assert.rejects(ctx.generateSection(chapters[0],section),error=>error===failure);
  assert.deepEqual(events,['templates']);assert.equal(JSON.stringify(chapters),before);
});

// Real DOM, Markdown, canonical layout, allocation, immutable reference binding
// and production generation admission. Only model transport is an in-memory stub.
test('生产 UI 成稿快照接线：冻结导出同源表、异步防串写、整篇预算先行',{timeout:90000},async t=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main></main>'}));
    await page.goto('http://localhost:8080/[system-test]-production-binding');
    for(const file of ['md.js','report-table-templates.js','report-section-layout.js','report-length-plan.js','report-completion-contract.js','report-business-structure.js','report-financial-tables.js','project-workflow.js'])await page.addScriptTag({path:path.resolve(file)});
    await page.addScriptTag({content:production+'\n'+reportBindingWaitForStart.toString()});
    async function reset(mode='reference'){
      await page.evaluate(({table,mode})=>{
        window.ReportCompletionContract=window.originalContract||ReportCompletionContract;window.originalContract=ReportCompletionContract;
        window.originalTemplates=window.originalTemplates||ReportTableTemplates;
        const cell=(text,col,role='static')=>({text,col,role});
        const template={id:'[system-test]-canonical',title:'规模台账',segments:[{rows:[{cells:[cell('项目',0),cell('面积',1)]},{cells:[cell('甲',0),cell('',1,'value')]}]}]};
        window.ReportTableTemplates={forSection:()=>mode==='canonical'?[template]:[],renderTemplate:originalTemplates.renderTemplate};
        window.chapters=[{name:'项目说明',checked:true,sections:mode==='reference'?[{t:'规模台账',content:'台账说明',editedHtml:table},{t:'建设规模',content:'规模摘要',editedHtml:table}]:[{t:'建设规模',content:'规模说明',editedHtml:table}]}];
        window.project={name:'[系统测试]成稿绑定'};window.calcParams={};window.projectWorkflow={};window.currentProjectId='[系统测试]binding-project';window.kbEntries=[];
        window.rlProjectType=()=> 'gaibao';window.rlBusinessScenario=()=> 'housing_conversion';window.rlProjectText=()=>project.name;window.reportTableProjectType=()=> 'gaibao';window.sectionFormalTemplates=()=>ReportTableTemplates.forSection();window.renderContent=s=>MD.renderHtml(s);window.saveDraft=()=>{};window.ResearchUI=null;
        window.generated=[];window.chunks=[];window.ReportLogicCore=null;
        window.ReportOrchestrationClient={generateSection:async(args,onTask)=>{
          generated.push(args);const c=args.qualityContract,blocks=[{kind:'paragraph',slot:'finding',text:(c.requiredFacts||[]).filter(x=>x.required).map(x=>x.value).join('；')+'。规模按对应台账列示，仍待人工核对。'},...(c.requiredMarkers?.length?[{kind:'paragraph',slot:'conditions',text:c.requiredMarkers.join('')}]:[]),...(c.frozenTables?.tables||[]).map(x=>({kind:'table-ref',id:x.id}))];
          const decoded=ReportCompletionContract.decodeStructured(JSON.stringify({blocks}),c),quality=ReportCompletionContract.inspect(decoded.text,c);
          if(decoded.issues.some(i=>i.severity==='error'))quality.status='blocked';quality.issues.push(...decoded.issues);
          const result={id:'[系统测试]task',runId:'[系统测试]run',status:'completed',text:decoded.text,quality,outputFormat:ReportCompletionContract.OUTPUT_FORMAT};onTask(result);return result;
        }};
      },{table,mode});
    }
    await t.test('完整生成格式恢复再次核对身份、计划、正文和权限，交互调用默认不修复',async()=>{
      for(const change of ['none','project','body','locked','permission']){
        await reset('canonical');
        const r=await page.evaluate(async change=>{
          const transport=ReportOrchestrationClient.generateSection;let optedIn=false,guardPassed=false,error=null;
          window.projectCanEdit=()=>change!=='permission';
          ReportOrchestrationClient.generateSection=async(args,onTask,recovery)=>{
            optedIn=recovery?.autoRepair===true;
            if(change==='project')currentProjectId='[系统测试]another-project';
            if(change==='body')chapters[0].sections[0].editedHtml='人工新输入';
            if(change==='locked')chapters[0].sections[0].locked=true;
            guardPassed=await recovery.beforeRepair();return transport(args,onTask);
          };
          try{await reportDurableSectionCall(chapters[0],chapters[0].sections[0],'s','u',null,{autoRepair:true});}catch(e){error=e.message;}
          delete window.projectCanEdit;return {optedIn,guardPassed,error};
        },change);
        assert.equal(r.optedIn,true,change);
        if(change==='none'){assert.equal(r.guardPassed,true);assert.equal(r.error,null);}
        else{assert.equal(r.guardPassed,false,change);assert.ok(r.error,change);}
      }
      await reset('canonical');
      assert.equal(await page.evaluate(async()=>{let recovery;const transport=ReportOrchestrationClient.generateSection;ReportOrchestrationClient.generateSection=(args,onTask,options)=>{recovery=options;return transport(args,onTask);};await reportDurableSectionCall(chapters[0],chapters[0].sections[0],'s','u');return recovery===undefined;}),true);
    });
    await t.test('冻结 canonical composed 表而非工作稿原始 HTML，重复生成仍同源',async()=>{
      await reset('canonical');
      const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0],before=s.editedHtml,entries=reportCompletionEntries();
        const first=await reportDurableSectionCall(c,s,'s','u',x=>chunks.push(x));
        const again=await reportDurableSectionCall(c,s,'s','u',x=>chunks.push(x));
        return {before,body:s.editedHtml,entry:entries[0].text,first,again,generated,chunks,contract:ProjectWorkflow.generatedContract(s,again),formalContract:s.completionContract||null,formalQuality:s.completionQuality||null};
      });
      assert.notEqual(r.entry,r.before);assert.match(r.entry,/data-(?:canonical-template|template-id)/);
      assert.equal(r.generated.length,2);assert.equal(r.generated[0].sourceHtml,r.entry);assert.equal(r.generated[1].sourceHtml,r.entry);
      assert.equal(r.body,r.before);assert.equal(r.first,r.again);assert.equal(r.chunks.length,2);
      assert.equal(r.formalContract,null);assert.equal(r.formalQuality,null);
      assert.equal(r.contract.frozenTables.tableCount,1);assert.ok(r.first.includes(r.contract.frozenTables.tables[0].html));assert.match(r.first,/5973/);
      assert.ok(r.contract.programProse);assert.ok(r.contract.programProse.entries.length);assert.deepEqual(r.generated[0].qualityContract.programProse,r.generated[1].qualityContract.programProse);
    });
    await t.test('生成前注册全部关键缺口并预留字数，重复生成和重建计划不丢标记',async()=>{
      await reset('canonical');
      const r=await page.evaluate(async()=>{
        window.ReportLogicCore={current:()=>null,match:()=>Array.from({length:5},(_,i)=>({id:i})),generationReadiness:r=>({level:'critical',marker:'关键事项'+r.id})};
        const c=chapters[0],s=c.sections[0],before=s.editedHtml;
        const first=await reportDurableSectionCall(c,s,'s','u'),receipt=ProjectWorkflow.generatedContract(s,first);
        ProjectWorkflow.setCandidate(s,first,'[系统测试]关键缺口候选');const rebuilt=s.pendingRevision.completionContract;
        ProjectWorkflow.rejectCandidate(s);
        const second=await reportDurableSectionCall(c,s,'s','u');
        return {first,second,before,after:s.editedHtml,submitted:generated.map(x=>x.qualityContract),rebuilt,receipt,formal:s.completionContract||null};
      });
      assert.equal(r.first,r.second);assert.equal(r.before,r.after);
      assert.equal(r.submitted.length,2);assert.equal(r.submitted[0].requiredMarkers.length,5);
      assert.deepEqual(r.rebuilt.requiredMarkers,r.submitted[0].requiredMarkers);
      assert.deepEqual(r.receipt.requiredMarkers,r.submitted[0].requiredMarkers);assert.equal(r.formal,null);
      for(const marker of r.submitted[0].requiredMarkers)assert.ok(r.first.includes(marker));
    });
    await t.test('显式候选返修冻结候选自身表格，不回填正式稿 canonical 旧数值',async()=>{
      await reset('canonical');
      const r=await page.evaluate(async({table})=>{
        const c=chapters[0],s=c.sections[0],before=s.editedHtml;
        const candidate={id:'[系统测试]candidate',after:'候选规模待核对。\n\n'+table.replace('5973','7973')};
        s.pendingRevision=candidate;const snapshot=JSON.stringify(candidate),expected=MD.renderHtml(candidate.after);
        const text=await reportDurableSectionCall(c,s,'s','u',null,{candidateRepair:candidate});
        return {text,expected,submitted:generated[0],before,body:s.editedHtml,same:s.pendingRevision===candidate,snapshot,after:JSON.stringify(candidate)};
      },{table});
      assert.equal(r.submitted.sourceHtml,r.expected);assert.match(r.submitted.qualityContract.frozenTables.tables[0].html,/7973/);
      assert.match(r.text,/7973/);assert.doesNotMatch(r.text,/5973/);assert.equal(r.body,r.before);assert.equal(r.same,true);assert.equal(r.after,r.snapshot);
      assert.ok(r.submitted.qualityContract.programProse?.entries.some(e=>e.text.includes('规模台账')),'返修原表不变，但必须预留预览/导出会恢复的模板标题');
    });
    await t.test('真实跨节引用免除本节重复表，重建计划及重复生成可重新核验',async()=>{
      await reset();
      const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[1],entries=reportCompletionEntries(),before=s.editedHtml;
        const first=await reportDurableSectionCall(c,s,'s','u');
        const rebuilt=reportSectionContract(c,s);let normalizeError=null,secondError=null,second=null;
        try{ReportCompletionContract.normalize(rebuilt);}catch(e){normalizeError=e.message;}
        try{second=await reportDurableSectionCall(c,s,'s','u');}catch(e){secondError=e.message;}
        return {entries,first,second,normalizeError,secondError,generated,before,body:s.editedHtml,contract:ProjectWorkflow.generatedContract(s,second),formal:s.completionContract||null};
      });
      assert.match(r.entries[1].text,/rpt-table-reference/);assert.doesNotMatch(r.entries[1].text,/<table\b/);
      assert.equal(r.contract.requiredTables.length,0);assert.ok(r.contract.documentReferences.originalRequiredTables.length>0);
      assert.equal(r.normalizeError,null);assert.equal(r.secondError,null);assert.equal(r.generated.length,2);
      assert.equal(r.first,r.second);assert.match(r.first,/详见第1.1节/);assert.equal(r.body,r.before);
      assert.equal(r.formal,null);
    });
    for(const mutation of ['project','body','plan','lock','candidate','target-table','research-run'])await t.test('documentReferences 异步绑定期间 '+mutation+' 改变，零模型请求',async()=>{
      await reset();
      const r=await page.evaluate(async mutation=>{
        const original=ReportCompletionContract,c=chapters[0],s=c.sections[1];let signal,release;
        const started=new Promise(r=>signal=r),gate=new Promise(r=>release=r);
        window.ReportCompletionContract={...original,async bindDocumentReferences(...args){const bound=await original.bindDocumentReferences(...args);signal();await gate;return bound;}};
        if(mutation==='research-run'){
          window.currentProjectId=null;window.activeRun='[系统测试]run-a';window.ResearchUI={active:()=>true,flush:async()=>{},capture:()=>({researchId:'[系统测试]research',runId:activeRun}),accepts:x=>x.runId===activeRun,guard:async()=>{}};
        }
        const pending=reportDurableSectionCall(c,s,'s','u',x=>chunks.push(x));
        try{await reportBindingWaitForStart(started,pending,'documentReferences '+mutation);}catch(error){release();pending.catch(()=>{});throw error;}
        if(mutation==='project')currentProjectId='[系统测试]other-project';
        if(mutation==='body')s.editedHtml='<p>人工修改</p>'+s.editedHtml;
        if(mutation==='plan')calcParams.area=7000;
        if(mutation==='lock')s.locked=true;
        if(mutation==='candidate')s.pendingRevision={id:'[系统测试]concurrent',after:'并发候选'};
        if(mutation==='target-table')c.sections[0].editedHtml=c.sections[0].editedHtml.replace('5973','7973');
        if(mutation==='research-run')activeRun='[系统测试]run-b';
        const unchanged=JSON.stringify(chapters);release();let error=null;
        try{await pending;}catch(e){error=e.message;}
        return {error,count:generated.length,chunks,unchanged,after:JSON.stringify(chapters),contract:s.completionContract||null};
      },mutation);
      assert.match(r.error,/准备期间/);assert.equal(r.count,0);assert.deepEqual(r.chunks,[]);assert.equal(r.after,r.unchanged);assert.equal(r.contract,null);
    });
    await t.test('documentReferences 异步绑定期间无关兄弟完成不阻断当前生成',async()=>{
      await reset();
      const r=await page.evaluate(async({table})=>{
        const original=ReportCompletionContract,c=chapters[0],s=c.sections[1];
        c.sections.push({t:'独立说明',content:'初稿',editedHtml:table.replace('5973','100')});
        let signal,release;const started=new Promise(r=>signal=r),gate=new Promise(r=>release=r);
        window.ReportCompletionContract={...original,async bindDocumentReferences(...args){const bound=await original.bindDocumentReferences(...args);signal();await gate;return bound;}};
        const pending=reportDurableSectionCall(c,s,'s','u',x=>chunks.push(x));
        try{await reportBindingWaitForStart(started,pending,'无关兄弟完成');}catch(error){release();pending.catch(()=>{});throw error;}
        c.sections[2].content='兄弟节已完成';c.sections[2].editedHtml='<p>独立说明完成。</p>'+table.replace('5973','200');
        release();let error=null,text=null;try{text=await pending;}catch(e){error=e.message;}
        return {error,text,count:generated.length,chunks,source:s.editedHtml,sibling:c.sections[2].editedHtml};
      },{table});
      assert.equal(r.error,null);assert.equal(r.count,1);assert.equal(r.chunks.length,1);assert.match(r.text,/详见第1.1节/);
      assert.match(r.source,/5973/);assert.match(r.sibling,/200/);
    });
    await t.test('模型完成后或自动修复前引用目标改变，旧结果不接收也不继续修复',async()=>{
      for(const stage of ['result','repair']){
        await reset();
        const r=await page.evaluate(async stage=>{
          const transport=ReportOrchestrationClient.generateSection,c=chapters[0],s=c.sections[1],before=s.editedHtml;
          let repairPassed=false,error=null;
          ReportOrchestrationClient.generateSection=async(args,onTask,recovery)=>{
            if(stage==='repair'){
              c.sections[0].editedHtml=c.sections[0].editedHtml.replace('5973','7973');
              repairPassed=await recovery.beforeRepair();
            }
            const result=await transport(args,onTask);
            if(stage==='result')c.sections[0].editedHtml=c.sections[0].editedHtml.replace('5973','7973');
            return result;
          };
          try{await reportDurableSectionCall(c,s,'s','u',x=>chunks.push(x),{autoRepair:true});}catch(e){error=e.message;}
          return {error,repairPassed,chunks,before,after:s.editedHtml,count:generated.length,formal:s.completionContract||null};
        },stage);
        assert.match(r.error,/表格引用的来源或目标已变化/);assert.equal(r.repairPassed,false);assert.deepEqual(r.chunks,[]);
        assert.equal(r.after,r.before);assert.equal(r.formal,null);assert.equal(r.count,stage==='result'?1:0);
      }
    });
    await t.test('程序正文预留异步绑定期间正文变化仍拒绝，零模型请求',async()=>{
      await reset('canonical');
      const r=await page.evaluate(async()=>{
        const original=ReportCompletionContract,c=chapters[0],s=c.sections[0];let signal,release;
        const started=new Promise(r=>signal=r),gate=new Promise(r=>release=r);
        window.ReportCompletionContract={...original,async bindProgramProse(...args){const bound=await original.bindProgramProse(...args);signal();await gate;return bound;}};
        const pending=reportDurableSectionCall(c,s,'s','u');
        try{await reportBindingWaitForStart(started,pending,'programProse');}catch(error){release();pending.catch(()=>{});throw error;}
        s.editedHtml+='<p>新正文</p>';release();
        let error;try{await pending;}catch(e){error=e.message;}return {error,count:generated.length};
      });
      assert.match(r.error,/准备期间/);assert.equal(r.count,0);
    });
    await t.test('保留模板外说明超固定正文预算，生成前阻止且不改原稿',async()=>{
      await reset('canonical');
      const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0];s.editedHtml+='<div class="rpt-table-context">'+('字'.repeat(reportCompletionPlan().sections[0].requirements.proseMax+1))+'</div>';
        const before=s.editedHtml;let error;try{await reportDurableSectionCall(c,s,'s','u');}catch(e){error=e.message;}
        return {error,count:generated.length,before,after:s.editedHtml};
      });
      assert.match(r.error,/占满固定正文预算/);assert.equal(r.count,0);assert.equal(r.before,r.after);
    });
    await t.test('真实整篇必要表分配超限在任何异步绑定与模型调用前阻断，不删原表',async()=>{
      await reset('plain');
      const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0];s.editedHtml='<table><tr><th>项目</th><th>面积</th></tr>'+Array.from({length:620},(_,i)=>'<tr><td>房源'+i+'</td><td>'+i+'</td></tr>').join('')+'</table>';
        const original=ReportCompletionContract;let bindings=0;window.ReportCompletionContract={...original,async bindDocumentReferences(...args){bindings++;return original.bindDocumentReferences(...args);}};
        const before=s.editedHtml,plan=reportCompletionPlan();let error=null;try{await reportDurableSectionCall(c,s,'s','u');}catch(e){error=e.message;}
        return {status:plan.tableAllocation.status,error,bindings,count:generated.length,before,after:s.editedHtml,executionTask:s.executionTask||null};
      });
      assert.equal(r.status,'blocked');assert.match(r.error,/全篇必要表格预算尚未通过/);assert.equal(r.bindings,0);assert.equal(r.count,0);assert.equal(r.before,r.after);assert.equal(r.executionTask,null);
    });
    await t.test('服务端阻断首稿直接展示候选，刷新检查不抹除结构化错误，正式正文不动',async()=>{
      await reset('plain');
      const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0],before=s.editedHtml;
        ReportOrchestrationClient.generateSection=async(args,onTask)=>{const result={id:'[系统测试]blocked',status:'completed',text:'保留全部返回正文，等待人工填写修订要求。',quality:{status:'blocked',issues:[{code:'provider-check',severity:'error',repairable:false,message:'服务端问题不能从文本还原'}]}};onTask(result);return result;};
        let error;try{await reportDurableSectionCall(c,s,'s','u',x=>chunks.push(x));}catch(e){error={code:e.code,saved:e.candidateSaved,text:e.candidateText};}
        return {error,before,after:s.editedHtml,pending:s.pendingRevision,chunks};
      });
      assert.equal(r.error.code,'REPORT_CANDIDATE_QUALITY_BLOCKED');assert.equal(r.error.saved,true);assert.equal(r.pending.after,r.error.text);assert.equal(r.pending.serverQuality.status,'blocked');assert.equal(r.before,r.after);assert.deepEqual(r.chunks,[]);
    });
    await t.test('返修未通过时不覆盖已有候选，错误回传全文供可见人工候选历史接收',async()=>{
      await reset('plain');
      const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0];ProjectWorkflow.setCandidate(s,'人工原候选。','既有');const candidate=s.pendingRevision,before=JSON.stringify(candidate);
        ReportOrchestrationClient.generateSection=async(args,onTask)=>{const result={id:'[系统测试]blocked-repair',status:'completed',text:'新的完整修订，但仍待核对。',quality:{status:'blocked',issues:[{code:'provider-check',severity:'error',repairable:false,message:'人工核对'}]}};onTask(result);return result;};
        let error;try{await reportDurableSectionCall(c,s,'s','u',null,{candidateRepair:candidate});}catch(e){error={code:e.code,saved:e.candidateSaved,text:e.candidateText,quality:e.resultQuality,contract:e.candidateContract};}
        return {before,after:JSON.stringify(s.pendingRevision),error};
      });
      assert.equal(r.before,r.after);assert.equal(r.error.saved,false);assert.equal(r.error.text,'新的完整修订，但仍待核对。');assert.equal(r.error.quality.status,'blocked');assert.ok(r.error.contract.planId);
    });
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
