/* PPT-specific continuous conversation layer. Loaded after ppt-agent-workflow.js. */
(function(root){
  "use strict";
  if(!root.PptWorkspace||!root.PptConversationCore)return;
  const W=root.PptWorkspace,S=W.state,C=root.PptConversationCore,get=id=>document.getElementById(id),plan=()=>S.current&&S.current.data;
  const esc=value=>String(value==null?"":value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const conversation=p=>{p.workflow=p.workflow||{};p.workflow.pptConversation=Array.isArray(p.workflow.pptConversation)?p.workflow.pptConversation:[];return p.workflow.pptConversation;};
  function push(role,content,meta={}){const p=plan();if(!p)return;const rows=conversation(p);rows.push({role,content:String(content||"").trim(),at:Date.now(),...meta});p.workflow.pptConversation=rows.slice(-30);}
  function notify(message){S.message=message;const el=get("pptMessage");if(el){el.textContent=message;el.classList.add("show");}}
  function rerender(){const sheet=get("sheet");if(sheet){sheet.innerHTML=root.renderPptWorkspace();root.bindPptWorkspace();}}
  function replaceMaterialPrompt(){if(!root.PptCore||root.PptCore.__conversationPromptInstalled)return;root.PptCore.__conversationPromptInstalled=true;root.PptCore.aiPrompt=input=>C.materialPlanningPrompt({...input,layouts:(root.PptComponents&&root.PptComponents.definitions||[]).map(x=>x.id+"："+x.use+"（最多"+(x.maxItems||"-")+"项）")});}

  function attachmentHtml(p){const assets=((p.evidencePack&&p.evidencePack.assets)||[]).filter(x=>x.id!=="src_pasted");if(!assets.length)return"";return '<div class="ppt-composer-attachments"><b>已读取材料</b>'+assets.slice(0,8).map(a=>'<span title="'+esc(a.name)+'"><i>✓</i><em>'+esc(a.name)+'</em><small>'+esc(a.kind||"file")+'</small></span>').join("")+(assets.length>8?'<strong>另有 '+(assets.length-8)+' 份</strong>':"")+'</div>';}
  function messagesHtml(p){const rows=conversation(p).slice(-8);if(!rows.length)return"";return '<div class="ppt-runtime-thread">'+rows.map(row=>'<div class="ppt-runtime-message '+(row.role==="user"?"user":"assistant")+'"><span>'+(row.role==="user"?"你":"AI")+'</span><p>'+esc(row.content).replace(/\n/g,"<br>")+'</p></div>').join("")+'</div>';}
  function installComposerUi(){
    const p=plan(),compose=document.querySelector(".ppt-chat-compose"),composer=compose&&compose.querySelector(".ppt-chat-composer"),textarea=get("pptChatCommand")||get("pptSource"),oldButton=get("pptChatContinue");if(!p||!compose||!composer||!textarea||!oldButton)return;
    const attachmentSignature=((p.evidencePack&&p.evidencePack.assets)||[]).map(x=>[x.id,x.name,x.size]).join("|");
    let attachments=composer.querySelector(".ppt-composer-attachments"),html=attachmentHtml(p);if(html&&!attachments){composer.insertAdjacentHTML("afterbegin",html);attachments=composer.querySelector(".ppt-composer-attachments");if(attachments)attachments.dataset.signature=attachmentSignature;}else if(html&&attachments&&attachments.dataset.signature!==attachmentSignature){attachments.outerHTML=html;attachments=composer.querySelector(".ppt-composer-attachments");if(attachments)attachments.dataset.signature=attachmentSignature;}else if(!html&&attachments)attachments.remove();
    const messageSignature=conversation(p).slice(-8).map(x=>[x.role,x.at,x.content]).join("|");
    const feed=document.querySelector(".ppt-thread-feed"),runtimeHost=feed||compose;let runtime=document.querySelector(".ppt-runtime-thread"),runtimeHtml=messagesHtml(p);if(runtimeHtml&&!runtime){runtimeHost.insertAdjacentHTML(feed?"beforeend":"afterbegin",runtimeHtml);runtime=document.querySelector(".ppt-runtime-thread");if(runtime)runtime.dataset.signature=messageSignature;}else if(runtimeHtml&&runtime&&runtime.dataset.signature!==messageSignature){runtime.outerHTML=runtimeHtml;runtime=document.querySelector(".ppt-runtime-thread");if(runtime)runtime.dataset.signature=messageSignature;}else if(!runtimeHtml&&runtime)runtime.remove();
    if(messageSignature&&S._pptConversationRenderedSignature!==messageSignature){S._pptConversationRenderedSignature=messageSignature;queueMicrotask(()=>{const activeFeed=document.querySelector(".ppt-v2-conversation .ppt-thread-feed"),shell=document.querySelector(".ppt-agent-shell.ppt-v2");if(activeFeed)activeFeed.scrollTop=activeFeed.scrollHeight;if(shell)shell.scrollTop=shell.scrollHeight;});}
    if(oldButton.dataset.pptConversationBound==="yes")return;const button=oldButton.cloneNode(true);button.dataset.pptConversationBound="yes";button.__pptChatAgentBound=true;oldButton.replaceWith(button);
    button.addEventListener("click",event=>{event.preventDefault();sendConversation().catch(error=>{notify("PPT对话处理失败："+error.message);S.busy=false;rerender();});});
    textarea.addEventListener("keydown",event=>{if(event.isComposing)return;if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();button.click();}});
  }
  function hasMaterials(p){return !!((((p.evidencePack&&p.evidencePack.assets)||[]).length)||String(p.sourceText||"").trim());}
  function currentInput(){const el=get("pptChatCommand")||get("pptSource");return el?el.value.trim():"";}
  function setCurrentInput(value){const el=get("pptChatCommand")||get("pptSource");if(el)el.value=value;}
  function scrollToLatest(){const run=()=>{const feed=document.querySelector(".ppt-v2-conversation .ppt-thread-feed"),shell=document.querySelector(".ppt-agent-shell.ppt-v2");if(feed)feed.scrollTop=feed.scrollHeight;if(shell)shell.scrollTop=shell.scrollHeight;};if(root.requestAnimationFrame)root.requestAnimationFrame(()=>root.requestAnimationFrame(run));else setTimeout(run,0);}
  function needsInitialGeneration(p){return hasMaterials(p)&&!(p.workflow&&p.workflow.materialPlanGeneratedAt);}
  async function automaticImages(p,pages=[]){
    const providers=root.PptImageProviders;if(!providers||typeof providers.search!=="function")return{generated:0,reason:"图片Provider未加载"};
    let status=null;try{const response=await root.fetch("/api/ppt-image-status",{headers:typeof root.authHeaders==="function"?root.authHeaders():{}});status=await response.json();}catch(error){return{generated:0,reason:"图片服务状态读取失败"};}
    const available=(status&&status.providers||[]).filter(x=>x.available),preferred=available.find(x=>x.id===p.imageProviderChoice)||available.find(x=>x.id==="nano-banana")||available.find(x=>x.id==="comfyui");
    if(!preferred)return{generated:0,reason:"Nano Banana和本地生图均未启用"};
    const requested=[...new Set((pages||[]).map(Number).filter(x=>x>0&&x<=(p.slides||[]).length))].slice(0,2),targets=requested.length?requested.map(page=>{const s=p.slides[page-1];return s&&!s.locked?{page,query:[s.title,s.claim,s.subtitle].filter(Boolean).join("，").slice(0,180)}:null;}).filter(Boolean):C.selectImageSlides(p,2);if(!targets.length)return{generated:0,reason:"没有适合主视觉图片的页面"};
    let current=p,generated=0,errors=[];
    for(const target of targets){
      notify("正在调用"+preferred.name+"生成第"+target.page+"页主视觉（"+(generated+1)+"/"+targets.length+"）…");
      const slide=(current.slides||[])[target.page-1],query=target.query||slide.title||current.title;
      const rows=await providers.search(query,{plan:current,style:current.templateId,accent:(current.designSpec||{}).accent,imageProviderOptions:{mode:current.imageProviderMode||"standard",aspectRatio:"16:9",imageSize:"1K"}},[preferred.id]);
      const image=rows.find(x=>x&&x.dataUrl),failed=rows.find(x=>x&&x.error);
      if(image&&root.PptAssetCenter&&typeof root.PptAssetCenter.saveGenerated==="function"){
        try{
          const saved=await root.PptAssetCenter.saveGenerated(image,{title:(slide.title||current.title||"PPT")+"主视觉",description:"AI自动生成并应用于第"+target.page+"页",tags:["AI生成","PPT主视觉","第"+target.page+"页"],prompt:query,projectId:S.current&&S.current.id||""});
          if(saved){image.libraryAssetId=saved.id;image.id=saved.id;}
        }catch(assetError){errors.push("第"+target.page+"页素材已应用，但入库失败："+assetError.message);}
      }
      if(!image){errors.push("第"+target.page+"页："+(failed&&failed.error||"未返回图片"));continue;}
      const applied=C.applyGeneratedImage(current,target.page,image);if(applied.ok){current=applied.plan;generated++;}
    }
    current.imageProviderChoice=preferred.id;current.workflow={...(current.workflow||{}),imageGeneration:{provider:preferred.id,generated,requested:targets.length,errors,at:Date.now()}};S.current.data=current;
    return{generated,provider:preferred.name,errors,reason:errors.join("；")};
  }
  async function generateFromMaterials(text){
    const before=plan(),history=conversation(before).slice(),request=text||"请读取已上传材料，形成汇报框架并生成完整PPT。";push("user",request,{kind:"material_request"});notify("AI正在识别材料、提取关键事实并生成逐页内容……");
    await W.aiBuild();let p=plan();const grounded=C.groundDeck(p);S.current.data=p=grounded.plan;p.workflow={...(p.workflow||{}),stage:"design",materialPlanGeneratedAt:Date.now(),pptConversation:history.concat([{role:"user",content:request,at:Date.now(),kind:"material_request"}]).slice(-29),materialQuality:{contentCoverage:grounded.contentCoverage,sourceCoverage:grounded.sourceCoverage,filledContent:grounded.filledContent,filledSources:grounded.filledSources,checkedAt:Date.now()}};
    const imageResult=await automaticImages(p);p=plan();p.workflow={...(p.workflow||{}),lastImageGenerationSummary:imageResult};
    const sourceCount=Number(p.evidencePack&&p.evidencePack.summary&&p.evidencePack.summary.assetCount)||0;
    if(imageResult.generated)push("assistant",imageResult.provider+"已生成并应用 "+imageResult.generated+" 张主视觉；这些图片已进入预览和PPT导出链路。",{kind:"image_generation",imageGeneration:imageResult});
    else push("assistant","本次没有应用AI主视觉："+(imageResult.reason||"图片服务未返回结果")+"。文字、结构和可编辑组件仍已正常生成。",{kind:"image_generation",imageGeneration:imageResult});
    push("assistant","已读取 "+sourceCount+" 份材料，形成 "+(p.slides||[]).length+" 页框架；正文覆盖 "+grounded.contentCoverage+"%，来源覆盖 "+grounded.sourceCoverage+"%。你可以继续说“把第3页改成风险矩阵”或“重新梳理整套故事线”。",{kind:"generation_result"});await W.saveProject("AI读取材料并生成完整PPT");
  }
  function registerTools(){
    if(!root.AgentCore||root.AgentCore.__pptConversationTools)return;root.AgentCore.__pptConversationTools=true;
    root.AgentCore.registerTool("ppt_update_slide_content",{schema:{type:"function",function:{name:"ppt_update_slide_content",description:"按用户要求修改指定PPT页面的标题、副标题、要点或版式。",parameters:{type:"object",properties:{page:{type:"number",description:"页码，从1开始"},title:{type:"string"},subtitle:{type:"string"},bullets:{type:"array",items:{type:"string"}},layoutId:{type:"string"},notes:{type:"string"}},required:["page"]}}},validate:args=>Number(args&&args.page)>0?{ok:true}:{ok:false,error:"缺少有效页码"},label:args=>"修改PPT第"+args.page+"页",async run(args){const result=C.applySlidePatch(plan(),args);if(!result.ok)return result.error;result.plan.workflow={...(result.plan.workflow||{}),lastChange:{page:result.page,before:result.before,after:result.after,status:"accepted",kind:"conversation",at:Date.now()}};S.current.data=result.plan;S.selected=result.page-1;return"第"+result.page+"页已按要求修改。";}});
    root.AgentCore.registerTool("ppt_change_template",{schema:{type:"function",function:{name:"ppt_change_template",description:"切换整套PPT品牌模板。",parameters:{type:"object",properties:{templateId:{type:"string",enum:["anju-blue","business-blue-160","gov-clean","data-light"]}},required:["templateId"]}}},validate:args=>["anju-blue","business-blue-160","gov-clean","data-light"].includes(args&&args.templateId)?{ok:true}:{ok:false,error:"模板不存在"},label:()=>"切换PPT模板",async run(args){const p=plan();p.templateId=args.templateId;p.exportMode="preview";S.current.templateId=args.templateId;return"已切换模板，所有页面将按新品牌规范渲染。";}});
    root.AgentCore.registerTool("ppt_open_review",{schema:{type:"function",function:{name:"ppt_open_review",description:"将当前PPT进入复核阶段并运行质量检查。",parameters:{type:"object",properties:{}}}},validate:()=>({ok:true}),label:()=>"进入PPT复核",async run(){const p=plan();p.workflow={...(p.workflow||{}),stage:"review",reviewedAt:Date.now()};return"已进入复核阶段，可以查看内容、设计、连贯性和来源检查。";}});
    root.AgentCore.registerTool("ppt_generate_images",{schema:{type:"function",function:{name:"ppt_generate_images",description:"调用已配置的Nano Banana或本地生图服务，为指定PPT页面生成并应用主视觉。一次最多两页。",parameters:{type:"object",properties:{pages:{type:"array",items:{type:"number"},description:"需要生图的页码；不填则智能选择最多两页"}}}}},validate:args=>!args||!args.pages||Array.isArray(args.pages)?{ok:true}:{ok:false,error:"pages必须是页码数组"},label:args=>"生成PPT主视觉"+((args&&args.pages||[]).length?"（第"+args.pages.join("、")+"页）":""),async run(args){const result=await automaticImages(plan(),args&&args.pages||[]);if(!result.generated)return"未生成图片："+(result.reason||"图片服务未返回结果");return result.provider+"已生成并应用 "+result.generated+" 张主视觉，预览与导出将保持一致。";}});
  }
  function applyDirectCommand(text){
    const pageMatch=text.match(/第\s*(\d+)\s*页/),page=pageMatch?Number(pageMatch[1]):0;if(!page)return null;
    const titleMatch=text.match(/标题[^“\"']*(?:改为|改成|修改为)\s*[“\"']([^”\"']+)[”\"']/)||text.match(/标题[^，。]*(?:改为|改成|修改为)\s*([^，。；;]+)/);
    const layouts=[[/(时间轴|里程碑)/,"timeline"],[/(风险矩阵|风险页)/,"risk"],[/(对比页|双栏对比|对比布局)/,"comparison"],[/(指标卡|核心数字)/,"metric"],[/(表格页|表格布局)/,"table"],[/(结论页|决策页)/,"conclusion"]];
    const layout=(layouts.find(([re])=>re.test(text))||[])[1],args={page};if(titleMatch)args.title=String(titleMatch[1]||"").trim();if(layout)args.layoutId=layout;
    if(!args.title&&!args.layoutId)return null;const result=C.applySlidePatch(plan(),args);if(!result.ok)return{ok:false,message:result.error};
    result.plan.workflow={...(result.plan.workflow||{}),lastChange:{page:result.page,before:result.before,after:result.after,status:"accepted",kind:"direct-conversation",at:Date.now()}};S.current.data=result.plan;S.selected=result.page-1;
    return{ok:true,message:"已实际更新第"+result.page+"页"+(args.title?"标题":"")+(args.title&&args.layoutId?"和":"")+(args.layoutId?"版式":"")+"，原有未指定内容保持不变。"};
  }
  async function continueWithAgent(text){
    if(!text){notify("请输入修改要求或问题");return;}const p=plan();push("user",text,{kind:"conversation"});setCurrentInput("");const direct=applyDirectCommand(text);if(direct){push("assistant",direct.message,{kind:"direct-command"});rerender();await W.saveProject("PPT对话直接修改");return;}const local=C.localProjectAnswer&&C.localProjectAnswer(p,text);if(local){push("assistant",local,{kind:"local-project-answer"});rerender();await W.saveProject("PPT本地项目问答");return;}rerender();S.busy=true;notify("AI正在结合整套材料与PPT回答…");
    const context=C.deckContext(p),history=conversation(p).slice(-10).map(x=>({role:x.role,content:x.content})),system=["你是当前PPT项目的专属智能体。你能理解整套材料、汇报目标和逐页结构，并持续回答、诊断和修改。","用户只是咨询时直接回答且不得调用工具；只有用户明确要求修改时才能调用修改工具。只有用户明确说生图、图片或配图时才能调用图片工具。","用户说文字不够或内容太少时，应分析并扩充有来源的文字与结构，禁止擅自调用生图工具。","不得编造材料里没有的数字；涉及数字时保留来源。人工锁定页未经用户明确要求不得修改。","当前PPT上下文："+JSON.stringify(context)].join("\n"),isChange=/修改|改成|调整|删除|新增|拆分|合并|生成|切换|换成|应用|撤销|复核|导出/.test(text),wantsImage=/生图|图片|配图|主视觉|banana/i.test(text),allTools=["ppt_update_slide_content","ppt_change_template","ppt_open_review","ppt_regenerate_current_slide","ppt_undo_last_change","ppt_split_current_slide","ppt_merge_with_next_slide"],tools=isChange?(wantsImage?allTools.concat("ppt_generate_images"):allTools):[];
    let result;try{result=await Promise.race([root.AgentCore.run({system,messages:history,tools,maxRounds:3,maxSelfCheck:0,useMemory:false,traceQuery:text}),new Promise((_,reject)=>setTimeout(()=>reject(new Error("模型响应超时")),15000))]);}catch(error){const fallback="当前模型暂未在15秒内返回，但你的问题已经保留。你可以重试，或先问页数、材料来源、内容是否偏少、哪些页面需要提升，这些问题可以由本地项目数据立即回答。";push("assistant",fallback,{kind:"model-timeout",error:error.message});notify(fallback);rerender();await W.saveProject("PPT对话超时兜底");return;}
    const latest=plan();latest.workflow={...(latest.workflow||{}),pptConversation:conversation(p)};push("assistant",result.text||"已处理你的要求。",{kind:"conversation",toolCalls:(result.toolCalls||[]).map(x=>x.name)});S.busy=false;await W.saveProject("PPT持续对话修改");
  }
  async function sendConversation(){if(S.busy)return;const p=plan(),text=currentInput();if(!p)return;if(!hasMaterials(p)){notify("请先上传至少一份材料，或在对话框中粘贴材料与汇报要求");return;}S.busy=true;try{if(needsInitialGeneration(p))await generateFromMaterials(text);else await continueWithAgent(text);}finally{S.busy=false;rerender();scrollToLatest();}}
  replaceMaterialPrompt();registerTools();let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;installComposerUi();});});observer.observe(document.documentElement,{childList:true,subtree:true});queueMicrotask(installComposerUi);root.PptConversationAgent={send:sendConversation,install:installComposerUi};
})(window);
