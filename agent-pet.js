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
  const reduced=matchMedia("(prefers-reduced-motion: reduce)");
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
    .aw-pet-hover-tools a:hover,.aw-pet-hover-tools a:focus-visible{background:#e8f4fb;color:#087ec8}
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
  let busy=false,hovered=false,timer=null,spriteRaf=null,morphTimer=null,morphRaf=null,hoverTimer=null,lastPhrase=-1,current="idle",quietUntil=0;
  let actionDeck=[],actionCycleNo=0,perimeterCursor=-1,perimeterDirection=Math.random()<.5?-1:1;
  let nextRoamAt=Date.now()+20000+Math.random()*8000;
  const name=btn.querySelector(".aw-name"),bubble=btn.querySelector(".aw-nudge"),toggle=document.getElementById("awPetToggle");
  const headTitle=document.querySelector("#awHead .aw-head-title b"),headMark=document.querySelector("#awHead .aw-head-title>span");
  const morphToggle=document.createElement("a");morphToggle.href="javascript:void(0)";morphToggle.id="awMorphToggle";morphToggle.title="在蓝喵和安小居之间切换";morphToggle.textContent="⇄ 变身";
  const hoverTools=document.createElement("div");hoverTools.className="aw-pet-hover-tools";hoverTools.setAttribute("aria-label","宠物快捷控制");
  hoverTools.appendChild(morphToggle);if(toggle)hoverTools.appendChild(toggle);document.body.appendChild(hoverTools);
  const stage=document.createElement("span");stage.className="aw-pet-stage";stage.setAttribute("aria-hidden","true");
  const sprite=document.createElement("span");
  sprite.className="aw-kitten-sprite";sprite.setAttribute("aria-hidden","true");
  sprite.innerHTML='<i class="aw-kitten-frame is-active"></i><i class="aw-kitten-frame"></i>';
  const anjuSprite=document.createElement("span");
  anjuSprite.className="aw-anju-sprite";anjuSprite.setAttribute("aria-hidden","true");
  anjuSprite.innerHTML='<i class="aw-anju-frame is-active"></i><i class="aw-anju-frame"></i>';
  stage.appendChild(sprite);stage.appendChild(anjuSprite);
  const avatar=btn.querySelector(".aw-avatar");if(avatar)btn.insertBefore(stage,avatar);
  const spriteImage=new Image();
  spriteImage.onload=()=>btn.classList.add("pet-raster-ready");
  spriteImage.src="assets/blue-kitten-sprite-v1.png";
  const anjuImage=new Image();
  anjuImage.onload=()=>btn.classList.add("pet-anju-ready");
  anjuImage.src="assets/anju-mascot-sprite-v2.png";
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
  function setToggle(){if(toggle){toggle.textContent=enabled?"🐾 活动":"🐾 唤醒";toggle.title=enabled?"点击让蓝喵原地休息":"点击恢复蓝喵活动";}btn.classList.toggle("pet-disabled",!enabled);}
  function updateFormUi(){
    btn.classList.toggle("pet-form-anju",form==="anju");btn.classList.toggle("pet-form-cat",form==="cat");
    if(headTitle)headTitle.textContent=form==="anju"?"安小居全站助手":"蓝喵全站助手";
    if(headMark)headMark.textContent=form==="anju"?"居":"喵";
    if(morphToggle){morphToggle.textContent=form==="anju"?"⇄ 变蓝喵":"⇄ 变安小居";morphToggle.title=form==="anju"?"切换为蓝喵形态":"切换为安小居形态";}
    setLabel(current==="idle"?"观察中":((ACTIONS.find(a=>a.key===current)||{}).label||"观察中"));showSprite(current);
  }
  function persistForm(){try{localStorage.setItem(PET_FORM_KEY,form);}catch(_){}}
  function clearMorphSchedule(){if(morphTimer){clearTimeout(morphTimer);morphTimer=null;}}
  function scheduleMorph(){
    clearMorphSchedule();if(!enabled||reduced.matches)return;
    // 长周期平均约为安小居60%、蓝喵40%；仍保留手动变身入口。
    const delay=form==="anju"?(48000+Math.random()*12000):(30000+Math.random()*10000);
    morphTimer=setTimeout(()=>{if(canAct())morphTo(form==="anju"?"cat":"anju",false);else scheduleMorph();},delay);
  }
  function morphTo(next,manual){
    if(next!=="anju"&&next!=="cat")return false;
    if(next===form||btn.classList.contains("pet-morphing")){scheduleMorph();return false;}
    clearMorphSchedule();clearTimer();if(morphRaf){cancelAnimationFrame(morphRaf);morphRaf=null;}
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
  function canAct(){return enabled&&!reduced.matches&&!document.hidden&&!hovered&&Date.now()>=quietUntil&&!btn.classList.contains("dragging")&&!panel.classList.contains("open");}
  function shuffledActionKeys(){
    const keys=ACTIONS.map(a=>a.key);
    for(let i=keys.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[keys[i],keys[j]]=[keys[j],keys[i]];}
    // 新一轮的首个动作不与上一轮末尾相同，避免视觉上连续重复。
    if(keys.length>1&&keys[0]===current)[keys[0],keys[1]]=[keys[1],keys[0]];
    return keys;
  }
  function refillActionDeck(){actionDeck=shuffledActionKeys();actionCycleNo+=1;}
  function consumeDeckAction(key){
    const i=actionDeck.indexOf(key);if(i>=0)actionDeck.splice(i,1);
  }
  function randomAction(){
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
  function destination(){
    const r=btn.getBoundingClientRect(),margin=12,maxX=Math.max(margin,innerWidth-r.width-margin),maxY=Math.max(margin,innerHeight-r.height-margin),points=perimeterPoints(margin,maxX,maxY);
    let nearest=0,best=Infinity;
    points.forEach((point,index)=>{const distance=Math.hypot(point.left-r.left,point.top-r.top);if(distance<best){best=distance;nearest=index;}});
    // 被用户拖到中间时先回到最近边界；已经在边界时只前往相邻节点，绝不横穿页面中心。
    if(perimeterCursor<0||best>90)perimeterCursor=nearest;
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
  function syncHoverTools(){
    const r=btn.getBoundingClientRect(),w=hoverTools.offsetWidth||148,h=hoverTools.offsetHeight||33,gap=7;
    let left=r.left+r.width/2-w/2,top=r.top-h-gap;
    if(top<8)top=r.bottom+gap;
    left=Math.max(8,Math.min(innerWidth-w-8,left));
    hoverTools.style.left=Math.round(left)+"px";hoverTools.style.top=Math.round(top)+"px";
  }
  function showHoverTools(){syncHoverTools();hoverTools.classList.add("is-visible");}
  function hideHoverTools(){hoverTools.classList.remove("is-visible");}
  function cancelHoverHide(){if(hoverTimer){clearTimeout(hoverTimer);hoverTimer=null;}}
  function scheduleHoverHide(){
    cancelHoverHide();
    hoverTimer=setTimeout(()=>{hoverTimer=null;hideHoverTools();resumeAfterHover();},260);
  }
  function resumeAfterHover(){
    hovered=false;busy=false;
    if(enabled&&!panel.classList.contains("open")){clearTimer();timer=setTimeout(()=>perform(randomAction()),2600);}
  }
  function freezeMovement(){
    if(!btn.classList.contains("pet-moving"))return;
    const r=btn.getBoundingClientRect();
    btn.classList.add("pet-paused");btn.classList.remove("pet-moving");
    btn.style.left=Math.round(r.left)+"px";btn.style.top=Math.round(r.top)+"px";
  }
  function perform(actionOrKey){
    const action=typeof actionOrKey==="string"?ACTIONS.find(a=>a.key===actionOrKey):actionOrKey;
    if(!action)return false;clearTimer();current=action.key;btn.dataset.petAction=action.key;setLabel(action.label);showSprite(action.key);
    if(action.move&&canAct()){
      const d=destination(),distance=Math.hypot(d.left-d.from,d.top-btn.getBoundingClientRect().top),speed=action.key==="walk"?55:(action.key==="run"?110:82),seconds=Math.max(action.key==="walk"?2.8:2,Math.min(6.8,distance/speed));
      btn.style.setProperty("--pet-duration",seconds.toFixed(2)+"s");btn.style.setProperty("--pet-easing",action.key==="walk"?"linear":"cubic-bezier(.2,.65,.25,1)");
      btn.classList.toggle("pet-facing-left",d.left<d.from);btn.classList.toggle("pet-near-left",d.left<230);btn.classList.add("pet-moving");btn.style.left=d.left+"px";btn.style.top=d.top+"px";
      var effectiveDuration=Math.ceil(seconds*1000);
    }else btn.classList.remove("pet-moving");
    if(Math.random()<.28)talk(false);
    timer=setTimeout(()=>{
      btn.classList.remove("pet-moving");
      if(canAct()){
        btn.dataset.petAction="idle";setLabel("观察中");showSprite("idle");
        // 每次表演完先安静待一会儿，形成悠闲而不是连续抽动的节奏。
        timer=setTimeout(()=>{if(canAct())perform(randomAction());},4500+Math.random()*3000);
      }
      else{timer=null;btn.dataset.petAction="rest";setLabel(enabled?"休息":"休息中");}
    },(effectiveDuration||action.duration)*1.6);
    return true;
  }
  function setEnabled(value){enabled=!!value;try{localStorage.setItem(PET_KEY,enabled?"1":"0");}catch(_){}setToggle();clearTimer();clearMorphSchedule();if(enabled){if(!actionDeck.length)refillActionDeck();consumeDeckAction("wave");talk(true);perform("wave");scheduleMorph();}else{btn.classList.remove("pet-moving","pet-facing-left");perform("rest");setLabel("休息中");}}
  function start(){setToggle();refillActionDeck();current="idle";btn.dataset.petAction="idle";updateFormUi();setTimeout(()=>{if(enabled){consumeDeckAction("wave");talk(true);perform("wave");scheduleMorph();}},480);}
  function yieldToUser(event){
    if(!enabled||btn.contains(event.target)||panel.contains(event.target))return;
    quietUntil=Date.now()+650;
    if(bubble)bubble.classList.remove("pet-talk");
  }

  toggle&&toggle.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();setEnabled(!enabled);e.currentTarget.blur();});
  morphToggle.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();morphTo(form==="anju"?"cat":"anju",true);e.currentTarget.blur();});
  // CSS位移中先把猫咪冻结在鼠标按下的位置，保证pointerup/click仍落在同一元素上。
  btn.addEventListener("pointerdown",()=>{freezeMovement();clearTimer();},true);
  btn.addEventListener("pointerup",()=>{btn.classList.remove("pet-paused");if(enabled&&!panel.classList.contains("open"))timer=setTimeout(()=>perform(randomAction()),3000);},true);
  btn.addEventListener("mouseenter",()=>{
    cancelHoverHide();hovered=true;busy=true;clearTimer();freezeMovement();setLabel("点我问问题");showHoverTools();
  });
  btn.addEventListener("mouseleave",e=>{if(hoverTools.contains(e.relatedTarget))return;scheduleHoverHide();});
  btn.addEventListener("focusin",()=>{hovered=true;busy=true;clearTimer();freezeMovement();showHoverTools();});
  hoverTools.addEventListener("mouseenter",()=>{cancelHoverHide();hovered=true;busy=true;clearTimer();freezeMovement();showHoverTools();});
  hoverTools.addEventListener("mouseleave",e=>{if(btn.contains(e.relatedTarget))return;scheduleHoverHide();});
  hoverTools.addEventListener("focusout",e=>{if(hoverTools.contains(e.relatedTarget))return;hideHoverTools();resumeAfterHover();});
  new MutationObserver(()=>{
    if(panel.classList.contains("open")){hideHoverTools();clearTimer();clearMorphSchedule();btn.classList.remove("pet-moving");perform("rest");return;}
    // 面板关闭后鼠标可能仍停留在原按钮坐标，旧的 hover/busy 会让宠物永久卡在休息态。
    hovered=false;busy=false;if(hoverTimer){clearTimeout(hoverTimer);hoverTimer=null;}
    if(enabled){clearTimer();timer=setTimeout(()=>perform(randomAction()),3000);scheduleMorph();}
  }).observe(panel,{attributes:true,attributeFilter:["class"]});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)clearTimer();else if(enabled)timer=setTimeout(()=>perform(randomAction()),450);});
  addEventListener("resize",()=>{if(hoverTools.classList.contains("is-visible"))syncHoverTools();});
  document.addEventListener("pointerdown",yieldToUser,true);
  document.addEventListener("keydown",yieldToUser,true);
  reduced.addEventListener&&reduced.addEventListener("change",()=>{clearTimer();if(!reduced.matches&&enabled)perform("idle");});
  root.AgentPet={actions:ACTIONS.map(a=>({key:a.key,label:a.label})),phrases:PHRASES.slice(),perform,setEnabled,isEnabled:()=>enabled,talk,morphTo,getForm:()=>form,
    animationStats:()=>({catCoreFrames:32,anjuCoreFrames:16,behaviors:ACTIONS.length,catSequenceFrames:Object.values(SPRITE_FRAMES).reduce((n,frames)=>n+frames.length,0),anjuSequenceFrames:Object.values(ANJU_FRAMES).reduce((n,frames)=>n+frames.length,0),virtualFps:"display refresh rate (usually 60fps)",morphDuration:"1.68s",morphVirtualFrames:"about 100 at 60Hz",anjuShare:"about 60%",catShare:"about 40%",roamInterval:"20-28s",roamRoute:"screen perimeter rectangle",actionPause:"4.5-7.5s",tempo:"leisurely",cycleMode:"shuffle-without-repeat",cycleNo:actionCycleNo,cycleRemaining:actionDeck.length}),
    previewShuffledCycle:()=>shuffledActionKeys()};
  start();
})(window);
