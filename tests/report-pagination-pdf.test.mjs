import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildPaginationResult} from '../local-server/report-pagination.js';
import {parseArgs,parsePaginationResponse} from '../scripts/report-actual-word-acceptance.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=await fs.readFile(new URL('../local-server/report-pagination.js',import.meta.url),'utf8');
const script=fileURLToPath(new URL('../local-server/report-pagination.ps1',import.meta.url));
const fixture=fileURLToPath(new URL('./fixtures/report-pagination-fake-wps.ps1',import.meta.url));
const execute=promisify(execFile);
const docx=Buffer.from('exact prepared docx bytes'),pdf=Buffer.from('%PDF-1.7\nfixture\n%%EOF');
function proofFor(document=docx,rendered=pdf){return {sha256:hash(rendered),bytes:rendered.length,preparedDocumentSha256:hash(document),preparedDocumentSha256After:hash(document),pagesBeforeExport:120,pagesAfterExport:120,scope:'same-prepared-document-render-only'};}

function paginationMock(mode='success'){
  const files=new Map(),calls=[],metadata={rulesVersion:'fixture',templateVersion:'fixture',sectionBookmarks:[]};
  const sandbox={Buffer,URL,process:{platform:'win32'},busy:false,MAX_BYTES:20*1024*1024,path,tmpdir:()=>os.tmpdir(),fileURLToPath,createHash,
    inspectReportPackage:async()=>metadata,buildPaginationResult,inspectPreparedToc:async()=>({updated:true,entries:1}),
    mkdtemp:async()=>path.join(os.tmpdir(),'report-pagination-mock'),writeFile:async(name,value)=>files.set(name,Buffer.from(value)),
    readFile:async name=>{if(!files.has(name))throw Error('missing mock file '+name);return files.get(name);},
    rm:async name=>{calls.push({cleanup:name});files.clear();},
    execute:async(command,args)=>{
      calls.push({command,args});
      if(mode==='export-error')throw Error('报告 PDF 导出未完成');
      const prepared=args[args.indexOf('-OutputDocx')+1],rendered=args[args.indexOf('-OutputPdf')+1];
      files.set(prepared,docx);
      const layout={pages:120,rendererVersion:'fake',diagnostics:{status:'unavailable'}};
      if(args.includes('-OutputPdf')){
        files.set(rendered,mode==='bad-header'?Buffer.from('not pdf'):pdf);
        layout.pdf=proofFor();
        if(mode==='missing-proof')delete layout.pdf;
        if(mode==='hash-change')layout.pdf.preparedDocumentSha256After=hash('changed');
        if(mode==='page-change')layout.pdf.pagesAfterExport=121;
        if(mode==='pdf-hash-change')layout.pdf.sha256=hash('changed pdf');
      }
      return {stdout:JSON.stringify(layout)};
    }};
  const start=source.indexOf('export async function paginateReport('),end=source.indexOf('export async function inspectPreparedToc(',start);
  vm.runInNewContext(source.slice(start,end).replace('export async function','async function').replaceAll('import.meta.url',JSON.stringify(new URL('../local-server/report-pagination.js',import.meta.url).href))+'\nthis.run=paginateReport;',sandbox);
  return {run:sandbox.run,calls,sandbox};
}
function responseMock(run){
  const sandbox={Request,Response,FormData,Blob,Buffer,MAX_BYTES:20*1024*1024,paginateReport:run};
  vm.runInNewContext(source.slice(source.indexOf('export async function reportPaginationResponse(')).replace('export async function','async function')+'\nthis.run=reportPaginationResponse;',sandbox);
  return sandbox.run;
}
function multipart({withPdf=false,change=()=>{}}={}){
  const data={ok:true,pages:120,receipt:{tocUpdated:true,preparedDocumentSha256:hash(docx),...(withPdf?{pdf:proofFor()}: {})}};
  change(data);
  const form=new FormData();form.set('receipt',JSON.stringify(data));
  form.set('document',new Blob([docx],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),'report.docx');
  if(withPdf)form.set('pdf',new Blob([pdf],{type:'application/pdf'}),'report.pdf');
  return new Response(form);
}

test('PDF CLI opt-in does not change the default acceptance path',()=>{
  assert.equal(parseArgs([]).retainPdf,false);
  assert.equal(parseArgs(['--retain-pdf']).retainPdf,true);
});
test('real pagination function returns optional bytes before temp cleanup and binds exact prepared file',async()=>{
  const mock=paginationMock(),result=await mock.run(Buffer.from('input'),{prepareDownload:true,includePdf:true});
  assert.deepEqual(result.document,docx);assert.deepEqual(result.pdf,pdf);
  assert.equal(result.receipt.pdf.preparedDocumentSha256,hash(result.document));
  assert.equal(result.receipt.pdf.sha256,hash(result.pdf));assert.equal(result.receipt.pdf.pagesBeforeExport,result.pages);
  assert.equal(mock.calls[0].args.includes('-OutputPdf'),true);assert.equal(mock.calls.at(-1).cleanup.includes('report-pagination-mock'),true);assert.equal(mock.sandbox.busy,false);
});
test('default Word pagination does not request, read or return PDF',async()=>{
  const mock=paginationMock(),result=await mock.run(Buffer.from('input'),{prepareDownload:true});
  assert.equal(mock.calls[0].args.includes('-OutputPdf'),false);assert.equal(result.pdf,undefined);assert.equal(result.receipt.pdf,undefined);
});
test('PDF export/error/header/hash/page failures reject and release the request gate',async()=>{
  for(const mode of ['export-error','bad-header','missing-proof','hash-change','page-change','pdf-hash-change']){
    const mock=paginationMock(mode);await assert.rejects(mock.run(Buffer.from('input'),{prepareDownload:true,includePdf:true}),/报告 PDF/);
    assert.equal(mock.sandbox.busy,false,mode);assert.ok(mock.calls.at(-1).cleanup,mode);
  }
  const mock=paginationMock();await assert.rejects(mock.run(Buffer.from('input'),{includePdf:true}),/报告 PDF/);assert.equal(mock.calls.length,0);
});
test('real HTTP handler requires explicit PDF header plus multipart and keeps Word-only compatibility',async()=>{
  const calls=[],run=responseMock(async(_bytes,options)=>{calls.push(options);return {ok:true,document:docx,...(options.includePdf?{pdf}:{}),receipt:{preparedDocumentSha256:hash(docx)}};});
  for(const headers of [{Accept:'multipart/form-data'},{Accept:'multipart/form-data','X-Report-QA-Pdf':'1'}]){
    const response=await run(new Request('http://localhost/test',{method:'POST',headers,body:'input'}),async()=>true),form=await response.formData();
    assert.equal(response.status,200);assert.equal(form.has('pdf'),headers['X-Report-QA-Pdf']==='1');assert.ok(form.has('document'));
    const receipt=JSON.parse(form.get('receipt'));assert.equal(receipt.pdf,undefined,'PDF buffer must not leak into JSON receipt');
  }
  assert.equal(calls[0].prepareDownload,true);assert.equal(calls[0].includePdf,false);assert.equal(calls[1].includePdf,true);
  for(const headers of [{'X-Report-QA-Pdf':'1'},{Accept:'multipart/form-data','X-Report-QA-Pdf':'0'}]){
    const response=await run(new Request('http://localhost/test',{method:'POST',headers,body:'input'}),async()=>true);assert.equal(response.status,503);assert.match((await response.json()).error,/报告 PDF/);
  }
  assert.equal(calls.length,2,'Invalid PDF requests never call WPS');
});
test('requested PDF failure is an HTTP failure, never a Word-only success',async()=>{
  const run=responseMock(async()=>{throw Error('报告 PDF 导出未完成');});
  const response=await run(new Request('http://localhost/test',{method:'POST',headers:{Accept:'multipart/form-data','X-Report-QA-Pdf':'1'},body:'input'}),async()=>true);
  assert.equal(response.status,503);assert.equal((await response.json()).ok,false);
});
test('acceptance parses legacy Word-only response and exact requested PDF separately from visual QA',async()=>{
  const legacy=await parsePaginationResponse(multipart());assert.deepEqual(legacy.prepared,docx);assert.equal(legacy.pdf,undefined);
  const retained=await parsePaginationResponse(multipart({withPdf:true}),{requirePdf:true});assert.deepEqual(retained.pdf,pdf);
  assert.equal(retained.data.visualQa,undefined,'Transport proof cannot fabricate visual approval');
});
test('acceptance blocks missing/forged PDF, mismatched DOCX binding or changed export pages',async()=>{
  await assert.rejects(parsePaginationResponse(multipart(),{requirePdf:true}),/requested PDF/);
  for(const change of [data=>data.receipt.pdf.sha256=hash('other'),data=>data.receipt.pdf.preparedDocumentSha256=hash('other'),data=>data.receipt.pdf.preparedDocumentSha256After=hash('other'),data=>data.receipt.pdf.pagesAfterExport=121,data=>data.receipt.pdf.bytes++,data=>data.receipt.pdf.scope='approved']){
    await assert.rejects(parsePaginationResponse(multipart({withPdf:true,change}),{requirePdf:true}),/PDF does not match/);
  }
});

async function fakeWps(mode='success',withPdf=true,withoutPrepared=false){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'report-fake-wps-'));
  try{
    // Match the production child-process flag; this does not change the machine
    // or user execution policy. The fixture intercepts all COM construction.
    const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fixture,'-Script',script,'-Directory',directory,'-Mode',mode];
    if(withPdf)args.push('-WithPdf');if(withoutPrepared)args.push('-WithoutPrepared');
    const {stdout}=await execute('powershell.exe',args,{windowsHide:true,encoding:'utf8',timeout:15000});
    return JSON.parse(stdout.trim().replace(/^\uFEFF/,''));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}
function assertUserUntouched(result,opened=true){
  assert.equal(result.inputText,'caller source remains unchanged');
  assert.equal(result.calls.filter(value=>value.startsWith('close-own:')).length,opened?1:0,JSON.stringify(result));
  assert.equal(result.calls.some(value=>/QUIT-USER|CHANGE-USER/.test(value)),false,JSON.stringify(result));
}
test('real PowerShell script exports once from its own saved document without quitting or hiding shared WPS',{timeout:20000},async()=>{
  const result=await fakeWps();assert.equal(result.ok,true,JSON.stringify(result));assertUserUntouched(result);
  assert.equal(result.calls.filter(value=>value.startsWith('open-own:')).length,1);assert.equal(result.calls.filter(value=>value==='pdf:17').length,1);
  assert.ok(result.calls.indexOf('save:12')<result.calls.indexOf('pdf:17'));assert.equal(result.layout.pdf.preparedDocumentSha256,result.layout.pdf.preparedDocumentSha256After);assert.equal(result.layout.pdf.pagesBeforeExport,result.layout.pdf.pagesAfterExport);
  const legacy=await fakeWps('success',false);assert.equal(legacy.ok,true);assertUserUntouched(legacy);assert.equal(legacy.layout.pdf,undefined);assert.equal(legacy.calls.some(value=>value.startsWith('pdf:')),false);
});
test('real PowerShell export/hash/page failures close only the opened report and return no success receipt',{timeout:60000},async()=>{
  for(const mode of ['pdf-error','hash-change','page-change','empty-pdf']){
    const result=await fakeWps(mode);assert.equal(result.ok,false,JSON.stringify(result));assert.match(result.error,/Report PDF/);assertUserUntouched(result);assert.equal(result.layout,undefined);
  }
  const invalid=await fakeWps('success',true,true);assert.equal(invalid.ok,false);assertUserUntouched(invalid,false);assert.equal(invalid.calls.includes('fake-com'),false);
  const openError=await fakeWps('open-error');assert.equal(openError.ok,false);assertUserUntouched(openError,false);
});

test('real Windows writer lock permits read-only hashing, while a writer change still rejects the PDF receipt',{timeout:30000},async()=>{
  const stable=await fakeWps('writer-locked');
  assert.equal(stable.legacyReadBlocked,true,'The old OpenRead call must fail against the actual Windows handle');
  assert.equal(stable.ok,true,JSON.stringify(stable));assertUserUntouched(stable);
  assert.equal(stable.layout.pdf.preparedDocumentSha256,hash('prepared exact DOCX fixture'));
  assert.equal(stable.layout.pdf.preparedDocumentSha256After,stable.layout.pdf.preparedDocumentSha256);
  assert.equal(stable.layout.pdf.pagesBeforeExport,stable.layout.pdf.pagesAfterExport);
  const changed=await fakeWps('writer-locked-hash-change');
  assert.equal(changed.legacyReadBlocked,true);assert.equal(changed.ok,false,JSON.stringify(changed));
  assert.match(changed.error,/Report PDF export changed the prepared Word document/);
  assert.equal(changed.layout,undefined);assertUserUntouched(changed);
});
