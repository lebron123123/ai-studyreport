const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const policy=require('../report-output-policy.js'),D=require('../docx.umd.js'),build=require('../docxgen.js'),JSZip=require('../local-server/node_modules/jszip');
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
test('页数边界：120通过、121拒绝，错误和未登录不可当作通过',async()=>{
 const {pageDecision,reportPaginationResponse}=await import('../local-server/report-pagination.js');
 assert.equal(pageDecision(120).ok,true);assert.equal(pageDecision(121).ok,false);assert.throws(()=>pageDecision(NaN));
 const response=await reportPaginationResponse(new Request('http://localhost/test',{method:'POST',body:'not-docx'}),async()=>null);assert.equal(response.status,401);
});
