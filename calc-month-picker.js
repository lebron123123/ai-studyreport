(function(){
  'use strict';
  const MONTHS=['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  let activeInput=null,view='months',viewYear=new Date().getFullYear(),decadeStart=Math.floor(viewYear/12)*12,popover=null;

  function parse(value){const match=String(value||'').match(/^(\d{4})-(\d{2})$/);return match?{year:Number(match[1]),month:Number(match[2])}:null;}
  function ensurePopover(){
    if(popover)return popover;
    popover=document.createElement('div');popover.className='calc-month-popover';popover.hidden=true;
    popover.setAttribute('role','dialog');popover.setAttribute('aria-label','年月选择器');
    popover.innerHTML='<div class="calc-month-head"><button type="button" data-cmp-prev aria-label="上一组">‹</button><button type="button" class="calc-month-title" data-cmp-title></button><button type="button" data-cmp-next aria-label="下一组">›</button></div><div class="calc-month-jump"><label>快速跳到年份 <input type="number" min="1900" max="2200" step="1" data-cmp-year></label><button type="button" data-cmp-jump>跳转</button></div><div class="calc-month-grid" data-cmp-grid></div><div class="calc-month-foot"><span>点年份可切换到多年视图</span><button type="button" data-cmp-current>本月</button></div>';
    document.body.appendChild(popover);
    popover.addEventListener('click',onPopoverClick);
    popover.querySelector('[data-cmp-year]').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();jumpToYear();}});
    return popover;
  }
  function render(){
    const box=ensurePopover(),selected=parse(activeInput&&activeInput.value),title=box.querySelector('[data-cmp-title]'),grid=box.querySelector('[data-cmp-grid]');
    box.dataset.view=view;box.querySelector('[data-cmp-year]').value=String(viewYear);
    if(view==='months'){
      title.textContent=viewYear+'年 · 查看多年';title.setAttribute('aria-label','当前'+viewYear+'年，点击选择其他年份');
      grid.innerHTML=MONTHS.map((name,index)=>{const month=index+1,chosen=selected&&selected.year===viewYear&&selected.month===month;return '<button type="button" data-cmp-month="'+month+'"'+(chosen?' class="selected" aria-current="date"':'')+'>'+name+'</button>';}).join('');
    }else{
      title.textContent=decadeStart+'–'+(decadeStart+11)+'年 · 返回月份';title.setAttribute('aria-label','当前年份范围，点击返回月份');
      grid.innerHTML=Array.from({length:12},(_,index)=>{const year=decadeStart+index,chosen=selected&&selected.year===year;return '<button type="button" data-cmp-pick-year="'+year+'"'+(chosen?' class="selected" aria-current="date"':'')+'>'+year+'</button>';}).join('');
    }
  }
  function position(){
    if(!activeInput||!popover||popover.hidden)return;const rect=activeInput.getBoundingClientRect(),margin=10,width=Math.min(390,window.innerWidth-margin*2),left=Math.max(margin,Math.min(rect.left,window.innerWidth-width-margin));
    popover.style.width=width+'px';popover.style.left=left+'px';popover.style.top='0px';
    const height=popover.offsetHeight,below=rect.bottom+8,top=below+height<=window.innerHeight-margin?below:Math.max(margin,rect.top-height-8);popover.style.top=top+'px';
  }
  function open(input){
    activeInput=input;const selected=parse(input.value),today=new Date();viewYear=selected?selected.year:today.getFullYear();decadeStart=Math.floor(viewYear/12)*12;view='months';
    const box=ensurePopover();box.hidden=false;render();position();input.setAttribute('aria-expanded','true');
  }
  function close(){if(activeInput)activeInput.setAttribute('aria-expanded','false');activeInput=null;if(popover)popover.hidden=true;}
  function chooseMonth(month){if(!activeInput)return;activeInput.value=String(viewYear).padStart(4,'0')+'-'+String(month).padStart(2,'0');activeInput.dispatchEvent(new Event('input',{bubbles:true}));activeInput.dispatchEvent(new Event('change',{bubbles:true}));close();}
  function jumpToYear(){const value=Number(popover.querySelector('[data-cmp-year]').value);if(!Number.isInteger(value)||value<1900||value>2200)return;viewYear=value;decadeStart=Math.floor(value/12)*12;view='months';render();position();}
  function onPopoverClick(event){
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-cmp-prev')){if(view==='months')viewYear--;else decadeStart-=12;render();position();return;}
    if(button.hasAttribute('data-cmp-next')){if(view==='months')viewYear++;else decadeStart+=12;render();position();return;}
    if(button.hasAttribute('data-cmp-title')){view=view==='months'?'years':'months';if(view==='years')decadeStart=Math.floor(viewYear/12)*12;render();position();return;}
    if(button.hasAttribute('data-cmp-jump')){jumpToYear();return;}
    if(button.hasAttribute('data-cmp-month')){chooseMonth(Number(button.dataset.cmpMonth));return;}
    if(button.hasAttribute('data-cmp-pick-year')){viewYear=Number(button.dataset.cmpPickYear);view='months';render();position();return;}
    if(button.hasAttribute('data-cmp-current')){const now=new Date();viewYear=now.getFullYear();chooseMonth(now.getMonth()+1);}
  }
  function mount(root){
    (root||document).querySelectorAll('[data-calc-month]').forEach(input=>{
      if(input.dataset.cmpReady)return;input.dataset.cmpReady='1';input.setAttribute('aria-haspopup','dialog');input.setAttribute('aria-expanded','false');
      input.addEventListener('click',()=>open(input));input.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open(input);}else if(event.key==='Escape')close();});
    });
    (root||document).querySelectorAll('[data-calc-month-for]').forEach(button=>{if(button.dataset.cmpReady)return;button.dataset.cmpReady='1';button.addEventListener('click',()=>{const input=document.getElementById(button.dataset.calcMonthFor);if(input)open(input);});});
  }
  document.addEventListener('pointerdown',event=>{if(!activeInput||event.target===activeInput||event.target.closest('[data-calc-month-for]')||event.target.closest('.calc-month-popover'))return;close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  window.CalcMonthPicker={mount,close};
})();
