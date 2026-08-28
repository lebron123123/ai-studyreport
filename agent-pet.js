/* ============================================================
   agent-pet.js —— 蓝喵全站宠物动作层
   依赖：agent-widget.js 已创建 #awBtn / #awPanel
   职责：自主动作、全屏漫游、场景话术、宠物模式开关。
   不负责：AI问答、业务导航、表单操作和任何数据写入。
   ============================================================ */
(function(root){
  "use strict";
  const btn=document.getElementById("awBtn"),panel=document.getElementById("awPanel");
  if(!btn||!panel)return;

  const PET_KEY="studyreport:agent-pet-enabled:v1";
  const reduced=matchMedia("(prefers-reduced-motion: reduce)");
  const ACTIONS=[
    {key:"idle",label:"观察中",duration:1400},
    {key:"walk",label:"散步",duration:2600,move:true},
    {key:"run",label:"跑动",duration:1800,move:true},
    {key:"jump",label:"跳跃",duration:1100},
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
    {key:"startled",label:"吓一小跳",duration:1400},
    {key:"curlAwake",label:"蜷着休息",duration:2300}
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
    #awBtn .aw-kitten-sprite{display:none;position:relative;width:102px;height:102px;flex:0 0 102px;margin-bottom:6px;filter:contrast(1.08) saturate(1.06) drop-shadow(0 7px 5px rgba(31,76,111,.22));transform-origin:50% 82%;pointer-events:none}
    #awBtn .aw-kitten-frame{position:absolute;inset:0;background:url("assets/blue-kitten-sprite-v1.png") 0 0/408px 408px no-repeat;image-rendering:auto;opacity:0;transition:opacity .11s linear,transform .11s ease-out;will-change:opacity,transform}
    #awBtn .aw-kitten-frame.is-active{opacity:1}
    #awBtn.pet-raster-ready .aw-kitten-sprite{display:block}
    #awBtn.pet-raster-ready .aw-cat{display:none}
    #awBtn.pet-raster-ready.pet-facing-left .aw-kitten-sprite{scale:-1 1}
    #awBtn.pet-raster-ready[data-pet-action="run"] .aw-kitten-sprite{animation:petRasterRun .82s ease-in-out infinite}
    #awBtn.pet-raster-ready[data-pet-action="jump"] .aw-kitten-sprite{animation:petRasterJump 1.35s cubic-bezier(.2,.75,.25,1) 2}
    #awBtn.pet-raster-ready[data-pet-action="play"] .aw-kitten-sprite,#awBtn.pet-raster-ready[data-pet-action="chase"] .aw-kitten-sprite,#awBtn.pet-raster-ready[data-pet-action="pounce"] .aw-kitten-sprite{animation:petRasterPounce 1.25s ease-in-out infinite}
    #awBtn.pet-raster-ready[data-pet-action="sleep"] .aw-kitten-sprite{animation:petRasterBreathe 2.8s ease-in-out infinite}
    #awBtn.pet-near-left .aw-nudge{left:66px;right:auto;border-radius:10px 10px 10px 2px}
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
    @media(prefers-reduced-motion:reduce){#awBtn[data-pet-action] .aw-cat,#awBtn[data-pet-action] .aw-cat-paw{animation:none!important}}
  `;
  document.head.appendChild(style);

  let enabled=(()=>{try{return localStorage.getItem(PET_KEY)!=="0";}catch(_){return true;}})();
  let busy=false,hovered=false,timer=null,spriteTimer=null,hoverTimer=null,lastPhrase=-1,current="idle",quietUntil=0;
  let actionDeck=[],actionCycleNo=0;
  let nextRoamAt=Date.now()+20000+Math.random()*8000;
  const name=btn.querySelector(".aw-name"),bubble=btn.querySelector(".aw-nudge"),toggle=document.getElementById("awPetToggle");
  const sprite=document.createElement("span");
  sprite.className="aw-kitten-sprite";sprite.setAttribute("aria-hidden","true");
  sprite.innerHTML='<i class="aw-kitten-frame is-active"></i><i class="aw-kitten-frame"></i>';
  const avatar=btn.querySelector(".aw-avatar");if(avatar)btn.insertBefore(sprite,avatar);
  const spriteImage=new Image();
  spriteImage.onload=()=>btn.classList.add("pet-raster-ready");
  spriteImage.src="assets/blue-kitten-sprite-v1.png";
  const SPRITE_FRAMES={
    idle:[0,1,0,1],walk:[2,3,4,3,2,3],run:[5,6,5,6,5,6,5,6],jump:[7,7,8,8,9,9],
    play:[10,10,6,10,10,6],sleep:[14,14,14,14],rest:[0,1,0,1],snack:[13,13,0,13,13,0],
    stretch:[15,15,0,15],roll:[11,11,10,11,11,10],wave:[12,12,0,12],peek:[0,2,2,0],
    chase:[10,5,6,5,10,5,6,5],pounce:[7,8,9,8,10,5,6,10],dance:[10,11,12,11,10,12],groom:[12,12,0,12,12,0],
    // 16~31来自第二张4×4核心姿态图；前后穿插旧姿态形成自然过渡虚拟帧。
    listen:[0,16,16,1,16],headTilt:[0,17,17,1,17],sniff:[2,18,18,3,18],scratch:[0,19,19,1,19],
    knead:[0,20,20,10,20,20],tailChase:[2,21,21,11,21],drink:[0,22,22,13,22,22],boxPeek:[0,23,23,1,23],
    inspect:[0,24,24,17,24],press:[2,25,25,3,25],highFive:[0,26,26,12,26],point:[0,27,27,12,27],
    carry:[2,28,28,3,28],celebrate:[0,29,29,12,29],startled:[1,30,30,7,30],curlAwake:[0,31,31,14,31,31]
  };
  function showSprite(action){
    if(spriteTimer){clearInterval(spriteTimer);spriteTimer=null;}
    const frames=SPRITE_FRAMES[action]||SPRITE_FRAMES.idle,layers=sprite.querySelectorAll(".aw-kitten-frame");let i=0,active=0;
    const draw=()=>{
      const raw=frames[i++%frames.length],n=raw%16,x=n%4,y=Math.floor(n/4),next=active?0:1,phase=i%4;
      layers[next].style.backgroundImage='url("assets/blue-kitten-sprite-v'+(raw>=16?'2':'1')+'.png")';
      layers[next].style.backgroundPosition=(x*100/3)+"% "+(y*100/3)+"%";
      layers[next].style.transform="translateY("+(phase===1?-1:phase===3?1:0)+"px) scale("+(phase%2?1.006:.997)+")";
      layers[next].classList.add("is-active");layers[active].classList.remove("is-active");active=next;
    };
    // 悠闲节奏：奔跑约3.8帧/秒、散步约2.8帧/秒、生活动作约1.7帧/秒。
    draw();if(frames.length>1)spriteTimer=setInterval(draw,action==="run"?260:(action==="walk"?360:600));
  }
  function setLabel(text){if(name)name.textContent=text||"蓝喵助手";}
  function setToggle(){if(toggle){toggle.textContent=enabled?"🐾 活动":"🐾 唤醒";toggle.title=enabled?"点击让蓝喵原地休息":"点击恢复蓝喵活动";}btn.classList.toggle("pet-disabled",!enabled);}
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
    // 每轮将32个核心动作随机洗牌后逐一消费；未轮完前绝不再次抽中已消费动作。
    const index=actionDeck.findIndex(key=>key!==current&&(allowMove||!ACTIONS.find(a=>a.key===key).move));
    if(index<0){
      // 若本轮只剩位移动作但尚处于漫游冷却期，临时休息且不消费动作牌。
      return ACTIONS.find(a=>a.key==="rest");
    }
    const key=actionDeck.splice(index,1)[0],action=ACTIONS.find(a=>a.key===key);
    if(action.move)nextRoamAt=Date.now()+20000+Math.random()*8000;
    return action;
  }
  function destination(action){
    const r=btn.getBoundingClientRect(),margin=12,maxX=Math.max(margin,innerWidth-r.width-margin),maxY=Math.max(margin,innerHeight-r.height-margin);
    const range=action.key==="walk"?Math.min(240,innerWidth*.2):Math.min(360,innerWidth*.32);
    let left=Math.round(Math.max(margin,Math.min(maxX,r.left+(Math.random()-.5)*range*2)));
    if(Math.abs(left-r.left)<70)left=Math.round(Math.max(margin,Math.min(maxX,r.left+(Math.random()<.5?-1:1)*range*.65)));
    const roamY=Math.max(margin,Math.min(maxY,r.top+(Math.random()-.5)*(action.key==="walk"?55:90)));
    const top=action.key==="sleep"?Math.round(maxY):Math.round(roamY);
    return{left,top,from:r.left};
  }
  function talk(force){
    if(!bubble||(!force&&!canAct()))return;
    let i=Math.floor(Math.random()*PHRASES.length);if(i===lastPhrase)i=(i+1)%PHRASES.length;lastPhrase=i;
    bubble.textContent=PHRASES[i];bubble.classList.remove("pet-talk");void bubble.offsetWidth;bubble.classList.add("pet-talk");
  }
  function clearTimer(){if(timer){clearTimeout(timer);timer=null;}}
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
      const d=destination(action),distance=Math.hypot(d.left-d.from,d.top-btn.getBoundingClientRect().top),speed=action.key==="walk"?55:(action.key==="run"?110:82),seconds=Math.max(action.key==="walk"?2.8:2,Math.min(6.8,distance/speed));
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
  function setEnabled(value){enabled=!!value;try{localStorage.setItem(PET_KEY,enabled?"1":"0");}catch(_){}setToggle();clearTimer();if(enabled){if(!actionDeck.length)refillActionDeck();consumeDeckAction("wave");talk(true);perform("wave");}else{btn.classList.remove("pet-moving","pet-facing-left");perform("rest");setLabel("休息中");}}
  function start(){setToggle();refillActionDeck();btn.dataset.petAction="idle";showSprite("idle");setTimeout(()=>{if(enabled){consumeDeckAction("wave");talk(true);perform("wave");}},480);}
  function yieldToUser(event){
    if(!enabled||btn.contains(event.target)||panel.contains(event.target))return;
    quietUntil=Date.now()+650;
    if(bubble)bubble.classList.remove("pet-talk");
  }

  toggle&&toggle.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();setEnabled(!enabled);});
  // CSS位移中先把猫咪冻结在鼠标按下的位置，保证pointerup/click仍落在同一元素上。
  btn.addEventListener("pointerdown",()=>{freezeMovement();clearTimer();},true);
  btn.addEventListener("pointerup",()=>{btn.classList.remove("pet-paused");if(enabled&&!panel.classList.contains("open"))timer=setTimeout(()=>perform(randomAction()),3000);},true);
  btn.addEventListener("mouseenter",()=>{
    hovered=true;busy=true;clearTimer();freezeMovement();setLabel("点我问问题");
    if(hoverTimer)clearTimeout(hoverTimer);
    hoverTimer=setTimeout(()=>{hovered=false;busy=false;hoverTimer=null;if(enabled&&!panel.classList.contains("open"))perform(randomAction());},1100);
  });
  btn.addEventListener("mouseleave",()=>{if(hoverTimer){clearTimeout(hoverTimer);hoverTimer=null;}hovered=false;busy=false;if(enabled&&!panel.classList.contains("open"))timer=setTimeout(()=>perform(randomAction()),2600);});
  new MutationObserver(()=>{
    if(panel.classList.contains("open")){clearTimer();btn.classList.remove("pet-moving");perform("rest");return;}
    // 面板关闭后鼠标可能仍停留在原按钮坐标，旧的 hover/busy 会让宠物永久卡在休息态。
    hovered=false;busy=false;if(hoverTimer){clearTimeout(hoverTimer);hoverTimer=null;}
    if(enabled){clearTimer();timer=setTimeout(()=>perform(randomAction()),3000);}
  }).observe(panel,{attributes:true,attributeFilter:["class"]});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)clearTimer();else if(enabled)timer=setTimeout(()=>perform(randomAction()),450);});
  document.addEventListener("pointerdown",yieldToUser,true);
  document.addEventListener("keydown",yieldToUser,true);
  reduced.addEventListener&&reduced.addEventListener("change",()=>{clearTimer();if(!reduced.matches&&enabled)perform("idle");});
  root.AgentPet={actions:ACTIONS.map(a=>({key:a.key,label:a.label})),phrases:PHRASES.slice(),perform,setEnabled,isEnabled:()=>enabled,talk,
    animationStats:()=>({coreFrames:32,virtualFrames:Object.values(SPRITE_FRAMES).reduce((n,frames)=>n+frames.length,0),roamInterval:"20-28s",actionPause:"4.5-7.5s",tempo:"leisurely",cycleMode:"shuffle-without-repeat",cycleNo:actionCycleNo,cycleRemaining:actionDeck.length}),
    previewShuffledCycle:()=>shuffledActionKeys()};
  start();
})(window);
