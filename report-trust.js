/* AI可研可信度与版本血缘：纯函数，浏览器和Node测试共用。 */
(function(root){
  "use strict";
  const TYPES={FACT:"FACT",ASSUMPTION:"ASSUMPTION",CALCULATION:"CALCULATION",AI_JUDGEMENT:"AI_JUDGEMENT"};
  const TYPE_LABELS={FACT:"事实依据",ASSUMPTION:"假设/待核",CALCULATION:"白箱计算",AI_JUDGEMENT:"AI分析判断"};
  function hash(value){const s=JSON.stringify(value==null?null:value);let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,"0");}
  function first(){for(let i=0;i<arguments.length;i++)if(arguments[i]!==undefined&&arguments[i]!==null&&arguments[i]!=="")return arguments[i];return null;}
  function compactRef(id,version,value){if(id||version)return {id:id||null,version:version||null,hash:value==null?null:hash(value)};return value==null?null:{id:null,version:null,hash:hash(value)};}
  function buildLineage(state,meta){
    state=state||{};meta=meta||{};
    const calc=(state.calcSnapshots||[]).find(x=>x&&x.id===state.currentCalcSnapshotId)||null;
    const analysis=(state.analysisSnapshots||[]).find(x=>x&&x.id===state.currentAnalysisSnapshotId)||null;
    const lineage={schemaVersion:1,
      projectData:compactRef(first(meta.projectDataId,state.projectDataId),first(meta.projectDataVersion,state.projectDataVersion),first(meta.projectData,state.projectData)),
      parameterSet:compactRef(first(meta.parameterSetId,state.parameterSetId),first(meta.parameterSetVersion,state.parameterSetVersion),first(meta.parameterSet,calc&&calc.params)),
      calculation:compactRef(first(meta.calcSnapshotId,state.currentCalcSnapshotId),first(meta.calcSnapshotVersion,calc&&calc.version),first(meta.calculation,calc)),
      calcEngineVersion:first(meta.calcEngineVersion,state.calcEngineVersion,calc&&calc.engineVersion),
      analysis:compactRef(first(meta.analysisSnapshotId,state.currentAnalysisSnapshotId),first(meta.analysisSnapshotVersion,analysis&&analysis.version),first(meta.analysis,analysis)),
      knowledge:compactRef(first(meta.knowledgeSnapshotId,state.knowledgeSnapshotId),first(meta.knowledgeSnapshotVersion,state.knowledgeSnapshotVersion),first(meta.knowledgeSnapshot,state.knowledgeSnapshot)),
      evidence:compactRef(first(meta.evidenceSnapshotId,state.evidenceSnapshotId),first(meta.evidenceSnapshotVersion,state.evidenceSnapshotVersion),first(meta.evidenceSnapshot,state.evidenceSnapshot)),
      workflowVersion:first(meta.workflowVersion,state.workflowVersion),promptVersion:first(meta.promptVersion,state.promptVersion),model:first(meta.model,state.model),
      review:compactRef(first(meta.reviewSnapshotId,state.reviewSnapshotId),first(meta.reviewSnapshotVersion,state.reviewSnapshotVersion),first(meta.reviewSnapshot,state.reviewSnapshot))};
    lineage.hash=hash(lineage);return lineage;
  }
  function evidenceCount(prov){prov=prov||{};return (prov.rag||[]).length+(prov.kbDocs||[]).length+(prov.excelSources||[]).length+(prov.webEvidence||prov.web||[]).length;}
  function buildSectionProfile(section,ctx){
    section=section||{};ctx=ctx||{};const prov=section.prov||{},text=String(section.editedHtml||section.content||"");
    const hasMissing=/【待补[:：]|待填|待核|尚未提供|暂无数据/.test(text),types=[];
    if(prov.hasCalcData||(prov.excelSources||[]).length||section.numeric&&ctx.hasCalculation)types.push(TYPES.CALCULATION);
    if((prov.rag||[]).length||(prov.kbDocs||[]).length||(prov.webEvidence||prov.web||[]).length||(prov.projectFields||[]).length)types.push(TYPES.FACT);
    if(hasMissing||section.syncStatus==="stale"||section.syncStatus==="locked-stale")types.push(TYPES.ASSUMPTION);
    if(prov.model||!types.length)types.push(TYPES.AI_JUDGEMENT);
    const uniq=[...new Set(types)],reasons=[],stale=['stale','locked-stale'].includes(section.syncStatus);
    if(prov.hasCalcData)reasons.push('已提供测算上下文，正文数字仍需勾稽');if((prov.excelSources||[]).length)reasons.push('含单元格来源，仍需核对数值口径');if(evidenceCount(prov))reasons.push('检索/资料来源 '+evidenceCount(prov)+' 项，不代表逐句已核验');
    if(hasMissing)reasons.push('仍有待补或待核内容');if(stale)reasons.push('正文与当前数据版本待同步');if(section.pendingRevision)reasons.push('存在尚未接受的候选修改');
    const status=stale?'stale':hasMissing?'missing':section.pendingRevision?'pending':evidenceCount(prov)||prov.hasCalcData?'sources_available':'unverified';
    const grade={stale:'待同步',missing:'待补核',pending:'待确认',sources_available:'有来源·待核对',unverified:'待核验'}[status];
    reasons.push('不根据素材种类计算准确率；正式结论需独立复核');
    const primary=uniq.includes(TYPES.CALCULATION)?TYPES.CALCULATION:uniq.includes(TYPES.FACT)?TYPES.FACT:uniq.includes(TYPES.ASSUMPTION)?TYPES.ASSUMPTION:TYPES.AI_JUDGEMENT;
    return {schemaVersion:2,types:uniq,primaryType:primary,score:null,status,grade,reasons,hasMissing,evidenceCount:evidenceCount(prov),independentReviewRequired:true};
  }
  function buildReportSummary(chapters,ctx){const items=[];(chapters||[]).forEach(c=>(c.sections||[]).forEach((s,si)=>items.push({cn:c.cn,si,title:s.t,profile:buildSectionProfile(s,ctx)})));const typeCounts=Object.fromEntries(Object.values(TYPES).map(t=>[t,items.filter(x=>x.profile.types.includes(t)).length]));return {schemaVersion:2,total:items.length,averageScore:null,high:0,low:0,typeCounts,statusCounts:Object.fromEntries(['stale','missing','pending','sources_available','unverified'].map(k=>[k,items.filter(x=>x.profile.status===k).length])),attention:items,independentReviewRequired:true};}
  const api={TYPES,TYPE_LABELS,hash,buildLineage,buildSectionProfile,buildReportSummary};root.ReportTrust=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
