const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const policy=require('../report-output-policy.js'),D=require('../docx.umd.js'),build=require('../docxgen.js'),JSZip=require('../local-server/node_modules/jszip');
test('历史表名位于TABLE内部、两列表、大小写和缺失闭合均保留完整结构',()=>{
 const context={};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../md.js'),'utf8'),context);
 for(const closing of ['', '\n[[/table]]']){
  const value='[[table]]\n表1.1-1 合作单位基本信息表\n单位|职责\n税务局|房源提供\n安居公司|运营（待核实）'+closing+'\n注：核实后使用';
  for(const input of [value,policy.normalize(value)]){
   const blocks=context.MD.parseBlocks(input),table=blocks.find(b=>b.type==='table');
   assert.equal(table.rows.length,3);assert.deepEqual(Array.from(table.rows[0]),['单位','职责']);
   assert.match(context.MD.renderHtml(input),/合作单位基本信息表/);assert.doesNotMatch(context.MD.renderHtml(input),/表格内容未返回/);
   assert.ok(blocks.some(b=>/注：核实后使用/.test(b.text||'')));
  }
 }
 const rows=context.MD.parseBlocks('单位|职责\n---|---\n安居公司|运营').find(b=>b.type==='table');assert.equal(rows.rows.length,2);
});
test('章节篇幅预算是非破坏性规划，修改和生成使用同一规则',()=>{
 const chapters=[{name:'总论',checked:true,sections:[{t:'编制依据',content:'完整原文'},{t:'项目概况'}]},{name:'财务评价',checked:true,sections:[{t:'财务分析'}]},{name:'排除',checked:false,sections:[{t:'不生成'}]}];
 const before=JSON.stringify(chapters),plan=policy.sectionPlan(chapters);
 assert.equal(plan.length,3);assert.ok(plan.every(r=>r.target>0));assert.equal(JSON.stringify(chapters),before);
 const prompt=policy.sectionPrompt(chapters,chapters[0],chapters[0].sections[0]);
 assert.match(prompt,/已绑定成稿合同时，以该合同的正文及表格预算为唯一数值标准/);
 assert.match(prompt,/必要表格、关键风险、假设、单位和事实不得为达字数而删除/);
 const L=require('../report-length-plan.js'),C=require('../report-completion-contract.js'),confirmed=L.createPlan(chapters);
 confirmed.confirmedAt=new Date().toISOString();confirmed.budgetResolution={policy:'confirmed-length-plan',legacyBudgetFingerprint:L.legacyBudgetSummary({}).fingerprint};
 const current=C.createPlan(chapters,{lengthPlan:confirmed}),contract=current.sections.find(s=>s.sectionKey==='总论 / 项目概况');
 const fullText='有效分析'.repeat(Math.ceil((contract.requirements.proseMax+1)/4)),inspection=C.inspect(fullText,contract);
 assert.notEqual(inspection.status,'blocked','显式确认的篇幅参考不能机械阻断完整分析');
 assert.ok(inspection.issues.some(issue=>issue.code==='budget-proseCharacters'&&issue.severity==='warning'));
 const structured=C.normalize({...contract,requiredHeadings:[{level:3,text:'建设条件'}]});
 assert.equal(C.inspect(fullText,structured).status,'blocked','篇幅参考不得放松必需业务标题');
 assert.equal(policy.sectionPlan(chapters,{lengthPlan:confirmed}).find(row=>row.section===chapters[0].sections[1]).target,contract.requirements.proseTarget);
 assert.equal(JSON.stringify(chapters),before,'篇幅与结构核验不修改原稿');
 assert.match(policy.sectionPrompt(chapters,chapters[0],chapters[0].sections[0]),/只列已核实依据/);
 assert.equal(policy.needsContentReview({content:'旧稿'}),true);assert.equal(policy.needsContentReview({content:'新稿',outputPolicyVersion:policy.contentVersion}),false);
});

test('材料量不改变章节预算，跨节重复只提示不删除',()=>{
 const chapters=[{name:'市场',sections:[{t:'市场分析',content:'短材料'}]},{name:'风险',sections:[{t:'风险'}]}];
 const targets=policy.sectionPlan(chapters).map(r=>r.target);chapters[0].sections[0].content='材料'.repeat(100000);
 assert.deepEqual(policy.sectionPlan(chapters).map(r=>r.target),targets);
 const prompt=policy.sectionPrompt(chapters,chapters[0],chapters[0].sections[0]);assert.match(prompt,/材料数量、长度或参考报告页数不增加/);assert.match(prompt,/全篇职责目录/);
 const paragraph='这是需要人工检查而非自动删除的跨章节重复项目说明。'.repeat(4);
 const entries=[{id:'1',text:paragraph,target:30},{id:'2',text:paragraph,target:1000},{id:'3',text:'',tables:1},{id:'4',text:''}];
 const original=JSON.stringify(entries),result=policy.reviewSections(entries);
 assert.equal(result[0].overBudget,true);assert.equal(result[1].duplicates[0].with,'1');assert.equal(result[2].empty,false);assert.equal(result[3].empty,true);assert.equal(JSON.stringify(entries),original);
 assert.deepEqual(policy.reviewSections([]),[]);
});
test('依据清单保留政策出处，通用生成要求约束所有依据章节而非删除其他分析',()=>{
 const basis='（1）《国务院办公厅关于加快发展保障性租赁住房的意见》（国办发〔2021〕22号），国务院办公厅。';
 assert.equal(policy.cleanText(basis),basis);
 assert.equal(policy.normalize(basis),basis);
 assert.match(policy.prompt,/所有项目的编制依据、政策依据、法规依据、项目专属依据/);
 assert.match(policy.prompt,/只输出简洁的编号文件清单/);
 assert.match(policy.prompt,/其他章节的必要分析不受影响/);
});
test('清理来源括注与独立来源行，不删除业务来源事实、待补及原始对象',()=>{
 const input='收入来源：租金。\n租金75元。（来源：调研表。）\n来源：测试文件\n【待补：收入来源依据】';
 const result=policy.cleanText(input);assert.match(result,/收入来源：租金/);assert.match(result,/租金75元/);assert.match(result,/【待补：收入来源依据】/);assert.doesNotMatch(result,/调研表|测试文件/);
});
test('缺失闭合标记的表转为真实Markdown表，注释与后文保留在表外',()=>{
 const context={};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../md.js'),'utf8'),context);
 const value='[[TABLE]]\n房型|套数|面积\n标准层|75|2274.5\n合计|195|5973\n注：尚需核实\n\n后续正文';
 const html=context.MD.renderHtml(policy.normalize(value));assert.match(html,/<table/);assert.doesNotMatch(html,/\[\[TABLE/);assert.match(html,/5973/);assert.ok(html.indexOf('</table>')<html.indexOf('注：'));
});
test('Word包恢复旧稿原始表、待补红色、来源附件默认关闭且不修改payload',async()=>{
 const payload={project:{name:'[系统测试]通用成稿'},chapters:[{cn:'一',name:'概况',sections:[{title:'现状',blocks:[{type:'p',text:'正文【待补：客群收入】（来源：竞品调研。）'},{type:'p',text:'[[TABLE]]'},{type:'p',text:'房型|套数|面积'},{type:'p',text:'标准层|75|2274.5'},{type:'p',text:'合计|195|5973'}]}]}],appendix:{mainRows:[['隐藏附表']]},provenance:{rows:[['来源'],['后台原件']]},images:[]};
 const before=JSON.stringify(payload),buffer=await D.Packer.toBuffer(build(D,payload)),zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');
 assert.equal(JSON.stringify(payload),before);assert.match(xml,/<w:tbl>/);assert.match(xml,/5973/);assert.doesNotMatch(xml,/\[\[TABLE|竞品调研|内容溯源|隐藏附表|后台原件/);
 const red=[...xml.matchAll(/<w:r>[\s\S]*?<\/w:r>/g)].map(m=>m[0]).filter(x=>x.includes('C62828'));
 assert.equal(red.length,1);assert.match(red[0],/【待补：客群收入】/);
});
test('页数保护线：120、121至130通过，131拒绝，错误和未登录不可当作通过',async()=>{
 const {pageDecision,reportPaginationResponse}=await import('../local-server/report-pagination.js');
 for(const pages of [110,120,121,130])assert.equal(pageDecision(pages).ok,true);
 assert.equal(pageDecision(131).ok,false);assert.throws(()=>pageDecision(NaN));
 const response=await reportPaginationResponse(new Request('http://localhost/test',{method:'POST',body:'not-docx'}),async()=>null);assert.equal(response.status,401);
});
