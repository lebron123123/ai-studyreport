/* Adapter from published report logic to a reviewable project gap ledger. Reading never saves or mutates project state. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ReportGapWorkflow=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const VERSION='report-gap-workflow-v1';
  const copy=x=>JSON.parse(JSON.stringify(x));
  const text=x=>String(x==null?'':x).trim();
  function registryApi(){if(root.ReportGapRegistry)return root.ReportGapRegistry;if(typeof require==='function')return require('./report-gap-registry.js');throw new Error('缺口台账模块未加载');}
  function logicApi(ctx){if(ctx?.logicCore)return ctx.logicCore;if(root.ReportLogicCore)return root.ReportLogicCore;if(typeof require==='function'){require('./report-logic-core.js');return root.ReportLogicCore;}throw new Error('逐小节生成逻辑模块未加载');}
  const sectionKey=(chapter,section)=>text(chapter.name)+' / '+text(section.t||section.title);
  function activeSections(ctx){return(ctx.chapters||[]).filter(c=>c.checked!==false).flatMap(c=>(c.sections||[]).filter(s=>s.checked!==false).map(s=>({key:sectionKey(c,s),chapter:c,section:s})));}
  function effectiveType(ctx){return ['rent','sale','gaibao'].includes(ctx.projectType)?ctx.projectType:'rent';}
  function effectiveScenario(ctx){return effectiveType(ctx)==='gaibao'?(ctx.businessScenario==='commercial_renovation'?'commercial_renovation':'housing_conversion'):'';}
  function materialId(material){const m=material||{};return text(m.fileId||m.id||m.documentId)||'material-content:'+registryApi().fingerprint({title:text(m.title||m.fileName),content:String(m.content??m.text??m.extractedText??'')});}
  function sourceSnapshot(context,options){
    const ctx=context||{},G=registryApi(),project=ctx.project||{},materials=ctx.materials||[];
    // Hash actual extracted content, not a client-supplied contentHash alone. No report prose/candidate/task timestamps.
    const materialKeys=materials.map(m=>({id:text(m.fileId||m.id||m.documentId),title:text(m.title||m.fileName),source:text(m.source||m.kind),version:m.version||m.revision||null,status:text(m.status||m.parseStatus),ruleIds:(m.ruleIds||[]).slice().sort(),content:options?.fullContent?String(m.content??m.text??m.extractedText??''):G.fingerprint(m.content??m.text??m.extractedText??''),claimedContentHash:text(m.contentHash)})).sort((a,b)=>G.fingerprint(a).localeCompare(G.fingerprint(b)));
    const outline=activeSections(ctx).map(s=>s.key);
    return {projectKey:text(ctx.projectKey),projectType:effectiveType(ctx),businessScenario:effectiveScenario(ctx),project,calcParams:ctx.calcParams||{},materials:materialKeys,outline,requirements:ctx.logicData?.rules||[],requirementOverrides:ctx.context?.requirementOverrides||ctx.requirementOverrides||{}};
  }
  function sourceRevision(context){return 'gap-source:'+registryApi().fingerprint(sourceSnapshot(context));}
  function trustedContext(ctx){const result=Object.assign({},ctx?.context||{},ctx||{});result.projectKey=text(ctx?.projectKey);result.sourceRevision=ctx?.sourceRevision||sourceRevision(ctx);return result;}
  function requirementDisplayHint(rule){
    // Existing business labels distinguish legacy same-title rules without merging their identities.
    // Long writing instructions are not suitable report labels and are never paraphrased into a fact.
    for(const value of [rule.pointTitle,rule.note,rule.writingLogic]){
      const candidate=text(value).replace(/^\d+(?:\.\d+)*\s*/,'');
      if(candidate&&candidate!=='/'&&candidate!=='未标注'&&candidate.length<=40&&!/[\n。；→]/.test(candidate))return candidate;
    }
    return '';
  }
  function requirementRows(ctx){
    const L=logicApi(ctx),project=ctx.project||{},options=Object.assign({},ctx.context||{},{projectType:effectiveType(ctx),businessScenario:effectiveScenario(ctx),projectText:[project.name,project.type,project.location,project.desc].filter(Boolean).join(' '),location:text(ctx.context?.location||project.location)}),rows=[],unmatched=[],managedByBasisCatalog=[];
    const writing=root.ReportWritingStandard||(typeof require==='function'?require('./report-writing-standard.js'):null);
    if(!L?.matchRules||!L?.dataRequirement)throw new Error('逐小节逻辑不支持共享的数据需求投影，请刷新页面');
    for(const s of activeSections(ctx)){
      if(writing?.sectionProfile({chapter:s.chapter.name,title:s.section.t||s.section.title}).id==='basis'){managedByBasisCatalog.push(s.key);continue;}
      const rules=L.matchRules(ctx.logicData,s.chapter.name,s.section.t||s.section.title,options);
      if(!rules.length)unmatched.push(s.key);
      for(const rule of rules){
        const effective=L.dataRequirement(rule,options),precise=rule.explicitFactFields===true||effective.explicitFactFields===true;
        // Default metadata dictionaries describe acquisition schemas, not automatically missing business facts.
        // Keep a requirement-level review item unless the configuration explicitly defines actual fact identities.
        const fields=precise?effective.fields:[{key:'requirement',label:text(effective.title||rule.displayTitle||rule.section),required:true}];
        rows.push(Object.assign({},effective,{sectionKey:s.key,sectionLabel:s.key,scenario:effectiveScenario(ctx)||effectiveType(ctx),objectKey:'rule:'+text(rule.id||effective.requirementId),critical:rule.critical===true||/^★★★/.test(rule.importance||'')||effective.decision?.level==='core'||effective.dataNature==='calculation',fields,fieldInventory:copy(effective.fields||[]),evidenceGoal:text(effective.evidenceGoal),impact:text(effective.decision?.reason),sourceRuleId:rule.id,requirementDisplayHint:precise?'':requirementDisplayHint(rule)}));
      }
    }
    const labels=new Map();
    for(const row of rows)for(const field of row.fields||[]){const label=text(field.label);if(!labels.has(label))labels.set(label,new Set());labels.get(label).add(row.objectKey);}
    for(const row of rows)if(row.requirementDisplayHint)for(const field of row.fields||[])if(labels.get(text(field.label))?.size>1&&!text(field.label).includes(row.requirementDisplayHint))field.label+=' · '+row.requirementDisplayHint;
    return {rows,unmatched,managedByBasisCatalog};
  }
  function create(context){
    const ctx=context||{},G=registryApi(),revision=sourceRevision(ctx),trust=Object.assign({},trustedContext(ctx),{sourceRevision:revision}),derived=requirementRows(ctx),registry=G.fromRequirements(derived.rows,trust,ctx.previous),sections=activeSections(ctx);
    const sectionKeys=sections.map(s=>s.key),issues=[];
    if(ctx.previous?.activation)registry.activation=copy(ctx.previous.activation);
    for(const r of registry.records)if(!sectionKeys.includes(r.ownerSection))issues.push({code:'owner-section-missing',severity:'error',gapId:r.id,message:'缺口主位置已不在当前目录中，请重新分配后再应用'});
    if(!derived.rows.length)issues.push({code:'no-effective-requirements',severity:'error',gapId:'',message:'当前目录未匹配到已发布数据需求，不能将空台账视为资料齐备'});
    registry.issues.push(...issues);registry.valid=registry.valid&&!issues.length;
    return {registry,requirements:derived.rows,sectionKeys,sourceRevision:revision,projectKey:trust.projectKey,legacyCandidates:G.legacyCandidates(sections.map(s=>({sectionKey:s.key,text:s.section.editedHtml||s.section.content||''}))),coverage:{matched:sectionKeys.length-derived.unmatched.length-derived.managedByBasisCatalog.length,total:sectionKeys.length,unmatched:derived.unmatched,managedByBasisCatalog:derived.managedByBasisCatalog},active:!!registry.activation&&registry.activation.confirmed===true&&registry.activation.sourceRevision===revision};
  }
  function section(raw,key,context){return registryApi().presentation(raw,key,context||{projectKey:raw?.projectKey,sourceRevision:raw?.sourceRevision});}
  function contract(raw,key,context){const G=registryApi(),p=section(raw,key,context);if(!p.valid)throw new Error('缺口台账未通过完整性检查');return {version:'report-gap-requirements-v1',registryHash:G.fingerprint(raw),sourceRevision:raw.sourceRevision,primaryMarkers:p.primaryMarkers,references:p.references,forbiddenMarkers:p.forbiddenMarkers};}
  function prompt(raw,context){return registryApi().assessmentPrompt(raw,context||{projectKey:raw?.projectKey,sourceRevision:raw?.sourceRevision});}
  function assess(raw,proposals,context){return registryApi().reconcile(raw,proposals,context);}
  function apply(workflow,raw,context){
    const ctx=context||{},G=registryApi();
    if(ctx.confirmed!==true||!text(ctx.actorId)||!text(ctx.projectKey)||!text(ctx.sourceRevision))throw new Error('应用资料缺口台账须明确人工确认并绑定当前项目及资料版本');
    if(raw?.projectKey!==ctx.projectKey||raw?.sourceRevision!==ctx.sourceRevision)throw new Error('项目或资料已变化，未应用旧台账');
    const registry=G.normalize(raw,ctx);if(!registry.valid)throw new Error('缺口台账未通过完整性检查，未覆盖已保存记录');
    if(Array.isArray(ctx.sectionKeys)&&registry.records.some(r=>!ctx.sectionKeys.includes(r.ownerSection)))throw new Error('缺口主位置不在当前目录中，未应用');
    const next=copy(workflow||{});registry.activation={confirmed:true,actorId:text(ctx.actorId),sourceRevision:ctx.sourceRevision,at:text(ctx.at)||new Date().toISOString()};
    next.reportGapRegistry=registry;return next;
  }
  function fromSaved(saved,options){
    const s=saved?.draft||saved?.legacySnapshot||saved||{},o=options||{},snapshot=(s.workflow?.calcSnapshots||[]).find(x=>x.id===s.workflow?.currentCalcSnapshotId);
    return {projectKey:text(o.projectKey||s.projectId),projectType:o.projectType||s.calcType||s.rptCtype||snapshot?.calcType||'rent',businessScenario:o.businessScenario||s.project?.businessScenario||s.aiReportExtracted?.businessScenario||'',project:s.project||{},calcParams:s.calcParams||{},materials:s.kb||[],chapters:s.chapters||[],logicData:o.logicData||{},context:{requirementOverrides:o.requirementOverrides||{},...(o.context||{})},previous:s.workflow?.reportGapRegistry,...(o.verifiedEvidence?{verifiedEvidence:o.verifiedEvidence}:{}),...(o.trustedApprovals?{trustedApprovals:o.trustedApprovals}:{})};
  }
  return Object.freeze({VERSION,materialId,sourceSnapshot,sourceRevision,fromSaved,create,section,contract,prompt,assess,apply});
});
