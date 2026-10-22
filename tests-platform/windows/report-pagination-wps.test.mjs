import '../../scripts/windows-browser-lockout-guard.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// This suite needs Windows file sharing and Windows PowerShell. Run it in the
// Windows CI job and on the local Windows host; a missing platform is a failure.
assert.equal(process.platform,'win32','Run the Windows pagination suite on Windows');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const script=fileURLToPath(new URL('../../local-server/report-pagination.ps1',import.meta.url));
const fixture=fileURLToPath(new URL('../../tests/fixtures/report-pagination-fake-wps.ps1',import.meta.url));
const execute=promisify(execFile);

async function fakeWps(mode='success',withPdf=true,withoutPrepared=false){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'report-fake-wps-'));
  try{
    // Match the production child-process flag; this does not change the machine
    // or user execution policy. The fixture intercepts all COM construction.
    const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fixture,'-Script',script,'-Directory',directory,'-Mode',mode];
    if(withPdf)args.push('-WithPdf');if(withoutPrepared)args.push('-WithoutPrepared');
    const {stdout}=await execute('powershell.exe',args,{windowsHide:true,encoding:'utf8',timeout:15000});
    return JSON.parse(stdout.trim().replace(/^\uFEFF/,''));
  }finally{
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('report-fake-wps-'));
    await fs.rm(directory,{recursive:true,force:true});
  }
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
