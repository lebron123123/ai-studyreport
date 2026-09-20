import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import JSZip from 'jszip';
const execute=promisify(execFile),MAX_BYTES=20*1024*1024;
let busy=false;
export function pageDecision(pages){
  if(!Number.isInteger(pages)||pages<1)throw Error('无法取得实际页数，请检查排版服务');
  return {ok:pages<=120,pages,maxPages:120,error:pages>120?`报告共${pages}页，超过120页上限。请精简正文后重新下载；系统未截断任何内容。`:undefined};
}
export async function paginateReport(buffer){
  // WPS uses a shared desktop COM instance. Linux conversions each have their
  // own directory and LibreOffice profile; the HTTP admission gate bounds them.
  if(process.platform==='win32'&&busy)throw Error('另一份报告正在核验页数，请稍后重试');
  if(buffer.length>MAX_BYTES)throw Error('报告超过20MB，请精简图片后重试');
  if(process.platform==='win32')busy=true;let directory;
  try{
    const zip=await JSZip.loadAsync(buffer);
    const entries=Object.values(zip.files);
    if(entries.some(x=>/vbaProject|embeddings\//i.test(x.name)))throw Error('报告含嵌入程序或对象，请移除后核验');
    if(!zip.file('word/document.xml')||entries.length>2000||entries.reduce((n,x)=>n+(x._data?.uncompressedSize||0),0)>80*1024*1024)throw Error('报告文件结构或大小不符合要求');
    for(const entry of entries.filter(x=>x.name.endsWith('.rels'))){
      if(/TargetMode\s*=\s*["']External/i.test(await entry.async('string')))throw Error('报告含外部链接对象，请移除后核验');
    }
    directory=await mkdtemp(path.join(tmpdir(),'report-pagination-'));
    const input=path.join(directory,'report.docx');await writeFile(input,buffer);
    let pages;
    if(process.platform==='win32'){
      const script=fileURLToPath(new URL('./report-pagination.ps1',import.meta.url));
      const result=await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-InputDocx',input],{timeout:60000,windowsHide:true,maxBuffer:65536});
      pages=Number(result.stdout.trim());
    }else{
      await execute('soffice',['-env:UserInstallation='+pathToFileURL(path.join(directory,'office-profile')).href,'--headless','--convert-to','pdf','--outdir',directory,input],{timeout:60000,maxBuffer:65536});
      const result=await execute('pdfinfo',[path.join(directory,'report.pdf')],{timeout:10000,maxBuffer:65536});
      pages=Number(result.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
    }
    return {...pageDecision(pages),renderer:process.platform==='win32'?'WPS':'LibreOffice'};
  }finally{
    try{if(directory)await rm(directory,{recursive:true,force:true});}finally{if(process.platform==='win32')busy=false;}
  }
}
export async function reportPaginationResponse(request,authorize){
  if(!await authorize(request))return Response.json({ok:false,error:'请先登录再下载报告'},{status:401});
  try{
    const reader=request.body?.getReader();if(!reader)throw Error('未收到报告文件');
    const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw Error('报告超过20MB，请精简图片后重试');}chunks.push(value);}
    const result=await paginateReport(Buffer.concat(chunks));
    return Response.json(result,{status:result.ok?200:422});
  }catch(error){
    const known=/报告|核验|页数/.test(error.message);
    return Response.json({ok:false,error:known?error.message:'实际页数核验未完成，请管理员检查排版服务（Windows需要WPS，Linux需要LibreOffice和pdfinfo）。原报告仍保留。'},{status:503});
  }
}
