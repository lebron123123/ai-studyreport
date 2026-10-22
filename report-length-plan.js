/* Pure report-length planning. Estimates are not pagination or professional approval. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ReportLengthPlan=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='20261010-confirmed-length-v3';
  const DEFAULTS=Object.freeze({targetPages:120,proseTotal:75000,maxPages:130,basisTarget:600,sectionCap:3600});
  // A confirmed prose target is a delivery range, not a physical-page promise.
  // Section lower lines locate thin analysis only; they never reject a section.
  const DELIVERY_RANGE=Object.freeze({version:'20261009-confirmed-delivery-v1',minRatio:0.9,maxRatio:1.1});
  // Read-only production-export baseline: V9, 12 chapters/43 sections/42 tables.
  // The whole-document ratio includes historical layout overhead; it is not a
  // transferable text density, and cannot predict a new report's actual pages.
  const CALIBRATION=Object.freeze({proseCharacters:73950,actualPages:105,source:'tax-project-v9-wps-20260930',method:'historical-whole-document-prose-ratio'});
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value);
  function hash(value){const s=stable(value);let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
  function failure(code,message){const error=new Error(message);error.code=code;throw error;}
  function integer(value,fallback,label,min,max){const n=value===undefined?fallback:typeof value==='string'&&value.trim()===''?NaN:Number(value);if(!Number.isInteger(n)||n<min||n>max)failure('invalid-option',label+'须为 '+min+'–'+max+' 的整数');return n;}
  function recommendedProse(targetPages){const pages=integer(targetPages,DEFAULTS.targetPages,'目标页数',1,1000);return Math.max(1,Math.round(pages*CALIBRATION.proseCharacters/CALIBRATION.actualPages/500)*500);}
  function pageRange(targetPages){return {min:targetPages===120?110:Math.max(1,Math.round(targetPages*0.9)),max:targetPages===120?130:Math.max(1,Math.round(targetPages*1.1))};}
  function basisRole(chapter,section){
    const labels=x=>[x?.name,x?.t,x?.title,x?.parentTitle,x?.parentName,typeof x?.parent==='string'?x.parent:x?.parent?.name||x?.parent?.title,...(Array.isArray(x?.ancestors)?x.ancestors.map(p=>typeof p==='string'?p:p?.name||p?.title):[])].filter(Boolean).join(' / ');
    return section?.basis===true||chapter?.basis===true||/依据/.test(labels(chapter)+' / '+labels(section));
  }
  function outline(chapters){
    if(!Array.isArray(chapters))failure('invalid-outline','篇幅计划需要章节目录数组');
    const keys=new Set(),chapterKeys=new Set(),rows=[];
    chapters.forEach((chapter,chapterIndex)=>{
      if(!chapter||typeof chapter!=='object')failure('invalid-outline','章节目录格式无效');
      if(chapter.checked===false)return;
      const name=String(chapter.name||chapter.title||'').trim();
      if(!name||chapterKeys.has(name))failure('invalid-outline','章节名称须非空且唯一');chapterKeys.add(name);
      if(!Array.isArray(chapter.sections))failure('invalid-outline','章节缺少小节目录：'+name);
      const sections=chapter.sections.map((section,sectionIndex)=>{
        if(!section||typeof section!=='object')failure('invalid-outline','小节目录格式无效');
        const title=String(section.t||section.title||'').trim(),key=name+' / '+title,basis=basisRole(chapter,section);
        if(!title||keys.has(key))failure('invalid-outline','小节名称须非空且在章节内唯一');keys.add(key);
        return {key,chapterKey:name,chapterIndex,sectionIndex,title,basis,weight:basis?0:/财务|风险|工程|改造方案|市场|投资|不确定/.test(key)?1.5:1,numeric:!!section.numeric};
      });
      rows.push({key:name,name,chapterIndex,sections});
    });
    return rows;
  }
  // Integer weighted water filling. The cap protects one generation request,
  // never truncates existing or generated prose, and partial outlines are named.
  function allocate(rows,pool,cap){
    let available=pool,active=rows.slice();const values=new Map(rows.map(r=>[r.key,0]));
    while(active.length){
      const weights=active.reduce((n,r)=>n+r.weight,0),capped=active.filter(r=>available*r.weight/weights>cap(r));
      if(!capped.length)break;
      capped.forEach(r=>{values.set(r.key,cap(r));available-=cap(r);});active=active.filter(r=>!capped.includes(r));
    }
    const weights=active.reduce((n,r)=>n+r.weight,0),fractions=active.map((r,index)=>{const exact=weights?available*r.weight/weights:0,n=Math.floor(exact);values.set(r.key,n);return {r,index,remainder:exact-n};});
    let rest=active.length?available-fractions.reduce((n,x)=>n+values.get(x.r.key),0):0;
    fractions.sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
    for(let i=0;rest>0;i++,rest--)values.set(fractions[i%fractions.length].r.key,values.get(fractions[i%fractions.length].r.key)+1);
    return values;
  }
  function semantic(plan){return {version:plan.version,outlineIdentity:plan.outlineIdentity,targetPages:plan.targetPages,targetPageRange:plan.targetPageRange,maxPages:plan.maxPages,planningPriority:plan.planningPriority,proseTotal:plan.proseTotal,chapterTargets:plan.chapterTargets,sections:plan.sections?.map(s=>({key:s.key,chapterKey:s.chapterKey,chapterIndex:s.chapterIndex,sectionIndex:s.sectionIndex,basis:s.basis,weight:s.weight,numeric:s.numeric,target:s.target}))};}
  function identity(plan){return 'length-'+hash(semantic(plan||{}));}
  // Old human section limits stay stored. A new generation must explicitly
  // acknowledge which prose allocation wins, without resetting table geometry.
  function legacyBudgetSummary(budgets){
    const rows=Object.entries(budgets&&typeof budgets==='object'&&!Array.isArray(budgets)?budgets:{}).filter(([,budget])=>budget&&typeof budget==='object'&&(own(budget,'proseTarget')||own(budget,'proseMax'))).sort(([a],[b])=>a.localeCompare(b)).map(([key,budget])=>({key,proseTarget:own(budget,'proseTarget')?String(budget.proseTarget??''):null,proseMax:own(budget,'proseMax')?String(budget.proseMax??''):null,reason:String(budget.reason||'')}));
    return {count:rows.length,rows,fingerprint:'legacy-prose-'+hash(rows)};
  }
  function createPlan(chapters,options){
    options=options||{};
    if(!options||typeof options!=='object'||Array.isArray(options))failure('invalid-option','篇幅计划参数格式无效');
    const planningPriority=options.planningPriority===undefined?'words':options.planningPriority;
    if(!['pages','words'].includes(planningPriority))failure('invalid-option','篇幅优先项须为页数或字数');
    const targetPages=integer(options.targetPages,DEFAULTS.targetPages,'目标页数',1,1000),recommendedProseTotal=recommendedProse(targetPages),proseTotal=integer(options.proseTotal,planningPriority==='pages'?recommendedProseTotal:DEFAULTS.proseTotal,'正文目标',1,500000),targetPageRange=pageRange(targetPages),catalog=outline(chapters),all=catalog.flatMap(c=>c.sections),targets=options.chapterTargets||{};
    if(!targets||typeof targets!=='object'||Array.isArray(targets))failure('invalid-option','章节目标须按章节名称登记');
    for(const key of Object.keys(targets))if(!catalog.some(c=>c.key===key))failure('unknown-chapter','篇幅目标属于未启用或已变更的章节：'+key);
    const chapterTargets={};for(const key of Object.keys(targets).sort())chapterTargets[key]=integer(targets[key],0,key+'正文目标',0,500000);
    const fixed=catalog.filter(c=>own(chapterTargets,c.key)),free=catalog.filter(c=>!own(chapterTargets,c.key)),fixedTotal=fixed.reduce((n,c)=>n+chapterTargets[c.key],0);
    if(fixedTotal>proseTotal)failure('chapter-total-overflow','指定章节目标合计超过总正文目标；请调整总目标或章节目标，未截断内容');
    if(fixed.length&&free.length===0&&fixedTotal!==proseTotal)failure('chapter-total-mismatch','所有章节均已指定目标，其合计须等于总正文目标');
    const assigned=new Map(),basisTarget=all.length?Math.min(DEFAULTS.basisTarget,Math.floor(proseTotal/all.length)):0;
    for(const chapter of fixed){
      const requested=chapterTargets[chapter.key],basis=chapter.sections.filter(s=>s.basis),business=chapter.sections.filter(s=>!s.basis),capacity=basis.length*DEFAULTS.basisTarget+business.length*DEFAULTS.sectionCap;
      if(requested>capacity)failure('chapter-capacity','章节“'+chapter.name+'”目标 '+requested+' 字超过当前小节安全分配容量 '+capacity+' 字；请降低目标或增加合法小节，不会截断正文');
      const basisPool=Math.min(requested,basis.length*DEFAULTS.basisTarget),basisValues=allocate(basis.map(s=>({...s,weight:1})),basisPool,()=>DEFAULTS.basisTarget);
      basis.forEach(s=>assigned.set(s.key,basisValues.get(s.key)));const businessValues=allocate(business,requested-basisPool,()=>DEFAULTS.sectionCap);
      business.forEach(s=>assigned.set(s.key,businessValues.get(s.key)));
      // A basis-only chapter may legitimately use less than its list allowance,
      // but cannot absorb a business-analysis budget merely to fill the book.
      if(!business.length&&requested>basisPool){const extra=allocate(basis.map(s=>({...s,weight:1})),requested,()=>DEFAULTS.basisTarget);basis.forEach(s=>assigned.set(s.key,extra.get(s.key)));}
    }
    const freeRows=free.flatMap(c=>c.sections),freeBasis=freeRows.filter(s=>s.basis),freeBusiness=freeRows.filter(s=>!s.basis),remaining=proseTotal-fixedTotal,basisPool=Math.min(remaining,freeBasis.length*basisTarget),basisValues=allocate(freeBasis.map(s=>({...s,weight:1})),basisPool,()=>DEFAULTS.basisTarget);
    freeBasis.forEach(s=>assigned.set(s.key,basisValues.get(s.key)));
    const businessPool=Math.min(remaining-basisPool,freeBusiness.length*DEFAULTS.sectionCap),businessValues=allocate(freeBusiness,businessPool,()=>DEFAULTS.sectionCap);
    freeBusiness.forEach(s=>assigned.set(s.key,businessValues.get(s.key)));
    const sections=all.map(s=>({...s,target:assigned.get(s.key)||0})),totalTarget=sections.reduce((n,s)=>n+s.target,0),estimate=totalTarget*CALIBRATION.actualPages/CALIBRATION.proseCharacters,warnings=[];
    const warn=(code,message)=>warnings.push({code,severity:'warning',message});
    if(!all.length)warn('empty-outline','当前没有启用的小节，不能据此生成完整报告。');
    if(totalTarget<proseTotal)warn('partial-outline','当前目录的安全分配容量只能承载 '+totalTarget+' 字，低于指定 '+proseTotal+' 字；不承诺完整报告页数，不将整本预算塞入少数小节。');
    if(all.some(s=>!s.basis)&&(proseTotal<60000||estimate<90))warn('low-length-advisory','低篇幅警戒：低于6万字或历史粗估90页，可能不足以展开完整论证。请核查分析深度；字数不是内容缺失的证据，不自动补水或删除结构。');
    if(proseTotal>90000)warn('high-length-advisory','高篇幅警戒：超过9万字，请核查重复与冗长。警戒仅提醒，不压缩论证、删减业务分类或截断正文。');
    if(all.some(s=>!s.basis)&&estimate<targetPageRange.min)warn('estimated-under-target','正文目标按历史版式粗估约 '+estimate.toFixed(1)+' 页，低于所选 '+targetPages+' 页的规划范围 '+targetPageRange.min+'–'+targetPageRange.max+' 页；可选择历史密度建议 '+recommendedProseTotal.toLocaleString()+' 字或保留自选字数。预计页数不是实际分页，不能为了页数注水。');
    if(estimate>targetPageRange.max)warn('estimated-over-target','正文目标按历史版式粗估约 '+estimate.toFixed(1)+' 页，高于规划范围 '+targetPageRange.min+'–'+targetPageRange.max+' 页；可调整目标或确认继续，不自动删减正文。');
    if(targetPages>DEFAULTS.maxPages||estimate>DEFAULTS.maxPages)warn('download-page-boundary','实际排版超出已确认范围或超过130页时须人工复核；是否下载仍由实际排版与下载门禁决定，预计页数不能放行或替代用户确认。');
    if(sections.some(s=>!s.basis&&s.target===0))warn('zero-business-target','有业务小节目标为0；请核查章节分配，不代表该小节可省略事实、结构或必要论证。');
    let offset=0;
    const chapterRows=catalog.map(c=>{const target=sections.filter(s=>s.chapterKey===c.key).reduce((n,s)=>n+s.target,0),estimatedPages=target*CALIBRATION.actualPages/CALIBRATION.proseCharacters,start=target?Math.floor(offset)+1:null;offset+=estimatedPages;return {key:c.key,name:c.name,chapterIndex:c.chapterIndex,target,sectionCount:c.sections.length,edited:own(chapterTargets,c.key),estimatedPages,estimatedStartPage:start,estimatedEndPage:target?Math.max(start,Math.ceil(offset)):null};});
    const plan={version:VERSION,outlineIdentity:'outline-'+hash(catalog),targetPages,targetPageRange,maxPages:DEFAULTS.maxPages,planningPriority,recommendedProseTotal,proseTotal,totalTarget,lengthScope:totalTarget<proseTotal?'partial-outline':'full-report',chapterTargets,chapters:chapterRows,sections,estimatedPages:estimate,estimateKind:CALIBRATION.method,calibration:{...CALIBRATION},warnings,actualPaginationRequired:true,professionalQualityVerified:false};
    plan.planId=identity(plan);return plan;
  }
  function validatePlan(plan,chapters){
    const errors=[];let expected=null;
    try{
      if(!plan||typeof plan!=='object'||Array.isArray(plan)||plan.version!==VERSION)failure('plan-version','篇幅计划版本无效，请重新确认');
      if(!Array.isArray(plan.chapters)||!Array.isArray(plan.sections)||!plan.outlineIdentity||plan.chapters.length>1000||plan.sections.length>5000)failure('plan-shape','篇幅计划结构或目录身份无效');
      if(chapters){
        expected=createPlan(chapters,{targetPages:plan.targetPages,proseTotal:plan.proseTotal,planningPriority:plan.planningPriority,chapterTargets:plan.chapterTargets});
        if(plan.outlineIdentity!==expected.outlineIdentity){
          // Official-logic restore can enrich numeric metadata after confirmation.
          // It affects table/dependency contracts, not prose allocation. Validate
          // the original receipt first, then permit only that metadata and its
          // derived hashes to differ; never rewrite the user's saved plan.
          const original=validatePlan(plan);if(!original.valid)failure(original.errors[0].code,original.errors[0].message);
          const compatible={...expected,outlineIdentity:plan.outlineIdentity,planId:plan.planId,sections:expected.sections.map((section,index)=>({...section,numeric:plan.sections[index]?.numeric}))};
          if(stable(plan)!==stable({...compatible,...Object.fromEntries(Object.entries(plan).filter(([k])=>!own(compatible,k)))}))failure('stale-outline','目录或小节权重已改变，请重新确认篇幅计划');
          expected=compatible;
        }
      }
      else{
        const reconstructed=[];
        for(const c of plan.chapters){const index=integer(c.chapterIndex,0,'章节序号',0,1000);if(reconstructed[index])failure('plan-shape','篇幅计划章节序号重复');reconstructed[index]={name:c.name,sections:plan.sections.filter(s=>s.chapterKey===c.key).map(s=>({t:s.title,basis:s.basis,numeric:s.numeric}))};}
        for(let i=0;i<reconstructed.length;i++)if(!reconstructed[i])reconstructed[i]={checked:false};
        expected=createPlan(reconstructed,{targetPages:plan.targetPages,proseTotal:plan.proseTotal,planningPriority:plan.planningPriority,chapterTargets:plan.chapterTargets});
      }
      if(plan.planId!==identity(plan))failure('plan-identity','篇幅计划内容已改变，确认身份失效');
      if(stable(plan)!==stable({...expected,...Object.fromEntries(Object.entries(plan).filter(([k])=>!own(expected,k)))}))failure('plan-allocation','篇幅计划的分配或估计与目录不一致，请重新确认');
    }catch(error){errors.push({code:error.code||'invalid-plan',message:error.message});}
    return {valid:errors.length===0,errors,warnings:errors.length?[]:(expected||plan).warnings||[],planId:errors.length?null:plan.planId};
  }
  function summary(plan){
    const check=validatePlan(plan);if(!check.valid)return {...check};
    return {valid:true,planId:plan.planId,targetPages:plan.targetPages,targetPageRange:{...plan.targetPageRange},planningPriority:plan.planningPriority,recommendedProseTotal:plan.recommendedProseTotal,proseTotal:plan.proseTotal,totalTarget:plan.totalTarget,lengthScope:plan.lengthScope,estimatedPages:plan.estimatedPages,estimateKind:plan.estimateKind,chapters:plan.chapters.map(c=>({...c})),warnings:plan.warnings.map(w=>({...w})),actualPaginationRequired:true,professionalQualityVerified:false};
  }
  return {VERSION,DEFAULTS,DELIVERY_RANGE,CALIBRATION,recommendedProse,pageRange,createPlan,validatePlan,identity,summary,basisRole,legacyBudgetSummary};
});
