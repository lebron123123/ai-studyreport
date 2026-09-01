/* Investment OS Phase 2.5 后半程：数据注册表、文件智能、影响链和空间工作区纯逻辑。 */
(function(root){
  "use strict";
  const PE_KINDS=new Set(["fact","parameter","metric","evidence"]);
  const PE_STATUSES=new Set(["candidate","confirmed","rejected","superseded","missing","conflict"]);
  const PE_FILE_STATUS=new Set(["registered","parsing","parsed","needs_review","approved","superseded","failed"]);
  const peText=(v,n=300)=>String(v==null?"":v).trim().slice(0,n);
  const peArr=v=>Array.isArray(v)?v:[];
  const peNum=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const peJson=(v,f={})=>{try{return typeof v==="string"?JSON.parse(v):v==null?f:v;}catch(_){return f;}};
  const peClone=v=>JSON.parse(JSON.stringify(v==null?null:v));
  function normalizeFile(input){
    input=input||{};const status=PE_FILE_STATUS.has(input.status)?input.status:"registered";
    return {id:peText(input.id,100),projectId:peText(input.projectId||input.project_id,100),name:peText(input.name||input.file_name,220)||"未命名文件",fileType:peText(input.fileType||input.file_type,40),category:peText(input.category||"other",60),storageRef:peText(input.storageRef||input.storage_ref,500),fingerprint:peText(input.fingerprint,160),version:Math.max(1,peNum(input.version,1)),status,parseStatus:peText(input.parseStatus||input.parse_status||"pending",40),isCurrent:input.isCurrent!==false&&Number(input.is_current)!==0,parentFileId:peText(input.parentFileId||input.parent_file_id,100),sizeBytes:Math.max(0,peNum(input.sizeBytes||input.size_bytes)),meta:peJson(input.meta||input.meta_json,{})};
  }
  function normalizeExtraction(input){
    input=input||{};return {id:peText(input.id,100),fileId:peText(input.fileId||input.file_id,100),type:peText(input.type||input.extractionType||input.extraction_type,40)||"fact",key:peText(input.key||input.item_key,160),label:peText(input.label,200),value:peClone(input.value!==undefined?input.value:peJson(input.value_json,null)),sourceLocation:peText(input.sourceLocation||input.source_location,300),confidence:Math.max(0,Math.min(1,peNum(input.confidence,0.5))),reviewStatus:peText(input.reviewStatus||input.review_status||"candidate",30),targetRef:peText(input.targetRef||input.target_ref,180)};
  }
  function buildDataRegistry(input){
    input=input||{};const facts=peArr(input.facts),metrics=peArr(input.metrics),artifacts=peArr(input.artifacts),extractions=peArr(input.extractions).map(normalizeExtraction),issues=peArr(input.issues),rows=[];
    facts.forEach(x=>rows.push({id:x.id,kind:x.factType==="ASSUMPTION"?"parameter":"fact",key:x.factKey,label:x.label||x.factKey,value:peClone(x.value),unit:x.unit||"",status:PE_STATUSES.has(x.status)?x.status:"candidate",sourceType:x.sourceType||"",sourceRef:x.sourceRef||"",version:peNum(x.version,1),confidence:peNum(x.confidence,1),lineage:{source:x.sourceRef||"",sourceType:x.sourceType||""}}));
    metrics.forEach(x=>rows.push({id:x.id,kind:"metric",key:x.metricKey,label:x.label||x.metricKey,value:peClone(x.value),unit:x.unit||"",status:"confirmed",sourceType:"whitebox",sourceRef:x.calcSnapshotId||"",version:peNum(x.version,1),confidence:1,lineage:peJson(x.lineage,{})}));
    artifacts.forEach(x=>rows.push({id:x.id,kind:"evidence",key:x.id,label:x.title||x.artifactType,value:x.version||"",unit:"",status:x.status==="signed"||x.status==="current"?"confirmed":"candidate",sourceType:x.artifactType||"artifact",sourceRef:x.moduleRef||"",version:x.version||1,confidence:1,lineage:{evidenceAuditId:x.evidenceAuditId||"",meta:x.meta||{}}}));
    extractions.forEach(x=>{if(!x.key)return;rows.push({id:x.id,kind:PE_KINDS.has(x.type)?x.type:"fact",key:x.key,label:x.label||x.key,value:x.value,unit:"",status:x.reviewStatus==="approved"?"confirmed":x.reviewStatus,sourceType:"file_extraction",sourceRef:x.fileId+"#"+x.sourceLocation,version:1,confidence:x.confidence,lineage:{fileId:x.fileId,sourceLocation:x.sourceLocation,targetRef:x.targetRef}});});
    const byKey=new Map();rows.forEach(x=>{const key=x.kind+":"+x.key;if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push(x);});
    const conflicts=[];for(const [key,list] of byKey){const values=new Set(list.filter(x=>x.status!=="rejected"&&x.value!==null&&x.value!=="").map(x=>JSON.stringify(x.value)));if(values.size>1)conflicts.push({key,values:[...values].map(x=>peJson(x,x)),items:list.map(x=>x.id)});}
    const issueMap=new Map(issues.map(x=>[(x.item_kind||x.kind)+":"+(x.item_key||x.key),x]));
    rows.forEach(x=>{const issue=issueMap.get(x.kind+":"+x.key);if(issue)x.issue={type:issue.issue_type||issue.type,severity:issue.severity,description:issue.description,status:issue.status};if(conflicts.some(c=>c.key===x.kind+":"+x.key))x.status="conflict";});
    const missing=issues.filter(x=>(x.issue_type||x.type)==="missing"&&x.status!=="resolved");
    return {rows,summary:{total:rows.length,confirmed:rows.filter(x=>x.status==="confirmed").length,candidate:rows.filter(x=>x.status==="candidate").length,conflicts:conflicts.length,missing:missing.length},conflicts,missing};
  }
  function buildFileIntelligence(input){
    input=input||{};const files=peArr(input.files).map(normalizeFile),extractions=peArr(input.extractions).map(normalizeExtraction),byName=new Map();
    files.forEach(f=>{const k=f.name.toLowerCase();if(!byName.has(k))byName.set(k,[]);byName.get(k).push(f);});
    const versions=[];for(const list of byName.values()){list.sort((a,b)=>b.version-a.version);list.forEach((f,i)=>{f.isLatest=i===0;f.isOldVersion=i>0||!f.isCurrent;if(f.isOldVersion&&f.status!=="superseded")f.versionWarning="存在更新版本";});versions.push(...list);}
    versions.forEach(f=>{const rows=extractions.filter(x=>x.fileId===f.id);f.extractions=rows;f.extractionSummary={total:rows.length,approved:rows.filter(x=>x.reviewStatus==="approved").length,candidate:rows.filter(x=>x.reviewStatus==="candidate").length,lowConfidence:rows.filter(x=>x.confidence<0.7).length};});
    return {files:versions,summary:{total:versions.length,current:versions.filter(x=>x.isLatest&&x.isCurrent).length,pending:versions.filter(x=>["registered","parsing","needs_review"].includes(x.status)).length,failed:versions.filter(x=>x.status==="failed").length,extractions:extractions.length},categories:Object.entries(versions.reduce((m,x)=>(m[x.category]=(m[x.category]||0)+1,m),{})).map(([category,count])=>({category,count}))};
  }
  function buildImpactChains(input){
    input=input||{};const decisions=peArr(input.decisions),changes=peArr(input.changes),scenarios=peArr(input.scenarios),artifacts=peArr(input.artifacts);
    return decisions.map(d=>{const linked=changes.filter(c=>c.decisionId===d.id||c.decision_id===d.id||peArr(c.impact&&c.impact.decisionIds).includes(d.id)),params=[],metrics=[],sections=[];linked.forEach(c=>{peArr(c.impact&&c.impact.changedValues).forEach(x=>params.push(x));peArr(c.impact&&c.impact.affectedMetrics).forEach(x=>metrics.push(x));peArr(c.impact&&c.impact.affectedSections).forEach(x=>sections.push(x));});const evidenceIds=peArr(d.evidenceIds||d.evidence_ids),scenarioIds=peArr(d.scenarioIds||d.scenario_ids);return {decision:{id:d.id,topic:d.topic,decision:d.decision||d.decisionText||d.decision_text,status:d.status,owner:d.owner},parameters:params,metrics,sections,scenarios:scenarios.filter(x=>scenarioIds.includes(x.id)),evidence:artifacts.filter(x=>evidenceIds.includes(x.id)),changes:linked,complete:!!(linked.length&&metrics.length&&sections.length)};});
  }
  function buildSpatialWorkspace(input){
    input=input||{};const scope=input.scope||null,observations=peArr(input.observations),pois=peArr(input.pois),od=peArr(input.odFlows),snapshots=peArr(input.snapshots),poiCounts={};pois.forEach(x=>{const k=x.category||"other";poiCounts[k]=(poiCounts[k]||0)+1;});
    const topOrigins=[...od].sort((a,b)=>peNum(b.population)-peNum(a.population)).slice(0,10).map(x=>({origin:x.originName||x.origin_name,destination:x.destinationName||x.destination_name,population:peNum(x.population),distanceKm:x.distanceKm||x.distance_km||null}));
    return {configured:!!(scope&&Number.isFinite(Number(scope.longitude))&&Number.isFinite(Number(scope.latitude))),scope:scope?{longitude:peNum(scope.longitude),latitude:peNum(scope.latitude),rings:peText(scope.scope_value||scope.scopeValue||"1,3,5",30),confirmedBy:scope.confirmed_by||scope.confirmedBy||""}:null,summary:{observations:observations.length,pois:pois.length,odFlows:od.length,snapshots:snapshots.length},poiCounts:Object.entries(poiCounts).map(([category,count])=>({category,count})).sort((a,b)=>b.count-a.count),metrics:observations.slice(0,30),topOrigins,latestSnapshot:snapshots[0]||null};
  }
  const api={normalizeFile,normalizeExtraction,buildDataRegistry,buildFileIntelligence,buildImpactChains,buildSpatialWorkspace};
  root.ProjectEnterprise=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
