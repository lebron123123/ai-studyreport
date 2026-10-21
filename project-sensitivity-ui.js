(function(){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>v==null?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:4});
  function monthlyComparison(scenario,baseline){
    const current=new Map(scenario.map(m=>[m.date,m])),base=new Map(baseline.map(m=>[m.date,m]));
    return [...new Set([...current.keys(),...base.keys()])].sort().map(date=>{
      const m=current.get(date)||{date,inflow:0,engineering:0,operations:0,interest:0,net:0};
      return '<tr><td>'+esc(date)+(current.has(date)?'':'（情景已无此月）')+'</td>'+['inflow','engineering','operations','interest','net'].map(k=>'<td>'+fmt(m[k])+'</td>').join('')+'<td>'+fmt(m.net-(base.get(date)?.net||0))+'</td></tr>';
    }).join('');
  }
  async function mount(host,options={}){
    let records=[],selected=null,result=null,busy=false,token=0;
    const cfg=JSON.parse(JSON.stringify({...NRCalc.defaults,...options.config}));
    host.innerHTML='<h2>真实项目影响分析 · 安居乐寓版</h2><p>全量输入核对，不按现有“关键指标”预筛选。比较的是所设情景下的模型影响，不是实际经营预测，也不代表因果证据。</p>'
      +'<label>项目范围 <select data-role="scope"><option value="group">集团经验库（已审核）</option><option value="private">我的自测项目</option></select></label> '
      +'<select data-role="project" aria-label="分析项目"></select> <button data-role="reload" class="btn sm">重新读取</button>'
      +'<p data-role="status" role="status"></p><div data-role="setup"></div><div data-role="output"></div>';
    const el=k=>host.querySelector('[data-role="'+k+'"]'),say=s=>{el('status').textContent=s;};
    function setup(){
      result=null;el('output').innerHTML='';selected=records.find(r=>r.id===el('project').value);el('setup').innerHTML='';if(!selected)return;
      const rows=ProjectSensitivity.inventory(selected.params);
      el('setup').innerHTML='<p>记录：'+esc(selected.projectName)+' · 修订 '+esc(selected.revision)+'。所有情景只操作副本，不修改项目、不发布全局排名。</p>'
        +'<p>默认：金额/比例系数 ±5%；出租率 ±5个百分点；百分数输入 ±5个百分点；整数 ±1；日期 ±1个月。边界截到合法范围，零值需自行设置。可修改两端值后运行。</p>'
        +'<p>日期联动：运营开始与整个爬坡期同步移动，运营结束固定；调整稳定期开始/爬坡结束时重排阶段，按原时间段取值、超出延用末值。模式情景使用本项目已填的支付与分成比例。</p>'
        +'<details><summary>全部输入与情景范围（'+rows.length+'项，逐阶段列出爬坡率）</summary><div style="overflow:auto;max-height:520px"><table class="tbl"><thead><tr><th>输入 / 单位</th><th>基准</th><th>情景A</th><th>情景B</th><th>说明</th></tr></thead><tbody>'
        +rows.map((r,i)=>{const values=r.reason?[]:ProjectSensitivity.defaults(r);return '<tr><td>'+esc(r.label)+'<small> '+esc(r.key)+' '+esc(r.unit)+'</small></td><td>'+esc(r.value)+'</td>'+[0,1].map(j=>'<td>'+(r.reason?'—':'<input aria-label="'+esc(r.key)+' 情景'+j+'" data-range="'+i+'" data-side="'+j+'" value="'+esc(values[j])+'" style="width:120px">')+'</td>').join('')+'<td>'+esc(r.reason||'参与重算；比例单位按0—1输入')+'</td></tr>';}).join('')
        +'</tbody></table></div></details><p><button class="btn sm" data-role="run">运行全量交叉验证</button> <button class="btn sm ghost" data-role="cancel" disabled>取消</button></p>';
      el('run').onclick=run;el('cancel').onclick=()=>{token++;say('正在取消…');};
      say('已读取项目，请核对范围后运行；不完整的项目会被明确拦截。');
    }
    async function reload(){
      if(busy)return;const current=++token;selected=null;result=null;el('setup').innerHTML='';el('output').innerHTML='';el('project').innerHTML='';say('正在读取项目…');
      try{
        const response=await fetch('/api/calcexperience?type=gaibao&scope='+el('scope').value,{headers:options.headers?.()||{}}),data=await response.json();
        if(!response.ok||!data.ok)throw Error(data.error||'读取失败');if(current!==token||!host.isConnected)return;
        const model=await import('./calc-experience-model.mjs');if(current!==token||!host.isConnected)return;
        records=data.records.filter(r=>r.projectType==='gaibao'&&(el('scope').value==='private'||r.status==='confirmed')).map(r=>({...r,params:model.buildParameters(data.metrics.filter(m=>m.recordId===r.id),r.payload?.params||{})}));
        el('project').innerHTML=records.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.projectName)+'</option>').join('');
        if(!records.length){say('没有可用项目。请先保存完整测算；集团项目需审核通过。');return;}setup();
      }catch(e){if(current===token)say('读取失败：'+e.message+'。可点击重新读取。');}
    }
    function controls(disabled){['scope','project','reload','run'].forEach(k=>{if(el(k))el(k).disabled=disabled;});host.querySelectorAll('[data-range]').forEach(x=>x.disabled=disabled);if(el('cancel'))el('cancel').disabled=!disabled;}
    async function run(){
      if(busy||!selected)return;busy=true;const current=++token;controls(true);el('output').innerHTML='';result=null;
      try{
        const rows=ProjectSensitivity.inventory(selected.params),ranges={};
        host.querySelectorAll('[data-range]').forEach(input=>{const r=rows[Number(input.dataset.range)],v=input.value.trim();(ranges[r.key]||(ranges[r.key]=[]))[Number(input.dataset.side)]=['month','mode'].includes(r.kind)?v:(v===''?NaN:Number(v));});
        const next=await ProjectSensitivity.analyze(selected.params,cfg,{ranges,project:{id:selected.id,name:selected.projectName,revision:selected.revision,scope:el('scope').value},cancelled:()=>current!==token||!host.isConnected,progress:(n,total)=>say('逐项验证 '+n+' / '+total)});
        if(current!==token||!host.isConnected)return;result=next;draw();say('分析完成。失败、零影响及未登记项均保留；请逐项核对覆盖台账。');
      }catch(e){say(e.message);}finally{busy=false;controls(false);}
    }
    function draw(metric='irr'){
      const r=result,units=metric==='irr'?'个百分点':'万元',amplitude=row=>Math.max(0,...(row.scenarios||[]).map(s=>Math.abs(s.delta?.[metric]??0))),ordered=r.rows.filter(x=>!x.reason).sort((a,b)=>amplitude(b)-amplitude(a)),max=Math.max(1e-9,...ordered.map(amplitude));
      const old=options.previous?.table||[],prior=key=>{const i=old.findIndex(x=>x.key===key.split('.')[0]);return i<0?'旧排名未覆盖':('旧排名第'+(i+1)+' · '+(old[i].impactLabel||'未分级'));};
      el('output').innerHTML='<h3>基准：XIRR '+fmt(r.baseline.irr)+'% · 净现值 '+fmt(r.baseline.npv)+'万元 · 最大累计净现金流缺口 '+fmt(r.baseline.gap)+'万元</h3>'
        +'<p>资金缺口沿用现有净现金流口径，不另加融资流入。共 '+r.rows.length+' 项：重算 '+ordered.length+' 项，分类说明 '+r.rows.filter(x=>x.reason).length+' 项；异常情景 '+ordered.reduce((n,x)=>n+x.scenarios.filter(s=>s.error).length,0)+' 个。所有结果限于所选范围，单因素分析不证明全局最大影响或交互效应。</p>'
        +'<label>排序指标 <select data-role="metric"><option value="irr">月度XIRR</option><option value="npv">净现值</option><option value="gap">最大资金缺口</option></select></label> <button class="btn sm" data-role="save">保存分析版本（JSON下载）</button>'
        +'<p>龙卷风图：中线为基准，左侧为减少、右侧为增加；蓝色=情景A，棕色=情景B。排序按两端最大绝对变化。零影响只代表当前情景。</p>'
        +'<div style="overflow:auto"><table class="tbl" style="width:100%;min-width:760px"><thead><tr><th>参数 / 旧排名交叉核对</th><th style="width:32%">影响幅度（'+units+'）</th><th>A变化</th><th>B变化</th><th>明细</th></tr></thead><tbody>'
        +ordered.map((row,i)=>{const scenarios=row.scenarios,bars=scenarios.map((s,j)=>{const d=s.delta?.[metric];if(d==null)return '';const width=Math.abs(d)/max*49;return '<span style="position:absolute;top:'+(j*11+2)+'px;height:9px;background:'+(j?'#9a6b25':'#286baf')+';left:'+(d<0?50-width:50)+'%;width:'+width+'%"></span>';}).join('');return '<tr><td>'+esc(row.label)+'<small> '+esc(prior(row.key))+'</small></td><td><div style="position:relative;height:26px;background:linear-gradient(to right,transparent 49.8%,#778899 50%,transparent 50.2%)">'+bars+'</div></td>'+scenarios.map(s=>'<td>'+esc(s.error?'失败：'+s.error:s.delta?.[metric]==null?'无有效收益率':fmt(s.delta[metric]))+'</td>').join('')+'<td><button data-detail="'+i+'">查看月度</button></td></tr>';}).join('')+'</tbody></table></div>'
        +'<details><summary>未参与排名的输入（不遗漏）</summary>'+r.rows.filter(x=>x.reason).map(x=>'<p>'+esc(x.label)+' ['+esc(x.key)+']：'+esc(x.value)+' — '+esc(x.reason)+'</p>').join('')+'</details>'
        +'<details><summary>本次公式配置（固定，不作为项目经营输入扰动）</summary><pre>'+esc(JSON.stringify(r.config,null,2))+'</pre></details><div data-role="detail"></div>';
      el('metric').value=metric;el('metric').onchange=()=>draw(el('metric').value);
      el('save').onclick=()=>{const blob=new Blob([JSON.stringify(r,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='安居乐寓版-项目影响分析-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
      host.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>{
        const row=ordered[Number(b.dataset.detail)];el('detail').innerHTML='<h3>'+esc(row.label)+'：月度明细</h3>'+row.scenarios.map((s,j)=>'<details><summary>情景'+(j?'B':'A')+' 输入 '+esc(s.value)+'</summary>'+(s.error?esc(s.error):'<div style="overflow:auto;max-height:400px"><table class="tbl"><tr><th>月份</th><th>收入</th><th>工程</th><th>运营</th><th>利息</th><th>净现金流</th><th>较基准净现金流</th></tr>'+monthlyComparison(s.output.months,r.baseline.months)+'</table></div>')+'</details>').join('');
      });
    }
    el('project').onchange=setup;el('scope').onchange=reload;el('reload').onclick=reload;await reload();
  }
  window.ProjectSensitivityUI={mount};
})();
