const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
require('../scripts/windows-browser-lockout-guard.cjs');
const source=fs.readFileSync(path.resolve(__dirname,'../report.js'),'utf8');
const part=(a,b)=>{const start=source.indexOf(a);assert.ok(start>=0,a);const end=source.indexOf(b,start);assert.ok(end>start,b);return source.slice(start,end);};
const production=[part('function reportCompletionFacts(','async function reportBasisMaterialItems('),part('function reportFinancialContext(','function reportCompletionReviewHtml('),part('async function reportDurableSectionCall(','async function callGen(')].join('\n');
const financialTemplateData=fs.readFileSync(path.resolve(__dirname,'../data/report-table-templates-gaibao-housing-v1.json'),'utf8');
const oldSummary='<table><tr><th>指标名称</th><th>单位</th><th>数值</th><th>备注</th></tr><tr><td>全周期总收入</td><td>万元</td><td>21750.94</td><td>住宅租金收入</td></tr><tr><td>总成本费用</td><td>万元</td><td>18444</td><td>成本合计</td></tr><tr><td>累计净现值（NPV）</td><td>万元</td><td>880.47</td><td>折现率6%</td></tr><tr><td>全投资内部收益率（IRR）</td><td>%</td><td>25.79</td><td>旧测算</td></tr></table>';
const oldIncome='<table><tr><th>年份</th><th>住宅租金收入（万元）</th><th>出租率</th><th>租金单价（元/㎡/月）</th></tr><tr><td>2028</td><td>1350</td><td>75%</td><td>75</td></tr></table>';
const oldCost='<table><tr><th>年份</th><th>收楼成本（万元）</th><th>工程费用（万元）</th><th>运营费用（万元）</th><th>财务费用（万元）</th><th>总成本（万元）</th></tr><tr><td>2028</td><td>500</td><td>500</td><td>500</td><td>500</td><td>2000</td></tr></table>';
const oldSensitivity='<table><tr><th>敏感因素</th><th>波动幅度</th><th>全投资IRR（%）</th><th>累计净现值（万元）</th></tr><tr><td>基准方案</td><td>—</td><td>25.79</td><td>880.47</td></tr></table>';
// Deliberately synthetic annual costs. The source adapter copies accepted output;
// this test never recalculates formulas or writes a real project's snapshots.
function fixture(){
  const params={discount:4.6},years=[2027,2028,2029,2030,2031],summary={totalEngCost:480,totalIncome:1116.782,totalCost:890.8093,totalTax:26.4926,totalNetProfit:149.609,totalNpv:91.0167,irr:12.2566,monthlyXirr:12.256550997595134,annualIrr:14.59,paybackInfo:{year:2030,index:4}},result={__ctype:'gaibao',allYears:years,income:{},cost:{},cf:{},resiOccupancy:{},resiRentPrice:{},summary,sens:[{label:'租金 +10%',irr:15.25,npv:150.01}]};
  let cumulative=0;
  years.forEach((year,i)=>{const rent=i?258.0108:84.7388,total=[100.8093,200,200,195,195][i],net=[-336.0611,62.171,131.2985,146.1003,146.1003][i];result.income[year]={rent};result.cost[year]={collect:rent*.2,eng:total*.4,op:rent*.157,fin:i<3?3-i:0,total};result.cf[year]={inflow:rent,outflow:rent-net,net,cumNet:cumulative+=net};result.resiOccupancy[year]=i?.85:.5583;result.resiRentPrice[year]=45;});
  return {params,result,snapshot:{id:'[系统测试]calc-current',version:5,calcType:'gaibao',projectId:'[系统测试]financial-project',params:structuredClone(params),summary:structuredClone(summary)}};
}
function waitForStart(started,pending){let timer;return Promise.race([started,pending.then(()=>{throw Error('生成未进入预期关卡');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('关卡等待超时')),5000);})]).finally(()=>clearTimeout(timer));}

test('财务重生成生产接线：旧冻结表替换为采用测算，正式稿与历史受保护',{timeout:90000},async t=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main></main>'}));
    await page.route('**/data/report-table-templates-gaibao-housing-v1.json',route=>route.fulfill({contentType:'application/json',body:financialTemplateData}));
    await page.route('**/api/reporttables?**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,config:{version:1,status:'baseline',overrides:{}}})}));
    await page.goto('http://localhost:8080/[system-test]-financial-generation');
    for(const file of ['md.js','report-table-templates.js','report-section-layout.js','report-length-plan.js','report-completion-contract.js','report-business-structure.js','report-financial-tables.js','project-workflow.js','export.js'])await page.addScriptTag({path:path.resolve(__dirname,'..',file)});
    await page.addScriptTag({content:production+'\n'+waitForStart.toString()});
    async function reset(realOwnership=false){
      await page.evaluate(async data=>{
        window.ReportCompletionContract=window.originalContract||ReportCompletionContract;window.originalContract=ReportCompletionContract;
        window.originalTemplates=window.originalTemplates||ReportTableTemplates;
        window.ReportTableTemplates={...originalTemplates,forSection:()=>[],exportTemplate:()=>null};
        window.chapters=[{name:'财务评价',checked:true,sections:[{t:'财务分析',numeric:true,content:'旧正文',editedHtml:'<p>财务分析原文。</p>'+data.oldIncome+data.oldCost+data.oldSummary},{t:'投资收益',numeric:false,content:'旧正文',editedHtml:'<p>收益分析原文。</p>'+data.oldSummary},{t:'敏感性分析',numeric:false,content:'旧正文',editedHtml:'<p>风险分析原文。</p>'+data.oldSensitivity}]}];
        window.project={name:'[系统测试]冻结财务表'};window.calcParams=data.fixture.params;window.calcResult=data.fixture.result;window.currentProjectId='[系统测试]financial-project';window.projectWorkflow={calcSnapshots:[data.fixture.snapshot],currentCalcSnapshotId:data.fixture.snapshot.id,reportCompletion:{facts:[]}};window.kbEntries=[];
        window.rlProjectType=()=> 'gaibao';window.rlBusinessScenario=()=> 'housing_conversion';window.rlProjectText=()=>project.name;window.reportTableProjectType=()=> 'gaibao-housing';window.sectionFormalTemplates=()=>[];window.renderContent=s=>MD.renderHtml(s);window.saveDraft=()=>{};window.ResearchUI=null;window.ReportLogicCore=null;window.ReportOutputPolicy=null;window.ReportLengthUI=null;window.ReportWritingStandard=null;
        if(data.realOwnership){
          window.ReportTableTemplates=originalTemplates;await ReportTableTemplates.load('gaibao-housing');
          window.chapters=[{name:'项目总论',checked:true,sections:[{t:'投资估算与经济效益',numeric:true,content:'旧总论',editedHtml:'<p>核心指标应与财务评价一致。</p>'+data.oldSummary}]},{name:'财务评价',checked:true,sections:[{t:'财务评价',numeric:true,content:'旧财务',editedHtml:'<p>财务主表归属于本节。</p>'+data.oldSummary},{t:'盈利能力分析',numeric:true,content:'旧盈利分析',editedHtml:'<p>盈利分析引用财务主表。</p>'+data.oldSummary}]}];
          window.sectionFormalTemplates=(c,s)=>ReportTableTemplates.forSection('gaibao-housing',c.name,s.t);
        }
        window.generated=[];window.chunks=[];window.extraHeadings={};window.extraBlocks=[];window.ReportInitialDeliveryRuntime=null;
        window.ReportOrchestrationClient={generateSection:async(args,onTask)=>{
          generated.push(args);const contract=args.qualityContract,blocks=[...(extraHeadings[args.sectionKey]?[{kind:'heading',slot:'finding',level:3,text:extraHeadings[args.sectionKey]}]:[]),{kind:'paragraph',slot:'finding',text:'当前测算对应的财务分析仍需人工审签。'},...extraBlocks,...(contract.frozenTables?.tables||[]).map(table=>({kind:'table-ref',id:table.id}))],decoded=ReportCompletionContract.decodeStructured(JSON.stringify({blocks}),contract),quality=ReportCompletionContract.inspect(decoded.text,contract);
          quality.issues.push(...decoded.issues);if(quality.issues.some(issue=>issue.severity==='error'))quality.status='blocked';
          const result={id:'[系统测试]financial-task',runId:'[系统测试]run',status:'completed',text:decoded.text,quality,outputFormat:ReportCompletionContract.OUTPUT_FORMAT};onTask(result);return result;
        }};
        for(const chapter of chapters)for(const section of chapter.sections){section.completionContract=await ReportCompletionContract.bindFrozenTables(reportSectionContract(chapter,section),section.editedHtml,'[系统测试]legacy-calc');section.completionQuality={status:'unverified',factsVerified:false,issues:[{code:'old-quality'}]};}
      },{fixture:fixture(),oldSummary,oldIncome,oldCost,oldSensitivity,realOwnership});
    }
    async function resetFirstFinancial(){
      await reset();await page.evaluate(()=>{
        const c=chapters[0],s=c.sections[0],summary=calcResult.summary;c.sections=[s];s.editedHtml='<p>首次财务分析尚未生成。</p>';s.content='';s.completionContract=null;
        extraBlocks=[{kind:'table',title:'财务指标汇总',headers:['指标名称','单位','数值','备注'],rows:[['全周期总收入','万元',summary.totalIncome,'全周期'],['累计净现值（NPV）','万元',summary.totalNpv,'折现率4.6%'],['全投资内部收益率（IRR）','%',summary.irr,'采用测算结果']]}];
      });
    }
    await t.test('重复生成数值财务小节：同步所有来源后规范化，旧重复表不混入新候选',async()=>{
      await reset();
      const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0],before=JSON.stringify(chapters),history=ProjectWorkflow.createReportVersion({},chapters,{}),oldContract=structuredClone(s.completionContract),oldQuality=structuredClone(s.completionQuality),frozenHistory=JSON.stringify(history);
        const first=await reportDurableSectionCall(c,s,'s','u',text=>chunks.push(text)),second=await reportDurableSectionCall(c,s,'s','u');
        const receipt=ProjectWorkflow.generatedContract(s,second),candidate=ProjectWorkflow.setCandidate(s,second,'同步采用的测算');reportReviewCandidate(c,s);
        const candidateContract=structuredClone(candidate.completionContract),candidateQuality=structuredClone(candidate.quality),formalUnchanged=s.editedHtml===JSON.parse(before)[0].sections[0].editedHtml&&JSON.stringify(s.completionContract)===JSON.stringify(oldContract)&&JSON.stringify(s.completionQuality)===JSON.stringify(oldQuality);
        ProjectWorkflow.rejectCandidate(s);const rejected=s.editedHtml===JSON.parse(before)[0].sections[0].editedHtml&&JSON.stringify(s.completionContract)===JSON.stringify(oldContract);
        const again=ProjectWorkflow.setCandidate(s,second,'接受当前测算');reportReviewCandidate(c,s);const accepted=!!ProjectWorkflow.acceptCandidate(s),acceptedContract=structuredClone(s.completionContract),acceptedBody=s.content;
        const composed=reportCompletionEntries().find(entry=>entry.key===c.name+' / '+s.t).text,blocks=htmlToBlocks(composed);
        ProjectWorkflow.undoSection(s);
        return {first,second,source:generated[0].sourceHtml,receipt,candidateContract,candidateQuality,formalUnchanged,rejected,accepted,acceptedContract,acceptedBody,composed,blocks,undo:s.editedHtml===JSON.parse(before)[0].sections[0].editedHtml&&JSON.stringify(s.completionContract)===JSON.stringify(oldContract),historyUnchanged:JSON.stringify(history)===frozenHistory,chunks,plan:reportCompletionPlan().planId};
      });
      assert.equal(r.first,r.second);assert.equal(r.formalUnchanged,true);assert.equal(r.rejected,true);assert.equal(r.accepted,true);assert.equal(r.undo,true);assert.equal(r.historyUnchanged,true);
      for(const html of [r.source,r.first,r.acceptedBody,r.composed]){assert.match(html,/1116\.782/);assert.match(html,/91\.0167/);assert.match(html,/12\.2566/);assert.doesNotMatch(html,/21750\.94|880\.47|25\.79|18444|1350|折现率6%/);}
      assert.match(r.receipt.frozenTables.sourceSnapshotId,/:financial=/);assert.deepEqual(r.candidateContract,r.receipt);assert.deepEqual(r.acceptedContract,r.receipt);assert.notEqual(r.candidateQuality.status,'blocked');
      const docx=require('../docx.umd.js'),buildDocx=require('../docxgen.js'),JSZip=require('../local-server/node_modules/jszip');
      const buffer=await docx.Packer.toBuffer(buildDocx(docx,{project:{name:'[系统测试]新财务表导出'},chapters:[{cn:'一',name:'财务评价',sections:[{title:'财务分析',blocks:r.blocks}]}]})),zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');
      for(const value of ['1116.782','91.0167','12.2566'])assert.ok(xml.includes(value),'DOCX must use same accepted value '+value);
      assert.doesNotMatch(xml,/21750\.94|880\.47|25\.79/);
    });
    await t.test('非 numeric 的敏感性小节同样同步；普通预览不升级正式旧表',async()=>{
      await reset();const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[2],before=s.editedHtml,preview=reportCompletionEntries().find(e=>e.key===c.name+' / '+s.t).text,text=await reportDurableSectionCall(c,s,'s','u'),receipt=ProjectWorkflow.generatedContract(s,text);
        return {before,after:s.editedHtml,preview,text,receipt};
      });assert.equal(r.before,r.after);assert.match(r.preview,/25\.79/);assert.match(r.text,/12\.2566/);assert.match(r.text,/91\.0167/);assert.match(r.text,/15\.25/);assert.doesNotMatch(r.text,/25\.79|880\.47/);assert.match(r.receipt.frozenTables.sourceSnapshotId,/:financial=/);
    });
    await t.test('无旧表首次 AI 新建财务表：真实质量失败保留候选，来源凭据经 normalize 与 JSON 恢复后可返修接受',async()=>{
      await resetFirstFinancial();const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0],before=s.editedHtml,formal=JSON.stringify(s.completionContract);
        extraBlocks.unshift({kind:'heading',slot:'finding',level:2,text:'须由用户返修的标题'});
        let failure;try{await reportDurableSectionCall(c,s,'s','u',text=>chunks.push(text));}catch(error){failure={code:error.code,message:error.message,candidateSaved:error.candidateSaved};}
        const initial=s.pendingRevision;if(!initial)return {failure,generated:generated.length};
        const expected=ReportFinancialTables.bindSource(reportFinancialContext()),initialSource=structuredClone(initial.completionFinancialSource),initialQuality=reportReviewCandidate(c,s),formalUntouched=s.editedHtml===before&&JSON.stringify(s.completionContract)===formal;
        // Real normalize drops unknown contract fields: source metadata must live
        // on the candidate receipt, survive JSON, and not rely on the WeakMap.
        initial.completionContract=ReportCompletionContract.normalize(initial.completionContract);window.chapters=JSON.parse(JSON.stringify(chapters));
        const restoredC=chapters[0],restored=restoredC.sections[0],previous=restored.pendingRevision,restoredSource=structuredClone(previous.completionFinancialSource),restoredQuality=reportReviewCandidate(restoredC,restored);extraBlocks=[];
        const repaired=await reportDurableSectionCall(restoredC,restored,'s','修复标题，保留采用测算表',null,{candidateRepair:previous}),receipt=ProjectWorkflow.generatedFinancialSource(restored,repaired),wrongReceipt=ProjectWorkflow.generatedFinancialSource(restored,repaired+'x');
        const replacement=ProjectWorkflow.replaceCandidate(restored,repaired,'用户发起一次标题返修',{},previous),quality=reportReviewCandidate(restoredC,restored),accepted=!!ProjectWorkflow.acceptCandidate(restored);
        return {failure,initialQuality,restoredQuality,formalUntouched,initialSource,restoredSource,expected,receipt,wrongReceipt,replacement,quality,accepted,repaired,final:restored.content,generated:generated.length,chunks,after:before};
      });
      assert.equal(r.failure.code,'REPORT_CANDIDATE_QUALITY_BLOCKED',JSON.stringify(r));assert.equal(r.failure.candidateSaved,true);assert.equal(r.formalUntouched,true);assert.deepEqual(r.chunks,[]);assert.equal(r.generated,2);
      for(const quality of [r.initialQuality,r.restoredQuality]){assert.equal(quality.status,'blocked');assert.ok(quality.issues.some(i=>i.code==='structured-heading'));assert.ok(!quality.issues.some(i=>i.code==='candidate-financial-source-changed'),JSON.stringify(quality));}
      for(const binding of [r.initialSource,r.restoredSource,r.receipt,r.replacement.completionFinancialSource])assert.deepEqual(binding,r.expected);
      assert.equal(r.wrongReceipt,null);assert.equal(r.replacement.history.length,1);assert.ok(r.replacement.history[0].quality.issues.some(i=>i.code==='structured-heading'));assert.notEqual(r.quality.status,'blocked',JSON.stringify(r.quality));assert.equal(r.accepted,true);
      for(const html of [r.repaired,r.final]){assert.match(html,/1116\.782/);assert.match(html,/91\.0167/);assert.match(html,/12\.2566/);assert.doesNotMatch(html,/21750\.94|880\.47|25\.79/);}
    });
    await t.test('已授权初稿补齐：临时稿不写正文，旧AI财务值经确定性重建才冻结',async()=>{
      await reset();const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0];c.sections=[s];s.content='';s.editedHtml=null;s.completionContract=null;
        const provisional='<h3>投资分类</h3><p>保留项目分析。</p><table><tr><th>指标名称</th><th>单位</th><th>数值</th><th>备注</th></tr><tr><td>全周期总收入</td><td>万元</td><td>21750.94</td><td>旧错误AI数值</td></tr><tr><td>累计净现值（NPV）</td><td>万元</td><td>880.47</td><td>旧错误AI数值</td></tr><tr><td>全投资内部收益率（IRR）</td><td>%</td><td>25.79</td><td>旧错误AI数值</td></tr></table>';
        let checks=0;window.ReportInitialDeliveryRuntime={assertDraftSource:async(ch,sec,text)=>{checks++;if(ch!==c||sec!==s||text!==provisional||s.content||s.editedHtml||s.pendingRevision)throw Error('来源或本轮正文已变化');},captureBlocked:async()=>false};
        extraHeadings[c.name+' / '+s.t]='投资分类';
        const text=await reportDurableSectionCall(c,s,'s','u',null,{initialDraftSource:provisional});
        return {checks,text,source:generated[0].sourceHtml,requiredHeadings:generated[0].qualityContract.requiredHeadings,outline:ReportCompletionContract.headingOutline(text),formal:s.content,edited:s.editedHtml,candidate:s.pendingRevision||null,binding:ProjectWorkflow.generatedFinancialSource(s,text)};
      });
      assert.ok(r.checks>=3);assert.equal(r.formal,'');assert.equal(r.edited,null);assert.equal(r.candidate,null);assert.ok(r.binding);
      assert.deepEqual(r.requiredHeadings,[{level:3,text:'投资分类'}]);assert.deepEqual(r.outline,r.requiredHeadings);assert.match(r.text,/当前测算对应的财务分析仍需人工审签/);
      assert.match(r.source,/<h3>(?:1\.1\.1 )?投资分类<\/h3>/);assert.doesNotMatch(r.source,/&lt;h3|21750\.94|880\.47|25\.79/);assert.match(r.source,/1116\.782/);assert.match(r.text,/12\.2566/);
    });
    await t.test('初稿补齐遗漏投资分类：保留原任务与完整候选，不写正文也不重复请求',async()=>{
      await reset();const r=await page.evaluate(async oldSummary=>{
        const c=chapters[0],s=c.sections[0];c.sections=[s];s.content='';s.editedHtml=null;s.completionContract=null;
        const provisional='<h3>投资分类</h3><p>保留项目分析。</p>'+oldSummary;
        window.ReportInitialDeliveryRuntime={assertDraftSource:async(ch,sec,text)=>{if(ch!==c||sec!==s||text!==provisional||s.content||s.editedHtml)throw Error('来源或本轮正文已变化');},captureBlocked:async()=>false};
        const generate=ReportOrchestrationClient.generateSection;let result,requestOptions;
        ReportOrchestrationClient.generateSection=async(...args)=>{requestOptions=args[2]||null;result=await generate(...args);return result;};
        let failure;try{await reportDurableSectionCall(c,s,'s','u',text=>chunks.push(text),{initialDraftSource:provisional});}catch(e){failure={code:e.code,taskId:e.taskId,candidateSaved:e.candidateSaved,text:e.candidateText};}
        const task=structuredClone(s.executionTask),candidate=structuredClone(s.pendingRevision);let repeat;
        try{await reportDurableSectionCall(c,s,'s','u',null,{initialDraftSource:provisional});}catch(e){repeat=e.message;}
        return {failure,result,requestOptions,task,candidate,taskAfter:s.executionTask,candidateAfter:s.pendingRevision,repeat,count:generated.length,requiredHeadings:generated[0].qualityContract.requiredHeadings,formal:s.content,edited:s.editedHtml,contract:s.completionContract,chunks};
      },oldSummary);
      assert.equal(r.failure.code,'REPORT_CANDIDATE_QUALITY_BLOCKED');assert.equal(r.failure.candidateSaved,true);assert.equal(r.failure.taskId,r.result.id);
      assert.equal(r.count,1);assert.equal(r.requestOptions,null);assert.match(r.repeat,/本节已有候选稿/);assert.deepEqual(r.chunks,[]);
      assert.equal(r.formal,'');assert.equal(r.edited,null);assert.equal(r.contract,null);assert.deepEqual(r.requiredHeadings,[{level:3,text:'投资分类'}]);
      assert.equal(r.task.id,r.result.id);assert.equal(r.task.runId,r.result.runId);assert.equal(r.task.status,'completed');assert.equal(r.task.quality.status,'blocked');assert.deepEqual(r.taskAfter,r.task);
      assert.equal(r.candidate.before,'');assert.equal(r.candidate.after,r.result.text);assert.equal(r.candidate.after,r.failure.text);assert.equal(r.candidate.quality.status,'blocked');assert.deepEqual(r.candidateAfter,r.candidate);
      assert.ok(r.candidate.quality.issues.some(i=>i.code==='heading-structure-missing'&&i.severity==='error'&&i.message.includes('投资分类')));
      assert.ok(r.candidate.completionFinancialSource);assert.match(r.candidate.after,/1116\.782/);assert.match(r.candidate.after,/91\.0167/);assert.match(r.candidate.after,/12\.2566/);assert.doesNotMatch(r.candidate.after,/21750\.94|880\.47|25\.79/);
    });
    await t.test('初稿补齐来源无有效许可不得请求；blocked完整结果留在本轮账本，不抢占候选',async()=>{
      await resetFirstFinancial();let r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0];window.ReportInitialDeliveryRuntime={assertDraftSource:async()=>{throw Error('本轮许可已失效');}};let error;
        try{await reportDurableSectionCall(c,s,'s','u',null,{initialDraftSource:'未经批准的替换稿'});}catch(e){error=e.message;}
        return {error,count:generated.length};
      });assert.match(r.error,/许可已失效/);assert.equal(r.count,0);
      await resetFirstFinancial();r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0],before=s.editedHtml;let captured;
        extraBlocks.unshift({kind:'heading',slot:'finding',level:2,text:'不合法的章节层级'});
        window.ReportInitialDeliveryRuntime={captureBlocked:async(ch,sec,data)=>{captured={...data,same:ch===c&&sec===s};return true;}};let error;
        try{await reportDurableSectionCall(c,s,'s','u');}catch(e){error={code:e.code,candidateSaved:e.candidateSaved,text:e.candidateText};}
        return {error,captured,candidate:s.pendingRevision||null,unchanged:s.editedHtml===before,chunks};
      });assert.equal(r.error.code,'REPORT_CANDIDATE_QUALITY_BLOCKED');assert.equal(r.error.candidateSaved,false);assert.equal(r.candidate,null);assert.equal(r.unchanged,true);assert.deepEqual(r.chunks,[]);assert.equal(r.captured.same,true);assert.equal(r.captured.text,r.error.text);assert.equal(r.captured.quality.status,'blocked');assert.ok(r.captured.taskId);assert.ok(r.captured.financialSource);
    });
    await t.test('首次财务生成没有有效采用测算时拒绝，不借空冻结清单放行',async()=>{
      for(const missing of ['snapshot','result','mismatched-adoption']){
        await resetFirstFinancial();const r=await page.evaluate(async missing=>{
          const c=chapters[0],s=c.sections[0];if(missing==='snapshot'){projectWorkflow.calcSnapshots=[];projectWorkflow.currentCalcSnapshotId=null;}if(missing==='result')window.calcResult=null;if(missing==='mismatched-adoption')calcParams.discount=7;
          const before=JSON.stringify(chapters);let error;try{await reportDurableSectionCall(c,s,'s','u');}catch(e){error={code:e.code,message:e.message};}return {error,before,after:JSON.stringify(chapters),generated:generated.length,candidate:s.pendingRevision||null};
        },missing);assert.equal(r.error?.code,'REPORT_FINANCIAL_SOURCE_INVALID',JSON.stringify(r));assert.match(r.error.message,/财务表同步已暂停/);assert.equal(r.generated,0);assert.equal(r.before,r.after);assert.equal(r.candidate,null);
      }
    });
    await t.test('财务职责已有普通非财务表仍绑定采用测算，新表结构失败候选经刷新合法返修可接受',async()=>{
      await resetFirstFinancial();const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0];s.editedHtml='<p>财务职责原有工作安排表。</p><table><tr><th>工作事项</th><th>安排</th></tr><tr><td>人工核验</td><td>运营前完成</td></tr></table>';
        const before=s.editedHtml;let failure;try{await reportDurableSectionCall(c,s,'s','u');}catch(error){failure={code:error.code,candidateSaved:error.candidateSaved};}
        const expected=ReportFinancialTables.bindSource(reportFinancialContext()),initialQuality=reportReviewCandidate(c,s),formalUnchanged=s.editedHtml===before,candidateSource=structuredClone(s.pendingRevision.completionFinancialSource);s.pendingRevision.completionContract=ReportCompletionContract.normalize(s.pendingRevision.completionContract);window.chapters=JSON.parse(JSON.stringify(chapters));
        const restoredC=chapters[0],restored=restoredC.sections[0],previous=restored.pendingRevision,restoredSource=structuredClone(previous.completionFinancialSource),restoredQuality=reportReviewCandidate(restoredC,restored);
        // Keep the existing frozen-table structure rule. A user-triggered repair
        // cites its frozen ordinary table and presents current financial values
        // as prose instead of admitting an unbound new model-generated table.
        extraBlocks=[{kind:'paragraph',slot:'conditions',text:'采用测算的全周期收入1116.782万元、累计净现值91.0167万元、IRR为12.2566%，仍需人工审签。'}];
        const text=await reportDurableSectionCall(restoredC,restored,'s','保留工作表并按采用测算阐述财务指标',null,{candidateRepair:previous}),receipt=ProjectWorkflow.generatedFinancialSource(restored,text);ProjectWorkflow.replaceCandidate(restored,text,'用户发起合法表引用返修',{},previous);
        const quality=reportReviewCandidate(restoredC,restored),accepted=!!ProjectWorkflow.acceptCandidate(restored);
        return {failure,initialQuality,restoredQuality,text,receipt,expected,candidateSource,restoredSource,quality,accepted,formalUnchanged,final:restored.content,count:generated.length};
      });
      assert.equal(r.failure.code,'REPORT_CANDIDATE_QUALITY_BLOCKED');assert.equal(r.failure.candidateSaved,true);
      for(const quality of [r.initialQuality,r.restoredQuality]){assert.equal(quality.status,'blocked');assert.ok(quality.issues.some(i=>i.code==='structured-frozen-table-rewrite'),JSON.stringify(quality));assert.ok(!quality.issues.some(i=>i.code==='candidate-financial-source-changed'),JSON.stringify(quality));}
      for(const binding of [r.receipt,r.candidateSource,r.restoredSource])assert.deepEqual(binding,r.expected);assert.equal(r.formalUnchanged,true);assert.equal(r.accepted,true);assert.notEqual(r.quality.status,'blocked',JSON.stringify(r.quality));assert.equal(r.count,2);
      for(const html of [r.text,r.final]){assert.match(html,/人工核验/);assert.match(html,/运营前完成/);assert.match(html,/1116\.782/);assert.match(html,/91\.0167/);assert.match(html,/12\.2566/);assert.doesNotMatch(html,/21750\.94|880\.47|25\.79/);}
    });
    await t.test('首次新财务表候选刷新后采用结果变化，接受与返修都拒绝；恢复原来源才可接受',async()=>{
      await resetFirstFinancial();const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0],before=s.editedHtml,text=await reportDurableSectionCall(c,s,'s','u');ProjectWorkflow.setCandidate(s,text,'首次财务表');window.chapters=JSON.parse(JSON.stringify(chapters));
        const restoredC=chapters[0],restored=restoredC.sections[0],candidate=restored.pendingRevision,binding=structuredClone(candidate.completionFinancialSource),op=calcResult.cost[2027].op;calcResult.cost[2027].op+=1;
        const quality=reportReviewCandidate(restoredC,restored),attempts=[];for(let i=0;i<2;i++)attempts.push({quality:ProjectWorkflow.refreshCandidateQuality(restored),accepted:ProjectWorkflow.acceptCandidate(restored)});
        let repairError;try{await reportDurableSectionCall(restoredC,restored,'s','u',null,{candidateRepair:candidate});}catch(error){repairError=error.message;}
        const unchanged=restored.editedHtml===before&&restored.pendingRevision===candidate&&JSON.stringify(candidate.completionFinancialSource)===JSON.stringify(binding),count=generated.length;calcResult.cost[2027].op=op;
        const recovered=reportReviewCandidate(restoredC,restored),accepted=!!ProjectWorkflow.acceptCandidate(restored);return {binding,quality,attempts,repairError,unchanged,count,recovered,accepted};
      });assert.ok(r.binding);assert.equal(r.quality.status,'blocked');assert.ok(r.quality.issues.some(i=>i.code==='candidate-financial-source-changed'),JSON.stringify(r.quality));for(const attempt of r.attempts){assert.equal(attempt.quality.status,'blocked');assert.equal(attempt.accepted,null);}assert.match(r.repairError,/财务表未绑定|财务表同步已暂停|测算已变化|测算.*已改变/);assert.equal(r.unchanged,true);assert.equal(r.count,1);assert.notEqual(r.recovered.status,'blocked',JSON.stringify(r.recovered));assert.equal(r.accepted,true);
    });
    await t.test('历史无来源凭据的新财务候选即使输入身份相同也不能接受或返修',async()=>{
      await resetFirstFinancial();const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0],contract=ReportCompletionContract.normalize(reportSectionContract(c,s)),decoded=ReportCompletionContract.decodeStructured(JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'旧候选没有测算来源回执。'},...extraBlocks]}),contract);
        ProjectWorkflow.setCandidate(s,decoded.text,'历史恢复候选',{completionContract:contract,completionInputPlanId:reportCandidateInputIdentity()});window.chapters=JSON.parse(JSON.stringify(chapters));
        const restoredC=chapters[0],restored=restoredC.sections[0],candidate=restored.pendingRevision,actualFinancial=ReportFinancialTables.hasFinancialTables(MD.renderHtml(candidate.after)),quality=reportReviewCandidate(restoredC,restored),accepted=ProjectWorkflow.acceptCandidate(restored);let error;
        try{await reportDurableSectionCall(restoredC,restored,'s','u',null,{candidateRepair:candidate});}catch(e){error=e.message;}return {actualFinancial,quality,accepted,error,generated:generated.length,same:restored.pendingRevision===candidate,source:candidate.completionFinancialSource||null};
      });assert.equal(r.actualFinancial,true);assert.equal(r.source,null);assert.equal(r.quality.status,'blocked',JSON.stringify(r.quality));assert.ok(r.quality.issues.some(i=>i.code==='candidate-financial-source-changed'));assert.equal(r.accepted,null);assert.match(r.error,/财务表未绑定|重新生成/);assert.equal(r.generated,0);assert.equal(r.same,true);
    });
    await t.test('人工祖先 wrapper 保护继承到冻结表，JSON 恢复后二次生成仍保留人工值且不要求采用测算',async()=>{
      for(const marker of ['data-report-independent','data-report-manual','data-report-financial-manual','data-report-supplement']){
        await reset();const r=await page.evaluate(async({marker,oldSummary})=>{
          const c=chapters[0],s=c.sections[0];c.sections=[s];s.editedHtml='<figure '+marker+'="approved"><div>'+oldSummary+'</div></figure>';s.completionContract=null;projectWorkflow.calcSnapshots=[];projectWorkflow.currentCalcSnapshotId=null;window.calcResult=null;
          const original=s.editedHtml,first=await reportDurableSectionCall(c,s,'s','u'),receipt=ProjectWorkflow.generatedContract(s,first);ProjectWorkflow.setCandidate(s,first,'人工原值首轮生成');const firstQuality=reportReviewCandidate(c,s),firstAccepted=!!ProjectWorkflow.acceptCandidate(s),firstSource=generated[0].sourceHtml;
          s.completionContract=ReportCompletionContract.normalize(s.completionContract);window.chapters=JSON.parse(JSON.stringify(chapters));const restoredC=chapters[0],restored=restoredC.sections[0],second=await reportDurableSectionCall(restoredC,restored,'s','u');ProjectWorkflow.setCandidate(restored,second,'刷新后二次生成');
          const secondSource=generated[1].sourceHtml,sourceMetadata=restored.pendingRevision.completionFinancialSource||null,secondQuality=reportReviewCandidate(restoredC,restored),secondAccepted=!!ProjectWorkflow.acceptCandidate(restored),tables=[first,second,restored.content].map(html=>{const d=new DOMParser().parseFromString(MD.renderHtml(html),'text/html'),table=d.querySelector('table');return {protected:table?.getAttribute(marker),cells:Array.from(table?.rows||[]).map(row=>Array.from(row.cells).map(cell=>cell.textContent)),financial:ReportFinancialTables.hasFinancialTables(d.body.innerHTML)};});
          return {original,first,second,firstSource,secondSource,receipt,firstQuality,secondQuality,firstAccepted,secondAccepted,sourceMetadata,tables};
        },{marker,oldSummary});
        for(const quality of [r.firstQuality,r.secondQuality])assert.notEqual(quality.status,'blocked',marker+' '+JSON.stringify(quality));assert.equal(r.firstAccepted,true,marker);assert.equal(r.secondAccepted,true,marker);assert.equal(r.sourceMetadata,null);assert.doesNotMatch(r.receipt.frozenTables.sourceSnapshotId,/:financial=/);
        for(const html of [r.first,r.second,r.firstSource,r.secondSource]){assert.match(html,/21750\.94/);assert.match(html,/880\.47/);assert.match(html,/25\.79/);assert.doesNotMatch(html,/1116\.782/);}
        for(const table of r.tables){assert.equal(table.protected,'approved',marker);assert.equal(table.financial,false,marker);assert.deepEqual(table.cells,r.tables[0].cells,marker);}
      }
    });
    await t.test('非财务 numeric 建设规模仍可无采用测算生成，不把所有数值职责误当财务',async()=>{
      await reset();const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0];c.name='建设方案';s.t='建设规模';c.sections=[s];s.editedHtml='<table><tr><th>项目</th><th>面积（平方米）</th></tr><tr><td>住宅</td><td>5973</td></tr></table>';s.completionContract=null;projectWorkflow.calcSnapshots=[];projectWorkflow.currentCalcSnapshotId=null;window.calcResult=null;
        const text=await reportDurableSectionCall(c,s,'s','u');ProjectWorkflow.setCandidate(s,text,'普通规模表');const quality=reportReviewCandidate(c,s),source=s.pendingRevision.completionFinancialSource||null,accepted=!!ProjectWorkflow.acceptCandidate(s);return {text,quality,source,accepted,count:generated.length};
      });assert.match(r.text,/5973/);assert.equal(r.source,null);assert.notEqual(r.quality.status,'blocked',JSON.stringify(r.quality));assert.equal(r.accepted,true);assert.equal(r.count,1);
    });
    await t.test('人工与独立财务表保持原值，不要求采用测算或伪造同步凭据',async()=>{
      for(const marker of ['data-report-independent','data-report-manual','data-report-financial-manual']){
        await reset();const r=await page.evaluate(async({marker,oldSummary})=>{
          const c=chapters[0],s=c.sections[0];c.sections=[s];s.editedHtml=oldSummary.replace('<table>','<table '+marker+'="true">');s.completionContract=null;projectWorkflow.calcSnapshots=[];projectWorkflow.currentCalcSnapshotId=null;window.calcResult=null;
          const before=s.editedHtml,text=await reportDurableSectionCall(c,s,'s','u'),receipt=ProjectWorkflow.generatedContract(s,text);ProjectWorkflow.setCandidate(s,text,'保留人工原值');const quality=reportReviewCandidate(c,s),accepted=!!ProjectWorkflow.acceptCandidate(s);
          return {before,text,receipt,quality,accepted};
        },{marker,oldSummary});
        assert.match(r.text,/21750\.94/);assert.match(r.text,/880\.47/);assert.match(r.text,/25\.79/);assert.doesNotMatch(r.text,/1116\.782/);assert.doesNotMatch(r.receipt.frozenTables.sourceSnapshotId,/:financial=/);assert.notEqual(r.quality.status,'blocked',marker);assert.equal(r.accepted,true,marker);
      }
    });
    await t.test('采用测算参数或结果不匹配：冻结旧稿不动，零模型请求',async()=>{
      for(const mismatch of ['params','summary','project','type']){
        await reset();const r=await page.evaluate(async mismatch=>{
          const c=chapters[0],s=c.sections[0];if(mismatch==='params')calcParams.discount=7;if(mismatch==='summary')calcResult.summary.irr=99;if(mismatch==='project')projectWorkflow.calcSnapshots[0].projectId='other';if(mismatch==='type')calcResult.__ctype='rent';const before=JSON.stringify(chapters);let error;try{await reportDurableSectionCall(c,s,'s','u');}catch(e){error=e.message;}return {error,count:generated.length,before,after:JSON.stringify(chapters)};
        },mismatch);assert.match(r.error,/财务表同步已暂停/);assert.equal(r.count,0);assert.equal(r.before,r.after);
      }
    });
    for(const phase of ['binding','model','permission'])await t.test(phase+' 期间当前年度结果变化，拒绝写入新正文或候选',async()=>{
      await reset();const r=await page.evaluate(async phase=>{
        const c=chapters[0],s=c.sections[0],before=s.editedHtml,oldContract=JSON.stringify(s.completionContract),oldQuality=JSON.stringify(s.completionQuality);let signal,release;const started=new Promise(r=>signal=r),gate=new Promise(r=>release=r);
        if(phase==='binding'){const original=ReportCompletionContract;window.ReportCompletionContract={...original,async bindProgramProse(...args){const bound=await original.bindProgramProse(...args);signal();await gate;return bound;}};}
        if(phase==='model'){const original=ReportOrchestrationClient.generateSection;ReportOrchestrationClient.generateSection=async(...args)=>{signal();await gate;return original(...args);};}
        if(phase==='permission'){window.ResearchUI={active:()=>true,capture:()=>({researchId:'[系统测试]research',runId:'[系统测试]run'}),flush:async()=>{},accepts:()=>true,guard:async()=>{signal();await gate;}};}
        const pending=reportDurableSectionCall(c,s,'s','u',text=>chunks.push(text));try{await waitForStart(started,pending);}catch(error){release();pending.catch(()=>{});throw error;}calcResult.cost[2027].op+=1;release();let error;try{await pending;}catch(e){error=e.message;}
        return {error,count:generated.length,chunks,before,after:s.editedHtml,oldContract,contract:JSON.stringify(s.completionContract),oldQuality,quality:JSON.stringify(s.completionQuality),candidate:s.pendingRevision||null,receipt:ProjectWorkflow.generatedContract(s,'wrong text')};
      },phase);assert.match(r.error,/准备期间|生成期间|权限复核期间|测算版本或结果已改变/);assert.equal(r.count,phase==='binding'?0:1);assert.deepEqual(r.chunks,[]);assert.equal(r.before,r.after);assert.equal(r.oldContract,r.contract);assert.equal(r.oldQuality,r.quality);assert.equal(r.candidate,null);assert.equal(r.receipt,null);
    });
    await t.test('测算切换后候选准入问题经重检及接受不能被清掉，恢复同一来源后才可接受',async()=>{
      await reset();const r=await page.evaluate(async()=>{
        const c=chapters[0],s=c.sections[0],before=s.editedHtml,oldContract=JSON.stringify(s.completionContract),text=await reportDurableSectionCall(c,s,'s','u');ProjectWorkflow.setCandidate(s,text,'当前测算');const candidate=s.pendingRevision,originalOp=calcResult.cost[2027].op;calcResult.cost[2027].op+=1;
        const review=reportReviewCandidate(c,s),attempts=[];for(let i=0;i<3;i++){attempts.push({quality:ProjectWorkflow.refreshCandidateQuality(s),accepted:ProjectWorkflow.acceptCandidate(s)});}
        const unchanged=s.editedHtml===before&&JSON.stringify(s.completionContract)===oldContract&&s.pendingRevision===candidate;calcResult.cost[2027].op=originalOp;const restored=reportReviewCandidate(c,s),accepted=!!ProjectWorkflow.acceptCandidate(s);return {review,attempts,unchanged,restored,accepted};
      });assert.equal(r.review.status,'blocked');assert.ok(r.review.issues.some(i=>i.code==='candidate-financial-source-changed'));for(const attempt of r.attempts){assert.equal(attempt.quality.status,'blocked');assert.equal(attempt.accepted,null);}assert.equal(r.unchanged,true);assert.notEqual(r.restored.status,'blocked');assert.equal(r.accepted,true);
    });
    await t.test('真实模板归属：旧主表未接受时引用候选阻止准入，接受主表后连续接受同批引用不因表指纹变化误挡',async()=>{
      await reset(true);const r=await page.evaluate(async()=>{
        const owner={c:chapters[1],s:chapters[1].sections[0]},refs=[{c:chapters[0],s:chapters[0].sections[0]},{c:chapters[1],s:chapters[1].sections[1]}],initial=reportCompletionEntries(),initialPlan=reportCompletionPlan(),initialSource=JSON.stringify(chapters);
        for(const {c,s}of [...refs,owner]){const text=await reportDurableSectionCall(c,s,'s','u');ProjectWorkflow.setCandidate(s,text,'[系统测试]整批采用当前测算');}
        const pending=refs.map(({s})=>({text:s.pendingRevision.after,contract:s.pendingRevision.completionContract,input:s.pendingRevision.completionInputPlanId}));
        // Simulate draft serialization and refresh: WeakMap receipts are no longer
        // available on the restored section objects. Candidate metadata must suffice.
        window.chapters=JSON.parse(JSON.stringify(chapters));
        const restoredOwner={c:chapters[1],s:chapters[1].sections[0]},restoredRefs=[{c:chapters[0],s:chapters[0].sections[0]},{c:chapters[1],s:chapters[1].sections[1]}],blocked=restoredRefs.map(({c,s})=>({quality:reportReviewCandidate(c,s),accepted:ProjectWorkflow.acceptCandidate(s)}));
        const beforeOwner=reportCompletionPlan(),ownerQuality=reportReviewCandidate(restoredOwner.c,restoredOwner.s),ownerAccepted=!!ProjectWorkflow.acceptCandidate(restoredOwner.s),afterOwner=reportCompletionPlan(),accepted=[];
        for(const {c,s}of restoredRefs){const before=reportCompletionPlan(),candidate=s.pendingRevision,candidateAfter=candidate.after,manifest=candidate.completionContract.documentReferences,composed=reportCompletionEntries({sectionKey:c.name+' / '+s.t,html:renderContent(candidateAfter)}).find(e=>e.key===c.name+' / '+s.t).text,quality=reportReviewCandidate(c,s),done=!!ProjectWorkflow.acceptCandidate(s),after=reportCompletionPlan();accepted.push({quality,done,candidateAfter,composed,manifest:{...manifest,references:manifest.references.map(({tables,...ref})=>ref)},before:before.planId,after:after.planId,baseBefore:before.tableAllocation.basePlanId,baseAfter:after.tableAllocation.basePlanId});}
        const entries=reportCompletionEntries(),review=ReportCompletionContract.reviewDocument(entries,reportCompletionPlan()),docs=entries.map(e=>new DOMParser().parseFromString(e.text,'text/html')),templates=docs.map(d=>Array.from(d.querySelectorAll('figure[data-template-id],table[data-canonical-template]')).map(t=>t.getAttribute('data-template-id')||t.getAttribute('data-canonical-template'))),blocks=chapters.map((c,i)=>({cn:['一','二'][i],name:c.name,sections:c.sections.map(s=>({title:s.t,blocks:htmlToBlocks(entries.find(e=>e.key===c.name+' / '+s.t).text)}))}));
        return {initial,initialPlan:initialPlan.planId,initialSource,pending,blocked,ownerQuality,ownerAccepted,beforeOwner:{plan:beforeOwner.planId,base:beforeOwner.tableAllocation.basePlanId},afterOwner:{plan:afterOwner.planId,base:afterOwner.tableAllocation.basePlanId},accepted,entries,review,templates,blocks,metadata:chapters.flatMap(c=>c.sections).map(s=>({input:s.completionInputPlanId||null,contract:s.completionContract}))};
      });
      assert.match(r.initial[0].text,/data-report-ref-template="gaibao-housing-table-11"/);assert.match(r.initial[1].text,/21750\.94/);assert.match(r.initial[2].text,/data-report-ref-template="gaibao-housing-table-11"/);
      for(const [index,candidate]of r.pending.entries()){assert.ok(candidate.input);assert.ok(candidate.contract.documentReferences.references.length);if(index===0){assert.equal(candidate.contract.frozenTables?.tableCount,1);assert.match(candidate.text,/data-report-calc-kind="investment"/);assert.match(candidate.text,/其他投资费用及批准总投资/);}else{assert.equal(candidate.contract.frozenTables?.tableCount||0,0);assert.doesNotMatch(candidate.text,/<table\b/);}}
      for(const attempt of r.blocked){assert.equal(attempt.quality.status,'blocked',JSON.stringify(attempt.quality));assert.ok(attempt.quality.issues.some(i=>/^(?:bound-)?reference-/.test(i.code)),JSON.stringify(attempt.quality));assert.equal(attempt.accepted,null);}
      assert.notEqual(r.ownerQuality.status,'blocked',JSON.stringify(r.ownerQuality));assert.equal(r.ownerAccepted,true);assert.notEqual(r.beforeOwner.plan,r.afterOwner.plan);assert.equal(r.beforeOwner.base,r.afterOwner.base);
      for(const accepted of r.accepted){assert.notEqual(accepted.quality.status,'blocked',JSON.stringify(accepted));assert.equal(accepted.done,true);assert.equal(accepted.baseBefore,accepted.baseAfter);assert.ok(!accepted.quality.issues.some(i=>i.code==='candidate-input-plan-changed'));}
      assert.equal(r.templates.flat().filter(id=>id==='gaibao-housing-table-11').length,1);assert.ok(r.templates[1].includes('gaibao-housing-table-11'));assert.deepEqual(r.templates[0],[]);assert.deepEqual(r.templates[2],[]);
      for(const entry of r.entries)assert.doesNotMatch(entry.text,/21750\.94|880\.47|25\.79|18444/);
      assert.ok(!r.review.issues.some(i=>i.severity==='error'&&/^(?:bound-)?reference-/.test(i.code)),JSON.stringify(r.review.issues));
      const docx=require('../docx.umd.js'),buildDocx=require('../docxgen.js'),JSZip=require('../local-server/node_modules/jszip'),buffer=await docx.Packer.toBuffer(buildDocx(docx,{project:{name:'[系统测试]财务表重生成与跨节引用小样'},chapters:r.blocks})),zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');
      for(const value of ['1116.782','91.0167','12.2566'])assert.ok(xml.includes(value),'真实模板 DOCX must contain '+value);assert.doesNotMatch(xml,/21750\.94|880\.47|25\.79/);assert.match(xml,/详见第/);
      const artifact=path.resolve(__dirname,'../outputs/report-standardization/1009-current-pagination-finance-sync/[系统测试]财务表重生成与跨节引用小样.docx');fs.mkdirSync(path.dirname(artifact),{recursive:true});fs.writeFileSync(artifact,buffer);t.diagnostic('隔离导出小样：'+artifact);
    });
    await t.test('同批候选稳定输入身份：接受 A 新增合法业务标题后，JSON 恢复的 B 仍能接受',async()=>{
      await reset();const r=await page.evaluate(async()=>{
        const c=chapters[0],a=c.sections[0],b=c.sections[2];extraHeadings[c.name+' / '+a.t]='测算约束与现金流判断';
        for(const s of [a,b]){const text=await reportDurableSectionCall(c,s,'s','u');ProjectWorkflow.setCandidate(s,text,'[系统测试]同批候选');}
        const initial=reportCompletionPlan(),inputs=[a,b].map(s=>s.pendingRevision.completionInputPlanId);
        window.chapters=JSON.parse(JSON.stringify(chapters));const current=chapters[0],restoredA=current.sections[0],restoredB=current.sections[2],qualityA=reportReviewCandidate(current,restoredA),acceptedA=!!ProjectWorkflow.acceptCandidate(restoredA),afterA=reportCompletionPlan();
        projectWorkflow.updatedAt='2100-01-01T00:00:00Z';restoredA.executionTask={id:'[系统测试]other-progress',status:'completed'};
        const qualityB=reportReviewCandidate(current,restoredB),acceptedB=!!ProjectWorkflow.acceptCandidate(restoredB),afterB=reportCompletionPlan();
        return {inputs,qualityA,acceptedA,qualityB,acceptedB,heading:restoredA.content,initial:{plan:initial.planId,base:initial.tableAllocation.basePlanId},afterA:{plan:afterA.planId,base:afterA.tableAllocation.basePlanId},afterB:{plan:afterB.planId,base:afterB.tableAllocation.basePlanId}};
      });
      assert.ok(r.inputs.every(Boolean));assert.equal(r.inputs[0],r.inputs[1]);assert.notEqual(r.qualityA.status,'blocked',JSON.stringify(r.qualityA));assert.equal(r.acceptedA,true);assert.match(r.heading,/### 测算约束与现金流判断/);
      assert.notEqual(r.initial.base,r.afterA.base,'合法新增业务标题应真实改变正文派生成稿计划，不能用固定 plan mock 掩盖');
      assert.notEqual(r.qualityB.status,'blocked',JSON.stringify(r.qualityB));assert.equal(r.acceptedB,true);assert.ok(!r.qualityB.issues.some(i=>i.code==='candidate-input-plan-changed'));
    });
    for(const change of ['facts','rules','length','calculation'])await t.test('候选刷新恢复后 '+change+' 真实输入变化仍阻止接受，恢复原值后可重新核查',async()=>{
      await reset();const r=await page.evaluate(async change=>{
        const c=chapters[0],s=c.sections[0],before=s.editedHtml,text=await reportDurableSectionCall(c,s,'s','u');ProjectWorkflow.setCandidate(s,text,'[系统测试]输入身份');window.chapters=JSON.parse(JSON.stringify(chapters));const restored=chapters[0].sections[0],input=restored.pendingRevision.completionInputPlanId;let revert;
        if(change==='facts'){projectWorkflow.reportCompletion.facts.push({key:'[系统测试]constraint',label:'审核约束',value:'尚待消防验收',status:'pending',source:'隔离测试',owner:'',required:false,allocationMode:'background'});revert=()=>projectWorkflow.reportCompletion.facts.pop();}
        if(change==='rules'){window.ReportLogicCore={current:()=>({version:2,data:{logicVersions:{housing_conversion:'[系统测试]rules-v2'}}}),match:()=>[]};revert=()=>window.ReportLogicCore=null;}
        if(change==='length'){const plan=ReportLengthPlan.createPlan(chapters,{targetPages:90,proseTotal:60000});window.ReportLengthUI={savedPlan:()=>plan};revert=()=>window.ReportLengthUI=null;}
        if(change==='calculation'){calcResult.cost[2027].op+=1;revert=()=>calcResult.cost[2027].op-=1;}
        const quality=reportReviewCandidate(chapters[0],restored),rechecks=[];for(let i=0;i<2;i++)rechecks.push({quality:ProjectWorkflow.refreshCandidateQuality(restored),accepted:ProjectWorkflow.acceptCandidate(restored)});
        const unchanged=restored.editedHtml===before&&restored.pendingRevision.completionInputPlanId===input;revert();const recovered=reportReviewCandidate(chapters[0],restored),accepted=!!ProjectWorkflow.acceptCandidate(restored);return {quality,rechecks,unchanged,recovered,accepted};
      },change);
      assert.equal(r.quality.status,'blocked',JSON.stringify(r.quality));assert.ok(r.quality.issues.some(i=>i.code==='candidate-input-plan-changed'),JSON.stringify(r.quality));for(const attempt of r.rechecks){assert.equal(attempt.quality.status,'blocked');assert.equal(attempt.accepted,null);}assert.equal(r.unchanged,true);assert.notEqual(r.recovered.status,'blocked',JSON.stringify(r.recovered));assert.equal(r.accepted,true);
    });
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
