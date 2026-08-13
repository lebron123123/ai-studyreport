(function(){
  "use strict";

  let active=null;

  function seeded(seed){let x=seed|0;return()=>{x=Math.imul(1664525,x)+1013904223|0;return(x>>>0)/4294967296;};}

  const PALETTES=[
    ["#C5ECFC","#86CFF2","#389ED5"],
    ["#A6DFF8","#5DB8E7","#197AAF"],
    ["#D7F1FC","#92D6F5","#43A5D9"],
    ["#8ED4F3","#3BA5DD","#0D669A"]
  ];

  function facade(ctx,b,palette,rnd){
    const {x,y,w,h}=b,base=y+h,side=Math.max(3,Math.min(8,w*.17));
    ctx.save();
    const g=ctx.createLinearGradient(x,y,x+w,y);
    g.addColorStop(0,palette[0]);g.addColorStop(.55,palette[1]);g.addColorStop(1,palette[2]);
    ctx.fillStyle=g;
    if(b.shape==="spire"){
      ctx.beginPath();ctx.moveTo(x,base);ctx.lineTo(x,y+16);ctx.lineTo(x+w*.30,y+16);ctx.lineTo(x+w*.43,y-18);ctx.lineTo(x+w*.50,y-42);ctx.lineTo(x+w*.57,y-18);ctx.lineTo(x+w*.70,y+16);ctx.lineTo(x+w,y+16);ctx.lineTo(x+w,base);ctx.closePath();ctx.fill();
    }else if(b.shape==="round"){
      ctx.beginPath();ctx.moveTo(x,base);ctx.lineTo(x,y+8);ctx.quadraticCurveTo(x+w*.5,y-8,x+w,y+8);ctx.lineTo(x+w,base);ctx.closePath();ctx.fill();
    }else if(b.shape==="slope"){
      ctx.beginPath();ctx.moveTo(x,base);ctx.lineTo(x,y+10);ctx.lineTo(x+w*.72,y);ctx.lineTo(x+w,y+5);ctx.lineTo(x+w,base);ctx.closePath();ctx.fill();
    }else if(b.shape==="step"){
      ctx.fillRect(x,y+10,w,h-10);ctx.fillRect(x+w*.13,y+5,w*.74,7);ctx.fillRect(x+w*.31,y,w*.38,6);
    }else ctx.fillRect(x,y,w,h);

    // 立体侧面
    ctx.fillStyle="rgba(5,80,126,.20)";
    ctx.beginPath();ctx.moveTo(x+w-side,y+Math.min(12,h*.08));ctx.lineTo(x+w,y+(b.shape==="flat"?0:8));ctx.lineTo(x+w,base);ctx.lineTo(x+w-side,base);ctx.closePath();ctx.fill();

    const cols=Math.max(2,Math.floor(w/7)),floors=Math.max(3,Math.floor(h/7));
    ctx.strokeStyle="rgba(239,252,255,.64)";ctx.lineWidth=.45;
    for(let c=1;c<cols;c++){const xx=x+w*c/cols;ctx.beginPath();ctx.moveTo(xx,y+12);ctx.lineTo(xx,base);ctx.stroke();}
    for(let f=1;f<floors;f++){const yy=base-h*f/floors;ctx.beginPath();ctx.moveTo(x+1,yy);ctx.lineTo(x+w-1,yy);ctx.stroke();}
    // 深浅窗点
    for(let f=1;f<floors;f++)for(let c=0;c<cols;c++){
      if((f+c)%3===0||rnd()<.12){ctx.fillStyle=rnd()<.35?"rgba(5,84,132,.40)":"rgba(235,251,255,.72)";ctx.fillRect(x+1.6+c*w/cols,base-(f+.55)*h/floors,Math.max(.8,w/cols*.25),1.25);}
    }
    // 屋顶构件
    if(b.antenna){ctx.strokeStyle="#176D9E";ctx.lineWidth=1;const cx=x+w*.52;ctx.beginPath();ctx.moveTo(cx-3,y);ctx.lineTo(cx-3,y-19);ctx.moveTo(cx+4,y);ctx.lineTo(cx+4,y-19);ctx.stroke();}
    if(b.roofBox){ctx.fillStyle=palette[1];ctx.fillRect(x+w*.35,y-5,w*.3,6);}
    ctx.restore();
  }

  function makeModule(moduleX,moduleW,base,scale,seed){
    const rnd=seeded(seed),arr=[];
    const add=(px,pw,ph,opt)=>arr.push({x:moduleX+px*moduleW,w:pw*moduleW,h:ph*scale,y:base-ph*scale,...(opt||{})});
    // 后排：细密、浅色，构成参考图远景。
    add(.00,.055,64,{layer:0});add(.045,.046,92,{layer:0,shape:"spire"});add(.09,.038,56,{layer:0});
    add(.125,.047,115,{layer:0,shape:"slope"});add(.17,.040,72,{layer:0});add(.208,.036,145,{layer:0,shape:"spire"});
    add(.245,.042,86,{layer:0});add(.285,.050,122,{layer:0});add(.333,.040,68,{layer:0});
    add(.372,.046,110,{layer:0});add(.42,.038,82,{layer:0});add(.455,.050,137,{layer:0});
    add(.505,.036,74,{layer:0});add(.545,.046,101,{layer:0});add(.59,.040,66,{layer:0});
    add(.63,.051,118,{layer:0});add(.68,.035,78,{layer:0});add(.72,.047,93,{layer:0});
    add(.77,.040,72,{layer:0});add(.81,.048,105,{layer:0});add(.86,.042,68,{layer:0});add(.905,.054,90,{layer:0});
    // 中排：参考图中可识别的塔楼节奏。
    add(.018,.062,104,{layer:1,shape:"step"});add(.09,.070,126,{layer:1,shape:"slope"});
    add(.175,.055,172,{layer:1,shape:"spire"});add(.245,.067,134,{layer:1,shape:"step",roofBox:true});
    add(.33,.062,150,{layer:1});add(.415,.055,112,{layer:1,shape:"round"});
    add(.49,.064,190,{layer:1,antenna:true});add(.565,.061,119,{layer:1});
    add(.64,.064,142,{layer:1,shape:"slope"});add(.72,.055,103,{layer:1});
    add(.79,.066,154,{layer:1,roofBox:true});add(.875,.070,125,{layer:1});
    // 前排：较宽方块楼与住宅板楼，底部连续。
    add(.00,.080,72,{layer:2});add(.07,.072,96,{layer:2});add(.14,.075,62,{layer:2});
    add(.215,.083,88,{layer:2,shape:"step"});add(.30,.070,70,{layer:2});add(.365,.083,108,{layer:2});
    add(.45,.073,82,{layer:2});add(.52,.085,66,{layer:2});add(.605,.075,96,{layer:2});
    add(.68,.081,74,{layer:2});add(.76,.075,104,{layer:2});add(.835,.087,79,{layer:2});add(.92,.080,62,{layer:2});
    return arr;
  }

  function renderBackdrop(ctx,w,h){
    ctx.save();ctx.strokeStyle="rgba(149,202,231,.15)";ctx.lineWidth=42;ctx.beginPath();ctx.arc(w*.83,h*.15,w*.28,Math.PI*.70,Math.PI*1.53);ctx.stroke();ctx.lineWidth=24;ctx.strokeStyle="rgba(183,220,239,.18)";ctx.beginPath();ctx.arc(w*.83,h*.15,w*.36,Math.PI*.72,Math.PI*1.52);ctx.stroke();ctx.restore();
  }

  function renderCity(ctx,w,h){
    ctx.clearRect(0,0,w,h);const base=h-10,scale=Math.min(1.06,w/880),moduleW=w*.515;
    const all=[...makeModule(-moduleW*.015,moduleW,base,scale,1213),...makeModule(moduleW*.94,moduleW,base,scale,5719)];
    const rnd=seeded(8808);
    [0,1,2].forEach(layer=>all.filter(b=>b.layer===layer).forEach((b,i)=>facade(ctx,b,PALETTES[(i+layer)%PALETTES.length],rnd)));
    const ground=ctx.createLinearGradient(0,base-7,0,h);ground.addColorStop(0,"rgba(35,130,184,.34)");ground.addColorStop(1,"rgba(142,211,241,.12)");ctx.fillStyle=ground;ctx.fillRect(0,base-6,w,8);
  }

  function sampleCity(mask,w,h,reduced){
    const data=mask.getContext("2d").getImageData(0,0,w,h).data,rnd=seeded(813),gap=w<620?3:2,points=[];
    for(let y=0;y<h;y+=gap)for(let x=0;x<w;x+=gap){
      const i=(y*w+x)*4,a=data[i+3];
      if(a>38&&rnd()<.92)points.push({tx:x,ty:y,r:data[i],g:data[i+1],b:data[i+2],a:a/255});
    }
    const max=reduced?1700:(w<620?3600:7200);
    if(points.length<=max)return points;
    const picked=[],stride=points.length/max;for(let i=0;i<max;i++)picked.push(points[Math.floor(i*stride)]);return picked;
  }

  function cycle(now,s){
    if(s.reduced)return{mix:1,energy:0};
    const elapsed=(now-s.started)/1000;
    if(elapsed<2.15)return{mix:ease(elapsed/2.15),energy:1-elapsed/2.15};
    const t=(elapsed-2.15)%10.2;
    if(t<4.2)return{mix:1,energy:0};
    if(t<5.8)return{mix:1-ease((t-4.2)/1.6),energy:(t-4.2)/1.6};
    if(t<7.0)return{mix:0,energy:1};
    return{mix:ease((t-7.0)/3.2),energy:1-(t-7.0)/3.2};
  }

  function ease(t){t=Math.max(0,Math.min(1,t));return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}

  function draw(s,now){
    if(!active||active!==s||s.paused)return;
    const ctx=s.ctx,{mix,energy}=cycle(now,s),m=s.mouse;
    ctx.clearRect(0,0,s.w,s.h);renderBackdrop(ctx,s.w,s.h);
    // 完整形态时恢复已确认的原始静态城市图；粒子化开始后快速淡出。
    const imageAlpha=Math.max(0,Math.min(1,(mix-.82)/.18));
    if(imageAlpha>0){ctx.globalAlpha=imageAlpha;ctx.drawImage(s.mask,0,0);ctx.globalAlpha=1;}
    const pointerX=m.active?(m.x/s.w-.5)*5:0,pointerY=m.active?(m.y/s.h-.5)*2.5:0;
    const particleAlpha=1-imageAlpha*.76;
    for(const p of s.particles){
      const local=Math.max(0,Math.min(1,(mix-p.delay)/(1-p.delay))),e=ease(local);
      const fx=Math.sin(now*.00045+p.phase)*13*energy,fy=Math.cos(now*.00038+p.phase)*9*energy;
      let gx=p.sx+(p.tx-p.sx)*e+fx+pointerX*e,gy=p.sy+(p.ty-p.sy)*e+fy+pointerY*e;
      if(m.active&&m.speed>.08){const dx=gx-m.x,dy=gy-m.y,d=Math.hypot(dx,dy);if(d<72&&d>0){const f=(72-d)/72*17*m.speed;gx+=dx/d*f;gy+=dy/d*f;}}
      p.x+=(gx-p.x)*(.052+.078*e);p.y+=(gy-p.y)*(.052+.078*e);
      ctx.globalAlpha=Math.max(.08,p.a*particleAlpha);ctx.fillStyle=`rgb(${p.r},${p.g},${p.b})`;const z=p.size*(.82+.22*e);ctx.fillRect(p.x-z*.5,p.y-z*.5,z,z);
    }
    ctx.globalAlpha=1;m.speed*=.9;s.raf=requestAnimationFrame(t=>draw(s,t));
  }

  function resize(s){
    const r=s.host.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.5);
    s.w=Math.max(280,Math.round(r.width));s.h=Math.max(250,Math.round(r.height));s.canvas.width=Math.round(s.w*dpr);s.canvas.height=Math.round(s.h*dpr);s.canvas.style.width=s.w+"px";s.canvas.style.height=s.h+"px";s.ctx.setTransform(dpr,0,0,dpr,0,0);
    const mask=document.createElement("canvas");mask.width=s.w;mask.height=s.h;renderCity(mask.getContext("2d"),s.w,s.h);s.mask=mask;
    const targets=sampleCity(mask,s.w,s.h,s.reduced),rnd=seeded(1314+s.w);
    s.particles=targets.map((t,i)=>{
      const side=rnd();let sx,sy;
      const safeTop=s.h*.30;
      if(side<.40){sx=-30-rnd()*s.w*.34;sy=safeTop+rnd()*(s.h-safeTop);}
      else if(side<.80){sx=s.w+30+rnd()*s.w*.34;sy=safeTop+rnd()*(s.h-safeTop);}
      else{sx=rnd()*s.w;sy=s.h+22+rnd()*s.h*.26;}
      return{...t,sx,sy,x:sx,y:sy,size:.72+rnd()*.88,phase:rnd()*Math.PI*2,delay:rnd()*.18};
    });
  }

  function destroy(){if(!active)return;cancelAnimationFrame(active.raf);active.ro&&active.ro.disconnect();document.removeEventListener("visibilitychange",active.visibility);active=null;}
  function mount(id){
    destroy();const host=document.getElementById(id),canvas=host&&host.querySelector("canvas");if(!canvas||!canvas.getContext)return;
    const reduced=!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const s=active={host,canvas,ctx:canvas.getContext("2d"),mask:null,particles:[],w:0,h:0,started:performance.now(),raf:0,paused:false,reduced,mouse:{x:0,y:0,lx:0,ly:0,at:performance.now(),speed:0,active:false}};
    resize(s);
    host.onpointermove=e=>{const r=host.getBoundingClientRect(),now=performance.now(),x=e.clientX-r.left,y=e.clientY-r.top,dt=Math.max(16,now-s.mouse.at);s.mouse.speed=Math.min(1,Math.hypot(x-s.mouse.lx,y-s.mouse.ly)/dt*.14);Object.assign(s.mouse,{x,y,lx:x,ly:y,at:now,active:true});};
    host.onpointerleave=()=>{s.mouse.active=false;s.mouse.speed=0;};
    s.visibility=()=>{s.paused=document.hidden;if(!s.paused)s.raf=requestAnimationFrame(t=>draw(s,t));};document.addEventListener("visibilitychange",s.visibility);
    s.ro=new ResizeObserver(()=>resize(s));s.ro.observe(host);s.raf=requestAnimationFrame(t=>draw(s,t));
  }
  window.HousingParticles={mount,destroy};
})();
