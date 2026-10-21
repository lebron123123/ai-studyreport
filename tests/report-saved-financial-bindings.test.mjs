import '../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {installSavedFinancialBindingsReader} from '../scripts/report-saved-financial-bindings.mjs';

const source=fs.readFileSync(new URL('../report.js',import.meta.url),'utf8');
const part=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const production=part('function reportFinancialContext(','function reportGenerationRulesIdentity(')+part('function reportFinancialIdentity(','function reportCandidateInputIdentity(')+part('function reportFinancialCandidateIssues(','function reportCompletionEntries(');

test('adopted financial references use real manifests, frozen tables and current source without candidate receipts',async t=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),requests=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{requests.push(route.request().url());return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'});});
    await page.goto('http://localhost:31849/readonly-fixture');
    await page.addScriptTag({path:new URL('../report-length-plan.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1')});
    await page.addScriptTag({path:new URL('../report-completion-contract.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1')});
    await page.addScriptTag({path:new URL('../report-financial-tables.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1')});
    await page.addScriptTag({content:production});
    await page.evaluate(installSavedFinancialBindingsReader);
    const reset=async()=>page.evaluate(async()=>{
      const C=ReportCompletionContract;
      window.currentProjectId='qa-finance';window.project={name:'[系统测试]财务引用'};
      window.calcParams={rent:75};window.calcResult={__ctype:'gaibao',allYears:[2026],summary:{npv:45}};
      const snapshot={id:'calc-one',version:5,projectId:currentProjectId,calcType:'gaibao',params:structuredClone(calcParams),summary:structuredClone(calcResult.summary)};
      window.projectWorkflow={currentCalcSnapshotId:snapshot.id,calcSnapshots:[snapshot]};
      window.renderContent=value=>value;window.MD={renderHtml:value=>value};window.reportCandidateInputIdentity=()=> 'current-input';
      window.chapters=[{name:'财务评价',sections:[{t:'盈利能力分析'},{t:'财务评价'},{t:'其他分析'}]}];
      const contracts=C.createPlan(chapters).sections;
      const table='<table data-report-calc-kind="summary" data-report-calc-snapshot="calc-one" data-report-calc-version="5" data-report-calc-source="calc-tables-v2" data-report-calc-project="qa-finance"><tbody><tr><th rowspan="2">指标</th><th>测算值</th></tr><tr><th>万元</th></tr><tr><td>净现值（NPV）</td><td>45</td></tr></tbody></table>';
      const note='<table><tbody><tr><th>指标原说明</th><th>适用边界</th></tr><tr><td>净现值</td><td>仅测算假设</td></tr></tbody></table>';
      const box=document.createElement('div');box.innerHTML=table;
      const cells=[...box.querySelector('table').rows].map(row=>[...row.cells].map(cell=>[cell.textContent,cell.rowSpan,cell.colSpan]));
      const reference='<p class="rpt-table-reference" data-report-ref-section="'+contracts[1].sectionKey+'" data-report-ref-scope="document" data-report-ref-table-kind="cells-v1" data-report-ref-table-hash="'+C.fingerprint(cells)+'">详见第1.2节财务评价。</p>';
      Object.assign(chapters[0].sections[0],{content:'<h3>盈利能力分析</h3><p>项目净现值以已采用测算为准。</p>'+reference,editedHtml:null,pendingRevision:null,executionTask:null});
      Object.assign(chapters[0].sections[1],{content:'<h3>财务评价</h3><p>测算结果不等于已核实经营事实。</p>'+table+note,editedHtml:null,pendingRevision:null,executionTask:{id:'original-task',status:'completed'}});
      Object.assign(chapters[0].sections[2],{content:'<p>无关的已采用分析。</p>',editedHtml:null,pendingRevision:null,executionTask:null,completionContract:contracts[2]});
      const entries=chapters[0].sections.map((s,i)=>({key:contracts[i].sectionKey,number:'1.'+(i+1),text:s.content}));
      chapters[0].sections[1].completionContract=await C.bindFrozenTables(contracts[1],entries[1].text,'original-source:financial='+encodeURIComponent(JSON.stringify(reportFinancialIdentity())));
      chapters[0].sections[0].completionContract=await C.bindDocumentReferences(contracts[0],entries);
      window.__fixture={table,note,entries,contracts};
    });
    const run=()=>page.evaluate(()=>window.__qaReadSavedFinancialBindings({projectId:'qa-finance'}));
    const fail=async mutate=>{await reset();await page.evaluate(mutate);const result=await run();assert.ok(result.issues.length,'Changed reference/source must be rejected');return result;};

    await t.test('valid adopted reference passes, does not add a receipt or change any report memory',async()=>{
      await reset();const before=await page.evaluate(()=>JSON.stringify({chapters,project,calcParams,calcResult,projectWorkflow}));
      assert.equal(await page.evaluate(()=>reportFinancialCandidateIssues({after:chapters[0].sections[0].content,completionContract:chapters[0].sections[0].completionContract}).length),1,'Old candidate guard remains strict');
      const result=await run();assert.deepEqual(result.issues,[]);assert.equal(result.binding.snapshotId,'calc-one');
      assert.equal(await page.evaluate(()=>JSON.stringify({chapters,project,calcParams,calcResult,projectWorkflow})),before);
      assert.equal(await page.evaluate(()=>chapters[0].sections[0].qaBoundedAiRevision),undefined);
    });
    await t.test('unrelated sibling and owner prose changes do not invalidate unchanged bound tables',async()=>{
      await reset();await page.evaluate(()=>{chapters[0].sections[2].content+='<p>另一节的合法说明。</p>';chapters[0].sections[1].content+='<p>本节新增定性说明。</p>';});assert.deepEqual((await run()).issues,[]);
    });
    await t.test('missing, null and non-array bound tables fail explicitly',async()=>{
      for(const value of [undefined,null,{}]){await reset();await page.evaluate(value=>{if(value===undefined)delete chapters[0].sections[0].completionContract.documentReferences.references[0].tables;else chapters[0].sections[0].completionContract.documentReferences.references[0].tables=value;},value);const result=await run();assert.match(result.issues[0].issues[0].message,/lacks bound tables/);}
    });
    await t.test('actual reference deletion, target key/number changes and ambiguous owners fail',async()=>{
      for(const mutate of [()=>{chapters[0].sections[0].content='<p>原引用已被删除。</p>';},()=>{chapters[0].sections[1].t='错误目标';},()=>{chapters[0].sections.reverse();}])await fail(mutate);
      await reset();await page.evaluate(()=>chapters[0].sections.push(structuredClone(chapters[0].sections[1])));await assert.rejects(run(),/Ambiguous saved section identity/);
    });
    await t.test('owner identity, pending candidate and missing/damaged frozen proof fail',async()=>{
      for(const mutate of [()=>{chapters[0].sections[1].completionContract.sectionKey='其他项目 / 其他节';},()=>{chapters[0].sections[1].pendingRevision={after:'候选'};},()=>{delete chapters[0].sections[1].completionContract.frozenTables;},()=>{chapters[0].sections[1].completionContract.frozenTables.sourceSnapshotId='no-financial-source';},()=>{chapters[0].sections[1].completionContract.frozenTables.tables[0].sha256='0'.repeat(64);},()=>{chapters[0].sections[1].completionContract.frozenTables.tables[0].html=__fixture.table.replace('45','46');}])await fail(mutate);
    });
    await t.test('all actual table cells, spans, kind/stamps, notes and table uniqueness remain exact',async()=>{
      for(const mutate of [()=>{chapters[0].sections[1].content=chapters[0].sections[1].content.replace('45','46');},()=>{chapters[0].sections[1].content=chapters[0].sections[1].content.replace('rowspan="2"','rowspan="1"');},()=>{chapters[0].sections[1].content=chapters[0].sections[1].content.replace('kind="summary"','kind="cashflow"');},()=>{chapters[0].sections[1].content=chapters[0].sections[1].content.replace('version="5"','version="6"');},()=>{chapters[0].sections[1].content=chapters[0].sections[1].content.replace('qa-finance"','other-project"');},()=>{chapters[0].sections[1].content=chapters[0].sections[1].content.replace(__fixture.note,'');},()=>{chapters[0].sections[1].content+=__fixture.table;}])await fail(mutate);
    });
    await t.test('mixing an unbound local financial table never exempts the production candidate guard',async()=>{
      const result=await fail(()=>{chapters[0].sections[0].content+=__fixture.table;});assert.ok(result.issues.some(row=>row.issues.some(issue=>issue.code==='candidate-financial-source-changed')));
      await fail(()=>{chapters[0].sections[1].content+=__fixture.table.replace('45','46');});
    });
    await t.test('cross-project/current params and changed calculation snapshot/source are refused',async()=>{
      await reset();await assert.rejects(page.evaluate(()=>__qaReadSavedFinancialBindings({projectId:'wrong-project'})),/project identity mismatch/);
      await reset();await page.evaluate(()=>projectWorkflow.calcSnapshots[0].projectId='another-project');await assert.rejects(run(),/其他项目/);
      await reset();await page.evaluate(()=>calcParams.rent=76);await assert.rejects(run(),/参数或测算结果/);
      await fail(()=>{projectWorkflow.calcSnapshots[0].version=6;});
      await fail(()=>{calcResult.sens={unapproved:'change'};});
    });
    await t.test('owner reference chains are checked recursively and cycles refused',async()=>{
      await reset();await page.evaluate(async()=>{
        const C=ReportCompletionContract,ordinary='<table><tbody><tr><th>事项</th><th>边界</th></tr><tr><td>归属</td><td>原文</td></tr></tbody></table>';
        chapters[0].sections[0].content+=ordinary;
        const hash=C.fingerprint([[['事项',1,1],['边界',1,1]],[['归属',1,1],['原文',1,1]]]);
        chapters[0].sections[1].content+='<p class="rpt-table-reference" data-report-ref-section="'+__fixture.contracts[0].sectionKey+'" data-report-ref-scope="document" data-report-ref-table-kind="cells-v1" data-report-ref-table-hash="'+hash+'">详见第1.1节盈利能力分析。</p>';
        const entries=chapters[0].sections.map((s,i)=>({key:__fixture.contracts[i].sectionKey,number:'1.'+(i+1),text:s.content}));
        chapters[0].sections[0].completionContract=await C.bindDocumentReferences(__fixture.contracts[0],entries);
        chapters[0].sections[1].completionContract=await C.bindDocumentReferences(chapters[0].sections[1].completionContract,entries);
      });
      assert.ok((await run()).issues.some(row=>row.issues.some(issue=>/Cyclic/.test(issue.message))));
    });
    await t.test('every async boundary refuses concurrent report or financial-source changes',async()=>{
      for(const method of ['verifyDocumentReferences','verifyFrozenTables']){
        await reset();await page.evaluate(method=>{const original=ReportCompletionContract[method];window.__originalVerify={method,original};ReportCompletionContract[method]=async(...args)=>{const result=await original(...args);calcResult.sens={late:'change'};return result;};},method);
        try{await assert.rejects(run(),/changed report memory/);}finally{await page.evaluate(()=>{ReportCompletionContract[__originalVerify.method]=__originalVerify.original;});}
      }
    });
    assert.deepEqual(errors,[]);assert.equal(requests.length,1,'No project/AI request is used by this fixture');
  }finally{await browser.close();}
});
