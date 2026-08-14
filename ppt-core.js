/* PPT 工作台纯逻辑层：浏览器与 Node 测试共用，不负责数据库和文件导出。 */
(function(root){
  "use strict";

  const TEMPLATE_PRESETS = [
    {id:"anju-blue",name:"安居蓝·标准汇报",accent:"2F75B5",background:"F5F9FD",text:"183B56",description:"适合可研、项目进展和经营分析汇报"},
    {id:"gov-clean",name:"政务蓝·简洁汇报",accent:"1F4E78",background:"FFFFFF",text:"1F2937",description:"适合领导审议和正式会议材料"},
    {id:"data-light",name:"数据浅蓝·分析汇报",accent:"3C8DBC",background:"F2F8FC",text:"20384B",description:"适合测算、人口与职住平衡分析"},
  ];

  const clean=(v,n=4000)=>String(v==null?"":v).replace(/\r/g,"").trim().slice(0,n);
  const makeId=(prefix="slide")=>prefix+"_"+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  function bullets(text,limit=5){
    return clean(text,12000).split(/\n|[。；;]+/).map(x=>x.replace(/^[-*•\d.、\s]+/,"").trim()).filter(x=>x.length>3).slice(0,limit);
  }
  function headings(text){
    const lines=clean(text,50000).split("\n"),out=[];
    for(const line of lines){
      const m=line.match(/^\s*(?:#{1,4}\s+|[一二三四五六七八九十]+[、.]|\d+(?:\.\d+)*[、.\s]+)(.+)$/);
      if(m&&clean(m[1],80))out.push({title:clean(m[1],80),raw:line});
    }
    return out;
  }
  function sourceSections(text){
    const hs=headings(text);
    if(!hs.length)return [];
    const lines=clean(text,50000).split("\n"),out=[];let current=null;
    for(const line of lines){
      const m=line.match(/^\s*(?:#{1,4}\s+|[一二三四五六七八九十]+[、.]|\d+(?:\.\d+)*[、.\s]+)(.+)$/);
      if(m){if(current)out.push(current);current={title:clean(m[1],80),body:""};}
      else if(current)current.body+=(current.body?"\n":"")+line;
    }
    if(current)out.push(current);return out;
  }
  function defaultOutline(sourceText,slideCount=8){
    const sections=sourceSections(sourceText),plain=bullets(sourceText,30),n=Math.max(5,Math.min(20,Number(slideCount)||8));
    const slides=[{type:"cover",title:"项目汇报",subtitle:"AI智能项目汇报",bullets:[]}];
    if(sections.length){
      sections.slice(0,n-2).forEach(s=>slides.push({type:"content",title:s.title,subtitle:"",bullets:bullets(s.body,5)}));
    }else{
      const names=["项目背景与目标","项目基本情况","核心数据与测算","重点问题分析","实施方案","风险与应对","下一步工作计划"];
      for(let i=0;i<n-2;i++)slides.push({type:"content",title:names[i]||("专题分析"+(i+1)),subtitle:"",bullets:plain.slice(i*4,i*4+4)});
    }
    slides.push({type:"conclusion",title:"结论与下一步",subtitle:"",bullets:["汇总核心判断与待决策事项","明确责任分工、时间节点和后续动作"]});
    return slides.slice(0,n);
  }
  function normalizeSlide(slide,index){
    const type=["cover","agenda","content","section","conclusion"].includes(slide&&slide.type)?slide.type:(index===0?"cover":"content");
    const layout=(root.PptComponents&&root.PptComponents.normalizeLayout)?root.PptComponents.normalizeLayout(slide&&slide.layoutId,type):(slide&&slide.layoutId)||(type==="cover"?"cover":type==="section"?"section":type==="conclusion"?"conclusion":"bullets");
    const content=slide&&slide.content&&typeof slide.content==="object"&&!Array.isArray(slide.content)?JSON.parse(JSON.stringify(slide.content)):{};
    return {id:clean(slide&&slide.id,80)||makeId("s"),order:index+1,type,layoutId:layout,title:clean(slide&&slide.title,100)||("第"+(index+1)+"页"),claim:clean(slide&&slide.claim,220),subtitle:clean(slide&&slide.subtitle,180),bullets:(Array.isArray(slide&&slide.bullets)?slide.bullets:bullets(typeof (slide&&slide.content)==="string"?slide.content:"",6)).map(x=>clean(x,240)).filter(Boolean).slice(0,8),content,visualIntent:clean(slide&&slide.visualIntent,200),notes:clean(slide&&slide.notes,2000),sources:Array.isArray(slide&&slide.sources)?slide.sources.slice(0,20):[],locked:!!(slide&&slide.locked),qa:slide&&slide.qa&&typeof slide.qa==="object"?slide.qa:{}};
  }
  function buildDeckPlan(input={}){
    const sourceText=clean(input.sourceText,80000),raw=Array.isArray(input.slides)&&input.slides.length?input.slides:defaultOutline(sourceText,input.slideCount);
    const template=TEMPLATE_PRESETS.find(x=>x.id===input.templateId)||TEMPLATE_PRESETS[0];
    return {schemaVersion:2,title:clean(input.title,120)||"未命名汇报",purpose:clean(input.purpose,200)||"项目汇报",audience:clean(input.audience,120)||"项目决策与审查人员",templateId:template.id,sourceText,sourceRefs:Array.isArray(input.sourceRefs)?input.sourceRefs.slice(0,100):[],evidencePack:input.evidencePack&&typeof input.evidencePack==="object"?input.evidencePack:null,story:input.story&&typeof input.story==="object"?input.story:null,generationMode:clean(input.generationMode,30)||"rule",slides:raw.map(normalizeSlide),createdAt:Number(input.createdAt)||Date.now(),updatedAt:Date.now()};
  }
  function validateDeckPlan(plan){
    const errors=[],warnings=[];
    if(!plan||!Array.isArray(plan.slides))return{ok:false,errors:["缺少逐页内容"],warnings};
    if(plan.slides.length<3)errors.push("至少需要3页");
    if(plan.slides.length>30)warnings.push("超过30页，建议拆分汇报");
    const ids=new Set();
    plan.slides.forEach((s,i)=>{
      if(!s.title)errors.push("第"+(i+1)+"页缺少标题");
      if(ids.has(s.id))errors.push("第"+(i+1)+"页ID重复");ids.add(s.id);
      if(s.title&&s.title.length>34)warnings.push("第"+(i+1)+"页标题较长，可能换行");
      if((s.bullets||[]).length>6)warnings.push("第"+(i+1)+"页要点超过6条，建议精简");
      if((s.bullets||[]).some(x=>x.length>90))warnings.push("第"+(i+1)+"页存在过长要点");
      if(!s.layoutId)warnings.push("第"+(i+1)+"页未指定动态组件");
      const visible=JSON.stringify([s.title,s.subtitle,s.claim,s.bullets,s.content]);
      if(/\d/.test(visible)&&!(s.sources||[]).length&&i>0)warnings.push("第"+(i+1)+"页包含数字但没有来源");
    });
    return{ok:errors.length===0,errors,warnings};
  }
  function stripJson(text){const s=clean(text,120000);const fenced=s.match(/```(?:json)?\s*([\s\S]*?)```/i);if(fenced)return fenced[1].trim();const a=s.indexOf("{"),b=s.lastIndexOf("}");return a>=0&&b>a?s.slice(a,b+1):s;}
  function parseAiPlan(text,base={}){
    let obj;try{obj=JSON.parse(stripJson(text));}catch(e){throw new Error("AI返回内容不是有效JSON");}
    const slides=Array.isArray(obj.slides)?obj.slides:[];if(slides.length<3)throw new Error("AI返回的逐页方案不足3页");
    return buildDeckPlan({...base,title:obj.title||base.title,purpose:obj.purpose||base.purpose,audience:obj.audience||base.audience,story:{communicationJob:clean(obj.communicationJob,300),centralTakeaway:clean(obj.centralTakeaway,300),narrativeArc:Array.isArray(obj.narrativeArc)?obj.narrativeArc.slice(0,12):[],decisionNeeded:clean(obj.decisionNeeded,300)},generationMode:"ai",slides});
  }
  function fallbackAiPlan(input={}){
    const pack=input.evidencePack||{},facts=(pack.facts||[]).slice(0,10),tables=pack.tables||[],n=Math.max(6,Math.min(20,Number(input.slideCount)||10));
    const src=(pack.sourceRefs||[]).map(x=>x.label||x.id).slice(0,8),slides=[{type:"cover",layoutId:"cover",title:input.title||"项目汇报",subtitle:input.purpose||"项目分析与决策建议",sources:src}];
    slides.push({type:"content",layoutId:"statement",title:"本次汇报聚焦项目价值、测算结论与实施决策",subtitle:"基于已导入材料形成可追溯的项目判断",sources:src});
    if(facts.length)slides.push({type:"content",layoutId:"metric",title:"关键数据勾勒项目基本盘",content:{metrics:facts.slice(0,4).map((f,i)=>({label:"指标"+(i+1),value:(f.values||[])[0]||"待核实",text:f.statement}))},bullets:facts.slice(0,4).map(x=>x.statement),sources:facts.slice(0,4).map(x=>x.sourceLabel+"｜"+x.locator)});
    if(tables.length)slides.push({type:"content",layoutId:"table",title:"核心数据表支持进一步判断",content:{headers:(tables[0].rows[0]||[]).slice(0,6),rows:tables[0].rows.slice(1,7)},sources:[tables[0].sourceLabel+"｜"+tables[0].locator]});
    const generic=[
      ["项目背景与目标","two-column",["项目建设背景与政策任务","本次汇报需要解决的核心问题"]],
      ["项目条件与实施基础","bullets",["区位、规划和建设条件","资源投入与实施边界","关键前置条件"]],
      ["财务测算与敏感因素","chart-bar",["总投资、收入与成本口径","IRR及关键敏感参数","测算结果须以白箱引擎为准"]],
      ["主要风险均有对应的控制动作","risk",["市场与需求风险","建设与进度风险","资金与财务风险","合规与运营风险"]],
      ["实施路径按阶段推进并设置复核节点","timeline",["资料确认","方案深化","测算复核","审批决策","组织实施"]]
    ];
    for(const [title,layout,bs] of generic){if(slides.length>=n-1)break;slides.push({type:"content",layoutId:layout,title,bullets:bs,sources:src});}
    while(slides.length<n-1)slides.push({type:"content",layoutId:"bullets",title:"专题分析 "+slides.length,bullets:["根据正式材料补充本页证据与结论"],sources:src});
    slides.push({type:"conclusion",layoutId:"conclusion",title:"建议在关键条件核实后推进下一步决策",bullets:["确认核心参数及其来源","完成测算和风险复核","明确责任分工与实施节点"],sources:src});
    return buildDeckPlan({...input,story:{communicationJob:"让决策与审查人员基于可追溯证据理解项目并形成下一步决策",centralTakeaway:"项目判断应同时由材料证据、白箱测算与业务规则支撑",narrativeArc:["背景","证据","分析","风险","决策"]},generationMode:"fallback",slides});
  }
  function aiPrompt(input={}){
    const layouts=(root.PptComponents&&root.PptComponents.definitions||[]).map(x=>x.id+":"+x.use).join("；");
    return "你是政府投资与保障房项目的高级汇报策划师。请严格基于材料制作可编辑PPT方案，不得编造数字。\n"
      +"汇报标题："+clean(input.title,120)+"\n汇报对象："+clean(input.audience,120)+"\n用途："+clean(input.purpose,160)+"\n目标页数："+Number(input.slideCount||10)+"\n"
      +"可用布局："+layouts+"\n每页只能承担一个叙事任务，标题优先写成结论句。数字页必须在sources写明材料名和位置。\n"
      +"只返回JSON：{title,purpose,audience,communicationJob,centralTakeaway,narrativeArc:[],decisionNeeded,slides:[{type,layoutId,title,claim,subtitle,bullets:[],content:{},visualIntent,sources:[]}]}。"
      +"content按布局可使用 metrics:[{label,value,text}]、columns:[{title,items:[{text}]}]、steps:[{label,text}]、series:[{label,value}]、headers:[]、rows:[[]]。\n\n材料证据：\n"+clean(input.evidenceText,65000);
  }
  function diffDeckPlans(before,after){
    const a=new Map(((before&&before.slides)||[]).map(x=>[x.id,x])),changes=[];
    for(const s of ((after&&after.slides)||[])){
      const old=a.get(s.id);if(!old){changes.push({slideId:s.id,type:"added",title:s.title});continue;}
      const fields=["layoutId","title","claim","subtitle","bullets","content","notes","sources","locked"].filter(k=>JSON.stringify(old[k])!==JSON.stringify(s[k]));
      if(fields.length)changes.push({slideId:s.id,type:"changed",title:s.title,fields});a.delete(s.id);
    }
    a.forEach(s=>changes.push({slideId:s.id,type:"removed",title:s.title}));return changes;
  }
  const api={TEMPLATE_PRESETS,buildDeckPlan,validateDeckPlan,diffDeckPlans,normalizeSlide,parseAiPlan,fallbackAiPlan,aiPrompt};
  root.PptCore=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
