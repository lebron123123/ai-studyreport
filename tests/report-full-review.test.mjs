import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {parseArgs,selectSections,assignFactOwners,factReferenceHtml,classifyLegacyTable,financialDecisionRules,financialIssues,sectionClaimsLedger,validateFactOwnership,annotateReviewSection,frozenTableBudgetPreflight,allocateReviewTables,bindReviewReferences,bindReviewProgramProse,renderReviewCandidateHtml,validateApiResponse,isReviewSummary,runReviewPhases,reviewSummaryInput,cacheIdentity,applyManualSlots,revalidationCompatibility,summaryRevalidationCompatibility,manualSummaryDependencyReview,assess,finalCandidateReview} from '../scripts/build-report-full-review.mjs';
const require=createRequire(import.meta.url),Contract=require('../report-completion-contract.js');
const entries=[
  {number:'1.3',key:'项目总论 / 项目本体情况',chapter:'项目总论',title:'项目本体情况'},
  {number:'7.2',key:'项目合作模式 / 合作核心条款',chapter:'项目合作模式',title:'合作核心条款'},
  {number:'9.1',key:'财务评价 / 财务评价基础数据和假设',chapter:'财务评价',title:'财务评价基础数据和假设'},
  {number:'12.1',key:'项目研究结论及建议 / 项目可行性结论',chapter:'项目研究结论及建议',title:'项目可行性结论'}
];
function fixture(){
  const rows=structuredClone(entries),facts=assignFactOwners(rows),chapters=rows.map(e=>({name:e.chapter,sections:[{t:e.title}]}));
  const plan=Contract.createPlan(chapters,{facts,requiredTables:Object.fromEntries(rows.map(e=>[e.key,[]])),decisionConstraints:Object.fromEntries(rows.map(e=>[e.key,financialDecisionRules(e)]))});
  for(const row of rows)row.contract=plan.sections.find(s=>s.sectionKey===row.key);
  return {rows,facts,plan};
}

test('durable POST acknowledges identity without status, while GET must include status',()=>{
  const created={ok:true,task:{id:'rsec-real-shape',runId:'run-real-shape',reused:false}};
  assert.equal(validateApiResponse('/api/reportexecution',200,created,'POST'),created);
  assert.throws(()=>validateApiResponse('/api/reportexecution?id=x',200,created,'GET'),/task status/);
  const read={ok:true,task:{...created.task,status:'completed'}};
  assert.equal(validateApiResponse('/api/reportexecution?id=x',200,read,'GET'),read);
  for(const task of [{id:'x'},{runId:'x'},{}])assert.throws(()=>validateApiResponse('/api/reportexecution',200,{ok:true,task},'POST'),/identity/);
  assert.throws(()=>validateApiResponse('/api/reportexecution',200,{ok:false,error:'rejected'},'POST'),/rejected/);
  assert.throws(()=>validateApiResponse('/api/reportexecution',500,{ok:true,task:created.task},'POST'),/500/);
  assert.throws(()=>parseArgs(['--recover-only']),/requires --resume/);
  assert.throws(()=>parseArgs(['--recover-only','--run','--resume','outputs/report-standardization/example']),/cannot generate/);
  assert.equal(parseArgs(['--recover-only','--resume','outputs/report-standardization/example']).run,false);
});

test('whole review completes all detail workers before starting summary workers',async()=>{
  const rows=[{chapter:'项目结论',title:'建议'},{chapter:'市场分析',title:'需求'},{chapter:'总论',title:'编制依据'},{chapter:'投资估算',title:'投入'}],events=[];
  assert.equal(isReviewSummary(rows[2]),false,'basis lists are not summary dependencies');
  await runReviewPhases(rows,2,async entry=>{const kind=isReviewSummary(entry)?'summary':'detail';events.push(kind+' start');await new Promise(r=>setTimeout(r,kind==='detail'?5:0));events.push(kind+' end');});
  assert.equal(events.filter(e=>e==='detail end').length,3);
  assert.ok(events.indexOf('summary start')>events.lastIndexOf('detail end'));
});

test('summary consumes latest isolated passed details, rejects blocked old details, and changes cache inputs',()=>{
  const chapters=[{name:'市场分析',sections:[{t:'需求与条件'}]},{name:'项目结论',sections:[{t:'建议'}]}];
  const plan=Contract.createPlan(chapters,{requiredTables:{'市场分析 / 需求与条件':[],'项目结论 / 建议':[]}});
  const rows=plan.sections.map((contract,ci)=>({ci,si:0,number:(ci+1)+'.1',key:contract.sectionKey,chapter:chapters[ci].name,title:chapters[ci].sections[0].t,contract,canonicalHtml:ci?'旧结论不应进入上下文。':'旧正文仍需重核。'}));
  const results=rows.map(e=>({key:e.key,status:'protected',quality:{mechanicalPassed:false}}));
  Object.assign(results[0],{status:'unverified',quality:{mechanicalPassed:true},currentHtml:'<p>新版独有事实与否定条件：未经审签，不得实施。</p>',inputHash:'first-detail'});
  const before=JSON.stringify({rows,results,plan}),context=reviewSummaryInput(rows,results,plan,rows[1]);
  assert.match(context.text,/新版独有事实与否定条件/);assert.doesNotMatch(context.text,/旧正文仍需重核|旧结论不应进入/);
  assert.match(context.text,/全量论证上下文/);assert.equal(context.inputs[0].mode,'isolated-mechanically-passed-candidate');assert.equal(context.inputs[0].factsVerified,false);
  assert.equal(JSON.stringify({rows,results,plan}),before);
  results[0].currentHtml='<p>另一版独有事实，仍未确认。</p>';results[0].inputHash='second-detail';
  const changed=reviewSummaryInput(rows,results,plan,rows[1]);assert.notEqual(cacheIdentity(context),cacheIdentity(changed));
  results[0].status='blocked';rows[0].canonicalHtml='<p>'+('原稿超预算但不得静默节选。'.repeat(400))+'</p>';
  assert.throws(()=>reviewSummaryInput(rows,results,plan,rows[1]),error=>error.code==='REPORT_SUMMARY_DETAIL_NOT_READY');
});

test('section pilot is opt-in, exact, call-bounded and preserves all unselected source entries',()=>{
  const options=parseArgs(['--dry-run','--sections','1.3,7.2,12.1']);assert.equal(options.run,false);assert.equal(options.maxCalls,9);
  assert.equal(parseArgs(['--sections','1.3,7.2,12.1','--max-calls','129']).maxCalls,9);
  assert.equal(parseArgs(['--max-calls','4','--sections','1.3,7.2,12.1']).maxCalls,4);
  assert.equal(parseArgs([]).maxCalls,129);assert.equal(parseArgs([]).sections,null);
  assert.throws(()=>parseArgs(['--sections','1.3,1.3']),/Duplicate/);assert.throws(()=>parseArgs(['--sections','1.3,']),/Invalid/);assert.throws(()=>parseArgs(['--sections','--run']),/Invalid/);
  const original=JSON.stringify(entries),selected=selectSections(entries,options.sections);
  assert.equal(selected.length,entries.length);assert.equal(selected.filter(e=>e.selected).length,3);assert.equal(selected.find(e=>e.entry.number==='9.1').selected,false);assert.equal(JSON.stringify(entries),original);
  assert.ok(selected.every((row,index)=>row.entry===entries[index]),'selection does not replace or filter source chapters');
  assert.throws(()=>selectSections(entries,['1.3','99.9']),/Unknown section/);assert.ok(selectSections(entries,null).every(e=>e.selected));
});

test('five pending/conflict claims have exactly one required owner and no conclusion duplication',()=>{
  const {rows,facts}=fixture(),check=validateFactOwnership(rows,facts);
  assert.deepEqual(check,{facts:5,requiredOwners:5,uniqueOwnerSections:3,allPendingOrConflict:true});
  assert.deepEqual(rows.map(r=>r.contract.requiredFacts.length),[2,2,1,0]);
  assert.equal(facts.filter(f=>f.status==='confirmed').length,0);
  assert.throws(()=>assignFactOwners(rows.slice(1)),/Missing unique/);
  assert.throws(()=>assignFactOwners([...rows,rows[0]]),/Duplicate/);
  rows[3].contract.requiredFacts.push({...facts[0]});assert.throws(()=>validateFactOwnership(rows,facts),/exactly one/);
});

test('fact references identify stable owners, require actual values, and never confirm pending sources',()=>{
  const {rows,facts,plan}=fixture(),limits='协议口径待确认且与旧测算冲突，尚不能认定财务可行。';
  const document=rows.map(e=>({key:e.key,number:e.number,text:limits+facts.filter(f=>f.owner===e.key).map(f=>f.label+'（'+f.status+'）：'+f.value).join('。')}));
  document[3].text+=facts.map(f=>factReferenceHtml(f,rows)).join('');
  const good=Contract.reviewDocument(document,plan);assert.equal(good.status,'unverified');assert.equal(good.factsVerified,false);
  assert.equal(good.reviews.flatMap(r=>r.issues).filter(i=>i.code.startsWith('reference-')).length,0);
  for(const f of facts)assert.equal(factReferenceHtml(f,rows).includes(f.value),false,'references do not repeat numerical background');
  document[0].text=limits;const missing=Contract.reviewDocument(document,plan);assert.equal(missing.status,'blocked');
  assert.ok(missing.reviews.at(-1).issues.some(i=>i.code==='reference-fact-missing'));
  const escaped=factReferenceHtml({...facts[0],owner:'项目 " & < > / 主表'},[{key:'项目 " & < > / 主表',number:'1.3'}]);
  assert.match(escaped,/&quot; &amp; &lt; &gt;/);assert.doesNotMatch(escaped,/data-report-ref-section="项目 "/);
});

test('table warnings follow actual financial content across chapters, not every table',()=>{
  assert.ok(classifyLegacyTable({rows:[['条款类别','约定内容'],['合作期限','实际运营144个月']]}).some(r=>r.code==='old-operating-basis'));
  assert.ok(classifyLegacyTable({rows:[['指标名称','测算值','判断'],['全投资内部收益率','25.79%','满足']]}).some(r=>r.code==='old-financial-result'));
  assert.ok(classifyLegacyTable({rows:[['年份','住宅租金收入（万元）'],['2023','1350'],['2034','1979.54']]}).some(r=>r.code==='old-financial-schedule'));
  assert.ok(classifyLegacyTable({rows:[['原表位置及内容'],['原表第1行（合作期限）：当前状态：已明确（测算口径）']]}).some(r=>r.code==='old-confirmed-assumption'));
  assert.equal(classifyLegacyTable({rows:[['户型','建筑面积','套数'],['单间','35','195']]}).length,0);
  assert.equal(classifyLegacyTable({rows:[['竞品名称','租金','出租率'],['真实竞品','75','95%']]}).length,0);
  assert.equal(classifyLegacyTable({rows:[['风险类别','风险描述','应对措施'],['市场风险','租金下跌影响收入','按季度复核']]}).length,0);
  assert.equal(classifyLegacyTable({rows:[['来源小节','对象','字段','主表值','冲突值'],['7.1','租赁运营范围','内容','5973㎡','5,973㎡，不纳入1楼']]}).length,0);
});

test('decision limits inspect model prose; a program caveat or a frozen old table cannot satisfy them',()=>{
  const {rows}=fixture(),entry=rows.at(-1),caveat='<p data-report-conflict-warning="true">口径待确认且存在冲突，尚不能认定财务可行。</p>';
  assert.ok(financialIssues('项目建设条件较好。'+caveat,entry).some(i=>i.code==='financial-decision-boundary'));
  assert.equal(financialIssues('口径待确认且存在冲突，尚不能认定财务可行。',entry).some(i=>i.severity==='error'),false);
  assert.ok(financialIssues('口径待确认且存在冲突，尚不能认定财务可行。项目具备财务可行性基础。',entry).some(i=>i.code==='financial-affirmative-conflict'));
  assert.equal(financialDecisionRules({chapter:'总论',title:'编制依据',prose:'财务评价'}).length,0);
  assert.equal(financialDecisionRules({chapter:'社会效益',title:'就业',prose:'增加就业岗位'}).length,0);
  assert.equal(financialDecisionRules({chapter:'社会效益',title:'收益',tableWarnings:[{}]}).length,1);
});

test('claims/source ledger lists every title while distinguishing attribution from verification',()=>{
  const {rows,facts}=fixture();rows[3].factReferences=facts;
  const ledger=sectionClaimsLedger(rows,facts,'original-snapshot-sha');
  assert.equal(ledger.length,rows.length);assert.equal(ledger.flatMap(r=>r.claims).length,5);assert.equal(ledger[3].references.length,5);
  assert.ok(ledger.every(r=>r.title&&r.key&&r.sourceStatus==='unverified'&&!r.factsVerified));
  assert.ok(ledger.flatMap(r=>r.claims).every(c=>c.sourceCheck.snapshotHash==='original-snapshot-sha'&&c.sourceCheck.status==='unverified'));
});

test('immutable table budget failures are blocked before paid generation without changing data or the plan',()=>{
  const {rows}=fixture(),contract=Contract.normalize({...rows[0].contract,requirements:{...rows[0].contract.requirements,tableMax:1,tableRowsMax:2,tableCharsMax:10,cellCharsMax:5}});
  const html='<table><tr><th>指标</th><th>值</th></tr><tr><td>保留的真实原始事实</td><td>5973</td></tr><tr><td>套数</td><td>195</td></tr></table><table><tr><td>唯一附注</td></tr></table>';
  const before=JSON.stringify(contract),result=frozenTableBudgetPreflight(html,contract);
  assert.equal(result.status,'blocked');assert.deepEqual(new Set(result.issues.map(i=>i.code)),new Set(['budget-tableCount','budget-tableRows','budget-tableCharacters','budget-maxCellCharacters']));
  assert.ok(result.issues.every(i=>i.repairable===false&&i.requiresPlanReview));assert.match(result.reason,/不调用AI/);assert.equal(JSON.stringify(contract),before);assert.match(html,/保留的真实原始事实/);
  // Required prose facts / decisions are not table preflight failures: those
  // remain generation duties and are checked by the normal completion contract.
  assert.equal(frozenTableBudgetPreflight('<table><tr><td>面积</td><td>5973</td></tr></table>',contract).status,'passed');
  assert.equal(frozenTableBudgetPreflight('',contract).status,'passed');
});

test('whole-review allocation uses all sections before pilot selection and preserves source plus hard caps',()=>{
  const basePlan=Contract.createPlan([{name:'台账',sections:[{t:'第一表'},{t:'第二表'}]}]);
  const table=rows=>'<table><tr><th>对象</th><th>事实</th></tr>'+Array.from({length:rows},(_,i)=>'<tr><td>对象'+i+'</td><td>事实'+i+'</td></tr>').join('')+'</table>';
  const source=basePlan.sections.map((s,i)=>({key:s.sectionKey,number:'1.'+(i+1),canonicalHtml:table(34)}));
  const before=JSON.stringify({basePlan,source}),ready=allocateReviewTables(basePlan,source);
  assert.equal(ready.plan.tableAllocation.status,'ready');assert.equal(ready.preflightIssue,null);assert.equal(ready.plan.tableAllocation.totals.actual.tableRows,70);
  assert.equal(JSON.stringify({basePlan,source}),before,'allocation cannot alter original plan or source tables');
  assert.ok(ready.plan.sections.every(s=>s.requirements.tableRowsMax>=35));
  const pilot=selectSections(source,['1.1']);assert.equal(pilot.filter(r=>r.selected).length,1);assert.equal(ready.plan.tableAllocation.sections.length,2,'unselected sections still consume the full-report table pool');
  const oversized=source.map(e=>({...e,canonicalHtml:table(301)})),blocked=allocateReviewTables(basePlan,oversized);
  assert.equal(blocked.plan.tableAllocation.status,'blocked');assert.match(blocked.preflightIssue,/全篇不调用AI、不访问数据库/);
  assert.ok(blocked.plan.tableAllocation.sections.every(s=>s.allocated===null));
  assert.equal(JSON.stringify({basePlan,source}),before);
});

test('real isolated browser annotations are per-table, idempotent, and preserve frozen HTML',async()=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  try{
    const page=await browser.newPage(),errors=[],outbound=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{outbound.push(r.request().url());return r.abort();});
    const {rows,facts}=fixture(),entry={...rows.at(-1),factReferences:facts,tableWarnings:[{tableIndex:1}]};
    const html='<p>原正文未改</p><table><tbody><tr><th>户型</th><th>面积</th></tr><tr><td>单间</td><td>35</td></tr></tbody></table><table><tbody><tr><th>指标</th><th>数值</th></tr><tr><td>IRR</td><td>25.79%</td></tr></tbody></table>';
    const annotated=await annotateReviewSection(page,html,entry,rows),again=await annotateReviewSection(page,annotated,entry,rows);assert.equal(again,annotated);
    const actual=await page.evaluate(({html,annotated})=>{const parser=new DOMParser(),source=parser.parseFromString(html,'text/html'),doc=parser.parseFromString(annotated,'text/html');return {before:[...source.querySelectorAll('table')].map(t=>t.outerHTML),after:[...doc.querySelectorAll('table')].map(t=>t.outerHTML),warnings:doc.querySelectorAll('[data-report-conflict-warning]').length,refs:doc.querySelectorAll('.rpt-fact-reference').length,firstWarning:doc.querySelector('table').previousElementSibling?.className,secondWarning:doc.querySelectorAll('table')[1].previousElementSibling?.className};},{html,annotated});
    assert.deepEqual(actual.after,actual.before);assert.equal(actual.warnings,1);assert.equal(actual.refs,5);assert.notEqual(actual.firstWarning,'rpt-frozen-table-caveat');assert.equal(actual.secondWarning,'rpt-frozen-table-caveat');assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
  }finally{await browser.close();}
});

test('whole-review binds exact full-document targets and restores a generated reference only once',async()=>{
  const plan=Contract.createPlan([{name:'总论',sections:[{t:'规模台账'},{t:'摘要'}]}]);
  const table='<table><tr><th>项目</th><th>面积</th></tr><tr><td>甲</td><td>5973</td></tr></table>';
  const rule={title:'规模表',headers:['项目','面积'],terms:[]};plan.sections[1].requiredTables=[rule];
  const hash=Contract.fingerprint([[['项目',1,1],['面积',1,1]],[['甲',1,1],['5973',1,1]]]);
  const reference='<p class="rpt-table-reference" data-report-ref-section="'+plan.sections[0].sectionKey+'" data-report-ref-scope="document" data-report-ref-table-kind="cells-v1" data-report-ref-table-hash="'+hash+'">详见第1.1节规模台账。</p>';
  const source=[{key:plan.sections[0].sectionKey,number:'1.1',canonicalHtml:table},{key:plan.sections[1].sectionKey,number:'1.2',canonicalHtml:'摘要。'+reference}];
  const before=JSON.stringify({plan,source}),bound=await bindReviewReferences(plan.sections[1],source);
  assert.equal(JSON.stringify({plan,source}),before);assert.deepEqual(bound.requiredTables,[]);assert.deepEqual(bound.documentReferences.originalRequiredTables,[rule]);
  const unrelated={title:'收入表',headers:['年度','收入'],terms:[]};
  assert.deepEqual((await bindReviewReferences({...plan.sections[1],requiredTables:[rule,unrelated]},source)).requiredTables,[unrelated],'only actually covered requirements are delegated');
  await assert.rejects(bindReviewReferences(plan.sections[1],[{...source[0],canonicalHtml:'没有表'},source[1]]),/未包含实际表格/);
  const raw=JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'按规模台账复核。'}]}),decoded=Contract.decodeStructured(raw,bound);
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  try{
    const page=await browser.newPage();await page.route('**/*',r=>r.abort());await page.addScriptTag({path:fileURLToPath(new URL('../md.js',import.meta.url))});
    const html=await renderReviewCandidateHtml(page,decoded.text,{contract:bound,artifacts:[reference],tables:[]});
    const count=await page.evaluate(html=>new DOMParser().parseFromString(html,'text/html').querySelectorAll('.rpt-table-reference').length,html);
    assert.equal(count,1);assert.match(html,/按规模台账复核/);assert.doesNotMatch(html,/&lt;p class=|data-report-ref-section=&quot;/,'program reference must not become visible escaped prose');
    const reviewPlan={...plan,sections:[plan.sections[0],bound]},reviewRows=[{key:source[0].key,number:'1.1',text:table},{key:source[1].key,number:'1.2',text:html}];
    const review=Contract.reviewDocument(reviewRows,reviewPlan);assert.equal(review.status,'passed');
    assert.ok(!review.reviews.flatMap(r=>r.issues).some(i=>i.code.startsWith('reference-')));
    const removed=Contract.reviewDocument([reviewRows[0],{...reviewRows[1],text:'摘要无表无引用。'}],reviewPlan);
    assert.equal(removed.status,'blocked');assert.ok(removed.reviews[1].issues.some(i=>i.code==='bound-reference-missing'));
  }finally{await browser.close();}
});

test('offline revalidation never permits resume/task reuse or extra detail repair rounds',()=>{
  const directory='outputs/report-standardization/original-run';
  assert.equal(parseArgs(['--dry-run','--revalidate-from',directory]).run,false);
  assert.equal(parseArgs(['--run','--revalidate-from',directory]).maxCalls,27);
  assert.throws(()=>parseArgs(['--manual-revisions','outputs/report-standardization/manual.json']),/requires --revalidate/);
  assert.throws(()=>parseArgs(['--revalidate-from',directory,'--resume',directory]),/cannot inherit/);
  const old={key:'A',number:'2.1',structuredText:'{}',taskId:'original-task',runId:'original-run',quality:{mechanicalPassed:true}};
  const entry={key:'A',number:'2.1',tables:['original table'],sourceSnapshotId:'same-source',contract:{basisCatalog:{sourceSnapshotId:'basis-source',items:[{id:'received-only',status:'received'}]}}};
  const contract={sourceSnapshotId:entry.sourceSnapshotId,contract:structuredClone(entry.contract)},ledger={frozenTables:[...entry.tables]};
  assert.equal(revalidationCompatibility(old,entry,contract,ledger).compatible,true);
  for(const changed of [{...entry,tables:[]},{...entry,sourceSnapshotId:'changed'},{...entry,key:'changed'},{...entry,contract:{basisCatalog:{sourceSnapshotId:'other',items:[]}}}])assert.equal(revalidationCompatibility(old,changed,contract,ledger).compatible,false);
  assert.equal(revalidationCompatibility({...old,structuredText:''},entry,contract,ledger).compatible,false,'a prior passed bit never substitutes for structured candidate content');
  const reviewed={...old,revalidation:{sourceDirectory:'first-run',oldQuality:{mechanicalPassed:false},manualRevision:{changes:[{slot:'finding',before:'完整原句',after:'人工完整新句'}],originalStructuredTextSha256:'original-sha'}}};
  const receipt=revalidationCompatibility(reviewed,entry,contract,ledger);
  assert.deepEqual(receipt.previousRevalidation,reviewed.revalidation,'a subsequent revalidation preserves the complete manual/provenance chain');
  receipt.previousRevalidation.manualRevision.changes[0].after='receipt only';
  assert.equal(reviewed.revalidation.manualRevision.changes[0].after,'人工完整新句','new audit history does not mutate prior candidates');
});

test('manual local QA replacements require original SHA and preserve every unauthorized block',()=>{
  const structuredText=JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'原判断'},{kind:'paragraph',slot:'conditions',text:'原限制'},{kind:'paragraph',slot:'reasoning',text:'独有事实195套'},{kind:'table-ref',id:'frozen-id'}]});
  const row={number:'2.1',structuredText},patch={number:'2.1',structuredTextSha256:crypto.createHash('sha256').update(structuredText).digest('hex'),allowedSlots:['finding','conditions'],replacements:{finding:'完整替代判断',conditions:'仍待确认，不能据此决策。'},reason:'人工局部精简，不批准事实'};
  const before=JSON.stringify({row,patch}),result=applyManualSlots(row,patch),blocks=JSON.parse(result.structuredText).blocks;
  assert.equal(JSON.stringify({row,patch}),before);assert.deepEqual(blocks.slice(2),JSON.parse(structuredText).blocks.slice(2));assert.equal(result.receipt.changes.length,2);assert.match(result.receipt.scope,/no source change/);
  assert.throws(()=>applyManualSlots(row,{...patch,structuredTextSha256:'wrong'}),/SHA/);
  assert.throws(()=>applyManualSlots(row,{...patch,replacements:{reasoning:'删除独有事实'}}),/unauthorized/);
  assert.throws(()=>applyManualSlots({...row,number:'9.1'},{...patch,number:'9.1'}),/not authorized/);
});

test('summary revalidation rejects changed detail HTML, missing provenance and duplicate identities, never trusting old passed bits',()=>{
  const previous={inputs:[{number:'2.1',key:'区位 / 区位条件',htmlHash:'same-real-html',inputHash:'old-rule-input'}],quality:{mechanicalPassed:true}};
  const current={inputs:[{...previous.inputs[0],inputHash:'current-rule-input'}]};
  const before=JSON.stringify({previous,current}),result=summaryRevalidationCompatibility(previous,current);
  assert.equal(result.compatible,true,'rule metadata may change when actual detail HTML remains byte-identical');assert.equal(JSON.stringify({previous,current}),before);
  for(const changed of [{...current.inputs[0],htmlHash:'edited-detail'},{...current.inputs[0],number:'2.2'},{...current.inputs[0],key:'不同明细'}])assert.equal(summaryRevalidationCompatibility(previous,{inputs:[changed]}).compatible,false);
  assert.equal(summaryRevalidationCompatibility({quality:{mechanicalPassed:true}},current).compatible,false);
  assert.equal(summaryRevalidationCompatibility(previous,{inputs:[]}).compatible,false);
  assert.equal(summaryRevalidationCompatibility(previous,{inputs:[...current.inputs,...current.inputs]}).compatible,false);
  assert.equal(summaryRevalidationCompatibility({inputs:[...previous.inputs,{number:'2.2',key:'移除明细',htmlHash:'retained-old'}]},current).compatible,false);
  assert.deepEqual(result.previousInputs,previous.inputs);assert.deepEqual(result.currentInputs,current.inputs);
});

test('three reviewed summary patches have exact per-section slot scopes and immutable reference blocks',()=>{
  const slots=['finding','evidence','conditions','decision'];
  const structuredText=JSON.stringify({blocks:[...slots.map(slot=>({kind:'paragraph',slot,text:'完整原段落-'+slot})),{kind:'table-ref',id:'real-frozen-table-id'},{kind:'basis-ref',id:'original-basis-id'}]});
  const hash=crypto.createHash('sha256').update(structuredText).digest('hex');
  for(const number of ['1.2','1.3','12.1']){
    const allowedSlots=number==='1.2'?['conditions']:slots;
    const replacements=Object.fromEntries(allowedSlots.map(slot=>[slot,'完整复核新段落-'+slot+'；仍待确认，不作财务可行结论。']));
    const row={number,structuredText},patch={number,structuredTextSha256:hash,allowedSlots,replacements,reason:'明确审批的本地QA段落精简，不作事实确认'};
    const before=JSON.stringify({row,patch}),out=applyManualSlots(row,patch),result=JSON.parse(out.structuredText);
    assert.equal(JSON.stringify({row,patch}),before);assert.equal(out.receipt.changes.length,allowedSlots.length);
    assert.deepEqual(result.blocks.slice(-2),JSON.parse(structuredText).blocks.slice(-2));
    for(const slot of slots.filter(slot=>!allowedSlots.includes(slot)))assert.equal(result.blocks.find(b=>b.slot===slot).text,'完整原段落-'+slot);
    assert.ok(out.receipt.changes.every(c=>c.before==='完整原段落-'+c.slot&&c.after===replacements[c.slot]));
    assert.throws(()=>applyManualSlots(row,{...patch,number:'9.1'}),/not authorized/);
    assert.throws(()=>applyManualSlots(row,{...patch,structuredTextSha256:'changed-source'}),/SHA/);
    assert.throws(()=>applyManualSlots(row,{...patch,allowedSlots:[...allowedSlots,'table-ref']}),/exact allowed/);
    assert.throws(()=>applyManualSlots(row,{...patch,replacements:{...replacements,'table-ref':'更换表'}}),/unauthorized/);
  }
});

test('manual summary semantic re-review binds all 34 real HTML hashes and exactly five approved detail receipts',()=>{
  const hash=v=>crypto.createHash('sha256').update(v).digest('hex'),numbers=['2.3','3.5','4.2','5.3','6.2'];
  const previous={inputs:Array.from({length:34},(_,i)=>({number:numbers[i]||'extra-'+i,key:'detail-'+i,htmlHash:hash('old-'+i)}))};
  const current=structuredClone(previous),results=[],changes=[];
  for(let i=0;i<5;i++){
    const html='new actual html '+i,structuredText=JSON.stringify({blocks:[]}),manual={number:numbers[i],revisedStructuredTextSha256:hash(structuredText),changes:[{before:'old',after:'new'}]};
    current.inputs[i].htmlHash=hash(html);results.push({number:numbers[i],key:current.inputs[i].key,currentHtml:html,structuredText,quality:{mechanicalPassed:true},revalidation:{manualRevision:manual}});
    changes.push({number:numbers[i],key:current.inputs[i].key,beforeHtmlHash:previous.inputs[i].htmlHash,afterHtmlHash:current.inputs[i].htmlHash,manualReceiptSha256:hash(JSON.stringify(manual))});
  }
  const row={number:'12.1',key:'summary',structuredText:JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'still pending'}]})};
  const review={scope:'local-qa-semantic-review',number:row.number,key:row.key,originalStructuredTextSha256:hash(row.structuredText),previousInputs:previous.inputs,currentInputs:current.inputs,reviewedDetailChanges:changes,reviewedBy:'explicit test reviewer',reviewedAt:'2026-09-22T00:00:00Z',reason:'All nine summaries independently read; no change in financial limitations'};
  const before=JSON.stringify({previous,current,row,review,results});assert.equal(manualSummaryDependencyReview(previous,current,row,review,results).accepted,true);assert.equal(JSON.stringify({previous,current,row,review,results}),before);
  assert.throws(()=>manualSummaryDependencyReview(previous,current,row,null,results),/explicit human/);
  assert.throws(()=>manualSummaryDependencyReview(previous,current,row,{...review,originalStructuredTextSha256:hash('other')},results),/SHA/);
  for(const edit of [r=>r.currentInputs[10].htmlHash=hash('unreviewed edit'),r=>r.previousInputs[0].htmlHash=hash('not the old draft'),r=>r.reviewedDetailChanges[0].manualReceiptSha256=hash('tampered receipt'),r=>r.reviewedDetailChanges.pop(),r=>r.currentInputs.pop(),r=>r.reviewedBy='']){
    const bad=structuredClone(review);edit(bad);assert.throws(()=>manualSummaryDependencyReview(previous,current,row,bad,results));
  }
  const altered=structuredClone(results);altered[0].currentHtml+='unreviewed';assert.throws(()=>manualSummaryDependencyReview(previous,current,row,review,altered),/fresh successful render/);
  const sixth=structuredClone(current);sixth.inputs[6].htmlHash=hash('sixth change');assert.throws(()=>manualSummaryDependencyReview(previous,sixth,row,{...review,currentInputs:sixth.inputs},results),/five explicitly/);
  assert.equal(summaryRevalidationCompatibility(previous,current).compatible,false,'manual review is explicit separate evidence, never a relaxation of normal provenance');
});

test('builder registers exact visible canonical notes and explicit QA annotations before generation',async()=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  try{
    const page=await browser.newPage(),outbound=[];await page.route('**/*',r=>{outbound.push(r.request().url());return r.abort();});
    const {rows,facts}=fixture(),entry={...rows.at(-1),factReferences:facts,tableWarnings:[{tableIndex:0}],canonicalHtml:'<figure><figcaption>保留原表的实际图注</figcaption><table><tbody><tr><th>指标</th><th>数值</th></tr><tr><td>IRR</td><td>25.79%</td></tr></tbody></table></figure>'};
    const contract=await Contract.bindFrozenTables(entry.contract,entry.canonicalHtml,'snapshot-program-test'),before=JSON.stringify({contract,entry});
    const binding=await bindReviewProgramProse(page,contract,entry,rows);
    assert.equal(JSON.stringify({contract,entry}),before,'binding must not mutate source/contract');
    assert.match(binding.additionalHtml,/data-report-review-annotation/);assert.match(binding.additionalHtml,/尚不能认定财务可行/);
    assert.doesNotMatch(binding.additionalHtml,/<table|<figcaption/,'annotations do not duplicate table captions or data');
    assert.ok(binding.budget.reservedCharacters>0);assert.equal(binding.budget.proseAvailable,contract.requirements.proseMax-binding.budget.reservedCharacters);
    const productionOnly=await bindReviewProgramProse(page,contract,{...entry,factReferences:[],tableWarnings:[]},rows);
    assert.equal(productionOnly.additionalHtml,'');assert.ok(productionOnly.budget.reservedCharacters>0,'canonical figure notes still occupy real prose');
    assert.ok(binding.budget.reservedCharacters>productionOnly.budget.reservedCharacters,'only explicitly rendered QA notes consume the extra reserve');
    assert.equal(binding.contract.requirements.proseMax,contract.requirements.proseMax,'binding cannot enlarge the cap');
    assert.deepEqual(outbound,[]);
  }finally{await browser.close();}
});

test('fresh revalidation and final real browser render preserve frozen cells but not editor metadata',async()=>{
  const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  try{
    const page=await browser.newPage(),outbound=[],errors=[];await page.route('**/*',r=>{outbound.push(r.request().url());return r.abort();});page.on('pageerror',e=>errors.push(e.message));
    await page.addScriptTag({path:fileURLToPath(new URL('../report-length-plan.js',import.meta.url))});await page.addScriptTag({path:fileURLToPath(new URL('../report-completion-contract.js',import.meta.url))});await page.addScriptTag({path:fileURLToPath(new URL('../md.js',import.meta.url))});
    const base=Contract.createPlan([{name:'台账',sections:[{t:'事实清单'}]}],{requiredTables:{'台账 / 事实清单':[]}}).sections[0];
    const old='<table id="old-editor"><tbody><tr data-row="0"><th data-col="0">项目</th><th data-col="1">值</th></tr><tr data-row="1"><td data-role="cell">房源</td><td>195套</td></tr></tbody></table>';
    const inert=await page.evaluate(old=>{const doc=new DOMParser().parseFromString(old,'text/html');doc.querySelectorAll('*').forEach(el=>[...el.attributes].filter(a=>a.name==='id'||a.name.startsWith('data-')).forEach(a=>el.removeAttribute(a.name)));return doc.body.innerHTML;},old);
    const contract=await Contract.bindFrozenTables(base,inert,'source-identity');
    const raw=JSON.stringify({blocks:[{kind:'paragraph',slot:'finding',text:'房源仍需复核。'},...contract.frozenTables.tables.map(t=>({kind:'table-ref',id:t.id}))]});
    const decoded=Contract.decodeStructured(raw,contract),tables=await page.evaluate(text=>[...new DOMParser().parseFromString(MD.renderHtml(text),'text/html').querySelectorAll('table')].map(t=>t.outerHTML),decoded.text);
    const entry={number:'1.1',key:base.sectionKey,chapter:'台账',title:'事实清单',contract,tables,artifacts:['<figure>'+old+'<figcaption>保留原始事实</figcaption></figure>'],html:old,allowedNumbers:Contract.compareFacts(old,'').missing};
    const fresh=await assess(entry,{structuredText:raw,outputFormat:Contract.OUTPUT_FORMAT,quality:{issues:[{code:'old-issue',message:'旧规则结果',severity:'error'}]}},page,{revalidate:true});
    assert.ok(!fresh.quality.issues.some(i=>i.code==='old-issue'));assert.equal(fresh.quality.mechanicalPassed,true);
    const final=await finalCandidateReview(page,fresh,entry,[entry]);assert.equal(final.quality.mechanicalPassed,true,JSON.stringify(final.quality.issues));assert.match(final.currentHtml,/保留原始事实/);assert.doesNotMatch(final.currentHtml,/data-row|data-col|data-role|old-editor/);
    const overBudgetText='额外可见文字'.repeat(Math.ceil(contract.requirements.proseMax/6)+1);
    const changed=await finalCandidateReview(page,fresh,{...entry,artifacts:[old+'<p>'+overBudgetText+'</p>']},[entry]);
    assert.equal(changed.quality.mechanicalPassed,false,'final visible notes count against current budget');assert.ok(changed.quality.issues.some(i=>i.stage==='final-render'));
    await assert.rejects(renderReviewCandidateHtml(page,decoded.text,{...entry,artifacts:[old.replace('195套','196套')]}),/values or geometry changed/);
    assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
  }finally{await browser.close();}
});
