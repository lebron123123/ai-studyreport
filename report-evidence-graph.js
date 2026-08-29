/* AI可研 Claim—Evidence—Source 证据图与签发前审计。 */
(function(root){
  "use strict";
  function regHash(value){const s=JSON.stringify(value==null?null:value);let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,"0");}
  function regText(s){return String(s==null?"":s).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();}
  function regRefs(prov){
    prov=prov||{};const out=[];
    [["rag",prov.rag],["knowledge",prov.kbDocs],["excel",prov.excelSources],["web",prov.webEvidence||prov.web],["project",prov.projectFields]].forEach(([type,rows])=>(rows||[]).forEach((x,i)=>out.push({id:String(x.id||x.evidenceId||x.sourceRef||x.label||type+":"+i),type,title:String(x.title||x.label||x.name||x.sourceRef||type),url:String(x.url||""),authority:String(x.authorityLevel||x.authority||""),version:x.version||null,ref:x.sourceRef||x.address||""})));
    if(prov.hasCalcData)out.push({id:"whitebox-calc",type:"calculation",title:"当前白箱测算快照",url:"",authority:"A",version:prov.calcVersion||null,ref:""});
    return out;
  }
  function regClaimSentences(text){return regText(text).split(/(?<=[。！？；])/).map(x=>x.trim()).filter(x=>x.length>=8).slice(0,40);}
  function buildGraph(chapters){
    const claims=[],evidence=[],sources=[],edges=[],seenEvidence=new Set(),seenSource=new Set();
    (chapters||[]).forEach(c=>(c.sections||[]).forEach((s,si)=>{const refs=regRefs(s.prov),sentences=regClaimSentences(s.editedHtml||s.content||"");refs.forEach(ref=>{const eid="evidence:"+regHash(ref);if(!seenEvidence.has(eid)){seenEvidence.add(eid);evidence.push({id:eid,...ref});}const sid="source:"+regHash({type:ref.type,url:ref.url,ref:ref.ref,title:ref.title});if(!seenSource.has(sid)){seenSource.add(sid);sources.push({id:sid,type:ref.type,title:ref.title,url:ref.url,ref:ref.ref,version:ref.version});}edges.push({from:eid,to:sid,kind:"derived_from"});});sentences.forEach((text,i)=>{const id="claim:"+c.cn+":"+si+":"+i,numeric=/\d/.test(text),strong=/可行|应当|必须|建议|风险|满足|具备|结论|预计|显著/.test(text);claims.push({id,cn:c.cn,si,chapter:c.name,title:s.t,text,numeric,strong,syncStatus:s.syncStatus||"current",missing:/【待补[:：]|待填|待核|暂无数据|尚未提供/.test(text),evidenceIds:refs.map(ref=>"evidence:"+regHash(ref))});refs.forEach(ref=>edges.push({from:id,to:"evidence:"+regHash(ref),kind:"supported_by"}));});}));
    return {schemaVersion:1,claims,evidence,sources,edges,hash:regHash({claims,evidence,sources,edges})};
  }
  function preSubmitAudit(chapters,opts){
    opts=opts||{};const graph=buildGraph(chapters),issues=[];
    graph.claims.forEach(claim=>{
      if(claim.syncStatus==="stale"||claim.syncStatus==="locked-stale")issues.push({severity:"blocker",code:"STALE_CLAIM",...claim,message:"正文仍绑定旧参数或旧证据版本"});
      if(claim.numeric&&!claim.evidenceIds.length)issues.push({severity:"blocker",code:"NUMERIC_WITHOUT_EVIDENCE",...claim,message:"数字性结论未绑定测算、材料或数据来源"});
      else if(claim.strong&&!claim.evidenceIds.length)issues.push({severity:"warning",code:"JUDGEMENT_WITHOUT_EVIDENCE",...claim,message:"关键判断缺少可追溯依据"});
      if(claim.missing)issues.push({severity:"warning",code:"UNRESOLVED_PLACEHOLDER",...claim,message:"仍含待补、待核或暂无数据标记"});
    });
    const duplicate=new Set();graph.sources.forEach(s=>{const k=(s.url||"")+"|"+(s.ref||"");if(k!=="|"&&duplicate.has(k))issues.push({severity:"info",code:"DUPLICATE_SOURCE",message:"同一来源被重复登记："+s.title});duplicate.add(k);});
    const blockers=issues.filter(x=>x.severity==="blocker"),warnings=issues.filter(x=>x.severity==="warning");
    return {schemaVersion:1,ready:blockers.length===0,graph,issues,blockerCount:blockers.length,warningCount:warnings.length,claimCoverage:graph.claims.length?Math.round(graph.claims.filter(x=>x.evidenceIds.length).length/graph.claims.length*100):0};
  }
  const api={hash:regHash,text:regText,refs:regRefs,buildGraph,preSubmitAudit};root.ReportEvidenceGraph=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
