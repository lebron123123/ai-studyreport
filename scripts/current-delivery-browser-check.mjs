// Isolated loopback fixture: no real account, report, approval or storage mutation.
import http from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
const sources=new Set(['export.js','docxgen.js','docx.umd.js','project-manager.js']);
const html=`<!doctype html><meta charset="utf-8"><title>系统测试：冻结导出隔离</title>
<button id="approved">导出批准快照</button><button id="legacy">检查旧版本拦截</button><button id="savefail">保存失败导航</button><pre id="result">等待操作</pre>
<script>var module={exports:{}};</script><script src="/project-manager.js"></script><script>var testedNavigationGuard=module.exports.navigationGuard;module=undefined;</script>
<script src="/docx.umd.js"></script><script src="/docxgen.js"></script><script src="/export.js"></script>
<script>
var project={name:'当前改动不得导出'},chapters=[],calcResult={amount:99999};
function authHeaders(){return {};}
const originalFetch=window.fetch.bind(window);
const record={id:'fixture-v3',createdAt:1788780000000,contentHash:'a'.repeat(64),status:'approved',integrity:{verified:true},formalExportAllowed:true,approval:{reviewerId:2,reviewedAt:1788780001000},snapshot:{schemaVersion:3,project:{name:'[系统测试]批准快照',owner:'冻结单位'},exportContext:{docNo:'TEST-SEALED',calcResult:{amount:100}},calculations:[],references:[],chapters:[{sourceId:1,name:'项目总论',sections:[{title:'投资依据',content:'<p>批准时的正文：总投资100万元。</p><table><tr><td>投资</td><td>100万元</td></tr></table>',prov:{sourceRef:'fixture-source-v1'}}]}]}};
window.fetch=async(url,options)=>String(url).startsWith('/api/reportdelivery')?new Response(JSON.stringify({ok:true,result:record}),{status:200}):originalFetch(url,options);
let captured;
URL.createObjectURL=blob=>{captured=blob;return 'blob:fixture';};URL.revokeObjectURL=()=>{};
HTMLAnchorElement.prototype.click=function(){document.getElementById('result').textContent='生成文件：'+this.download;};
document.getElementById('approved').onclick=async()=>{try{record.snapshot.schemaVersion=3;await exportFrozenDeliveryWord('fixture','fixture-v3');await originalFetch('/capture',{method:'POST',body:captured});document.getElementById('result').textContent+='；已保存测试DOCX；当前工作稿未引用';}catch(e){document.getElementById('result').textContent='失败：'+e.message;}};
document.getElementById('legacy').onclick=async()=>{record.snapshot.schemaVersion=2;try{await exportFrozenDeliveryWord('fixture','fixture-v3');document.getElementById('result').textContent='失败：未拦截';}catch(e){document.getElementById('result').textContent='已拦截：'+e.message;}};
document.getElementById('savefail').onclick=async()=>{let moved=false,message='';const guard=testedNavigationGuard();await guard.run(async()=>false,()=>moved=true,e=>message=e.message);document.getElementById('result').textContent=(moved?'失败：已经切页':'未切页：')+message;};
</script>`;
http.createServer(async(req,res)=>{try{
  if(req.url==='/'||req.url==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  if(req.url==='/capture'&&req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);await writeFile('outputs/current-frozen-export.docx',Buffer.concat(chunks));return res.end('ok');}
  const name=req.url.slice(1);if(sources.has(name)){res.setHeader('Content-Type','text/javascript');return res.end(await readFile(name));}
  res.statusCode=404;res.end();
}catch(e){res.statusCode=500;res.end(e.message);}}).listen(8096,'127.0.0.1',()=>console.log('Isolated fixture http://127.0.0.1:8096'));
