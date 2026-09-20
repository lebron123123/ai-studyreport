// Immutable delivery format. Never re-project stored v1 snapshots before validating their original hash.
function copy(value){return value===undefined?null:JSON.parse(JSON.stringify(value));}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
export function legacyDeliverySnapshot(data){
  return {chapters:(data.chapters||[]).map(c=>({name:String(c.name||c.title||''),sections:(c.sections||[]).map(s=>({title:String(s.t||s.title||''),content:String(s.editedHtml||s.content||'')}))})),calculations:data.workflow?.calcSnapshots||data.calcParams||{}};
}
function paragraphs(content,sectionId){
  // IDs are stable positions within this immutable version, scoped by its content hash.
  return String(content).replace(/<\/(?:p|div|li|tr|h[1-6])>|<br\s*\/?>/gi,'\n').split(/\r?\n/).map(text=>text.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').trim()).filter(Boolean).map((text,index)=>({id:sectionId+':p'+(index+1),ordinal:index+1,text}));
}
export function deliveryVisibleText(content){return String(content||'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|#160|#xA0);/gi,' ').replace(/[\s\u200b-\u200d\ufeff]/g,'');}
export function deliverySnapshot(data,schemaVersion=3){
  if(schemaVersion===1)return legacyDeliverySnapshot(data);
  if(schemaVersion===3){const snapshot=deliverySnapshot(data,2);snapshot.schemaVersion=3;snapshot.chapters=snapshot.chapters.filter(c=>c.checked);snapshot.project=copy(data.project||{});snapshot.exportContext={calcResult:copy(data.calcResult),calcSummary:copy(data.calcSummary),domainKey:copy(data.domainKey),docNo:copy(data.docNo)};return canonical(snapshot);}
  if(schemaVersion!==2)throw new Error('不支持的冻结快照版本');
  const wf=data.workflow||{},active=(wf.reportVersions||[]).find(v=>v.id===wf.currentReportVersionId);
  const logic={};for(const key of ['globalRequirements','reportGlobalRequirements','reportLogicVersion','logicVersion','reportLogicPlan','promptVersion','workflowVersion'])if(wf[key]!==undefined)logic[key]=copy(wf[key]);
  return canonical({schemaVersion:2,chapters:(data.chapters||[]).map((c,ci)=>({id:'c'+(ci+1),sourceId:copy(c.id??c.cn),name:String(c.name||c.title||''),checked:c.checked!==false,sections:(c.sections||[]).map((s,si)=>{
    const id='c'+(ci+1)+':s'+(si+1),content=String(s.editedHtml||s.content||'');
    return {id,sourceId:copy(s.id??s.key),title:String(s.t||s.title||''),content,numeric:!!s.numeric,prov:copy(s.prov),logicSnapshot:copy(s.logicSnapshot),lineage:copy(s.lineage),referenceStatus:s.prov?'recorded_unverified':'unknown',paragraphs:paragraphs(content,id)};
  })})),calculations:copy(wf.calcSnapshots||data.calcParams||{}),references:{status:'recorded_unverified',kb:copy(data.kb||[]),logic,lineage:copy(wf.lineage||active?.lineage),currentCalcSnapshotId:copy(wf.currentCalcSnapshotId),currentAnalysisSnapshotId:copy(wf.currentAnalysisSnapshotId),knowledgeSnapshot:copy(wf.knowledgeSnapshot),evidenceSnapshot:copy(wf.evidenceSnapshot)},restoreInput:{calcParams:copy(data.calcParams),domainKey:copy(data.domainKey)},paragraphIdentity:'contentHash + sectionId + paragraph ordinal; not cross-version semantic identity'});
}
export function deliverySchema(snapshot){
  if(snapshot?.schemaVersion===undefined)return 1;
  if(![2,3].includes(snapshot.schemaVersion))throw new Error('不支持的冻结快照版本');
  return snapshot.schemaVersion;
}
export function restoreDeliveryDraft(data,snapshot,deliveryId,contentHash){
  const schema=deliverySchema(snapshot),next=copy(data),wf=next.workflow||(next.workflow={});
  next.chapters=snapshot.chapters.map((c,ci)=>({cn:c.sourceId??ci+1,name:c.name,checked:c.checked!==false,sections:c.sections.map(s=>({t:s.title,content:s.content,editedHtml:null,numeric:!!s.numeric,prov:copy(s.prov),logicSnapshot:copy(s.logicSnapshot),lineage:copy(s.lineage),locked:false,syncStatus:'stale',staleKind:'restored',staleReason:'从冻结历史恢复的未签发工作稿，请重新核对当前资料、规则及测算版本',staleKeys:['restored_delivery'],pendingRevision:null,undoStack:[],restoredParagraphs:copy(s.paragraphs)}))}));
  next.signed=false;next.docNo=null;next.documentRevision=(Number(data.documentRevision)||0)+1;
  wf.currentReportVersionId=null; // reportVersions and every formal delivery remain append-only history.
  wf.restoredDelivery={id:deliveryId,contentHash,schemaVersion:schema,referenceStatus:schema===1?'unknown':'recorded_unverified',requiresReview:true};
  if(schema>=2){next.kb=copy(snapshot.references.kb||[]);wf.lineage=copy(snapshot.references.lineage);for(const [key,value]of Object.entries(snapshot.references.logic||{}))wf[key]=copy(value);}
  else next.kb=[]; // Old snapshots did not record sources; never borrow today's references as historical evidence.
  // Do not roll back current project facts/calculation parameters or remove calculation history.
  // Their exact historical values remain available in the immutable snapshot for manual reconciliation.
  return next;
}
