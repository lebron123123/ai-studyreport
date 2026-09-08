/* Section argument contracts: project facts and report-wide style remain separate inputs. */
(function(root){
  'use strict';
  const VERSION='argument-evidence-2026-09-07';
  function contract(chapter,title,options={}){
    const position=String(chapter||'')+' / '+String(title||''),summary=/总论|结论|建议/.test(position),basis=/编制依据|政策|合规/.test(position);
    return {version:VERSION,question:basis?'哪些文件具体适用于本项目，适用条件和效力是否已经核对？':summary?'现有证据支持什么判断、前置条件和决策建议？':'本节业务问题是什么，事实如何支持判断和下一步行动？',
      facts:basis?['文件全称、文号、发布主体','效力及适用范围','原文可定位来源']:summary?['已完成章节的核查结果','最新测算版本','未解决事项']:['与本节直接相关的项目事实','来源、期间、单位及适用范围'],
      calculation:!!options.hasCalculation,assumptions:'假设必须显式标注及说明对结论的限制，不转写成已确认事实。',missing:'缺少关键依据时说明缺口、影响和核实动作；只在缺失位置标待补，不据此给出肯定结论。',
      checks:['事实、推理和建议分开','每项关键判断有可追溯输入','不得照搬历史项目数字',summary?'不得在总论引入正文中没有的新事实':'结论与本节事实、可用测算相符'],summary};
  }
  function prompt(chapter,title,options){const c=contract(chapter,title,options);return '\n\n【本节论证任务】\n要回答：'+c.question+'\n必需事实：'+c.facts.join('；')+'\n证据：注明资料标题及已提供的原文位置；未提供原文不得声称已核实。\n可用测算：'+(c.calculation?'仅使用本次输入的测算数据，保留口径和单位。':'未提供可信测算，不得填入金额、比例或收益指标。')+'\n允许假设：'+c.assumptions+'\n缺失处理：'+c.missing+'\n交付检查：'+c.checks.join('；')+'\n篇幅服从问题和材料，不为凑字数重复背景，不机械套用统一字数。';}
  function generationOrder(chapters){const rows=[];for(const c of chapters||[])if(c.checked!==false)for(const s of c.sections||[])rows.push({chapter:c,section:s});return rows.sort((a,b)=>Number(contract(a.chapter.name,a.section.t).summary)-Number(contract(b.chapter.name,b.section.t).summary));}
  async function runInDependencyOrder(tasks,worker,pool,concurrency,shouldContinue){
    const detail=[],summary=[],failed=[];let firstError=null;
    for(const t of tasks)(contract(t.c?.name,t.s?.t).summary?summary:detail).push(t);
    const keepRunning=()=>!firstError&&(!shouldContinue||shouldContinue());
    const safeWorker=async task=>{try{return await worker(task);}catch(error){failed.push(task);if(!firstError)firstError=error;}};
    try{await pool(detail,safeWorker,concurrency,keepRunning);if(!detail.length&&keepRunning())await pool(summary,safeWorker,concurrency,keepRunning);if(firstError)throw firstError;}
    finally{tasks.splice(0,tasks.length,...failed,...detail,...summary);}
  }
  function summaryContext(chapters,chapter,title){
    if(!contract(chapter,title).summary)return '';
    const rows=generationOrder(chapters).filter(x=>!contract(x.chapter.name,x.section.t).summary);
    const missing=rows.filter(x=>!(root.ProjectWorkflow?.hasReportBody?root.ProjectWorkflow.hasReportBody(x.section):String(x.section.editedHtml||x.section.content||'').replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/gi,' ').replace(/[\u200b-\u200f\u2060\ufeff]/g,'').trim())||['stale','locked-stale'].includes(x.section.syncStatus));
    if(missing.length)throw new Error('总论/结论等待正文完成：'+missing.map(x=>x.section.t).join('、')+'。请先续写或重试这些小节。');
    const budget=Math.max(250,Math.floor(20000/Math.max(1,rows.length)));
    return '\n\n【已完成正文的论证上下文（不是独立核验凭证）】\n'+rows.map(x=>{
      const text=String(x.section.editedHtml||x.section.content||'').replace(/<[^>]*>/g,' ');
      return x.chapter.name+' / '+x.section.t+'：\n'+text.slice(0,budget)+(text.length>budget?'\n[本节节选，未展示部分不得据此推断]':'');
    }).join('\n\n')+'\n仅概括已经给出的判断及其限制。存在待补、未验证来源或不同口径时保留限制，不改写成正式批准或已证实可行。';
  }
  const api={VERSION,contract,prompt,generationOrder,runInDependencyOrder,summaryContext};root.ReportArgument=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
