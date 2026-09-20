/* Claim → 定位片段 → 来源。章节检索命中只是候选，不证明每句话。 */
(function(root){
  'use strict';
  function regHash(value){const s=JSON.stringify(value==null?null:value);let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
  function regText(s){return root.ProjectWorkflow?.reportBodyText?root.ProjectWorkflow.reportBodyText(s):String(s??'').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/[\u200b-\u200f\u2060\ufeff]/g,'').replace(/\s+/g,' ').trim();}
  function regRefs(prov){
    prov=prov||{};const out=[];
    for(const [type,rows] of [['rag',prov.rag],['knowledge',prov.kbDocs],['excel',prov.excelSources],['web',prov.webEvidence||prov.web],['project',prov.projectFields]]){
      for(const [i,item] of (Array.isArray(rows)?rows:[]).entries()){
        const x=typeof item==='string'?{label:item}:item||{};
        out.push({sourceId:String(x.id||x.evidenceId||x.sourceRef||x.label||type+':'+i),type,title:String(x.title||x.label||x.name||type),url:String(x.url||''),authority:String(x.authorityLevel||x.authority||''),version:x.version??null,ref:x.sourceRef||x.address||x.section||'',excerpt:regText(x.excerpt||x.quote||x.text||x.content||''),lifecycle:x.lifecycle||'unknown'});
      }
    }
    if(prov.hasCalcData)out.push({sourceId:'whitebox-calc',type:'calculation',title:'测算输入上下文（非逐句核验）',version:prov.calcVersion||null,ref:prov.calcSnapshotId||'',excerpt:'',lifecycle:'unknown'});
    return out;
  }
  function regClaimSentences(text){return String(text??'').replace(/<\/(?:p|div|li|tr|h[1-6])>|<br\s*\/?>/gi,'\n').split(/\n+|(?<=[。！？；])/).map(regText).filter(Boolean).filter(x=>!/^\[\[\/?TABLE\]\]$/.test(x));}
  function regNumeric(text){const content=String(text).replace(/^\s*(?:#{1,6}\s*)?(?:(?:第[一二三四五六七八九十百\d]+[章节项条])|(?:[（(]?[一二三四五六七八九十百]+[）)、.．])|(?:\d+(?:\.\d+)*[、.．\s]+))\s*/,'');return /\d|[一二三四五六七八九十百千万亿两]+(?:元|万|亿|年|月|日|套|户|平方米|%|％)/.test(content);}
  function buildGraph(chapters){
    const claims=[],evidence=[],sources=[],edges=[],seenEvidence=new Set(),seenSource=new Set();let emptySections=0;
    for(const [ci,c] of (chapters||[]).entries())if(c.checked!==false)for(const [si,s] of (c.sections||[]).entries()){
      const refs=regRefs(s.prov),sentences=regClaimSentences(s.editedHtml||s.content||'');if(!sentences.length)emptySections++;
      const nodes=refs.map(ref=>({...ref,id:'evidence:'+regHash(ref)}));
      for(const node of nodes){
        if(!seenEvidence.has(node.id)){seenEvidence.add(node.id);evidence.push(node);}
        const sid='source:'+regHash({type:node.type,url:node.url,ref:node.ref,title:node.title,version:node.version});
        if(!seenSource.has(sid)){seenSource.add(sid);sources.push({id:sid,type:node.type,title:node.title,url:node.url,ref:node.ref,version:node.version});}
        edges.push({from:node.id,to:sid,kind:'derived_from'});
      }
      for(const [i,text] of sentences.entries()){
        const id='claim:'+ci+':'+c.cn+':'+si+':'+i;
        // Exact textual location only: not legal validity, applicability or truth.
        const located=nodes.filter(n=>n.excerpt&&n.excerpt.includes(text)&&text.length>=8&&(n.url||n.ref)&&n.version!==null&&String(n.version).trim()&&!['expired','revoked','superseded','draft','candidate','pending'].includes(n.lifecycle));
        const claim={id,cn:c.cn,si,chapter:c.name,title:s.t,text,numeric:regNumeric(text),strong:/可行|应当|必须|建议|风险|满足|具备|结论|预计|显著/.test(text),syncStatus:s.syncStatus||'current',missing:/[【\[]\s*(?:待补|待确认)|待填|待核|暂无数据|尚未提供/.test(text),evidenceIds:located.map(n=>n.id),candidateEvidenceIds:nodes.map(n=>n.id),verification:'not_independently_verified'};
        claims.push(claim);for(const node of nodes)edges.push({from:id,to:node.id,kind:located.includes(node)?'located_in':'candidate_context'});
      }
    }
    return {schemaVersion:2,claims,evidence,sources,edges,emptySections,hash:regHash({claims,evidence,sources,edges})};
  }
  function preSubmitAudit(chapters){
    const graph=buildGraph(chapters),issues=[];
    if(!graph.claims.length||graph.emptySections)issues.push({severity:'blocker',code:'EMPTY_REPORT_SECTION',message:'正文为空或有未生成小节，不能视为核查通过'});
    for(const claim of graph.claims){
      if(['stale','locked-stale'].includes(claim.syncStatus))issues.push({severity:'blocker',code:'STALE_CLAIM',...claim,message:'正文仍绑定旧参数或旧证据版本'});
      if(claim.numeric&&!claim.evidenceIds.length)issues.push({severity:'blocker',code:'NUMERIC_WITHOUT_EVIDENCE',...claim,message:claim.candidateEvidenceIds.length?'已保存候选来源，但该数字表述尚未逐句定位；改写不代表错误，请对照原文和测算版本人工核验。检索命中或测算标记不能代替核对':'数字尚未逐句定位到带版本的原始依据；请补充来源或对照测算版本核验'});
      else if(claim.strong&&!claim.evidenceIds.length)issues.push({severity:'warning',code:'JUDGEMENT_WITHOUT_EVIDENCE',...claim,message:'关键判断待复核：查看原始材料，核对事实、适用条件及论证'});
      if(claim.missing)issues.push({severity:'blocker',code:'UNRESOLVED_PLACEHOLDER',...claim,message:'仍含待补、待核或暂无数据标记'});
    }
    const blockers=issues.filter(x=>x.severity==='blocker'),warnings=issues.filter(x=>x.severity==='warning');
    return {schemaVersion:2,ready:!!graph.claims.length&&!blockers.length,independentReviewRequired:true,graph,issues,blockerCount:blockers.length,warningCount:warnings.length,claimCoverage:graph.claims.length?Math.round(graph.claims.filter(x=>x.evidenceIds.length).length/graph.claims.length*100):0,candidateCoverage:graph.claims.length?Math.round(graph.claims.filter(x=>x.candidateEvidenceIds.length).length/graph.claims.length*100):0};
  }
  function detailsHtml(graph){
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const sources=(graph.evidence||[]).map((n,i)=>'<li id="report-evidence-'+i+'"><b>'+esc(n.title)+'</b> · '+esc(n.type)+' · 版本：'+esc(n.version||'未记录')+' · 状态：'+esc(n.lifecycle||'未确认')+'<div>定位：'+esc(n.ref||'未记录')+(/^https?:\/\//i.test(n.url)?' · <a target="_blank" rel="noopener noreferrer" href="'+esc(n.url)+'">打开原始来源</a>':'')+'</div><blockquote style="white-space:pre-wrap;margin:8px 0;">'+esc(n.excerpt||'没有保存原文片段，仅有来源线索，不能认定已核验。')+'</blockquote></li>').join('');
    const claims=(graph.claims||[]).map(c=>'<details style="padding:8px 0;border-bottom:1px solid #dde6ef;"><summary>'+esc(c.chapter+' / '+c.title+'：'+c.text.slice(0,100))+'</summary><p style="white-space:pre-wrap;">'+esc(c.text)+'</p><div>原文定位：'+(c.evidenceIds.length?'已定位（仍需人工确认适用性）':'尚未逐句定位')+'；候选来源不是核验结果。</div><ul>'+c.candidateEvidenceIds.map(id=>{const i=(graph.evidence||[]).findIndex(x=>x.id===id);return i<0?'':'<li><button type="button" data-report-evidence-target="report-evidence-'+i+'">'+esc(graph.evidence[i].title)+'</button> · '+(c.evidenceIds.includes(id)?'原文匹配':'上下文候选')+'</li>';}).join('')+'</ul></details>').join('');
    return '<details style="margin-top:12px;"><summary>逐句查看依据（'+(graph.claims||[]).length+' 条正文 / '+(graph.evidence||[]).length+' 条来源）</summary><p>只读核对，不会修改正文或自动发布资料。原文匹配不等于真实性、政策效力或适用性已经通过。</p><div style="max-height:420px;overflow:auto;">'+claims+'<h4>本次生成实际引用的来源片段</h4><ol>'+sources+'</ol></div></details>';
  }
  function bindDetails(container){if(!container||container.dataset?.reportEvidenceBound==='1')return;if(container.dataset)container.dataset.reportEvidenceBound='1';container.addEventListener('click',event=>{const button=event.target.closest?.('[data-report-evidence-target]');if(!button||!container.contains(button))return;const id=button.dataset.reportEvidenceTarget;if(!/^report-evidence-\d+$/.test(id||''))return;const target=container.querySelector('[id="'+id+'"]');if(target){event.preventDefault();target.scrollIntoView({block:'nearest'});target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}});}
  const api={hash:regHash,text:regText,refs:regRefs,buildGraph,preSubmitAudit,detailsHtml,bindDetails};root.ReportEvidenceGraph=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
