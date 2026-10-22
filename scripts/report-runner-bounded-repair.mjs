// Acceptance-only editor: operates through the one existing isolated runner.
// Original task receipts and untouched paragraphs/tables are never rewritten.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {inspectorCall} from './report-runner-final-control.mjs';
import {mergeAdmissionMetadata} from './report-local-metadata-recovery.mjs';
const OUT=path.resolve('outputs/report-standardization/1010-full-generation-2026-10-10T02-04-51-303Z-3378c9e5/generation-runner');
const IDS={tax:'f4395f64-af1b-43bd-b809-580b5ec9406b',longgang:'2884b7a3-960f-40c0-af89-5d19e0284836'};
const digest=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const decodeEscaped=x=>x.replace(/&(lt|gt|amp|quot|#39|#x27);/gi,(_,k)=>({lt:'<',gt:'>',amp:'&',quot:'"','#39':"'",'#x27':"'"})[k.toLowerCase()]);
export function exactSourceOffsets(text,original,expectedCount=1){const offsets=[];let at=0;while((at=text.indexOf(original,at))>=0){offsets.push(at);at+=original.length;}if(offsets.length!==expectedCount)throw Error('Exact HTML target is absent/ambiguous');return offsets;}
async function archive(key,name,data){const dir=path.join(OUT,key,'recovery');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,name+'-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex')+'.json');await fs.writeFile(file,JSON.stringify(data,null,2),{flag:'wx'});return file;}
export function normalizeBoundedResponse(plan,response){
 if(!response||typeof response!=='object'||Array.isArray(response))throw Error('Expected response object');
 const normalized=structuredClone(response),normalizations=[];
 for(const [field,targets]of [['replacements',plan.paragraphs],['additions',plan.headings],['tables',plan.tables]]){
  if(!(field in normalized)&&targets.length===0){normalized[field]=[];normalizations.push({kind:'omitted-empty-array',field});}
 }
 if(Array.isArray(normalized.replacements))for(const item of normalized.replacements){
  const target=plan.paragraphs.find(t=>t.id===item.id);
  if(target?.html&&typeof item.text==='string'&&item.text.startsWith(target.open)&&item.text.endsWith(target.close)){
   const inner=item.text.slice(target.open.length,-target.close.length);
   if(!/[<>\r\n]|&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(inner)){item.text=inner;normalizations.push({kind:'exact-original-paragraph-wrapper',id:item.id});}
  }
 }
 return {response:normalized,normalizations};
}
export function completionInputHtml(text,renderMarkdown){return /^\s*<(?:h[1-6]|p|figure|table|div)\b/i.test(text)?text:renderMarkdown(text);}
export function applyExactStructureOperations(before,row){
 if(digest(before)!==row.bodySha256||!Array.isArray(row.operations)||!row.operations.length)throw Error('Exact structure body hash required');
 const operations=row.operations.map((op,index)=>{if(!Number.isInteger(op.offset)||!op.exactHtml||typeof op.replacementHtml!=='string'||before.slice(op.offset,op.offset+op.exactHtml.length)!==op.exactHtml)throw Error('Exact structure offset/CAS mismatch: '+index);if(/<(?:script|iframe|object|embed|input|form|button|link|style)\b|\son\w+\s*=|javascript:/i.test(op.replacementHtml))throw Error('Unsafe structure replacement');return {...op,end:op.offset+op.exactHtml.length};});
 for(let i=0;i<operations.length;i++)for(let j=i+1;j<operations.length;j++)if(Math.max(operations[i].offset,operations[j].offset)<Math.min(operations[i].end,operations[j].end))throw Error('Overlapping structure operations');
 let after=before;for(const op of operations.slice().sort((a,b)=>b.offset-a.offset))after=after.slice(0,op.offset)+op.replacementHtml+after.slice(op.end);
 return {after,beforeSha256:digest(before),afterSha256:digest(after),operationCount:operations.length,untargetedBytesPreserved:true};
}
// Undo only the executor's exact whole-document escape. This never invents or
// edits prose; literals and partial/mixed escaped snippets remain untouched.
export function restoreEscapedReportHtml(text){
 let current=text,rounds=0;
 while(rounds<3){const m=current.match(/^\s*<p\b[^>]*>([\s\S]*)<\/p>\s*$/i);if(!m||/<\/?[a-z][^>]*>/i.test(m[1]))break;const inner=decodeEscaped(m[1]),heading=/^\s*<(?:h[1-6]\b|div\b[^>]*\bdata-report-heading-level\s*=)/i.test(inner)&&/<\/(?:h[1-6]|div)>/i.test(inner),nested=/^\s*<p\b[^>]*>&lt;(?:p\b|h[1-6]\b|div\b)/i.test(inner);if(!heading&&!nested)break;if(/<(?:script|iframe|object|embed|input|form|button|link|style)\b|\son\w+\s*=|javascript:/i.test(inner))throw Error('Unsafe escaped report markup');current=inner;rounds++;if(heading)return {text:current,rounds,changed:true};}
 if(rounds)return {text,rounds:0,changed:false};
 return {text:current,rounds,changed:current!==text};
}
// Evidence-backed corrections are not model patches. They may correct ordinary
// AI table cells, but never a calculator-owned table or an unrelated byte.
export function applySourceCorrections(before,changes,{beforeSha256=digest(before)}={}){
 if(digest(before)!==beforeSha256||!Array.isArray(changes)||!changes.length)throw Error('Exact source correction body required');
 const protectedSpans=[...before.matchAll(/<(figure|table)\b[^>]*(?:data-report-(?:calc-[\w-]*|program-table|financial-source)[^>]*|data-template-id=["']template(?:0[4-9]|1[0-9])["'])[^>]*>[\s\S]*?<\/\1>/gi)].map(m=>[m.index,m.index+m[0].length]);
 const used=new Set(),operations=[];
 for(const change of changes){
  if(!change.id||used.has(change.id)||!Number.isInteger(change.start)||!Number.isInteger(change.end)||change.start<0||change.end<=change.start||before.slice(change.start,change.end)!==change.original)throw Error('Source correction CAS/identity mismatch');
  if(!Array.isArray(change.sources)||!change.sources.length||change.sources.some(s=>!s.locator||!/^[a-f0-9]{64}$/i.test(s.sha256)))throw Error('Source correction requires exact evidence hash and locator');
  if(protectedSpans.some(([a,b])=>change.start<b&&change.end>a))throw Error('Calculator-owned table cannot be source patched');
  const match=change.original.match(/^<(p|td|th)\b[^>]*>([\s\S]*)<\/\1>$/i);
  if(!match||typeof change.replacementText!=='string'||!change.replacementText.trim())throw Error('Source correction must replace one exact paragraph or ordinary table cell');
  if(change.escapedInnerHtml===true){
   const decoded=decodeEscaped(match[2]),next=change.replacementText;
   const tags=x=>x.match(/<[^>]+>/g)||[],headings=x=>x.match(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>|<div\b[^>]*data-report-heading-level[^>]*>[\s\S]*?<\/div>/gi)||[],tables=x=>x.match(/<(table|figure)\b[^>]*>[\s\S]*?<\/\1>/gi)||[];
   if(match[1].toLowerCase()!=='p'||change.preserveInnerHeadingBytes!==true||decoded!==change.quote||next.length>100000||/<(?:script|iframe|object|embed|input|form|button|a|link|style)\b|\son\w+\s*=|javascript:|data-report-(?:program-table|calc-source|financial-source)/i.test(decoded)||JSON.stringify(tags(decoded))!==JSON.stringify(tags(next))||JSON.stringify(headings(decoded))!==JSON.stringify(headings(next))||JSON.stringify(tables(decoded))!==JSON.stringify(tables(next)))throw Error('Escaped structure correction must preserve every original tag, heading and table');
   used.add(change.id);operations.push({...change,text:next,decodedOriginal:decoded});continue;
  }
  if(/[<>\r\n]/.test(change.replacementText)||change.replacementText.length>5000)throw Error('Source correction must replace one exact paragraph or ordinary table cell');
  const open=change.original.match(/^<[^>]+>/)[0],close='</'+match[1]+'>';
  used.add(change.id);operations.push({...change,text:open+esc(change.replacementText.trim())+close});
 }
 for(let i=0;i<operations.length;i++)for(let j=i+1;j<operations.length;j++)if(Math.max(operations[i].start,operations[j].start)<Math.min(operations[i].end,operations[j].end))throw Error('Overlapping source corrections');
 let after=before;for(const op of operations.slice().sort((a,b)=>b.start-a.start))after=after.slice(0,op.start)+op.text+after.slice(op.end);
 const headings=s=>[...s.matchAll(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi)].map(m=>m[0]);
 let comparableBefore=before;for(const op of operations.slice().sort((a,b)=>b.start-a.start))if(op.decodedOriginal)comparableBefore=comparableBefore.slice(0,op.start)+op.decodedOriginal+comparableBefore.slice(op.end);
 if(JSON.stringify(headings(comparableBefore))!==JSON.stringify(headings(after)))throw Error('Source correction changed business headings');
 return {after,beforeSha256,afterSha256:digest(after),operationCount:operations.length,untargetedBytesPreserved:true,evidence:operations.map(({id,sources,original,replacementText})=>({id,sources,originalSha256:digest(original),replacementText}))};
}
export function applyBoundedEdits(before,plan,response){
  if(!response||!Array.isArray(response.replacements)||!Array.isArray(response.additions)||!Array.isArray(response.tables))throw Error('Expected exact replacements/additions/tables arrays');
  if(Object.keys(response).some(k=>!['replacements','additions','tables'].includes(k)))throw Error('Unknown response field');
  const operations=[],used=new Set();
  for(const [field,targets]of [['replacements',plan.paragraphs],['additions',plan.headings]]){
    for(const item of response[field]){
      const target=targets.find(x=>x.id===item.id);if(!target||used.has(item.id))throw Error('Unknown/duplicate edit identity');used.add(item.id);
      if(Object.keys(item).some(k=>!['id','text'].includes(k))||typeof item.text!=='string'||!item.text.trim()||item.text.length>3200||/[<>\r\n]|\[TABLE|^\s*#{1,6}/.test(item.text))throw Error('Edit must be bounded plain prose');
      if(field==='replacements'){
        if(before.slice(target.start,target.end)!==target.original)throw Error('Original paragraph changed');
        operations.push({start:target.start,end:target.end,text:target.html?target.open+esc(item.text.trim())+target.close:item.text.trim()});
      }else operations.push({start:target.position,end:target.position,text:target.existing?'<p>'+esc(item.text.trim())+'</p>':'<h'+target.level+'>'+esc(target.text)+'</h'+target.level+'><p>'+esc(item.text.trim())+'</p>'});
    }
    if(targets.some(t=>!used.has(t.id)))throw Error('Required authorized edit omitted');
  }
  for(const item of response.tables){
    const target=plan.tables.find(x=>x.id===item.id);if(!target||used.has(item.id))throw Error('Unknown/duplicate table identity');used.add(item.id);
    if(Object.keys(item).some(k=>!['id','headers','rows'].includes(k))||JSON.stringify(item.headers)!==JSON.stringify(target.headers)||!Array.isArray(item.rows)||item.rows.length<2||item.rows.length>5)throw Error('Unauthorized table structure');
    if(item.rows.some(row=>!Array.isArray(row)||row.length!==target.headers.length||row.some(x=>typeof x!=='string'||!x.trim()||x.length>120||/[0-9%％\r\n<>|]/.test(x))))throw Error('Qualitative table must not invent numeric facts');
    operations.push({start:before.length,end:before.length,text:'<figure data-report-qualitative-repair="true"><figcaption>'+esc(target.title)+'</figcaption><table><thead><tr>'+item.headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+item.rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></figure>'});
  }
  if(plan.tables.some(t=>!used.has(t.id)))throw Error('Required qualitative table omitted');
  for(let i=0;i<operations.length;i++)for(let j=i+1;j<operations.length;j++)if(Math.max(operations[i].start,operations[j].start)<Math.min(operations[i].end,operations[j].end))throw Error('Overlapping edits');
  let after=before;for(const op of operations.sort((a,b)=>b.start-a.start||b.end-a.end))after=after.slice(0,op.start)+op.text+after.slice(op.end);
  const tables=s=>[...s.matchAll(/<(?:table|figure)\b[^>]*>[\s\S]*?<\/(?:table|figure)>/gi)].map(x=>x[0]).filter(x=>/<table\b/i.test(x));
  const oldTables=tables(before),newTables=tables(after);if(oldTables.some((x,i)=>newTables[i]!==x))throw Error('An existing table changed');
  const headings=s=>[...s.matchAll(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>|^\s*#{1,6}\s+[^\n]+/gmi)].map(x=>x[0]);
  const oldHeadings=headings(before);let headingCursor=0;for(const heading of headings(after))if(heading===oldHeadings[headingCursor])headingCursor++;
  if(headingCursor!==oldHeadings.length)throw Error('An existing business heading changed');
  return {after,beforeSha256:digest(before),afterSha256:digest(after),operationCount:operations.length,unchangedTables:oldTables.length,unchangedHeadingCount:oldHeadings.length,untargetedBytesPreserved:true};
}
const EXTRA={
 tax:{
 '1.1':'依据目录需要程序按已登记材料重新绑定；不得用AI猜文件名、引用身份或核实状态。',
 '2.1':'原房型为两房六套、三房四十三套、四房一套、六房复式一套；只有愉天两套各65.3平方米，不能把其余四十九套均说成三房以上；保留产权五十一套与松园既有拆分的区别。',
 '2.2':'当前模型覆盖2027至2031五个日历年，但2027年7月至2031年12月实际运营54个月；不能写运营五整年。',
 '2.3':'五十一套中只有两套面积65.3平方米，不能宣称项目直接增加小户型供应量；区分存量盘活与小户型新增。',
 '4.1':'当前统一起始租金45元/平方米/月只是确认测算情景；材料各点位租金是原方案，不得说当前模型分别计租。',
 '5.2':'当前确认45元起始租金；70.4、42.44等只能明确作为原材料/旧方案，不可当当前参数。',
 '6.1':'保留全部改造分类；补空标题的业务分析，不夸大改造承诺；当前首年平均出租率55.8333%，15%仅首运营月，当前54个月运营。',
 '6.3':'M0协议草案第5.1仅约定乙方享全部实际租金；M1请示第三（三）的临时用房收益扣分成、M2研究报告物业费税务局承担须分别标材料及阶段冲突，不能统一归入协议草案。',
 '7.1':'乐寓受托及物业费产权方承担是研究建议/待确认，不是最终协议已约定；当前45元仅测算。',
 '7.2':'表格和正文费用归属均须标研究建议/待确认，不能将建议写为合同事实。实际运营54个月，不是五整年。',
 '8.1':'原材料545.21万元与当前工程480.0012万元明确角色；当前工程不等批准全口径总投资。',
 '8.2':'13892万元不是本项目真实原材料，属于旧AI错误，不得作为本次报告投资；当前工程480.0012/借款384.001仅工程资金情景。实际运营54个月。',
 '9.1':'首运营月出租率15%，2027运营六个月平均55.8333%，稳定85%，不得把首月称首年；当前45元、54个月。',
 '9.2':'首运营月15%不等首年；2027运营月平均55.8333%；当前45元、54个月。',
 '9.3':'首运营月15%不等首年；2027运营月平均55.8333%；运营54个月；不改程序表。',
 },
 longgang:{
 '4.1':'原研究总说明153一居/42二居、原文2至6层65/10与逐层表11/4五层合计55/20存在内部口径冲突；各自保留明确来源位置并待设计、测绘核准，不能用其中一项覆盖另一项。5973与4004.78平方米的范围差异原因未证，不可确定称为公区。',
 '7.1':'固定每月25元收楼仅当前确认测算情景；原协议为6年优先回收后梯度净收益分成，无保底。不可把当前12年固定单价说成合同约定。',
 '8.1':'3900万元/20000平方米=1950元/平方米；首次3000万元，后次900万元，不是两次1500元单价全额装修；当前模型与原5973平方米/195套原协议范围分开。',
 '9.4':'净利润3288.77/收入21750.94的15.1%不是收入盈亏临界；收入减成本5028.74不是净利润。租金降低10%时IRR7.51%、NPV331.01为给定情景，临界未重算。2032净现金流6.0058万元、工程720万元，不可说2024后都428至699；没有分年敏感性数据，不得称回正延迟一至二年。',
 }};
const PATTERNS={tax:{'2.1':/四十九|49|两房|三房|2至6/,'2.2':/5年|五年|运营期/,'2.3':/小户型/,'4.1':/租金|计租/,'5.2':/70\.4|42\.44|租金/,'6.3':/临时|物业费|协议草案/,'7.1':/乐寓|物业费/,'7.2':/物业费|5年|五年/,'8.1':/545\.21|投资/,'8.2':/13892|5年|五年/,'9.1':/首年|15%/,'9.2':/首年|15%|5年|五年/,'9.3':/首年|15%|5年|五年/},longgang:{'4.1':/65|10套|2—6|2至6/,'7.1':/固定|25元|经营模式/,'8.1':/1500|3000元|分摊/,'9.4':/15\.1|临界|428|699|推迟|延迟/}};
async function latestDerived(key,number){const dir=path.join(OUT,key,'recovery'),files=await fs.readdir(dir);const file=files.filter(x=>x.startsWith('free-protocol-'+number+'-')).sort().at(-1);return file?{file:path.join(dir,file),data:JSON.parse(await fs.readFile(path.join(dir,file),'utf8'))}:null;}
async function semanticEvidence(){const sections=[],findings=[];for(const name of ['independent-semantic-recheck-20261010T0724.json','independent-tax113-tax115-semantic-recheck-20261010T0728.json']){const x=JSON.parse(await fs.readFile(path.join(OUT,name),'utf8'));sections.push(...x.sections.map(s=>({...s,project:s.project||'tax'})));findings.push(...x.findings.map(f=>({...f,project:f.project||'tax'})));}return {sections,findings};}
export async function runBoundedQueue(harnesses,checkpoint,options={}){
 if(globalThis.__qaBoundedQueueRunning||globalThis.__qaTargetedBatchRunning)throw Error('One shared paid queue only');globalThis.__qaBoundedQueueRunning=true;
 const evidence=await semanticEvidence(),jobs=[],receipts=[],commitChains={tax:Promise.resolve(),longgang:Promise.resolve()};
 try{
 for(const [key,h]of Object.entries(harnesses)){
  if(h.target.id!==IDS[key])throw Error('Exact isolated copy required');
  const rows=await h.page.evaluate(expected=>{if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Exact paused editable copy required');return chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({number:(ci+1)+'.'+(si+1),summary:ReportArgument.contract(c.name,s.t).summary,section:ProjectWorkflow.clone(s)})));},IDS[key]);
  for(const row of rows){if(row.summary||options.keys&&!options.keys.includes(key+':'+row.number))continue;const semantic=evidence.sections.find(s=>s.project===key&&s.id===row.number),extra=EXTRA[key][row.number],cp=checkpoint.sections[key+':'+row.number];if(cp?.status==='passed'&&!semantic&&!extra)continue;
   const derived=await latestDerived(key,row.number);jobs.push({key,number:row.number,semantic,findings:evidence.findings.filter(f=>f.project===key&&f.section===row.number),extra:extra||'',derived:derived?.data,derivedFile:derived?.file,section:row.section});
  }
 }
 globalThis.__qaBoundedQueueStatus={at:new Date().toISOString(),queued:jobs.length,running:[],finished:[],newPaidAiCalls:0};
 const commit=(key,fn)=>{const promise=commitChains[key].then(fn);commitChains[key]=promise.catch(()=>{});return promise;};
 async function worker(){while(jobs.length){const job=jobs.shift(),h=harnesses[job.key],label=job.key+':'+job.number;globalThis.__qaBoundedQueueStatus.running.push(label);
  try{
   const prep=await h.page.evaluate(async job=>{
    if(currentProjectId!==job.expected||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Exact paused editable copy required');const [ci,si]=job.number.split('.').map(n=>Number(n)-1),c=chapters[ci],s=c.sections[si];
    if(JSON.stringify(s)!==JSON.stringify(job.section))throw Error('Section changed before bounded edit');
    const currentIdentity=reportCandidateInputIdentity();let text=s.qaBoundedAiRevision?.currentInputIdentity===currentIdentity?(s.qaBoundedAiRevision.candidateText||s.content||s.editedHtml):'';
    text=text||s.pendingRevision?.after||s.editedHtml||s.content||job.derived?.text||'';if(!text)throw Object.assign(Error('No preserved complete body; initial generation required'),{code:'initial-generation-required'});
    const preservedInputText=text;if(!/^\s*<(?:h[1-6]|p|figure|table|div)\b/i.test(text))text=renderContent(text);
    const contract=reportSectionContract(c,s),sourceIdentity=currentIdentity,paras=[],tableSpans=[...text.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(m=>[m.index,m.index+m[0].length]);
    const normalized=x=>{const d=document.createElement('div');d.innerHTML=x;return d.textContent.replace(/\s+/g,' ').trim();};
    const matches=[...text.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)];
    if(matches.length)for(const m of matches){if(tableSpans.some(([a,b])=>m.index>=a&&m.index<b)||/data-report-(?:program|gap|basis|table|document|financial)/.test(m[0]))continue;const open=m[0].match(/^<p\b[^>]*>/i)[0],close='</p>';paras.push({id:'p'+paras.length,start:m.index,end:m.index+m[0].length,original:m[0],text:normalized(m[0]),html:true,open,close});}
    else{let start=0;for(const part of text.split(/\n\s*\n/)){const at=text.indexOf(part,start);start=at+part.length;if(!part.trim()||/^\s*(?:#{1,6}|<|\[TABLE)/.test(part))continue;paras.push({id:'p'+paras.length,start:at,end:start,original:part,text:part.trim(),html:false});}}
    const exact=job.semantic?.blocks?.map(x=>x.paragraph)||[],regex=job.pattern?new RegExp(job.pattern,'i'):null;
    const paragraphs=paras.filter(p=>exact.some(x=>normalized(x)===p.text)||regex?.test(p.text)||ReportFinancialTables.inspectCurrentAssumptions(p.text,contract.currentAssumptions).some(i=>i.severity==='error'));
    const issues=ReportCompletionContract.inspect(text,contract).issues.filter(i=>i.severity==='error'),headings=[],tables=[];
    for(const issue of issues){if(['heading-missing','heading-analysis-missing','heading-structure-missing'].includes(issue.code)){
      const title=String(issue.message).replace(/^.*?[“「]/,'').replace(/[”」].*$/,'');const req=contract.requiredHeadings.find(x=>title.includes(x.text)||issue.message.includes(x.text));if(!req||headings.some(x=>x.text===req.text))continue;
      const hs=[...text.matchAll(/<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi)],existing=hs.find(m=>normalized(m[0]).replace(/^\d+(?:\.\d+)*\s*/,'').includes(req.text));let position=text.length;
      if(existing)position=existing.index+existing[0].length;else{const idx=contract.requiredHeadings.indexOf(req),next=contract.requiredHeadings.slice(idx+1).map(r=>hs.find(m=>normalized(m[0]).includes(r.text))).find(Boolean);if(next)position=next.index;}
      headings.push({id:'h'+headings.length,text:req.text,level:req.level||3,existing:!!existing,position});
    }else if(issue.code==='missing-table'){
      const req=contract.requiredTables.find(t=>issue.message.includes(t.title));if(req&&!/财务|资金|投资|现金|收支|敏感|参数|成本|收益|销售|收入/.test(req.title)&&!tables.some(x=>x.title===req.title))tables.push({id:'t'+tables.length,title:req.title,headers:req.headers?.length?req.headers:['需求或客群','产品匹配','条件及边界']});
    }}
    const plan={paragraphs,headings,tables},unknown=issues.filter(i=>!['current-assumption-conflict','heading-missing','heading-analysis-missing','missing-table','structured-json-invalid','structured-heading-invalid','structure-patch-invalid','structure-patch-plan-unavailable','gap-judgment-count'].includes(i.code));
    return {text,preservedInputText,plan,contract,sourceIdentity,originalSection:ProjectWorkflow.clone(s),issues,unknown,currentAssumptions:reportCurrentAssumptionsContext(),digest:buildCalcDigest(),materials:kbEntries.map(x=>'【'+(x.name||x.title||x.id)+'】\n'+String(x.text||x.content||'')).join('\n\n').slice(0,60000)};
   },{...job,expected:IDS[job.key],pattern:PATTERNS[job.key][job.number]?.source});
   const beforeFile=await archive(job.key,'bounded-before-'+job.number,{...job,...prep,originalAiReceiptUnchanged:true});
   if(!prep.plan.paragraphs.length&&!prep.plan.headings.length&&!prep.plan.tables.length){
    if(job.derived?.technicalPassed&&!job.semantic&&!job.extra){
     const result=await commit(job.key,()=>admit(h,job,prep,prep.text,{version:'zero-ai-current-inspection-v1',beforeFile,newPaidAiCalls:0,originalAiReceiptUnchanged:true},checkpoint));receipts.push({...result,key:job.key,number:job.number});
    }else receipts.push({key:job.key,number:job.number,status:'blocked',error:{code:'bounded-target-unavailable',issues:prep.issues},beforeFile});continue;
   }
   if(prep.plan.paragraphs.length>12)throw Object.assign(Error('Too many paragraph targets; retain original and split authorized scope'),{code:'bounded-target-count'});
   const prompt={section:job.number,instruction:job.extra,independentFindings:job.findings,targets:prep.plan,currentAssumptions:prep.currentAssumptions,financialDigest:prep.digest,materials:prep.materials,originalContext:prep.text};
   const sys='你是可研报告精确段落编辑。仅对targets列出的原段落、空/缺标题和定性表输出补丁，未授权内容绝不能改。返回严格JSON：{"replacements":[{"id":"p0","text":"替换完整段落"}],"additions":[{"id":"h0","text":"该业务标题下的实质分析段"}],"tables":[{"id":"t0","headers":["严格原给列头"],"rows":[["纯定性文字"]]}]}。三个数组都必需，无目标则空数组。每个目标恰一次。正文单段无换行、HTML、标题标记，实质分析直接写不说本节主要讨论。不增新事实、不把资料待核转已核实，当前情景与历史原材料明确区分；所有冻结表无权改变。仅根据精确问题修复错误并保留该段有效分析。'+(job.key==='longgang'?'龙岗篇幅已超，替换段落应去除重复套话、保留因果/比较/风险/证据边界，尽量比原段精炼约两成，不遗漏实质分类。':'税务局保留既有分析深度，不做摘要压缩。');
   globalThis.__qaBoundedQueueStatus.newPaidAiCalls++;
   const response=await h.page.evaluate(async({expected,sourceIdentity,section,system,user})=>{if(currentProjectId!==expected||reportCandidateInputIdentity()!==sourceIdentity||!projectCanEdit())throw Error('Input changed before actual paid paragraph edit');const r=await fetch('/api/generate',{method:'POST',headers:{...authHeaders(),'content-type':'application/json'},body:JSON.stringify({kind:'batch',stream:false,projectId:expected,system,messages:[{role:'user',content:user}],max_tokens:4000,response_format:{type:'json_object'}}),signal:AbortSignal.timeout(180000)});const payload=await r.json();return {httpStatus:r.status,payload,requestKind:'bounded-paragraph-edit',section,at:new Date().toISOString()};},{expected:IDS[job.key],sourceIdentity:prep.sourceIdentity,section:job.number,system:sys,user:JSON.stringify(prompt)});
   const rawFile=await archive(job.key,'bounded-raw-'+job.number,response);if(response.httpStatus!==200)throw Object.assign(Error(response.payload.error||'Actual AI request failed'),{code:'bounded-ai-http',rawFile});
   const raw=(response.payload.content||[]).filter(x=>x.type==='text').map(x=>x.text).join(''),parsed=JSON.parse(raw),normalized=normalizeBoundedResponse(prep.plan,parsed),edited=applyBoundedEdits(prep.text,prep.plan,normalized.response),afterFile=await archive(job.key,'bounded-after-'+job.number,{...edited,plan:prep.plan,normalizations:normalized.normalizations,responseFile:rawFile,beforeFile,originalTaskId:job.section.executionTask?.id,sourceIdentity:prep.sourceIdentity,notOriginalAiReceipt:true});
   const result=await commit(job.key,()=>admit(h,job,prep,edited.after,{version:'actual-ai-bounded-paragraph-revision-v1',beforeFile,rawFile,afterFile,beforeSha256:edited.beforeSha256,afterSha256:edited.afterSha256,newPaidAiCalls:1,originalTaskId:job.section.executionTask?.id,originalAiReceiptUnchanged:true,factsVerified:false},checkpoint));
   receipts.push({...result,key:job.key,number:job.number,rawFile,afterFile});
  }catch(e){const file=await archive(job.key,'bounded-error-'+job.number,{code:e.code||'bounded-repair-failed',message:e.message,stack:e.stack,rawFile:e.rawFile,originalSection:job.section});receipts.push({key:job.key,number:job.number,status:'blocked',file,error:{code:e.code||'bounded-repair-failed',message:e.message}});}
  finally{globalThis.__qaBoundedQueueStatus.running=globalThis.__qaBoundedQueueStatus.running.filter(x=>x!==label);globalThis.__qaBoundedQueueStatus.finished.push(receipts.at(-1));globalThis.__qaBoundedQueueStatus.queued=jobs.length;console.log(JSON.stringify({event:'bounded-finish',...receipts.at(-1)}));}
 }}
 await Promise.all(Array.from({length:4},worker));
 const file=await archive('tax','bounded-shared-queue-receipt',{at:new Date().toISOString(),receipts,remainingPaidRunning:0});return {file,receipts};
 }finally{globalThis.__qaBoundedQueueRunning=false;}
}
// Resume only genuinely empty first-generation sections in the existing browser.
// Existing bodies/candidates and the current-detail summary barrier are retained.
export async function browserFinalizeReviewedDetails({expected,details}){
 if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit()||!Array.isArray(details)||!details.length)throw Error('Exact reviewed detail snapshot required');
 const before=JSON.stringify(chapters),identity=reportCandidateInputIdentity(),ownedKeys=[];
 const assertCurrent=async()=>{if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit()||reportCandidateInputIdentity()!==identity||JSON.stringify(chapters)!==before)throw Error('Reviewed details/source changed before finalization');};
 for(const row of details){const[ci,si]=row.number.split('.').map(n=>Number(n)-1),c=chapters[ci],s=c?.sections[si];if(!s||ReportArgument.contract(c.name,s.t).summary||JSON.stringify(s)!==JSON.stringify(row.section))throw Error('Reviewed detail identity changed');ownedKeys.push(c.name+' / '+s.t);}
 const actualDetails=chapters.flatMap(c=>c.sections.filter(s=>!ReportArgument.contract(c.name,s.t).summary));if(actualDetails.length!==details.length||new Set(ownedKeys).size!==details.length)throw Error('Every current detail requires exact review evidence');
 if(typeof reportFinalizeInitialDeliveryDetails!=='function')throw Error('Production detail finalizer unavailable');
 const finalized=await reportFinalizeInitialDeliveryDetails({ownedKeys,assertCurrent});
 if(!finalized||JSON.stringify([...(finalized.sectionKeys||[])].sort())!==JSON.stringify([...ownedKeys].sort()))throw Error('Production finalizer did not verify every reviewed detail');
 const strip=value=>{const copy=JSON.parse(JSON.stringify(value));for(const chapter of copy)for(const section of chapter.sections)if(ownedKeys.includes(chapter.name+' / '+section.t)){delete section.completionContract;delete section.completionQuality;}return JSON.stringify(copy);};
 const after=JSON.stringify(chapters);
 const assertSavedCurrent=()=>{if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit()||reportCandidateInputIdentity()!==identity||JSON.stringify(chapters)!==after||strip(chapters)!==strip(JSON.parse(before)))throw Error('Finalized body/task/source changed; no generation permitted');};
 assertSavedCurrent();
 const saved=await persistReportDraft();assertSavedCurrent();if(!saved?.ok||!saved.remote)throw Error('Finalized contracts retained for recovery; remote save failed; no generation permitted');
 const response=await fetch('/api/projects?id='+encodeURIComponent(expected),{headers:authHeaders()});assertSavedCurrent();if(!response.ok)throw Error('Finalized contract remote verification failed');const payload=await response.json();assertSavedCurrent();
 if(payload.project?.id!==expected)throw Error('Finalized remote project identity changed');
 const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
 const persistedChapters=value=>{if(!Array.isArray(value))return value;const copy=JSON.parse(JSON.stringify(value));for(const chapter of copy)for(const section of chapter.sections||[])for(const field of ['generationFailure','candidateGenerationFailure'])if(section[field]===null)delete section[field];return stable(copy);};
 const data=payload.project.data?.draft||payload.project.data,remote=data?.chapters,persistable=buildDraftData().chapters;
 if(JSON.stringify(persistedChapters(remote))!==JSON.stringify(persistedChapters(persistable)))throw Error('Finalized remote chapters differ; no generation permitted');
 return {at:new Date().toISOString(),identity,chaptersSnapshot:after,finalized,persisted:saved,remoteSaveVerified:true,details:details.map(row=>{const[ci,si]=row.number.split('.').map(n=>Number(n)-1),s=chapters[ci].sections[si];return {number:row.number,sectionKey:chapters[ci].name+' / '+s.t,content:s.content||'',editedHtml:s.editedHtml||null,executionTask:s.executionTask||null,completionContract:s.completionContract,completionQuality:s.completionQuality||null};})};
}
export async function runMissingGenerationQueue(harnesses,checkpoint,{keys}={}){
 if(globalThis.__qaBoundedQueueRunning||globalThis.__qaTargetedBatchRunning||globalThis.__qaSourceCorrectionRunning||globalThis.__qaMissingQueueRunning)throw Error('One shared paid queue only');
 globalThis.__qaMissingQueueRunning=true;const receipts=[],jobs=[],finalizedGuards=[];
 try{
  for(const [key,h]of Object.entries(harnesses)){
   if(h.target.id!==IDS[key])throw Error('Exact isolated copy required');
   const rows=await h.page.evaluate(expected=>{if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Exact paused editable copy required');return chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({number:(ci+1)+'.'+(si+1),summary:ReportArgument.contract(c.name,s.t).summary,hasBody:reportHasVisibleBody(s),pending:!!s.pendingRevision,section:JSON.parse(JSON.stringify(s))})));},IDS[key]);
   const summaries=rows.filter(row=>row.summary&&!row.hasBody&&!row.pending&&(!keys||keys.includes(key+':'+row.number))),details=rows.filter(row=>!row.summary);
   if(summaries.length&&details.every(row=>checkpoint.sections[key+':'+row.number]?.status==='passed')){
    if(rows.length!==43||details.length!==34)throw Error('Exact complete 34-detail/43-section report required before summaries');
    const artifacts=[];
    for(const row of details){const file=path.join(OUT,key,'sections',row.number+'.json'),raw=await fs.readFile(file,'utf8'),artifact=JSON.parse(raw),actual=row.section.editedHtml||row.section.content||'',proof=artifact.qaBoundedAiRevision;
     if(!actual||row.pending||artifact.key!==key||artifact.number!==row.number||artifact.sectionKey!==row.section.completionContract?.sectionKey||artifact.status!=='passed'||(artifact.editedHtml||artifact.content||'')!==actual||JSON.stringify(artifact.executionTask||null)!==JSON.stringify(row.section.executionTask||null)||proof?.version!=='independent-semantic-reviewed-actual-v1'||proof.semanticReviewRequired!==false||proof.reviewedBodySha256!==digest(actual))throw Error('Exact full-body review artifact required before summaries: '+key+':'+row.number);
     artifacts.push({row,file,raw,artifact});
    }
    const beforeFile=await archive(key,'summary-detail-finalization-before',{details:artifacts.map(({row,file,raw})=>({number:row.number,section:row.section,artifactFile:file,artifactSha256:digest(raw)})),newPaidAiCalls:0});
    const result=await h.page.evaluate(browserFinalizeReviewedDetails,{expected:IDS[key],details:details.map(({number,section})=>({number,section}))});
    const receiptFile=await archive(key,'summary-detail-finalization-after',{beforeFile,...result,newPaidAiCalls:0});
    finalizedGuards.push({key,identity:result.identity,chaptersSnapshot:result.chaptersSnapshot});
    if(!result.remoteSaveVerified||result.details.length!==details.length)throw Error('Finalized remote verification incomplete');
    for(const {row,file,raw,artifact}of artifacts){const current=result.details.find(detail=>detail.number===row.number);if(!current||(current.editedHtml||current.content||'')!==(row.section.editedHtml||row.section.content||'')||JSON.stringify(current.executionTask)!==JSON.stringify(row.section.executionTask||null))throw Error('Finalized artifact body/task mismatch');if(await fs.readFile(file,'utf8')!==raw)throw Error('Review artifact changed during finalization');await archive(key,'summary-detail-artifact-before-'+row.number,artifact);const updated=JSON.stringify({...artifact,completionContract:current.completionContract,completionQuality:current.completionQuality,qaDetailFinalization:{receiptFile,beforeFile,reviewIdentityPreserved:true,bodySha256:digest(current.editedHtml||current.content||''),newPaidAiCalls:0}},null,2);await fs.writeFile(file,updated);if(await fs.readFile(file,'utf8')!==updated)throw Error('Finalized artifact readback differs');checkpoint.sections[key+':'+row.number]={...checkpoint.sections[key+':'+row.number],detailFinalizationReceipt:receiptFile};}
    const checkpointText=JSON.stringify(checkpoint,null,2),checkpointFile=path.join(OUT,'checkpoint.json');await fs.writeFile(checkpointFile,checkpointText);if(await fs.readFile(checkpointFile,'utf8')!==checkpointText)throw Error('Finalized checkpoint readback differs');
    console.log(JSON.stringify({event:'summary-detail-finalized',key,details:result.details.length,remoteSaveVerified:true,newPaidAiCalls:0}));
   }
   for(const row of rows){if(keys&&!keys.includes(key+':'+row.number)||row.hasBody||row.pending)continue;if(row.summary&&rows.some(r=>!r.summary&&checkpoint.sections[key+':'+r.number]?.status!=='passed'))continue;jobs.push({...row,key});}
  }
  for(const guard of finalizedGuards)await harnesses[guard.key].page.evaluate(({expected,identity,chaptersSnapshot})=>{if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit()||reportCandidateInputIdentity()!==identity||JSON.stringify(chapters)!==chaptersSnapshot)throw Error('Finalized detail CAS changed before shared queue; no generation permitted');},{expected:IDS[guard.key],...guard});
  globalThis.__qaMissingQueueStatus={at:new Date().toISOString(),queued:jobs.length,running:[],finished:[]};
  async function worker(){while(jobs.length){const row=jobs.shift(),h=harnesses[row.key],id=row.key+':'+row.number;globalThis.__qaMissingQueueStatus.running.push(id);
   try{
    checkpoint.sections[id]={...checkpoint.sections[id],status:'running',startedAt:new Date().toISOString()};await fs.writeFile(path.join(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2));
    const result=await h.page.evaluate(async({expected,key,number})=>{
     if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Exact paused editable copy required');const[ci,si]=number.split('.').map(n=>Number(n)-1),c=chapters[ci],s=c.sections[si],sectionKey=c.name+' / '+s.t;
     if(reportHasVisibleBody(s)||s.pendingRevision)throw Error('Existing body/candidate is protected');let error=null;
     const ok=await window.__qaOriginalAirDrive(c,s,si,{autoRepair:true,onFail:e=>{error={code:e.code||'initial-generation-failed',message:String(e.message||e),quality:e.quality||e.resultQuality||null};}});
     const saved=await persistReportDraft();let task=null;if(s.executionTask?.id){try{const r=await fetch('/api/reportexecution?id='+encodeURIComponent(s.executionTask.id),{headers:authHeaders()});task={httpStatus:r.status,...await r.json()};}catch(e){task={readError:e.message};}}
     if(!saved.ok||!saved.remote)error={code:'generation-save-failed',previous:error};
     return {key,number,sectionKey,at:new Date().toISOString(),status:ok&&!error?'semantic-review-pending':'failed',content:s.content||'',editedHtml:s.editedHtml||null,pendingRevision:s.pendingRevision||null,executionTask:s.executionTask||null,completionContract:s.completionContract||null,generationFailure:s.generationFailure||null,error,task,persisted:saved,qaInitialResume:{version:'existing-production-first-generation-v1',semanticReviewRequired:true,factsVerified:false}};
    },{expected:IDS[row.key],key:row.key,number:row.number});
    const file=path.join(OUT,row.key,'sections',row.number+'.json');let previous={};try{previous=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}await archive(row.key,'initial-resume-before-'+row.number,previous);await fs.writeFile(file,JSON.stringify(result,null,2));checkpoint.sections[id]={...checkpoint.sections[id],status:result.status,at:result.at,file,taskId:result.executionTask?.id||null,error:result.error};receipts.push({key:row.key,number:row.number,status:result.status,file,taskId:result.executionTask?.id||null,error:result.error});
   }catch(e){receipts.push({key:row.key,number:row.number,status:'failed',error:{code:e.code||'initial-resume-failed',message:e.message}});checkpoint.sections[id]={...checkpoint.sections[id],status:'failed',error:receipts.at(-1).error};}
   finally{await fs.writeFile(path.join(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2));globalThis.__qaMissingQueueStatus.running=globalThis.__qaMissingQueueStatus.running.filter(x=>x!==id);globalThis.__qaMissingQueueStatus.finished.push(receipts.at(-1));globalThis.__qaMissingQueueStatus.queued=jobs.length;console.log(JSON.stringify({event:'initial-resume-finish',...receipts.at(-1)}));}
  }}
  await Promise.all(Array.from({length:4},worker));const file=await archive('tax','initial-resume-batch',{at:new Date().toISOString(),receipts});return {file,receipts};
 }finally{globalThis.__qaMissingQueueRunning=false;}
}
export async function browserBoundedAdmission({expected,number,prep,text,proof}){
  if(currentProjectId!==expected||reportCandidateInputIdentity()!==prep.sourceIdentity||!projectCanEdit())throw Error('Current source/permission changed; response preserved');const[ci,si]=number.split('.').map(n=>Number(n)-1),c=chapters[ci],s=c.sections[si],expectedSection=prep.expectedCurrentSection||prep.originalSection;if(JSON.stringify(s)!==JSON.stringify(expectedSection))throw Error('Original body/candidate changed; response preserved');
  await ensureReportTableTemplates();
  if(currentProjectId!==expected||!projectCanEdit()||reportCandidateInputIdentity()!==prep.sourceIdentity||chapters[ci]!==c||c.sections[si]!==s||JSON.stringify(s)!==JSON.stringify(expectedSection))throw Error('Source changed while preparing templates; response preserved');
  const sectionKey=c.name+' / '+s.t,html=/^\s*<(?:h[1-6]|p|figure|table|div)\b/i.test(text)?text:renderContent(text),plan=reportCompletionPlan({sectionKey,html});let contract=plan.sections.find(x=>x.sectionKey===sectionKey);if(!contract)throw Error('Projected current section contract missing');
  let originalContract,originalContractDiagnostic=null;
  try{originalContract=reportSectionContract(c,s);}catch(error){
    // An exact, byte-bound structure recovery can repair an adopted order
    // conflict. The complete projected plan has already passed the same strict
    // structure checks; no other failure or repair mode may bypass them.
    if(proof.version!=='independent-exact-structure-recovery-v1'||proof.untargetedBytesPreserved!==true||!/^业务标题顺序冲突：/.test(String(error.message||''))||s.completionContract?.sectionKey!==sectionKey)throw error;
    originalContract=ProjectWorkflow.clone(s.completionContract);
    originalContractDiagnostic={code:'prior-adopted-structure-order-conflict',message:String(error.message),savedContractPreserved:true,projectedPlanStrictlyChecked:true};
  }
  const assertBasisCurrent=()=>{if(currentProjectId!==expected||!projectCanEdit()||reportCandidateInputIdentity()!==prep.sourceIdentity||chapters[ci]!==c||c.sections[si]!==s||JSON.stringify(s)!==JSON.stringify(expectedSection))throw Error('Source changed while verifying basis materials; response preserved');};
  if(contract.requirements?.basis){
    if(typeof reportBasisCatalogFor!=='function'||typeof reportVerifyBasisMaterials!=='function'||typeof ReportCompletionContract.bindBasisCatalog!=='function')throw Error('Current basis catalog verification is unavailable; response preserved');
    const catalog=await reportBasisCatalogFor(contract);assertBasisCurrent();
    if(!catalog?.items?.length)throw Error('Current basis catalog is empty; response preserved');
    contract=await ReportCompletionContract.bindBasisCatalog(contract,catalog,expected+':'+sectionKey);assertBasisCurrent();
    await reportVerifyBasisMaterials(contract);assertBasisCurrent();
  }
  const source={context:reportFinancialContext(),sectionKey:contract.sectionKey,requiredTables:contract.requiredTables};const entries=reportCompletionEntries({sectionKey:contract.sectionKey,html},source);const actual=entries.find(e=>e.key===contract.sectionKey).text;
  contract=await ReportCompletionContract.bindDocumentReferences(contract,entries);if(/<table\b/i.test(actual))contract=await ReportCompletionContract.bindFrozenTables(contract,actual,'qa-bounded-derived:'+proof.version+':financial='+encodeURIComponent(JSON.stringify(reportFinancialIdentity())));contract=await ReportCompletionContract.bindProgramProse(contract,actual);
  const quality=ReportCompletionContract.inspect(actual,contract),financialIssues=reportFinancialCandidateIssues({after:actual,completionContract:contract,completionFinancialSource:source.binding||null,completionInputPlanId:source.sourceIdentity});
  const review=ReportCompletionContract.reviewDocument(entries,{...plan,sections:plan.sections.map(x=>x.sectionKey===contract.sectionKey?contract:x)}),refs=(review.reviews.find(x=>x.key===contract.sectionKey)?.issues||[]).filter(i=>i.severity==='error'&&/^(?:bound-)?reference-/.test(i.code)),errors=[...quality.issues,...financialIssues,...refs].filter(i=>i.severity==='error');
  if(currentProjectId!==expected||!projectCanEdit()||reportCandidateInputIdentity()!==prep.sourceIdentity||JSON.stringify(s)!==JSON.stringify(expectedSection))throw Error('Source changed during final inspection');
  const semanticReviewRequired=proof.semanticReviewRequired===true||proof.newPaidAiCalls>0;
  s.qaBoundedAiRevision={...proof,currentInputIdentity:prep.sourceIdentity,allocationReceipt:{version:'current-composed-candidate-budget-v1',originalContract:ProjectWorkflow.clone(originalContract),...(originalContractDiagnostic?{originalContractDiagnostic}:{}),projectedPlanId:plan.planId||null,tableAllocation:ProjectWorkflow.clone(plan.tableAllocation||null),notOriginalAiReceipt:true},currentContract:ProjectWorkflow.clone(contract),quality:ProjectWorkflow.clone(quality),technicalPassed:!errors.length,semanticReviewRequired,factsVerified:false};
  if(errors.length){
    s.qaBoundedAiRevision.candidateText=actual;
    // qaBoundedAiRevision is test-run metadata, not a persisted production field.
    // Preserve the unaccepted body in the existing draft candidate as well so
    // reopening the test copy never silently falls back to an earlier candidate.
    s.pendingRevision={...(s.pendingRevision||{}),after:actual,qaDerivedCandidate:{version:proof.version,originalTaskId:s.executionTask?.id||null,afterFile:proof.afterFile||null,notOriginalAiReceipt:true,notAccepted:true}};
  }else{if(s.pendingRevision)s.qaPriorCandidate=ProjectWorkflow.clone(s.pendingRevision);s.content=actual;s.editedHtml=null;s.generated=true;s.completionContract=contract;s.quality=quality;s.completionQuality=ProjectWorkflow.clone(quality);delete s.pendingRevision;}
  const saved=await persistReportDraft();if(!saved.ok||!saved.remote)throw Error('Edited body/candidate retained; remote save failed');
  return {status:errors.length?'failed':semanticReviewRequired?'semantic-review-pending':'passed',content:s.content||'',pendingRevision:s.pendingRevision||null,executionTask:s.executionTask,completionContract:s.completionContract,completionQuality:s.completionQuality||null,qaBoundedAiRevision:s.qaBoundedAiRevision,quality,errors,persisted:saved};
}
async function admit(h,job,prep,text,proof,checkpoint,reviewRow){
 const checked=await h.page.evaluate(browserBoundedAdmission,{expected:IDS[job.key],number:job.number,prep,text,proof});
 const file=path.join(OUT,job.key,'sections',job.number+'.json'),id=job.key+':'+job.number;let prior={};try{prior=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}await archive(job.key,'bounded-section-before-'+job.number,prior);const merged=mergeAdmissionMetadata({prior,checkpoint:checkpoint.sections[id],checked,proof,reviewRow,id,file,at:new Date().toISOString()});await fs.writeFile(file,JSON.stringify(merged.artifact,null,2));checkpoint.sections[id]=merged.checkpoint;await fs.writeFile(path.join(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2));return {status:checked.status,file,errors:checked.errors.map(x=>({code:x.code,message:x.message})),originalTaskId:checked.executionTask?.id};
}
export async function runExactStructureBatch(harnesses,checkpoint,proposalFile){
 if(globalThis.__qaBoundedQueueRunning||globalThis.__qaTargetedBatchRunning||globalThis.__qaSourceCorrectionRunning||globalThis.__qaMissingQueueRunning)throw Error('Active queue must finish before exact structure recovery');
 const absolute=path.resolve(proposalFile);if(!absolute.startsWith(OUT+path.sep))throw Error('Proposal must remain inside isolated snapshot');const raw=await fs.readFile(absolute,'utf8'),proposal=JSON.parse(raw),receipts=[];
 globalThis.__qaSourceCorrectionRunning=true;
 try{for(const row of proposal.rows||[]){const[key,number]=row.key.split(':'),h=harnesses[key];try{if(!h||h.target.id!==IDS[key]||!/^\d+\.\d+$/.test(number))throw Error('Exact isolated section required');const prep=await h.page.evaluate(({expected,number})=>{if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Exact paused editable copy required');const[ci,si]=number.split('.').map(n=>Number(n)-1),s=chapters[ci].sections[si];return {text:s.qaBoundedAiRevision?.candidateText||s.pendingRevision?.after||s.editedHtml||s.content||'',sourceIdentity:reportCandidateInputIdentity(),originalSection:ProjectWorkflow.clone(s),taskId:s.executionTask?.id||null};},{expected:IDS[key],number});if(prep.taskId!==row.taskId)throw Error('Original task identity changed');const beforeFile=await archive(key,'exact-structure-before-'+number,{...prep,proposalFile:absolute,proposalSha256:digest(raw)}),edited=applyExactStructureOperations(prep.text,row),afterFile=await archive(key,'exact-structure-after-'+number,{...edited,beforeFile,operations:row.operations,newPaidAiCalls:0,notOriginalAiReceipt:true});const result=await admit(h,{key,number},prep,edited.after,{version:'independent-exact-structure-recovery-v1',beforeFile,afterFile,proposalFile:absolute,proposalSha256:digest(raw),beforeSha256:edited.beforeSha256,afterSha256:edited.afterSha256,operationCount:edited.operationCount,newPaidAiCalls:0,semanticReviewRequired:true,originalAiReceiptUnchanged:true,untargetedBytesPreserved:true,factsVerified:false},checkpoint);receipts.push({key,number,...result,operationCount:edited.operationCount,beforeFile,afterFile});}catch(error){receipts.push({key,number,status:'blocked',error:{code:'exact-structure-recovery-blocked',message:error.message}});}console.log(JSON.stringify({event:'exact-structure-recovery',...receipts.at(-1)}));}
 const key=(proposal.rows?.[0]?.key||'tax:').split(':')[0],file=await archive(key,'exact-structure-batch',{at:new Date().toISOString(),proposalFile:absolute,proposalSha256:digest(raw),newPaidAiCalls:0,receipts});return {file,newPaidAiCalls:0,completedOperations:receipts.reduce((n,r)=>n+(r.operationCount||0),0),receipts};}finally{globalThis.__qaSourceCorrectionRunning=false;}
}
export async function acceptReviewedBodies(harnesses,checkpoint,reviewFile){
 if(globalThis.__qaBoundedQueueRunning||globalThis.__qaTargetedBatchRunning||globalThis.__qaSourceCorrectionRunning||globalThis.__qaMissingQueueRunning)throw Error('Active queue must finish before semantic acceptance');
 const absolute=path.resolve(reviewFile);if(!absolute.startsWith(OUT+path.sep))throw Error('Review must remain inside isolated snapshot');
 const reviewRaw=await fs.readFile(absolute,'utf8'),review=JSON.parse(reviewRaw),receipts=[];
 for(const row of review.rows||[]){if(row.semanticStatus!=='acceptable-full-body-at-bound-sha'||!row.exactActualMatch)continue;const[key,number]=row.key.split(':'),h=harnesses[key];
  try{if(!h||h.target.id!==IDS[key]||!/^[a-f0-9]{64}$/.test(row.actualBodySha256)||!/^\d+\.\d+$/.test(number))throw Error('Exact reviewed body identity required');
   const prep=await h.page.evaluate(({expected,number})=>{if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Exact paused editable copy required');const[ci,si]=number.split('.').map(n=>Number(n)-1),s=chapters[ci].sections[si];return {sourceIdentity:reportCandidateInputIdentity(),originalSection:ProjectWorkflow.clone(s),text:s.editedHtml||s.content||'',taskId:s.executionTask?.id||null};},{expected:IDS[key],number});
   if(digest(prep.text)!==row.actualBodySha256||prep.taskId!==row.taskId)throw Error('Reviewed actual body/task changed');
   const result=await admit(h,{key,number},prep,prep.text,{version:'independent-semantic-reviewed-actual-v1',reviewFile:absolute,reviewFileSha256:digest(reviewRaw),reviewedBodySha256:row.actualBodySha256,reviewedTaskId:row.taskId,reviewedAt:row.readAt,newPaidAiCalls:0,semanticReviewRequired:false,originalAiReceiptUnchanged:true,factsVerified:false},checkpoint,row);
   receipts.push({key,number,...result});console.log(JSON.stringify({event:'reviewed-actual-admission',...receipts.at(-1)}));
  }catch(error){receipts.push({key,number,status:'blocked',error:{code:'reviewed-body-admission-blocked',message:error.message}});}
 }
 const file=await archive('tax','independent-reviewed-admission-batch',{at:new Date().toISOString(),reviewFile:absolute,newPaidAiCalls:0,receipts});return {file,newPaidAiCalls:0,receipts};
}
export async function revalidateRenderedCandidates(harnesses,checkpoint,{keys}={}){
 if(globalThis.__qaBoundedQueueRunning||globalThis.__qaTargetedBatchRunning||globalThis.__qaSourceCorrectionRunning||globalThis.__qaMissingQueueRunning)throw Error('Active queue must finish before body revalidation');
 const receipts=[];
 for(const[key,h]of Object.entries(harnesses)){
  if(h.target.id!==IDS[key])throw Error('Exact isolated copy required');
  const rows=await h.page.evaluate(expected=>{if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Exact paused editable copy required');return chapters.flatMap((c,ci)=>c.sections.map((s,si)=>({number:(ci+1)+'.'+(si+1),summary:ReportArgument.contract(c.name,s.t).summary,sourceIdentity:reportCandidateInputIdentity(),originalSection:ProjectWorkflow.clone(s),text:s.qaBoundedAiRevision?.candidateText||s.pendingRevision?.after||s.editedHtml||s.content||''})));},IDS[key]);
  for(const row of rows){if(row.summary||!row.text||keys&&!keys.includes(key+':'+row.number)||checkpoint.sections[key+':'+row.number]?.status==='passed')continue;
   try{const recovered=restoreEscapedReportHtml(row.text),beforeFile=await archive(key,'render-revalidation-before-'+row.number,row),afterFile=await archive(key,'render-revalidation-derived-'+row.number,{beforeFile,text:recovered.text,beforeSha256:digest(row.text),afterSha256:digest(recovered.text),unescapeRounds:recovered.rounds,newPaidAiCalls:0,notOriginalAiReceipt:true});
    const result=await admit(h,{key,number:row.number},row,recovered.text,{version:'exact-rendered-body-revalidation-v1',beforeFile,afterFile,previousDerivation:row.originalSection.qaBoundedAiRevision||null,beforeSha256:digest(row.text),afterSha256:digest(recovered.text),unescapeRounds:recovered.rounds,newPaidAiCalls:0,semanticReviewRequired:true,originalAiReceiptUnchanged:true,factsVerified:false},checkpoint);
    receipts.push({key,number:row.number,unescapeRounds:recovered.rounds,...result});
   }catch(error){receipts.push({key,number:row.number,status:'blocked',error:{code:'render-revalidation-blocked',message:error.message}});}
  }
 }
 const file=await archive('tax','render-revalidation-batch',{at:new Date().toISOString(),newPaidAiCalls:0,receipts});return {file,newPaidAiCalls:0,receipts};
}
export async function runSourceCorrectionBatch(harnesses,checkpoint,proposalFile){
 if(globalThis.__qaBoundedQueueRunning||globalThis.__qaTargetedBatchRunning||globalThis.__qaSourceCorrectionRunning)throw Error('Cannot source-patch while an edit queue is running');
 const absolute=path.resolve(proposalFile);if(!absolute.startsWith(OUT+path.sep))throw Error('Proposal must remain inside the isolated acceptance snapshot');
 const proposal=JSON.parse(await fs.readFile(absolute,'utf8'));if(!Array.isArray(proposal.corrections))throw Error('Exact correction proposal required');
 globalThis.__qaSourceCorrectionRunning=true;const receipts=[];
 try{for(const keyNumber of [...new Set(proposal.corrections.map(x=>x.key))]){
  const [key,number]=keyNumber.split(':'),h=harnesses[key],corrections=proposal.corrections.filter(x=>x.key===keyNumber);if(!h||h.target.id!==IDS[key]||!/^\d+\.\d+$/.test(number))throw Error('Exact isolated section required');
  try{
   const prep=await h.page.evaluate(({expected,number,corrections})=>{
    if(currentProjectId!==expected||!window.__qaDispatchPaused||!projectCanEdit())throw Error('Exact paused editable copy required');
    const[ci,si]=number.split('.').map(n=>Number(n)-1),s=chapters[ci].sections[si],sourceIdentity=reportCandidateInputIdentity();
    const preserved=s.qaBoundedAiRevision?.candidateText||s.pendingRevision?.after||s.editedHtml||s.content||'';if(!preserved)throw Error('Source patch requires a preserved complete body');
    const text=/^\s*<(?:h[1-6]|p|figure|table|div)\b/i.test(preserved)?preserved:renderContent(preserved),box=document.createElement('div');box.innerHTML=text;
    const norm=x=>String(x).replace(/\s+/g,' ').trim(),nodes=[...box.querySelectorAll('p,td,th')],changes=[],alreadyApplied=[];
    const groups=[...new Set(corrections.map(x=>x.variantOf||x.id))];
    for(const group of groups){
     const variants=corrections.filter(x=>(x.variantOf||x.id)===group).slice().reverse();let correction,matches;
     for(const variant of variants){const found=nodes.filter(node=>norm(node.textContent)===norm(variant.quote)&&(!variant.contextQuote||norm(node.closest('table,figure')?.textContent||'').includes(norm(variant.contextQuote))));if(found.length){correction=variant;matches=found;break;}}
     if(!correction&&variants.some(variant=>nodes.some(node=>norm(node.textContent)===norm(variant.replacementText)))){alreadyApplied.push(group);continue;}
     const explicitDouble=correction?.expectedMatches===2&&correction.applyToAllExactMatchesOnlyIfCountIsExactly===2&&correction.explicitOccurrences?.length===2;
     if(!correction||matches.length!==(explicitDouble?2:1))throw Error('Source correction target must match its explicit count: '+group+' ('+(matches?.length||0)+')');
     for(let index=0;index<matches.length;index++){
      const node=matches[index];if(node.closest('[data-report-program-table],[data-report-calc-source],[data-report-calc-snapshot-id],[data-report-financial-source]'))throw Error('Calculator-owned table is immutable: '+correction.id);
      if(explicitDouble){const scope=correction.explicitOccurrences[index],all=[...box.querySelectorAll('p')];let sibling=node.previousElementSibling;while(sibling&&!/^(?:H[1-6])$/.test(sibling.tagName)&&!sibling.hasAttribute('data-report-heading-level'))sibling=sibling.previousElementSibling;if(scope.nodeKind!=='p'||scope.nodeIndex!==all.indexOf(node)||scope.occurrence!==index+1||norm(sibling?.textContent)!==norm(scope.precedingHeading))throw Error('Explicit repeated target scope changed: '+correction.id);}
      const original=node.outerHTML,offsets=[];let start=0;while((start=text.indexOf(original,start))>=0){offsets.push(start);start+=original.length;}if(offsets.length!==matches.length)throw Error('Exact HTML target is absent/ambiguous: '+correction.id);
      start=offsets[index];changes.push({...correction,id:correction.id+(explicitDouble?'#'+(index+1):''),start,end:start+original.length,original});
     }
    }
    return {text,preservedInputText:preserved,sourceIdentity,originalSection:ProjectWorkflow.clone(s),changes,alreadyApplied};
   },{expected:IDS[key],number,corrections});
   if(!prep.changes.length){receipts.push({key,number,status:'already-applied',ids:prep.alreadyApplied});continue;}
   const beforeFile=await archive(key,'source-correction-before-'+number,{...prep,proposalFile:absolute,proposalSha256:digest(proposal)}),edited=applySourceCorrections(prep.text,prep.changes),afterFile=await archive(key,'source-correction-after-'+number,{...edited,beforeFile,proposalFile:absolute,notOriginalAiReceipt:true,newPaidAiCalls:0});
   const checked=await admit(h,{key,number},prep,edited.after,{version:'evidence-backed-exact-source-correction-v1',beforeFile,afterFile,proposalFile:absolute,proposalSha256:digest(proposal),beforeSha256:edited.beforeSha256,afterSha256:edited.afterSha256,correctedIds:prep.changes.map(x=>x.id),sourceEvidence:edited.evidence,newPaidAiCalls:0,semanticReviewRequired:true,originalAiReceiptUnchanged:true,untargetedBytesPreserved:true,factsVerified:false},checkpoint);
   receipts.push({key,number,...checked,operationCount:edited.operationCount,correctedIds:prep.changes.map(x=>x.id),beforeFile,afterFile});
  }catch(error){receipts.push({key,number,status:'blocked',error:{code:'source-correction-blocked',message:error.message},correctedIds:[]});}
 }
 const file=await archive('tax','source-correction-batch',{at:new Date().toISOString(),proposalFile:absolute,newPaidAiCalls:0,receipts});return {file,newPaidAiCalls:0,completedOperations:receipts.reduce((n,r)=>n+(r.operationCount||0),0),receipts};
 }finally{globalThis.__qaSourceCorrectionRunning=false;}
}
export async function recoverPaidResponses(harnesses,checkpoint){
 if(globalThis.__qaBoundedQueueRunning||globalThis.__qaTargetedBatchRunning)throw Error('Cannot recover while paid requests are running');
 const receipts=[];
 for(const [key,h]of Object.entries(harnesses)){
  if(h.target.id!==IDS[key])throw Error('Exact isolated copy required');
  const dir=path.join(OUT,key,'recovery'),files=await fs.readdir(dir),beforeFiles=files.filter(x=>/^bounded-before-\d+\.\d+-/.test(x)).sort();
  for(const name of beforeFiles){const beforeFile=path.join(dir,name),prep=JSON.parse(await fs.readFile(beforeFile,'utf8')),number=prep.number;
   try{
    const priorArtifact=JSON.parse(await fs.readFile(path.join(OUT,key,'sections',number+'.json'),'utf8'));
    if(priorArtifact.qaBoundedAiRevision?.beforeFile===beforeFile){
     const prior=structuredClone(prep.originalSection);prior.qaBoundedAiRevision=priorArtifact.qaBoundedAiRevision;
     if(priorArtifact.qaBoundedAiRevision.technicalPassed){if(prior.pendingRevision)prior.qaPriorCandidate=structuredClone(prior.pendingRevision);prior.content=priorArtifact.content;prior.editedHtml=null;prior.generated=true;prior.completionContract=priorArtifact.completionContract;prior.quality=priorArtifact.quality;delete prior.pendingRevision;}
     prep.expectedCurrentSection=prior;
    }
    const raws=[];for(const rawName of files.filter(x=>x.startsWith('bounded-raw-'+number+'-')).sort()){const rawFile=path.join(dir,rawName),raw=JSON.parse(await fs.readFile(rawFile,'utf8'));if(Date.parse(raw.at)>=Number(name.match(/-(\d{13})-/)?.[1]||0))raws.push({rawFile,raw});}
    let text=prep.text,proof={version:'zero-ai-current-inspection-v1',beforeFile,newPaidAiCalls:0,originalAiReceiptUnchanged:true};
    if(raws.length){if(raws.length!==1)throw Error('Ambiguous original paid response identity');const {rawFile,raw}=raws[0];if(raw.httpStatus!==200)throw Error('Original paid HTTP failed: '+raw.httpStatus);
     const rawText=(raw.payload.content||[]).filter(x=>x.type==='text').map(x=>x.text).join(''),parsed=JSON.parse(rawText),normalized=normalizeBoundedResponse(prep.plan,parsed),edited=applyBoundedEdits(prep.text,prep.plan,normalized.response);
     const afterFile=await archive(key,'bounded-paid-recovery-after-'+number,{...edited,plan:prep.plan,beforeFile,rawFile,normalizations:normalized.normalizations,sourceIdentity:prep.sourceIdentity,notOriginalAiReceipt:true,newPaidAiCalls:0});text=edited.after;
     proof={version:'actual-ai-bounded-paragraph-revision-v1',beforeFile,rawFile,afterFile,beforeSha256:edited.beforeSha256,afterSha256:edited.afterSha256,originalPaidAiCalls:1,newPaidAiCalls:0,semanticReviewRequired:true,untargetedBytesPreserved:edited.untargetedBytesPreserved,unchangedHeadingCount:edited.unchangedHeadingCount,unchangedTables:edited.unchangedTables,normalizations:normalized.normalizations,originalTaskId:prep.section.executionTask?.id,originalAiReceiptUnchanged:true,factsVerified:false};
    }else if(!prep.derived?.technicalPassed||prep.semantic||prep.extra)throw Error('No paid output and not a previously inspected complete source');
    const result=await admit(h,prep,prep,text,proof,checkpoint);receipts.push({key,number,beforeFile,...result});
   }catch(error){const receipt={key,number,beforeFile,status:'blocked',error:{code:error.code||'paid-recovery-blocked',message:error.message}};receipt.file=await archive(key,'bounded-paid-recovery-blocked-'+number,receipt);receipts.push(receipt);}
   console.log(JSON.stringify({event:'free-paid-recovery',...receipts.at(-1)}));
  }
 }
 const file=await archive('tax','bounded-paid-recovery-batch',{at:new Date().toISOString(),newPaidAiCalls:0,receipts});
 return {file,newPaidAiCalls:0,counts:receipts.reduce((acc,r)=>(acc[r.status]=(acc[r.status]||0)+1,acc),{}),receipts};
}
if(process.argv[2]==='--run')console.log(JSON.stringify(await inspectorCall(`(async()=>{const vm=process.getBuiltinModule('vm'),url=process.getBuiltinModule('url').pathToFileURL(process.cwd()+'/scripts/report-runner-bounded-repair.mjs').href+'?run='+Date.now();const M=await vm.runInThisContext('import('+JSON.stringify(url)+')',{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});globalThis.__qaBoundedController=M;return M.runBoundedQueue(__qaRecoveryHarnesses,__qaRecoveryCheckpoint);})()`)));
if(process.argv[2]==='--recover-paid')console.log(JSON.stringify(await inspectorCall(`(async()=>{const vm=process.getBuiltinModule('vm'),url=process.getBuiltinModule('url').pathToFileURL(process.cwd()+'/scripts/report-runner-bounded-repair.mjs').href+'?recovery='+Date.now();const M=await vm.runInThisContext('import('+JSON.stringify(url)+')',{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});globalThis.__qaBoundedController=M;return M.recoverPaidResponses(__qaRecoveryHarnesses,__qaRecoveryCheckpoint);})()`)));
