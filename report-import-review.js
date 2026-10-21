/* Local review overlays never replace imported source bytes or parsed blocks. */
(function(root,factory){
 'use strict';const api=factory(()=>typeof module==='object'&&module.exports?require('./report-import-context.js'):root.ReportImportContext,()=>typeof module==='object'&&module.exports?require('./report-import-quality.js'):root.ReportImportQuality);if(typeof module==='object'&&module.exports)module.exports=api;else root.ReportImportReview=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(getContext,getQuality){
 'use strict';
 const LIMITS=Object.freeze({blocks:10,scopeCharacters:12000,appendCharacters:1500,instructionCharacters:2000,diffCharacters:5000});
 const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
 const copy=value=>structuredClone(value);
 const empty=()=>({schemaVersion:1,requests:[]});
 function state(draft){const value=draft.reviewState;if(value==null)return empty();if(value.schemaVersion!==1||!Array.isArray(value.requests))fail('REVIEW_INVALID','候选记录格式不受支持，请保留工作稿');return value;}
 function main(draft){const file=draft.files?.find(f=>f.role==='main');if(!file?.parsed?.blocks?.length)fail('REVIEW_INVALID','主报告原文尚未正确读取');return file;}
 function numbers(text){
  // Keep spelling, signs, decimal precision, percentages and common units intact.
  const atom='(?:平方米|平方公里|立方米|亿元|万元|千元|元|亿|万|千|公顷|亩|㎡|m²|m2|m³|m3|公里|米|吨|千克|kg|户|套|间|人|年|月|日|天|小时|个|倍|成|折|章|节|项|条|期|[%％‰])';
  const unit=atom+'(?:\\s*[/／·•]\\s*[（(]?'+atom+'(?:\\s*[·•/／]\\s*'+atom+')*[）)]?)*';
  const digit='[0-9０-９]',arabic='[+＋\\-−－]?'+digit+'+(?:[,，]'+digit+'{3})*(?:[.．]'+digit+'+)?(?:[eE][+\\-]?'+digit+'+)?(?:\\s*'+unit+')?';
  const cn='[零〇一二两三四五六七八九十百千万亿]+(?:点[零〇一二两三四五六七八九]+)?';
  const chinese='(?:百分之'+cn+'|第'+cn+'(?:'+atom+')?|'+cn+'\\s*'+unit+'|(?<![\\p{Script=Han}A-Za-z0-9])'+cn+'(?![\\p{Script=Han}A-Za-z0-9]))';
  return String(text).match(new RegExp(arabic+'|'+chinese,'gu'))||[];
 }
 function project(draft){
  const result=main(draft).parsed.blocks.map(b=>({blockId:b.id,text:b.text,appendTexts:[],rewritten:false})),byId=new Map(result.map(b=>[b.blockId,b]));
  for(const request of state(draft).requests.filter(r=>r.status==='accepted').sort((a,b)=>a.acceptedOrder-b.acceptedOrder)){
   for(const change of request.changes||[]){if(Array.isArray(request.acceptedBlockIds)&&!request.acceptedBlockIds.includes(change.blockId))continue;const block=byId.get(change.blockId);if(!block)fail('REVIEW_INVALID','候选引用的原文位置已缺失');if(request.context.mode==='append')block.appendTexts.push({candidateId:request.id,text:change.text});else{if(block.text!==change.beforeText)fail('REVIEW_INVALID','已采用候选的正文基线不一致，请保留工作稿');block.text=change.text;block.rewritten=true;}}
  }return result;
 }
 function reason(block,headings,mode,protectedIds){
  if(block.type!=='paragraph')return '表格或非正文内容保持原样';
  if(headings.has(block.id)||block.headingLevel)return '目录标题保持原样';
  if(!block.text.trim())return '空段落不生成建议';
  if(/<(?:img|svg|math|ins|del|table)\b|class=["'][^"']*rfi-math/i.test(block.html))return '图片、修订或复杂内容保持原样';
  if(mode==='rewrite'&&protectedIds.has(block.id))return '此段已标记保留原文，可使用补充模式';
  if(mode==='rewrite'&&/<\/?(?!p\b|br\b)[a-z][^>]*>/i.test(block.html))return '此段含复杂文字格式，仅支持补充，不能改写';
  return '';
 }
 function buildPlan(draft,options,legacy=false,historicalSnapshot=null){
  const mode=options?.mode||'append',scope=options?.scope||'paragraph',instruction=String(options?.instruction||'').trim();
  if(!['append','rewrite'].includes(mode)||!['paragraph','section'].includes(scope))fail('REVIEW_INVALID','请选择有效的完善方式和范围');
  if(!draft.confirmed)fail('REVIEW_SCOPE','请先确认主报告目录');
  if(!instruction||instruction.length>LIMITS.instructionCharacters)fail('REVIEW_INVALID','请填写 1 至 2000 字的完善要求');
  const file=main(draft),all=file.parsed.blocks,index=all.findIndex(b=>b.id===options.blockId),outline=draft.outline||[],seen=new Set();
  if(index<0)fail('REVIEW_SCOPE','所选原文位置不存在');
  for(const item of outline){if(!all.some(b=>b.id===item.blockId)||seen.has(item.blockId)||!Number.isInteger(item.level)||item.level<1||item.level>6)fail('REVIEW_SCOPE','主报告目录有无效位置或级别，请先校正');seen.add(item.blockId);}
  let end=index+1;
  if(scope==='section'){
   const heading=outline.find(o=>o.blockId===options.blockId);if(!heading)fail('REVIEW_SCOPE','按章节完善时，请选择已确认目录中的标题');end=all.length;
   for(let i=index+1;i<all.length;i++){const next=outline.find(o=>o.blockId===all[i].id);if(next&&next.level<=heading.level){end=i;break;}}
  }
  const range=all.slice(index,end),protectedIds=new Set(draft.protectedBlockIds||[]),working=new Map(project(draft).map(b=>[b.blockId,b])),blocks=[],skippedBlocks=[];
  let characters=0;
  for(const block of range){const rendered=working.get(block.id);characters+=rendered.text.length+rendered.appendTexts.reduce((n,c)=>n+c.text.length,0);const why=reason(block,seen,mode,protectedIds);if(why)skippedBlocks.push({blockId:block.id,reason:why});else blocks.push({blockId:block.id,text:rendered.text,appendTexts:copy(rendered.appendTexts),protected:protectedIds.has(block.id)});}
  if(scope==='paragraph'&&skippedBlocks.length)fail('REVIEW_SCOPE',skippedBlocks[0].reason);
  if(!blocks.length)fail('REVIEW_SCOPE','此范围没有可完善的正文段落；原文和保护设置保持不变');
  if(blocks.length>LIMITS.blocks||characters>LIMITS.scopeCharacters)fail('REVIEW_LIMIT','一次最多选择 10 个可编辑正文段落、范围合计 12000 字，请缩小范围；没有截断原文');
  // Parsed content is immutable and integrity checked by the store. Never duplicate image HTML/base64 in review history.
  const baseline={owner:draft.owner,draftId:draft.id,fileId:file.id,sourceHash:file.hash,scopeBlockIds:range.map(b=>b.id),source:range.map(b=>({id:b.id,type:b.type,text:b.text})),outline:copy(outline),protectedBlockIds:[...protectedIds].sort(),working:range.map(b=>working.get(b.id))};
  const context={mode,scope,blockId:options.blockId,instruction,blockIds:blocks.map(b=>b.blockId),scopeBlockIds:range.map(b=>b.id),blocks,skippedBlocks,allowedNumbers:[...new Set(range.flatMap(b=>numbers(b.text)))],owner:draft.owner,draftId:draft.id,fileId:file.id,sourceHash:file.hash,baseDraftRevision:draft.revision,baseline};
  // Legacy requests alone retain their original baseline. Public plan/begin cannot
  // opt out: selections and rules are rebuilt from this draft, never caller excerpts.
  if(!legacy){
   const source=getContext();if(!source?.build)fail('REVIEW_CONTEXT_UNAVAILABLE','参考资料与专业规则模块尚未加载，请刷新后重试');
   if(historicalSnapshot&&(options.blockId!==historicalSnapshot.blockId||options.writingProfileId!==historicalSnapshot.writingProfileId||JSON.stringify(options.referenceFileIds)!==JSON.stringify(historicalSnapshot.referenceFileIds)||options.referenceBlockIds?.length))fail('REVIEW_STALE','历史参考选择与保存快照不一致');
   const sourceContext=historicalSnapshot?source.validateLegacy(draft,historicalSnapshot):source.build(draft,{blockId:options.blockId,referenceFileIds:options.referenceFileIds,referenceBlockIds:options.referenceBlockIds,writingProfileId:options.writingProfileId,instruction,workingText:blocks.map(block=>[block.text,...block.appendTexts.map(item=>item.text)].join('\n')).join('\n')});
   Object.assign(context,{reviewContextVersion:2,referenceFileIds:copy(sourceContext.referenceFileIds),referenceBlockIds:copy(sourceContext.referenceBlockIds),writingProfileId:sourceContext.writingProfileId,sourceContext,references:copy(sourceContext.references)});
   baseline.request={mode,scope,blockId:options.blockId,instruction};baseline.sourceContext=copy(sourceContext);
  }
  return context;
 }
 function plan(draft,options){return buildPlan(draft,options);}
 function current(draft,request){
  const stored=request.context,legacy=stored&&stored.reviewContextVersion==null&&!Object.hasOwn(stored,'sourceContext')&&!Object.hasOwn(stored.baseline||{},'sourceContext');
  const historical=stored?.reviewContextVersion===2&&stored.sourceContext?.schemaVersion===1&&stored.sourceContext.selectionVersion==null;
  let fresh;try{fresh=buildPlan(draft,stored,legacy,historical?stored.sourceContext:null);}catch(e){fail('REVIEW_STALE','原文范围、目录、保护设置、参考资料或专业规则已变化，旧候选未采用，请保留后重新生成');}
  if(JSON.stringify(fresh.baseline)!==JSON.stringify(stored.baseline)||(!legacy&&(stored.reviewContextVersion!==2||JSON.stringify(fresh.sourceContext)!==JSON.stringify(stored.sourceContext)||JSON.stringify(fresh.references)!==JSON.stringify(stored.references))))fail('REVIEW_STALE','原文范围、目录、保护设置、工作稿正文、参考资料或专业规则已变化，旧候选未采用');
  return fresh;
 }
 function validateChanges(context,changes){
  if(!Array.isArray(changes)||!changes.length||changes.length>context.blocks.length)fail('REVIEW_INVALID','AI 未返回有效的逐段建议，未采用任何修改');
  const seen=new Set(),allowed=new Set(context.allowedNumbers),result=[];let added=0;
  for(const item of changes){
   const block=context.blocks.find(b=>b.blockId===item?.blockId);if(!block||seen.has(item.blockId)||typeof item.text!=='string'||!item.text.trim())fail('REVIEW_INVALID','候选包含范围外、重复或空段落，未采用任何修改');seen.add(item.blockId);
   if(item.text.length>LIMITS.scopeCharacters)fail('REVIEW_LIMIT','候选段落过长，未截断或采用');
   const tokens=numbers(item.text);
   if(context.mode==='rewrite'){
    if(JSON.stringify(tokens)!==JSON.stringify(numbers(block.text)))fail('REVIEW_NUMBERS','改写候选新增、删除或改变了数字或单位，整份候选未采用');
    if(item.text===block.text)fail('REVIEW_INVALID','候选没有实际文字变化');
   }else{
    if(tokens.some(token=>!allowed.has(token)))fail('REVIEW_NUMBERS','补充候选含本范围主稿没有的数字或单位，整份候选未采用');added+=item.text.length;
   }
   result.push({blockId:item.blockId,text:item.text,beforeText:context.mode==='append'?'':block.text});
  }
  if(added>LIMITS.appendCharacters)fail('REVIEW_LIMIT','一次补充最多新增 1500 字，候选过长，未截断或采用');
  return result;
 }
 function completionDetails(action){
  const details={};
  if(action.explanation!=null){if(typeof action.explanation!=='string'||action.explanation.length>4000)fail('REVIEW_INVALID','候选说明格式无效或超过 4000 字');details.explanation=action.explanation;}
  if(action.meta&&typeof action.meta==='object'&&!Array.isArray(action.meta)){
   const meta={};for(const name of ['provider','model','requestId','finishReason'])if(typeof action.meta[name]==='string'&&action.meta[name].length<=500)meta[name]=action.meta[name];
   if(action.meta.usage&&typeof action.meta.usage==='object'&&!Array.isArray(action.meta.usage)){
    const usage={};for(const name of ['input_tokens','output_tokens','total_tokens','inputTokens','outputTokens','totalTokens','prompt_tokens','completion_tokens']){const value=action.meta.usage[name];if(Number.isSafeInteger(value)&&value>=0)usage[name]=value;}if(Object.keys(usage).length)meta.usage=usage;
   }
   if(Object.keys(meta).length)details.meta=meta;
  }return details;
 }
 function apply(draft,action,{requestId,now=Date.now()}={}){
  const next=copy(state(draft)),type=action?.type;
  if(type==='quality-decision'){
   const quality=getQuality();if(!quality?.evaluate)fail('REVIEW_INVALID','整稿检查模块尚未加载');
   const finding=quality.evaluate(draft).findings.find(row=>row.id===action.findingId);
   if(!finding)fail('REVIEW_STALE','这项检查已变化，请重新检查工作稿后处理');
   if(!['confirmed','needs-data','not-applicable'].includes(action.decision)||typeof action.note!=='string'||action.note.trim().length<5||action.note.length>2000)fail('REVIEW_INVALID','请填写至少 5 字的人工判断及依据，最多 2000 字');
   let sourceLocation;
   if(finding.kind==='fact-conflict'&&action.decision==='confirmed'){
    sourceLocation=finding.locations.find(row=>row.fileId===action.sourceLocation?.fileId&&row.blockId===action.sourceLocation?.blockId&&row.value===action.sourceLocation?.value);
    if(!sourceLocation)fail('REVIEW_FACTS','确认数值口径前须明确选择本项列出的原文及数值；不会修改正文数字');
   }
   if(finding.kind==='fact-conflict'&&action.decision==='not-applicable')fail('REVIEW_FACTS','数值差异不能直接隐藏，请确认各自口径或标记待补资料');
   if(finding.kind==='professional-review'&&action.decision==='not-applicable')fail('REVIEW_FACTS','专业事实核对不能标记为不适用');
   next.qualityDecisions=next.qualityDecisions||[];
   next.qualityDecisions.push({findingId:finding.id,evidenceKey:finding.evidenceKey,decision:action.decision,note:action.note.trim(),...(sourceLocation?{sourceLocation:copy(sourceLocation)}:{}),owner:draft.owner,at:now,factsVerified:false});
   return next;
  }
  if(type==='begin'){
   if(next.requests.some(r=>r.status==='running'||r.status==='ready'||r.status==='outcome_unknown'))fail('REVIEW_PENDING','请先处理上一份候选或查询未知请求结果，不能重复生成');
   if(typeof requestId!=='string'||!requestId||next.requests.some(r=>r.id===requestId))fail('REVIEW_INVALID','缺少或重复的请求编号');
   const context=plan(draft,action);if(context.sourceContext.files.some(file=>file.status!=='matched'))fail('REVIEW_REFERENCE','所选参考资料含未命中或未解析的文件，请调整所选资料后再生成；原件已保留');
   next.requests.push({id:requestId,status:'running',context,createdAt:now,...(action.durable===true?{durable:true}:{})});return next;
  }
  if(type==='undo'){
   const request=next.requests.filter(r=>r.status==='accepted').sort((a,b)=>b.acceptedOrder-a.acceptedOrder)[0];if(!request)fail('REVIEW_INVALID','没有可撤销的已采用候选');request.status='undone';request.undoneAt=now;return next;
  }
  const id=['accept','reject'].includes(type)?action.candidateId:action?.requestId,request=next.requests.find(r=>r.id===id);
  if(!request)fail('REVIEW_INVALID','找不到对应候选请求');
  if(['complete','fail','cancel','unknown'].includes(type)){
   const recovery=type==='complete'&&action.recovered===true&&request.durable===true&&['outcome_unknown','failed','cancelled'].includes(request.status);
   if(request.status!=='running'&&!recovery&&!(type==='unknown'&&request.durable===true&&request.status==='outcome_unknown'))fail('REVIEW_STATE','请求状态已变化，迟到结果未采用');
   if(type==='complete'){const context=current(draft,request);request.changes=validateChanges(context,action.changes);Object.assign(request,completionDetails(action));request.status='ready';request.completedAt=now;}
   if(type==='fail'){request.status=request.durable===true&&action.confirmedNoCharge!==true?'outcome_unknown':'failed';request.message=String(action.message||'本次请求未完成，原文保留').slice(0,1000);request.finishedAt=now;}
   if(type==='cancel'){request.status=request.durable===true&&action.confirmedNoCharge!==true?'outcome_unknown':'cancelled';request.finishedAt=now;}
   if(type==='unknown'){if(request.durable!==true)fail('REVIEW_STATE','旧请求没有持久回执，不能冒充可恢复请求');request.status='outcome_unknown';request.message=String(action.message||'请求结果未知，只能查询原请求；不会重新收费生成').slice(0,1000);request.finishedAt=now;}
  }else if(['accept','reject'].includes(type)){
   if(request.status!=='ready')fail('REVIEW_STATE','候选已处理，请重新查看当前工作稿');
   if(type==='accept'){
    const context=current(draft,request);validateChanges(context,request.changes);
    const selected=action.blockIds===undefined?request.changes.map(change=>change.blockId):action.blockIds;
    if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some(id=>!request.changes.some(change=>change.blockId===id)))fail('REVIEW_SCOPE','请勾选本候选内至少一个完整段落，不能重复或采用范围外的段落');
    const quality=getQuality();if(!quality?.evaluate)fail('REVIEW_INVALID','整稿检查模块尚未加载，请刷新后再采用');
    const referenceFiles=new Set(context.referenceFileIds||[]),preciseReferences=context.sourceContext?.selectionVersion===2;
    const referenceBlocks=new Set((context.sourceContext?.references||[]).flatMap(reference=>reference.positions.map(position=>JSON.stringify([reference.fileId,position.blockId]))));
    // current() rebuilt and validated these complete-block references. A selected
    // file's unrelated chapter must not gate this candidate. Keep the full request
    // scope for partial adoption, and retain conservative gating for legacy windows.
    const conflicts=quality.evaluate(draft).findings.filter(row=>{
     if(row.kind!=='fact-conflict')return false;
     const relevant=row.locations.filter(loc=>loc.fileId===context.fileId||referenceFiles.has(loc.fileId));
     return new Set(relevant.map(loc=>loc.value)).size>1&&relevant.some(loc=>(loc.fileId===context.fileId&&context.scopeBlockIds.includes(loc.blockId))||(referenceFiles.has(loc.fileId)&&(!preciseReferences||referenceBlocks.has(JSON.stringify([loc.fileId,loc.blockId])))));
    });
    if(conflicts.length&&(!action.factConfirmation||conflicts.some(row=>row.status!=='confirmed')))fail('REVIEW_FACTS','本次主稿或参考资料存在数值差异，请先记录人工口径并明确勾选事实确认，再采用候选；原数字未改变');
    request.acceptedBlockIds=[...selected];request.rejectedBlockIds=request.changes.filter(change=>!selected.includes(change.blockId)).map(change=>change.blockId);
    if(conflicts.length)request.factConfirmation={confirmedAt:now,owner:draft.owner,findings:conflicts.map(row=>({findingId:row.id,evidenceKey:row.evidenceKey,decision:copy(row.decision)})),numericPermission:'original-only'};
    request.status='accepted';request.acceptedAt=now;request.acceptedOrder=Math.max(0,...next.requests.map(r=>r.acceptedOrder||0))+1;
   }
   else{request.status='rejected';request.rejectedAt=now;}
  }else fail('REVIEW_INVALID','不支持的候选操作');
  return next;
 }
 function diff(before,after){
  const a=Array.from(String(before)),b=Array.from(String(after));if(a.length>LIMITS.diffCharacters||b.length>LIMITS.diffCharacters)fail('REVIEW_DIFF_LIMIT','单段差异超过 5000 字，请使用原文和候选对照查看');
  // Bounded character LCS; explicit fallback is safer than pretending a whole replacement is a character diff.
  let prefix=0;while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
  let suffix=0;while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
  const left=a.slice(prefix,a.length-suffix),right=b.slice(prefix,b.length-suffix),rows=left.length+1,cols=right.length+1;
  if(rows*cols>4000000)fail('REVIEW_DIFF_LIMIT','这段改动范围较大，请使用原文和候选对照查看');
  const lengths=new Uint16Array(rows*cols);for(let i=left.length-1;i>=0;i--)for(let j=right.length-1;j>=0;j--)lengths[i*cols+j]=left[i]===right[j]?1+lengths[(i+1)*cols+j+1]:Math.max(lengths[(i+1)*cols+j],lengths[i*cols+j+1]);
  const result=[],push=(type,text)=>{if(!text)return;const last=result[result.length-1];if(last?.type===type)last.text+=text;else result.push({type,text});};push('equal',a.slice(0,prefix).join(''));
  let i=0,j=0;while(i<left.length||j<right.length){if(i<left.length&&j<right.length&&left[i]===right[j]){push('equal',left[i++]);j++;}else if(j<right.length&&(i===left.length||lengths[i*cols+j+1]>lengths[(i+1)*cols+j]))push('insert',right[j++]);else push('delete',left[i++]);}push('equal',a.slice(a.length-suffix).join(''));return result;
 }
 return Object.freeze({LIMITS,plan,project,apply,diff,numbers});
});
