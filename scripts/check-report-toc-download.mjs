// Real browser download -> authenticated local pagination -> actual saved DOCX.
// All non-pagination APIs are isolated. No project/report is saved or adopted.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
import {inspectPreparedToc} from '../local-server/report-pagination.js';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const JSZip=createRequire(new URL('../local-server/server.js',import.meta.url))('jszip');
const origin='http://localhost:8080',sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const useTax=process.argv.includes('--tax');
const sourcePath=path.resolve('outputs/report-standardization/tax-source.json');
const sourceBytes=useTax?await fs.readFile(sourcePath):null;
const source=sourceBytes?JSON.parse(sourceBytes):null;
const sourceDraft=source?.state?.draft||source?.state;
const output=path.resolve('outputs/report-standardization/toc-download-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));
await fs.mkdir(output,{recursive:true});
const report={output,scope:useTax?'full tax-project draft read-only memory copy':'isolated three-chapter fixture',startedAt:new Date().toISOString(),requests:[],dialogs:[],pageErrors:[],consoleErrors:[],passed:false};
const db=createD1Shim(process.env.DATABASE_URL);
let browser,authorization='';
const safe=error=>String(error?.message||error).replaceAll(authorization||'\u0000','[redacted]').replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]');
try{
  const users=(await db.prepare('SELECT id,username FROM users WHERE username=?').bind('zgbyd').all()).results||[];
  assert.equal(users.length,1);authorization='Bearer '+await signToken(process.env,users[0].id,users[0].username);
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block',acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',error=>report.pageErrors.push(safe(error)));
  page.on('console',msg=>{if(msg.type()==='error')report.consoleErrors.push(msg.text());});
  page.on('dialog',async dialog=>{report.dialogs.push({type:dialog.type(),message:dialog.message()});if(dialog.type()==='confirm')await dialog.accept();else await dialog.dismiss();});
  let receiptPromise=null;
  page.on('response',response=>{
    if(new URL(response.url()).pathname!=='/api/report-pagination')return;
    receiptPromise=(async()=>{
      const bytes=await response.body(),type=response.headers()['content-type']||'';
      const res=new Response(bytes,{status:response.status(),headers:{'content-type':type}});
      if(type.includes('multipart/')){
        const form=await res.formData(),entries=[...form.entries()];
        for(const [key,value] of entries){
          if(typeof value==='string'){try{report.pagination=JSON.parse(value);}catch{}continue;}
          const b=Buffer.from(await value.arrayBuffer());
          if(value.type.includes('json')){report.pagination=JSON.parse(b.toString());continue;}
          report.preparedFile={key,bytes:b.length,sha256:sha(b)};
          await fs.writeFile(path.join(output,'server-prepared.docx'),b,{flag:'wx'});
        }
      }else report.pagination=await res.json();
      report.paginationHttpStatus=response.status();
    })();
  });
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===origin&&url.pathname.startsWith('/api/')){
      report.requests.push({path:url.pathname,method:req.method()});
      if(url.pathname==='/api/report-pagination'){
        assert.equal(req.method(),'POST');const b=req.postDataBuffer();
        report.inputFile={bytes:b.length,sha256:sha(b)};
        await fs.writeFile(path.join(output,'browser-input.docx'),b,{flag:'wx'});
        return route.continue({headers:{...req.headers(),authorization}});
      }
      return route.fulfill({json:{ok:false,error:'[系统测试]非排版接口隔离'}});
    }
    if(url.origin!==origin&&!['blob:','data:','about:'].includes(url.protocol))return route.abort('blockedbyclient');
    return route.continue();
  });
  await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof exportWord==='function'&&typeof renderSheet==='function'&&!!window.ReportCompletionContract);
  await page.evaluate(draft=>{
    document.getElementById('gate')?.remove();
    currentProjectId='[系统测试]toc-download';currentProjectRole='OWNER';
    // The fixture is memory-only and cannot save back to any real project.
    saveDraft=()=>{};
    if(draft){restoreDraft(draft,{deferRender:true});}
    else{
      Object.keys(project).forEach(k=>delete project[k]);
      Object.assign(project,{name:'[系统测试]目录下载闭环',owner:'隔离验收',industry:'保障性住房',location:'测试区域',type:'非居改保',businessScenario:'housing_conversion'});
      domainKey='gaibao';calcType='gaibao';calcParams=null;calcResult=null;kbEntries=[];
      chapters=['甲','乙','丙'].map((name,ci)=>({name:'[系统测试]章'+name,cn:['一','二','三'][ci],checked:true,sections:Array.from({length:2},(_,si)=>({t:'核验'+name+(si+1),content:'本节核对'+name+(si+1)+'的独立职责。完整保留必要事实与表格，结论须人工核验。'+(si===1?'\n\n| 指标 | 数值 |\n| --- | --- |\n| '+name+' | '+(ci+1)+' |':''),editedHtml:'',numeric:false}))}));
      projectWorkflow=ProjectWorkflow.ensureState({});
      projectWorkflow.reportCompletion={facts:[{key:'name',label:'项目名称',value:project.name,status:'confirmed',source:'系统隔离夹具',owner:'',required:false,allocationMode:'background'}]};
    }
    appMode='report';currentStep=4;signed=false;renderTOC();renderSheet();
    window.__tocBefore=JSON.stringify({project,chapters,calcParams});
  },sourceDraft||null);
  report.sections=await page.evaluate(()=>chapters.flatMap(c=>c.sections||[]).length);
  await page.screenshot({path:path.join(output,'before.png')});
  const downloadPromise=page.waitForEvent('download',{timeout:100000});
  // Observe failure concurrently so a rejected export does not become a false pass.
  const click=page.locator('#exportWordDraftBtn').click();
  await click;
  const download=await downloadPromise;
  const downloaded=path.join(output,'actual-browser-download.docx');await download.saveAs(downloaded);
  if(receiptPromise)await receiptPromise;
  const bytes=await fs.readFile(downloaded);report.download={name:download.suggestedFilename(),bytes:bytes.length,sha256:sha(bytes)};
  assert.equal(report.download.sha256,report.preparedFile?.sha256,'Browser must download the exact updated server document, not the input copy');
  assert.notEqual(report.download.sha256,report.inputFile.sha256,'TOC must be updated and saved');
  report.toc=await inspectPreparedToc(bytes);assert.equal(report.toc.updated,true);assert.ok(report.toc.linkedEntries>=9);
  const zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml').async('string');
  const inputZip=await JSZip.loadAsync(await fs.readFile(path.join(output,'browser-input.docx')));
  const inputXml=await inputZip.file('word/document.xml').async('string');
  const decode=s=>s.replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
  const bodyText=x=>{
    const start=x.search(/<w:bookmarkStart\b[^>]*\bw:name="_tc0"/);
    assert.ok(start>=0,'First actual chapter bookmark must remain');
    return [...x.slice(start).matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>decode(m[1])).join('');
  };
  report.bodyTextPreserved=bodyText(inputXml)===bodyText(xml);assert.equal(report.bodyTextPreserved,true,'Updating TOC must preserve all actual body/table text');
  report.tableCounts={input:(inputXml.match(/<w:tbl[ >]/g)||[]).length,download:(xml.match(/<w:tbl[ >]/g)||[]).length};
  assert.equal(report.tableCounts.input,report.tableCounts.download,'Updating TOC must not remove or merge tables');
  report.bookmarks=[...xml.matchAll(/<w:bookmarkStart\b[^>]*\bw:name="(_tc\d+_\d+)"/g)].map(m=>m[1]);
  assert.equal(new Set(report.bookmarks).size,report.sections);
  report.originalMemoryUnchanged=await page.evaluate(()=>JSON.stringify({project,chapters,calcParams})===__tocBefore);assert.equal(report.originalMemoryUnchanged,true);
  await page.waitForFunction(()=>!document.querySelector('#exportWordDraftBtn').disabled);
  await page.screenshot({path:path.join(output,'download-receipt.png')});
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);
  if(useTax){report.sourceUnchanged=sha(await fs.readFile(sourcePath))===sha(sourceBytes);assert.equal(report.sourceUnchanged,true);}
  report.passed=true;
}catch(error){report.failure=safe(error);process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();
  report.boundaries=['No real project save, report adoption or publication.','Only the pagination API is real; other APIs isolated.','Real browser download and WPS-generated TOC checked; Microsoft Word installation not tested.'];
  await fs.writeFile(path.join(output,'acceptance.json'),JSON.stringify(report,null,2));
  if(browser)await browser.close();await db.close?.();
  console.log(JSON.stringify({passed:report.passed,output,pages:report.pagination?.pages,toc:report.toc,failure:report.failure}));
}
