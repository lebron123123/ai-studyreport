/* ============================================================
   project-workflow.js —— 可研项目持续协作内核
   只保存确定状态和候选修改，不调用AI、不直接改DOM。
   浏览器与Node测试共用，避免参数联动/版本逻辑散落在页面脚本里。
   ============================================================ */
(function(root){
  "use strict";

  const FINANCE_WORDS = /投资|资金|财务|收入|成本|费用|税|利润|现金流|偿债|融资|借款|回报|收益|敏感性|经济评价|盈利/;
  const MARKET_WORDS = /市场|需求|租金|售价|出租|销售|去化|竞品|运营|经营|产品定位/;
  const BUILD_WORDS = /建设|实施|进度|工期|工程|施工|招标|计划/;
  const SCALE_WORDS = /规模|用地|面积|建筑|户型|车位|方案|总平面/;
  const CONCLUSION_WORDS = /结论|建议|可行性|风险|综合评价/;
  const ANALYSIS_DOMAIN_WORDS = {
    population:/人口|区域概况|客群|需求|建设必要性/,
    employment:/产业|就业|需求|建设必要性/,
    commute:/职住|通勤|区位|需求|建设必要性/,
    demand:/需求|建设规模|项目定位|结论|建议|可行性/,
    market:/市场|价格|租金|售价|风险|需求/,
    poi:/配套|交通|教育|医疗|商业|产业|区位|建设条件|社会效益|风险/,
  };

  const METRIC_LABELS = {
    irr:"全投资IRR", capitalIrr:"资本金IRR", totalNpv:"累计净现值",
    totalIncome:"全周期总收入", totalCost:"全周期总成本", totalNetProfit:"净利润合计",
    payback:"静态投资回收期", dynamicPayback:"动态投资回收期", icr:"利息备付率",
    dscr:"偿债备付率", totalInvestment:"总投资", totalTax:"税费合计",
  };

  const PARAM_GROUPS = {
    build:["buildStart","buildYears","operateYears","firstMonths","repayStart"],
    scale:["area","saleArea","commArea","subsidyArea","totalBuildArea","landArea","landUseArea","parkCount","units"],
    market:["rent","rentRate","rentSpan","stableOcc","rampOcc","occRamp","rentDiscount","saleAvgPrice","rate1","rate2","rate3","commRent","commRentRate","commStableOcc","parkPrice","collect"],
    finance:["totalInvestment","invest","loan","loanAmount","loanRate","loanTotalYears","repay","repayAmount","discount","discountPct","constructionCost","landCost","deco","decorationCost","unitCost"],
  };

  function clone(v){ return v==null?v:JSON.parse(JSON.stringify(v)); }
  function uid(prefix){
    if(root.crypto && typeof root.crypto.randomUUID==="function") return prefix+"-"+root.crypto.randomUUID();
    return prefix+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
  }
  function hash(value){
    const s=JSON.stringify(value||{}); let h=2166136261;
    for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
    return (h>>>0).toString(16).padStart(8,"0");
  }
  function currentText(section){ return section&&section.editedHtml ? section.editedHtml : String(section&&section.content||""); }
  function paramGroup(key){
    for(const [g,keys] of Object.entries(PARAM_GROUPS)) if(keys.includes(key)) return g;
    return "finance";
  }
  function sectionAffected(section,chapter,key){
    const text=String((chapter&&chapter.name)||"")+" "+String((section&&section.t)||"");
    const title=String((section&&section.t)||"");
    const group=paramGroup(key);
    if(section&&section.numeric) return true;
    if(CONCLUSION_WORDS.test(text)) return true;
    // 章节名只能提供语境，纯政策/法规/依据小节不能因为同章含“市场”就被租金变化误判为需重写。
    if(group==="market" && MARKET_WORDS.test(text) && !/政策|法规|依据|建设方案|环境|节能|消防/.test(title)) return true;
    if(group==="build" && BUILD_WORDS.test(text)) return true;
    if(group==="scale" && (SCALE_WORDS.test(text)||MARKET_WORDS.test(text))) return true;
    if(group==="finance" && FINANCE_WORDS.test(text)) return true;
    return false;
  }
  function impactedSections(chapters,keys){
    const out=[]; const uniq=[...new Set((keys||[]).filter(Boolean))];
    // 首选显式的“参数→指标→章节”依赖图；旧项目或脚本缺少新模块时继续使用关键词兼容逻辑。
    if(root.ReportDependency&&uniq.length){
      const graph=root.ReportDependency.buildGraph({paramKeys:uniq,chapters:chapters||[]}),bySection=new Map();
      graph.edges.filter(e=>e.kind==="appears_in").forEach(edge=>{const sec=graph.nodes.find(n=>n.id===edge.to),metric=graph.nodes.find(n=>n.id===edge.from);if(!sec)return;const key=String(sec.cn)+":"+sec.si,row=bySection.get(key)||{cn:sec.cn,si:sec.si,title:sec.title,chapter:sec.chapter,keys:uniq.slice(),metrics:[],locked:!!sec.locked};if(metric&&!row.metrics.some(x=>x.key===metric.key))row.metrics.push({key:metric.key,label:metric.label});bySection.set(key,row);});
      if(bySection.size)return [...bySection.values()];
    }
    (chapters||[]).forEach(c=>(c.sections||[]).forEach((s,si)=>{
      const why=uniq.filter(k=>sectionAffected(s,c,k));
      if(why.length) out.push({cn:c.cn,si,title:s.t,chapter:c.name,keys:why,locked:!!s.locked});
    }));
    return out;
  }
  function markImpacted(chapters,keys,reason){
    const hits=impactedSections(chapters,keys);
    hits.forEach(h=>{
      const c=(chapters||[]).find(x=>String(x.cn)===String(h.cn)); const s=c&&c.sections[h.si]; if(!s)return;
      s.syncStatus=s.locked?"locked-stale":"stale";
      s.staleReason=reason||("参数变化："+h.keys.join("、"));
      s.staleKeys=h.keys.slice();
      s.staleMetrics=(h.metrics||[]).map(x=>x.key);
    });
    return hits;
  }
  function impactedAnalysisSections(chapters,domains){
    const ds=[...new Set((domains||[]).filter(x=>ANALYSIS_DOMAIN_WORDS[x]))],out=[],unrelated=/消防|结构|电气|给排水|暖通|节能|施工安全|抗震|海绵城市/;
    (chapters||[]).forEach(c=>(c.sections||[]).forEach((s,si)=>{const title=String(s.t||"");if(unrelated.test(title))return;const q=String(c.name||"")+" "+title,why=ds.filter(d=>ANALYSIS_DOMAIN_WORDS[d].test(q));if(why.length)out.push({cn:c.cn,si,title:s.t,chapter:c.name,domains:why,locked:!!s.locked});}));return out;
  }
  function markAnalysisImpacted(chapters,domains,reason){const hits=impactedAnalysisSections(chapters,domains);hits.forEach(h=>{const c=(chapters||[]).find(x=>String(x.cn)===String(h.cn)),s=c&&c.sections[h.si];if(!s)return;s.syncStatus=s.locked?"locked-stale":"stale";s.staleReason=reason||("分析数据变化："+h.domains.join("、"));s.staleKeys=h.domains.slice();});return hits;}
  function clearSectionStale(section){
    if(!section)return; section.syncStatus="current"; section.staleReason=""; section.staleKeys=[];
  }
  function summaryDiff(before,after){
    const keys=[...new Set(Object.keys(before||{}).concat(Object.keys(after||{})))];
    return keys.filter(k=>typeof (before||{})[k]==="number"||typeof (after||{})[k]==="number").map(k=>{
      const a=Number((before||{})[k]),b=Number((after||{})[k]);
      if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)<1e-9)return null;
      return {key:k,label:METRIC_LABELS[k]||k,before:a,after:b,delta:b-a,deltaPct:Math.abs(a)>1e-9?(b-a)/Math.abs(a)*100:null};
    }).filter(Boolean).sort((a,b)=>Math.abs(b.deltaPct||0)-Math.abs(a.deltaPct||0));
  }
  function createCalcSnapshot(state,calcType,params,result,meta){
    state=state||{}; state.calcSnapshots=Array.isArray(state.calcSnapshots)?state.calcSnapshots:[];
    const nextVersion=state.calcSnapshots.reduce((n,x)=>Math.max(n,Number(x.version)||0),0)+1;
    const snap={id:uid("calc"),version:nextVersion,createdAt:new Date().toISOString(),calcType,
      params:clone(params||{}),summary:clone(result&&result.summary||{}),hash:hash({calcType,params,summary:result&&result.summary}),
      reason:String(meta&&meta.reason||"测算确认"),confirmedBy:String(meta&&meta.confirmedBy||"")};
    state.calcSnapshots.push(snap);if(state.calcSnapshots.length>50)state.calcSnapshots.splice(0,state.calcSnapshots.length-50);state.currentCalcSnapshotId=snap.id; return snap;
  }
  function createReportVersion(state,chapters,meta){
    state=state||{}; state.reportVersions=Array.isArray(state.reportVersions)?state.reportVersions:[];
    meta=meta||{};const trust=root.ReportTrust,evidenceApi=root.ReportEvidenceGraph,dependencyApi=root.ReportDependency;
    const body=(chapters||[]).map(c=>({cn:c.cn,name:c.name,checked:c.checked,sections:(c.sections||[]).map(s=>({t:s.t,numeric:!!s.numeric,content:s.content||"",editedHtml:s.editedHtml||null,locked:!!s.locked,syncStatus:s.syncStatus||"current",prov:clone(s.prov||null),logicSnapshot:clone(s.logicSnapshot||null),trust:trust?trust.buildSectionProfile(s,{hasCalculation:!!state.currentCalcSnapshotId}):null}))}));
    const nextVersion=state.reportVersions.reduce((n,x)=>Math.max(n,Number(x.version)||0),0)+1;
    const lineage=trust?trust.buildLineage(state,meta):null;
    const evidenceAudit=evidenceApi?evidenceApi.preSubmitAudit(chapters):null;
    const calc=(state.calcSnapshots||[]).find(x=>x&&x.id===state.currentCalcSnapshotId),dependencyGraph=dependencyApi?dependencyApi.buildGraph({calcType:calc&&calc.calcType,paramKeys:Object.keys(calc&&calc.params||{}),chapters}):null;
    const ver={id:uid("report"),version:nextVersion,createdAt:new Date().toISOString(),
      calcSnapshotId:state.currentCalcSnapshotId||null,analysisSnapshotId:state.currentAnalysisSnapshotId||null,reason:String(meta.reason||"报告保存"),chapters:body,hash:hash(body),lineage,
      trustSummary:trust?trust.buildReportSummary(chapters,{hasCalculation:!!state.currentCalcSnapshotId}):null,
      evidenceAudit,dependencyGraph:dependencyGraph?{schemaVersion:dependencyGraph.schemaVersion,parameters:dependencyGraph.parameters,metrics:dependencyGraph.metrics,sections:dependencyGraph.sections,hash:hash(dependencyGraph)}:null};
    const prev=state.reportVersions[state.reportVersions.length-1];
    if(prev&&prev.hash===ver.hash&&prev.calcSnapshotId===ver.calcSnapshotId&&prev.analysisSnapshotId===ver.analysisSnapshotId&&(!lineage||prev.lineage&&prev.lineage.hash===lineage.hash))return prev;
    state.reportVersions.push(ver);if(state.reportVersions.length>50)state.reportVersions.splice(0,state.reportVersions.length-50);state.currentReportVersionId=ver.id; return ver;
  }
  function reportGenerationStatus(chapters){
    const sections=(chapters||[]).filter(c=>c&&c.checked!==false).flatMap(c=>Array.isArray(c.sections)?c.sections:[]),generated=sections.filter(s=>String(s&&((s.editedHtml&&typeof s.editedHtml==="string"?s.editedHtml:"")||s.content)||"").trim()).length;
    return {total:sections.length,generated,remaining:Math.max(0,sections.length-generated),complete:sections.length>0&&generated===sections.length};
  }
  function nextReportVersionNumber(state){
    return (Array.isArray(state&&state.reportVersions)?state.reportVersions:[]).reduce((max,item)=>Math.max(max,Number(item&&item.version)||0),0)+1;
  }
  function mergeReportDraft(templateChapters,savedChapters){
    const saved=Array.isArray(savedChapters)?savedChapters:[],used=new Set(),sectionFields=["content","editedHtml","locked","syncStatus","staleReason","staleKeys","pendingRevision","undoStack","prov","logicSnapshot"];
    return (Array.isArray(templateChapters)?templateChapters:[]).map((chapter,chapterIndex)=>{
      let savedIndex=saved.findIndex((item,index)=>!used.has(index)&&String(item&&item.cn||"")===String(chapter&&chapter.cn||"")&&String(item&&item.name||"")===String(chapter&&chapter.name||""));
      if(savedIndex<0)savedIndex=saved.findIndex((item,index)=>!used.has(index)&&String(item&&item.name||"")===String(chapter&&chapter.name||""));
      if(savedIndex<0&&saved[chapterIndex]&&!used.has(chapterIndex)&&!String(saved[chapterIndex].name||saved[chapterIndex].cn||""))savedIndex=chapterIndex;
      const old=savedIndex>=0?saved[savedIndex]:null;if(savedIndex>=0)used.add(savedIndex);
      const oldSections=Array.isArray(old&&old.sections)?old.sections:[],oldUsed=new Set();
      const sections=(chapter.sections||[]).map((section,sectionIndex)=>{
        let oldIndex=oldSections.findIndex((item,index)=>!oldUsed.has(index)&&String(item&&item.t||"")===String(section&&section.t||""));
        if(oldIndex<0&&oldSections[sectionIndex]&&!oldUsed.has(sectionIndex)&&!String(oldSections[sectionIndex].t||""))oldIndex=sectionIndex;
        const prior=oldIndex>=0?oldSections[oldIndex]:null;if(oldIndex>=0)oldUsed.add(oldIndex);
        if(!prior)return {...section};
        const restored={...section};sectionFields.forEach(key=>{if(prior[key]!==undefined)restored[key]=clone(prior[key]);});return restored;
      });
      return {...chapter,checked:old&&old.checked!==undefined?old.checked:chapter.checked,sections};
    });
  }
  function recoverCompletedReport(chapters,state,progress){
    if(!progress||((Number(progress.done)<Number(progress.total)||Number(progress.total)<=0)&&!progress.recoveredFromMismatch))return {recovered:false,chapters,status:reportGenerationStatus(chapters)};
    const version=latestCompleteReportVersion(state,progress.reportVersionId),merged=version?mergeReportDraft(chapters,version.chapters):chapters,status=reportGenerationStatus(merged);
    return version&&status.complete?{recovered:true,chapters:merged,status,version}:{recovered:false,chapters,status:reportGenerationStatus(chapters)};
  }
  function selectProjectDraft(cloudDraft,localDraft,projectId){
    if(!localDraft)return cloudDraft||null;if(!cloudDraft)return localDraft;
    const sameId=projectId&&String(localDraft.projectId||"")===String(projectId),legacyMatch=!localDraft.projectId&&String(localDraft.project&&localDraft.project.name||"")&&String(localDraft.project&&localDraft.project.name||"")===String(cloudDraft.project&&cloudDraft.project.name||"")&&String(localDraft.domainKey||"")===String(cloudDraft.domainKey||"");
    if(!(sameId||legacyMatch))return cloudDraft;
    const localRevision=Number(localDraft.documentRevision)||0,cloudRevision=Number(cloudDraft.documentRevision)||0;
    if(localRevision!==cloudRevision)return localRevision>cloudRevision?localDraft:cloudDraft;
    return Number(localDraft.ts||0)>Number(cloudDraft.ts||0)?localDraft:cloudDraft;
  }
  function claimReportGeneration(state,chapters,options){
    state=state||{};options=options||{};const status=reportGenerationStatus(chapters),now=Date.now(),old=state.reportGenerationLock;
    if(status.complete&&!options.force)return {ok:false,reason:"already_complete",status};
    if(old&&old.status==="active"&&now-Number(old.startedAt||0)<30*60*1000&&!options.force)return {ok:false,reason:"generation_active",status,lock:clone(old)};
    const lock={id:uid("report-generation"),status:"active",startedAt:now,generatedAtStart:status.generated,totalAtStart:status.total,force:!!options.force};state.reportGenerationLock=lock;
    return {ok:true,status,lock:clone(lock)};
  }
  function releaseReportGeneration(state,lockId,status){
    if(!state||!state.reportGenerationLock||state.reportGenerationLock.id!==lockId)return false;
    state.reportGenerationLock.status=String(status||"completed");state.reportGenerationLock.finishedAt=Date.now();return true;
  }
  function persistedGenerationProgress(progress,pendingCount){
    progress=progress||{};const total=Math.max(0,Number(progress.total)||0),done=Math.max(0,Math.min(total,Number(progress.done)||0)),pending=Math.max(0,Number(pendingCount)||0);
    return {role:"assistant",kind:"genProgress",total,done,failed:Math.max(0,Number(progress.failed)||0),active:false,stopped:done<total,reportVersionId:progress.reportVersionId||null,reportVersion:Number(progress.reportVersion)||null,targetReportVersion:Number(progress.targetReportVersion)||null,generationId:progress.generationId||null,recoveredFromMismatch:!!progress.recoveredFromMismatch};
  }
  function reconcileGenerationProgress(progress,chapters){
    const status=reportGenerationStatus(chapters);if(!progress)return {progress:null,status,repaired:false};
    const apparentlyComplete=Number(progress.total)>0&&Number(progress.done)>=Number(progress.total),expected={...progress,total:status.total,done:status.generated,active:false,stopped:!status.complete,recoveredFromMismatch:!!progress.recoveredFromMismatch||(apparentlyComplete&&!status.complete)};
    const repaired=Number(progress.total)!==status.total||Number(progress.done)!==status.generated||progress.active!==false||!!progress.stopped!==!status.complete||!!progress.recoveredFromMismatch!==!!expected.recoveredFromMismatch;
    return {progress:expected,status,repaired};
  }
  function latestCompleteReportVersion(state,preferredId){
    const versions=Array.isArray(state&&state.reportVersions)?state.reportVersions:[],complete=version=>version&&reportGenerationStatus(version.chapters).complete;
    const preferred=preferredId&&versions.find(version=>version&&version.id===preferredId);
    if(complete(preferred))return preferred;
    for(let index=versions.length-1;index>=0;index--)if(complete(versions[index]))return versions[index];
    return null;
  }
  function setCandidate(section,newText,instruction,meta){
    if(!section)return null;
    meta=meta||{};
    const candidate={id:uid("patch"),createdAt:new Date().toISOString(),instruction:String(instruction||""),before:currentText(section),after:String(newText||""),logicRevision:clone(meta.logicRevision||null)};
    section.pendingRevision=candidate; return candidate;
  }
  function acceptCandidate(section){
    if(!section||!section.pendingRevision)return null;
    section.undoStack=Array.isArray(section.undoStack)?section.undoStack:[];
    section.undoStack.push({at:new Date().toISOString(),content:section.content||"",editedHtml:section.editedHtml||null,logicSnapshot:clone(section.logicSnapshot||null)});
    const c=section.pendingRevision; section.content=c.after; section.editedHtml=null;if(c.logicRevision)section.logicSnapshot=clone(c.logicRevision); section.pendingRevision=null; clearSectionStale(section); return c;
  }
  function rejectCandidate(section){ if(!section)return; section.pendingRevision=null; }
  function undoSection(section){
    if(!section||!Array.isArray(section.undoStack)||!section.undoStack.length)return false;
    const prev=section.undoStack.pop(); section.content=prev.content; section.editedHtml=prev.editedHtml;section.logicSnapshot=clone(prev.logicSnapshot||null); return true;
  }
  function escapeHtml(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
  function simpleDiffHtml(before,after){
    const a=String(before||""),b=String(after||"");
    if(a===b)return '<div class="wf-diff-same">内容没有变化</div>';
    return '<div class="wf-diff-cols"><div><b>修改前</b><div class="wf-diff-old">'+escapeHtml(a)+'</div></div><div><b>建议稿</b><div class="wf-diff-new">'+escapeHtml(b)+'</div></div></div>';
  }
  // 将AI返回的局部替换稿安全放回完整小节。优先精确替换；仅在唯一命中时容忍换行/空格差异，
  // 避免同一句在正文中出现多次时误改其它位置。
  function replaceSelectedText(source,selected,replacement){
    const body=String(source||""),needle=String(selected||"").trim(),next=String(replacement||"").trim();
    if(!needle)return {ok:false,error:"没有选中文字"};
    if(!next)return {ok:false,error:"AI未返回替换内容"};
    const first=body.indexOf(needle);
    if(first>=0){
      if(body.indexOf(needle,first+needle.length)>=0)return {ok:false,error:"所选文字在本节出现多次，请扩大选择范围后重试"};
      return {ok:true,text:body.slice(0,first)+next+body.slice(first+needle.length)};
    }
    const parts=needle.split(/\s+/).filter(Boolean).map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
    if(!parts.length)return {ok:false,error:"无法识别所选文字"};
    const re=new RegExp(parts.join("\\s+"),"g"),matches=[...body.matchAll(re)];
    if(matches.length!==1)return {ok:false,error:matches.length?"所选文字在本节出现多次，请扩大选择范围后重试":"所选文字与正文源稿不一致，请改用整节AI修改"};
    const hit=matches[0],at=hit.index||0;
    return {ok:true,text:body.slice(0,at)+next+body.slice(at+hit[0].length)};
  }
  function ensureState(raw){
    const s=raw&&typeof raw==="object"?raw:{};
    if(!Array.isArray(s.calcSnapshots))s.calcSnapshots=[];
    if(!Array.isArray(s.analysisSnapshots))s.analysisSnapshots=[];
    if(!Array.isArray(s.reportVersions))s.reportVersions=[];
    if(!s.modules||typeof s.modules!=="object")s.modules={};
    return s;
  }
  function touchModule(state,key,meta){
    state=ensureState(state);const previous=state.modules[key]||{};
    const next={version:(Number(previous.version)||0)+1,updatedAt:new Date().toISOString(),reason:String(meta&&meta.reason||"模块已更新"),hash:hash(meta&&meta.value!==undefined?meta.value:meta||{})};
    state.modules[key]=next;return next;
  }
  function bulkConfirm(items){
    let changed=0;
    Array.from(items||[]).forEach(item=>{if(item&&!item.checked){item.checked=true;changed++;}});
    return {total:Array.from(items||[]).length,changed};
  }

  /* AI可研对话流程只认“已经形成的业务结果”，不认页面刚好渲染了哪张旧卡片。
     这样刷新、切换项目或旧会话缺少某张按钮卡时，都能恢复到唯一正确的下一步。 */
  function aiReportStage(state){
    state=state||{};
    const chat=Array.isArray(state.chat)?state.chat:[];
    const progress=[...chat].reverse().find(x=>x&&x.kind==="genProgress");
    const delivered=chat.some(x=>x&&x.kind==="deliver");
    if(progress){
      if(progress.active===false&&progress.stopped===false&&Number(progress.total)>0&&Number(progress.done)>=Number(progress.total))return "delivered";
      if(progress.stopped||Number(progress.done)<Number(progress.total))return "paused";
      return "generating";
    }
    if(delivered)return "delivered";
    if(state.paramsConfirmed&&state.hasDoc&&state.suggested)return "generating";
    if(state.paramsConfirmed&&state.suggested&&(state.calcParams || state.calcSummary)) return "calculated";
    if(state.suggested) return "suggested";
    if(state.extracted) return "info";
    return "empty";
  }
  function aiReportStageRank(stage){return {empty:0,info:1,suggested:2,calculated:3,generating:4,paused:4,delivered:5}[stage]||0;}
  function previousAiReportStage(stage){
    return {suggested:"info",calculated:"suggested",generating:"calculated",paused:"calculated",delivered:"calculated"}[stage]||null;
  }
  function locationTokens(text){
    const value=String(text||"").replace(/\s+/g,"");
    const hits=value.match(/[\u4e00-\u9fa5]{2,8}(?:市|区|县|街道|镇|乡|社区|村)/g)||[];
    return [...new Set(hits.concat((value.match(/[\u4e00-\u9fa5]{2,8}区/g)||[])))];
  }
  function rankLocationCandidates(query,candidates){
    const q=String(query||"").replace(/\s+/g,""),tokens=locationTokens(q);
    return Array.from(candidates||[]).map((item,index)=>{
      const hay=[item.name,item.district,item.address].filter(Boolean).join("").replace(/\s+/g,"");
      const matched=tokens.filter(t=>hay.includes(t));
      const conflicts=tokens.filter(t=>/[区县]$/.test(t)&&!hay.includes(t));
      let score=matched.length*30-conflicts.length*45-index;
      if(q&&hay.includes(q))score+=80;
      return Object.assign({},item,{matchScore:score,matchedTokens:matched,conflictTokens:conflicts,locationMatch:conflicts.length?"conflict":matched.length?"matched":"uncertain"});
    }).sort((a,b)=>b.matchScore-a.matchScore);
  }
  function normalizeAnalysisSites(sites,fallback){
    const source=Array.isArray(sites)&&sites.length?sites:[fallback||{}],out=[];
    source.slice(0,6).forEach((item,index)=>{
      item=item||{};
      const name=String(item.name||item.projectName||"").trim(),address=String(item.address||item.location||"").trim();
      out.push(Object.assign({},item,{id:String(item.id||("site-"+(index+1))),name,address,role:item.role==="primary"?"primary":"secondary"}));
    });
    if(!out.length)out.push({id:"site-1",name:"",address:"",role:"primary"});
    let primary=out.findIndex(x=>x.role==="primary");if(primary<0)primary=0;
    return out.map((item,index)=>Object.assign({},item,{role:index===primary?"primary":"secondary"}));
  }
  function siteWritingPlan(sites){
    const normalized=normalizeAnalysisSites(sites),primary=normalized.find(x=>x.role==="primary")||normalized[0],secondary=normalized.filter(x=>x!==primary);
    const strategy=secondary.length
      ? "主项目“"+(primary.name||primary.address||"未命名主项目")+"”完整展开论证；其余"+secondary.length+"个次项目只写影响结论的差异，优先合并为一段，确需分列时每个最多2—3句，不重复主项目的通用分析。"
      : "仅有一个分析点位，按本节逻辑正常展开论证。";
    return {sites:normalized,primary,secondary,isBatch:secondary.length>0,strategy};
  }
  function aiReportProjectSeed(project,state,domainKey){
    project=project||{};state=state||{};
    if(!String(project.name||"").trim())return null;
    const snapshots=Array.isArray(state.calcSnapshots)?state.calcSnapshots:[],latest=snapshots[snapshots.length-1]||{};
    const raw=String(latest.calcType||project.calcType||project.type||"").toLowerCase();
    const calcType=["rent","sale","gaibao"].includes(raw)?raw:(domainKey==="baozhang_gaibao"||/改保|改造/.test(raw)?"gaibao":/出售|配售|sale/.test(raw)?"sale":"rent");
    return {projectName:String(project.name||""),location:String(project.location||""),analysisSites:normalizeAnalysisSites(project.analysisSites,{name:project.name,location:project.location,role:"primary"}),calcType,businessScenario:project.businessScenario||null,
      landArea:project.landArea??null,landPrice:project.landPrice??null,startYear:project.startYear??null,owner:String(project.owner||""),landNature:String(project.landNature||""),desc:String(project.desc||""),__manual:true,__projectSeed:true};
  }
  function aiReportShouldSeedProject(entryContext){return !!(entryContext&&entryContext.explicitAiEntry===true);}
  function resumeAppMode(savedMode,hasAiSession){
    if(hasAiSession)return "aireport";
    return ["report","calc","review","office","aireport"].includes(savedMode)?savedMode:"report";
  }
  function aiReportDirectAction(text){
    const q=String(text||"").trim().replace(/[，。！？!?,.\s]/g,"");
    if(/^(开始|进入|去|帮我|我要|进行|立即|现在)*(复核|审查|人工审查|复核与签发)$/.test(q))return "review";
    return null;
  }
  function buildProjectDiagnostic(input){
    input=input||{};
    const project=clone(input.project||{}),summary=clone(input.summary||{}),params=input.params||{};
    const anomalies=(input.anomalies||[]).map(x=>({severity:x.severity||"warn",key:x.key||"",label:x.label||x.key||"参数",message:x.message||"",rule:x.rule||"",currentValue:x.currentValue,referenceValue:x.referenceValue}));
    const sensitivity=(input.sensitivity||[]).slice().sort((a,b)=>(Number(a.impactRank)||999)-(Number(b.impactRank)||999)).slice(0,10).map(x=>({key:x.key,label:x.label||x.key,impactLevel:x.impactLabel||x.impactLevel||"未分析",rank:x.impactRank||x.combinedRank||null,strength:Number.isFinite(x.STi)?x.STi:Number.isFinite(x.spearmanRho)?Math.abs(x.spearmanRho):null}));
    const sources=Object.entries(input.sources||{}),sourceRisks=sources.filter(([,x])=>x&&(x.requiresManualConfirmation||x.confidence==="低")).map(([key,x])=>({key,label:(input.paramMeta&&input.paramMeta[key]&&input.paramMeta[key].label)||key,source:x.from||x.sourceLabel||"未说明",confidence:x.confidence||"低",manualRequired:!!x.requiresManualConfirmation}));
    const sections=(input.sections||[]),stale=sections.filter(x=>x.status==="stale"),lockedStale=sections.filter(x=>x.status==="locked-stale"),pending=sections.filter(x=>x.pendingRevision);
    const review=(input.reviewIssues||[]).map(x=>({severity:x.sev||x.severity||"info",chapter:x.chName||x.chapter||"",section:x.secTitle||x.title||"",message:x.msg||x.message||""}));
    const actions=[];
    anomalies.forEach(x=>actions.push({priority:x.severity==="error"?"高":"中",action:"核实并修正参数“"+x.label+"”",basisType:"硬规则/白箱异常",basis:x.message+(x.rule?"；依据："+x.rule:"")}));
    if(stale.length)actions.push({priority:"高",action:"更新 "+stale.length+" 个未锁定的待同步章节",basisType:"流程状态",basis:"测算版本已变化，但正文仍对应旧快照"});
    if(lockedStale.length)actions.push({priority:"高",action:"人工复核 "+lockedStale.length+" 个锁定且待同步章节",basisType:"流程状态",basis:"系统不会自动覆盖人工锁定正文"});
    review.filter(x=>x.severity==="err"||x.severity==="warn").slice(0,10).forEach(x=>actions.push({priority:x.severity==="err"?"高":"中",action:"处理审查问题"+(x.section?"：“"+x.section+"”":""),basisType:"确定性审查",basis:x.message}));
    if(sourceRisks.length)actions.push({priority:"中",action:"补强 "+sourceRisks.length+" 项低置信度或需人工确认的参数依据",basisType:"参数来源",basis:sourceRisks.slice(0,6).map(x=>x.label+"（"+x.source+"）").join("、")});
    if(!sensitivity.length)actions.push({priority:"提示",action:"补跑或发布敏感性分析结果",basisType:"数据缺口",basis:"当前没有可用敏感性排序，不能可靠判断优化杠杆"});
    const metricKeys=["irr","capitalIrr","totalNpv","totalIncome","totalCost","totalNetProfit","payback","dynamicPayback","icr","dscr","totalInvestment"];
    const metrics=Object.fromEntries(metricKeys.filter(k=>summary[k]!==undefined&&summary[k]!==null).map(k=>[k,summary[k]]));
    return {generatedAt:new Date().toISOString(),scope:"diagnosis_read_only",projectFacts:project,calcType:input.calcType||null,metrics,
      dataAvailability:{hasCalculation:!!input.summary,hasSensitivity:!!sensitivity.length,hasReview:!!review.length,hasKnowledgeEvidence:!!(input.knowledgeEvidence||[]).length},
      hardRuleAnomalies:anomalies,sensitivityTop:sensitivity,parameterSourceRisks:sourceRisks.slice(0,20),
      reportStatus:{total:sections.length,current:sections.filter(x=>x.status==="current").length,stale:stale.length,lockedStale:lockedStale.length,pendingRevision:pending.length,items:sections.filter(x=>x.status!=="current"||x.pendingRevision).slice(0,30)},
      reviewIssues:review.slice(0,30),knowledgeEvidence:clone(input.knowledgeEvidence||[]),actionCandidates:actions.slice(0,30),
      guardrails:["财务数字来自白箱测算结果","异常结论来自硬规则检查","知识资料仅按检索匹配度作为依据","未提供的数据必须明确写暂无，不能推测","本工具只诊断，不修改参数或正文"]};
  }

  const api={clone,hash,paramGroup,sectionAffected,impactedSections,markImpacted,clearSectionStale,summaryDiff,
    createCalcSnapshot,createReportVersion,reportGenerationStatus,nextReportVersionNumber,mergeReportDraft,recoverCompletedReport,selectProjectDraft,claimReportGeneration,releaseReportGeneration,persistedGenerationProgress,reconcileGenerationProgress,latestCompleteReportVersion,setCandidate,acceptCandidate,rejectCandidate,undoSection,simpleDiffHtml,replaceSelectedText,ensureState,touchModule,bulkConfirm,
    aiReportStage,aiReportStageRank,previousAiReportStage,locationTokens,rankLocationCandidates,normalizeAnalysisSites,siteWritingPlan,aiReportProjectSeed,aiReportShouldSeedProject,resumeAppMode,aiReportDirectAction,buildProjectDiagnostic,
    impactedAnalysisSections,markAnalysisImpacted,METRIC_LABELS,ANALYSIS_DOMAIN_WORDS};
  root.ProjectWorkflow=api;
  if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
