const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
require('../scripts/windows-browser-lockout-guard.cjs');
const source=fs.readFileSync(path.resolve(__dirname,'../report.js'),'utf8');
function part(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);}
const production=[part('function reportCompletionFacts(','async function reportBasisMaterialItems('),part('function reportFinancialContext(','function reportCompletionReviewHtml('),part('async function reviseSection(','async function callGen(')].join('\n');
function waitForStart(started,pending){let timer;return Promise.race([started,pending.then(()=>{throw Error('未进入预期安全关卡');},error=>{throw error;}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('安全关卡超时')),5000);})]).finally(()=>clearTimeout(timer));}

// Use the real public wrappers, plan, DOM binding, TABLE decoder and workflow.
// Only the model transport and nonessential retrieval helpers are isolated.
test('显式按当前计划重新生成：底层令牌准入、全量新合同、异步隔离与精确片段回执',{timeout:90000},async t=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main></main>'}));
    await page.goto('http://localhost:8080/[system-test]-candidate-regeneration-durable');
    for(const file of ['md.js','report-table-templates.js','report-section-layout.js','report-length-plan.js','report-completion-contract.js','report-business-structure.js','report-financial-tables.js','project-workflow.js','report-argument.js'])await page.addScriptTag({path:path.resolve(__dirname,'..',file)});
    await page.addScriptTag({content:production+'\n'+waitForStart.toString()});
    async function reset(financial=false){
      await page.evaluate(financial=>{
        window.ReportCompletionContract=window.originalCompletionContract||ReportCompletionContract;window.originalCompletionContract=ReportCompletionContract;
        window.ReportTableTemplates={forSection:()=>[],exportTemplate:()=>null};
        const table=financial?'<table><tr><th>指标名称</th><th>单位</th><th>数值</th></tr><tr><td>全周期总收入</td><td>万元</td><td>21750.94</td></tr><tr><td>累计净现值（NPV）</td><td>万元</td><td>880.47</td></tr><tr><td>全投资内部收益率（IRR）</td><td>%</td><td>25.79</td></tr></table>':'<table><tr><th>项目</th><th>面积</th></tr><tr><td>甲</td><td>5973</td></tr></table>';
        window.chapters=[{cn:'一',name:financial?'财务评价':'项目说明',checked:true,sections:[{t:financial?'财务分析':'规模分析',numeric:financial,content:'保留的正式分析。',editedHtml:'<p>保留的正式分析。</p>'+table}]}];
        window.project={name:'[系统测试]显式候选重新生成',desc:'现有项目事实'};window.currentProjectId='[系统测试]regeneration';window.kbEntries=[];
        window.calcParams={discount:4.6};window.calcResult={__ctype:'gaibao',allYears:[2027],income:{2027:{rent:84.7388}},cost:{2027:{collect:16.9478,eng:53.3335,op:13.304,fin:6.3095,total:89.8948}},cf:{2027:{inflow:84.7388,outflow:420.7999,net:-336.0611,cumNet:-336.0611}},summary:{totalIncome:1116.782,totalCost:890.8093,totalNetProfit:149.609,totalNpv:91.0167,irr:12.2566}};
        const snapshot={id:'[系统测试]current-calc',version:3,calcType:'gaibao',projectId:currentProjectId,params:structuredClone(calcParams),summary:structuredClone(calcResult.summary)};
        window.projectWorkflow={calcSnapshots:[snapshot],currentCalcSnapshotId:snapshot.id,reportCompletion:{facts:[]}};window.ReportLogicCore=null;window.ReportOutputPolicy=null;window.ReportLengthUI=null;window.ReportWritingStandard=null;window.ResearchUI=null;window.ReportGapUI=null;
        window.rlProjectType=()=> 'gaibao';window.rlBusinessScenario=()=> 'housing_conversion';window.rlProjectText=()=>project.name;window.reportTableProjectType=()=> 'gaibao';window.sectionFormalTemplates=()=>[];window.renderContent=text=>MD.renderHtml(text);window.blocksToSource=html=>html;window.saveDraft=()=>{};
        window.buildCalcDigest=()=>JSON.stringify(calcResult.summary);window.rlRetrieve=window.reportLocalLogicPrompt=window.kbRetrieve=window.stdRetrieve=window.exampleRetrieve=window.webEvidenceRetrieve=window.excelSourceRetrieve=window.surveyBrief=()=>'';window.mappedExcelSourceRetrieve=window.ragRetrieve=async()=>'';
        window.reportSiteWritingPlan=()=>null;window.ensureReportTableTemplates=async()=>{};window.provStart=()=>({projectFields:[]});window.provConfidence=()=> '待核实';window.reportSectionLogicSnapshot=()=>({rules:[]});window.reportBodyContainsInternalLogic=()=>false;
        window.generated=[];window.chunks=[];window.transportGate=null;window.blockResult=false;window.fragmentText=null;
        window.ReportOrchestrationClient={generateSection:async(args,onTask)=>{
          generated.push(args);if(transportGate){transportGate.signal();await transportGate.gate;}
          if(fragmentText!==null)return {id:'[系统测试]excerpt-task',text:fragmentText,status:'completed'};
          const contract=args.qualityContract,blocks=[{kind:'paragraph',slot:'finding',text:'当前计划形成的完整项目分析，保留真实结构与具体项目事实。'},...(contract.frozenTables?.tables||[]).map(table=>({kind:'table-ref',id:table.id}))];
          const decoded=ReportCompletionContract.decodeStructured(JSON.stringify({blocks}),contract),quality=ReportCompletionContract.inspect(decoded.text,contract);quality.issues.push(...decoded.issues);
          if(blockResult)quality.issues.push({code:'[system-test]-quality',severity:'error',repairable:false,message:'可见质量失败，原稿保留'});
          if(quality.issues.some(issue=>issue.severity==='error'))quality.status='blocked';const result={id:'[系统测试]task',runId:'[系统测试]run',status:'completed',text:decoded.text,quality,outputFormat:ReportCompletionContract.OUTPUT_FORMAT};onTask(result);return result;
        }};
        const c=chapters[0],s=c.sections[0],current=reportSectionContract(c,s),old=ReportCompletionContract.normalize({...current,planId:'[系统测试]old-plan',requirements:{...current.requirements,proseTarget:1,proseMin:0,proseMax:10}});
        s.pendingRevision={id:'[系统测试]old-candidate',before:s.editedHtml,after:'旧短稿。'+table.replace('5973','7973'),completionContract:old,createdAt:'2026-09-30T00:00:00Z'};
      },financial);
    }
    for(const api of ['revise-object','revise-callback','generate-object','generate-callback'])await t.test('公共入口 '+api+' 转交精确授权，旧短合同不复用且原稿不自动改变',async()=>{
      await reset();const r=await page.evaluate(async api=>{
        const c=chapters[0],s=c.sections[0],old=s.pendingRevision,before=JSON.stringify(old),body=s.editedHtml,token=ProjectWorkflow.candidateToken(old),options={candidateRegeneration:token};
        const expected=reportSectionContract(c,s),input=reportCandidateInputIdentity(),callback=text=>chunks.push(text);
        const text=api==='revise-object'?await reviseSection(c,s,'按当前计划重新生成',options):api==='revise-callback'?await reviseSection(c,s,'按当前计划重新生成',callback,options):api==='generate-object'?await generateSection(c,s,options):await generateSection(c,s,callback,options);
        return {text,count:generated.length,submitted:generated[0],receipt:ProjectWorkflow.generatedContract(s,text),input:ProjectWorkflow.generatedInputPlanId(s,text),expectedInput:input,expectedTarget:expected.requirements.proseTarget,unchanged:s.pendingRevision===old&&JSON.stringify(old)===before&&s.editedHtml===body,chunks,formal:s.completionContract||null};
      },api);
      assert.equal(r.count,1);assert.equal(r.unchanged,true);assert.equal(r.formal,null);assert.equal(r.receipt.requirements.proseTarget,r.expectedTarget);assert.ok(r.expectedTarget>1);assert.notEqual(r.receipt.planId,'[系统测试]old-plan');
      assert.match(r.text,/5973/);assert.doesNotMatch(r.text,/7973/);assert.equal(r.input,r.expectedInput);assert.equal(r.chunks.length,api.endsWith('callback')?1:0);
    });
    await t.test('财务旧候选重新生成使用当前测算与当前来源凭据，不使用候选旧冻结表',async()=>{
      await reset(true);const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0],before=JSON.stringify(s.pendingRevision),body=s.editedHtml,text=await reviseSection(c,s,'按当前测算和篇幅重新生成',{candidateRegeneration:ProjectWorkflow.candidateToken(s.pendingRevision)});
        return {text,source:generated[0].sourceHtml,receipt:ProjectWorkflow.generatedFinancialSource(s,text),expected:ReportFinancialTables.bindSource(reportFinancialContext()),unchanged:before===JSON.stringify(s.pendingRevision)&&body===s.editedHtml};
      });
      assert.equal(r.unchanged,true);assert.deepEqual(r.receipt,r.expected);for(const text of [r.text,r.source]){assert.match(text,/1116\.782/);assert.match(text,/91\.0167/);assert.doesNotMatch(text,/21750\.94|880\.47|25\.79/);}
    });
    await t.test('缺授权、错误或过期令牌、令牌无候选、返修混用均零模型请求',async()=>{
      for(const mode of ['missing','wrong-id','wrong-hash','stale','missing-candidate','repair','excerpt']){
        await reset();const r=await page.evaluate(async mode=>{
          const c=chapters[0],s=c.sections[0],token=ProjectWorkflow.candidateToken(s.pendingRevision),options={candidateRegeneration:token};
          if(mode==='missing')delete options.candidateRegeneration;if(mode==='wrong-id')token.id+='x';if(mode==='wrong-hash')token.contentHash+='x';if(mode==='stale')s.pendingRevision.after+='新人工修改';if(mode==='missing-candidate')s.pendingRevision=null;if(mode==='repair')options.candidateRepair=s.pendingRevision;if(mode==='excerpt')options.excerpt=true;
          const before=JSON.stringify(s);let error;try{await reportDurableSectionCall(c,s,'s','u',null,options);}catch(e){error=e.message;}return {error,count:generated.length,before,after:JSON.stringify(s)};
        },mode);assert.match(r.error,/已有候选|授权/);assert.equal(r.count,0,mode);assert.equal(r.before,r.after,mode);
      }
    });
    for(const stage of ['binding','model','permission'])await t.test(stage+' 异步期间候选替换/原位修改及输入变化均拒收，不登记迟到回执',async()=>{
      for(const mutation of ['replacement','in-place','body','input']){
        await reset();const r=await page.evaluate(async({stage,mutation})=>{
          const c=chapters[0],s=c.sections[0],options={candidateRegeneration:ProjectWorkflow.candidateToken(s.pendingRevision)};let signal,release;const started=new Promise(resolve=>signal=resolve),gate=new Promise(resolve=>release=resolve);
          if(stage==='binding'){const original=ReportCompletionContract;window.ReportCompletionContract={...original,async bindProgramProse(...args){const contract=await original.bindProgramProse(...args);signal();await gate;return contract;}};}
          if(stage==='model')window.transportGate={signal,gate};
          if(stage==='permission'){window.currentProjectId=null;window.ResearchUI={active:()=>true,capture:()=>({researchId:'[系统测试]research',runId:'[系统测试]run'}),accepts:()=>true,flush:async()=>{},guard:async()=>{signal();await gate;}};}
          const pending=reportDurableSectionCall(c,s,'s','u',text=>chunks.push(text),options);try{await waitForStart(started,pending);}catch(error){release();pending.catch(()=>{});throw error;}
          if(mutation==='replacement')s.pendingRevision={id:'[系统测试]human',after:'新人工候选'};if(mutation==='in-place')s.pendingRevision.after+='原位人工修改';if(mutation==='body')s.editedHtml+='<p>新人工正文</p>';if(mutation==='input')project.desc='改变后的真实项目事实';
          const candidate=JSON.stringify(s.pendingRevision),body=s.editedHtml;release();let error;try{await pending;}catch(e){error=e.message;}
          const text=generated[0]?.qualityContract?ReportCompletionContract.decodeStructured(JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'当前计划形成的完整项目分析，保留真实结构与具体项目事实。'},...(generated[0].qualityContract.frozenTables?.tables||[]).map(table=>({kind:'table-ref',id:table.id}))]}),generated[0].qualityContract).text:'';
          return {error,count:generated.length,candidateUnchanged:candidate===JSON.stringify(s.pendingRevision),bodyUnchanged:body===s.editedHtml,receipt:ProjectWorkflow.generatedContract(s,text),chunks};
        },{stage,mutation});assert.match(r.error,/准备期间|生成期间|权限复核期间/);assert.equal(r.count,stage==='binding'?0:1);assert.equal(r.candidateUnchanged,true);assert.equal(r.bodyUnchanged,true);assert.equal(r.receipt,null);assert.deepEqual(r.chunks,[]);
      }
    });
    for(const stage of ['binding','model','permission'])await t.test(stage+' 并发完成其他小节不误判为生成输入变化',async()=>{
      await reset();const r=await page.evaluate(async stage=>{
        const c=chapters[0],s=c.sections[0];
        c.sections.push({t:'其他项目分析',checked:true,content:'已确认的项目分析。',editedHtml:'<p>已确认的项目分析。</p>'});
        let signal,release;const started=new Promise(resolve=>signal=resolve),gate=new Promise(resolve=>release=resolve);
        if(stage==='binding'){const original=ReportCompletionContract;window.ReportCompletionContract={...original,async bindProgramProse(...args){const contract=await original.bindProgramProse(...args);signal();await gate;return contract;}};}
        if(stage==='model')window.transportGate={signal,gate};
        if(stage==='permission'){window.currentProjectId=null;window.ResearchUI={active:()=>true,capture:()=>({researchId:'[系统测试]research',runId:'[系统测试]run'}),accepts:()=>true,flush:async()=>{},guard:async()=>{signal();await gate;}};}
        const input=reportCandidateInputIdentity(),plan=reportCompletionPlan().planId,body=s.editedHtml,candidate=JSON.stringify(s.pendingRevision);
        const pending=reportDurableSectionCall(c,s,'s','u',null,{candidateRegeneration:ProjectWorkflow.candidateToken(s.pendingRevision)});
        try{await waitForStart(started,pending);}catch(error){release();pending.catch(()=>{});throw error;}
        c.sections[1].content='### 1. 已生成的市场分析\n\n保留具体项目分析。';
        c.sections[1].editedHtml='<h3>1. 已生成的市场分析</h3><p>保留具体项目分析。</p><table><tr><th>比较项</th><th>项目特点</th></tr><tr><td>户型</td><td>按已收到的资料分析</td></tr></table>';
        const changedPlan=reportCompletionPlan().planId,inputAfter=reportCandidateInputIdentity();release();
        const text=await pending;
        return {input,inputAfter,plan,changedPlan,text,receipt:ProjectWorkflow.generatedContract(s,text),receiptInput:ProjectWorkflow.generatedInputPlanId(s,text),unchanged:body===s.editedHtml&&candidate===JSON.stringify(s.pendingRevision)};
      },stage);
      assert.notEqual(r.plan,r.changedPlan);assert.equal(r.input,r.inputAfter);assert.equal(r.receiptInput,r.input);assert.ok(r.receipt);assert.equal(r.unchanged,true);assert.match(r.text,/完整项目分析/);
    });
    await t.test('新稿质量失败仍保留旧候选与正文，返回完整新稿和真实当前回执供显式替换',async()=>{
      await reset();const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0],before=JSON.stringify(s.pendingRevision),body=s.editedHtml;window.blockResult=true;let error;
        try{await reportDurableSectionCall(c,s,'s','u',null,{candidateRegeneration:ProjectWorkflow.candidateToken(s.pendingRevision)});}catch(e){error={code:e.code,text:e.candidateText,saved:e.candidateSaved};}
        return {error,unchanged:before===JSON.stringify(s.pendingRevision)&&body===s.editedHtml,receipt:ProjectWorkflow.generatedContract(s,error.text),input:ProjectWorkflow.generatedInputPlanId(s,error.text),expected:reportCandidateInputIdentity()};
      });assert.equal(r.error.code,'REPORT_CANDIDATE_QUALITY_BLOCKED');assert.equal(r.error.saved,false);assert.equal(r.unchanged,true);assert.match(r.error.text,/当前计划/);assert.ok(r.receipt);assert.equal(r.input,r.expected);
    });
    await t.test('本轮局部片段登记精确回执而非整节质量通过，人工安全拼接后才转移给完整候选',async()=>{
      await reset();const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0];s.pendingRevision=null;s.editedHtml='原始段落。\n\n保留其他段落。';s.content=s.editedHtml;window.fragmentText='修改后的当前段落。';
        const before=JSON.stringify(s),input=reportCandidateInputIdentity(),replacement=await reviseSectionExcerpt(c,s,'原始段落。','只改选中片段'),contract=ProjectWorkflow.generatedContract(s,replacement),generatedInput=ProjectWorkflow.generatedInputPlanId(s,replacement);
        const noAutomaticCandidate=!s.pendingRevision,formalUnchanged=s.editedHtml===JSON.parse(before).editedHtml&&s.content===JSON.parse(before).content&&!s.completionContract;
        const merged=ProjectWorkflow.replaceSelectedText(s.content,'原始段落。',replacement),beforeTransfer=ProjectWorkflow.generatedContract(s,merged.text),mismatch=ProjectWorkflow.generatedContract(s,replacement+'x');
        ProjectWorkflow.rememberGeneratedContract(s,merged.text,contract,{completionInputPlanId:generatedInput});const candidate=ProjectWorkflow.setCandidate(s,merged.text,'局部修改'),quality=reportReviewCandidate(c,s);
        return {replacement,contract,generatedInput,input,noAutomaticCandidate,formalUnchanged,mismatch,beforeTransfer,candidate,quality,submitted:generated[0]};
      });
      assert.equal(r.noAutomaticCandidate,true);assert.equal(r.formalUnchanged,true);assert.equal(r.mismatch,null);assert.equal(r.beforeTransfer,null);assert.equal(r.generatedInput,r.input);assert.ok(r.contract);assert.equal(r.submitted.qualityContract,undefined);assert.equal(r.candidate.completionInputPlanId,r.input);assert.doesNotMatch(JSON.stringify(r.quality.issues),/candidate-generation-receipt-missing/);assert.match(r.candidate.after,/保留其他段落/);
    });
    assert.deepEqual(pageErrors,[]);
  }finally{await browser.close();}
});
