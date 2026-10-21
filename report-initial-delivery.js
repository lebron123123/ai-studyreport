/* Pure, bounded first-draft delivery planner. It neither calls AI nor writes a draft.
 * A caller MUST durably save reserve().run before dispatch, and enforce its permit
 * at the existing production generation/acceptance guards. Hashes are opaque CAS
 * tokens (not authentication); documentSha256 is the actual exported file digest.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ReportInitialDelivery=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='initial-delivery-v1',MAX_PER_SECTION=2;
  const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
  const copy=v=>JSON.parse(JSON.stringify(v));
  const fail=(code,message)=>{const e=new Error(message);e.code=code;throw e;};
  function token(v){let h=2166136261,s=stable(v);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
  function integer(v,f,min,max,label){const n=v===undefined?f:Number(v);if(!Number.isInteger(n)||n<min||n>max)fail('INITIAL_INVALID',label+'无效');return n;}
  function hash(v){if(typeof v!=='string'||!v.trim())fail('INITIAL_INVALID','缺少正文 CAS 哈希');return v;}
  function identity(v){if(!v||typeof v!=='object'||Array.isArray(v)||!Object.keys(v).length)fail('INITIAL_INVALID','缺少项目或研究及输入身份');return copy(v);}
  function planOf(p){
    if(!p||typeof p.planId!=='string'||!p.planId||!['pages','words'].includes(p.planningPriority))fail('INITIAL_INVALID','缺少确认计划或主目标');
    const words=integer(p.proseTotal,undefined,1,500000,'确认字数'),range=p.targetPageRange||{};
    const min=integer(range.min,undefined,1,1000,'最低页数'),max=integer(range.max,undefined,min,1100,'最高页数');
    const targetPages=integer(p.targetPages,Math.round((min+max)/2),min,max,'目标页数');
    return {planId:p.planId,planningPriority:p.planningPriority,proseTotal:words,targetPages,targetPageRange:{min,max},wordRange:{min:Math.ceil(words*0.9),max:Math.floor(words*1.1)}};
  }
  function createRun(input){
    input=input||{};
    if(input.authorized!==true)return {version:VERSION,authorized:false,status:'inactive',sections:[],permits:[],reason:'explicit-authorization-required'};
    const plan=planOf(input.plan),id=identity(input.identity),now=integer(input.now,Date.now(),0,Number.MAX_SAFE_INTEGER,'开始时间');
    if(!Array.isArray(input.sections)||!input.sections.length)fail('INITIAL_INVALID','缺少生成目录');
    const keys=new Set(),sections=input.sections.map(s=>{
      if(!s||typeof s.key!=='string'||!s.key||keys.has(s.key))fail('INITIAL_INVALID','小节标识缺失或重复');keys.add(s.key);
      const bodyHash=hash(s.bodyHash),eligible=!s.hasBody&&!s.hasCandidate&&!s.locked;
      return {key:s.key,role:s.role==='summary'?'summary':'detail',basis:s.basis===true,target:integer(s.target,0,0,500000,'小节目标'),initialBodyHash:bodyHash,bodyHash,eligible,owned:false,firstCalls:0,additionalCalls:0,summarySource:null,qualityStatus:'unverified',issues:[],failure:null,provisionalHash:null};
    });
    const limits=input.limits||{};
    return {version:VERSION,authorized:true,status:'running',authorizationToken:input.authorizationToken||null,runId:input.runId||'initial-'+now+'-'+token({id,plan,sections:sections.map(s=>s.key)}),identity:id,plan,startedAt:now,
      limits:{maxAdditionalCalls:integer(limits.maxAdditionalCalls,sections.length,0,sections.length*MAX_PER_SECTION,'全篇追加次数'),maxAdditionalCallsPerSection:integer(limits.maxAdditionalCallsPerSection,MAX_PER_SECTION,0,MAX_PER_SECTION,'每节追加次数'),maxElapsedMs:integer(limits.maxElapsedMs,1800000,1,1800000,'总时限'),maxPaginationPasses:integer(limits.maxPaginationPasses,3,1,3,'实排次数')},
      additionalCalls:0,paginationPasses:0,sections,permits:[],pagination:null,revision:0};
  }
  // This is a separately authorized review of existing text, not a claim that
  // this runtime generated it. It can only dispatch one length-convergence batch.
  function createReviewedContinuation(input){
    const run=createRun(input);if(!run.authorized)return run;
    if(input.purpose!=='reviewed-existing-length-convergence'||run.plan.planningPriority!=='pages')fail('INITIAL_CONTINUATION','缺少已审原稿的篇幅收敛授权');
    const origins=new Map((input.origins||[]).map(o=>[o.key,o]));
    if(origins.size!==(input.origins||[]).length)fail('INITIAL_CONTINUATION','已审原稿记录重复');
    for(const s of run.sections){const original=input.sections.find(x=>x.key===s.key),origin=origins.get(s.key);s.eligible=false;
      if(!original.hasBody){if(origin)fail('INITIAL_CONTINUATION','空小节不能登记为已审原稿');continue;}
      if(!origin||origin.bodyHash!==s.bodyHash||!/^[a-f0-9]{64}$/i.test(origin.sourceHash||'')||!origin.review||origin.review.conclusion!=='accepted'||origin.review.sourceSha256!==origin.sourceHash||original.hasCandidate||original.locked)fail('INITIAL_CONTINUATION','原稿未完成逐节核对或仍受保护');
      if(origin.allowBudgetAllocation!==undefined&&(typeof origin.allowBudgetAllocation!=='boolean'||origin.allowConverge&&!origin.allowBudgetAllocation))fail('INITIAL_CONTINUATION','参考预算范围无效');
      if((origin.allowConverge||origin.allowBudgetAllocation)&&(s.role!=='detail'||s.basis))fail('INITIAL_CONTINUATION','只能对明确授权的非依据明细收敛');
      s.origin=copy(origin);s.owned=origin.allowConverge===true;s.eligible=s.owned;s.qualityStatus='unverified';origins.delete(s.key);
    }
    if(origins.size||!run.sections.some(s=>s.eligible))fail('INITIAL_CONTINUATION','缺少可收敛的已审明细');
    run.mode='reviewed-existing-length-convergence';return run;
  }
  function sectionMap(snapshot){
    if(!Array.isArray(snapshot?.sections))fail('INITIAL_INPUT_CHANGED','缺少当前目录');
    const m=new Map();for(const s of snapshot.sections){if(!s||typeof s.key!=='string'||m.has(s.key))fail('INITIAL_INPUT_CHANGED','当前目录标识重复');hash(s.bodyHash);m.set(s.key,s);}return m;
  }
  function check(run,snapshot){
    if(run?.version!==VERSION||run.authorized!==true)return 'explicit-authorization-required';
    if(stable(snapshot?.identity)!==stable(run.identity)||snapshot?.planId!==run.plan.planId)return 'input-identity-changed';
    let map;try{map=sectionMap(snapshot);}catch(e){return e.code+': '+e.message;}
    if(map.size!==run.sections.length)return 'outline-changed';
    for(const s of run.sections){const live=map.get(s.key);if(!live)return 'outline-changed';if(live.bodyHash!==s.bodyHash)return 'body-cas-changed: '+s.key;if(s.eligible&&(live.locked||live.hasCandidate))return 'draft-protected: '+s.key;}
    return null;
  }
  function bodyManifest(run){return stable(run.sections.map(s=>({key:s.key,bodyHash:s.bodyHash})));}
  function detailManifest(run){return stable(run.sections.filter(s=>s.role==='detail').map(s=>({key:s.key,bodyHash:s.bodyHash})));}
  function active(run){return run.permits.filter(p=>p.status==='reserved'||p.status==='uncertain');}
  function canAdd(run,s){return s.eligible&&s.additionalCalls<run.limits.maxAdditionalCallsPerSection&&run.additionalCalls<run.limits.maxAdditionalCalls;}
  function action(run,s,kind,reason){const extra=s.firstCalls>0||s.owned;return {id:'action-'+token({run:run.runId,key:s.key,kind,body:s.bodyHash,first:s.firstCalls,extra:s.additionalCalls,details:kind==='summarize'?detailManifest(run):null}),kind,key:s.key,expectedBodyHash:s.bodyHash,additional:extra,reason,preserve:'headings-facts-tables-gaps',...(kind==='summarize'?{detailManifest:detailManifest(run)}:{})};}
  function result(phase,actions,reason,extra){return Object.assign({phase,actions:actions||[],reason:reason||null,complete:phase==='completed'},extra||{});}
  function eligibleAction(run,s,kind,reason){if((s.firstCalls||s.owned)&&!canAdd(run,s))return null;return action(run,s,kind,reason);}
  function actionableIssues(s,live){const q=live.qualityStatus||s.qualityStatus;return {blocked:q==='blocked',issues:Array.isArray(live.issues)?live.issues:s.issues||[]};}
  function totals(run,map){return run.sections.reduce((n,s)=>n+Math.max(0,Number(map.get(s.key)?.actual)||0),0);}
  function paginationAction(run,kind){return {id:kind+'-'+token({run:run.runId,body:bodyManifest(run),pass:run.paginationPasses}),kind,key:null,bodyManifest:bodyManifest(run),planId:run.plan.planId};}
  function convergenceActions(run,map,pagination,scope){
    if(run.lengthConvergence||run.plan.planningPriority!=='pages'||pagination.pages<=run.plan.targetPageRange.max)return [];
    const summaryReserve=scope==='details'?run.sections.filter(s=>s.role==='summary'&&!map.get(s.key).hasBody).reduce((n,s)=>n+s.target,0):0;
    const actual=totals(run,map),target=Math.max(0,Math.floor(actual*run.plan.targetPages/pagination.pages)-summaryReserve);
    const remaining=run.limits.maxAdditionalCalls-run.additionalCalls;
    // A full-report pass also needs room to refresh owned summaries. Never raise
    // the existing paid-call caps to make a length pass appear successful.
    const refreshCalls=scope==='full'?run.sections.filter(s=>s.role==='summary'&&s.owned).length:0;
    const available=Math.max(0,remaining-refreshCalls);
    // An explicitly reviewed allocation scope is not permission to dispatch.
    // A one-section sample gets its share of the full budget, not the whole cut.
    // Omitted scope preserves the existing caller's bounded allocation behavior.
    const fullAllocation=run.mode==='reviewed-existing-length-convergence'&&run.sections.some(s=>s.origin?.allowBudgetAllocation!==undefined);
    const rows=run.sections.filter(s=>s.role==='detail'&&!s.basis&&(fullAllocation?(s.origin?.allowBudgetAllocation??s.origin?.allowConverge)===true:s.owned&&canAdd(run,s))).map(s=>{
      const size=Math.max(0,Number(map.get(s.key).actual)||0),floor=Math.min(size,Math.max(1,Math.ceil(s.target*0.9),Number(map.get(s.key).preservationFloor)||0));
      return {s,size,floor,capacity:size-floor,weight:Math.max(1,size-s.target),reduction:0};
    }).filter(r=>r.capacity>0).sort((a,b)=>b.capacity-a.capacity).slice(0,fullAllocation?undefined:available);
    let left=Math.min(Math.max(0,actual-target),rows.reduce((n,r)=>n+r.capacity,0));
    // Weighted water-filling keeps useful, already short sections out of the
    // batch; it does not impose one compression percentage on every chapter.
    while(left>0){const open=rows.filter(r=>r.reduction<r.capacity);if(!open.length)break;const weight=open.reduce((n,r)=>n+r.weight,0),budget=left;let used=0;for(const r of open){const amount=Math.min(r.capacity-r.reduction,Math.max(1,Math.floor(budget*r.weight/weight)),left);r.reduction+=amount;left-=amount;used+=amount;if(!left)break;}if(!used)break;}
    const batchId='length-'+token({run:run.runId,body:bodyManifest(run),document:pagination.documentSha256,scope});
    return rows.filter(r=>r.reduction>0&&r.s.owned&&canAdd(run,r.s)).slice(0,available).map(r=>({...action(run,r.s,'length-converge','actual-page-excess'),batchId,referenceBudget:{target:r.size-r.reduction,actual:r.size,min:r.floor,referenceOnly:true,scope,confirmedProseTotal:run.plan.proseTotal,measuredPages:pagination.pages,targetPages:run.plan.targetPages,targetPageRange:copy(run.plan.targetPageRange),documentSha256:pagination.documentSha256,summaryReserve,plannedBatchReduction:rows.reduce((n,x)=>n+x.reduction,0)}}));
  }
  function remediate(run,map,kind,reason,pagination){
    const rows=run.sections.filter(s=>s.eligible&&!s.basis&&s.role==='detail'&&s.owned&&!active(run).some(p=>p.key===s.key)&&canAdd(run,s)).map(s=>({s,live:map.get(s.key)}));
    // Words/page varies by the actual paragraph and table layout. A measured
    // page shortfall therefore recalibrates this run's *reference* allocation,
    // not the confirmed plan or a factual/structural admission threshold.
    const pageShortfall=kind==='evidence-expand'&&pagination&&pagination.pages<run.plan.targetPageRange.min;
    const ratio=pageShortfall?(run.plan.targetPages||Math.round((run.plan.targetPageRange.min+run.plan.targetPageRange.max)/2))/pagination.pages:1;
    for(const x of rows)x.referenceTarget=pageShortfall?Math.ceil(Math.max(Number(x.live.actual)||0,x.s.target)*ratio):x.s.target;
    const useful=kind==='deduplicate'?rows.filter(x=>(x.live.issues||x.s.issues||[]).some(i=>/duplicate|repetition|redundan/.test(i.code||'')&&i.repairable===true)):
      rows.filter(x=>x.live.canExpand===true&&x.referenceTarget>0&&(Number(x.live.actual)||0)<x.referenceTarget);
    useful.sort((a,b)=>kind==='deduplicate'?(Number(b.live.actual)||0)-(Number(a.live.actual)||0):((Number(a.live.actual)||0)/a.referenceTarget)-((Number(b.live.actual)||0)/b.referenceTarget));
    const chosen=useful[0];if(!chosen)return [];
    const a=action(run,chosen.s,kind,reason);
    if(kind==='evidence-expand')a.referenceBudget={target:chosen.referenceTarget,actual:Number(chosen.live.actual)||0,referenceOnly:true,...(pageShortfall?{measuredPages:pagination.pages,targetPages:run.plan.targetPages,documentSha256:pagination.documentSha256}:{}),evidence:copy(chosen.live.expansionEvidence||[])};
    return [a];
  }
  function evaluate(run,snapshot,ignorePending){
    if(run?.authorized!==true)return result('inactive',[],'explicit-authorization-required');
    const changed=check(run,snapshot);if(changed)return result('paused',[],changed);
    const map=sectionMap(snapshot),pending=active(run),now=snapshot.now===undefined?Date.now():Number(snapshot.now);
    if(!Number.isFinite(now)||now<run.startedAt)return result('paused',[],'invalid-clock');
    // Paid requests already dispatched are never replaced with a new POST.
    if(pending.length&&!ignorePending)return result('recovering',pending.map(p=>({id:p.id,kind:'resume',key:p.key,permitId:p.id,taskId:p.taskId||null,idempotencyKey:p.idempotencyKey,status:p.status})),'resume-original-permits-only');
    if(now-run.startedAt>=run.limits.maxElapsedMs)return result('paused',[],'elapsed-limit');
    if(run.status==='paused')return result('paused',[],run.reason||'paused');
    const details=run.sections.filter(s=>s.role==='detail'),summaries=run.sections.filter(s=>s.role==='summary');
    if(run.lengthConvergence){
      const batch=run.lengthConvergence,failed=run.permits.find(p=>p.batchId===batch.id&&p.status==='failed');
      const unchanged=run.permits.find(p=>p.batchId===batch.id&&p.outcome==='no-effective-reduction');
      if(unchanged)return result('paused',[],'length-convergence-no-effective-reduction',{retainedKey:unchanged.key});
      if(failed)return result('paused',[],'length-convergence-needs-review',{failedKey:failed.key});
      const unsent=batch.actions.filter(a=>!run.permits.some(p=>p.actionId===a.id));
      if(unsent.length){if(snapshot.canConverge!==true)return result('paused',[],'length-convergence-adapter-unavailable');return result('length-converge',copy(unsent));}
    }
    if(run.mode==='reviewed-existing-length-convergence'){
      if(run.lengthConvergence)return result('paused',[],'reviewed-continuation-finished',{complete:false});
      if(details.some(s=>!map.get(s.key).hasBody||actionableIssues(s,map.get(s.key)).blocked)||summaries.some(s=>map.get(s.key).hasBody&&actionableIssues(s,map.get(s.key)).blocked))return result('paused',[],'reviewed-body-not-admitted');
      const detailsOnly=summaries.length>0&&summaries.every(s=>!map.get(s.key).hasBody);
      if(!detailsOnly&&summaries.some(s=>!map.get(s.key).hasBody))return result('paused',[],'reviewed-summary-set-incomplete');
      const measured=detailsOnly?run.detailPagination:run.pagination;
      if(measured&&measured.bodyManifest===bodyManifest(run)&&measured.planId===run.plan.planId){
        if(measured.pages<=run.plan.targetPageRange.max)return result('paused',[],'reviewed-convergence-not-needed',{pages:measured.pages,complete:false});
        if(snapshot.canConverge!==true)return result('paused',[],'length-convergence-adapter-unavailable');
        const actions=convergenceActions(run,map,measured,detailsOnly?'details':'full');
        return actions.length?result('length-converge',actions):result('paused',[],'length-convergence-needs-review');
      }
      if(detailsOnly&&snapshot.canMeasureDetails!==true)return result('paused',[],'detail-pagination-adapter-unavailable');
      if(run.paginationPasses>=run.limits.maxPaginationPasses)return result('paused',[],'pagination-pass-limit');
      return result(detailsOnly?'detail-pagination':'pagination',[paginationAction(run,detailsOnly?'paginate-details':'paginate')],null,{complete:false});
    }
    for(const group of [details,summaries]){
      if(group===summaries&&(details.some(s=>!map.get(s.key).hasBody||actionableIssues(s,map.get(s.key)).blocked)||pending.some(p=>details.some(s=>s.key===p.key))))break;
      if(group===summaries&&run.plan.planningPriority==='pages'&&summaries.length&&summaries.every(s=>s.eligible&&!map.get(s.key).hasBody)&&snapshot.canMeasureDetails===true&&!run.lengthConvergence){
        const measured=run.detailPagination;
        if(measured&&measured.bodyManifest===bodyManifest(run)&&measured.planId===run.plan.planId){
          if(measured.pages>run.plan.targetPageRange.max){if(snapshot.canConverge!==true)return result('paused',[],'length-convergence-adapter-unavailable');const actions=convergenceActions(run,map,measured,'details');if(actions.length)return result('length-converge',actions,null,{pages:measured.pages,measurementScope:'details',complete:false});return result('paused',[],'length-convergence-needs-review');}
        }else{
          if(run.paginationPasses>=run.limits.maxPaginationPasses)return result('paused',[],'pagination-pass-limit');
          return result('detail-pagination',[paginationAction(run,'paginate-details')],null,{measurementScope:'details',complete:false});
        }
      }
      const actions=[];
      for(const s of group){
        const live=map.get(s.key),q=actionableIssues(s,live);
        if(pending.some(p=>p.key===s.key))continue;
        if(!s.eligible){if(!live.hasBody||q.blocked)return result('paused',[],'protected-section-needs-review: '+s.key);continue;}
        if(s.failure&&!s.failure.retryable)return result('paused',[],s.failure.code||'generation-failed',{failedKey:s.key,error:s.failure});
        if(q.blocked||s.provisionalHash){
          if(!q.issues.some(i=>i.severity==='error')||q.issues.some(i=>i.severity==='error'&&(i.repairable!==true||i.requiresPlanReview===true)))return result('paused',[],'quality-needs-review: '+s.key,{issues:q.issues});
          const a=eligibleAction(run,s,'exact-repair','repair-only-bound-quality-issues');if(!a)return result('paused',[],'additional-call-limit: '+s.key);actions.push(a);continue;
        }
        if(!live.hasBody){const a=eligibleAction(run,s,s.role==='summary'?'summarize':'first-generate',s.failure?'retry-explicitly-failed-task':'initial-empty-section');if(!a)return result('paused',[],'additional-call-limit: '+s.key);actions.push(a);continue;}
        if(s.role==='summary'&&s.owned&&s.summarySource!==detailManifest(run)){const a=eligibleAction(run,s,'summarize','detail-source-changed');if(!a)return result('paused',[],'summary-refresh-limit: '+s.key);actions.push(a);}
      }
      if(actions.length)return result(group===details?'details':'summaries',actions);
      if(group===details&&details.some(s=>!map.get(s.key).hasBody||actionableIssues(s,map.get(s.key)).blocked))return result('paused',[],'details-not-stable');
    }
    if(pending.length)return result('recovering',[],'pending-detail-barrier');
    if(run.sections.some(s=>!map.get(s.key).hasBody||actionableIssues(s,map.get(s.key)).blocked))return result('paused',[],'content-not-admitted');
    const actual=totals(run,map),words={actual,target:run.plan.proseTotal,min:run.plan.wordRange.min,max:run.plan.wordRange.max};
    if(run.plan.planningPriority==='words'&&(actual<words.min||actual>words.max)){
      const acts=remediate(run,map,actual<words.min?'evidence-expand':'deduplicate',actual<words.min?'confirmed-word-shortfall':'confirmed-word-excess');
      if(acts.length)return result('bounded-fix',acts,null,{words});
      return result('paused',[],actual<words.min?'word-shortfall-needs-evidence':'word-excess-needs-targeted-review',{words});
    }
    const pagination=run.pagination;
    if(pagination&&(pagination.measurementScope==null||pagination.measurementScope==='full')&&pagination.bodyManifest===bodyManifest(run)&&pagination.planId===run.plan.planId){
      const range=run.plan.targetPageRange,pages=pagination.pages,pageStatus=pages<range.min?'below-range':pages>range.max?'above-range':'within-range';
      if(run.plan.planningPriority==='words'||pageStatus==='within-range')return result('completed',[],null,{words,pages,pageStatus,targetRole:run.plan.planningPriority==='pages'?'pages-primary':'words-primary',contentQualityCertified:false});
      if(pageStatus==='above-range'&&snapshot.canConverge===true){const actions=convergenceActions(run,map,pagination,'full');if(actions.length)return result('length-converge',actions,null,{words,pages,pageStatus});if(run.lengthConvergence)return result('paused',[],'length-convergence-exhausted',{words,pages,pageStatus});}
      const acts=remediate(run,map,pageStatus==='below-range'?'evidence-expand':'deduplicate',pageStatus==='below-range'?'actual-page-shortfall':'actual-page-excess',pagination);
      if(acts.length)return result('bounded-fix',acts,null,{words,pages,pageStatus});
      return result('paused',[],pageStatus==='below-range'?'page-shortfall-needs-evidence':'page-excess-needs-targeted-review',{words,pages,pageStatus});
    }
    if(run.paginationPasses>=run.limits.maxPaginationPasses)return result('paused',[],'pagination-pass-limit',{words});
    return result('pagination',[paginationAction(run,'paginate')],null,{words});
  }
  function next(run,snapshot){return evaluate(run,snapshot||{},false);}
  function reserve(run,a,snapshot){
    const changed=check(run,snapshot);if(changed)fail('INITIAL_CAS',changed);
    const allowed=evaluate(run,snapshot,true).actions.find(x=>x.id===a?.id&&x.kind===a?.kind&&x.key===a?.key);
    if(!allowed||active(run).some(p=>p.key===a.key))fail('INITIAL_ACTION_STALE','动作已失效或同一小节已有请求');
    const out=copy(run),permit={...copy(allowed),id:'permit-'+allowed.id,actionId:allowed.id,runId:run.runId,planId:run.plan.planId,identity:copy(run.identity),status:'reserved',reservedAt:snapshot.now===undefined?Date.now():Number(snapshot.now),idempotencyKey:run.runId+':'+allowed.id};
    if(a.kind==='paginate'||a.kind==='paginate-details'){
      if(typeof snapshot.bodyHash!=='string'||!snapshot.bodyHash)fail('INITIAL_INVALID','实排须绑定调用方统一正文 SHA256');
      permit.bodyHash=snapshot.bodyHash;permit.documentSha256=snapshot.documentSha256||null;permit.rulesVersion=snapshot.rulesVersion||null;permit.templateVersion=snapshot.templateVersion||null;out.paginationPasses++;
    }else{const s=out.sections.find(x=>x.key===a.key);if(allowed.kind==='length-converge'&&!out.lengthConvergence){const actions=evaluate(run,snapshot,true).actions;out.lengthConvergence={id:allowed.batchId,actions:copy(actions),pagination:copy(allowed.referenceBudget.scope==='details'?run.detailPagination:run.pagination),startedAt:permit.reservedAt};}if(allowed.additional){s.additionalCalls++;out.additionalCalls++;}else s.firstCalls++;}
    out.permits.push(permit);out.revision++;return {run:out,permit:copy(permit)};
  }
  function record(run,receipt){
    receipt=receipt||{};const prior=run?.permits?.find(p=>p.id===receipt.permitId);if(!prior)fail('INITIAL_RECEIPT','未知请求回执');
    if(!['completed','failed','uncertain'].includes(receipt.status))fail('INITIAL_RECEIPT','请求状态无效');
    if(['paginate','paginate-details'].includes(prior.kind)&&receipt.status==='completed')fail('INITIAL_RECEIPT','实排须使用绑定回执');
    if(!['reserved','uncertain'].includes(prior.status)){
      if(prior.receiptToken===token(receipt))return copy(run);fail('INITIAL_RECEIPT','重复请求回执不一致');
    }
    if(receipt.identity&&stable(receipt.identity)!==stable(run.identity)||receipt.planId&&receipt.planId!==run.plan.planId)fail('INITIAL_CAS','回执输入身份已变化');
    const out=copy(run),p=out.permits.find(x=>x.id===prior.id),s=out.sections.find(x=>x.key===p.key);
    if(['paginate','paginate-details'].includes(p.kind)){p.status=receipt.status;p.receiptToken=token(receipt);p.error=copy(receipt.error||{});if(receipt.status==='failed'){out.status='paused';out.reason='pagination-failed';}out.revision++;return out;}
    if(s.bodyHash!==p.expectedBodyHash||receipt.previousBodyHash!==undefined&&receipt.previousBodyHash!==p.expectedBodyHash)fail('INITIAL_CAS','回执正文 CAS 已变化');
    if(receipt.outcome!==undefined&&(receipt.outcome!=='no-effective-reduction'||p.kind!=='length-converge'||receipt.status!=='completed'||receipt.bodyHash!==s.bodyHash))fail('INITIAL_RECEIPT','保留原稿回执无效');
    p.status=receipt.status;p.taskId=receipt.taskId||p.taskId||null;p.receiptToken=token(receipt);p.finishedAt=receipt.now===undefined?Date.now():receipt.now;
    if(receipt.outcome==='no-effective-reduction'){
      // The provider completed; this is not an adopted revision or a retryable
      // provider failure. Preserve the original body, review and pagination.
      p.outcome=receipt.outcome;
    }else if(receipt.status==='completed'){
      s.failure=null;s.qualityStatus=receipt.qualityStatus||'unverified';s.issues=copy(receipt.issues||[]);
      if(!['passed','unverified','blocked'].includes(s.qualityStatus))fail('INITIAL_RECEIPT','成稿检查状态无效');
      if(s.qualityStatus==='blocked'){
        if(receipt.bodyHash&&receipt.bodyHash!==s.bodyHash)fail('INITIAL_RECEIPT','被阻断正文不能自动采用');
        s.provisionalHash=hash(receipt.provisionalHash);p.provisionalHash=s.provisionalHash;
      }else{
        s.bodyHash=hash(receipt.bodyHash);s.owned=true;s.provisionalHash=null;
        if(p.kind==='summarize')s.summarySource=p.detailManifest;
        out.pagination=null;
      }
    }else if(receipt.status==='failed')s.failure={code:receipt.error?.code||'generation-failed',message:String(receipt.error?.message||'请求失败，原结果保留'),retryable:receipt.retryable===true};
    out.revision++;return out;
  }
  function bindPagination(run,input){
    input=input||{};const p=run?.permits?.find(x=>x.id===input.permitId&&['paginate','paginate-details'].includes(x.kind));
    if(!p||p.status!=='reserved')fail('INITIAL_PAGINATION','缺少有效实排请求');
    const r=input.receipt;
    // Legacy full-document adapters omitted this field. Partial measurements
    // are new and must explicitly identify their scope; they can never be
    // rebound to a full-document permit, even if their hashes/pages are valid.
    if(p.kind==='paginate-details'?input.measurementScope!=='details-only':input.measurementScope!=null&&input.measurementScope!=='complete-document')fail('INITIAL_PAGINATION','明细预排与完整报告的实排范围不匹配');
    if(input.planId!==run.plan.planId||input.bodyHash!==p.bodyHash||p.bodyManifest!==bodyManifest(run)||input.snapshot&&check(run,input.snapshot))fail('INITIAL_CAS','实排期间正文或确认计划已变');
    if(!r||!/^report-pagination-receipt-v[12]$/.test(r.schemaVersion||'')||!/^[a-f0-9]{64}$/i.test(input.documentSha256||'')||r.documentSha256!==input.documentSha256||p.documentSha256&&p.documentSha256!==input.documentSha256
      ||!Number.isInteger(r.pages)||r.pages<=0||input.pages!==undefined&&input.pages!==r.pages||r.scope!=='pagination-only'||r.contentQualityCertified!==false||r.versionsMatch!==true
      ||!r.rulesVersion||r.rulesVersion!==r.documentRulesVersion||!r.templateVersion||r.templateVersion!==r.documentTemplateVersion
      ||p.rulesVersion&&p.rulesVersion!==r.rulesVersion||p.templateVersion&&p.templateVersion!==r.templateVersion||!r.renderer||!r.rendererVersion||r.rendererVersion==='unknown'||!Number.isFinite(Date.parse(r.checkedAt))
      ||!['within-page-limit','over-page-limit'].includes(r.validationStatus))fail('INITIAL_PAGINATION','实排回执缺失、无效或文档版本不匹配');
    const out=copy(run),saved=out.permits.find(x=>x.id===p.id);saved.status='completed';out[p.kind==='paginate-details'?'detailPagination':'pagination']={planId:input.planId,bodyHash:input.bodyHash,bodyManifest:p.bodyManifest,documentSha256:input.documentSha256,pages:r.pages,measurementScope:p.kind==='paginate-details'?'details':'full',receipt:copy(r)};out.revision++;return out;
  }
  return {VERSION,MAX_PER_SECTION,createRun,createReviewedContinuation,next,reserve,record,bindPagination,check,bodyManifest,detailManifest};
});
