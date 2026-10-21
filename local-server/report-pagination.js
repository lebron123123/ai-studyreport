import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import reportOutputPolicy from '../report-output-policy.js';
import buildDocxDocument from '../docxgen.js';
const execute=promisify(execFile),MAX_BYTES=20*1024*1024;
const RECEIPT_VERSION='report-pagination-receipt-v2',MAX_PAGES=130;
let busy=false;
export function pageDecision(pages){
  if(!Number.isInteger(pages)||pages<1)throw Error('无法取得实际页数，请检查排版服务');
  // This fixed download guard is not the user's selected target range and
  // does not certify content depth. The client may explicitly accept a full
  // over-limit working draft; no content or typography is changed here.
  return {ok:pages<=MAX_PAGES,pages,maxPages:MAX_PAGES,error:pages>MAX_PAGES?`报告共${pages}页，超过${MAX_PAGES}页下载保护线。请核查篇幅或明确确认仍下载完整报告；系统未截断任何内容。`:undefined};
}
function declaredProperty(xml,name){
  const tag=String(xml||'').match(new RegExp('<property\\b[^>]*\\bname=["\']'+name+'["\'][^>]*>([\\s\\S]*?)<\\/property>'))?.[1];
  const value=tag?.match(/<vt:lpwstr>([^<]*)<\/vt:lpwstr>/)?.[1];
  return value&&/^[a-zA-Z0-9._-]{1,100}$/.test(value)?value:null;
}
export async function inspectReportPackage(buffer){
  if(buffer.length>MAX_BYTES)throw Error('报告超过20MB，请精简图片后重试');
  const zip=await JSZip.loadAsync(buffer),entries=Object.values(zip.files);
  if(entries.some(x=>/vbaProject|embeddings\//i.test(x.name)))throw Error('报告含嵌入程序或对象，请移除后核验');
  if(!zip.file('word/document.xml')||entries.length>2000||entries.reduce((n,x)=>n+(x._data?.uncompressedSize||0),0)>80*1024*1024)throw Error('报告文件结构或大小不符合要求');
  for(const entry of entries.filter(x=>x.name.endsWith('.rels'))){
    if(/TargetMode\s*=\s*["']External/i.test(await entry.async('string')))throw Error('报告含外部链接对象，请移除后核验');
  }
  const documentXml=await zip.file('word/document.xml').async('string');
  const properties=await zip.file('docProps/custom.xml')?.async('string')||'';
  if(/<!DOCTYPE|<!ENTITY/i.test(documentXml+properties))throw Error('报告含不支持的XML实体，请移除后核验');
  return {
    templateVersion:declaredProperty(properties,'ReportTemplateVersion'),
    rulesVersion:declaredProperty(properties,'ReportContentRulesVersion'),
    sectionBookmarks:[...documentXml.matchAll(/<w:bookmarkStart\b[^>]*\bw:name="(_tc\d+_\d+)"/g)].map(m=>m[1]),
  };
}
function safePageRange(item,pages){
  const startPage=Number(item?.startPage),endPage=Number(item?.endPage);
  return Number.isInteger(startPage)&&Number.isInteger(endPage)&&startPage>=1&&endPage>=startPage&&endPage<=pages?{startPage,endPage,pageSpan:endPage-startPage+1}:null;
}
export function buildPaginationResult(buffer,layout,metadata={}){
  const decision=pageDecision(Number(layout.pages)),pages=decision.pages;
  const raw=layout.diagnostics||{},diagnostics={status:'unavailable',measurement:'actual-renderer-pages',sections:[],tables:[],reason:raw.reason||'当前排版引擎未返回实际章节和表格页区间；未以字数估算代替。'};
  if(raw.status==='available'||raw.status==='partial'){
    const errors=[];
    for(const row of Array.isArray(raw.sections)?raw.sections:[]){
      const range=safePageRange(row,pages);
      if(!range||!/^_tc\d+_\d+$/.test(String(row.bookmark))||!(metadata.sectionBookmarks||[]).includes(row.bookmark)){errors.push('章节页区间或书签无法核验');continue;}
      if(diagnostics.sections.some(s=>s.bookmark===row.bookmark)){errors.push('章节诊断重复');continue;}
      diagnostics.sections.push({bookmark:row.bookmark,title:String(row.title||'').slice(0,300),...range});
    }
    diagnostics.sections.sort((a,b)=>(metadata.sectionBookmarks||[]).indexOf(a.bookmark)-(metadata.sectionBookmarks||[]).indexOf(b.bookmark));
    for(const row of Array.isArray(raw.tables)?raw.tables:[]){
      const range=safePageRange(row,pages),index=Number(row.index);
      if(!range||!Number.isInteger(index)||index<1||diagnostics.tables.some(t=>t.index===index)){errors.push('表格页区间无法核验');continue;}
      diagnostics.tables.push({index,sectionBookmark:diagnostics.sections.some(s=>s.bookmark===row.sectionBookmark)?row.sectionBookmark:null,...range});
    }
    const missing=(metadata.sectionBookmarks||[]).length!==diagnostics.sections.length;
    diagnostics.status=!missing&&!errors.length&&raw.status==='available'?'available':diagnostics.sections.length||diagnostics.tables.length?'partial':'unavailable';
    diagnostics.reason=[raw.reason,missing?'部分章节未取得实际页区间':null,...new Set(errors)].filter(Boolean).join('；')||null;
  }
  const rulesVersion=String(reportOutputPolicy.contentVersion||'unknown'),templateVersion=buildDocxDocument.templateVersion;
  return {...decision,renderer:layout.renderer,diagnostics,receipt:{
    schemaVersion:RECEIPT_VERSION,documentSha256:createHash('sha256').update(buffer).digest('hex'),
    checkedAt:new Date().toISOString(),scope:'pagination-only',
    validationStatus:decision.ok?'within-page-limit':'over-page-limit',
    pages,maxPages:decision.maxPages,rulesVersion,templateVersion,
    documentRulesVersion:metadata.rulesVersion||null,documentTemplateVersion:metadata.templateVersion||null,
    versionsMatch:metadata.rulesVersion===rulesVersion&&metadata.templateVersion===templateVersion,
    renderer:layout.renderer,rendererVersion:String(layout.rendererVersion||'unknown').slice(0,100),
    // A real page-count receipt does not certify factual/financial correctness.
    contentQualityCertified:false,
  }};
}
export async function paginateReport(buffer,{prepareDownload=false,includePdf=false}={}){
  // WPS uses a shared desktop COM instance. Linux conversions each have their
  // own directory and LibreOffice profile; the HTTP admission gate bounds them.
  if(process.platform==='win32'&&busy)throw Error('另一份报告正在核验页数，请稍后重试');
  if(buffer.length>MAX_BYTES)throw Error('报告超过20MB，请精简图片后重试');
  if(includePdf&&!prepareDownload)throw Error('报告 PDF 仅随本次已更新目录的 Word 文件返回');
  if(process.platform==='win32')busy=true;let directory;
  try{
    const metadata=await inspectReportPackage(buffer);
    if(prepareDownload&&process.platform!=='win32')throw Error('当前排版服务尚未配置可靠的 Word 目录更新与保存能力，暂不下载空目录文件；请使用已配置 WPS 的服务。');
    directory=await mkdtemp(path.join(tmpdir(),'report-pagination-'));
    const input=path.join(directory,'report.docx');await writeFile(input,buffer);
    const prepared=path.join(directory,'prepared.docx'),preparedPdf=path.join(directory,'prepared.pdf');
    let layout;
    if(process.platform==='win32'){
      const script=fileURLToPath(new URL('./report-pagination.ps1',import.meta.url));
      const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-InputDocx',input];
      if(prepareDownload)args.push('-OutputDocx',prepared);
      if(includePdf)args.push('-OutputPdf',preparedPdf);
      const result=await execute('powershell.exe',args,{timeout:60000,windowsHide:true,maxBuffer:2*1024*1024,encoding:'utf8'});
      layout=JSON.parse(result.stdout.trim().replace(/^\uFEFF/,''));
      layout.renderer='WPS';
    }else{
      await execute('soffice',['-env:UserInstallation='+pathToFileURL(path.join(directory,'office-profile')).href,'--headless','--convert-to','pdf','--outdir',directory,input],{timeout:60000,maxBuffer:65536});
      const result=await execute('pdfinfo',[path.join(directory,'report.pdf')],{timeout:10000,maxBuffer:65536});
      let rendererVersion='unknown';
      try{rendererVersion=(await execute('soffice',['--version'],{timeout:10000,maxBuffer:65536})).stdout.trim();}catch{/* Missing version never invents a version or changes actual page count. */}
      layout={pages:Number(result.stdout.match(/^Pages:\s+(\d+)/m)?.[1]),renderer:'LibreOffice',rendererVersion,diagnostics:{status:'unavailable',reason:'当前Linux排版适配器只核验真实总页数，尚不提供可靠章节/表格页区间。'}};
    }
    const result=buildPaginationResult(buffer,layout,metadata);
    if(prepareDownload){
      const document=await readFile(prepared),preparedMetadata=await inspectReportPackage(document);
      if(preparedMetadata.rulesVersion!==metadata.rulesVersion||preparedMetadata.templateVersion!==metadata.templateVersion||JSON.stringify(preparedMetadata.sectionBookmarks)!==JSON.stringify(metadata.sectionBookmarks))throw Error('目录更新后的文件版本或章节书签不一致，暂不下载；原报告仍保留。');
      const toc=await inspectPreparedToc(document,{maxPages:result.pages});
      result.receipt.preparedDocumentSha256=createHash('sha256').update(document).digest('hex');
      result.receipt.tocUpdated=true;
      result.toc=toc;
      result.document=document;
      if(includePdf){
        const pdf=await readFile(preparedPdf),proof=layout.pdf;
        if(pdf.length<5||pdf.subarray(0,5).toString('ascii')!=='%PDF-'||proof?.sha256!==createHash('sha256').update(pdf).digest('hex')||proof?.preparedDocumentSha256!==result.receipt.preparedDocumentSha256||proof?.preparedDocumentSha256After!==result.receipt.preparedDocumentSha256||proof?.pagesBeforeExport!==result.pages||proof?.pagesAfterExport!==result.pages)throw Error('报告 PDF 与本次 Word 文件或实际页数不一致，不能作为验收产物；原报告仍保留。');
        result.receipt.pdf={...proof,bytes:pdf.length,scope:'same-prepared-document-render-only'};
        result.pdf=pdf;
      }
    }
    return result;
  }finally{
    try{if(directory)await rm(directory,{recursive:true,force:true});}finally{if(process.platform==='win32')busy=false;}
  }
}
export async function inspectPreparedToc(buffer,{maxPages=Number.MAX_SAFE_INTEGER}={}){
  const zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');
  // A successful save alone cannot prove a populated, navigable TOC. Inspect
  // the actual field result, require cached page numbers and existing targets.
  const tocStart=xml.search(/<w:instrText\b[^>]*>\s*TOC\s/);
  if(tocStart<0)throw Error('目录更新后缺少可更新的原生目录域，暂不下载。');
  const tocContentStart=xml.lastIndexOf('<w:sdtContent',tocStart),tocEnd=xml.indexOf('</w:sdtContent>',tocStart);
  if(tocContentStart<0||tocEnd<0)throw Error('目录更新后缺少原生目录内容控件，暂不下载。');
  const tocXml=xml.slice(tocContentStart,tocEnd),links=[];
  // Word writes w:hyperlink, while WPS writes a nested HYPERLINK/PAGEREF
  // complex field. Both are genuine, updateable internal links.
  for(const paragraph of tocXml.match(/<w:p\b[\s\S]*?<\/w:p>/g)||[]){
    const wrapped=paragraph.match(/<w:hyperlink\b[^>]*\bw:anchor="([^"]+)"[^>]*>([\s\S]*?)<\/w:hyperlink>/);
    const field=paragraph.match(/<w:instrText\b[^>]*>\s*HYPERLINK\s+\\l\s+(?:&quot;)?([\w-]+)(?:&quot;)?\s*<\/w:instrText>/);
    if(wrapped)links.push([wrapped[1],wrapped[2]]);
    else if(field){
      const pageReference=paragraph.match(/<w:instrText\b[^>]*>\s*PAGEREF\s+([\w-]+)\s/);
      if(pageReference?.[1]!==field[1])throw Error('目录标题链接与页码目标不一致，暂不下载。');
      links.push([field[1],paragraph]);
    }
  }
  if(!links.length)throw Error('目录更新后没有可跳转的章节链接，暂不下载。');
  const bookmarks=new Set([...xml.matchAll(/<w:bookmarkStart\b[^>]*\bw:name="([^"]+)"/g)].map(m=>m[1]));
  const expected=[...bookmarks].filter(name=>/^_tc\d+(?:_\d+)?$/.test(name)).length;
  if(links.length!==expected||new Set(links.map(link=>link[0])).size!==expected)throw Error('目录条目与正文标题数量不一致，暂不下载。');
  for(const [anchor,body]of links){
    const page=[...body.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m=>m[1]).filter(x=>x.trim()).at(-1);
    if(!bookmarks.has(anchor)||!/^\d+$/.test(page||'')||Number(page)<1||Number(page)>maxPages)throw Error('目录更新后仍有空页码或失效链接，暂不下载。');
  }
  return {updated:true,entries:links.length,linkedEntries:links.length,cachedPageNumbers:links.length};
}
export async function reportPaginationResponse(request,authorize){
  if(!await authorize(request))return Response.json({ok:false,error:'请先登录再下载报告'},{status:401});
  try{
    const reader=request.body?.getReader();if(!reader)throw Error('未收到报告文件');
    const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw Error('报告超过20MB，请精简图片后重试');}chunks.push(value);}
    const prepareDownload=request.headers.get('Accept')?.includes('multipart/form-data')===true;
    const pdfHeader=request.headers.get('X-Report-QA-Pdf');
    if(pdfHeader!==null&&(pdfHeader!=='1'||!prepareDownload))throw Error('报告 PDF 需明确请求并随 Word 文件返回');
    const result=await paginateReport(Buffer.concat(chunks),{prepareDownload,includePdf:pdfHeader==='1'});
    if(prepareDownload){
      const {document,pdf,...receipt}=result,body=new FormData();
      body.set('receipt',JSON.stringify(receipt));
      body.set('document',new Blob([document],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),'report.docx');
      if(pdf)body.set('pdf',new Blob([pdf],{type:'application/pdf'}),'report.pdf');
      return new Response(body,{status:result.ok?200:422,headers:{'Cache-Control':'no-store'}});
    }
    return Response.json(result,{status:result.ok?200:422});
  }catch(error){
    const known=/报告|核验|页数|目录|章节书签/.test(error.message);
    return Response.json({ok:false,error:known?error.message:'实际页数核验未完成，请管理员检查排版服务（Windows需要WPS，Linux需要LibreOffice和pdfinfo）。原报告仍保留。'},{status:503});
  }
}
