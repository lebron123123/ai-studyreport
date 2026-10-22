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

test('依据清单不铺政策解读，缺材料不生成通用框架，成稿职责可注入',()=>{
  const basis=A.contract('总论','编制依据与编制说明');
  assert.equal(basis.basis,true);assert.equal(basis.summary,false);
  assert.match(basis.responsibility,/只列依据文件清单/);
  assert.equal(A.contract('政策符合性','适用条件分析').basis,false);
  const prompt=A.prompt('经营方案','合作期限',{sectionRequirements:{responsibility:'只列六年协议期限和待确认条款',doNotRepeat:['测算章节的收入明细']}});
  assert.match(prompt,/只列六年协议期限和待确认条款/);
  assert.match(prompt,/不得复述：测算章节的收入明细/);
  assert.match(prompt,/旧正文不是事实核验依据/);
  assert.match(prompt,/不补写通用背景或制造占位表格/);
  assert.match(prompt,/执行本次成稿计划的篇幅预算/);
});

test('摘要保留结尾完整风险和否定，不再只截各节头部',()=>{
  const risk='财务结论：尚不能认定项目财务可行，须待协议口径重核；仅在六年合作期及抵扣分成安排确认后重新测算。';
  const chapters=[{name:'财务',sections:[{t:'经营测算',content:'项目建筑面积为12345.67平方米。\n\n'+'普通市场背景描述。'.repeat(2500)+'\n\n'+risk+'\n\n后续安排另列。'}]}];
  const original=JSON.stringify(chapters),context=A.summaryContext(chapters,'总论','建议');
  assert.ok(context.includes(risk));assert.match(context,/12345\.67平方米/);
  assert.match(context,/普通块省略 1 个/);assert.match(context,/财务 \/ 经营测算/);
  assert.match(context,/不是独立核验凭证/);assert.ok(context.length<=20000);
  assert.equal(JSON.stringify(chapters),original);
});

test('风险标题覆盖随后完整段落，保留无关键字的限定条件和末尾判断',()=>{
  const context=A.summaryContext([{name:'工程',sections:[{t:'技术条件',content:'# 项目事实\n建筑面积100平方米。\n\n## 前置条件\n取得产权人书面授权后启动。\n\n消防验收通过后开放运营。\n\n## 工作安排\n普通背景。\n\n项目在现阶段保持论证状态。'}]}],'总论','建议');
  assert.match(context,/取得产权人书面授权后启动。/);assert.match(context,/消防验收通过后开放运营。/);
  assert.match(context,/前置条件/);assert.match(context,/项目在现阶段保持论证状态。/);
  const bold=A.summaryContext([{name:'工程',sections:[{t:'方案',content:'基本情况。\n\n**风险及边界**\n\n取得产权人书面授权后启动。\n\n## 普通背景\n普通说明。'}]}],'总论','建议');
  assert.match(bold,/取得产权人书面授权后启动。/);
  const riskSection=A.summaryContext([{name:'风险分析',sections:[{t:'实施安排',content:'实施情况。\n\n取得产权人书面授权后启动。\n\n工作安排。'}]}],'总论','建议');
  assert.match(riskSection,/取得产权人书面授权后启动。/);
});

test('多项完整风险超上下文预算明确阻断并列出小节，原文及候选均不修改',()=>{
  const chapters=[{name:'合同',sections:[{t:'合作安排',content:'风险：'+('合同待确认事项甲。'.repeat(1300)),pendingRevision:{after:'待审核候选'}}]},{name:'财务',sections:[{t:'资金安排',content:'条件：'+('贷款审批事项乙。'.repeat(1300))}]}],before=JSON.stringify(chapters);
  assert.throws(()=>A.summaryContext(chapters,'总论','建议'),error=>{
    assert.equal(error.code,'REPORT_SUMMARY_CONTEXT_BUDGET');assert.equal(error.budget,20000);assert.ok(error.requiredChars>20000);
    assert.equal(error.sections.length,2);assert.match(error.message,/合同 \/ 合作安排/);assert.match(error.message,/财务 \/ 资金安排/);
    assert.match(error.message,/未截断结论、风险或条件/);return true;
  });
  assert.equal(JSON.stringify(chapters),before);
});

test('HTML结尾风险及合并单元格完整提取，表头数值单位与条件不拆散',()=>{
  const content='<h2>基本情况</h2><p>项目建筑面积为123.45平方米。</p><p>'+('普通背景。'.repeat(3000))+'</p><h2>经营风险</h2><table><caption>合同边界</caption><tr><th>指标</th><th>值</th><th>条件</th></tr><tr><td rowspan="2">合作期限</td><td>6年</td><td>须待协议确认，尚不能认定财务可行。</td></tr><tr><td colspan="2">抵扣完成后分成；未核定抵扣额。</td></tr></table><p>取得书面授权后启动。</p>';
  const context=A.summaryContext([{name:'经营',sections:[{t:'合作机制',editedHtml:content}]}],'总论','建议');
  for(const expected of ['123.45平方米','合同边界','[指标] | [值] | [条件]','[rowspan=2；合作期限]','[6年]','须待协议确认，尚不能认定财务可行。','[colspan=2；抵扣完成后分成；未核定抵扣额。]','取得书面授权后启动。'])assert.ok(context.includes(expected),expected);
  assert.ok(!context.includes('<table'));assert.ok(context.length<=20000);
});

test('旧TABLE及Markdown表格保留全表和原空值，不替换或捏造表中数字',()=>{
  for(const table of ['[[TABLE]]\n事项|金额（万元）|限制\n租金|123.45|须待复核\n抵扣||按协议抵扣\n[[/TABLE]]','|事项|金额（万元）|限制|\n|---|---|---|\n|租金|123.45|须待复核|\n|抵扣||按协议抵扣|']){
    const context=A.summaryContext([{name:'经营',sections:[{t:'合作机制',content:'项目事实。\n\n'+table+'\n\n一般背景说明。'}]}],'总论','建议');
    assert.match(context,/\[事项\] \| \[金额（万元）\] \| \[限制\]/);assert.match(context,/\[租金\] \| \[123.45\] \| \[须待复核\]/);
    assert.match(context,/\[抵扣\] \| \[\] \| \[按协议抵扣\]/);assert.doesNotMatch(context,/原表空白，待核对/);
  }
});

test('无法完整解析HTML表格则阻断而不是删除表中限制后生成摘要',()=>{
  for(const table of ['<table><tr><td>待审批</td></tr>','<table><tr><td>待审批</tr></table>'])assert.throws(()=>A.summaryContext([{name:'合同',sections:[{t:'协议边界',content:'项目事实。'+table}]}],'总论','建议'),error=>error.code==='REPORT_SUMMARY_CONTEXT_PARSE'&&/合同 \/ 协议边界/.test(error.message));
});

test('过期与锁定过期正文均阻断；当前正文不采纳未接受候选或未绑定结构化结果',()=>{
  for(const syncStatus of ['stale','locked-stale'])assert.throws(()=>A.summaryContext([{name:'财务',sections:[{t:'现金流',content:'经营结果完整。',syncStatus}]}],'总论','建议'),/等待正文完成/);
  const context=A.summaryContext([{name:'财务',sections:[{t:'现金流',content:'现有测算口径尚待确认。',syncStatus:'current',pendingRevision:{after:'财务已确认可行。'},executionTask:{structuredText:'{"blocks":[{"slot":"finding","text":"财务可行"}]}',quality:{status:'passed'}},structuredText:'未经正文版本绑定的结论'}]}],'总论','建议');
  assert.match(context,/现有测算口径尚待确认。/);assert.match(context,/未接受候选未采用/);
  assert.doesNotMatch(context,/财务已确认可行|未经正文版本绑定|"slot"/);
});

test('开头摘取只用完整句，单个超长事实不能被截成无条件片段',()=>{
  const context=A.summaryContext([{name:'市场',sections:[{t:'情况',content:'项目面积123.45平方米。'+('普通背景描述。'.repeat(100))+'\n\n普通尾段。'}]}],'总论','建议');
  assert.match(context,/项目面积123\.45平方米。/);assert.match(context,/仅节选开头完整句/);
  assert.ok(context.includes('描述。\n[仅节选'));assert.ok(!context.includes('描\n[仅节选'));
  assert.throws(()=>A.summaryContext([{name:'市场',sections:[{t:'未断句原文',content:'项目面积'+('甲'.repeat(21000))+'平方米。\n\n尾段。'}]}],'总论','建议'),error=>error.code==='REPORT_SUMMARY_CONTEXT_BUDGET');
});

test('上下文预算包含所有章节标签，不以每节最低额度突破总预算',()=>{
  const chapters=Array.from({length:400},(_,i)=>({name:'章节'+i,sections:[{t:'情况',content:'项目事实。'}]}));
  assert.throws(()=>A.summaryContext(chapters,'总论','建议'),error=>error.code==='REPORT_SUMMARY_CONTEXT_BUDGET'&&error.sections.length===400);
});

test('仅有脚本样式或模板的旧HTML不是已完成正文，不把非正文代码送入摘要',()=>{
  assert.throws(()=>A.summaryContext([{name:'市场',sections:[{t:'情况',content:'<script>待确认风险伪正文</script><style>风险{}</style><template>待确认</template>'}]}],'总论','建议'),/等待正文完成/);
  const context=A.summaryContext([{name:'市场',sections:[{t:'情况',content:'<p>真实口径未确认。</p><script>错误结论可行</script>'}]}],'总论','建议');
  assert.match(context,/真实口径未确认。/);assert.doesNotMatch(context,/错误结论/);
});

test('否定结论单独作为标题或加粗段仍保留，仅有标题不能冒充完整正文',()=>{
  for(const heading of ['## 尚不能认定财务可行','**尚不能认定财务可行**','<h2>尚不能认定财务可行</h2>']){
    const context=A.summaryContext([{name:'财务',sections:[{t:'经营测算',content:'项目事实。\n\n'+heading+'\n\n## 其他信息\n普通背景。'}]}],'总论','建议');
    assert.match(context,/尚不能认定财务可行/);
  }
  assert.throws(()=>A.summaryContext([{name:'财务',sections:[{t:'经营测算',content:'## 风险与条件'}]}],'总论','建议'),/等待正文完成/);
});

test('浏览器全局MD路径与Node路径提取一致，不引入模块装载顺序以外的隐式存储',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),context=vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../md.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(require.resolve('../report-argument.js'),'utf8'),context);
  const chapters=[{name:'财务',sections:[{t:'经营测算',editedHtml:'<p>面积100平方米。</p><table><tr><th>指标</th><th>条件</th></tr><tr><td>IRR</td><td>须待口径重核。</td></tr></table><p>尚不能认定财务可行。</p>'}]}];
  assert.equal(context.ReportArgument.summaryContext(chapters,'总论','建议'),A.summaryContext(chapters,'总论','建议'));
});
