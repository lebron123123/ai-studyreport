/* ============================================================
   agent-pet.js —— 蓝喵 / 安小居双形态全站宠物动作层
   依赖：agent-widget.js 已创建 #awBtn / #awPanel
   职责：自主动作、全屏漫游、场景话术、宠物模式开关。
   不负责：AI问答、业务导航、表单操作和任何数据写入。
   ============================================================ */
(function(root){
  "use strict";
  const btn=document.getElementById("awBtn"),panel=document.getElementById("awPanel");
  if(!btn||!panel)return;

  const PET_KEY="studyreport:agent-pet-enabled:v1";
  const PET_FORM_KEY="studyreport:agent-pet-form:v1";
  const PET_RENDER_MODE_KEY="studyreport:agent-pet-render-mode:v1";
  const CLASSIC_CONTROLS_EXPOSED=false;
  const reduced=matchMedia("(prefers-reduced-motion: reduce)");
  const VIDEO_MANIFEST=root.AgentPetVideoManifest||null;
  const ACTIONS=[
    {key:"idle",label:"观察中",duration:1400},
    {key:"walk",label:"散步",duration:2600,move:true},
    {key:"run",label:"跑动",duration:1800,move:true},
    {key:"jump",label:"跳跃",duration:1100},
    {key:"vault",label:"跨越",duration:1500,move:true},
    {key:"play",label:"玩耍",duration:1700},
    {key:"sleep",label:"打个盹",duration:3000},
    {key:"rest",label:"歇一会",duration:1500},
    {key:"snack",label:"吃零食",duration:1900},
    {key:"stretch",label:"伸懒腰",duration:1400},
    {key:"roll",label:"打滚",duration:1300},
    {key:"wave",label:"挥爪",duration:1300},
    {key:"peek",label:"探头",duration:1400},
    {key:"chase",label:"追光点",duration:2200,move:true},
    {key:"pounce",label:"扑跃",duration:1500,move:true},
    {key:"dance",label:"开心舞",duration:1800},
    {key:"groom",label:"舔毛",duration:1900},
    {key:"listen",label:"竖耳倾听",duration:1500},
    {key:"headTilt",label:"好奇歪头",duration:1500},
    {key:"sniff",label:"低头嗅闻",duration:1700},
    {key:"scratch",label:"挠挠耳朵",duration:1800},
    {key:"knead",label:"踩踩小垫",duration:2000},
    {key:"tailChase",label:"追自己尾巴",duration:1900},
    {key:"drink",label:"喝口水",duration:2000},
    {key:"boxPeek",label:"纸箱探头",duration:2200},
    {key:"inspect",label:"看看文件",duration:1900},
    {key:"press",label:"按下按钮",duration:1600},
    {key:"highFive",label:"击个掌",duration:1500},
    {key:"point",label:"给你指路",duration:1700},
    {key:"carry",label:"搬运文件",duration:1900},
    {key:"celebrate",label:"庆祝一下",duration:1800},
    {key:"startled",label:"吓一小跳",duration:1400}
  ];
  const PHRASES=[
    "需要帮助吗？我可以帮你解决网站使用问题。",
    "不知道下一步点哪里？问我就好。",
    "需要我带你去相关功能吗？",
    "想生成可研？我可以带你进入AI可研。",
    "想看项目收益？可以去财务测算。",
    "需要审查报告吗？我能带你去智能审查。",
    "当前页面看不懂？我可以给你讲一遍。",
    "有报错别着急，把提示发给我看看。",
    "想找政策和规则？我可以帮你检索知识库。",
    "需要写PPT？AI PPT入口我知道在哪里。",
    "想整理个人资料？可以进入个人知识库。",
    "人口、职住和需求分析，可以去项目数据分析。",
    "测算结果看不明白？可以直接问我指标含义。",
    "要返回首页看看全部功能吗？",
    "我不会替你提交数据，重要操作会等你确认。",
    "材料不齐也可以先问我需要补什么。",
    "想继续上次的工作？告诉我项目名称试试。",
    "如果我挡住了，可以拖动我，或点‘活动’让我休息。",
    "喵～我在这里，随时可以帮忙。",
    "工作辛苦啦，需要我帮你找个入口吗？"
  ];
  const style=document.createElement("style");
  style.textContent=`
    #awBtn.pet-moving{transition:left var(--pet-duration,4s) var(--pet-easing,linear),top var(--pet-duration,4s) var(--pet-easing,linear),filter .18s ease;pointer-events:auto!important;cursor:pointer!important}
    #awBtn.pet-paused{transition:none!important}
    #awBtn .aw-cat-head,#awBtn .aw-cat-body,#awBtn .aw-cat-tail,#awBtn .aw-cat-paw{transform-box:fill-box;transform-origin:center}
    #awBtn .aw-cat-snack,#awBtn .aw-cat-toy,#awBtn .aw-cat-zzz{display:none}
    #awBtn .aw-pet-stage{display:none;position:relative;width:126px;height:110px;flex:0 0 110px;margin-bottom:7px;pointer-events:none;transform-origin:50% 82%}
    #awBtn .aw-cat-action-video{display:none;position:absolute;inset:0;width:126px;height:110px;object-fit:contain;filter:drop-shadow(0 8px 6px rgba(31,76,111,.23));opacity:0;pointer-events:none;will-change:opacity}
    #awBtn .aw-cat-action-source{display:none!important}
    #awBtn .aw-kitten-sprite{display:none;position:absolute;left:12px;top:4px;width:102px;height:102px;filter:contrast(1.08) saturate(1.06) drop-shadow(0 7px 5px rgba(31,76,111,.22));transform-origin:50% 82%;pointer-events:none}
    #awBtn .aw-kitten-frame{position:absolute;inset:0;background:url("assets/blue-kitten-sprite-v1.png") 0 0/408px 408px no-repeat;image-rendering:auto;opacity:0;transition:opacity .11s linear,transform .11s ease-out;will-change:opacity,transform}
    #awBtn .aw-kitten-frame.is-active{opacity:1}
    #awBtn .aw-anju-sprite{display:none;position:absolute;left:0;bottom:5px;width:126px;height:84px;filter:contrast(1.06) saturate(1.08) drop-shadow(0 8px 6px rgba(24,91,140,.24));transform-origin:50% 82%;pointer-events:none}
    #awBtn .aw-anju-frame{position:absolute;inset:0;background:url("assets/anju-mascot-sprite-v2.png") 0 0/504px 336px no-repeat;image-rendering:auto;opacity:0;transition:opacity .13s linear,transform .13s ease-out;will-change:opacity,transform}
    #awBtn .aw-anju-frame.is-active{opacity:1}
    #awBtn.pet-raster-ready .aw-pet-stage,#awBtn.pet-anju-ready .aw-pet-stage{display:block}
    #awBtn.pet-raster-ready.pet-form-cat .aw-kitten-sprite,#awBtn.pet-morphing.pet-raster-ready .aw-kitten-sprite{display:block}
    #awBtn.pet-anju-ready.pet-form-anju .aw-anju-sprite,#awBtn.pet-morphing.pet-anju-ready .aw-anju-sprite{display:block}
    #awBtn.pet-raster-ready .aw-cat,#awBtn.pet-anju-ready .aw-cat{display:none}
    #awBtn.pet-raster-ready.pet-facing-left .aw-kitten-sprite{scale:-1 1}
    #awBtn.pet-anju-ready.pet-facing-left .aw-anju-sprite{scale:-1 1}
    #awBtn.pet-action-video-active .aw-cat-action-video{display:block;opacity:1}
    #awBtn.pet-action-video-active .aw-kitten-sprite,#awBtn.pet-action-video-active .aw-anju-sprite{display:none!important}
    #awBtn.pet-video-only .aw-kitten-sprite,#awBtn.pet-video-only .aw-anju-sprite{display:none!important}
    #awBtn.pet-video-only.pet-video-fallback.pet-form-cat .aw-kitten-sprite{display:block!important}
    #awBtn.pet-video-only.pet-video-fallback.pet-form-anju .aw-anju-sprite{display:block!important}
    #awBtn.pet-morphing .aw-pet-stage{animation:petMorphGlow 1.65s ease-in-out both}
    #awBtn.pet-raster-ready[data-pet-action="run"] .aw-kitten-sprite{animation:petRasterRun .82s ease-in-out infinite}
    #awBtn.pet-raster-ready[data-pet-action="jump"] .aw-kitten-sprite{animation:petRasterJump 1.35s cubic-bezier(.2,.75,.25,1) 2}
    #awBtn.pet-raster-ready[data-pet-action="play"] .aw-kitten-sprite,#awBtn.pet-raster-ready[data-pet-action="chase"] .aw-kitten-sprite,#awBtn.pet-raster-ready[data-pet-action="pounce"] .aw-kitten-sprite{animation:petRasterPounce 1.25s ease-in-out infinite}
    #awBtn.pet-raster-ready[data-pet-action="sleep"] .aw-kitten-sprite{animation:petRasterBreathe 2.8s ease-in-out infinite}
    #awBtn.pet-form-anju[data-pet-action="idle"] .aw-anju-sprite{animation:anjuIdle 3.2s ease-in-out infinite}
    #awBtn.pet-form-anju[data-pet-action="walk"] .aw-anju-sprite{animation:anjuWalk 1.15s ease-in-out infinite}
    #awBtn.pet-form-anju[data-pet-action="run"] .aw-anju-sprite{animation:anjuRun .78s ease-in-out infinite}
    #awBtn.pet-form-anju[data-pet-action="jump"] .aw-anju-sprite{animation:anjuJump 1.45s cubic-bezier(.2,.75,.25,1) 2}
    #awBtn[data-pet-action="vault"] .aw-pet-stage:after{content:"";display:block;position:absolute;right:5px;bottom:9px;width:27px;height:9px;border:2px solid rgba(22,126,190,.72);border-radius:7px;background:linear-gradient(90deg,#087ec8,#59c6dd);box-shadow:0 3px 5px rgba(17,88,139,.18);animation:petVaultObstacle 1.5s ease-in-out both}
    #awBtn.pet-raster-ready[data-pet-action="vault"] .aw-kitten-sprite{animation:petRasterJump 1.35s cubic-bezier(.2,.75,.25,1) 2}
    #awBtn.pet-form-anju[data-pet-action="vault"] .aw-anju-sprite{animation:anjuVault 1.5s cubic-bezier(.18,.72,.25,1) both}
    #awBtn.pet-form-anju[data-pet-action="sleep"] .aw-anju-sprite{animation:anjuSleep 3.5s ease-in-out infinite}
    #awBtn.pet-form-anju[data-pet-action="think"] .aw-anju-sprite,#awBtn.pet-form-anju[data-pet-action="listen"] .aw-anju-sprite{animation:anjuThink 2.2s ease-in-out infinite}
    #awBtn.pet-form-anju[data-pet-action="celebrate"] .aw-anju-sprite,#awBtn.pet-form-anju[data-pet-action="dance"] .aw-anju-sprite{animation:anjuCelebrate 1.05s ease-in-out infinite}
    #awBtn.pet-near-left .aw-nudge{left:66px;right:auto;border-radius:10px 10px 10px 2px}
    .aw-pet-hover-tools{position:fixed;z-index:903;display:flex;align-items:center;gap:5px;padding:4px;border:1px solid rgba(171,205,229,.92);border-radius:999px;background:rgba(255,255,255,.97);box-shadow:0 8px 22px rgba(26,83,126,.18);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(5px) scale(.97);transition:opacity .16s ease,transform .16s ease,visibility .16s;white-space:nowrap;backdrop-filter:blur(8px)}
    .aw-pet-hover-tools.is-visible,.aw-pet-hover-tools:focus-within{opacity:1;visibility:visible;pointer-events:auto;transform:none}
    .aw-pet-hover-tools a{display:inline-flex;align-items:center;justify-content:center;min-height:25px;padding:2px 8px;border-radius:999px;color:#245f8d;font-size:10.5px;font-weight:650;line-height:1;text-decoration:none;outline:none;transition:background .14s ease,color .14s ease}
    .aw-pet-hover-tools a[hidden]{display:none!important}
    .aw-pet-hover-tools a:hover,.aw-pet-hover-tools a:focus-visible{background:#e8f4fb;color:#087ec8}
    .aw-pet-action-menu{position:absolute;left:calc(100% + 7px);top:0;display:none;grid-template-columns:repeat(2,max-content);gap:4px;padding:6px;border:1px solid rgba(171,205,229,.92);border-radius:12px;background:rgba(255,255,255,.98);box-shadow:0 8px 22px rgba(26,83,126,.18);pointer-events:auto}
    .aw-pet-action-menu.is-visible{display:grid}
    .aw-pet-action-menu button{min-height:25px;padding:3px 9px;border:0;border-radius:8px;background:#f3f8fc;color:#245f8d;font-size:10.5px;font-weight:650;line-height:1;cursor:pointer;white-space:nowrap}
    .aw-pet-action-menu button:hover,.aw-pet-action-menu button:focus-visible{background:#dceefa;color:#087ec8;outline:none}
    #awBtn[data-pet-action="idle"] .aw-cat{animation:petIdle 2.2s ease-in-out infinite}
    #awBtn[data-pet-action="idle"] .aw-cat-tail{animation:petTail 1.8s ease-in-out infinite}
    #awBtn[data-pet-action="walk"] .aw-cat-body{animation:petWalkBody .48s ease-in-out infinite}
    #awBtn[data-pet-action="walk"] .aw-cat-head{animation:petWalkHead .48s ease-in-out infinite reverse}
    #awBtn[data-pet-action="walk"] .aw-cat-paw-left{animation:petStep .48s ease-in-out infinite}
    #awBtn[data-pet-action="walk"] .aw-cat-paw-right{animation:petStep .48s ease-in-out infinite reverse}
    #awBtn[data-pet-action="walk"] .aw-cat-tail{animation:petRunTail .72s ease-in-out infinite}
    #awBtn[data-pet-action="run"] .aw-cat-body{animation:petRunBody .28s ease-in-out infinite}
    #awBtn[data-pet-action="run"] .aw-cat-head{animation:petRunHead .28s ease-in-out infinite}
    #awBtn[data-pet-action="run"] .aw-cat-paw-left{animation:petSprint .28s ease-in-out infinite}
    #awBtn[data-pet-action="run"] .aw-cat-paw-right{animation:petSprint .28s ease-in-out infinite reverse}
    #awBtn[data-pet-action="run"] .aw-cat-tail{animation:petRunTail .34s ease-in-out infinite}
    #awBtn[data-pet-action="jump"] .aw-cat{animation:petJump .85s cubic-bezier(.2,.7,.3,1) 2}
    #awBtn[data-pet-action="play"] .aw-cat{animation:petPlay .7s ease-in-out 4}
    #awBtn[data-pet-action="play"] .aw-cat-toy,#awBtn[data-pet-action="chase"] .aw-cat-toy{display:block;animation:petToy .7s ease-in-out infinite}
    #awBtn[data-pet-action="sleep"] .aw-cat{animation:petSleep 3s ease-in-out infinite;transform-origin:50% 80%}
    #awBtn[data-pet-action="sleep"] .aw-cat-tail{animation:petSleepTail 3s ease-in-out infinite}
    #awBtn[data-pet-action="sleep"] .aw-cat-zzz{display:block;animation:petZzz 2.2s ease-in-out infinite}
    #awBtn[data-pet-action="sleep"] .aw-eye{transform:scaleY(.12)!important;transform-origin:center}
    #awBtn[data-pet-action="rest"] .aw-cat{animation:petRest 2.4s ease-in-out infinite}
    #awBtn[data-pet-action="snack"] .aw-cat-head{animation:petSnack .4s ease-in-out 8}
    #awBtn[data-pet-action="snack"] .aw-cat-snack{display:block;animation:petSnackBite .8s ease-in-out 4}
    #awBtn[data-pet-action="stretch"] .aw-cat{animation:petStretch 1.25s ease-in-out 2;transform-origin:50% 85%}
    #awBtn[data-pet-action="roll"] .aw-cat{animation:petRoll 1.15s ease-in-out 2}
    #awBtn[data-pet-action="wave"] .aw-cat-paw-left{animation:petWave .42s ease-in-out 6;transform-origin:24px 52px}
    #awBtn[data-pet-action="peek"] .aw-cat{animation:petPeek 1.3s ease-in-out 2}
    #awBtn[data-pet-action="chase"] .aw-cat{animation:petChase .36s ease-in-out infinite}
    #awBtn[data-pet-action="dance"] .aw-cat{animation:petDance .55s ease-in-out 6}
    #awBtn[data-pet-action="groom"] .aw-cat-paw-right{animation:petGroom .55s ease-in-out 6;transform-origin:48px 52px}
    #awBtn.pet-facing-left .aw-cat{scale:-1 1}
    #awBtn .aw-nudge.pet-talk{animation:petTalk 7s ease both}
    #awBtn .aw-name{transition:.2s}
    #awBtn.pet-disabled .aw-name{color:#718596;background:#F3F6F8}
    @keyframes petIdle{50%{transform:translateY(-3px) rotate(1deg)}}
    @keyframes petTail{50%{transform:rotate(18deg)}}
    @keyframes petWalkBody{50%{transform:translateY(-3px) rotate(-1deg)}}
    @keyframes petWalkHead{50%{transform:translateY(-1px) rotate(2deg)}}
    @keyframes petStep{0%,100%{transform:rotate(14deg) translateY(-1px)}50%{transform:rotate(-18deg) translateY(2px)}}
    @keyframes petRunBody{0%,100%{transform:translateY(1px) rotate(-6deg) scaleX(1.05)}50%{transform:translateY(-7px) rotate(4deg) scaleX(.96)}}
    @keyframes petRunHead{50%{transform:translate(2px,-4px) rotate(3deg)}}
    @keyframes petSprint{0%,100%{transform:rotate(34deg) scaleY(.85)}50%{transform:rotate(-38deg) scaleY(1.12)}}
    @keyframes petRunTail{0%,100%{transform:rotate(-16deg)}50%{transform:rotate(24deg)}}
    @keyframes petJump{0%,100%{transform:translateY(0)}50%{transform:translateY(-42px) rotate(-5deg)}}
    @keyframes petPlay{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(9deg) translateY(-5px)}}
    @keyframes petSleep{0%,100%{transform:scaleY(.72) rotate(-8deg)}50%{transform:scaleY(.68) rotate(-8deg) translateY(2px)}}
    @keyframes petSleepTail{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(2deg)}}
    @keyframes petZzz{0%,100%{opacity:0;transform:translate(0,5px) scale(.7)}45%{opacity:1}80%{opacity:0;transform:translate(6px,-7px) scale(1.2)}}
    @keyframes petRest{50%{transform:scaleY(.9) translateY(3px)}}
    @keyframes petSnack{50%{transform:translateY(2px) scale(1.025)}}
    @keyframes petSnackBite{0%,100%{transform:translate(0,0) rotate(0)}50%{transform:translate(-8px,-9px) rotate(-12deg)}}
    @keyframes petStretch{50%{transform:scaleX(1.24) scaleY(.72) translateY(7px)}}
    @keyframes petRoll{50%{transform:rotate(180deg) scale(.9)}100%{transform:rotate(360deg)}}
    @keyframes petWave{50%{transform:rotate(55deg) translateY(-9px)}}
    @keyframes petPeek{0%,100%{transform:translateX(0)}50%{transform:translateX(18px) rotate(8deg)}}
    @keyframes petChase{50%{transform:translateY(-7px) rotate(-5deg)}}
    @keyframes petDance{0%,100%{transform:translateX(-7px) rotate(-7deg)}50%{transform:translateX(7px) rotate(7deg) translateY(-5px)}}
    @keyframes petGroom{50%{transform:rotate(-62deg) translate(-7px,-10px)}}
    @keyframes petToy{0%,100%{transform:translate(0,0) rotate(0)}50%{transform:translate(-30px,-9px) rotate(180deg)}}
    @keyframes petTalk{0%,100%{opacity:0;transform:translateX(8px)}8%,82%{opacity:1;transform:none}}
    @keyframes petRasterRun{50%{transform:translateY(-5px) rotate(-3deg) scaleX(1.04)}}
    @keyframes petRasterJump{50%{transform:translateY(-34px) rotate(-5deg)}}
    @keyframes petRasterPounce{50%{transform:translateY(-9px) rotate(4deg)}}
    @keyframes petRasterBreathe{50%{transform:scale(.97,.94) translateY(3px)}}
    @keyframes anjuIdle{0%,100%{transform:translateY(0) rotate(-.4deg)}50%{transform:translateY(-3px) rotate(.7deg)}}
    @keyframes anjuWalk{0%,100%{transform:translateY(1px) rotate(-2deg)}50%{transform:translateY(-4px) rotate(2deg)}}
    @keyframes anjuRun{0%,100%{transform:translateY(2px) rotate(-4deg) scaleX(1.03)}50%{transform:translateY(-7px) rotate(4deg) scaleX(.98)}}
    @keyframes anjuJump{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-38px) rotate(-4deg) scale(1.035)}}
    @keyframes anjuVault{0%,100%{transform:translate(0,0) rotate(0)}45%{transform:translate(23px,-36px) rotate(5deg) scale(1.025)}75%{transform:translate(33px,-8px) rotate(-2deg)}}
    @keyframes petVaultObstacle{0%,100%{opacity:.9;transform:translateX(0)}45%{opacity:1}75%{opacity:.55;transform:translateX(-15px)}}
    @keyframes anjuSleep{0%,100%{transform:translateY(5px) scale(1,.94)}50%{transform:translateY(7px) scale(.99,.9)}}
    @keyframes anjuThink{0%,100%{transform:rotate(-1deg)}50%{transform:translateY(-2px) rotate(3deg)}}
    @keyframes anjuCelebrate{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-9px) rotate(4deg) scale(1.035)}}
    @keyframes petMorphGlow{0%,100%{filter:none}35%{filter:drop-shadow(0 0 5px rgba(48,184,229,.7))}55%{filter:drop-shadow(0 0 13px rgba(34,146,211,.95)) brightness(1.18)}75%{filter:drop-shadow(0 0 7px rgba(93,205,234,.72))}}
    @media(prefers-reduced-motion:reduce){#awBtn[data-pet-action] .aw-cat,#awBtn[data-pet-action] .aw-cat-paw{animation:none!important}}
  `;
  document.head.appendChild(style);

  let enabled=(()=>{try{return localStorage.getItem(PET_KEY)!=="0";}catch(_){return true;}})();
  let form=(()=>{try{return localStorage.getItem(PET_FORM_KEY)==="cat"?"cat":"anju";}catch(_){return "anju";}})();
  // 经典帧完整封存在下方代码中；当前产品界面固定启用即梦视频素材。
  let renderMode="video";
  let classicForm=form;
  let busy=false,hovered=false,timer=null,spriteRaf=null,morphTimer=null,morphRaf=null,hoverTimer=null,lastPhrase=-1,current="idle",quietUntil=0;
  let videoRaf=null,videoLast=0,videoToken=0,videoSegmentResolve=null,videoFirstFrameResolve=null,videoReadyClipKey="",videoFacingReady=Promise.resolve(),videoPose=form==="anju"?"H1":"H0",videoFacingLeft=false,videoClipKey="",videoBlendFrame=null,videoBlendClipKey="",videoBlendStarted=0,videoBlendDuration=240,videoBlendCount=0;
  let actionDeck=[],videoActionDeck=[],actionCycleNo=0,movementToken=0,perimeterCursor=-1,perimeterDirection=Math.random()<.5?-1:1;
  let gazeDirection="",gazeEngaged=false,gazeRequestToken=0,gazeTimer=null,gazeDwellTimer=null,gazeCooldownUntil=0,gazePointer={x:-9999,y:-9999,distance:Infinity},dragToolsRaf=null;
  let nextRoamAt=Date.now()+20000+Math.random()*8000;
  function videoManifestFor(targetForm){return VIDEO_MANIFEST?.forms?.[targetForm]||VIDEO_MANIFEST;}
  function activeVideoManifest(){return videoManifestFor(form);}
  const name=btn.querySelector(".aw-name"),bubble=btn.querySelector(".aw-nudge"),toggle=document.getElementById("awPetToggle");
  const headTitle=document.querySelector("#awHead .aw-head-title b"),headMark=document.querySelector("#awHead .aw-head-title>span");
  const renderModeToggle=document.createElement("a");renderModeToggle.href="javascript:void(0)";renderModeToggle.id="awPetRenderMode";
  const morphToggle=document.createElement("a");morphToggle.href="javascript:void(0)";morphToggle.id="awMorphToggle";morphToggle.title="在蓝喵和安小居之间切换";morphToggle.textContent="⇄ 变身";
  const hoverTools=document.createElement("div");hoverTools.className="aw-pet-hover-tools";hoverTools.setAttribute("aria-label","宠物快捷控制");
  const actionMenu=document.createElement("div");actionMenu.className="aw-pet-action-menu";actionMenu.setAttribute("aria-label","当前宠物可执行动作");
  if(CLASSIC_CONTROLS_EXPOSED)hoverTools.appendChild(renderModeToggle);hoverTools.appendChild(morphToggle);if(toggle)hoverTools.appendChild(toggle);hoverTools.appendChild(actionMenu);document.body.appendChild(hoverTools);
  const stage=document.createElement("span");stage.className="aw-pet-stage";stage.setAttribute("aria-hidden","true");
  const actionCanvas=document.createElement("canvas");actionCanvas.className="aw-cat-action-video";actionCanvas.width=228;actionCanvas.height=200;actionCanvas.setAttribute("aria-hidden","true");
  const actionVideo=document.createElement("video");actionVideo.className="aw-cat-action-source";actionVideo.muted=true;actionVideo.playsInline=true;actionVideo.preload="auto";actionVideo.setAttribute("aria-hidden","true");
  const sprite=document.createElement("span");
  sprite.className="aw-kitten-sprite";sprite.setAttribute("aria-hidden","true");
  sprite.innerHTML='<i class="aw-kitten-frame is-active"></i><i class="aw-kitten-frame"></i>';
  const anjuSprite=document.createElement("span");
  anjuSprite.className="aw-anju-sprite";anjuSprite.setAttribute("aria-hidden","true");
  anjuSprite.innerHTML='<i class="aw-anju-frame is-active"></i><i class="aw-anju-frame"></i>';
  stage.appendChild(actionCanvas);stage.appendChild(actionVideo);stage.appendChild(sprite);stage.appendChild(anjuSprite);
  const avatar=btn.querySelector(".aw-avatar");if(avatar)btn.insertBefore(stage,avatar);else btn.insertBefore(stage,name||btn.firstChild);
  const spriteImage=new Image();
  spriteImage.onload=()=>btn.classList.add("pet-raster-ready");
  spriteImage.src="assets/blue-kitten-sprite-v1.png";
  const anjuImage=new Image();
  anjuImage.onload=()=>btn.classList.add("pet-anju-ready");
  anjuImage.src="assets/anju-mascot-sprite-v2.png";
  const actionContext=actionCanvas.getContext("2d",{willReadFrequently:true});
  function stopActionVideo(keepFrame){
    videoToken+=1;if(!keepFrame)btn.classList.remove("pet-action-video-active");
    if(videoRaf){cancelAnimationFrame(videoRaf);videoRaf=null;}
    actionVideo.pause();videoLast=0;videoClipKey="";videoReadyClipKey="";videoBlendFrame=null;videoBlendClipKey="";videoBlendStarted=0;videoBlendDuration=240;
    if(videoSegmentResolve){const done=videoSegmentResolve;videoSegmentResolve=null;done(false,"stopped");}
    if(videoFirstFrameResolve){const ready=videoFirstFrameResolve;videoFirstFrameResolve=null;ready(false);}
    if(keepFrame&&!btn.classList.contains("pet-action-video-active"))btn.classList.add("pet-video-fallback");
  }
  function renderActionVideo(ts,clip,token){
    if(token!==videoToken||renderMode!=="video"||reduced.matches||document.hidden)return;
    const end=Math.max(clip.trimStart+.05,actionVideo.duration-clip.trimEnd);
    if(actionVideo.currentTime>=end){actionVideo.pause();videoRaf=null;if(videoSegmentResolve){const done=videoSegmentResolve;videoSegmentResolve=null;done(true,"trim-end");}return;}
    if(!videoLast||ts-videoLast>=32){
      videoLast=ts;actionContext.clearRect(0,0,actionCanvas.width,actionCanvas.height);
      const side=Math.min(actionCanvas.width,actionCanvas.height),left=(actionCanvas.width-side)/2;
      const mirrorFrame=clip.mirror===true||(clip.mirror!==false&&videoFacingLeft);
      actionContext.save();
      if(mirrorFrame){actionContext.translate(actionCanvas.width,0);actionContext.scale(-1,1);}
      actionContext.drawImage(actionVideo,0,0,actionVideo.videoWidth,actionVideo.videoHeight,left,0,side,side);
      actionContext.restore();
      const frame=actionContext.getImageData(0,0,actionCanvas.width,actionCanvas.height),pixels=frame.data;
      // 右看复用左看素材时只镜像双眼ROI，并在边缘羽化；不能翻转尾巴、身体或留下矩形补丁。
      if(clip.eyeMirror){
        const original=pixels.slice();
        for(const q of clip.eyeMirror.boxes||[]){
          const x0=Math.max(0,Math.round(left+side*q.x)),y0=Math.max(0,Math.round(side*q.y));
          const w=Math.min(actionCanvas.width-x0,Math.round(side*q.w)),h=Math.min(actionCanvas.height-y0,Math.round(side*q.h)),feather=Math.max(3,Math.round(Math.min(w,h)*.16));
          for(let y=0;y<h;y++)for(let x=0;x<w;x++){
            const edge=Math.min(x,w-1-x,y,h-1-y),mix=Math.max(0,Math.min(1,edge/feather)),di=((y0+y)*actionCanvas.width+x0+x)*4,si=((y0+y)*actionCanvas.width+x0+w-1-x)*4;
            for(let c=0;c<4;c++)pixels[di+c]=Math.round(original[di+c]*(1-mix)+original[si+c]*mix);
          }
        }
      }
      for(let i=0;i<pixels.length;i+=4){
        const r=pixels[i],g=pixels[i+1],b=pixels[i+2],dominance=g-Math.max(r,b);
        if(g>82&&dominance>16){const key=Math.max(0,Math.min(1,(dominance-16)/54));pixels[i+3]=Math.round(255*(1-key));if(pixels[i+3]>0)pixels[i+1]=Math.min(g,Math.max(r,b)+12);}
      }
      if(videoBlendFrame&&videoBlendClipKey===videoClipKey){
        if(!videoBlendStarted)videoBlendStarted=ts;
        const mix=Math.min(1,(ts-videoBlendStarted)/videoBlendDuration),old=videoBlendFrame.data;
        for(let i=0;i<pixels.length;i+=4){pixels[i]=Math.round(old[i]*(1-mix)+pixels[i]*mix);pixels[i+1]=Math.round(old[i+1]*(1-mix)+pixels[i+1]*mix);pixels[i+2]=Math.round(old[i+2]*(1-mix)+pixels[i+2]*mix);pixels[i+3]=Math.round(old[i+3]*(1-mix)+pixels[i+3]*mix);}
        btn.dataset.petVideoBlend=mix<1?"active":"complete";
        if(mix>=1){videoBlendFrame=null;videoBlendClipKey="";videoBlendStarted=0;}
      }
      actionContext.putImageData(frame,0,0);btn.classList.add("pet-action-video-active");btn.classList.remove("pet-video-fallback");btn.dataset.petVideoClip=videoClipKey;
      if(videoFirstFrameResolve&&videoClipKey===videoReadyClipKey){const ready=videoFirstFrameResolve;videoFirstFrameResolve=null;ready(true);}
    }
    videoRaf=requestAnimationFrame(next=>renderActionVideo(next,clip,token));
  }
  function playClip(clipKey,token,manifestOverride){
    const clip=(manifestOverride||activeVideoManifest())?.clips?.[clipKey];if(!clip)return Promise.resolve(false);
    // 旧帧与新帧叠加会制造双猫虚影；默认保留旧画面，待新片首帧就绪后直接切换。
    const requestedBlend=Number.isFinite(clip.blendDuration)?clip.blendDuration:0;
    if(btn.classList.contains("pet-action-video-active")&&requestedBlend>0){
      try{videoBlendDuration=requestedBlend;videoBlendFrame=actionContext.getImageData(0,0,actionCanvas.width,actionCanvas.height);videoBlendClipKey=clipKey;videoBlendStarted=0;btn.dataset.petVideoBoundary=(btn.dataset.petVideoClip||"frame")+">"+clipKey;btn.dataset.petVideoBlendCount=String(++videoBlendCount);btn.dataset.petVideoBlendPolicy="crossfade";}catch(_){videoBlendFrame=null;videoBlendClipKey="";}
    }else{
      videoBlendFrame=null;videoBlendClipKey="";videoBlendStarted=0;btn.dataset.petVideoBoundary=(btn.dataset.petVideoClip||"frame")+">"+clipKey;btn.dataset.petVideoBlend="cut";btn.dataset.petVideoBlendPolicy="motion-match-cut";
    }
    videoClipKey=clipKey;videoLast=0;if(videoRaf){cancelAnimationFrame(videoRaf);videoRaf=null;}
    return new Promise(resolve=>{
      let settled=false;const watchdog=setTimeout(()=>finish(false,"watchdog"),6000);
      const finish=(ok,reason)=>{if(settled)return;settled=true;clearTimeout(watchdog);if(videoSegmentResolve===finish)videoSegmentResolve=null;actionVideo.onended=null;if(!ok&&reason!=="stopped")btn.dataset.petVideoFailure=clipKey+":"+reason;resolve(ok);};
      videoSegmentResolve=finish;actionVideo.pause();
      actionVideo.onloadedmetadata=()=>{if(token!==videoToken)return finish(false,"metadata-token");const start=Math.min(clip.trimStart,Math.max(0,actionVideo.duration-clip.trimEnd-.05));actionVideo.currentTime=start;};
      actionVideo.onseeked=()=>{if(token!==videoToken)return finish(false,"seek-token");Promise.resolve(videoFacingReady).then(()=>{if(token!==videoToken)return finish(false,"facing-token");actionVideo.play().then(()=>{if(!videoRaf)videoRaf=requestAnimationFrame(ts=>renderActionVideo(ts,clip,token));}).catch(()=>{btn.classList.add("pet-video-fallback");if(videoFirstFrameResolve){const ready=videoFirstFrameResolve;videoFirstFrameResolve=null;ready(false);}finish(false,"play-rejected");});});};
      actionVideo.onended=()=>finish(true,"ended");
      actionVideo.onerror=()=>{btn.classList.add("pet-video-fallback");if(videoFirstFrameResolve){const ready=videoFirstFrameResolve;videoFirstFrameResolve=null;ready(false);}finish(false,"media-"+(actionVideo.error?.code||0));};actionVideo.src=clip.src+"?v="+clip.version;actionVideo.load();
    });
  }
  function actionClipsForDirection(action,travelDirection){
    return action?.directionalClips?.[travelDirection]||action?.clips||[];
  }
  function videoPlan(actionKey,desiredLeft,travelDirection,manifest){
    if(!manifest?.actions?.[actionKey])return[];
    const action=manifest.actions[actionKey],actionClips=actionClipsForDirection(action,travelDirection),plan=[];
    if(videoPose!==action.startPose){const transitionKey=manifest.transitions?.[videoPose+">"+action.startPose],transition=manifest.actions[transitionKey];if(transition)plan.push(...transition.clips);}
    const horizontal=travelDirection==="left"||travelDirection==="right"||!travelDirection;
    const requiredFacing=action.directionalStartFacing?.[travelDirection]||(horizontal?(desiredLeft?"left":"right"):null);
    if(requiredFacing&&action.startPose==="H1"&&(requiredFacing==="left")!==videoFacingLeft){const facingKey=(videoFacingLeft?"left":"right")+">"+requiredFacing,turnKey=manifest.facingTransitions?.[facingKey];if(turnKey)plan.push(turnKey);}
    plan.push(...actionClips);return plan;
  }
  function estimateVideoDuration(plan){return Math.max(1,plan.length*4.15);}
  function playVideoAction(actionKey,desiredLeft,travelDirection){
    stopActionVideo(true);const token=videoToken,manifest=activeVideoManifest(),action=manifest?.actions?.[actionKey],selectedClips=actionClipsForDirection(action,travelDirection);
    const horizontal=travelDirection==="left"||travelDirection==="right"||!travelDirection;
    if(manifest?.symmetricFacing&&horizontal&&desiredLeft!==videoFacingLeft){videoFacingLeft=desiredLeft;btn.classList.toggle("pet-facing-left",videoFacingLeft);btn.dataset.petFacing=videoFacingLeft?"left":"right";}
    const plan=videoPlan(actionKey,desiredLeft,travelDirection,manifest);
    btn.dataset.petVideoPlan=plan.join(",");btn.dataset.petVideoFailure="";btn.dataset.petTravelDirection=travelDirection||"stationary";
    let readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});videoFirstFrameResolve=readyResolve;if(!btn.classList.contains("pet-action-video-active"))btn.classList.add("pet-video-fallback");
    let finishedResolve;const finished=new Promise(resolve=>{finishedResolve=resolve;});
    if(!action||!plan.length){videoFirstFrameResolve=null;readyResolve(false);finishedResolve(false);return{duration:1,motionDuration:1,move:false,plan:[],ready,finished};}
    // 网页位移使用动作专属时间窗：准备阶段固定，真实迈步/腾空时移动，落地或刹停阶段再次固定。
    const motionClips=action.directionalMotionClips?.[travelDirection]||action.motionClips||selectedClips;
    const moveDelay=action.directionalMoveDelays?.[travelDirection]??action.moveDelay??0;
    videoReadyClipKey=action.directionalMoveStartClips?.[travelDirection]||action.moveStartClip||selectedClips[0]||plan[0];
    (async()=>{let completed=true;for(const clipKey of plan){btn.dataset.petExpectedClip=clipKey;if(token!==videoToken){completed=false;break;}const ok=await playClip(clipKey,token,manifest);if(!ok||token!==videoToken){completed=false;break;}const completedClip=manifest.clips[clipKey];videoPose=completedClip.endPose;if(completedClip.endFacing){videoFacingLeft=completedClip.endFacing==="left";btn.classList.toggle("pet-facing-left",videoFacingLeft);btn.dataset.petFacing=completedClip.endFacing;}}if(completed&&token===videoToken){videoPose=action.endPose;btn.dataset.petPose=videoPose;}finishedResolve(completed&&token===videoToken);})();
    const inferredMotionDuration=Math.max(.4,estimateVideoDuration(motionClips)-moveDelay),motionDuration=action.directionalMoveDurations?.[travelDirection]??action.moveDuration??inferredMotionDuration;
    return{duration:estimateVideoDuration(plan),motionDuration,moveDelay,move:!!action.move,movementAxis:action.movementAxis||"perimeter",travelDirection,plan,ready,finished};
  }
  function clearGazeTimers(){
    if(gazeTimer){clearTimeout(gazeTimer);gazeTimer=null;}
    if(gazeDwellTimer){clearTimeout(gazeDwellTimer);gazeDwellTimer=null;}
  }
  function resetGazeState(){
    clearGazeTimers();gazeRequestToken+=1;gazeEngaged=false;gazeDirection="";btn.dataset.petGaze="center";
  }
  function gazeDirectionAt(x,y){
    const r=btn.getBoundingClientRect(),dx=x-(r.left+r.width/2),dy=y-(r.top+r.height*.42);
    if(Math.abs(dy)>Math.abs(dx)*1.08)return dy<0?"up":"down";
    return dx<0?"left":"right";
  }
  function gazeCanRun(){
    const gaze=activeVideoManifest()?.gaze;
    return !!gaze&&renderMode==="video"&&enabled&&!reduced.matches&&!document.hidden&&!panel.classList.contains("open")&&!btn.classList.contains("dragging")&&!btn.classList.contains("pet-morphing")&&(current==="idle"||current==="gaze");
  }
  async function transitionGaze(nextDirection,resume){
    const manifest=activeVideoManifest(),gaze=manifest?.gaze;
    if(!gaze)return false;
    if(nextDirection===gazeDirection&&gazeEngaged)return true;
    const request=++gazeRequestToken,previous=gazeDirection;
    if(gazeTimer){clearTimeout(gazeTimer);gazeTimer=null;}
    clearTimer();clearMorphSchedule();stopActionVideo(true);
    const token=videoToken;gazeEngaged=true;current="gaze";btn.dataset.petAction="gaze";btn.dataset.petGaze=nextDirection||"center";setLabel(nextDirection?"看着你":"回正");
    if(previous){
      const backKey=gaze.directions?.[previous]?.back,ok=backKey?await playClip(backKey,token,manifest):true;
      if(request!==gazeRequestToken||token!==videoToken)return false;
      if(!ok){gazeEngaged=false;gazeDirection="";return false;}
      videoPose=gaze.anchorPose;gazeDirection="";btn.dataset.petPose=videoPose;
    }
    if(nextDirection){
      const outKey=gaze.directions?.[nextDirection]?.out,ok=outKey?await playClip(outKey,token,manifest):false;
      if(request!==gazeRequestToken||token!==videoToken)return false;
      if(!ok){gazeEngaged=false;gazeDirection="";return false;}
      gazeDirection=nextDirection;videoPose=manifest.clips[outKey].endPose;btn.dataset.petPose=videoPose;btn.dataset.petGaze=nextDirection;setLabel("看着你");return true;
    }
    gazeEngaged=false;current="idle";btn.dataset.petAction="idle";btn.dataset.petGaze="center";setLabel("观察中");
    if(resume!==false){scheduleVideoAction(360);scheduleMorph();}
    return true;
  }
  function queueGaze(direction,delay){
    if(direction===gazeDirection&&gazeEngaged)return;
    if(gazeTimer)clearTimeout(gazeTimer);
    gazeTimer=setTimeout(()=>{gazeTimer=null;if(direction||gazeEngaged)transitionGaze(direction,true);},delay??110);
  }
  async function triggerNearInteraction(){
    gazeDwellTimer=null;
    if(Date.now()<gazeCooldownUntil||!gazeCanRun()||gazePointer.distance>(activeVideoManifest()?.gaze?.touchRadius||150)||hovered)return;
    gazeCooldownUntil=Date.now()+6500;
    await transitionGaze("",false);
    if(!enabled||panel.classList.contains("open")||hovered)return;
    const choices=form==="anju"?["jump","roll"]:["wave","jump"],key=choices[Math.floor(Math.random()*choices.length)];
    perform(key);
  }
  function handlePointerGaze(e){
    if(btn.classList.contains("dragging")&&hoverTools.classList.contains("is-visible")&&!dragToolsRaf){
      dragToolsRaf=requestAnimationFrame(()=>{dragToolsRaf=null;syncHoverTools();});
    }
    const gaze=activeVideoManifest()?.gaze;if(!gaze||renderMode!=="video")return;
    const r=btn.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,distance=Math.hypot(e.clientX-cx,e.clientY-cy);
    gazePointer={x:e.clientX,y:e.clientY,distance};
    if(distance<=gaze.nearRadius&&gazeCanRun()){
      clearTimer();
      const requestedDirection=gazeDirectionAt(e.clientX,e.clientY),supportedDirection=gaze.directions?.[requestedDirection]?requestedDirection:"";
      if(supportedDirection)queueGaze(supportedDirection,gaze.switchDelay??250);
      else if(gazeEngaged||gazeDirection)queueGaze("",gaze.returnDelay??1400);
      if(distance<=gaze.touchRadius&&Date.now()>=gazeCooldownUntil&&!gazeDwellTimer)gazeDwellTimer=setTimeout(triggerNearInteraction,1100);
      else if(distance>gaze.touchRadius&&gazeDwellTimer){clearTimeout(gazeDwellTimer);gazeDwellTimer=null;}
    }else{
      if(gazeDwellTimer){clearTimeout(gazeDwellTimer);gazeDwellTimer=null;}
      if((gazeEngaged||gazeDirection)&&!btn.classList.contains("pet-morphing"))queueGaze("",gaze.returnDelay??1400);
    }
  }
  const SPRITE_FRAMES={
    idle:[0,1,0,1],walk:[2,3,4,3,2,3],run:[5,6,5,6,5,6,5,6],jump:[7,7,8,8,9,9],vault:[7,8,9,8,7],
    play:[10,10,6,10,10,6],sleep:[14,14,14,14],rest:[0,1,0,1],snack:[13,13,0,13,13,0],
    stretch:[15,15,0,15],roll:[11,11,10,11,11,10],wave:[12,12,0,12],peek:[0,2,2,0],
    chase:[10,5,6,5,10,5,6,5],pounce:[7,8,9,8,10,5,6,10],dance:[10,11,12,11,10,12],groom:[12,12,0,12,12,0],
    // 16~31来自第二张4×4核心姿态图；前后穿插旧姿态形成自然过渡虚拟帧。
    listen:[0,16,16,1,16],headTilt:[0,17,17,1,17],sniff:[2,18,18,3,18],scratch:[0,19,19,1,19],
    knead:[0,20,20,10,20,20],tailChase:[2,21,21,11,21],drink:[0,22,22,13,22,22],boxPeek:[0,23,23,1,23],
    inspect:[0,24,24,17,24],press:[2,25,25,3,25],highFive:[0,26,26,12,26],point:[0,27,27,12,27],
    carry:[2,28,28,3,28],celebrate:[0,29,29,12,29],startled:[1,30,30,7,30],curlAwake:[0,31,31,14,31,31]
  };
  const ANJU_FRAMES={
    idle:[0,1,0,1],walk:[0,5,5,0,5],run:[5,6,6,5,6],jump:[0,7,7,0],vault:[5,6,7,7,6,5],play:[0,14,14,2,14],sleep:[9,10,10,9,10],
    rest:[0,9,9,0],snack:[0,12,12,9],stretch:[0,8,8,0],roll:[0,7,9,0],wave:[0,2,2,0],peek:[0,3,3,0],
    chase:[5,6,7,6],pounce:[5,7,7,0],dance:[0,14,14,2,14],groom:[0,9,9,1],listen:[0,3,3,1],headTilt:[0,3,1,3],
    sniff:[0,3,9,3],scratch:[0,8,8,1],knead:[0,9,9,8],tailChase:[0,6,7,6],drink:[0,9,12,9],boxPeek:[0,12,12,1],
    inspect:[0,11,11,0],press:[0,13,13,4],highFive:[0,2,2,14],point:[0,4,4,0],carry:[0,12,12,11],
    celebrate:[0,14,14,2,14],startled:[0,7,3,0],curlAwake:[10,10,9,1]
  };
  function paintFrame(container,raw,isAnju,next,active){
    const layers=container.querySelectorAll(isAnju?".aw-anju-frame":".aw-kitten-frame"),n=raw%16,x=n%4,y=Math.floor(n/4);
    if(!isAnju)layers[next].style.backgroundImage='url("assets/blue-kitten-sprite-v'+(raw>=16?'2':'1')+'.png")';
    layers[next].style.backgroundPosition=(x*100/3)+"% "+(y*100/3)+"%";
    layers[next].classList.add("is-active");layers[active].classList.remove("is-active");
    return next;
  }
  function showSprite(action){
    if(spriteRaf){cancelAnimationFrame(spriteRaf);spriteRaf=null;}
    // 视频模式从调度层停用旧PNG帧；素材仍完整保留，切回经典模式即可恢复。
    if(renderMode==="video")return;
    stopActionVideo();
    const isAnju=form==="anju",container=isAnju?anjuSprite:sprite,frames=(isAnju?ANJU_FRAMES:SPRITE_FRAMES)[action]||(isAnju?ANJU_FRAMES.idle:SPRITE_FRAMES.idle);
    const layers=container.querySelectorAll(isAnju?".aw-anju-frame":".aw-kitten-frame");let index=0,active=0,last=0;
    const interval=isAnju?(action==="vault"?230:action==="run"?360:action==="walk"?520:760):(action==="vault"?210:action==="run"?260:action==="walk"?360:600);
    active=paintFrame(container,frames[0],isAnju,0,1);layers[active].classList.add("is-active");
    const tick=ts=>{
      if(!last)last=ts;
      const elapsed=ts-last,phase=(elapsed%interval)/interval,wave=Math.sin(phase*Math.PI*2);
      // 每个核心姿态间由浏览器按刷新率生成连续虚拟帧，避免只靠静态图切换产生跳帧。
      layers[active].style.transform="translateY("+(wave*(isAnju?1.8:1.1)).toFixed(2)+"px) rotate("+(wave*(isAnju?.7:.35)).toFixed(2)+"deg) scale("+(1+wave*.004).toFixed(4)+")";
      if(elapsed>=interval){last=ts;index=(index+1)%frames.length;active=paintFrame(container,frames[index],isAnju,active?0:1,active);}
      spriteRaf=requestAnimationFrame(tick);
    };
    spriteRaf=requestAnimationFrame(tick);
  }
  function setLabel(text){if(name)name.textContent=(form==="anju"?"安小居":"蓝喵")+(text&&text!=="观察中"?"·"+text:"");}
  function setToggle(){if(toggle){const petName=form==="anju"?"安小居":"蓝喵";toggle.textContent=enabled?"💤 休息":"🐾 活动";toggle.title=enabled?"点击让"+petName+"休息":"点击让"+petName+"开始活动";toggle.setAttribute("aria-label",toggle.title);}btn.classList.toggle("pet-disabled",!enabled);}
  function rebuildActionMenu(){
    const manifest=activeVideoManifest(),actions=manifest?.actions||{};
    actionMenu.replaceChildren();
    Object.entries(actions).filter(([,action])=>!action.transition).forEach(([key,action])=>{
      const item=document.createElement("button");item.type="button";item.dataset.petActionKey=key;item.textContent=action.label||key;item.title="让"+(form==="anju"?"安小居":"蓝喵")+"执行"+(action.label||key);actionMenu.appendChild(item);
    });
  }
  function showActionMenu(){rebuildActionMenu();actionMenu.classList.add("is-visible");}
  function hideActionMenu(){actionMenu.classList.remove("is-visible");}
  function updateRenderModeUi(){
    const videoOnly=renderMode==="video";
    btn.classList.toggle("pet-video-only",videoOnly);
    renderModeToggle.textContent=videoOnly?"🎬 视频动作":"▦ 经典帧";
    renderModeToggle.title=videoOnly?"当前只播放已接入视频；点击恢复旧帧动作":"当前使用旧帧动作；点击切回即梦视频";
    renderModeToggle.hidden=!CLASSIC_CONTROLS_EXPOSED;
    morphToggle.hidden=!VIDEO_MANIFEST?.morphs;
  }
  function updateFormUi(){
    btn.classList.toggle("pet-form-anju",form==="anju");btn.classList.toggle("pet-form-cat",form==="cat");
    if(headTitle)headTitle.textContent=form==="anju"?"安小居全站助手":"蓝喵全站助手";
    if(headMark)headMark.textContent=form==="anju"?"居":"喵";
    if(morphToggle){morphToggle.textContent=form==="anju"?"⇄ 变蓝喵":"⇄ 变安小居";morphToggle.title=form==="anju"?"切换为蓝喵形态":"切换为安小居形态";}
    setToggle();rebuildActionMenu();setLabel(current==="idle"?"观察中":((ACTIONS.find(a=>a.key===current)||{}).label||"观察中"));showSprite(current);
  }
  function persistForm(){classicForm=form;try{localStorage.setItem(PET_FORM_KEY,form);}catch(_){}}
  function persistRenderMode(){try{localStorage.setItem(PET_RENDER_MODE_KEY,renderMode);}catch(_){}}
  function clearMorphSchedule(){if(morphTimer){clearTimeout(morphTimer);morphTimer=null;}}
  function scheduleMorph(){
    clearMorphSchedule();if(!enabled||reduced.matches)return;
    // 长周期平均约为安小居60%、蓝喵40%；仍保留手动变身入口。
    const delay=form==="anju"?(48000+Math.random()*12000):(30000+Math.random()*10000);
    morphTimer=setTimeout(()=>{if(canAct())morphTo(form==="anju"?"cat":"anju",false);else scheduleMorph();},delay);
  }
  function playVideoMorph(next,manual){
    const from=form,key=VIDEO_MANIFEST?.morphs?.[from+">"+next],clip=VIDEO_MANIFEST?.morphClips?.[key];
    if(!key||!clip)return false;
    clearMorphSchedule();clearTimer();resetGazeState();freezeMovement();btn.classList.remove("pet-paused");movementToken+=1;stopActionVideo(true);
    const token=videoToken,morphManifest={clips:VIDEO_MANIFEST.morphClips};
    current="transform";btn.dataset.petAction="transform";btn.dataset.petMorph=from+">"+next;btn.classList.add("pet-morphing");setLabel("变身中");
    (async()=>{
      const ok=await playClip(key,token,morphManifest);
      if(token!==videoToken)return;
      btn.classList.remove("pet-morphing");
      if(!ok){current="idle";btn.dataset.petAction="idle";setLabel("观察中");scheduleVideoAction(420);scheduleMorph();return;}
      form=next;videoPose=clip.endPose;videoFacingLeft=false;videoActionDeck=[];persistForm();btn.classList.remove("pet-facing-left");btn.dataset.petFacing="right";btn.dataset.petPose=videoPose;
      updateFormUi();current="idle";btn.dataset.petAction="idle";setLabel("变身完成");
      scheduleVideoAction(manual?520:320);scheduleMorph();
    })();
    return true;
  }
  function morphTo(next,manual){
    if(next!=="anju"&&next!=="cat")return false;
    if(next===form||btn.classList.contains("pet-morphing")){scheduleMorph();return false;}
    btn.classList.remove("pet-paused");
    if(renderMode==="video")return playVideoMorph(next,manual);
    clearMorphSchedule();clearTimer();stopActionVideo();if(morphRaf){cancelAnimationFrame(morphRaf);morphRaf=null;}
    const from=form,duration=1680,start=performance.now();btn.classList.add("pet-morphing");btn.dataset.petAction="transform";
    setLabel("变身中");
    // 变身专用真实姿态：安小居使用第16格光效，蓝喵使用庆祝姿态；中间由约100个虚拟帧衔接。
    let anjuActive=paintFrame(anjuSprite,15,true,0,1);anjuSprite.querySelectorAll(".aw-anju-frame")[anjuActive].classList.add("is-active");
    let catActive=paintFrame(sprite,29,false,0,1);sprite.querySelectorAll(".aw-kitten-frame")[catActive].classList.add("is-active");
    btn.classList.add("pet-form-anju","pet-form-cat");
    const animate=now=>{
      const raw=Math.min(1,(now-start)/duration),p=raw<.5?2*raw*raw:1-Math.pow(-2*raw+2,2)/2,fromCat=from==="cat";
      const catOpacity=fromCat?1-p:p,anjuOpacity=fromCat?p:1-p;
      sprite.style.opacity=catOpacity.toFixed(3);anjuSprite.style.opacity=anjuOpacity.toFixed(3);
      sprite.style.transform="scale("+(1-catOpacity*.04)+") rotate("+((p-.5)*8)+"deg)";
      anjuSprite.style.transform="scale("+(.92+anjuOpacity*.08)+") rotate("+((.5-p)*7)+"deg)";
      if(raw<1)morphRaf=requestAnimationFrame(animate);else{
        form=next;persistForm();btn.classList.remove("pet-morphing","pet-form-anju","pet-form-cat");
        sprite.style.opacity="";anjuSprite.style.opacity="";sprite.style.transform="";anjuSprite.style.transform="";
        updateFormUi();current="celebrate";btn.dataset.petAction="celebrate";setLabel("变身完成");showSprite("celebrate");
        timer=setTimeout(()=>{current="idle";btn.dataset.petAction="idle";setLabel("观察中");showSprite("idle");},manual?2200:1700);
        scheduleMorph();morphRaf=null;
      }
    };
    morphRaf=requestAnimationFrame(animate);return true;
  }
  function canAct(){return enabled&&!reduced.matches&&!document.hidden&&!hovered&&!gazeEngaged&&Date.now()>=quietUntil&&!btn.classList.contains("dragging")&&!panel.classList.contains("open");}
  function shuffledActionKeys(){
    const keys=ACTIONS.map(a=>a.key);
    for(let i=keys.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[keys[i],keys[j]]=[keys[j],keys[i]];}
    // 新一轮的首个动作不与上一轮末尾相同，避免视觉上连续重复。
    if(keys.length>1&&keys[0]===current)[keys[0],keys[1]]=[keys[1],keys[0]];
    return keys;
  }
  function refillActionDeck(){actionDeck=shuffledActionKeys();actionCycleNo+=1;}
  function refillVideoActionDeck(){
    const keys=activeVideoManifest()?.randomCycle?.slice()||["idle"];
    for(let i=keys.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[keys[i],keys[j]]=[keys[j],keys[i]];}
    if(keys.length>1&&keys[0]===current)[keys[0],keys[1]]=[keys[1],keys[0]];
    videoActionDeck=keys;actionCycleNo+=1;
  }
  function consumeDeckAction(key){
    const i=actionDeck.indexOf(key);if(i>=0)actionDeck.splice(i,1);
  }
  function randomAction(){
    if(renderMode==="video"){
      if(!videoActionDeck.length)refillVideoActionDeck();
      let index=videoActionDeck.findIndex(key=>key!==current&&(key!=="run"||Date.now()>=nextRoamAt));
      if(index<0)return ACTIONS.find(a=>a.key==="idle");
      const key=videoActionDeck.splice(index,1)[0];
      if(key==="run")nextRoamAt=Date.now()+2500+Math.random()*2000;
      return ACTIONS.find(a=>a.key===key)||ACTIONS.find(a=>a.key==="idle");
    }
    if(!actionDeck.length)refillActionDeck();
    const allowMove=Date.now()>=nextRoamAt;
    // 每轮将全部行为随机洗牌后逐一消费；未轮完前绝不再次抽中已消费动作。
    const index=actionDeck.findIndex(key=>key!==current&&(allowMove||!ACTIONS.find(a=>a.key===key).move));
    if(index<0){
      // 若本轮只剩位移动作但尚处于漫游冷却期，临时休息且不消费动作牌。
      return ACTIONS.find(a=>a.key==="rest");
    }
    const key=actionDeck.splice(index,1)[0],action=ACTIONS.find(a=>a.key===key);
    if(action.move)nextRoamAt=Date.now()+20000+Math.random()*8000;
    return action;
  }
  function perimeterPoints(margin,maxX,maxY){
    const midX=Math.round((margin+maxX)/2),midY=Math.round((margin+maxY)/2);
    return[
      {left:margin,top:margin,edge:"左上"},{left:midX,top:margin,edge:"上边"},{left:maxX,top:margin,edge:"右上"},
      {left:maxX,top:midY,edge:"右边"},{left:maxX,top:maxY,edge:"右下"},{left:midX,top:maxY,edge:"下边"},
      {left:margin,top:maxY,edge:"左下"},{left:margin,top:midY,edge:"左边"}
    ];
  }
  function coreSafeRectangleDestination(){
    const r=btn.getBoundingClientRect(),margin=18,maxX=Math.max(margin,innerWidth-r.width-margin),maxY=Math.max(margin,innerHeight-r.height-margin),left=Math.max(margin,Math.min(maxX,r.left)),top=Math.max(margin,Math.min(maxY,r.top));
    const corners=[
      {left:margin,top:margin,edge:"左上"},{left:maxX,top:margin,edge:"右上"},
      {left:maxX,top:maxY,edge:"右下"},{left:margin,top:maxY,edge:"左下"}
    ];
    let nearestCorner=0,cornerDistance=Infinity;
    corners.forEach((point,index)=>{const distance=Math.hypot(point.left-left,point.top-top);if(distance<cornerDistance){cornerDistance=distance;nearestCorner=index;}});
    let target,direction,segment;
    if(cornerDistance<=55){
      perimeterCursor=(nearestCorner+perimeterDirection+corners.length)%corners.length;target=corners[perimeterCursor];
    }else{
      const edgeDistances=[top,maxX-left,maxY-top,left],nearestEdge=edgeDistances.indexOf(Math.min(...edgeDistances));
      if(Math.min(...edgeDistances)>55){
        if(nearestEdge===0)target={left,top:margin,edge:"上边吸附"};
        else if(nearestEdge===1)target={left:maxX,top,edge:"右边吸附"};
        else if(nearestEdge===2)target={left,top:maxY,edge:"下边吸附"};
        else target={left:margin,top,edge:"左边吸附"};
      }else if(nearestEdge===0)target=perimeterDirection>0?corners[1]:corners[0];
      else if(nearestEdge===1)target=perimeterDirection>0?corners[2]:corners[1];
      else if(nearestEdge===2)target=perimeterDirection>0?corners[3]:corners[2];
      else target=perimeterDirection>0?corners[0]:corners[3];
    }
    const dx=target.left-left,dy=target.top-top;
    if(Math.abs(dx)>=Math.abs(dy)){
      direction=dx<0?"left":"right";segment=top<innerHeight/2?"top-horizontal":"bottom-horizontal";
      // 每次只沿一条边移动；中断恢复或初次吸附时不得同时改 top，避免斜向补位像瞬移。
      target={...target,top};
    }else{
      direction=dy<0?"up":"down";segment=left<innerWidth/2?"left-vertical":"right-vertical";
      // 垂直跑只改变 top，保留当前 left，确保上下视频与网页坐标同轴。
      target={...target,left};
    }
    btn.dataset.petRoute="core-safe-rectangle";btn.dataset.petRouteSegment=segment;btn.dataset.petEdge=target.edge;btn.dataset.petLocomotion="foot-synced";btn.dataset.petVerticalRouteState=activeVideoManifest()?.directionalRun?.verticalAssetsReady?"ready":"awaiting-up-down-videos";
    return{left:target.left,top:target.top,from:r.left,fromTop:r.top,direction};
  }
  function screenHopDestination(){
    const r=btn.getBoundingClientRect(),margin=18,maxX=Math.max(margin,innerWidth-r.width-margin),maxY=Math.max(margin,innerHeight-r.height-margin),hop=Math.max(240,Math.min(420,innerWidth*.28));
    let direction=videoFacingLeft?"left":"right";
    if(r.left<=margin+hop*.45)direction="right";
    else if(r.left>=maxX-hop*.45)direction="left";
    const targetLeft=Math.max(margin,Math.min(maxX,r.left+(direction==="left"?-hop:hop))),targetTop=Math.max(margin,Math.min(maxY,r.top));
    btn.dataset.petRoute="screen-hop";btn.dataset.petRouteSegment="horizontal-hop";btn.dataset.petEdge="短距离跃迁";btn.dataset.petLocomotion="video-driven-hop";
    return{left:targetLeft,top:targetTop,from:r.left,fromTop:r.top,direction};
  }
  function destination(movementAxis){
    if(movementAxis==="core-safe-rectangle")return coreSafeRectangleDestination();
    if(movementAxis==="screen-hop")return screenHopDestination();
    const r=btn.getBoundingClientRect(),margin=12,maxX=Math.max(margin,innerWidth-r.width-margin),maxY=Math.max(margin,innerHeight-r.height-margin),points=perimeterPoints(margin,maxX,maxY);
    let nearest=0,best=Infinity;
    points.forEach((point,index)=>{const distance=Math.hypot(point.left-r.left,point.top-r.top);if(distance<best){best=distance;nearest=index;}});
    // 被用户拖到中间时先回到最近边界；已经靠近边界时（含首次动作）直接前往相邻节点，避免只挪十几像素看似原地踏步。
    if(best>90)perimeterCursor=nearest;
    else perimeterCursor=(nearest+perimeterDirection+points.length)%points.length;
    const target=points[perimeterCursor];
    btn.dataset.petRoute="perimeter";btn.dataset.petEdge=target.edge;
    return{left:target.left,top:target.top,from:r.left};
  }
  function talk(force){
    if(!bubble||(!force&&!canAct()))return;
    let i=Math.floor(Math.random()*PHRASES.length);if(i===lastPhrase)i=(i+1)%PHRASES.length;lastPhrase=i;
    bubble.textContent=PHRASES[i];bubble.classList.remove("pet-talk");void bubble.offsetWidth;bubble.classList.add("pet-talk");
  }
  function clearTimer(){if(timer){clearTimeout(timer);timer=null;}}
  function scheduleVideoAction(delay){
    clearTimer();
    const retry=()=>{
      if(!enabled||reduced.matches||document.hidden||panel.classList.contains("open")){timer=null;return;}
      if(canAct()){timer=null;perform(randomAction());return;}
      timer=setTimeout(retry,450);
    };
    timer=setTimeout(retry,delay);
  }
  function syncHoverTools(){
    const r=btn.getBoundingClientRect(),w=hoverTools.offsetWidth||148,h=hoverTools.offsetHeight||33,gap=7;
    let left=r.left+r.width/2-w/2,top=r.top-h-gap;
    if(top<8)top=r.bottom+gap;
    // 始终为右侧动作菜单预留空间，避免宠物在右边界时菜单伸出视口。
    const actionMenuReserve=154;
    left=Math.max(8,Math.min(innerWidth-w-actionMenuReserve-gap-8,left));
    hoverTools.style.left=Math.round(left)+"px";hoverTools.style.top=Math.round(top)+"px";
  }
  function showHoverTools(){syncHoverTools();hoverTools.classList.add("is-visible");}
  function hideHoverTools(){hoverTools.classList.remove("is-visible");hideActionMenu();}
  function cancelHoverHide(){if(hoverTimer){clearTimeout(hoverTimer);hoverTimer=null;}}
  function scheduleHoverHide(){
    cancelHoverHide();
    hoverTimer=setTimeout(()=>{hoverTimer=null;hideHoverTools();resumeAfterHover();},260);
  }
  function resumeAfterHover(){
    hovered=false;busy=false;btn.classList.remove("pet-paused");
    // 手动变身播放期间，工具栏失焦不能启动随机动作，否则变身视频会在开头被取消。
    if(btn.classList.contains("pet-morphing"))return;
    if(enabled&&!panel.classList.contains("open")){
      if(renderMode==="video")scheduleVideoAction(320+Math.random()*380);
      else{clearTimer();timer=setTimeout(()=>perform(randomAction()),2600);}
    }
  }
  function freezeMovement(){
    if(!btn.classList.contains("pet-moving"))return;
    const r=btn.getBoundingClientRect();
    btn.classList.add("pet-paused");btn.classList.remove("pet-moving");
    btn.style.left=Math.round(r.left)+"px";btn.style.top=Math.round(r.top)+"px";
  }
  function perform(actionOrKey){
    if(btn.classList.contains("pet-morphing"))return false;
    resetGazeState();
    let action=typeof actionOrKey==="string"?ACTIONS.find(a=>a.key===actionOrKey):actionOrKey;
    const formManifest=activeVideoManifest();
    if(renderMode==="video"&&action&&!formManifest?.actions?.[action.key])action=ACTIONS.find(a=>a.key==="idle");
    if(!action)return false;clearTimer();const actionMovementToken=++movementToken;let movementEndsAt=0;current=action.key;btn.dataset.petAction=action.key;btn.dataset.petMovementStarted="0";btn.dataset.petMovementReadyAt="";btn.dataset.petMovementStartedAt="";btn.dataset.petMovementEndsAt="";setLabel(action.label);showSprite(action.key);
    const registeredVideoAction=renderMode==="video"?formManifest?.actions?.[action.key]:null;
    const videoShouldMove=!!registeredVideoAction?.move;
    let plannedMove=null;
    if(videoShouldMove&&enabled)plannedMove=destination(registeredVideoAction.movementAxis);
    const travelDirection=plannedMove?.direction||null,desiredLeft=travelDirection==="left"?true:(travelDirection==="right"?false:videoFacingLeft);
    if(renderMode==="video")videoFacingReady=Promise.resolve();
    const videoPlayback=renderMode==="video"?(reduced.matches?{duration:4,motionDuration:4,move:false,plan:[],ready:Promise.resolve(false),finished:Promise.resolve(false)}:playVideoAction(action.key,desiredLeft,travelDirection)):null;
    const shouldMove=renderMode==="video"?videoPlayback.move:action.move;
    if(shouldMove&&(renderMode==="video"?enabled:canAct())){
      const d=plannedMove||destination(),distance=Math.hypot(d.left-d.from,d.top-btn.getBoundingClientRect().top),speed=action.key==="walk"?55:(action.key==="run"?110:82),minimumSeconds=action.key==="walk"?2.8:(action.key==="run"?4.05:2),seconds=Math.max(minimumSeconds,Math.min(6.8,distance/speed));
      const movementSeconds=renderMode==="video"?videoPlayback.motionDuration:seconds;
      btn.style.setProperty("--pet-duration",movementSeconds.toFixed(2)+"s");btn.style.setProperty("--pet-easing",action.key==="walk"||action.key==="run"||action.key==="jump"?"linear":"cubic-bezier(.2,.65,.25,1)");
      btn.classList.toggle("pet-near-left",d.left<230);
      const startMovement=()=>{
        if(current!==action.key||movementToken!==actionMovementToken)return;if(!canAct()){setTimeout(startMovement,180);return;}
        const start=btn.getBoundingClientRect();btn.classList.remove("pet-moving");btn.style.left=Math.round(start.left)+"px";btn.style.top=Math.round(start.top)+"px";void btn.offsetWidth;
        if(current!==action.key||movementToken!==actionMovementToken||!canAct())return;
        btn.classList.add("pet-moving");btn.dataset.petMovementStarted="1";btn.dataset.petMovementStartedAt=String(Date.now());movementEndsAt=Date.now()+Math.ceil(movementSeconds*1000)+120;btn.dataset.petMovementEndsAt=String(movementEndsAt);btn.style.left=d.left+"px";btn.style.top=d.top+"px";
      };
      if(renderMode==="video")videoPlayback.ready.then(ok=>{if(ok&&movementToken===actionMovementToken){const delay=Math.max(0,Number(videoPlayback.moveDelay)||0);btn.dataset.petMoveDelayMs=String(Math.round(delay*1000));btn.dataset.petMovementReadyAt=String(Date.now());if(delay)setTimeout(startMovement,Math.round(delay*1000));else startMovement();}});else startMovement();
      var effectiveDuration=Math.ceil(movementSeconds*1000);
    }else btn.classList.remove("pet-moving");
    if(videoPlayback?.ready)videoPlayback.ready.then(ok=>{if(!ok&&current===action.key&&enabled&&!reduced.matches)scheduleVideoAction(350);});
    if(Math.random()<.28)talk(false);
    const finishAction=()=>{
      // 视频文件可能比清单中的标称时长稍短。位移动画尚未结束时不能移除
      // pet-moving，否则浏览器会立刻采用终点 left/top，表现为上下左右瞬移。
      const movementRemaining=movementEndsAt-Date.now();
      if(movementRemaining>0&&current===action.key&&movementToken===actionMovementToken){timer=setTimeout(finishAction,movementRemaining+24);return;}
      btn.classList.remove("pet-moving");
      if(renderMode==="video"){
        if(!enabled){timer=null;btn.dataset.petAction="rest";setLabel("休息中");return;}
        current="idle";btn.dataset.petAction="idle";setLabel("观察中");showSprite("idle");
        scheduleVideoAction(180+Math.random()*320);return;
      }
      if(canAct()){
        current="idle";btn.dataset.petAction="idle";setLabel("观察中");showSprite("idle");
        // 每次表演完先安静待一会儿，形成悠闲而不是连续抽动的节奏。
        timer=setTimeout(()=>{if(canAct())perform(randomAction());},4500+Math.random()*3000);
      }
      else{timer=null;btn.dataset.petAction="rest";setLabel(enabled?"休息":"休息中");}
    };
    if(videoPlayback)videoPlayback.finished.then(ok=>{if(ok&&current===action.key)finishAction();});
    else timer=setTimeout(finishAction,effectiveDuration||action.duration*1.6);
    return true;
  }
  function setRenderMode(value){
    const next=value==="classic"?"classic":"video";
    if(next===renderMode)return false;
    clearTimer();clearMorphSchedule();resetGazeState();stopActionVideo();
    if(spriteRaf){cancelAnimationFrame(spriteRaf);spriteRaf=null;}
    renderMode=next;persistRenderMode();
    if(renderMode==="video")videoPose=form==="anju"?"H1":"H0";else form=classicForm;
    current="idle";btn.dataset.petAction="idle";btn.classList.remove("pet-moving","pet-morphing");
    updateRenderModeUi();updateFormUi();
    if(enabled&&!panel.classList.contains("open"))timer=setTimeout(()=>perform(randomAction()),renderMode==="video"?320+Math.random()*380:3000);
    scheduleMorph();
    return true;
  }
  function setEnabled(value){enabled=!!value;try{localStorage.setItem(PET_KEY,enabled?"1":"0");}catch(_){}setToggle();clearTimer();clearMorphSchedule();resetGazeState();if(enabled){btn.classList.remove("pet-video-fallback");if(renderMode==="video"){if(!videoActionDeck.length)refillVideoActionDeck();talk(true);perform("idle");scheduleMorph();}else{if(!actionDeck.length)refillActionDeck();consumeDeckAction("wave");talk(true);perform("wave");scheduleMorph();}}else{btn.classList.remove("pet-moving");stopActionVideo(true);current="rest";btn.dataset.petAction="rest";setLabel("休息中");}}
  function start(){setToggle();refillActionDeck();videoPose=form==="anju"?"H1":"H0";current="idle";btn.dataset.petAction="idle";updateRenderModeUi();updateFormUi();setTimeout(()=>{if(enabled){talk(true);if(renderMode==="video")perform("idle");else{consumeDeckAction("wave");perform("wave");}scheduleMorph();}},480);}
  function yieldToUser(event){
    if(!enabled||btn.contains(event.target)||panel.contains(event.target))return;
    quietUntil=Date.now()+650;
    if(bubble)bubble.classList.remove("pet-talk");
  }

  toggle&&toggle.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();setEnabled(!enabled);e.currentTarget.blur();});
  toggle&&toggle.addEventListener("mouseenter",showActionMenu);
  toggle&&toggle.addEventListener("focusin",showActionMenu);
  toggle&&toggle.addEventListener("mouseleave",e=>{if(actionMenu.contains(e.relatedTarget))return;setTimeout(()=>{if(!actionMenu.matches(":hover"))hideActionMenu();},120);});
  actionMenu.addEventListener("mouseenter",()=>{cancelHoverHide();showActionMenu();});
  actionMenu.addEventListener("mouseleave",e=>{if(e.relatedTarget===toggle)return;hideActionMenu();});
  actionMenu.addEventListener("click",e=>{
    const item=e.target.closest("button[data-pet-action-key]");if(!item)return;e.preventDefault();e.stopPropagation();
    const key=item.dataset.petActionKey;hideActionMenu();hideHoverTools();hovered=false;busy=false;
    if(!enabled)setEnabled(true);clearTimer();setTimeout(()=>perform(key),80);
  });
  renderModeToggle.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();setRenderMode(renderMode==="video"?"classic":"video");e.currentTarget.blur();});
  morphToggle.addEventListener("click",e=>{
    e.preventDefault();e.stopPropagation();
    // 先退出悬浮冻结态，再启动完整变身；不要 blur 后让 focusout 调度器抢占变身视频。
    hovered=false;busy=false;btn.classList.remove("pet-paused");hideHoverTools();
    morphTo(form==="anju"?"cat":"anju",true);
  });
  // CSS位移中先把猫咪冻结在鼠标按下的位置，保证pointerup/click仍落在同一元素上。
  btn.addEventListener("pointerdown",()=>{freezeMovement();clearTimer();},true);
  btn.addEventListener("pointerup",()=>{btn.classList.remove("pet-paused");if(enabled&&!panel.classList.contains("open")){if(renderMode==="video")scheduleVideoAction(320+Math.random()*380);else timer=setTimeout(()=>perform(randomAction()),3000);}},true);
  btn.addEventListener("mouseenter",()=>{
    cancelHoverHide();hovered=true;busy=true;clearTimer();freezeMovement();if(gazeEngaged||gazeDirection)queueGaze("",40);setLabel("点我问问题");showHoverTools();
  });
  btn.addEventListener("mouseleave",e=>{if(hoverTools.contains(e.relatedTarget))return;scheduleHoverHide();});
  btn.addEventListener("focusin",()=>{hovered=true;busy=true;clearTimer();freezeMovement();showHoverTools();});
  hoverTools.addEventListener("mouseenter",()=>{cancelHoverHide();hovered=true;busy=true;clearTimer();freezeMovement();showHoverTools();});
  hoverTools.addEventListener("mouseleave",e=>{if(btn.contains(e.relatedTarget))return;scheduleHoverHide();});
  hoverTools.addEventListener("focusout",e=>{if(hoverTools.contains(e.relatedTarget))return;hideHoverTools();resumeAfterHover();});
  new MutationObserver(()=>{
    if(panel.classList.contains("open")){hideHoverTools();clearTimer();clearMorphSchedule();resetGazeState();btn.classList.remove("pet-moving");if(renderMode==="video"){stopActionVideo(true);current="rest";btn.dataset.petAction="rest";setLabel("问答中");}else perform("rest");return;}
    // 面板关闭后鼠标可能仍停留在原按钮坐标，旧的 hover/busy 会让宠物永久卡在休息态。
    hovered=false;busy=false;if(hoverTimer){clearTimeout(hoverTimer);hoverTimer=null;}
    if(enabled){if(renderMode==="video")scheduleVideoAction(320+Math.random()*380);else{clearTimer();timer=setTimeout(()=>perform(randomAction()),3000);}scheduleMorph();}
  }).observe(panel,{attributes:true,attributeFilter:["class"]});
  document.addEventListener("visibilitychange",()=>{if(document.hidden){clearTimer();resetGazeState();stopActionVideo(true);}else if(enabled){if(renderMode==="video")perform("idle");else{showSprite(current);timer=setTimeout(()=>perform(randomAction()),450);}}});
  addEventListener("resize",()=>{if(hoverTools.classList.contains("is-visible"))syncHoverTools();});
  btn.addEventListener("awpositionchange",()=>{if(hoverTools.classList.contains("is-visible"))syncHoverTools();});
  document.addEventListener("pointermove",handlePointerGaze,{passive:true});
  document.addEventListener("pointerdown",yieldToUser,true);
  document.addEventListener("keydown",yieldToUser,true);
  reduced.addEventListener&&reduced.addEventListener("change",()=>{clearTimer();if(!reduced.matches&&enabled)perform("idle");else stopActionVideo();});
  root.AgentPet={actions:ACTIONS.map(a=>({key:a.key,label:a.label})),phrases:PHRASES.slice(),perform,setEnabled,isEnabled:()=>enabled,talk,morphTo,getForm:()=>form,setRenderMode,getRenderMode:()=>renderMode,
    animationStats:()=>{const manifest=activeVideoManifest();return{renderMode,form,classicControlsExposed:CLASSIC_CONTROLS_EXPOSED,legacyFramesPaused:renderMode==="video",videoActions:manifest?Object.keys(manifest.actions):[],videoClips:manifest?Object.keys(manifest.clips).length:0,totalVideoClips:VIDEO_MANIFEST?.forms?Object.values(VIDEO_MANIFEST.forms).reduce((sum,item)=>sum+Object.keys(item.clips).length,0)+Object.keys(VIDEO_MANIFEST.morphClips||{}).length:0,currentVideoClip:videoClipKey,currentPose:videoPose,mirrored:videoFacingLeft,flashFramePolicy:"trim anchors; motion-match-cut; no crossfade ghosts",replaceScope:"single form manifest clip",catCoreFrames:32,anjuCoreFrames:16,behaviors:ACTIONS.length,videoPlayer:{ready:actionVideo.readyState>=2,duration:Number.isFinite(actionVideo.duration)?Number(actionVideo.duration.toFixed(3)):null,mode:"runtime chroma-key canvas",fallback:manifest?.fallback},catSequenceFrames:Object.values(SPRITE_FRAMES).reduce((n,frames)=>n+frames.length,0),anjuSequenceFrames:Object.values(ANJU_FRAMES).reduce((n,frames)=>n+frames.length,0),virtualFps:"display refresh rate (usually 60fps)",morphDuration:"5s symmetric video",anjuShare:"about 60%",catShare:"about 40%",roamInterval:renderMode==="video"?"run cooldown about 2.5-4.5s":"20-28s",roamRoute:renderMode==="video"?"four-edge core-safe rectangle with left/right/up/down run videos":"screen perimeter rectangle",actionPause:renderMode==="video"?"0.18-0.50s":"4.5-7.5s",tempo:"continuous active",cycleMode:renderMode==="video"?"per-form weighted shuffle + no immediate repeat + pose transitions":"shuffle-without-repeat",cycleNo:actionCycleNo,cycleRemaining:renderMode==="video"?videoActionDeck.length:actionDeck.length};},
    previewShuffledCycle:()=>renderMode==="video"?(activeVideoManifest()?.randomCycle?.slice()||[]):shuffledActionKeys()};
  start();
})(window);
