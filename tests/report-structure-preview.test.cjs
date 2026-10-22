require('../scripts/windows-browser-lockout-guard.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const docx=require('docx'),JSZip=require('jszip'),builder=require('../docxgen.js');
test('真实页面：四类项目保留层级、历史版独立下载，生产Word含六级标题且不混入当前稿',{timeout:90000},async()=>{
  const browser=await chromium.launch({headless:true}),context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!=='http://localhost:8080')return route.abort();
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{ok:false,error:'[系统测试]隔离'}});
    const file=path.resolve(url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(process.cwd()+path.sep))return route.abort();
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:{'.js':'application/javascript','.mjs':'application/javascript','.html':'text/html','.css':'text/css'}[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  try{
    await page.goto('http://localhost:8080/',{waitUntil:'load'});
    await page.waitForFunction(()=>typeof airOpenReportVersionById==='function'&&typeof reportCompletionPlan==='function');
    for(const type of ['rent','sale','gaibao','gaibao-commercial']){
      await page.evaluate(type=>{
        document.getElementById('gate')?.remove();currentProjectId='[系统测试]structure';currentProjectRole='OWNER';getToken=()=> 'isolated';getUser=()=> '[系统测试]';window.ResearchUI=null;
        project.name='[系统测试]结构与历史下载';project.analysisSites=[];calcParams=null;calcResult=null;calcType=type;domainKey='baozhang_gaibao';kbEntries=[];
        appMode='aireport';aiReportHasDoc=true;scheduleCloudSave=()=>{};airSaveState=()=>{};airLoadState=()=>{};airRestoreDocPaneIfNeeded=()=>{};
        projectWorkflow=ProjectWorkflow.ensureState({});projectWorkflow.reportCompletion={facts:[]};
        chapters=[{cn:'一',name:'运营方案',checked:true,sections:[{t:'运营管理',content:'当前工作稿不可混入历史导出。'},{t:'编制依据',content:'仅文件清单。'}]}];
        const prior=JSON.parse(JSON.stringify(chapters));
        prior[0].sections[0].content='### 一、收楼安排\n\n按合同落实收楼。\n\n#### （一）合同约定\n\n约定不得臆造。\n\n##### 执行条件\n\n先核实条件。\n\n###### 责任落实\n\n由责任单位审签。\n\n### 二、运营职责\n\n按职责落实运营。';
        const partial=JSON.parse(JSON.stringify(prior));partial[0].sections[0].content='### 收楼安排\n\n中间版本已丢部分结构。';
        projectWorkflow.reportVersions=[{id:'[系统测试]v9',version:9,chapters:prior},{id:'[系统测试]v10',version:10,chapters:partial},{id:'[系统测试]v11',version:11,chapters:JSON.parse(JSON.stringify(chapters))}];
        projectWorkflow.currentReportVersionId='[系统测试]v11';window.__baseline=JSON.stringify({chapters,versions:projectWorkflow.reportVersions});
        window.__nativeExport=exportWord;exportWord=async options=>{window.__selectedDownload=options.versionId;};
        document.getElementById('sheet').innerHTML=renderAiReportModule();airBuildDocPane();bindAiReportEvents();airSetDocVisible(true);
      },type);
      const plan=await page.evaluate(()=>reportCompletionPlan().sections.map(s=>({basis:s.requirements.basis,headings:s.requiredHeadings||[]})));
      assert.equal(plan[0].headings.length,5);assert.equal(plan[1].headings.length,0);
      await page.evaluate(()=>airOpenReportVersionById('[系统测试]v9'));
      assert.equal(await page.evaluate(()=>typeof window.ReportSectionLayout?.normalizeHeadings),'function',errors.join(';'));
      assert.equal(await page.locator('#airDocPane .body h3').count(),2,await page.evaluate(()=>JSON.stringify({title:document.querySelector('#airDocPane .air-doc-title').textContent,body:document.querySelector('#airDocPane .body').innerHTML,prior:projectWorkflow.reportVersions[0].chapters[0].sections[0]})));
      assert.match(await page.locator('#airDocPane .section-block > h4').first().innerText(),/^1\.1 运营管理/);
      assert.match(await page.locator('#airDocPane .body h3').first().innerText(),/^1\.1\.1 收楼安排/);
      assert.match(await page.locator('#airDocPane .body h4').first().innerText(),/^1\.1\.1\.1 合同约定/);
      assert.match(await page.locator('#airDocPane .body h6').first().innerText(),/^1\.1\.1\.1\.1\.1 责任落实/);
      await page.locator('#airDocPane .air-doc-download').click();assert.equal(await page.evaluate(()=>__selectedDownload),'[系统测试]v9');
      const payload=await page.evaluate(()=>{exportWord=__nativeExport;return buildExportPayload({version:projectWorkflow.reportVersions[0]});});
      assert.equal(payload.signed,false);assert.equal(payload.appendix,null);assert.match(JSON.stringify(payload),/收楼安排/);assert.doesNotMatch(JSON.stringify(payload),/当前工作稿不可混入/);
      const blocks=payload.chapters[0].sections[0].blocks.filter(b=>b.type==='h');assert.deepEqual(blocks.map(b=>b.level),[3,4,5,6,3]);
      const zip=await JSZip.loadAsync(await docx.Packer.toBuffer(builder(docx,payload))),xml=await zip.file('word/document.xml').async('string');
      for(const level of [1,2,3,4,5,6])assert.match(xml,new RegExp('w:pStyle w:val="Heading'+level+'"'));
      assert.match(xml,/1\.1\.1\.1\.1\.1 责任落实/);assert.doesNotMatch(xml,/当前工作稿不可混入/);
      if(type==='gaibao'){
        fs.mkdirSync('.tmp',{recursive:true});
        const artifacts=fs.mkdtempSync(path.join('.tmp','report-structure-preview-'));
        fs.writeFileSync(path.join(artifacts,'structure-qa.docx'),await docx.Packer.toBuffer(builder(docx,payload)));
        await page.screenshot({path:path.join(artifacts,'structure-preview.png'),fullPage:true});
      }
      assert.equal(await page.evaluate(()=>JSON.stringify({chapters,versions:projectWorkflow.reportVersions})===__baseline),true);
      for(let i=0;i<3;i++){await page.evaluate(()=>airOpenReportVersionById('[系统测试]v11'));assert.match(await page.locator('#airDocPane .air-doc-download').innerText(),/V11/);await page.evaluate(()=>airOpenReportVersionById('[系统测试]v9'));}
      await page.evaluate(()=>{chapters=[];airBuildDocPane();});
    }
    assert.deepEqual(errors,[]);
  }finally{await context.close();await browser.close();}
});
