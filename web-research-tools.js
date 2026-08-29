/* 前端联网研究工具：证据候选需人工采用后，才进入可研材料状态和生成提示词。 */
(function webResearchToolsModule(global){
  "use strict";
  const state={projectId:"",evidence:[],loaded:false,busy:false,batchBusy:false,batchJob:null,batchRender:null};
  const BATCH_STORAGE_KEY="studyreport:webresearch:batch:v1";
  const esc=value=>String(value==null?"":value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function projectContext(extra){
    const p=global.project||{},workflow=global.projectWorkflow||{};
    return Object.assign({projectId:String(workflow.projectId||p.id||p.name||"current-project").slice(0,120),projectName:p.name||"",location:p.location||"",projectType:global.calcType||(global.calcResult&&global.calcResult.__ctype)||global.rptCtype||"rent"},extra||{});
  }
  async function api(body){
    const response=await fetch("/api/webresearch",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},typeof global.authHeaders==="function"?global.authHeaders():{}),body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"联网研究失败");return data;
  }
  async function loadEvidence(force){
    const ctx=projectContext();if(!force&&state.loaded&&state.projectId===ctx.projectId)return state.evidence;
    const data=await api({action:"listEvidence",projectId:ctx.projectId});state.projectId=ctx.projectId;state.evidence=data.evidence||[];state.loaded=true;return state.evidence;
  }
  function approved(){return state.evidence.filter(x=>x.status==="approved");}
  function evidenceByRule(){
    const out={};for(const row of approved()){const ids=Array.isArray(row.logicIds)&&row.logicIds.length?row.logicIds:[row.logic_id];for(const id of ids){if(!id)continue;if(!out[id])out[id]=[];out[id].push({kind:"web_search",title:row.title,url:row.url,authorityLevel:row.authority_level,confidence:row.confidence,source:"web_evidence"});}}return out;
  }
  function materialContext(){const current=projectContext().projectId;if(state.projectId!==current){loadEvidence(true).then(()=>{if(typeof global.airApplyDocMaterialStatuses==="function")global.airApplyDocMaterialStatuses();}).catch(()=>{});return {hasWebEvidence:false,evidenceByRule:{},webEvidence:[]};}const rows=approved();return {hasWebEvidence:rows.length>0,evidenceByRule:evidenceByRule(),webEvidence:rows};}
  function sectionRows(chapter,section){return approved().filter(x=>(!chapter||x.chapter===chapter)&&(!section||x.section===section));}
  function contextForSection(chapter,section,collector){
    const rows=sectionRows(chapter,section).slice(0,8);if(!rows.length)return "";
    if(collector)collector.webEvidence=rows.map(x=>({id:x.id,title:x.title,url:x.url,publisher:x.publisher,authority:x.authority_level,confidence:x.confidence,verification:x.verification_status,fetchedAt:x.fetched_at||""}));
    return "\n\n【已人工采用的联网证据】\n仅使用下列证据支持可核验事实；不得把网页摘要扩写成未出现的数字。正文涉及事实时注明来源机构和统计期；不同来源冲突时说明差异。\n"+rows.map((x,i)=>(i+1)+". "+x.title+"｜"+(x.publisher||"来源机构待识别")+"｜权威度"+(x.authority_level||"D")+"｜"+(x.published_at||"未标明发布日期")+"\n网址："+x.url+"\n摘要："+String(x.content_text||x.excerpt||"").slice(0,900)).join("\n\n");
  }
  function injectStyle(){
    if(document.getElementById("wrStyle"))return;const style=document.createElement("style");style.id="wrStyle";style.textContent='.wr-overlay{position:fixed;inset:0;background:rgba(20,45,70,.32);z-index:10020;display:grid;place-items:center;padding:24px}.wr-modal{width:min(980px,95vw);max-height:88vh;overflow:auto;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(20,50,80,.28);padding:20px}.wr-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:1px solid #dce6ef;padding-bottom:12px}.wr-head h3{margin:0;color:#164c78}.wr-close{border:0;background:transparent;font-size:24px;cursor:pointer}.wr-result{border:1px solid #d9e5ef;border-radius:9px;padding:12px 14px;margin-top:10px}.wr-result.approved{background:#eef8f2;border-color:#9ed0b1}.wr-meta{font-size:11px;color:#687f93;margin:5px 0}.wr-actions{display:flex;gap:7px;margin-top:9px;flex-wrap:wrap}.wr-pill{font-size:10px;border-radius:10px;padding:2px 7px;background:#eaf3fb;color:#236797}.air-web-search{border:1px solid #4a91c8;background:#eef7fd;color:#17649b;border-radius:14px;padding:3px 8px;cursor:pointer;font-size:10.5px}.wr-batch-modal{width:min(1120px,96vw);padding-bottom:74px;position:relative}.wr-batch-progress{margin:14px 0;padding:12px;background:#f4f8fc;border-radius:9px;display:grid;grid-template-columns:1fr auto;gap:8px}.wr-batch-progress>div{grid-column:1/-1;height:7px;background:#dce8f2;border-radius:9px;overflow:hidden}.wr-batch-progress i{display:block;height:100%;background:#2d7eb8;transition:width .25s}.wr-batch-summary{padding:10px 12px;border-left:3px solid #2d7eb8;background:#f8fbfd}.wr-batch-group{border:1px solid #d9e5ef;border-radius:9px;margin-top:10px}.wr-batch-group>summary{cursor:pointer;padding:11px 13px;display:flex;justify-content:space-between;gap:12px}.wr-batch-need{padding:8px 13px;background:#f7f9fb;color:#687f93;font-size:11px}.wr-batch-result{display:grid;grid-template-columns:22px 1fr;gap:8px;cursor:pointer;margin:9px 12px}.wr-batch-result>span{display:grid;gap:4px}.wr-batch-result a{width:max-content;color:#17649b}.wr-batch-empty{padding:16px;color:#9b3d37}.wr-batch-footer{position:sticky;bottom:-20px;margin:18px -20px -74px;padding:13px 20px;background:#fff;border-top:1px solid #d9e5ef;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.wr-batch-selected{margin-left:auto;color:#47677f}.wr-live-ledger{display:grid;grid-template-columns:minmax(440px,1.08fr) minmax(330px,.92fr);gap:12px;margin-top:12px;min-height:285px}.wr-ledger-pane,.wr-detail-pane{border:1px solid #d9e5ef;border-radius:9px;overflow:hidden;background:#fff}.wr-pane-title{padding:9px 12px;background:#eef5fa;color:#174f78;font-weight:700;border-bottom:1px solid #d9e5ef}.wr-ledger-scroll{max-height:330px;overflow:auto}.wr-ledger-table{width:100%;border-collapse:collapse;font-size:11px}.wr-ledger-table th{position:sticky;top:0;background:#f7f9fb;color:#567086;text-align:left;padding:7px 8px;border-bottom:1px solid #d9e5ef}.wr-ledger-table td{padding:7px 8px;border-bottom:1px solid #e4ebf1;vertical-align:top}.wr-ledger-row{cursor:pointer}.wr-ledger-row:hover,.wr-ledger-row.active{background:#edf6fd}.wr-ledger-status{white-space:nowrap;font-weight:600}.wr-ledger-status.done{color:#278356}.wr-ledger-status.running{color:#2375ad}.wr-ledger-status.waiting{color:#7a8d9c}.wr-ledger-status.empty{color:#a45f28}.wr-detail-body{max-height:330px;overflow:auto;padding:12px}.wr-detail-query{padding:9px;background:#f7f9fb;border-radius:7px;margin-bottom:9px;white-space:pre-wrap}.wr-detail-source{border-top:1px solid #e2eaf0;padding:9px 0}.wr-detail-source:first-of-type{border-top:0}.wr-detail-source a{color:#17649b}.wr-detail-source p{margin:5px 0;color:#4e6679;line-height:1.55}@media(max-width:820px){.wr-live-ledger{grid-template-columns:1fr}.wr-ledger-pane,.wr-detail-pane{min-height:230px}}';document.head.appendChild(style);
  }
  async function setStatus(id,status,logicIds,options){logicIds=Array.isArray(logicIds)?logicIds:[logicIds].filter(Boolean);await api({action:"setEvidenceStatus",id,status,logicIds});if(!(options&&options.skipReload))await loadEvidence(true);}
  function classifyWebEvidence(row,target){
    const text=[row&&row.title,target&&target.chapter,target&&target.section,target&&target.requirement].filter(Boolean).join(" ");
    if(/国土空间|专项规划|发展规划|建设规划|规划文件|规划纲要/.test(text))return {wikiKind:"policy",webCategory:"规划文件"};
    if(/政策|办法|规定|条例|通知|公告|实施细则|指导意见/.test(text))return {wikiKind:"policy",webCategory:"政策制度"};
    if(/统计|人口|普查|年鉴|常住人口|就业人口/.test(text))return {wikiKind:"report",webCategory:"统计数据"};
    if(/租金|售价|房价|市场|成交|供需|库存|去化|竞品/.test(text))return {wikiKind:"report",webCategory:"市场数据"};
    if(/项目|宗地|地块|招标|环评|施工|竣工|批复/.test(text))return {wikiKind:"case",webCategory:"项目资料"};
    return {wikiKind:"report",webCategory:"研究资料"};
  }
  function knowledgeContributionItem(row,target){
    const ctx=projectContext(),title=String(row.title||"联网检索依据").trim(),authority=row.authorityLevel||row.authority_level||"D",published=row.publishedAt||row.published_at||"未标明",publisher=row.publisher||"来源机构待识别",text=String(row.contentText||row.content_text||row.snippet||row.excerpt||"暂无摘要").trim(),classification=classifyWebEvidence(row,target||{}),bindings=Array.isArray(target&&target.bindings)?target.bindings:[];
    const chapterText=bindings.length?bindings.map(x=>String(x.chapter||"")+"｜"+String(x.section||"")).filter(Boolean).join("；"):String(target&&target.chapter||"")+"｜"+String(target&&target.section||"");
    const logicIds=[...(target&&Array.isArray(target.logicIds)?target.logicIds:[]),...bindings.flatMap(x=>Array.isArray(x.logicIds)?x.logicIds:[])].filter((x,i,a)=>x&&a.indexOf(x)===i);
    return {kind:"wiki",title:("联网依据｜"+title).slice(0,120),content:["【联网检索待审核材料】","业务分类："+classification.webCategory,"对应章节："+chapterText,"发布/来源机构："+publisher,"发布日期/统计期："+published,"权威等级："+authority,"交叉核验："+(row.verificationStatus||row.verification_status||"single"),"原始网址："+String(row.url||""),"","【网页正文或检索摘要】",text].join("\n").slice(0,180000),source_ref:String(row.url||"").slice(0,500),region:String(ctx.location||"").slice(0,40),project_type:String(ctx.projectType||"").slice(0,40),meta:{wikiKind:classification.wikiKind,category:classification.webCategory,webCategory:classification.webCategory,sourceChannel:"web_research",tags:[classification.webCategory,"联网检索","可研依据",String(target&&target.chapter||""),String(target&&target.section||"")].filter(Boolean),issuer:publisher,authorityLevel:authority,publishedAt:published,webEvidenceId:row.evidenceId||row.id||"",reportBindings:bindings.length?bindings:[{chapter:target&&target.chapter||"",section:target&&target.section||"",logicIds}],logicIds,idempotencyKey:"web:"+String(row.evidenceId||row.id||row.url||"").slice(0,110)}};
  }
  async function submitKnowledgeReview(row,target,options){
    options=options||{};
    let enriched=row;
    if(options.fetchFullText!==false&&!row.contentText&&!row.content_text&&row.url){try{const fetched=await api({action:"fetch",url:row.url,evidenceId:row.evidenceId||row.id}),text=fetched.document&&fetched.document.text;if(text)enriched={...row,contentText:text};}catch(e){}}
    const response=await fetch("/api/contributions",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},typeof global.authHeaders==="function"?global.authHeaders():{}),body:JSON.stringify({action:"submit",item:knowledgeContributionItem(enriched,target)})});
    const data=await response.json().catch(()=>({ok:false,error:"知识库审核提交返回格式异常"}));if(!response.ok||!data.ok)throw new Error(data.error||"提交知识库审核失败");return data;
  }
  function highValueEntries(job,levels){
    const wanted=new Set(levels||["A","B"]),byUrl=new Map();
    (job&&job.outputs||[]).forEach((output,index)=>(output&&output.results||[]).forEach(row=>{const authority=row.authorityLevel||row.authority_level||"D",url=String(row.url||"").trim();if(!wanted.has(authority)||!url)return;const target=(output&&output.target)||job.targets[index]||{};if(!byUrl.has(url))byUrl.set(url,{row,target:{...target,bindings:[]},occurrences:[]});const entry=byUrl.get(url),binding={chapter:target.chapter||"",section:target.section||"",logicIds:target.logicIds||[]};entry.occurrences.push({row,target,index});entry.target.bindings.push(binding);}));
    return [...byUrl.values()];
  }
  async function depositHighValue(job,levels,options){
    options=options||{};const entries=highValueEntries(job,levels),results=await runLimited(entries,Math.min(4,Number(options.concurrency)||3),async entry=>{try{const data=await submitKnowledgeReview(entry.row,entry.target,{fetchFullText:options.fetchFullText===true}),pipelineStatus=data.status||"pending";entry.occurrences.forEach(x=>{x.row.knowledgeDeposit={status:data.existing?"existing":"submitted",pipelineStatus,targetModule:data.target_module||"",targetRef:data.target_ref||"",id:data.id||"",auto:!!options.auto,at:Date.now()};});return {ok:true,existing:!!data.existing,status:pipelineStatus};}catch(error){entry.occurrences.forEach(x=>{x.row.knowledgeDeposit={status:"failed",error:error.message||String(error),auto:!!options.auto,at:Date.now()};});return {ok:false,error:error.message||String(error)};}});if(options.persist!==false)persistBatchJob(job);return {total:entries.length,submitted:results.filter(x=>x&&x.ok&&!x.existing).length,existing:results.filter(x=>x&&x.ok&&x.existing).length,pending:results.filter(x=>x&&x.ok&&x.status==="pending").length,approved:results.filter(x=>x&&x.ok&&x.status==="approved").length,failed:results.filter(x=>x&&!x.ok).length};
  }
  function base64Buffer(value){const binary=atob(value||""),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes.buffer;}
  async function extractFullText(row,button){
    button.disabled=true;const old=button.textContent;button.textContent="正在提取全文…";
    try{
      const data=await api({action:"fetch",url:row.url,evidenceId:row.evidenceId}),doc=data.document||{};let text=doc.text||"";
      if(!text&&doc.dataBase64){const buffer=base64Buffer(doc.dataBase64),type=String(doc.contentType||"");
        if(type.includes("pdf")||/\.pdf(?:$|\?)/i.test(row.url)){if(!global.pdfjsLib)await global.loadScript("pdf.min.js");global.pdfjsLib.GlobalWorkerOptions.workerSrc="pdf.worker.min.js";const pdf=await global.pdfjsLib.getDocument({data:buffer}).promise,parts=[];for(let i=1;i<=pdf.numPages;i++){const content=await (await pdf.getPage(i)).getTextContent();parts.push("[第"+i+"页]\n"+content.items.map(x=>x.str).join(" "));}text=parts.join("\n");}
        else if(type.includes("wordprocessingml")||/\.docx(?:$|\?)/i.test(row.url)){if(!global.mammoth)await global.loadScript("mammoth.min.js");text=(await global.mammoth.extractRawText({arrayBuffer:buffer})).value||"";}
      }
      if(text&&text.length>=20)await api({action:"updateEvidenceContent",evidenceId:row.evidenceId,text});else throw new Error("该文件暂未提取到可用文字，扫描版 PDF 可改为上传后 OCR");
      button.textContent="✓ 全文已入台账（"+text.length+"字）";await loadEvidence(true);
    }catch(e){button.disabled=false;button.textContent="提取失败："+e.message;setTimeout(()=>{button.textContent=old;},3500);}
  }
  function resultModal(data,ctx,callback){
    injectStyle();document.getElementById("wrEvidenceModal")?.remove();const overlay=document.createElement("div");overlay.id="wrEvidenceModal";overlay.className="wr-overlay";
    const rows=data.results||[];overlay.innerHTML='<section class="wr-modal"><div class="wr-head"><div><h3>联网证据候选</h3><div class="wr-meta">已执行 '+(data.plan&&data.plan.queries?data.plan.queries.length:1)+' 组保障房垂直查询；只有点击“采用为本节依据”的来源才进入正式生成。</div></div><button class="wr-close">×</button></div>'+(data.errors&&data.errors.length?'<div class="wr-meta" style="color:#a36813;margin-top:9px;">部分通道不可用：'+esc(data.errors.map(x=>x.provider+" "+x.error).join("；"))+'</div>':'')+(rows.length?rows.map(row=>'<article class="wr-result" data-id="'+esc(row.evidenceId)+'"><b>'+esc(row.title)+'</b><div class="wr-meta"><span class="wr-pill">权威度 '+esc(row.authorityLevel)+'</span> <span class="wr-pill">置信 '+esc(row.confidence)+'</span> '+esc(row.publisher||"")+' '+esc(row.publishedAt||"")+'</div><div>'+esc(row.snippet||"暂无摘要")+'</div><div class="wr-actions"><a class="btn sm ghost" href="'+esc(row.url)+'" target="_blank" rel="noopener">打开原网页</a><button class="btn sm ghost wr-fetch" data-id="'+esc(row.evidenceId)+'">获取网页/PDF/Word全文</button><button class="btn sm wr-approve" data-id="'+esc(row.evidenceId)+'">采用为本节依据</button></div></article>').join(""):'<div style="padding:28px 0;color:#9b3d37;">当前 Provider 未返回真实候选。系统不会伪造结果；可在后台“联网检索治理”查看通道状态或配置搜索 API。</div>')+'</section>';
    document.body.appendChild(overlay);const close=()=>overlay.remove();overlay.querySelector(".wr-close").onclick=close;overlay.onclick=e=>{if(e.target===overlay)close();};
    overlay.querySelectorAll(".wr-approve").forEach(button=>button.onclick=async()=>{button.disabled=true;button.textContent="正在采用…";try{await setStatus(button.dataset.id,"approved",ctx.logicIds&&ctx.logicIds.length?ctx.logicIds:[ctx.logicId].filter(Boolean));button.closest(".wr-result").classList.add("approved");button.textContent="✓ 已采用";if(callback)callback();}catch(e){button.disabled=false;button.textContent="采用失败："+e.message;}});
    overlay.querySelectorAll(".wr-fetch").forEach(button=>button.onclick=()=>extractFullText(rows.find(x=>x.evidenceId===button.dataset.id)||{},button));
  }
  async function searchSection(options){
    options=options||{};if(state.busy)throw new Error("已有联网检索正在进行");state.busy=true;try{
      const ctx=projectContext(options),data=await api(Object.assign({},ctx,{action:"searchSection",maxQueries:options.maxQueries||3,maxResults:options.maxResults||20,logicId:options.logicId||"",logicIds:options.logicIds||[],requiredSources:options.requiredSources||""}));
      await loadEvidence(true);if(options.review!==false)resultModal(data,ctx,options.onAdopt);return data;
    }finally{state.busy=false;}
  }
  async function searchFromButton(button,onAdopt){
    const logicIds=String(button.dataset.ruleId||"").split(",").filter(Boolean),logicId=logicIds[0]||"";
    button.disabled=true;const old=button.textContent;button.textContent="正在检索…";
    try{return await searchSection({logicId,logicIds,chapter:button.dataset.chapter||"",section:button.dataset.section||"",requiredSources:button.dataset.requiredSources||"",onAdopt});}
    finally{button.disabled=false;button.textContent=old;}
  }
  function buildBatchTargets(items){
    const groups=new Map();
    for(const item of (Array.isArray(items)?items:[])){
      if(!Array.isArray(item.missing)||!item.missing.includes("web_search"))continue;
      const chapter=String(item.chapter||"").trim(),section=String(item.section||item.title||"").trim(),key=chapter+"\u0000"+section;
      if(!groups.has(key))groups.set(key,{chapter,section,logicIds:[],requiredSources:[],sourceNos:[],titles:[]});
      const group=groups.get(key);
      if(item.ruleId&&!group.logicIds.includes(item.ruleId))group.logicIds.push(item.ruleId);
      const need=String(item.requiredSources||"").trim();if(need&&!group.requiredSources.includes(need))group.requiredSources.push(need);
      if(item.sourceNo!=null&&!group.sourceNos.includes(item.sourceNo))group.sourceNos.push(item.sourceNo);
      const title=String(item.title||"").trim();if(title&&!group.titles.includes(title))group.titles.push(title);
    }
    return [...groups.values()].map((group,index)=>({...group,index,requirement:group.requiredSources.join("；").slice(0,900)}));
  }
  function batchSearchQuery(target){
    const ctx=projectContext(),parts=[ctx.location,ctx.projectName,target.chapter,target.section,target.requirement,"政府官网 统计部门 原始发布页"].filter(Boolean);
    return parts.join(" ").replace(/\s+/g," ").slice(0,220);
  }
  async function runLimited(list,limit,worker,onProgress){
    let cursor=0,done=0;const output=new Array(list.length),count=Math.max(1,Math.min(Number(limit)||2,4));
    await Promise.all(Array.from({length:Math.min(count,list.length)},async()=>{while(cursor<list.length){const index=cursor++,item=list[index];try{output[index]=await worker(item,index);}catch(error){output[index]={target:item,error:error.message||String(error),results:[]};}done++;if(onProgress)onProgress(done,list.length,output[index]);}}));
    return output;
  }
  function batchSignature(targets){return targets.map(target=>[target.chapter,target.section,...target.logicIds].join("|")).join("\n");}
  function batchStatus(){
    const job=state.batchJob;if(!job||job.projectId!==projectContext().projectId)return null;
    return {id:job.id,status:job.status,done:job.done,total:job.targets.length,continued:!!job.continued,startedAt:job.startedAt,updatedAt:job.updatedAt};
  }
  function persistBatchJob(job){
    try{localStorage.setItem(BATCH_STORAGE_KEY,JSON.stringify({id:job.id,projectId:job.projectId,status:job.status,targets:job.targets,outputs:job.outputs,nextIndex:job.nextIndex,done:job.done,continued:!!job.continued,signature:job.signature,concurrency:job.concurrency,maxResults:job.maxResults,startedAt:job.startedAt,updatedAt:Date.now()}));}catch(e){}
  }
  function restoreBatchJob(){
    if(state.batchJob)return state.batchJob;let saved=null;try{saved=JSON.parse(localStorage.getItem(BATCH_STORAGE_KEY)||"null");}catch(e){}
    if(!saved||saved.projectId!==projectContext().projectId||!Array.isArray(saved.targets))return null;
    saved.outputs=Array.isArray(saved.outputs)?saved.outputs:new Array(saved.targets.length);saved.done=saved.outputs.filter(Boolean).length;saved.maxResults=Math.max(Number(saved.maxResults)||0,10);const firstMissing=saved.outputs.findIndex(output=>!output);saved.nextIndex=firstMissing<0?saved.targets.length:firstMissing;saved.runtime={};saved.runPromise=null;state.batchJob=saved;return saved;
  }
  function notifyBatch(job){
    job.updatedAt=Date.now();persistBatchJob(job);if(state.batchRender)state.batchRender();
    if(job.runtime&&typeof job.runtime.onProgress==="function")job.runtime.onProgress(batchStatus());
  }
  async function searchBatchTarget(job,target){
    const ctx=projectContext({logicId:target.logicIds[0]||"",logicIds:target.logicIds,chapter:target.chapter,section:target.section,requiredSources:target.requirement,query:batchSearchQuery(target)});
    const data=await api(Object.assign({},ctx,{action:"searchSection",maxQueries:1,maxResults:job.maxResults}));
    return {target,results:data.results||[],errors:data.errors||[],provider:data.provider||""};
  }
  function startBatchJob(job){
    if(job.runPromise||job.status!=="running"||job.done>=job.targets.length)return job.runPromise;
    state.batchBusy=true;const worker=async()=>{while(job.status==="running"){
      const index=job.nextIndex++;if(index>=job.targets.length)break;persistBatchJob(job);
      try{job.outputs[index]=await searchBatchTarget(job,job.targets[index]);try{await depositHighValue({outputs:[job.outputs[index]],targets:[job.targets[index]]},["A"],{auto:true,fetchFullText:false,concurrency:3,persist:false});}catch(depositError){}}catch(error){job.outputs[index]={target:job.targets[index],error:error.message||String(error),results:[]};}
      job.done=job.outputs.filter(Boolean).length;notifyBatch(job);
    }};
    job.runPromise=Promise.all(Array.from({length:Math.min(job.concurrency,Math.max(1,job.targets.length-job.nextIndex))},worker)).then(async()=>{
      if(job.done>=job.targets.length){job.status="completed";job.nextIndex=job.targets.length;try{await loadEvidence(true);}catch(e){}}
      notifyBatch(job);return job;
    }).finally(()=>{job.runPromise=null;state.batchBusy=false;if(job.status==="running"&&job.done<job.targets.length)startBatchJob(job);});
    return job.runPromise;
  }
  function pauseBatchSearch(){const job=restoreBatchJob();if(!job||job.status!=="running")return batchStatus();job.status="paused";notifyBatch(job);return batchStatus();}
  function resumeBatchSearch(){const job=restoreBatchJob();if(!job||job.status==="completed")return batchStatus();job.status="running";notifyBatch(job);startBatchJob(job);return batchStatus();}
  function continueFromBatch(job,info){if(job.continued)return;job.continued=true;notifyBatch(job);if(job.runtime&&typeof job.runtime.onContinue==="function")job.runtime.onContinue(info||{background:true});}
  function openBatchReview(job){
    injectStyle();document.getElementById("wrBatchEvidenceModal")?.remove();const overlay=document.createElement("div");overlay.id="wrBatchEvidenceModal";overlay.className="wr-overlay";document.body.appendChild(overlay);
    if(!job.autoDepositBackfillStarted){job.autoDepositBackfillStarted=true;depositHighValue(job,["A"],{auto:true,fetchFullText:false,concurrency:3}).then(()=>notifyBatch(job)).catch(()=>{});}
    const close=()=>{if(state.batchRender===render)state.batchRender=null;overlay.remove();};
    const render=()=>{
      if(!overlay.isConnected)return;const total=job.targets.length,pct=total?Math.round(job.done/total*100):100,complete=job.status==="completed",paused=job.status==="paused",outputs=job.outputs.filter(Boolean),allRows=[];
      let success=0;outputs.forEach(output=>{if(output.results&&output.results.length)success++;(output.results||[]).forEach(row=>allRows.push({...row,batchTarget:output.target}));});
      if(!Number.isInteger(job.viewIndex)||job.viewIndex<0||job.viewIndex>=total)job.viewIndex=Math.min(job.done,total-1);
      const viewIndex=Math.max(0,job.viewIndex),viewTarget=job.targets[viewIndex]||{},viewOutput=job.outputs[viewIndex],viewRows=viewOutput&&viewOutput.results||[];
      const taskStatus=index=>job.outputs[index]?(job.outputs[index].results&&job.outputs[index].results.length?{text:"已返回 "+job.outputs[index].results.length+" 条",cls:"done"}:{text:"暂无结果",cls:"empty"}):(index<job.nextIndex?{text:paused?"请求收尾中":"正在检索",cls:"running"}:{text:paused?"已暂停":"等待中",cls:"waiting"});
      const ledgerRows=job.targets.map((target,index)=>{const status=taskStatus(index);return '<tr class="wr-ledger-row '+(index===viewIndex?'active':'')+'" data-index="'+index+'"><td>'+(index+1)+'</td><td><b>'+esc(target.chapter)+'</b><br>'+esc(target.section)+'</td><td>'+esc(target.requirement||target.titles.join("；")||"公开依据")+'</td><td><span class="wr-ledger-status '+status.cls+'">'+status.text+'</span></td></tr>';}).join("");
      const detailSources=viewRows.length?viewRows.map((row,index)=>{const dep=row.knowledgeDeposit||{},depText=dep.status==="submitted"?" · ✓ 已自动存入待审台账":dep.status==="existing"?" · ✓ 后台已有":dep.status==="failed"?" · 自动保存失败，可批量重试":"";return '<article class="wr-detail-source"><b>'+(index+1)+'. '+esc(row.title)+'</b><div class="wr-meta"><span class="wr-pill">权威度 '+esc(row.authorityLevel||"D")+'</span> '+esc(row.publisher||"来源机构待识别")+' '+esc(row.publishedAt||"")+esc(depText)+'</div><p>'+esc(row.snippet||"暂无摘要")+'</p><a href="'+esc(row.url)+'" target="_blank" rel="noopener">查看原网页 ↗</a></article>';}).join(""):'<div class="wr-batch-empty">'+(viewOutput?'该任务暂未返回真实候选，将保留材料缺口。':taskStatus(viewIndex).text+'，返回后会在这里显示标题、摘要和原网页。')+'</div>';
      const liveLedger='<div class="wr-live-ledger"><section class="wr-ledger-pane"><div class="wr-pane-title">① 全部 '+total+' 个小节检索任务（点击行查看）</div><div class="wr-ledger-scroll"><table class="wr-ledger-table"><thead><tr><th>#</th><th>章节 / 小节</th><th>查什么</th><th>本小节状态</th></tr></thead><tbody>'+ledgerRows+'</tbody></table></div></section><section class="wr-detail-pane"><div class="wr-pane-title">② 当前选中小节的具体内容（'+viewRows.length+' 条，不是全部任务）</div><div class="wr-detail-body"><b>'+esc((viewTarget.chapter||"")+'｜'+(viewTarget.section||""))+'</b><div class="wr-detail-query"><b>实际检索词：</b> '+esc(batchSearchQuery(viewTarget))+'<br><b>需要查找：</b> '+esc(viewTarget.requirement||viewTarget.titles&&viewTarget.titles.join("；")||"公开依据")+'<br><b>关联逻辑项：</b> '+esc((viewTarget.sourceNos||[]).join("、")||"—")+'</div>'+detailSources+'</div></section></div>';
      const selectedIds=new Set(job.selectedEvidenceIds||[]),resultHtml=complete?'<details class="wr-batch-group" open><summary><b>③ 集中审核并采用检索依据</b><span>'+allRows.length+' 条候选</span></summary>'+job.targets.map((target,targetIndex)=>{const output=job.outputs[targetIndex]||{target,results:[]},rows=output.results||[];return '<details class="wr-batch-group" '+(rows.length?'open':'')+'><summary><b>'+esc(target.chapter+'｜'+target.section)+'</b><span>'+(rows.length?rows.length+'条候选':'暂无结果')+'</span></summary><div class="wr-batch-need">检索需求：'+esc(target.requirement||target.titles.join("；")||"本节公开依据")+'</div>'+(rows.length?rows.map(row=>'<label class="wr-result wr-batch-result"><input type="checkbox" class="wr-batch-check" data-evidence-id="'+esc(row.evidenceId)+'" data-target-index="'+targetIndex+'" data-authority="'+esc(row.authorityLevel||"D")+'" '+(selectedIds.has(row.evidenceId)?'checked':'')+'><span><b>'+esc(row.title)+'</b><span class="wr-meta"><i class="wr-pill">权威度 '+esc(row.authorityLevel||"D")+'</i> '+esc(row.publisher||"")+' '+esc(row.publishedAt||"")+'</span><span>'+esc(row.snippet||"暂无摘要")+'</span><a href="'+esc(row.url)+'" target="_blank" rel="noopener">打开原网页</a></span></label>').join(""):'<div class="wr-batch-empty">本节未检索到真实候选，将保留缺口标记，不会编造来源。</div>')+'</details>';}).join("")+'</details>':'';
      const depositRows=highValueEntries(job,["A","B"]),autoA=allRows.filter(row=>/^A$/.test(row.authorityLevel||row.authority_level||"")&&/^(submitted|existing)$/.test(row.knowledgeDeposit&&row.knowledgeDeposit.status||"")).length;
      overlay.innerHTML='<section class="wr-modal wr-batch-modal"><div class="wr-head"><div><h3>生成前 · 批量联网补齐</h3><div class="wr-meta">任务与弹窗已分离；左侧查看“查了什么”，右侧查看实际检索词、网页摘要和原始链接。</div></div><button class="wr-close">×</button></div><div class="wr-batch-progress"><b>'+(complete?'全部检索完成':paused?'已暂停，当前请求收尾后停止':'正在并行检索公开依据…')+'</b><span>'+job.done+' / '+total+' 个小节任务</span><div><i style="width:'+pct+'%"></i></div></div><div class="wr-batch-summary"><b>'+(complete?'检索完成：':'实时统计：')+'</b>已完成 '+job.done+' / '+total+' 个小节任务；全部已完成任务累计返回 '+allRows.length+' 条网页候选；当前选中小节为 '+viewRows.length+' 条。A级官方来源已自动沉淀 '+autoA+' 条；A/B级高价值来源（按网址去重）共 '+depositRows.length+' 条。'+(complete?'请集中审核后采用；沉淀内容先进入后台待审台账，管理员发布后才进入RAG。':'每个小节分别检索，点击左侧任一行查看对应内容。')+'</div>'+liveLedger+'<div class="wr-batch-results">'+resultHtml+'</div><div class="wr-batch-footer">'+(!complete?'<button class="btn sm ghost wr-batch-toggle">'+(paused?'▶ 继续检索':'⏸ 暂停检索')+'</button>':'')+'<button class="btn sm ghost wr-batch-deposit" '+(depositRows.length?'':'disabled')+'>💾 保存已检索高价值来源（A/B）</button>'+(complete?'<button class="btn sm ghost wr-batch-official">勾选 A/B 级来源</button><button class="btn sm ghost wr-batch-all">全选</button><button class="btn sm ghost wr-batch-none">清空</button><span class="wr-batch-selected">已选 '+selectedIds.size+' 条</span><button class="btn sm wr-batch-approve" '+(selectedIds.size?'':'disabled')+'>采用所选依据</button><button class="btn sm ghost wr-batch-knowledge" '+(selectedIds.size?'':'disabled')+'>采用并提交知识库审核</button>':'<span class="wr-batch-selected">关闭窗口后仍可继续其他操作</span>')+(job.runtime&&job.runtime.continueAfter&&!job.continued?'<button class="btn sm wr-batch-continue">后台继续并进入下一步 →</button>':'')+'<button class="btn sm ghost wr-batch-close">关闭窗口'+(!paused&&!complete?'（后台继续）':'')+'</button></div></section>';
      overlay.querySelector(".wr-close").onclick=close;overlay.querySelector(".wr-batch-close").onclick=close;overlay.onclick=event=>{if(event.target===overlay)close();};
      overlay.querySelectorAll(".wr-ledger-row").forEach(row=>row.onclick=()=>{job.viewIndex=Number(row.dataset.index)||0;render();});
      const toggle=overlay.querySelector(".wr-batch-toggle");if(toggle)toggle.onclick=()=>{if(job.status==="paused")resumeBatchSearch();else pauseBatchSearch();};
      const depositButton=overlay.querySelector(".wr-batch-deposit");if(depositButton)depositButton.onclick=async()=>{depositButton.disabled=true;depositButton.textContent="正在保存A/B级来源…";try{const result=await depositHighValue(job,["A","B"],{fetchFullText:false,concurrency:4});alert("高价值来源沉淀完成：新提交 "+result.submitted+" 条，审核链路已有 "+result.existing+" 条（待审核 "+result.pending+" 条、已审核 "+result.approved+" 条），失败 "+result.failed+" 条。\n\n现在可在后台‘RAG知识库 → 联网知识沉淀队列’查看每条资料跑到哪一步；只有显示‘已进入RAG’的资料才参与检索。");render();}catch(error){depositButton.disabled=false;depositButton.textContent="保存失败，请重试";}};
      const continueButton=overlay.querySelector(".wr-batch-continue");if(continueButton)continueButton.onclick=()=>{continueFromBatch(job,{background:!complete,done:job.done,total});close();};
      if(complete){const selected=()=>[...overlay.querySelectorAll(".wr-batch-check:checked")],update=()=>{job.selectedEvidenceIds=selected().map(input=>input.dataset.evidenceId);overlay.querySelector(".wr-batch-selected").textContent="已选 "+job.selectedEvidenceIds.length+" 条";overlay.querySelector(".wr-batch-approve").disabled=!job.selectedEvidenceIds.length;overlay.querySelector(".wr-batch-knowledge").disabled=!job.selectedEvidenceIds.length;};
        overlay.querySelector(".wr-batch-results").onchange=update;overlay.querySelector(".wr-batch-official").onclick=()=>{overlay.querySelectorAll(".wr-batch-check").forEach(input=>input.checked=/^[AB]$/.test(input.dataset.authority));update();};overlay.querySelector(".wr-batch-all").onclick=()=>{overlay.querySelectorAll(".wr-batch-check").forEach(input=>input.checked=true);update();};overlay.querySelector(".wr-batch-none").onclick=()=>{overlay.querySelectorAll(".wr-batch-check").forEach(input=>input.checked=false);update();};
        const applyChosen=async(event,submitToKnowledge)=>{const chosen=selected(),button=event.currentTarget;button.disabled=true;button.textContent=submitToKnowledge?"正在采用并提交审核…":"正在批量采用…";try{const results=await runLimited(chosen,4,async input=>{const targetIndex=Number(input.dataset.targetIndex),target=job.targets[targetIndex],row=(job.outputs[targetIndex]&&job.outputs[targetIndex].results||[]).find(x=>(x.evidenceId||x.id)===input.dataset.evidenceId);await setStatus(input.dataset.evidenceId,"approved",target.logicIds,{skipReload:true});if(submitToKnowledge&&row){try{const data=await submitKnowledgeReview(row,target);return {adopted:true,submitted:true,existing:!!data.existing};}catch(error){return {adopted:true,submitted:false,knowledgeError:error.message||String(error)};}}return {adopted:true,submitted:false};});await loadEvidence(true);if(job.runtime&&job.runtime.onAdopt)job.runtime.onAdopt();const adopted=results.filter(x=>x&&x.adopted).length,submitted=results.filter(x=>x&&x.submitted).length,adoptFailed=results.filter(x=>x&&x.error).length,knowledgeFailed=results.filter(x=>x&&x.knowledgeError).length;if(job.runtime&&job.runtime.continueAfter)continueFromBatch(job,{adopted,background:false});if(submitToKnowledge)alert("已采用 "+adopted+" 条依据，其中 "+submitted+" 条已进入知识库审核链路"+(knowledgeFailed?"；"+knowledgeFailed+" 条知识库提交失败，可稍后重试":"")+(adoptFailed?"；"+adoptFailed+" 条依据采用失败":"")+"。管理员发布后才进入正式RAG知识库。");close();}catch(error){button.disabled=false;button.textContent=submitToKnowledge?"提交失败，请重试":"采用失败，请重试";}};
        overlay.querySelector(".wr-batch-approve").onclick=event=>applyChosen(event,false);overlay.querySelector(".wr-batch-knowledge").onclick=event=>applyChosen(event,true);
      }
    };
    state.batchRender=render;render();return job;
  }
  function batchSearchGaps(items,options){
    options=options||{};const targets=buildBatchTargets(items);if(!targets.length){if(options.onAdopt)options.onAdopt();if(options.continueAfter&&options.onContinue)options.onContinue({adopted:0,noGaps:true});return {targets:[],outputs:[]};}
    let job=restoreBatchJob(),signature=batchSignature(targets);if(!job||job.projectId!==projectContext().projectId||job.signature!==signature){job={id:"wrb-"+Date.now(),projectId:projectContext().projectId,status:"running",targets,outputs:new Array(targets.length),nextIndex:0,done:0,continued:false,signature,concurrency:Math.max(1,Math.min(Number(options.concurrency)||2,4)),maxResults:Number(options.maxResults)||10,startedAt:Date.now(),updatedAt:Date.now(),runtime:{},runPromise:null};state.batchJob=job;persistBatchJob(job);}
    job.maxResults=Math.max(Number(job.maxResults)||0,Number(options.maxResults)||10);job.runtime=Object.assign(job.runtime||{},options);if(job.status==="running")startBatchJob(job);if(options.openReview!==false)openBatchReview(job);return job;
  }
  function registerAgentTools(){
    if(!global.AgentCore||global.AgentCore._tools&&global.AgentCore._tools.search_affordable_housing_web)return;
    global.AgentCore.registerTool("search_affordable_housing_web",{risk:"external",toolset:"knowledge",timeoutMs:60000,schema:{type:"function",function:{name:"search_affordable_housing_web",description:"联网检索保障房项目政策、人口统计、市场、规划和当前小节所需依据。返回真实候选及权威等级；候选未经人工采用不能视为正式依据。",parameters:{type:"object",properties:{chapter:{type:"string"},section:{type:"string"},requirement:{type:"string"},maxQueries:{type:"number"}},required:["requirement"]}}},label:a=>"🌐 联网检索："+String(a.requirement||"").slice(0,28),run:async a=>JSON.stringify(await searchSection(Object.assign({},a,{review:false,maxQueries:Math.min(Number(a.maxQueries)||3,3)})))});
    global.AgentCore.registerTool("list_web_evidence",{toolset:"knowledge",schema:{type:"function",function:{name:"list_web_evidence",description:"列出当前项目已经人工采用的联网证据及其权威度、网址和对应章节。",parameters:{type:"object",properties:{chapter:{type:"string"},section:{type:"string"}}}}},run:async a=>{await loadEvidence();return JSON.stringify(sectionRows(a.chapter,a.section));}});
  }
  global.WebResearch={api,loadEvidence,materialContext,contextForSection,searchSection,searchFromButton,batchSearchGaps,buildBatchTargets,batchStatus,pauseBatchSearch,resumeBatchSearch,setStatus,classifyWebEvidence,knowledgeContributionItem,highValueEntries,depositHighValue,state,registerAgentTools};
  function boot(){registerAgentTools();loadEvidence().catch(()=>{});const job=restoreBatchJob();if(job&&job.status==="running")startBatchJob(job);}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})(window);
