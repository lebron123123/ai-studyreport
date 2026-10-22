// Read-only recheck of a previously composed and paginated acceptance artifact.
// Does not invoke AI, a project API, pagination, or modify either Word document.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {inspectXmlInBrowser} from './report-actual-word-acceptance.mjs';
const require=createRequire(import.meta.url);
require('./windows-browser-lockout-guard.cjs');
const {chromium}=require('playwright');
const Zip=createRequire(new URL('../local-server/server.js',import.meta.url))('jszip');
const root=path.resolve('outputs/report-standardization');
const dir=path.resolve(process.argv[2]||'');
if(!dir.startsWith(root+path.sep))throw Error('An existing acceptance directory inside outputs/report-standardization is required');
const acceptance=JSON.parse(await fs.readFile(path.join(dir,'acceptance.json'),'utf8'));
const expected=JSON.parse(await fs.readFile(path.join(dir,'expected-structure.json'),'utf8'));
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();
  async function check(name){
    const zip=await Zip.loadAsync(await fs.readFile(path.join(dir,name)));
    return page.evaluate(inspectXmlInBrowser,{xml:await zip.file('word/document.xml').async('string'),stylesXml:await zip.file('word/styles.xml').async('string'),expected});
  }
  const input=await check(acceptance.key+'.docx'),prepared=await check(acceptance.key+'.prepared.docx');
  const result={at:new Date().toISOString(),paidAiCalls:0,sourceWrites:0,paginationCalls:0,input,prepared,
    bodyTextPreserved:input.bodyText===prepared.bodyText,
    tableGeometryPreserved:JSON.stringify(input.sections.map(s=>s.geometry))===JSON.stringify(prepared.sections.map(s=>s.geometry)),
    completeReportCertified:false};
  delete input.bodyText;delete prepared.bodyText;
  const out=path.join(dir,'xml-recheck-'+Date.now()+'.json');
  await fs.writeFile(out,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({out,inputPassed:input.passed,preparedPassed:prepared.passed,bodyTextPreserved:result.bodyTextPreserved,tableGeometryPreserved:result.tableGeometryPreserved,
    differences:prepared.sections.filter(s=>!s.paragraphsMatch||!s.headingsMatch||!s.tablesMatch).map(s=>({number:s.number,paragraphsMatch:s.paragraphsMatch,headingsMatch:s.headingsMatch,tablesMatch:s.tablesMatch,paragraphDiff:s.paragraphDiff})),completeReportCertified:false}));
}finally{await browser.close();}
