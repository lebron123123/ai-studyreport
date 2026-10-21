/* Confirm a persisted length plan before any paid first-draft request. */
(function(root){
  'use strict';
  let pending=null;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function capture(){
    const research=root.ResearchUI?.active()?root.ResearchUI.capture('report'):null;
    return {research,projectId:typeof currentProjectId==='undefined'?null:currentProjectId,owner:projectWorkflow,outline:chapters,legacyBudgets:root.ReportLengthPlan.legacyBudgetSummary(projectWorkflow?.reportCompletion?.budgets)};
  }
  function current(context){
    const same=context.research?root.ResearchUI?.active()&&root.ResearchUI.accepts(context.research):!root.ResearchUI?.active()&&(typeof currentProjectId==='undefined'?null:currentProjectId)===context.projectId;
    return !!same&&projectWorkflow===context.owner&&chapters===context.outline;
  }
  function editable(context){return current(context)&&(context.research?root.ResearchUI.editable():typeof projectCanEdit!=='function'||projectCanEdit());}
  function planStatus(){
    const completion=typeof projectWorkflow==='undefined'?null:projectWorkflow?.reportCompletion,saved=completion?.lengthPlan;
    const result={status:'unconfirmed',plan:saved||null,valid:false,requiresConfirmation:false,target:Number(saved?.proseTotal)||null,targetPages:Number(saved?.targetPages)||null,planId:saved?.planId||null,reasons:[],message:'尚无已确认的篇幅计划，保留旧报告原有状态。'};
    // An old report with no confirmation stays compatible. A confirmed plan
    // that later becomes stale must never disappear into that legacy state.
    if(saved?.confirmedAt===undefined||saved?.confirmedAt===null)return result;
    const reasons=result.reasons,api=root.ReportLengthPlan;
    if(typeof saved.confirmedAt!=='string'||!Number.isFinite(Date.parse(saved.confirmedAt)))reasons.push({code:'invalid-confirmation',message:'篇幅计划的确认时间无效'});
    if(!api?.validatePlan||!api?.legacyBudgetSummary)reasons.push({code:'plan-module-unavailable',message:'篇幅计划检查模块未加载，请刷新后重试'});
    else{
      try{
        const check=api.validatePlan(saved,typeof chapters==='undefined'?undefined:chapters);
        if(!check.valid)reasons.push(...(check.errors?.length?check.errors:[{code:'invalid-plan',message:'篇幅计划已失效'}]));
        const resolution=saved.budgetResolution,legacy=api.legacyBudgetSummary(completion?.budgets);
        if(resolution?.policy!=='confirmed-length-plan')reasons.push({code:'unconfirmed-budget-policy',message:'尚未确认本轮篇幅分配与旧人工预算的优先级'});
        else if(resolution.legacyBudgetFingerprint!==legacy.fingerprint)reasons.push({code:'stale-budgets',message:'人工正文预算已变化，包括新增、修改或清空预算'});
      }catch(error){reasons.push({code:'plan-check-failed',message:'篇幅计划暂时无法核对：'+error.message});}
    }
    result.status=reasons.length?'stale-confirmed':'confirmed';result.valid=!reasons.length;result.requiresConfirmation=!!reasons.length;
    result.message=reasons.length?'已确认的篇幅计划已失效：'+[...new Set(reasons.map(reason=>reason.message))].join('；')+'。请重新确认；原目标和正文保留，尚不能标为完成。':'已确认的篇幅计划与当前目录及人工预算一致。';
    return result;
  }
  function savedPlan(){const state=planStatus();return state.status==='confirmed'?state.plan:null;}
  function reviewDelivery(entries){
    const state=planStatus();if(state.status==='unconfirmed')return null;
    if(!root.ReportCompletionContract?.reviewLength)throw new Error('篇幅交付检查模块未加载，请刷新后重试；尚不能标为完成');
    return root.ReportCompletionContract.reviewLength(entries,state.plan,state);
  }
  async function confirmPlan(options){
    options=options||{};
    if(!root.ReportLengthPlan)throw new Error('篇幅计划模块未加载，请刷新后重试');
    if(pending){if(!current(pending.context))throw new Error('另一个项目或研究的篇幅确认尚未结束，请先关闭原确认框');return pending.promise;}
    if(!options.force&&savedPlan()&&(!options.initialDelivery||savedPlan().initialDeliveryAuthorization?.authorized===true))return true;
    const context=capture();if(!editable(context))throw new Error('当前项目或研究不可编辑，不能确认生成计划');
    const previousPlan=projectWorkflow?.reportCompletion?.lengthPlan;
    let chapterTargets=clone(previousPlan?.chapterTargets||{}),plan,allocationReset='';
    const initialPriority=previousPlan?.planningPriority||(previousPlan?'words':'pages'),initialPages=previousPlan?.targetPages??root.ReportLengthPlan.DEFAULTS.targetPages;
    const initialTargets={targetPages:initialPages,planningPriority:initialPriority,proseTotal:previousPlan?.proseTotal??(initialPriority==='pages'?root.ReportLengthPlan.recommendedProse(initialPages):root.ReportLengthPlan.DEFAULTS.proseTotal)};
    try{plan=root.ReportLengthPlan.createPlan(chapters,{...initialTargets,chapterTargets});}
    catch(error){chapterTargets={};plan=root.ReportLengthPlan.createPlan(chapters,initialTargets);allocationReset='目录或分配已变化，旧章节锁定未套用；总页数与字数目标保留。'+error.message;}
    let finish;
    const promise=new Promise(resolve=>{finish=resolve;});pending={promise,context};
    document.body.insertAdjacentHTML('beforeend','<div class="air-modal-overlay" id="reportLengthPlanModal"><div class="air-modal-card air-report-logic-modal" role="dialog" aria-modal="true" aria-labelledby="reportLengthPlanTitle" style="max-width:980px;width:95vw;max-height:90vh;overflow:auto"><div class="air-modal-head"><b id="reportLengthPlanTitle">生成前确认篇幅与章节计划</b><button type="button" data-length-close aria-label="取消">×</button></div><p>先确认目标，再直接生成完整工作稿；后续按你的修改意见生成候选稿。保留章节、小节、下级标题和必要表格，不通过删结构、缩字号或填充套话凑页数。</p><div style="display:flex;gap:16px;flex-wrap:wrap"><label>规划优先项 <select id="reportLengthPriority"><option value="pages"'+(plan.planningPriority==='pages'?' selected':'')+'>页数优先（按历史密度建议字数）</option><option value="words"'+(plan.planningPriority==='words'?' selected':'')+'>字数优先（保留自选字数）</option></select></label><label>目标页数 <input id="reportLengthPages" type="number" min="1" max="1000" value="'+plan.targetPages+'"></label><label>正文目标字数 <input id="reportLengthWords" type="number" min="1" max="500000" step="500" value="'+plan.proseTotal+'"></label><button type="button" class="btn ghost" data-length-words-default>使用7.5万字默认值</button><button type="button" class="btn ghost" data-length-reset>恢复默认分配</button></div><p data-length-page-range></p><p>参考：税务局V9同版式实际排版105页、约73,950有效字。按这一份历史密度，120页建议约84,500有效字；这不是固定每页字数，其他项目的封面、目录、标题和表格会改变页数。7.5万字默认值仍可选择，切为字数优先后修改页数不改你的字数。最终须实际排版核验。</p><div data-length-warnings role="status"></div><div style="overflow:auto"><table style="width:100%"><thead><tr><th>章节</th><th>计划正文（字）</th><th>预计页数</th><th>预计页码*</th><th>分配</th></tr></thead><tbody data-length-chapters></tbody></table></div><p>* 页码为粗估正文位置，不是最终目录页码。修改一章会锁定该章目标，其余章节按论证权重分配；可取消手动分配。低于6万字或粗估90页须注意深度；高于9万字须注意冗长。警戒只提醒，不自动删减，依据章节只列完整适用清单。</p><div data-length-status role="status" aria-live="polite"></div><div class="air-modal-actions"><button type="button" class="btn ghost" data-length-close>取消，不调用AI</button><button type="button" class="btn" data-length-confirm>'+ (options.onlySave?'确认并保存计划':'确认计划，开始生成') +'</button></div></div></div>');
    const modal=document.getElementById('reportLengthPlanModal'),pages=modal.querySelector('#reportLengthPages'),words=modal.querySelector('#reportLengthWords'),rows=modal.querySelector('[data-length-chapters]'),warnings=modal.querySelector('[data-length-warnings]'),status=modal.querySelector('[data-length-status]'),button=modal.querySelector('[data-length-confirm]');
    const priority=modal.querySelector('#reportLengthPriority'),pageRange=modal.querySelector('[data-length-page-range]');
    if(options.initialDelivery&&!options.onlySave)warnings.insertAdjacentHTML('beforebegin','<section data-length-initial-authorization><p>本次确认同时允许系统完成这一轮起草：先写明细，再写汇总，最后按下载所用的 Word 版式核对页数。需要补齐或修复时，每节最多追加 2 次，全篇追加不超过当前小节数，总时限 30 分钟，实际排版最多 3 次；追加也会消耗模型额度，费用按实际输入、输出计费。只处理本轮新写的正文，旧稿、人工修改、锁定及已有候选不会被自动替换。遇到资料矛盾、网络或额度问题会保留全部结果并暂停，不会假称整篇完成。</p><p data-length-initial-priority></p></section>');
    warnings.insertAdjacentHTML('beforebegin','<section data-length-legacy><p>本轮按本次确认的章节计划生成。旧人工预算不删除；表格、图片等非篇幅限制仍保留。</p>'+(context.legacyBudgets.count?'<details open><summary>发现 '+context.legacyBudgets.count+' 项旧人工正文预算，与新分配存在优先级冲突</summary><ul>'+context.legacyBudgets.rows.map(row=>'<li>'+esc(row.key)+'：原目标 '+esc(row.proseTarget??'未设')+' 字，原上限 '+esc(row.proseMax??'未设')+' 字；'+esc(row.reason||'原预算未注明原因')+'</li>').join('')+'</ul><label><input type="checkbox" data-length-budget-ack> 本轮采用新分配；旧预算完整保留，并记录此次选择</label></details>':'')+'</section>');
    const budgetAck=modal.querySelector('[data-length-budget-ack]');
    let saving=false;
    const close=value=>{if(saving)return;modal.remove();pending=null;finish(value);};
    const refresh=()=>{
      try{
        if(!current(context))throw new Error('项目或研究已切换，请关闭后重新确认');
        if(root.ReportLengthPlan.legacyBudgetSummary(context.owner.reportCompletion?.budgets).fingerprint!==context.legacyBudgets.fingerprint)throw new Error('人工正文预算已变化，请关闭后重新确认；不会调用AI');
        plan=root.ReportLengthPlan.createPlan(chapters,{targetPages:Number(pages.value),proseTotal:Number(words.value),planningPriority:priority.value,chapterTargets});
        pageRange.textContent='目标 '+plan.targetPages+' 页，实际排版核对范围 '+plan.targetPageRange.min+'–'+plan.targetPageRange.max+' 页；历史密度建议 '+plan.recommendedProseTotal.toLocaleString()+' 有效字。字数达到不保证页数或专业深度达标。';
        const initialPriorityNote=modal.querySelector('[data-length-initial-priority]');
        if(initialPriorityNote)initialPriorityNote.textContent=plan.planningPriority==='pages'?'页数为主：以实际排版范围为篇幅收尾条件；字数是起始分配估计，可在本轮授权内按实际页数调整，但不得省略结构、必要分析或表格。':'字数为主：以确认字数范围为篇幅收尾条件，同时核验实际页数；页数只作参考，不承诺字数与页数同时固定。';
        const extras=allocationReset?[allocationReset]:[];
        warnings.innerHTML=[...plan.warnings.map(w=>w.message),...extras].map(message=>'<p style="color:#8a5500">'+esc(message)+'</p>').join('');
        const chapterKeys=JSON.stringify(plan.chapters.map(chapter=>chapter.key));
        const allocation=(chapter,index)=>chapter.edited?'<button type="button" data-length-unlock="'+index+'">取消手动</button>':'按权重';
        if(rows.dataset.lengthKeys!==chapterKeys){
          rows.innerHTML=plan.chapters.map((chapter,index)=>'<tr><td>'+esc(chapter.name)+'</td><td><input type="number" min="0" step="100" data-length-chapter="'+index+'" value="'+chapter.target+'" aria-label="'+esc(chapter.name)+'字数"></td><td>'+chapter.estimatedPages.toFixed(1)+'</td><td>'+(chapter.estimatedStartPage??'—')+'–'+(chapter.estimatedEndPage??'—')+'</td><td>'+allocation(chapter,index)+'</td></tr>').join('');
          rows.dataset.lengthKeys=chapterKeys;
        }else plan.chapters.forEach((chapter,index)=>{
          // Keep inputs mounted: a total-input blur must not remove the next focused field.
          const cells=rows.children[index].cells;cells[1].querySelector('input').value=chapter.target;cells[2].textContent=chapter.estimatedPages.toFixed(1);cells[3].textContent=(chapter.estimatedStartPage??'—')+'–'+(chapter.estimatedEndPage??'—');cells[4].innerHTML=allocation(chapter,index);
        });
        rows.querySelectorAll('[data-length-chapter]').forEach(input=>input.onchange=()=>{chapterTargets[plan.chapters[Number(input.dataset.lengthChapter)].key]=Number(input.value);refresh();});
        rows.querySelectorAll('[data-length-unlock]').forEach(input=>input.onclick=()=>{delete chapterTargets[plan.chapters[Number(input.dataset.lengthUnlock)].key];refresh();});
        const range=root.ReportLengthPlan.DELIVERY_RANGE;
        status.textContent='总计划 '+plan.totalTarget.toLocaleString()+' 字，粗估 '+plan.estimatedPages.toFixed(1)+' 页。'+(range?'实际写作按完整目标展开；整篇正文核对范围 '+Math.ceil(plan.proseTotal*range.minRatio).toLocaleString()+'–'+Math.floor(plan.proseTotal*range.maxRatio).toLocaleString()+' 字，表格不计入正文，字数达到不等于质量合格。':'')+(plan.lengthScope==='partial-outline'?'当前目录容量不足；请调整目标或目录，不作为完整报告计划。':'');
        button.disabled=!plan.sections.length||plan.lengthScope!=='full-report'||!!(budgetAck&&!budgetAck.checked);if(budgetAck&&!budgetAck.checked)status.textContent+=' 请先确认旧正文预算与本轮分配的优先级。';return !button.disabled;
      }catch(error){status.textContent=error.message;button.disabled=true;return false;}
    };
    const usePageRecommendation=()=>{try{words.value=root.ReportLengthPlan.recommendedProse(Number(pages.value));}catch(error){status.textContent=error.message;button.disabled=true;return false;}return refresh();};
    pages.onchange=()=>priority.value==='pages'?usePageRecommendation():refresh();
    words.onchange=()=>{priority.value='words';refresh();};
    priority.onchange=()=>priority.value==='pages'?usePageRecommendation():refresh();
    if(budgetAck)budgetAck.onchange=refresh;
    modal.querySelector('[data-length-reset]').onclick=()=>{chapterTargets={};pages.value=root.ReportLengthPlan.DEFAULTS.targetPages;priority.value='pages';usePageRecommendation();};
    modal.querySelector('[data-length-words-default]').onclick=()=>{priority.value='words';words.value=root.ReportLengthPlan.DEFAULTS.proseTotal;refresh();};
    modal.querySelectorAll('[data-length-close]').forEach(input=>input.onclick=()=>close(false));
    button.onclick=async()=>{
      if(saving||!refresh())return;
      saving=true;button.disabled=true;status.textContent='正在保存确认计划…';
      const prior=context.owner.reportCompletion;
      const state={...(prior||{}),lengthPlan:{...clone(plan),confirmedAt:new Date().toISOString(),confirmedBy:typeof getUser==='function'?getUser():'当前用户',budgetResolution:{policy:'confirmed-length-plan',legacyBudgetFingerprint:context.legacyBudgets.fingerprint}},history:[...(prior?.history||[]),{at:new Date().toISOString(),reason:'人工确认生成前篇幅与章节计划；本轮新分配优先，旧预算保留',lengthPlanId:plan.planId,previousLengthPlanId:prior?.lengthPlan?.planId||null,legacyProseBudgets:clone(context.legacyBudgets.rows)}]};
      if(options.initialDelivery&&!options.onlySave)state.lengthPlan.initialDeliveryAuthorization={authorized:true,version:'initial-delivery-v1',planId:plan.planId,planningPriority:plan.planningPriority,targetRole:plan.planningPriority==='pages'?'pages-primary':'words-primary',maxAdditionalCalls:plan.sections.length,maxAdditionalCallsPerSection:2,maxElapsedMs:1800000,maxPaginationPasses:3,confirmedAt:state.lengthPlan.confirmedAt};
      const configurationCurrent=()=>root.ReportLengthPlan.validatePlan(plan,chapters).valid&&root.ReportLengthPlan.legacyBudgetSummary(context.owner.reportCompletion?.budgets).fingerprint===context.legacyBudgets.fingerprint;
      let acknowledged=false;
      try{
        if(!editable(context))throw new Error('项目、轮次或权限已变化，未确认计划');
        if(context.research)await root.ResearchUI.guard(context.research);
        if(!editable(context))throw new Error('权限复核期间项目已变化，未确认计划');
        if(context.owner.reportCompletion!==prior||!configurationCurrent())throw new Error('权限复核期间目录或人工配置已变化，未覆盖新配置；请重新确认');
        context.owner.reportCompletion=state;
        const saved=await persistReportDraft();
        if(!saved?.ok)throw new Error('计划尚未保存成功，请重试；不会调用AI');
        acknowledged=true;
        if(!editable(context)||context.owner.reportCompletion!==state||!configurationCurrent())throw new Error('保存期间项目或计划已变化，请重新确认');
        if(typeof airSaveState==='function')await airSaveState();
        if(!editable(context)||context.owner.reportCompletion!==state||!configurationCurrent())throw new Error('保存后项目、轮次或计划已变化，未启动AI，请重新确认');
        saving=false;close(true);
      }catch(error){if(!acknowledged&&context.owner.reportCompletion===state)context.owner.reportCompletion=prior;saving=false;button.disabled=false;status.textContent=error.message;}
    };
    refresh();pages.focus();return promise;
  }
  root.ReportLengthUI={confirm:confirmPlan,savedPlan,planStatus,reviewDelivery};
})(typeof window!=='undefined'?window:globalThis);
