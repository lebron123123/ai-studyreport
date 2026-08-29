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
      calcEngineVersion:first(meta.calcEngineVersion,state.calcEngineVersion,calc&&calc.engineVersion,"whitebox-v1"),
      analysis:compactRef(first(meta.analysisSnapshotId,state.currentAnalysisSnapshotId),first(meta.analysisSnapshotVersion,analysis&&analysis.version),first(meta.analysis,analysis)),
      knowledge:compactRef(first(meta.knowledgeSnapshotId,state.knowledgeSnapshotId),first(meta.knowledgeSnapshotVersion,state.knowledgeSnapshotVersion),first(meta.knowledgeSnapshot,state.knowledgeSnapshot)),
      evidence:compactRef(first(meta.evidenceSnapshotId,state.evidenceSnapshotId),first(meta.evidenceSnapshotVersion,state.evidenceSnapshotVersion),first(meta.evidenceSnapshot,state.evidenceSnapshot)),
      workflowVersion:first(meta.workflowVersion,state.workflowVersion,"report-workflow-v1"),promptVersion:first(meta.promptVersion,state.promptVersion,"report-prompt-v1"),model:first(meta.model,state.model),
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
    const uniq=[...new Set(types)];let score=Number(prov.confidence&&prov.confidence.score),reasons=[];
    if(!Number.isFinite(score)){score=0.52;if(prov.hasCalcData)score=Math.max(score,0.94);if((prov.excelSources||[]).length)score=Math.max(score,0.91);if((prov.kbDocs||[]).length)score=Math.max(score,0.80);if((prov.rag||[]).some(x=>Number(x.score)>=0.85))score=Math.max(score,0.85);if((prov.webEvidence||prov.web||[]).some(x=>String(x.authority||"").toUpperCase()==="A"))score=Math.max(score,0.86);}
    if(prov.hasCalcData)reasons.push("含白箱测算结果");if((prov.excelSources||[]).length)reasons.push("含单元格级数据来源");if(evidenceCount(prov))reasons.push("已绑定"+evidenceCount(prov)+"项资料/证据");
    if(hasMissing){score-=0.15;reasons.push("仍有待补或待核内容");}if(section.syncStatus==="stale"||section.syncStatus==="locked-stale"){score-=0.12;reasons.push("正文与当前数据版本待同步");}if(section.pendingRevision){score-=0.05;reasons.push("存在尚未接受的候选修改");}
    score=Math.max(0.2,Math.min(0.99,score));const value=Math.round(score*100),grade=value>=85?"高":value>=70?"中":value>=55?"一般":"低";
    const primary=uniq.includes(TYPES.CALCULATION)?TYPES.CALCULATION:uniq.includes(TYPES.FACT)?TYPES.FACT:uniq.includes(TYPES.ASSUMPTION)?TYPES.ASSUMPTION:TYPES.AI_JUDGEMENT;
    return {schemaVersion:1,types:uniq,primaryType:primary,score:value,grade,reasons,hasMissing,evidenceCount:evidenceCount(prov)};
  }
  function buildReportSummary(chapters,ctx){const items=[];(chapters||[]).forEach(c=>(c.sections||[]).forEach((s,si)=>items.push({cn:c.cn,si,title:s.t,profile:buildSectionProfile(s,ctx)})));const avg=items.length?Math.round(items.reduce((n,x)=>n+x.profile.score,0)/items.length):0;const typeCounts=Object.fromEntries(Object.values(TYPES).map(t=>[t,items.filter(x=>x.profile.types.includes(t)).length]));return {schemaVersion:1,total:items.length,averageScore:avg,high:items.filter(x=>x.profile.score>=85).length,low:items.filter(x=>x.profile.score<55).length,typeCounts,attention:items.filter(x=>x.profile.score<70||x.profile.hasMissing).slice(0,30)};}
  const api={TYPES,TYPE_LABELS,hash,buildLineage,buildSectionProfile,buildReportSummary};root.ReportTrust=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
