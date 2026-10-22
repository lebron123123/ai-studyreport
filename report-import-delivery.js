/* Export accepted overlays into a new package; source bytes are never overwritten. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ReportImportDelivery=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
 const elements=node=>Array.from(node?.childNodes||[]).filter(n=>n.nodeType===1),isW=(n,name)=>n?.namespaceURI===W&&n.localName===name;
 const dependency=name=>root[name]||(typeof require==='function'?require('./'+({'ReportImportCore':'report-import-core','ReportImportReview':'report-import-review','ReportImportStore':'report-import-store'}[name])+'.js'):null);
 const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 function xmlRanges(xml,doc){
  const nodes=Array.from(doc.getElementsByTagName('*')),ranges=new Map(),stack=[];let index=0;
  const tokens=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;let match;
  while((match=tokens.exec(xml))){const value=match[0];if(/^<[/!?]/.test(value)){if(value.startsWith('</')){const item=stack.pop();if(!item||value.slice(2,-1).trim()!==item.node.nodeName)fail('DELIVERY_MAPPING','原 Word 节点位置核对失败，未导出');item.end=tokens.lastIndex;}continue;}const node=nodes[index++],name=value.match(/^<([^\s/>]+)/)?.[1];if(!node||node.nodeName!==name)fail('DELIVERY_MAPPING','原 Word 节点顺序核对失败，未导出');const range={node,start:match.index,end:/\/\s*>$/.test(value)?tokens.lastIndex:null};ranges.set(node,range);if(range.end==null)stack.push(range);}
  if(index!==nodes.length||stack.length)fail('DELIVERY_MAPPING','原 Word 节点范围不完整，未导出');return ranges;
 }
 function sourceNode(body,id){
  if(!/^source-b\d+(?:-b\d+)*$/.test(id))fail('DELIVERY_MAPPING','不支持的原文位置，未导出');let parent=body,node;
  const positions=id.slice(8).split('-b').map(Number);
  for(let i=0;i<positions.length;i++){node=elements(parent)[positions[i]];if(!node)fail('DELIVERY_MAPPING','原稿位置不存在，未导出');if(i<positions.length-1){if(isW(node,'sdt'))parent=elements(node).find(n=>isW(n,'sdtContent'));else if(['customXml','ins','del','moveFrom','moveTo'].some(name=>isW(node,name)))parent=node;else fail('DELIVERY_MAPPING','原稿位置不是可确认的正文段落，未导出');}}
  if(!isW(node,'p'))fail('DELIVERY_MAPPING','只支持在已核对的正文段落写入修改');
  for(let ancestor=node.parentNode;ancestor&&ancestor!==body;ancestor=ancestor.parentNode)if(!['customXml','sdtContent','sdt'].some(name=>isW(ancestor,name)))fail('DELIVERY_COMPLEX','原段落位于修订或复杂结构中，未改写或导出');return node;
 }
 function plain(node){return !['rPrChange','ins','del','moveFrom','moveTo'].some(name=>node.getElementsByTagNameNS(W,name).length)&&elements(node).every(n=>isW(n,'pPr')||isW(n,'r')&&elements(n).every(c=>['rPr','t','tab','br','cr'].some(name=>isW(c,name))));}
 function paragraphText(node){let value='';for(const run of elements(node).filter(n=>isW(n,'r')))for(const item of elements(run)){if(isW(item,'t'))value+=item.textContent;else if(isW(item,'tab'))value+='\t';else if(isW(item,'br')||isW(item,'cr'))value+='\n';}return value;}
 function textRuns(text,red,baseRun,Serializer,doc,deleted=false,revisions=null,inserted=false){
  const parts=String(text).split(/(【待补：[\s\S]*?】)/g);return parts.map(part=>{if(!part)return '';const props=baseRun?baseRun.cloneNode(true):doc.createElementNS(W,'w:rPr');for(const item of elements(props))if(isW(item,'rPrChange'))item.remove();
   if(deleted&&!revisions){for(const item of elements(props))if(isW(item,'strike')||isW(item,'dstrike'))item.remove();const strike=doc.createElementNS(W,'w:strike');strike.setAttributeNS(W,'w:val','1');const before=['rStyle','rFonts','b','bCs','i','iCs','caps','smallCaps'];props.insertBefore(strike,elements(props).find(n=>!before.some(name=>isW(n,name)))||null);}
   if(inserted){for(const item of elements(props))if(isW(item,'u'))item.remove();const underline=doc.createElementNS(W,'w:u');underline.setAttributeNS(W,'w:val','single');const after=['effect','bdr','shd','fitText','vertAlign','rtl','cs','em','lang','eastAsianLayout','specVanish','oMath','rPrChange'];props.insertBefore(underline,elements(props).find(n=>after.some(name=>isW(n,name)))||null);}
   if(red||!deleted&&/^【待补：/.test(part)){for(const item of elements(props))if(isW(item,'color'))item.remove();const color=doc.createElementNS(W,'w:color');color.setAttributeNS(W,'w:val','FF0000');const after=['spacing','w','kern','position','sz','szCs','highlight','u','effect','bdr','shd','fitText','vertAlign','rtl','cs','em','lang','eastAsianLayout','specVanish','oMath','rPrChange'];props.insertBefore(color,elements(props).find(n=>after.some(name=>isW(n,name)))||null);}
   // Native deletions keep their source properties; the editor supplies revision display.
   const runProps=new Serializer().serializeToString(props),tag=deleted&&revisions?'delText':'t',value=part.split(/([\t\n])/).map(t=>t==='\n'?'<w:br/>':t==='\t'?'<w:tab/>':t?'<w:'+tag+' xml:space="preserve">'+esc(t)+'</w:'+tag+'>':'').join('');return '<w:r>'+runProps+value+'</w:r>';}).join('');
 }
 function runSpans(node){let offset=0;return elements(node).filter(n=>isW(n,'r')).map(run=>{const start=offset;for(const item of elements(run))if(isW(item,'t'))offset+=item.textContent.length;else if(['tab','br','cr'].some(name=>isW(item,name)))offset++;return {start,end:offset,props:elements(run).find(n=>isW(n,'rPr'))};});}
 function rewriteRuns(before,after,chunks,spans,baseRun,Serializer,doc,mode,revisions){
  const markers=Array.from(after.matchAll(/【待补：[\s\S]*?】/g),m=>[m.index,m.index+m[0].length]);let oldOffset=0,newOffset=0;
  return chunks.map(chunk=>{const deleted=chunk.type==='delete',inserted=chunk.type==='insert',start=deleted?oldOffset:newOffset,end=start+chunk.text.length,cuts=[0,chunk.text.length];
   if(!inserted)for(const span of spans){const cut=span.end-oldOffset;if(cut>0&&cut<chunk.text.length)cuts.push(cut);}
   if(!deleted)for(const [a,b]of markers){if(a>start&&a<end)cuts.push(a-start);if(b>start&&b<end)cuts.push(b-start);}cuts.sort((a,b)=>a-b);let result='';
   for(let i=0;i<cuts.length-1;i++){const a=cuts[i],b=cuts[i+1];if(a===b)continue;const location=inserted?Math.max(0,oldOffset-1):oldOffset+a,span=spans.find(item=>location>=item.start&&location<item.end),props=span?span.props:baseRun;
    if(!deleted||mode!=='clean')result+=textRuns(chunk.text.slice(a,b),(mode==='review'&&(inserted||deleted))||(!deleted&&markers.some(([m,n])=>start+a>=m&&start+b<=n)),props,Serializer,doc,deleted,mode==='tracked'?revisions:null,mode==='review'&&inserted);
   }
   if(inserted)revisions.insertedCharacters+=Array.from(chunk.text).length;if(deleted)revisions.deletedCharacters+=Array.from(chunk.text).length;
   if(!inserted)oldOffset+=chunk.text.length;if(!deleted)newOffset+=chunk.text.length;
   return mode==='tracked'&&(inserted||deleted)?'<w:'+(deleted?'del':'ins')+revisions.attributes()+'>'+result+'</w:'+(deleted?'del':'ins')+'>':result;
  }).join('');
 }
 async function revisionState(zip,Parser,accepted){
  const used=new Set();for(const name of Object.keys(zip.files).filter(name=>/^word\/.*\.xml$/.test(name)&&!zip.files[name].dir)){const doc=new Parser().parseFromString(await zip.file(name).async('string'),'application/xml');for(const node of Array.from(doc.getElementsByTagName('*'))){const id=node.getAttributeNS(W,'id');if(id!==null)used.add(/^[+-]?\d+$/.test(id)?BigInt(id).toString():id);}}
  let next=0;const dates=accepted.map(r=>r.acceptedAt).filter(n=>Number.isFinite(n)&&n>=0&&n<=8640000000000000),date=new Date(dates.length?Math.max(...dates):Date.now()).toISOString();
  const allocate=()=>{while(used.has(String(next)))next++;const id=String(next++);used.add(id);return {id,author:'报告完善（已采用修改）',date};};
  return {insertedCharacters:0,deletedCharacters:0,attributes(){return Object.entries(allocate()).map(([key,value])=>' w:'+key+'="'+value+'"').join('');},element(doc,name){const node=doc.createElementNS(W,'w:'+name);for(const [key,value]of Object.entries(allocate()))node.setAttributeNS(W,'w:'+key,value);return node;}};
 }
 function diffForExport(review,before,after,blockId,coarseDiffBlocks){
  try{return review.diff(before,after);}catch(error){if(error.code!=='REVIEW_DIFF_LIMIT')throw error;coarseDiffBlocks.push(blockId);return [{type:'delete',text:before},{type:'insert',text:after}].filter(chunk=>chunk.text);}
 }
 async function showRevisionMarkup(zip,Parser,Serializer,changedParts){
  const name='word/settings.xml',relationshipType='http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',contentType='application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
  // Only the view preference changes. Future edits are not automatically tracked.
  let xml=zip.file(name)?await zip.file(name).async('string'):'<?xml version="1.0" encoding="UTF-8"?><w:settings xmlns:w="'+W+'"/>',doc=new Parser().parseFromString(xml,'application/xml');
  if(!isW(doc.documentElement,'settings')||doc.getElementsByTagName('parsererror').length)fail('DELIVERY_XML','原 Word 设置无法安全核对，未导出');
  let view=elements(doc.documentElement).find(n=>isW(n,'revisionView'));if(!view){view=doc.createElementNS(W,'w:revisionView');const before=['writeProtection','view','zoom','removePersonalInformation','removeDateAndTime','doNotDisplayPageBoundaries','displayBackgroundShape','printPostScriptOverText','printFractionalCharacterWidth','printFormsData','embedTrueTypeFonts','embedSystemFonts','saveSubsetFonts','saveFormsData','mirrorMargins','alignBordersAndEdges','bordersDoNotSurroundHeader','bordersDoNotSurroundFooter','gutterAtTop','hideSpellingErrors','hideGrammaticalErrors','activeWritingStyle','proofState','formsDesign','attachedTemplate','linkStyles','stylePaneFormatFilter','stylePaneSortMethod','documentType','mailMerge'];doc.documentElement.insertBefore(view,elements(doc.documentElement).find(n=>!before.some(key=>isW(n,key)))||null);}
  view.setAttributeNS(W,'w:markup','1');view.setAttributeNS(W,'w:insDel','1');const serialized=new Serializer().serializeToString(doc);if(serialized!==xml){zip.file(name,serialized);changedParts.push(name);}
  const relName='word/_rels/document.xml.rels',R='http://schemas.openxmlformats.org/package/2006/relationships',relXml=zip.file(relName)?await zip.file(relName).async('string'):'<Relationships xmlns="'+R+'"/>',rels=new Parser().parseFromString(relXml,'application/xml');
  if(rels.documentElement.namespaceURI!==R||rels.getElementsByTagName('parsererror').length)fail('DELIVERY_XML','原 Word 关系无法安全核对，未导出');
  const settings=elements(rels.documentElement).find(n=>n.getAttribute('Type')===relationshipType);if(settings&&((settings.getAttribute('TargetMode')||'Internal')!=='Internal'||!['settings.xml','/word/settings.xml'].includes(settings.getAttribute('Target'))))fail('DELIVERY_COMPLEX','原 Word 设置使用特殊位置，未更改原件，请用当前工作稿导出');
  if(!settings){const ids=new Set(elements(rels.documentElement).map(n=>n.getAttribute('Id')));let id='reportImportSettings',suffix=0;while(ids.has(id))id='reportImportSettings'+(++suffix);const rel=rels.createElementNS(R,'Relationship');rel.setAttribute('Id',id);rel.setAttribute('Type',relationshipType);rel.setAttribute('Target','settings.xml');rels.documentElement.appendChild(rel);zip.file(relName,new Serializer().serializeToString(rels));changedParts.push(relName);}
  const typesName='[Content_Types].xml',C='http://schemas.openxmlformats.org/package/2006/content-types';if(!zip.file(typesName))fail('DELIVERY_XML','原 Word 缺少内容类型清单，未导出');const types=new Parser().parseFromString(await zip.file(typesName).async('string'),'application/xml');if(types.documentElement.namespaceURI!==C||types.getElementsByTagName('parsererror').length)fail('DELIVERY_XML','原 Word 内容类型无法安全核对，未导出');
  const override=elements(types.documentElement).find(n=>n.getAttribute('PartName')==='/word/settings.xml');if(override&&override.getAttribute('ContentType')!==contentType)fail('DELIVERY_XML','原 Word 设置类型不匹配，未导出');if(!override){const item=types.createElementNS(C,'Override');item.setAttribute('PartName','/word/settings.xml');item.setAttribute('ContentType',contentType);types.documentElement.appendChild(item);zip.file(typesName,new Serializer().serializeToString(types));changedParts.push(typesName);}
 }
 async function exportDocx(draft,originalBlob,{mode='review',JSZip=root.JSZip,DOMParser=root.DOMParser,XMLSerializer=root.XMLSerializer}={}){
  if(!['review','clean','tracked'].includes(mode))fail('DELIVERY_INVALID','请选择修改标红对照版、当前工作稿或 Word 修订版');
  const core=dependency('ReportImportCore'),review=dependency('ReportImportReview'),store=dependency('ReportImportStore'),file=draft?.files?.find(f=>f.role==='main');
  if(!file||!(originalBlob instanceof Blob)||!JSZip||!DOMParser||!XMLSerializer)fail('DEPENDENCY_MISSING','原件或 Word 导出组件尚未加载');
  const bytes=new Uint8Array(await originalBlob.arrayBuffer()),sourceHash=store.sha256(bytes);if(sourceHash!==file.hash||bytes.length!==file.size)fail('DELIVERY_INTEGRITY','原件校验失败，未导出修改稿');
  const parsed=await core.parseDocx(bytes,{fileName:file.name,JSZip,DOMParser});if(JSON.stringify(parsed)!==JSON.stringify(file.parsed))fail('DELIVERY_INTEGRITY','原件与工作稿位置不一致，未导出修改稿');
  const projected=review.project(draft),accepted=draft.reviewState?.requests?.filter(r=>r.status==='accepted')||[],zip=await JSZip.loadAsync(bytes,{createFolders:false}),xml=await zip.file('word/document.xml').async('string'),doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)fail('DELIVERY_MAPPING','原稿 XML 无效');const body=elements(doc.documentElement).find(n=>isW(n,'body')),ranges=xmlRanges(xml,doc),patches=[],coarseDiffBlocks=[],revisions=await revisionState(zip,DOMParser,accepted);let appended=0,rewritten=0;
  for(const work of projected){const source=parsed.blocks.find(b=>b.id===work.blockId);if(work.text===source.text&&!work.appendTexts.length)continue;
   const node=sourceNode(body,work.blockId),range=ranges.get(node),pPr=elements(node).find(n=>isW(n,'pPr')),pRange=pPr&&ranges.get(pPr),baseRun=elements(elements(node).find(n=>isW(n,'r'))).find(n=>isW(n,'rPr'));
   if(!range||source.type!=='paragraph')fail('DELIVERY_MAPPING','修改引用了无法核对的原文段落');
   let replacement=xml.slice(range.start,range.end);
   if(work.text!==source.text){if(!plain(node)||paragraphText(node)!==source.text)fail('DELIVERY_COMPLEX','原段落含域、修订或其他复杂内容，已阻止不可靠改写导出');
    const chunks=diffForExport(review,source.text,work.text,work.blockId,coarseDiffBlocks);replacement='<w:p'+Array.from(node.attributes).map(a=>' '+a.name+'="'+esc(a.value)+'"').join('')+(node.lookupNamespaceURI('w')===W?'':' xmlns:w="'+W+'"')+'>'+(pRange?xml.slice(pRange.start,pRange.end):'')+rewriteRuns(source.text,work.text,chunks,runSpans(node),baseRun,XMLSerializer,doc,mode,revisions)+'</w:p>';rewritten++;
   }
   for(const addition of work.appendTexts){const properties=pPr?pPr.cloneNode(true):doc.createElementNS(W,'w:pPr');for(const item of elements(properties))if(['sectPr','numPr','outlineLvl','pageBreakBefore','pPrChange'].some(name=>isW(item,name)))item.remove();for(const item of Array.from(properties.getElementsByTagName('*')))if(['ins','del','moveFrom','moveTo','rPrChange'].some(name=>isW(item,name)))item.remove();const numPr=doc.createElementNS(W,'w:numPr'),numId=doc.createElementNS(W,'w:numId');numId.setAttributeNS(W,'w:val','0');numPr.appendChild(numId);const beforeNumbering=['pStyle','keepNext','keepLines','pageBreakBefore','framePr','widowControl'];properties.insertBefore(numPr,elements(properties).find(n=>!beforeNumbering.some(name=>isW(n,name)))||null);
    if(mode==='tracked'){let markProps=elements(properties).find(n=>isW(n,'rPr'));if(!markProps){markProps=doc.createElementNS(W,'w:rPr');properties.insertBefore(markProps,elements(properties).find(n=>isW(n,'pPrChange'))||null);}for(const item of elements(markProps))if(['ins','del','moveFrom','moveTo','rPrChange'].some(name=>isW(item,name)))item.remove();const mark=new DOMParser().parseFromString('<w:ins xmlns:w="'+W+'"'+revisions.attributes()+'/>','application/xml').documentElement;markProps.insertBefore(doc.importNode(mark,true),markProps.firstChild);}
    const runs=textRuns(addition.text,mode==='review',baseRun,XMLSerializer,doc,false,null,mode==='review'),marked=mode==='tracked'?'<w:ins'+revisions.attributes()+'>'+runs+'</w:ins>':runs;replacement+='<w:p xmlns:w="'+W+'">'+new XMLSerializer().serializeToString(properties)+marked+'</w:p>';appended++;revisions.insertedCharacters+=Array.from(addition.text).length;
   }
   patches.push({...range,replacement,blockId:work.blockId});
  }
  let resultXml=xml;for(const patch of patches.sort((a,b)=>b.start-a.start))resultXml=resultXml.slice(0,patch.start)+patch.replacement+resultXml.slice(patch.end);
  const checked=new DOMParser().parseFromString(resultXml,'application/xml');if(checked.getElementsByTagName('parsererror').length)fail('DELIVERY_XML','修改后的 Word XML 校验失败，未导出');
  const changedParts=[];if(patches.length){zip.file('word/document.xml',resultXml);changedParts.push('word/document.xml');if(mode==='tracked')await showRevisionMarkup(zip,DOMParser,XMLSerializer,changedParts);}const output=patches.length?await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}):bytes;
  const blob=new Blob([output],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),receipt={schemaVersion:1,draftId:draft.id,revision:draft.revision,mode,sourceHash,outputHash:store.sha256(output),acceptedRequests:accepted.map(r=>r.id),changedBlocks:patches.map(p=>p.blockId),appendedParagraphs:appended,rewrittenParagraphs:rewritten,changedParts,comparisonBaseline:'uploaded-original',revisionMarkup:patches.length?({review:'fixed-redline',tracked:'word-tracked-changes',clean:'none'}[mode]):'none',insertedCharacters:revisions.insertedCharacters,deletedCharacters:revisions.deletedCharacters,coarseDiffBlocks,layoutVerified:false};
  return {blob,fileName:file.name.replace(/\.docx$/i,'')+'-'+({review:'标红对照版',tracked:'Word修订版',clean:'当前工作稿'}[mode])+'.docx',receipt};
 }
 return Object.freeze({exportDocx});
});
