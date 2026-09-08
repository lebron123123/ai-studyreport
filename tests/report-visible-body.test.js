const test=require('node:test');
const assert=require('node:assert/strict');
const WF=require('../project-workflow.js');
const Argument=require('../report-argument.js');
const Evidence=require('../report-evidence-graph.js');
const chapter=section=>[{cn:1,name:'项目条件',checked:true,sections:[{t:'建设条件',...section}]}];

test('可见正文拒绝空白 HTML、空表格、空格实体和零宽字符',()=>{
  for(const value of ['', ' \n\t ', '<p><br></p>', '<table><tr><td>&nbsp;</td></tr></table>', '&nbsp;&#160;&#xA0;', '\u200b\u200c\u200d\u2060\ufeff', '&#8203;&#x200b;&ZeroWidthSpace;', '<!--旧稿--><script>hidden()</script><style>body{color:red}</style><template>隐藏模板</template>']){
    const section={content:value};
    assert.equal(WF.hasReportBody(section),false,JSON.stringify(value));
    assert.deepEqual(WF.reportGenerationStatus(chapter(section)),{total:1,generated:0,remaining:1,complete:false});
    assert.throws(()=>Argument.summaryContext(chapter(section),'总论','结论'),/等待正文完成/);
    assert.equal(Evidence.buildGraph(chapter(section)).claims.length,0,JSON.stringify(value));
  }
});

test('有效中文正文和真实表格单元格计入完成，不把数值零当空白',()=>{
  for(const value of ['旧版中文正文。','<p>项目条件仍需核实。</p>','<table><tr><td>总收入</td><td>0</td></tr></table>','&#20013;&#x6587;']){
    assert.equal(WF.hasReportBody({content:value}),true,value);
    assert.equal(WF.reportGenerationStatus(chapter({content:value})).complete,true);
    assert.doesNotThrow(()=>Argument.summaryContext(chapter({content:value}),'总论','结论'));
    assert.ok(Evidence.buildGraph(chapter({content:value})).claims.length>0);
  }
});

test('非空 editedHtml 优先：有效编辑稿可用，空白编辑稿不得借旧 content 冒充完成',()=>{
  assert.equal(WF.hasReportBody({content:'',editedHtml:'<p>人工编辑正文。</p>'}),true);
  assert.equal(WF.hasReportBody({content:'旧正文仍保留',editedHtml:'<p>&nbsp;\u200b<br></p>'}),false);
  assert.equal(WF.hasReportBody({content:'旧正文仍保留',editedHtml:' \n '}),false);
  assert.equal(Evidence.buildGraph(chapter({content:'旧正文仍保留',editedHtml:'<p>&nbsp;\u200b<br></p>'})).claims.length,0);
});

test('旧 content 与历史 editedHtml 空字符串兼容，stale 内容保持但总论继续阻断',()=>{
  for(const editedHtml of [undefined,null,''])assert.equal(WF.hasReportBody({content:'历史正文',editedHtml}),true);
  const data=chapter({content:'历史正文需核对',syncStatus:'stale'}),before=JSON.stringify(data);
  assert.equal(WF.reportGenerationStatus(data).complete,true);
  assert.throws(()=>Argument.summaryContext(data,'总论','结论'),/等待正文完成/);
  assert.equal(JSON.stringify(data),before);
  assert.equal(WF.reportGenerationStatus([]).complete,false);
  assert.equal(WF.reportGenerationStatus([{checked:false,sections:[{content:'不参与'}]}]).complete,false);
});

test('完整版本恢复不把被明确编辑为空白的工作稿回填成旧正文',()=>{
  const state=WF.ensureState({});WF.createReportVersion(state,chapter({content:'上一完整版本'}));
  const data=chapter({content:'旧正文',editedHtml:'<p><br></p>'}),before=JSON.stringify(data);
  const restored=WF.recoverCompletedReport(data,state,{done:1,total:1});
  assert.equal(restored.recovered,false);assert.equal(restored.status.complete,false);assert.equal(JSON.stringify(data),before);
});
