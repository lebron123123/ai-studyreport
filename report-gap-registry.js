/* Project-specific evidence gaps. Pure data projections; never writes reports or treats uploaded files as verified facts. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ReportGapRegistry=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='report-gap-registry-v1',SCHEMA_VERSION=1;
  const STATES=Object.freeze(['missing','partial','conflict','unlocated','parse-failed','unverified','satisfied','not-applicable']);
  const CLOSED=new Set(['satisfied','not-applicable']);
  const copy=x=>JSON.parse(JSON.stringify(x));
  const text=x=>String(x==null?'':x).trim();
  const unique=values=>[...new Set(values.map(text).filter(Boolean))];
  const stable=x=>x&&typeof x==='object'?(Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}'):JSON.stringify(x);
  function fingerprint(value){let a=2166136261,b=5381;for(const c of stable(value)){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}return(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
  const escapeHtml=x=>text(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const issue=(code,message,gapId,severity='error')=>({code,message,gapId:gapId||'',severity});
  const safePhrase=x=>text(x).replace(/[【】\r\n]/g,' ').replace(/\s+/g,' ').trim();
  function identity(value){
    const x=value||{};
    if(!text(x.field)||!text(x.object))throw new Error('缺口必须明确字段和对象；不能根据名称相似自动合并');
    return {field:text(x.field),object:text(x.object),geo:x.geo==null?'unspecified':copy(x.geo),time:x.time==null?'unspecified':copy(x.time),scenario:text(x.scenario)||'unspecified'};
  }
  const idFor=x=>'gap-'+fingerprint(identity(x));
  const contextFor=(ctx,raw)=>({projectKey:text(ctx?.projectKey||raw?.projectKey),sourceRevision:text(ctx?.sourceRevision||raw?.sourceRevision)});
  function approvalValid(proof,record,ctx){
    if(!proof||proof.kind!=='human'||proof.confirmed!==true||!text(proof.actorId)||!text(proof.reason)||!text(proof.at))return false;
    if(!(proof.projectKey===ctx.projectKey&&proof.sourceRevision===ctx.sourceRevision&&proof.requirementRevision===record.requirementRevision&&proof.identityKey===stable(record.identity)&&proof.status===record.status))return false;
    // A writable ledger cannot authorize its own exemption. The caller supplies authenticated receipts,
    // or a current explicit human action; a model/client-invented actor name is not authority.
    const action=ctx.humanApproval;
    if(action?.confirmed===true&&text(action.actorId)===proof.actorId&&text(action.reason)===proof.reason&&action.sourceRevision===ctx.sourceRevision&&(action.gapIds||[]).includes(record.id)&&text(action.at)===proof.at)return true;
    return Array.isArray(ctx.trustedApprovals)&&ctx.trustedApprovals.some(approved=>stable(approved)===stable(proof));
  }
  // verifiedEvidence belongs to the trusted caller, not the model proposal. A channel/kind or a file ID alone is never proof.
  function evidenceValid(evidenceId,record,ctx){
    const list=Array.isArray(ctx.verifiedEvidence)?ctx.verifiedEvidence:Object.values(ctx.verifiedEvidence||{});
    return list.some(e=>e&&e.id===evidenceId&&e.verified===true&&e.projectKey===ctx.projectKey&&e.sourceRevision===ctx.sourceRevision&&e.requirementRevision===record.requirementRevision&&e.identityKey===stable(record.identity)&&text(e.locator)&&text(e.claim)&&e.status!=='conflict'&&e.status!=='stale');
  }
  function closedProofValid(record,ctx){
    if(approvalValid(record.approval,record,ctx))return true;
    // Applicability is a judgment, not a fact value. A human must explicitly approve exemptions (critical and ordinary).
    return record.status==='satisfied'&&record.evidenceIds.length>0&&record.evidenceIds.every(id=>evidenceValid(id,record,ctx));
  }
  function normalize(raw,context){
    const ctx=Object.assign({},context||{},contextFor(context,raw));
    const result={schemaVersion:SCHEMA_VERSION,version:VERSION,projectKey:ctx.projectKey,sourceRevision:ctx.sourceRevision,records:[],issues:[],audit:[]};
    if(!ctx.projectKey||!ctx.sourceRevision)result.issues.push(issue('missing-context','缺口台账缺少项目或资料版本，不能用于成稿放行'));
    if(raw==null)return Object.assign(result,{valid:result.issues.length===0});
    if(typeof raw!=='object'||Array.isArray(raw)||raw.schemaVersion!==SCHEMA_VERSION||!Array.isArray(raw.records)){
      result.issues.push(issue('invalid-registry','缺口台账损坏或版本不受支持；原数据必须保留并人工检查'));return Object.assign(result,{valid:false});
    }
    if(raw.projectKey!==ctx.projectKey){result.issues.push(issue('project-mismatch','缺口台账属于其他项目，禁止复用'));return Object.assign(result,{valid:false});}
    result.audit=Array.isArray(raw.audit)?copy(raw.audit):[];
    const ids=new Map();
    for(const value of raw.records){
      try{
        if(!value||typeof value!=='object'||!STATES.includes(value.status)||!Array.isArray(value.sectionKeys)||!Array.isArray(value.evidenceIds))throw new Error('缺口字段或状态无效');
        const ident=identity(value.identity),id=idFor(ident),key=stable(ident);
        if(value.id!==id||ids.has(id))throw new Error(ids.get(id)&&ids.get(id)!==key?'缺口标识冲突':'缺口标识无效或重复');
        ids.set(id,key);
        const sections=unique(value.sectionKeys),owner=text(value.ownerSection);
        if(!owner||!sections.includes(owner)||!text(value.label)||!text(value.requirementRevision))throw new Error('缺口缺少主位置、名称或需求版本');
        const record=Object.assign({},copy(value),{id,identity:ident,sectionKeys:sections,ownerSection:owner,label:text(value.label),status:value.status,critical:value.critical===true,evidenceIds:unique(value.evidenceIds),sourceRevision:ctx.sourceRevision});
        if(!CLOSED.has(record.status)&&record.status!=='unverified'&&(raw.sourceRevision!==ctx.sourceRevision||value.sourceRevision!==ctx.sourceRevision)){
          record.previousStatus=record.status;record.previousAssessment=record.assessment||null;record.status='unverified';record.assessment=null;record.evidenceIds=[];record.invalidatedBy='materials-changed';
          result.issues.push(issue('stale-assessment','资料版本已变化，旧的缺失/冲突判断需重新核验',id,'warning'));
        }
        if(CLOSED.has(record.status)&&!closedProofValid(record,ctx)){
          record.previousStatus=record.status;record.status='unverified';record.invalidatedBy='proof-or-revision-changed';
          result.issues.push(issue('stale-proof','已关闭事项的证据或确认版本不再有效，已恢复为待核验',id,'warning'));
        }
        result.records.push(record);
      }catch(error){result.issues.push(issue('invalid-record',error.message,text(value?.id)));}
    }
    // Textual contracts must distinguish every exact obligation too. Equal text is not permission
    // to collapse distinct objects, geographic scopes or periods into one apparently satisfied note.
    const displayIdentities=new Map();
    for(const record of result.records){
      const peers=result.records.filter(r=>safePhrase(r.label)===safePhrase(record.label));
      let label=safePhrase(record.label);
      if(peers.length>1){label=scopedLabel(record);if(peers.filter(r=>scopedLabel(r)===label).length>1)label+='〔'+safePhrase(record.ownerLabel||record.ownerSection)+'〕';}
      record.presentationLabel=label;
      const prior=displayIdentities.get(label);if(prior&&prior.id!==record.id)result.issues.push(issue('ambiguous-display-identity','同一小节的不同事项名称与范围仍无法区分，请在数据需求中明确业务对象后再应用：'+label,record.id));else displayIdentities.set(label,record);
    }
    // Preserve previously detected structural damage until the source is repaired, not merely reserialized.
    if(raw.valid===false&&Array.isArray(raw.issues))for(const x of raw.issues.filter(x=>x.severity==='error'&&x.code!=='ambiguous-display-identity'))if(!result.issues.some(y=>y.code===x.code&&y.gapId===x.gapId))result.issues.push(copy(x));
    result.valid=!result.issues.some(x=>x.severity==='error');return result;
  }
  function fromRequirements(requirements,context,previous){
    const ctx=Object.assign({},context||{}),old=normalize(previous,ctx),map=new Map(),problems=[];
    if(!Array.isArray(requirements))return Object.assign(old,{valid:false,issues:old.issues.concat(issue('invalid-requirements','数据需求必须是已生效的全项目需求数组'))});
    for(const requirement of requirements){
      const r=requirement||{},section=text(r.sectionKey||ctx.sectionByRequirement?.[r.requirementId]||r.section);
      if(!section||!text(r.requirementId)||!Array.isArray(r.fields)){problems.push(issue('invalid-requirement','数据需求缺少编号、字段或章节归属'));continue;}
      for(const field of r.fields.filter(f=>f&&f.required!==false)){
        const f=typeof field==='string'?{key:field,label:field}:field;
        try{
          // Shared identity must be explicit. Generic factValue/value fields stay requirement-scoped.
          const ident=identity(f.identity||{field:f.factKey||f.key,object:f.objectKey||r.objectKey||r.entityKey||r.requirementId,geo:f.geoScope||r.geoScope,time:f.timeScope||r.timeScope,scenario:r.scenario||ctx.scenario||ctx.projectType});
          const id=idFor(ident),signature=stable(ident),label=text(f.label||f.key);
          if(!label)throw new Error('字段名称缺失');
          const existing=map.get(id);if(existing&&stable(existing.identity)!==signature)throw new Error('字段标识冲突，禁止合并');
          const critical=r.critical===true||f.critical===true||r.decision?.level==='core'||r.dataNature==='calculation';
          if(existing){existing.sectionKeys=unique(existing.sectionKeys.concat(section));existing.requirementIds=unique(existing.requirementIds.concat(r.requirementId));existing.critical=existing.critical||critical;existing.definitions.push({requirementId:r.requirementId,field:f,quality:r.quality||{},revision:r.refinementVersion||r.version||1});continue;}
          map.set(id,{id,identity:ident,label,reason:text(r.evidenceGoal)||'需要与当前项目口径一致的可核验事实',impact:text(r.impact||r.decision?.reason)||'相关判断尚不能确认',critical,status:'unverified',ownerSection:section,ownerLabel:text(r.sectionLabel||r.section)||section,sectionKeys:[section],requirementIds:[r.requirementId],sourceRevision:text(ctx.sourceRevision),evidenceIds:[],approval:null,definitions:[{requirementId:r.requirementId,field:f,quality:r.quality||{},revision:r.refinementVersion||r.version||1}]});
        }catch(error){problems.push(issue('invalid-requirement',error.message));}
      }
    }
    for(const record of map.values()){
      record.requirementRevision=fingerprint(record.definitions.slice().sort((a,b)=>stable(a).localeCompare(stable(b))));delete record.definitions;
      const prior=old.records.find(x=>x.id===record.id);
      if(prior){
        record.status=prior.status;record.evidenceIds=prior.evidenceIds;record.approval=prior.approval||null;record.assessment=prior.assessment||null;
        if(record.sectionKeys.includes(prior.ownerSection)){record.ownerSection=prior.ownerSection;record.ownerLabel=prior.ownerLabel;}
        if(prior.requirementRevision!==record.requirementRevision){record.previousStatus=record.status;record.previousAssessment=record.assessment||null;record.status='unverified';record.assessment=null;record.evidenceIds=[];record.invalidatedBy='requirements-changed';}
      }
    }
    // A removed requirement is a proposal for review, not permission to erase an unresolved obligation.
    for(const prior of old.records)if(!map.has(prior.id)){map.set(prior.id,Object.assign({},prior,{orphaned:true}));problems.push(issue('orphaned-requirement','原需求已不在当前配置中；须人工确认适用性，不自动删除',prior.id,'warning'));}
    const raw={schemaVersion:SCHEMA_VERSION,projectKey:ctx.projectKey,sourceRevision:ctx.sourceRevision,records:[...map.values()],audit:old.audit,issues:old.issues,valid:old.valid};
    const result=normalize(raw,ctx);result.issues.push(...problems);result.valid=result.valid&&!problems.some(x=>x.severity==='error');return result;
  }
  function reconcile(raw,proposals,context){
    const ctx=Object.assign({},context||{},contextFor(context,raw)),registry=normalize(raw,ctx),accepted=[],rejected=[];
    if(!registry.valid)return {registry,accepted,rejected:[{code:'invalid-registry',reason:'台账未通过完整性检查，未应用任何建议'}]};
    const list=Array.isArray(proposals)?proposals:proposals?.proposals;
    if(!Array.isArray(list))return {registry,accepted,rejected:[{code:'invalid-proposals',reason:'评估结果必须是 proposals 数组'}]};
    const seen=new Set();
    for(const p of list){
      const reject=(code,reason)=>rejected.push({gapId:text(p?.gapId),code,reason});
      const record=registry.records.find(x=>x.id===p?.gapId);
      if(!record){reject('unknown-gap','建议未绑定到当前缺口');continue;}
      if(seen.has(record.id)){reject('duplicate-proposal','同次评估对同一缺口只能提供一项建议');continue;}seen.add(record.id);
      if(!STATES.includes(p.status)||!text(p.reason)){reject('invalid-proposal','必须提供有效状态和具体判断理由');continue;}
      if(p.projectKey!==ctx.projectKey||p.sourceRevision!==ctx.sourceRevision||p.requirementRevision!==record.requirementRevision){reject('stale-proposal','项目、资料或需求版本已变化，请重新评估');continue;}
      if(p.identity){let validIdentity=false;try{validIdentity=stable(identity(p.identity))===stable(record.identity);}catch(_){}if(!validIdentity){reject('identity-change','不能通过评估建议更改字段、地域、时间或对象');continue;}}
      const candidate=Object.assign({},record,{status:p.status,evidenceIds:unique(Array.isArray(p.evidenceIds)?p.evidenceIds:[]),approval:null,assessment:{reason:text(p.reason),assessor:text(ctx.assessor)||'AI proposal',sourceRevision:ctx.sourceRevision}});
      // Exact material quotations are useful review candidates, not evidence of fact verification.
      if(Array.isArray(p.candidateEvidence))candidate.assessment.candidateEvidence=p.candidateEvidence.slice(0,8).map(e=>({sourceId:text(e.sourceId),sourceHash:text(e.sourceHash),locator:text(e.locator),quote:text(e.quote),verified:false}));
      const human=ctx.humanApproval;
      if(human?.confirmed===true&&text(human.actorId)&&text(human.reason)&&human.sourceRevision===ctx.sourceRevision&&(human.gapIds||[]).includes(record.id)){
        candidate.approval={kind:'human',confirmed:true,actorId:text(human.actorId),reason:text(human.reason),at:text(human.at),projectKey:ctx.projectKey,sourceRevision:ctx.sourceRevision,requirementRevision:record.requirementRevision,identityKey:stable(record.identity),status:p.status};
      }
      if(CLOSED.has(candidate.status)&&!closedProofValid(candidate,ctx)){reject(candidate.status==='not-applicable'?'approval-required':'verified-proof-required',candidate.status==='not-applicable'?'不适用须人工确认；不能由AI取消重要或普通要求':'未取得与当前字段、范围及版本绑定的已核验证据或人工确认');continue;}
      Object.assign(record,candidate);delete record.invalidatedBy;delete record.previousStatus;
      registry.audit.push({gapId:record.id,status:record.status,reason:text(p.reason),sourceRevision:ctx.sourceRevision,requirementRevision:record.requirementRevision,actorId:candidate.approval?.actorId||text(ctx.assessor)||'AI proposal',at:text(ctx.at||human?.at)});accepted.push(record.id);
    }
    return {registry,accepted,rejected};
  }
  function scopeLabel(value){const raw=typeof value==='string'?value:value&&typeof value==='object'?text(value.value||value.label||value.period||value.kind||value.level):'';const labels={unspecified:'',project_current:'当前项目口径',latest_12_months:'最近十二个月',latest_3_years:'最近三年',effective_at_generation:'编制时现行有效',current_model_version:'现行测算模型',district:'项目所在区',city:'项目所在市',street:'项目所在街道',project:'项目范围',national:'全国'};return Object.hasOwn(labels,raw)?labels[raw]:raw;}
  function scopedLabel(record){const scope=unique([scopeLabel(record.identity.geo),scopeLabel(record.identity.time)]).map(safePhrase).join('，');return safePhrase(record.label)+(scope?'（'+scope+'）':'');}
  function displayLabel(record){return record.presentationLabel||scopedLabel(record);}
  function markerFor(record){return '【待补：'+displayLabel(record)+'】';}
  const uncertain=r=>r.status==='unverified'||r.status==='unlocated';
  function verificationFor(record){return displayLabel(record)+'资料'+(record.status==='unlocated'?'尚未定位':'待核验')+'，相关判断暂不作确定性结论。';}
  function referenceFor(record){return displayLabel(record)+'尚未确认，详见'+safePhrase(record.ownerLabel||record.ownerSection)+'；本节涉及该事项的判断暂不作确定性结论。';}
  function presentation(raw,sectionKey,context){
    const registry=normalize(raw,context),key=text(sectionKey),primary=[],references=[],forbiddenMarkers=[];
    if(!registry.valid)return {valid:false,primaryMarkers:[],primary,references,forbiddenMarkers,html:'<p class="report-gap-error">缺口台账未通过完整性检查，请保留原稿并核对。</p>',instructions:'缺口台账无效，禁止将报告标为资料齐备。',issues:registry.issues};
    for(const r of registry.records.filter(r=>!CLOSED.has(r.status)&&r.sectionKeys.includes(key))){
      if(r.ownerSection===key){
        if(uncertain(r)){forbiddenMarkers.push(markerFor(r));references.push({gapId:r.id,ownerSection:r.ownerSection,text:verificationFor(r),critical:r.critical});}
        else primary.push({gapId:r.id,marker:markerFor(r),critical:r.critical,status:r.status,reason:r.assessment?.reason||r.reason,impact:r.impact});
      }else{
        forbiddenMarkers.push(markerFor(r));
        if(r.critical||(context?.consequentialSections||[]).includes(key))references.push({gapId:r.id,ownerSection:r.ownerSection,text:referenceFor(r),critical:r.critical});
      }
    }
    const primaryMarkers=primary.map(x=>x.marker),instructions=['资料缺口由全项目台账管理，不重复输出资料渠道清单。',...primary.map(x=>'本节是主位置，完整保留一次：'+x.marker),...references.map(x=>'保留本节判断边界（不重复红字长清单）：'+x.text)].join('\n');
    const html=primary.map(x=>'<p class="report-gap-primary" data-gap-id="'+escapeHtml(x.gapId)+'">'+escapeHtml(x.marker)+'</p>').concat(references.map(x=>'<p class="report-gap-reference" data-gap-id="'+escapeHtml(x.gapId)+'" data-gap-owner="'+escapeHtml(x.ownerSection)+'">'+escapeHtml(x.text)+'</p>')).join('');
    return {valid:true,primary,primaryMarkers,references,forbiddenMarkers,instructions,html,issues:registry.issues};
  }
  function inspect(entries,raw,context){
    const registry=normalize(raw,context),issues=registry.issues.filter(x=>x.severity==='error').map(copy),rows=Array.isArray(entries)?entries:[];
    if(!Array.isArray(entries))issues.push(issue('invalid-document','报告章节必须是数组'));
    const bySection=new Map();for(const row of rows){const key=text(row?.sectionKey||row?.key);if(!key||bySection.has(key))issues.push(issue('invalid-section','报告章节标识缺失或重复'));else bySection.set(key,row);}
    const body=row=>text(row?.text??row?.content??row?.body);
    const count=(hay,needle)=>hay.split(needle).length-1;
    const unresolved=registry.records.filter(r=>!CLOSED.has(r.status));
    for(const r of unresolved){
      const owner=bySection.get(r.ownerSection),marker=markerFor(r);
      const notice=uncertain(r)?verificationFor(r):marker;
      if(!owner||count(body(owner),notice)!==1)issues.push(issue('missing-primary','缺口或核验边界必须在主位置出现且只出现一次',r.id));
      for(const [key,row] of bySection)if((key!==r.ownerSection||uncertain(r))&&body(row).includes(marker))issues.push(issue(uncertain(r)?'unverified-as-missing':'duplicate-primary',uncertain(r)?'待核验或未定位不能冒充已确认缺失':'同一缺口的完整待补说明出现在其他章节',r.id));
      if(r.critical)for(const key of r.sectionKeys.filter(x=>x!==r.ownerSection))if(!bySection.has(key)||!body(bySection.get(key)).includes(referenceFor(r)))issues.push(issue('missing-boundary','依赖未确认重要事项的章节缺少判断限制',r.id));
    }
    for(const [key,row] of bySection)for(const ref of row.gapRefs||[]){
      const id=typeof ref==='string'?ref:ref?.gapId,r=registry.records.find(x=>x.id===id);
      if(!r||CLOSED.has(r.status)||!r.sectionKeys.includes(key)||!bySection.has(r.ownerSection))issues.push(issue('invalid-reference','缺口引用不存在、已失效或跨越未绑定章节',id));
    }
    const unresolvedCritical=unresolved.filter(r=>r.critical).map(r=>r.id);
    return {ok:registry.valid&&issues.length===0,canFinalize:registry.valid&&issues.length===0&&unresolvedCritical.length===0,issues,unresolved:unresolved.map(r=>r.id),unresolvedCritical,factsVerified:false};
  }
  function assessmentPrompt(raw,context){
    const registry=normalize(raw,context);
    if(!registry.valid)throw new Error('缺口台账无效，不能发起AI评估');
    return ['【内部资料缺口评估任务，不是报告正文】','只评估下列已生效需求；不得按名称相似合并字段，不得更改身份、章节、重要性或证据记录。上传文件、检索渠道存在不等于字段已核实；解析失败、未定位、冲突、部分满足与真实缺失必须区分。','satisfied必须引用调用方提供的已核验且绑定当前项目/版本/字段的evidenceIds；not-applicable只是一项待人工确认建议，不会自动删除要求。禁止编造证据ID或因缺资料而给出肯定结论。','仅输出JSON：{"proposals":[{"gapId":"已有ID","projectKey":"当前项目","sourceRevision":"当前资料版本","requirementRevision":"该项需求版本","status":"'+STATES.join('|')+'","reason":"具体判断及仍缺的内容，不罗列通用渠道","evidenceIds":[]}]}。没有充分依据保持unverified。','当前项目：'+registry.projectKey+'；资料版本：'+registry.sourceRevision,'需求：'+JSON.stringify(registry.records.map(r=>({gapId:r.id,identity:r.identity,label:r.label,critical:r.critical,requirementRevision:r.requirementRevision,status:r.status,reason:r.reason,impact:r.impact})))].join('\n');
  }
  function legacyCandidates(entries){
    const candidates=[];for(const row of Array.isArray(entries)?entries:[]){let n=0;for(const match of text(row?.text??row?.content??row?.body).matchAll(/【待补[:：]([^】]+)】/g))candidates.push({candidateId:'legacy:'+text(row.sectionKey||row.key)+':'+n++,sectionKey:text(row.sectionKey||row.key),originalMarker:match[0],label:match[1],status:'unverified',requiresIdentityReview:true});}return candidates;
  }
  return Object.freeze({VERSION,SCHEMA_VERSION,STATES,identity,idFor,identityKey:value=>stable(identity(value)),fingerprint,normalize,fromRequirements,reconcile,presentation,inspect,assessmentPrompt,legacyCandidates,escapeHtml});
});
