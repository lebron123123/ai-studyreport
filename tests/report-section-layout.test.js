const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
test('working draft canonical tables and contextual headings are lossless and idempotent',async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  try{
    const page=await browser.newPage();
    await page.addScriptTag({path:path.resolve('report-table-templates.js')});
    await page.addScriptTag({path:path.resolve('report-section-layout.js')});
    await page.addScriptTag({path:path.resolve('export.js')});
    const result=await page.evaluate(()=>{
      const cell=(text,col,role='static')=>({text,col,role});
      const template={id:'test',title:'房源现状表',segments:[{rows:[{cells:[cell('项目名称',0),cell('项目面积',1),cell('交通配套',2)]},...Array.from({length:4},()=>({cells:[cell('',0,'value'),cell('',1,'value'),cell('',2,'value')]}))]}]};
      const lib={forSection:()=>[template],renderTemplate:ReportTableTemplates.renderTemplate};
      const context={type:'test',chapter:'项目总论',section:'问题、建议与结论',number:'1.7'};
      const html='<p>一、项目总论<br>1.1 问题、建议与结论<br>1.1.1 尚待解决的主要问题</p><p>面积为2.1平方米。</p><h3>1.1.2 建议</h3><table><tr><th>项目名称</th><th>建筑面积（㎡）</th><th>周边交通条件</th><th>套数</th></tr><tr><td>松园小区</td><td>584.76</td><td>地铁0.4公里</td><td>7</td></tr></table>'+lib.renderTemplate(template);
      const once=ReportSectionLayout.compose(html+'<p>原表补充资料（未自动对应标准字段）：原表第1行：旧内容</p><p>（来源：原始立项请示）</p>',context,lib);
      const twice=ReportSectionLayout.compose(once,context,lib);
      const doc=new DOMParser().parseFromString(once,'text/html');
      const other=ReportSectionLayout.compose('<p>1.2.1 政策与国有资产管理要求</p><h3>1.1.1 政策依据</h3>',{chapter:'项目建设必要性',section:'政策与国有资产管理要求',number:'2.1'});
      const matrix=[];
      const broken='<table><tr><th>表1.1.4-1 房源现状表</th><th></th><th></th><th></th></tr><tr><td></td><td>项目名称</td><td>项目面积</td><td>交通配套</td></tr><tr><td></td><td>松园小区</td><td>584.76</td><td>地铁</td></tr></table>';
      const fixed=ReportSectionLayout.compose(broken,context);
      const fixedDoc=new DOMParser().parseFromString(fixed,'text/html');
      if(fixedDoc.querySelector('table').textContent.includes('表1.1.4')||fixedDoc.querySelector('tr').cells.length!==3||!fixedDoc.querySelector('.rpt-table-caption'))matrix.push('caption normalization');
      const combined=ReportSectionLayout.compose(broken+lib.renderTemplate(template),context,lib);
      const combinedDoc=new DOMParser().parseFromString(combined,'text/html');
      if(combinedDoc.querySelectorAll('table').length!==1||combinedDoc.querySelector('.rpt-table-caption')||!combined.includes('584.76'))matrix.push('caption table dedup');
      for(const [number,section] of [['3.7','供需态势与市场结论'],['5.2','产品及竞争定位']]){
        const ctx={number,section,chapter:'章标题'};
        const src='<div style="font-weight:600">（一）'+section+'</div><p><b>一、区域供需总体判断</b></p><p><strong>二、工作建议</strong></p><p><b>重要事实。</b></p>';
        const normalized=ReportSectionLayout.compose(src,ctx);
        if(normalized.includes(section)||!normalized.includes(number+'.1 区域供需总体判断')||!normalized.includes(number+'.2 工作建议')||!normalized.includes('<b>重要事实。</b>')||normalized!==ReportSectionLayout.compose(normalized,ctx))matrix.push(number+' historical bold headings');
      }
      for(let chapter=1;chapter<=12;chapter++)for(let section=1;section<=12;section++){
        const ctx={chapter:'章标题',section:'节标题',number:chapter+'.'+section};
        const src='<p>节标题</p><h3>1.1.1一级</h3><h4>1.1.1.1二级</h4><h5>1.1.1.1.1三级</h5><h3>1.1.2末项</h3><p>2.1万元</p>';
        const normalized=ReportSectionLayout.compose(src,ctx);
        if(!normalized.includes(ctx.number+'.1 一级')||!normalized.includes(ctx.number+'.1.1.1 三级')||!normalized.includes(ctx.number+'.2 末项')||!normalized.includes('<p>2.1万元</p>')||normalized!==ReportSectionLayout.compose(normalized,ctx))matrix.push(ctx.number);
      }
      window.reportTableProjectType=()=> 'test';
      ReportTableTemplates.exportTemplate=()=>JSON.parse(JSON.stringify(template));
      return {matrix,once,twice,count:doc.querySelectorAll('table').length,text:doc.body.textContent,headers:[...doc.querySelectorAll('th')].map(x=>x.textContent),other,blocks:htmlToBlocks(once)};
    });
    assert.equal(result.count,1);
    assert.deepEqual(result.matrix,[],'all 144 chapter/section positions must normalize idempotently');
    assert.deepEqual(result.headers,['项目名称','项目面积','交通配套']);
    assert.match(result.text,/584.76/);assert.doesNotMatch(result.text,/原表补充资料|原表第|套数：7/);
    assert.match(result.text,/来源：原始立项请示/);
    assert.match(result.text,/1.7.1 尚待解决/);assert.match(result.text,/1.7.2 建议/);
    assert.doesNotMatch(result.text,/一、项目总论|1.1 问题/);
    assert.match(result.other,/2.1.1 政策依据/);
    assert.equal(result.once,result.twice);
    const docx=require('../docx.umd.js'),build=require('../docxgen.js');
    const buffer=await docx.Packer.toBuffer(build(docx,{project:{name:'[系统测试]表格合并与编号'},chapters:[{cn:'一',num:1,name:'项目总论',sections:[{num:7,title:'问题、建议与结论',blocks:result.blocks}]}]}));
    const zip=await require('../local-server/node_modules/jszip').loadAsync(buffer);
    const xml=await zip.file('word/document.xml').async('string');
    assert.equal((xml.match(/<w:tbl>/g)||[]).length,1);
    assert.doesNotMatch(xml,/原表补充资料|原表第/);
    assert.doesNotMatch(xml,/来源：原始立项请示/);
    assert.match(xml,/584.76/);assert.match(xml,/1.7.1/);assert.doesNotMatch(xml,/1.1.1/);
    assert.match(xml,/1.7　问题、建议与结论/);
  }finally{await browser.close();}
});
