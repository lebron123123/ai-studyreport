/* AI PPT agent workflow core: brief -> editable outline -> confirmed deck. */
(function(root){
  "use strict";
  const clone=x=>JSON.parse(JSON.stringify(x==null?{}:x));
  const clean=(v,n=500)=>String(v==null?"":v).trim().slice(0,n);
  const uid=p=>(p||"ppt_")+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  const STAGES=["intake","brief","outline","design","review","final"];
  function stageOf(plan={}){
    const explicit=clean(plan.workflow&&plan.workflow.stage,20);
    if(STAGES.includes(explicit))return explicit;
    if(plan.story&&Array.isArray(plan.slides)&&plan.slides.some(s=>s&&s.title))return"design";
    if(clean(plan.sourceText)||((plan.evidencePack&&plan.evidencePack.assets)||[]).length)return"brief";
    return"intake";
  }
  function brief(plan={}){
    const story=plan.story||{},pack=plan.evidencePack||{},facts=pack.facts||[];
    return{
      title:clean(plan.title,120)||"未命名汇报",
      audience:clean(plan.audience,100)||"项目决策与审查人员",
      purpose:clean(plan.purpose,160)||"形成清晰、可信、可行动的项目汇报",
      communicationJob:clean(story.communicationJob,180)||"让听众快速理解项目判断、依据与下一步行动",
      centralTakeaway:clean(story.centralTakeaway,220)||clean(facts[0]&&facts[0].text,220)||"围绕核心问题形成可核验的决策结论",
      constraints:["结论先行","关键数字可追溯","每页只承担一个沟通任务","优先使用项目真实图片和图表"],
      sourceCount:Number((pack.summary&&pack.summary.assetCount)||((pack.assets||[]).length)||0),
      generatedAt:Date.now()
    };
  }
  function inferLayout(title,index,total){
    const t=clean(title,120);if(index===0)return"cover";if(index===1&&/目录|结构|议程/.test(t))return"agenda";
    if(index===total-1&&/结论|建议|行动|下一步/.test(t))return"conclusion";
    if(/趋势|变化|增幅|历年/.test(t))return"chart-line";if(/对比|比较|方案/.test(t))return"comparison";
    if(/指标|数据|关键数字/.test(t))return"metric";if(/计划|路径|阶段|进度/.test(t))return"timeline";
    if(/风险|问题|挑战/.test(t))return"risk";return"bullets";
  }
  function outline(plan={}){
    const slides=Array.isArray(plan.slides)?plan.slides:[],total=Math.max(5,Number(plan.slideCount)||slides.length||8);
    if(slides.length)return slides.map((s,i)=>({id:s.id||uid("ol_"),order:i+1,title:clean(s.title,120)||"第"+(i+1)+"页",role:clean(s.pageRole||s.type,30)||"analysis",layoutId:clean(s.layoutId,40)||inferLayout(s.title,i,slides.length),claim:clean(s.claim||s.takeaway||(s.bullets||[])[0],220),locked:!!s.locked}));
    const names=["封面","汇报结构","项目概况与核心判断","关键数据与指标","主要问题与原因","方案比较与选择","实施路径与里程碑","结论、建议与下一步"];
    return Array.from({length:total},(_,i)=>({id:uid("ol_"),order:i+1,title:names[i]||("补充分析 "+(i+1)),role:i===0?"cover":i===1?"agenda":i===total-1?"conclusion":"analysis",layoutId:inferLayout(names[i]||"",i,total),claim:"",locked:false}));
  }
  function normalizeOutline(rows){return (rows||[]).map((r,i)=>({id:clean(r.id,80)||uid("ol_"),order:i+1,title:clean(r.title,120)||"第"+(i+1)+"页",role:clean(r.role,30)||"analysis",layoutId:clean(r.layoutId,40)||inferLayout(r.title,i,(rows||[]).length),claim:clean(r.claim,220),locked:!!r.locked}));}
  function applyOutline(plan={},rows=[]){
    const out=clone(plan),list=normalizeOutline(rows),old=new Map((out.slides||[]).map((s,i)=>[s.id||"@"+i,s]));
    out.slides=list.map((r,i)=>{const prev=old.get(r.id)||out.slides&&out.slides[i]||{};return{...prev,id:r.id,order:i+1,type:r.layoutId==="cover"?"cover":r.layoutId==="agenda"?"agenda":r.layoutId==="conclusion"?"conclusion":"content",title:r.title,layoutId:r.layoutId,pageRole:r.role,claim:r.claim||prev.claim||"",bullets:Array.isArray(prev.bullets)?prev.bullets:[],content:prev.content||{},sources:Array.isArray(prev.sources)?prev.sources:[],locked:r.locked};});
    out.outline=list;out.workflow={...(out.workflow||{}),stage:"design",outlineConfirmedAt:Date.now(),outlineRevision:Number(out.workflow&&out.workflow.outlineRevision||0)+1};out.updatedAt=Date.now();return out;
  }
  function move(rows,index,delta){const out=normalizeOutline(rows),to=Math.max(0,Math.min(out.length-1,index+delta));if(to===index)return out;const [v]=out.splice(index,1);out.splice(to,0,v);return normalizeOutline(out);}
  function split(rows,index){const out=normalizeOutline(rows),r=out[index];if(!r)return out;const second={...r,id:uid("ol_"),title:r.title+"（续）",claim:"",locked:false};out.splice(index+1,0,second);return normalizeOutline(out);}
  function merge(rows,index){const out=normalizeOutline(rows);if(index<0||index>=out.length-1)return out;out[index]={...out[index],title:clean(out[index].title+" / "+out[index+1].title,120),claim:clean([out[index].claim,out[index+1].claim].filter(Boolean).join("；"),220)};out.splice(index+1,1);return normalizeOutline(out);}
  function snapshot(plan,label){const out=clone(plan),history=Array.isArray(out.workflow&&out.workflow.history)?out.workflow.history.slice(-19):[];history.push({id:uid("snap_"),label:clean(label,80)||"修改前快照",at:Date.now(),slides:clone(out.slides||[]),outline:clone(out.outline||[])});out.workflow={...(out.workflow||{}),history};return out;}
  function undo(plan){const out=clone(plan),history=(out.workflow&&out.workflow.history)||[];if(!history.length)return out;const snap=history[history.length-1];out.slides=clone(snap.slides);out.outline=clone(snap.outline);out.workflow={...out.workflow,history:history.slice(0,-1),lastUndoAt:Date.now()};return out;}
  const api={STAGES,stageOf,buildBrief:brief,buildOutline:outline,normalizeOutline,applyOutline,move,split,merge,snapshot,undo,inferLayout};
  root.PptAgentPipeline=api;if(root.document)root.document.documentElement.dataset.pptAgentPipelineExec="yes";if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
