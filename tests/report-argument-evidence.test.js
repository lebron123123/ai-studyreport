const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../report-evidence-graph.js'),A=require('../report-argument.js');
const section=(content,prov={})=>[{cn:1,name:'财务',sections:[{t:'结果',content,prov}]}];
test('逐句来源只读展示原文、版本与URL，拒绝脚本链接',()=>{
  const g=E.buildGraph(section('总投资一千万元',{rag:[{title:'<img src=x onerror=alert(1)>',url:'javascript:alert(1)',version:'v1',excerpt:'总投资一千万元'}]}));
  const html=E.detailsHtml(g);assert.ok(!html.includes('href="javascript:'));assert.ok(!html.includes('<img'));assert.match(html,/尚未逐句定位/);assert.match(html,/原文匹配不等于/);
});
test('依赖调度等待正文池完成，取消后保留未运行摘要',async()=>{
  const events=[],rows=[{c:{name:'总论'},s:{t:'建议'}},{c:{name:'市场'},s:{t:'供需'}},{c:{name:'财务'},s:{t:'现金流'}}];
  const pool=async(q,worker,n,cont)=>{await Promise.all(Array.from({length:n},async()=>{while(q.length&&(!cont||cont()))await worker(q.shift());}));};
  const tasks=rows.slice();await A.runInDependencyOrder(tasks,async t=>{if(t.s.t!=='建议')await new Promise(r=>setTimeout(r,5));events.push(t.s.t);},pool,2);
  assert.equal(events.at(-1),'建议');assert.equal(tasks.length,0);
  let running=true;const pending=rows.slice();await A.runInDependencyOrder(pending,async()=>{running=false;},pool,1,()=>running);
  assert.deepEqual(pending.map(t=>t.s.t),['现金流','建议']);
});
test('摘要上下文只来自已完成正文，失败或缺失不生成假结论',()=>{
  const c=[{name:'总论',sections:[{t:'建议'}]},{name:'市场',sections:[{t:'供需',content:''}]}];
  assert.throws(()=>A.summaryContext(c,'总论','建议'),/等待正文完成/);c[1].sections[0].content='租金取值仍待核。';
  assert.match(A.summaryContext(c,'总论','建议'),/租金取值仍待核/);assert.equal(A.summaryContext(c,'市场','供需'),'');
});
test('无关来源、旧评分和白箱标记不证明数字',()=>{for(const prov of [{hasCalcData:true,confidence:{score:.99}},{rag:[{id:'source-id',title:'无关',sourceRef:'p1',version:'v1',excerpt:'市场总体平稳。'}]}]){const a=E.preSubmitAudit(section('项目总投资1000万元。',prov));assert.equal(a.ready,false);assert.equal(a.claimCoverage,0);}});
test('扫描超过40句、表格及中文数字；空正文不能通过',()=>{const a=E.preSubmitAudit(section('背景分析。'.repeat(45)+'\n[[TABLE]]\n总投资|一千万元\n[[/TABLE]]'));assert.equal(a.graph.claims.length,46);assert.ok(a.issues.some(x=>x.text?.includes('一千万元')));assert.equal(E.preSubmitAudit([]).ready,false);assert.equal(E.preSubmitAudit(section('')).ready,false);});
test('旧来源失效、缺版本不能维持定位有效',()=>{for(const x of [{version:null},{version:'v1',lifecycle:'expired'}]){const a=E.preSubmitAudit(section('项目总投资1000万元。',{rag:[{title:'投资表',sourceRef:'p2',excerpt:'项目总投资1000万元。',...x}]}));assert.equal(a.ready,false);}});
test('论证任务按章节职责，摘要结论排在明细之后',()=>{assert.match(A.prompt('总论','建议'),/未提供可信测算/);assert.match(A.prompt('政策','编制依据'),/效力/);assert.ok(!A.prompt('市场','供需').includes('500'));const c=[{name:'总论',sections:[{t:'结论'}]},{name:'财务',sections:[{t:'现金流'}]},{name:'跳过',checked:false,sections:[{t:'x'}]}];assert.deepEqual(A.generationOrder(c).map(x=>x.section.t),['现金流','结论']);assert.equal(c[0].name,'总论');});

test('来源定位不用URL hash，监听重复绑定无副作用且只滚动当前区域',()=>{
  const g=E.buildGraph(section('投资金额1000万元',{rag:[{title:'资料',excerpt:'投资金额1000万元'}]})),html=E.detailsHtml(g);assert.ok(!html.includes('href="#'));assert.match(html,/data-report-evidence-target/);
  let handler,bindings=0,scrolled=0;const button={dataset:{reportEvidenceTarget:'report-evidence-0'}},target={scrollIntoView(){scrolled++;},setAttribute(){},focus(){}};
  const box={dataset:{},contains:()=>true,querySelector:()=>target,addEventListener(_,fn){bindings++;handler=fn;}};E.bindDetails(box);E.bindDetails(box);handler({target:{closest:()=>button},preventDefault(){}});assert.equal(bindings,1);assert.equal(scrolled,1);
});
test('取消/异常等待在途结束并保留失败任务，恢复不遗漏正文或提前生成摘要',async()=>{
  const rows=[{c:{name:'市场'},s:{t:'失败'}},{c:{name:'财务'},s:{t:'在途'}},{c:{name:'总论'},s:{t:'建议'}}],events=[];
  const pool=async(q,worker,n,cont)=>Promise.all(Array.from({length:Math.min(n,q.length)},async()=>{while(q.length&&cont())await worker(q.shift());}));
  await assert.rejects(()=>A.runInDependencyOrder(rows,async t=>{if(t.s.t==='失败')throw new Error('失败');await new Promise(r=>setTimeout(r,10));events.push(t.s.t);},pool,2),/失败/);
  assert.deepEqual(events,['在途']);assert.deepEqual(rows.map(t=>t.s.t),['失败','建议']);
  await A.runInDependencyOrder(rows,async t=>{events.push(t.s.t);},pool,2);assert.deepEqual(events,['在途','失败','建议']);assert.equal(rows.length,0);
});
test('不核查未选章节，旧章节编号重复也不串证据；空HTML和旧版本正文不能喂摘要',()=>{
  const g=E.buildGraph([{name:'A',sections:[{content:'正文甲'}]},{name:'B',sections:[{content:'正文乙'}]},{checked:false,sections:[{}]}]);assert.equal(g.claims.length,2);assert.equal(g.emptySections,0);assert.equal(new Set(g.claims.map(c=>c.id)).size,2);
  for(const s of [{content:'<p>&nbsp;</p>'},{content:'旧正文',syncStatus:'stale'}])assert.throws(()=>A.summaryContext([{name:'市场',sections:[{t:'正文',...s}]}],'总论','建议'),/等待正文完成/);
});
test('纯章节序号不是待证数字，编号后的真实金额仍须核验；总论内依据仍有独立任务',()=>{
  const audit=E.preSubmitAudit(section('# 1.1 编制依据\n1.1.1 项目名称\n第1章 总论\n（一）编制依据'));assert.equal(audit.graph.claims.filter(c=>c.numeric).length,0);assert.equal(audit.ready,true);
  assert.equal(E.preSubmitAudit(section('1.1 总投资1000万元')).ready,false);
  const paraphrase=E.preSubmitAudit(section('项目投资总额为1000万元',{rag:[{sourceRef:'p1',version:1,excerpt:'项目总投资：1000万元。'}]}));assert.equal(paraphrase.claimCoverage,0);assert.match(paraphrase.issues[0].message,/改写不代表错误/);
  assert.match(A.prompt('总论','编制依据'),/文件全称、文号、发布主体/);
});
