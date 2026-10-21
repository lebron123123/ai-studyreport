// Offline QA only: no server, database, browser, AI, or source-report writes.
// Historical reports supply structure/depth comparisons, NEVER current facts.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {loadSnapshots} from './report-generation-acceptance.mjs';

const require=createRequire(import.meta.url);
const C=require('../report-completion-contract.js');
const Business=require('../report-business-structure.js');
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUTPUT_ROOT=path.join(ROOT,'outputs/report-standardization');
const VERSION='real-output-offline-audit-v1';
const sha=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const compact=value=>String(value??'').replace(/\s/g,'');
const title=value=>C.canonicalHeadingText(String(value||''));
const headingKey=value=>compact(title(value)).replace(/[：:]/g,'');
const body=section=>String(section?.editedHtml||section?.content||'');
const excerpt=value=>String(value||'').slice(0,200);

// Historical Markdown often uses bold numbered standalone lines instead of
// heading markers. Recover ONLY numbered title-shaped lines, not bold prose,
// table names, filenames or numbered cells. This independent preprocessing
// prevents a production parser blind spot from silently erasing the baseline.
export function normalizeNumberedBoldHeadings(source){
  return String(source||'').replace(/^(\s*)(\*\*|__)([^\r\n]+)\2\s*$/gm,(all,indent,label,value)=>{
    if(value.length>100||/[。；;《》]/.test(value)||/\.(?:docx?|pdf|xlsx?)\b/i.test(value))return all;
    if(/^\d+[.．、)]\s*[^\d\s]/.test(value))return indent+'### '+value;
    return /^(?:\d+(?:[.．]\d+)+\s*\S|[一二三四五六七八九十]+、\s*\S|[（(][一二三四五六七八九十\d]+[）)]\s*\S)/.test(value)?indent+value:all;
  });
}
export function auditedHeadingOutline(source){return C.headingOutline(normalizeNumberedBoldHeadings(source));}

export function parseAuditArgs(argv=process.argv.slice(2)){
  const options={snapshotDir:null,runnerDir:null,project:'all',out:null,selfTest:false};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==='--self-test')options.selfTest=true;
    else if(['--snapshot-dir','--runner-dir','--project','--out'].includes(arg)){
      if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing value: '+arg);
      options[{'--snapshot-dir':'snapshotDir','--runner-dir':'runnerDir','--project':'project','--out':'out'}[arg]]=argv[++i];
    }else throw Error('Unknown option: '+arg);
  }
  if(!['all','tax','longgang'].includes(options.project))throw Error('Project must be tax, longgang or all');
  if(!options.selfTest&&!options.snapshotDir)throw Error('--snapshot-dir is required; this tool never reads live projects');
  return options;
}

function sourceDraft(source){return source.state?.draft||source.state||{};}
function flatten(chapters){
  const rows=[];
  for(const [ci,chapter] of (chapters||[]).entries())for(const [si,section] of (chapter.sections||[]).entries()){
    const chapterName=chapter.name||chapter.title||'',sectionTitle=section.t||section.title||'';
    rows.push({number:`${ci+1}.${si+1}`,key:chapterName+' / '+sectionTitle,chapterName,sectionTitle,chapterIndex:ci,sectionIndex:si,section});
  }
  return rows;
}
function historicalBaseline(source,key){
  const versions=sourceDraft(source).workflow?.reportVersions||[];
  return key==='tax'?versions.find(v=>Number(v.version)===9):[...versions].filter(v=>!v.qaStructureOnly).sort((a,b)=>Number(b.version||0)-Number(a.version||0))[0];
}
function structureFor(source,baseline,row){
  const old=flatten(baseline?.chapters||[]).find(s=>s.key===row.key),draft=sourceDraft(source);
  const binding=Business.resolve({chapterName:row.chapterName,sectionTitle:row.sectionTitle,projectType:draft.calcType||'gaibao',businessScenario:draft.project?.businessScenario,currentSource:normalizeNumberedBoldHeadings(body(old?.section)),history:[],rules:[]});
  return {old:old?.section||null,headings:binding.requiredHeadings};
}

export function compareHeadings(required,actual){
  const issues=[];let cursor=-1;
  for(const [index,heading] of required.entries()){
    const wanted=headingKey(heading.text);
    const next=actual.findIndex((row,i)=>i>cursor&&headingKey(row.text)===wanted&&row.level===heading.level);
    if(next>=0){cursor=next;continue;}
    const elsewhere=actual.findIndex(row=>headingKey(row.text)===wanted);
    issues.push({code:elsewhere<0?'historical-heading-missing':actual[elsewhere].level!==heading.level?'historical-heading-depth':'historical-heading-order',severity:'error',expectedIndex:index+1,expected:heading,actual:elsewhere<0?null:actual[elsewhere],message:'历史已登记业务分类须保留标题、层级与顺序；旧正文数字不作事实基准。'});
  }
  return issues;
}

// Blocks preserve paragraph locations. The inspector also handles Markdown
// and plaintext reports; headings/tables do not count as repeated prose.
export function paragraphRows(text){
  let value=String(text||'').replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi,'\n').replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi,'\n');
  value=value.replace(/<\/(?:p|div|li|blockquote|section|article)>|<br\s*\/?\s*>/gi,'\n');
  return value.split(/\n+/).map((raw,i)=>({paragraph:i+1,text:C.measure(raw).proseText.trim()})).filter(row=>row.text&&!/^#{1,6}\s/.test(row.text)&&!/^\|/.test(row.text));
}
export function findBoilerplate(text){
  const patterns=[/本(?:小)?节(?:主要|旨在|将|着重|重点)[^。！？\n]{0,70}(?:分析|介绍|阐述|说明|讨论|探讨|讲)/g,/本(?:小)?节需回答[^。！？\n]{0,70}(?:问题|是)/g,/综合本节[^。！？\n]{0,70}(?:判断|结论|形成)/g,/本章(?:主要|旨在|将)[^。！？\n]{0,70}(?:分析|介绍|阐述|说明|讨论)/g,/(?:为后(?:文|续|面)|为本报告)[^。！？\n]{0,30}(?:奠定|提供)[^。！？\n]{0,30}(?:基础|支撑)/g];
  const found=[];
  for(const row of paragraphRows(text))for(const regex of patterns){regex.lastIndex=0;for(const match of row.text.matchAll(regex))found.push({paragraph:row.paragraph,offset:match.index,match:match[0],excerpt:excerpt(row.text)});}
  return found;
}
function grams(text){const result=new Set();for(let i=0;i<text.length-2;i++)result.add(text.slice(i,i+3));return result;}
function jaccard(a,b){let shared=0;for(const gram of a)if(b.has(gram))shared++;return shared/(a.size+b.size-shared||1);}
export function findRepetition(entries){
  const exact=[],near=[],seen=new Map(),pool=[];
  for(const entry of entries)for(const row of paragraphRows(entry.text)){
    const value=compact(row.text);if(value.length<80)continue;
    const location={section:entry.key,number:entry.number,paragraph:row.paragraph,excerpt:excerpt(row.text)};
    if(seen.has(value)){exact.push({first:seen.get(value),repeated:location,characters:value.length});continue;}
    seen.set(value,location);if(value.length<120)continue;
    const shingles=grams(value);
    // Long paragraphs are compared only with comparable lengths, never with
    // source materials or frozen table cells. A match is a manual-review flag.
    for(const old of pool){
      if(Math.min(value.length,old.value.length)/Math.max(value.length,old.value.length)<.85)continue;
      const score=jaccard(shingles,old.shingles);
      if(score>=.90)near.push({first:old.location,repeated:location,similarity:Number(score.toFixed(4))});
    }
    pool.push({value,shingles,location});
  }
  return {exact,near,minimumCharacters:80,nearMinimumCharacters:120,nearThreshold:.90,semanticRepetitionVerified:false};
}

function cellsCanonical(table){return table.map(row=>row.map(cell=>compact(cell).replace(/，/g,',')));}
function cellNumber(value){
  const text=String(value||'').trim().replace(/％/g,'%');
  if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/.test(text))return null;
  const percent=text.endsWith('%'),raw=text.replace(/,/g,'').replace(/%$/,'');
  return String(Number(raw))+(percent?'%':'');
}
function tokens(value){
  // Delimited exact values, not substring matching (500 must not match 1500).
  const raw=C.measure(String(value||'')).proseText.replace(/，/g,',').replace(/％/g,'%');
  return [...raw.matchAll(/[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/g)].map(m=>cellNumber(m[0])).filter(Boolean);
}
function primitiveNumbers(value,result=new Set(),seen=new Set()){
  if(value&&typeof value==='object'){
    if(seen.has(value))return result;seen.add(value);
    for(const child of Object.values(value))primitiveNumbers(child,result,seen);
  }else if(typeof value==='number'&&Number.isFinite(value))result.add(String(value));
  else if(typeof value==='string')for(const token of tokens(value))result.add(token);
  return result;
}
function currentEvidenceIndex(source,final){
  const draft=sourceDraft(source),materials=new Map(),calc=new Set();
  for(const [i,item] of (draft.kb||[]).entries())for(const value of tokens(item.content||'')){
    if(!materials.has(value))materials.set(value,[]);
    const rows=materials.get(value);if(rows.length<3&&!rows.some(r=>r.index===i))rows.push({index:i,title:item.title||item.name||item.fileName||'材料',contentSha256:sha(String(item.content||''))});
  }
  // The currently adopted snapshot only. Historical report prose and other
  // historical calculations are deliberately excluded from the evidence pool.
  const workflow=final?.workflow||draft.workflow||{},currentId=workflow.currentCalcSnapshotId;
  const current=(workflow.calcSnapshots||[]).find(row=>row.id===currentId);
  for(const value of [final?.calcParams||draft.calcParams,current?.params,current?.summary,final?.calcResult,draft.calcResult,final?.financialContext?.params,final?.financialContext?.result,final?.financialContext?.snapshot?.summary])if(value)primitiveNumbers(value,calc);
  return {materials,calc,currentCalcSnapshotId:currentId||null,hasCurrentSnapshot:!!current,limitation:'数值同现只定位候选证据，不证明对象、单位、时点、口径或事实正确；旧AI正文未进入事实池。'};
}
export function auditTableCells(tables,evidence){
  const rows=[];
  for(const [ti,table] of tables.entries())for(const [ri,row] of table.entries())for(const [ci,cell] of row.entries()){
    const value=cellNumber(cell);if(value===null)continue;
    const material=evidence.materials.get(value)||[],calculation=evidence.calc.has(value);
    rows.push({table:ti+1,row:ri+1,column:ci+1,value:cell,candidateMaterialEvidence:material,occursInCurrentCalculation:calculation,status:material.length||calculation?'candidate-evidence-only':'unlocated-requires-review'});
  }
  return rows;
}
export function compareAuthoritativeTables(actual,expected){
  const comparisons=[];
  for(const table of expected||[]){
    const matrix=Array.isArray(table.rows)?table.rows:typeof table.html==='string'?C.measure(table.html).tables[0]:null;
    if(!matrix?.length){comparisons.push({id:table.id||table.kind||'',status:'invalid-evidence',message:'当前权威表必须包含真实单元格矩阵或HTML，不能只写已核验。'});continue;}
    const header=cellsCanonical(matrix)[0],candidates=actual.map((value,i)=>({value,index:i})).filter(row=>JSON.stringify(cellsCanonical(row.value)[0])===JSON.stringify(header));
    const exact=candidates.find(row=>JSON.stringify(cellsCanonical(row.value))===JSON.stringify(cellsCanonical(matrix)));
    if(exact){comparisons.push({id:table.id||table.kind||'',status:'exact-current-source-match',table:exact.index+1,sourceSnapshotId:table.sourceSnapshotId||null,sourceSha256:table.sourceSha256||null,factsVerified:false});continue;}
    const candidate=candidates[0],differences=[];
    if(candidate)for(let ri=0;ri<Math.max(matrix.length,candidate.value.length);ri++)for(let ci=0;ci<Math.max(matrix[ri]?.length||0,candidate.value[ri]?.length||0);ci++){
      const want=matrix[ri]?.[ci],have=candidate.value[ri]?.[ci];if(compact(want)!==compact(have))differences.push({row:ri+1,column:ci+1,expected:want??null,actual:have??null});
    }
    comparisons.push({id:table.id||table.kind||'',status:candidate?'current-source-cell-mismatch':'current-source-table-missing',table:candidate?candidate.index+1:null,differences,sourceSnapshotId:table.sourceSnapshotId||null,sourceSha256:table.sourceSha256||null,factsVerified:false});
  }
  return comparisons;
}
function historicalTables(old,newTables){
  const tables=C.measure(body(old)).tables;
  return {count:tables.length,rows:tables.reduce((n,t)=>n+t.length,0),headers:tables.map(t=>t[0]||[]),missingHeaderSignatures:tables.filter(t=>!newTables.some(n=>JSON.stringify(cellsCanonical(n)[0])===JSON.stringify(cellsCanonical(t)[0]))).map(t=>t[0]||[]),policy:'仅历史表头/结构差异提示，不能要求保留旧AI数字；允许由当前真实表替代，仍须人工确认必要数据未遗漏。'};
}

function gapAudit(final,sections){
  const registry=final?.workflow?.reportGapRegistry||{},records=Array.isArray(registry.records)?registry.records:[];
  const occurrences=[];
  for(const section of sections)for(const row of paragraphRows(section.text))for(const match of row.text.matchAll(/【待补[：:][^】\r\n]+】/g))occurrences.push({section:section.key,number:section.number,paragraph:row.paragraph,marker:match[0]});
  const unresolved=records.filter(r=>!['satisfied','not-applicable'].includes(r.status));
  return {registryVersion:registry.version||null,registryValid:registry.valid===true,totalRecords:records.length,unresolvedCount:unresolved.length,conflictCount:unresolved.filter(r=>r.status==='conflict').length,criticalCount:unresolved.filter(r=>r.critical).length,unresolved:unresolved.map(r=>({id:r.id,label:r.label,status:r.status,reason:r.reason,impact:r.impact,critical:r.critical,ownerSection:r.ownerSection,sectionKeys:r.sectionKeys,evidenceIds:r.evidenceIds})),markerOccurrences:occurrences.length,uniqueMarkers:[...new Set(occurrences.map(r=>r.marker))].length,occurrences,factsVerified:false};
}
function paginationAudit(final){
  const evidence=final?.actualPagination;
  const pages=Number(evidence?.pages),valid=!!evidence&&Number.isInteger(pages)&&pages>0&&['success','succeeded','passed','completed','ok'].includes(evidence.status)&&!!evidence.engine&&/^[a-f0-9]{64}$/i.test(evidence.artifactSha256||'');
  return {status:!valid?'unverified':pages>=110&&pages<=130?'within-110-130':'outside-110-130',pages:valid?pages:null,evidence:evidence||null,actualPaginationRequired:!valid,message:valid?'必须核对该排版回执对应最终完整DOCX，而不是小样或旧版本。':'缺少最终完整报告的实际排版回执（页数、成功状态、引擎、成品SHA-256）；字数不能代替页数。'};
}
function contractFor(row,artifact,final){
  return row?.section?.completionContract||artifact?.completionContract||(final?.plan?.sections||[]).find(contract=>contract.sectionKey===row?.key)||null;
}
function pending(section,artifact){return !!(section?.pendingRevision||artifact?.pendingRevision);}

export function evidenceLimitDensity(text){
  const paragraphs=paragraphRows(text),flagged=[];
  for(const row of paragraphs){
    const terms=[...row.text.matchAll(/未取得|尚未取得|尚未核实|待核验|无法(?:判断|验证|评估|开展|区分|比较)|不能(?:判断|验证|评估|推算)|尚不能|缺少[^，。；]{0,20}(?:数据|资料|证据)/g)].map(m=>m[0]);
    if(terms.length)flagged.push({paragraph:row.paragraph,characters:compact(row.text).length,terms,excerpt:excerpt(row.text)});
  }
  const total=paragraphs.reduce((sum,row)=>sum+compact(row.text).length,0),flaggedCharacters=flagged.reduce((sum,row)=>sum+row.characters,0);
  return {paragraphs:paragraphs.length,flaggedParagraphs:flagged.length,flaggedParagraphCharacters:flaggedCharacters,totalParagraphCharacters:total,flaggedParagraphCharacterRatio:total?Number((flaggedCharacters/total).toFixed(4)):0,locations:flagged,policy:'只定位资料缺失讨论密集的段落，不认定整段均为废话，也不要求隐藏真实限制；语义重复与业务深度仍须人工读稿。'};
}
function pendingCandidateBody(artifact){
  const after=artifact?.pendingRevision?.after;
  return typeof after==='string'?after:body(after)||String(artifact?.error?.candidateText||'');
}
function auditCandidate(artifact,prior,contract,evidence){
  const text=pendingCandidateBody(artifact);if(!text)return null;
  const metrics=C.measure(text),headings=auditedHeadingOutline(text),historyTables=historicalTables(prior.old,metrics.tables);
  let review;try{review=C.inspect(text,artifact?.error?.candidateContract||contract);}catch(error){review={status:'blocked',issues:[{code:'invalid-candidate-contract',severity:'error',message:error.message}]};}
  return {status:'candidate-only-never-final',passed:false,bodySha256:sha(text),artifactStatus:artifact.status||null,metrics:{proseCharacters:metrics.proseCharacters,tableCount:metrics.tableCount,tableRows:metrics.tableRows,paragraphs:paragraphRows(text).length},requiredHistoricalHeadings:prior.headings,actualHeadings:headings,historicalHeadingIssues:compareHeadings(prior.headings,headings),historicalTables:historyTables,tableCellEvidence:auditTableCells(metrics.tables,evidence),boilerplate:findBoilerplate(text),evidenceLimitDensity:evidenceLimitDensity(text),repetition:findRepetition([{key:'candidate',text}]),productionContractReview:review,factsVerified:false,professionalQualityVerified:false,manualReviewRequired:true};
}

export function auditProject(source,key,final,artifacts=new Map()){
  const expected=flatten(sourceDraft(source).chapters),actual=flatten(final?.chapters||[]),baseline=historicalBaseline(source,key),issues=[],sections=[],entries=[],evidence=currentEvidenceIndex(source,final),counts=new Map();
  for(const row of actual)counts.set(row.key,(counts.get(row.key)||0)+1);
  if(!final)issues.push({code:'no-actual-output',severity:'error',message:'尚无实际生成的 final.json；不能用旧报告或基线宣称通过。'});
  if(final?.sourceUnchanged!==true)issues.push({code:'source-immutability-unverified',severity:'error',message:'最终记录未证明原项目/研究未改变。'});
  if(!baseline)issues.push({code:'historical-baseline-missing',severity:'error',message:key==='tax'?'未找到税务局V9结构基线。':'未找到龙岗已保存结构基线。'});
  for(const row of actual)if(!expected.some(e=>e.key===row.key))issues.push({code:'unexpected-section',severity:'error',number:row.number,section:row.key});
  for(const [section,count] of counts)if(count>1)issues.push({code:'duplicate-section-identity',severity:'error',section,count});
  for(const wanted of expected){
    const row=actual.find(r=>r.key===wanted.key),artifact=artifacts.get(wanted.number)||artifacts.get(wanted.key),text=body(row?.section),measured=C.measure(text),prior=structureFor(source,baseline,wanted),headings=auditedHeadingOutline(text),contract=contractFor(row||wanted,artifact,final),sectionIssues=compareHeadings(prior.headings,headings);
    if(!row)sectionIssues.push({code:'section-missing',severity:'error'});
    if(row&&(row.chapterIndex!==wanted.chapterIndex||row.sectionIndex!==wanted.sectionIndex))sectionIssues.push({code:'section-order-changed',severity:'error',expected:wanted.number,actual:row.number});
    if(!measured.proseCharacters&&!measured.tableCharacters)sectionIssues.push({code:'section-empty',severity:'error'});
    if(artifact?.status==='failed'||row?.section?.generationFailure)sectionIssues.push({code:'generation-failed',severity:'error',message:String(artifact?.error||artifact?.generationFailure?.message||row?.section?.generationFailure?.message||'生成任务失败')});
    if(pending(row?.section,artifact))sectionIssues.push({code:'candidate-not-final',severity:'error',message:'候选未接受，不能计为最终正文。'});
    if(artifact&&body(artifact)&&text&&sha(body(artifact))!==sha(text))sectionIssues.push({code:'artifact-final-body-difference',severity:'warning',message:'小节落盘与final正文不同，须核对最终保存版本。'});
    let contractReview;
    try{contractReview=C.inspect(text,contract);}catch(error){contractReview={status:'blocked',issues:[{code:'invalid-completion-contract',severity:'error',message:error.message}],factsVerified:false};}
    sectionIssues.push(...contractReview.issues.filter(i=>i.severity==='error').map(issue=>({...issue,origin:'production-completion-contract'})));
    if(!contract)sectionIssues.push({code:'no-current-contract',severity:'warning',message:'未绑定当前成稿合同，不能以历史稿作当前事实验收。'});
    const expectedTables=(final?.authoritativeTables||[]).filter(table=>table.sectionKey===wanted.key),currentTables=compareAuthoritativeTables(measured.tables,expectedTables);
    for(const table of currentTables)if(!['exact-current-source-match'].includes(table.status))sectionIssues.push({code:table.status,severity:'error',tableId:table.id,differences:table.differences});
    const boilerplate=findBoilerplate(text),cellEvidence=auditTableCells(measured.tables,evidence),oldMetrics=C.measure(body(prior.old)),historyTables=historicalTables(prior.old,measured.tables);
    if(boilerplate.length)sectionIssues.push({code:'writing-process-boilerplate',severity:'warning',count:boilerplate.length});
    if(historyTables.missingHeaderSignatures.length)sectionIssues.push({code:'historical-table-structure-difference',severity:'warning',count:historyTables.missingHeaderSignatures.length,message:'核对必要业务表是否被当前真实数据表替代或遗漏，不按旧AI数字回填。'});
    entries.push({key:wanted.key,number:wanted.number,text});
    sections.push({number:wanted.number,key:wanted.key,chapterName:wanted.chapterName,title:wanted.sectionTitle,status:sectionIssues.some(i=>i.severity==='error')?'blocked':sectionIssues.length?'manual-review-required':'mechanical-checks-complete',bodySha256:sha(text),present:!!row,hasBody:!!(measured.proseCharacters||measured.tableCharacters),artifactStatus:artifact?.status||null,artifactTaskId:artifact?.taskId||artifact?.executionTask?.taskId||null,pendingCandidate:pending(row?.section,artifact),candidateAudit:auditCandidate(artifact,prior,contract,evidence),metrics:{proseCharacters:measured.proseCharacters,tableCount:measured.tableCount,tableRows:measured.tableRows,tableCharacters:measured.tableCharacters,malformedTables:measured.malformedTables,paragraphs:paragraphRows(text).length,headingCount:headings.length},historicalDepth:{proseCharacters:oldMetrics.proseCharacters,bodyRatio:oldMetrics.proseCharacters?Number((measured.proseCharacters/oldMetrics.proseCharacters).toFixed(4)):null,policy:'字数比仅提示深度变化，不证明相同分析质量；依据目录职责变化应单独人工判断。'},requiredHistoricalHeadings:prior.headings,actualHeadings:headings,historicalTables:historyTables,currentTableComparisons:currentTables,tableCellEvidence:cellEvidence,boilerplate,evidenceLimitDensity:evidenceLimitDensity(text),contractReview,issues:sectionIssues});
  }
  let documentReview;
  try{documentReview=final?.plan?C.reviewDocument(entries,final.plan):{status:'unverified',issues:[{code:'no-plan',severity:'error',message:'缺少本次完整成稿计划。'}]};}catch(error){documentReview={status:'blocked',issues:[{code:'document-review-error',severity:'error',message:error.message}]};}
  const repetitions=findRepetition(entries),gaps=gapAudit(final,entries),pagination=paginationAudit(final),totals=sections.reduce((acc,row)=>{for(const metric of Object.keys(acc))acc[metric]+=row.metrics[metric]||0;return acc;},{proseCharacters:0,tableCharacters:0,tableCount:0,tableRows:0});
  if(repetitions.exact.length)issues.push({code:'exact-paragraph-repetition',severity:'error',count:repetitions.exact.length});
  if(pagination.status!=='within-110-130')issues.push({code:'actual-pagination-'+pagination.status,severity:'error',message:pagination.message});
  if(documentReview.status==='blocked')issues.push({code:'whole-document-contract-blocked',severity:'error'});
  const blocking=issues.filter(i=>i.severity==='error').length+sections.reduce((n,s)=>n+s.issues.filter(i=>i.severity==='error').length,0);
  const complete=sections.filter(s=>s.hasBody&&!s.pendingCandidate&&s.artifactStatus!=='failed').length;
  // Automated checks never attest semantic/professional quality. A clean result
  // is ready for manual review, not an unconditional claim of acceptance.
  return {version:VERSION,key,status:!final?'awaiting-output':blocking?'blocked':'manual-review-required',passed:false,mechanicalChecksPassed:!!final&&blocking===0&&complete===expected.length,generatedAt:new Date().toISOString(),projectId:final?.projectId||null,projectName:final?.project?.name||sourceDraft(source).project?.name||source.name,sourceIdentity:source.sourceIdentity,sourceResolvedStateSha256:sha(source.state),historicalBaseline:{id:baseline?.id||null,version:baseline?.version??null,policy:'Only headings, table shape and depth metrics; NEVER authoritative facts.'},expectedChapters:sourceDraft(source).chapters?.length||0,actualChapters:final?.chapters?.length||0,expectedSections:expected.length,actualSections:actual.length,completeSections:complete,blockingIssues:blocking,totals,sections,issues,documentReview,repetitions,gaps,pagination,financialEvidence:{currentCalcSnapshotId:evidence.currentCalcSnapshotId,hasCurrentSnapshot:evidence.hasCurrentSnapshot,authoritativeTables:final?.authoritativeTables?.length||0,providedAudit:final?.financialAudit||null,limitation:evidence.limitation},factsVerified:false,professionalQualityVerified:false,manualReviewRequired:true,manualReviewLocations:sections.filter(s=>s.issues.length||s.contractReview.status!=='passed'||s.tableCellEvidence.some(c=>c.status==='unlocated-requires-review')).map(s=>({number:s.number,section:s.key,reasons:[...s.issues.map(i=>i.code),...s.contractReview.issues.filter(i=>i.severity!=='error').map(i=>i.code)],unlocatedNumericCells:s.tableCellEvidence.filter(c=>c.status==='unlocated-requires-review').map(c=>({table:c.table,row:c.row,column:c.column,value:c.value})),boilerplate:s.boilerplate.map(b=>({paragraph:b.paragraph,excerpt:b.excerpt}))}))};
}

async function readJsonIfPresent(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export async function auditSnapshot(options){
  const snapshot=await loadSnapshots(options.snapshotDir),runnerDir=path.resolve(options.runnerDir||path.join(snapshot.out,'generation-runner')),reports={};
  for(const key of options.project==='all'?['tax','longgang']:[options.project]){
    const projectDir=path.join(runnerDir,key),finalFile=path.join(projectDir,'final.json'),final=await readJsonIfPresent(finalFile),artifacts=new Map();
    for(const section of flatten(sourceDraft(snapshot.sources[key]).chapters)){
      const artifact=await readJsonIfPresent(path.join(projectDir,'sections',section.number+'.json'));if(artifact)artifacts.set(section.number,artifact);
    }
    reports[key]=auditProject(snapshot.sources[key],key,final,artifacts);
    reports[key].actualFinalArtifact=final?{file:finalFile,sha256:sha(await fs.readFile(finalFile)),bytes:(await fs.stat(finalFile)).size}:null;
  }
  return {version:VERSION,at:new Date().toISOString(),snapshotDirectory:snapshot.out,manifestSha256:sha(await fs.readFile(path.join(snapshot.out,'manifest.json'))),runnerDirectory:runnerDir,policy:'Offline read-only source and output audit. Never calls paid AI, never updates live projects, never declares fact/professional acceptance automatically.',status:Object.values(reports).every(r=>r.mechanicalChecksPassed)?'manual-review-required':'incomplete-or-blocked',passed:false,reports};
}

function syntheticSource(){
  return {name:'测试源',sourceIdentity:{kind:'project',projectId:'fixture'},state:{project:{name:'真实项目'},calcType:'gaibao',calcParams:{area:100},kb:[{title:'真实材料',content:'本项目租赁面积100平方米，协议期限6年。'}],chapters:[{name:'项目概况',sections:[{t:'建设方案',content:'旧当前稿不能当事实'}]}],workflow:{reportVersions:[{id:'v9',version:9,chapters:[{name:'项目概况',sections:[{t:'建设方案',content:'<h3>国家政策</h3><h4>市区政策</h4><p>旧AI数字98765万元</p><table><tr><th>年份</th><th>金额</th></tr><tr><td>2027</td><td>98765</td></tr></table>'}]}]}]}}};
}
async function selfTest(){
  let checks=0;const test=(name,fn)=>{fn();checks++;};
  test('no output never passes',()=>{const r=auditProject(syntheticSource(),'tax',null);assert.equal(r.status,'awaiting-output');assert.equal(r.passed,false);assert.equal(r.mechanicalChecksPassed,false);});
  test('missing nested heading flagged',()=>{const q=compareHeadings([{level:3,text:'国家政策'},{level:4,text:'市区政策'}],[{level:3,text:'国家政策'}]);assert.equal(q[0].code,'historical-heading-missing');});
  test('heading flattening flagged',()=>assert.equal(compareHeadings([{level:4,text:'市区政策'}],[{level:3,text:'市区政策'}])[0].code,'historical-heading-depth'));
  test('heading order flagged',()=>assert.equal(compareHeadings([{level:3,text:'一'},{level:3,text:'二'}],[{level:3,text:'二'},{level:3,text:'一'}])[0].code,'historical-heading-order'));
  test('boilerplate located',()=>assert.equal(findBoilerplate('<p>本小节主要分析该项目的运营方案。</p>').length,1));
  test('numbered bold historical headings recovered',()=>assert.deepEqual(auditedHeadingOutline('**一、基础**\n\n**（一）市区**'),[{level:3,text:'基础'},{level:4,text:'市区'}]));
  test('Arabic numbered bold heading recovered',()=>assert.deepEqual(auditedHeadingOutline('**1、产品选择**'),[{level:3,text:'产品选择'}]));
  test('unnumbered bold table name not taxonomy',()=>assert.deepEqual(auditedHeadingOutline('**住房供需分析表**\n**1.1万元支出说明。**\n**《1.1方案.docx》**'),[]));
  test('question and recap meta intros located',()=>assert.equal(findBoilerplate('本节需回答的基础问题是：住房是否匹配。\n综合本节事实，可形成阶段性判断。').length,2));
  test('candidate is never final',()=>{const artifact={status:'failed',pendingRevision:{after:'### 国家政策\n正文待核验。'}};const candidate=auditCandidate(artifact,{old:null,headings:[]},null,{materials:new Map(),calc:new Set()});assert.equal(candidate.status,'candidate-only-never-final');assert.equal(candidate.passed,false);});
  test('missing evidence density is not blanket waste verdict',()=>{const density=evidenceLimitDensity('资料尚未取得，无法判断出租率。\n现有房源与已确认租客需求应逐项匹配。');assert.equal(density.flaggedParagraphs,1);assert.equal(density.paragraphs,2);});
  test('business analysis not forbidden',()=>assert.equal(findBoilerplate('<p>租金下降直接压缩经营现金流，应按合同边界复核。</p>').length,0));
  test('exact duplicate located',()=>{const p='真实材料中的边界必须逐项核对，不能把尚未确认的经营假设写成已经签署的合同事实。'.repeat(4);assert.equal(findRepetition([{key:'A',text:'<p>'+p+'</p>'},{key:'B',text:'<p>'+p+'</p>'}]).exact.length,1);});
  test('table cell tamper flagged',()=>{const r=compareAuthoritativeTables([[['年份','金额'],['2027','11']]],[{id:'cash',rows:[['年份','金额'],['2027','10']]}]);assert.equal(r[0].status,'current-source-cell-mismatch');assert.equal(r[0].differences[0].row,2);});
  test('current table exact match',()=>assert.equal(compareAuthoritativeTables([[['金额'],['10']]],[{rows:[['金额'],['10']]}])[0].status,'exact-current-source-match'));
  test('missing current table flagged',()=>assert.equal(compareAuthoritativeTables([],[{rows:[['金额'],['10']]}])[0].status,'current-source-table-missing'));
  test('V9 AI numbers excluded from evidence',()=>{const index=currentEvidenceIndex(syntheticSource(),{});assert.equal(index.calc.has('98765'),false);assert.equal(index.materials.has('98765'),false);assert.equal(index.materials.has('100'),true);});
  test('scalar token boundaries',()=>{const r=auditTableCells([[['500']] ],{materials:new Map([['1500',[{title:'material'}]]]),calc:new Set()});assert.equal(r[0].status,'unlocated-requires-review');});
  test('gap markers counted independently',()=>assert.equal(gapAudit({},[{key:'A',text:'<p>【待补：租期】</p><p>【待补：租期】</p>'}]).markerOccurrences,2));
  test('words do not prove pages',()=>assert.equal(paginationAudit({plan:{targetPages:120},actualPagination:{pages:120,status:'passed'}}).status,'unverified'));
  test('valid pagination needs artifact identity',()=>assert.equal(paginationAudit({actualPagination:{pages:120,status:'completed',engine:'WPS',artifactSha256:'a'.repeat(64)}}).status,'within-110-130'));
  test('CLI cannot invoke AI',()=>assert.throws(()=>parseAuditArgs(['--run']),/Unknown/));
  return {ok:true,checks,aiCalls:0,liveProjectWrites:0};
}

async function main(){
  const options=parseAuditArgs();if(options.selfTest){console.log(JSON.stringify(await selfTest()));return;}
  const result=await auditSnapshot(options),file=path.resolve(options.out||path.join(options.snapshotDir,'real-output-audit-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'));
  if(!file.startsWith(OUTPUT_ROOT+path.sep))throw Error('New QA artifacts must stay in outputs/report-standardization');
  await fs.writeFile(file,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({file,status:result.status,passed:false,reports:Object.fromEntries(Object.entries(result.reports).map(([key,r])=>[key,{status:r.status,completeSections:r.completeSections,expectedSections:r.expectedSections,proseCharacters:r.totals.proseCharacters,blockingIssues:r.blockingIssues,actualPages:r.pagination.pages,unresolvedGaps:r.gaps.unresolvedCount,exactDuplicateParagraphs:r.repetitions.exact.length}]))}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
