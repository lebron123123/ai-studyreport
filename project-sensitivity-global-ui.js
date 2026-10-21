(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=v=>Number.isFinite(v)?v.toFixed(5):'—';
 async function mount(host,options={}){
  let records=[],selected,result,busy=false,token=0,applied=options.previous,lab=null,selection=null,labDisabled=[];
  const usedIdentities=new Set();
  let classifications=Object.fromEntries((options.previous?.table||[]).filter(r=>['actual','assumed','fixed'].includes(r.policy)).map(r=>[r.key,r.policy]));
  const cfg=JSON.parse(JSON.stringify({...NRCalc.defaults,...options.config}));
  host.innerHTML='<style>.psg-panel{padding:20px;border:1px solid #cfdeea;border-radius:12px;background:#fff}.psg-panel h2{margin-top:0}.psg-panel input{width:110px;padding:7px}.psg-panel select{padding:8px}.psg-panel details{border:1px solid #dce6ee;border-radius:8px;margin:12px 0;padding:12px}.psg-panel summary{cursor:pointer;color:#245e89;font-weight:600}.psg-panel .psg-bar{height:8px;background:#317bb0;border-radius:4px}.psg-panel td,.psg-panel th{padding:10px;text-align:left}.psg-panel small{display:block;color:#718096}.psg-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:14px 0}</style>'
   +'<div class="psg-panel"><h2>真实项目 · 全局敏感性排名</h2><p>安居乐寓版月度 XIRR｜Sobol 总效应 STi + Spearman + 标准化回归 SRC。全量独立输入共同抽样，不沿用旧关键指标预筛选。</p>'
   +'<div class="psg-actions"><select data-role="scope"><option value="group">集团经验库（已审核）</option><option value="private">我的自测项目</option></select><select data-role="project" aria-label="分析项目"></select><button class="btn sm" data-role="reload">重新读取</button></div><p role="status" data-role="status"></p><div data-role="setup"></div><div data-role="output"></div></div>';
  const el=k=>host.querySelector('[data-role="'+k+'"]'),say=s=>{el('status').textContent=s;};
  function setup(){
   result=null;selection=null;lab=null;host.querySelector('[data-role="lab"]')?.remove();el('output').innerHTML='';selected=records.find(r=>r.id===el('project').value);el('setup').innerHTML='';if(!selected)return;
   const rows=ProjectSensitivityGlobal.inventory(selected.params);
   el('setup').innerHTML='<p>'+esc(selected.projectName)+' · 修订 '+esc(selected.revision)+'。仅重算副本；运行不改变项目或全局配置。</p>'
    +'<details><summary>波动范围与全量覆盖台账 · '+rows.length+'项</summary><p>下限—上限均匀抽样；连续数值统一相对±20%（例如贷款利率2.6%→2.08%—3.12%），比例按合法边界截断；整数±1，日期固定。连续变量通常9个测试点，离散变量按可用取值测试；点数不等于波动幅度。零值默认固定，请按实际设置范围；排名取决于这些范围，不代表行业通用结论。</p><p>建设、运营及爬坡日期均作为项目边界固定，不缩短或延长总月份。延期应另行区分“保持运营时长”与“合同结束日固定”，不混入本排名。阶段出租率先抽样，再按间隔重排。合作模式固定为本项目当前值，不参与抽样或排名。</p><div style="overflow:auto;max-height:460px"><table class="tbl"><tr><th>输入</th><th>基准</th><th>下限</th><th>上限</th><th>覆盖说明</th></tr>'
    +rows.map((r,i)=>{const editable=!r.reason||r.reason.startsWith('固定值');return '<tr><td>'+esc(r.label)+'<small>'+esc(r.key)+' '+esc(r.unit)+'</small></td><td>'+esc(r.value)+'</td>'+[0,1].map(j=>'<td>'+(editable?'<input data-range="'+i+'" data-side="'+j+'" aria-label="'+esc(r.key)+' 范围'+j+'" value="'+esc(r.bounds[j])+'">':'—')+'</td>').join('')+'<td>'+esc(r.reason||'独立变量；比例按0—1输入')+'</td></tr>';}).join('')+'</table></div></details>'
    +'<div class="psg-actions"><label>基础样本 N <select data-role="samples"><option value="300">300（初筛）</option><option value="1000">1000（复核）</option><option value="2000">2000（精细复核）</option></select></label><button class="btn sm" data-role="run">运行三方法交叉分析</button><button class="btn sm ghost" data-role="cancel" disabled>取消</button></div>';
   el('run').onclick=run;el('cancel').onclick=()=>{token++;say('正在取消…');};say('请先核对范围。临近 0.001 的结果应增加样本复核。');
   const labHost=document.createElement('div');labHost.dataset.role='lab';el('output').after(labHost);
   lab=ProjectSensitivityValidationUI.mount(labHost,{base:selected,records,config:cfg,used:usedIdentities,selection:()=>selection,ranges:readRanges,
    applyRanges:ranges=>{host.querySelectorAll('[data-range]').forEach(x=>{const row=rows[+x.dataset.range];if(ranges[row.key])x.value=ranges[row.key][+x.dataset.side];});result=null;selection=null;el('output').innerHTML='';},
    begin:()=>{if(busy)return null;busy=true;const current=++token;controls(true);el('output').querySelectorAll('input,button,select').forEach(x=>{labDisabled.push([x,x.disabled]);x.disabled=true;});return {cancelled:()=>current!==token||!host.isConnected};},
    end:()=>{busy=false;controls(false);}
   });
   host.querySelectorAll('[data-range]').forEach(x=>x.oninput=()=>{result=null;selection=null;el('output').innerHTML='';lab.invalidate();say('范围已更改，请重新运行主分析。');});
  }
  function readRanges(){const rows=ProjectSensitivityGlobal.inventory(selected.params),ranges={};host.querySelectorAll('[data-range]').forEach(x=>{const r=rows[+x.dataset.range];(ranges[r.key]||(ranges[r.key]=[]))[+x.dataset.side]=['month','mode'].includes(r.kind)?x.value.trim():x.value.trim()===''?NaN:Number(x.value);});return ranges;}
  async function reload(){
   if(busy)return;const current=++token;selected=null;result=null;selection=null;lab=null;host.querySelector('[data-role="lab"]')?.remove();el('setup').innerHTML='';el('output').innerHTML='';el('project').innerHTML='';say('正在读取项目…');
   try{const response=await fetch('/api/calcexperience?type=gaibao&scope='+el('scope').value,{headers:options.headers?.()||{}}),data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'读取失败');const model=await import('./calc-experience-model.mjs');if(current!==token||!host.isConnected)return;
    records=data.records.filter(r=>r.projectType==='gaibao'&&(el('scope').value==='private'||r.status==='confirmed')).map(r=>({...r,params:model.buildParameters((data.metrics||[]).filter(m=>m.recordId===r.id),r.payload?.params||{})}));el('project').innerHTML=records.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.projectName)+'</option>').join('');if(!records.length){say('没有可用项目，请先保存完整测算；集团项目需审核通过。');return;}setup();
   }catch(e){if(current===token)say('读取失败：'+e.message+'。可重新读取。');}
  }
  function controls(disabled){['scope','project','reload','run','samples'].forEach(k=>{if(el(k))el(k).disabled=disabled;});host.querySelectorAll('[data-range]').forEach(x=>x.disabled=disabled);if(el('cancel'))el('cancel').disabled=!disabled;if(disabled){host.querySelectorAll('[data-role="lab"] input,[data-role="lab"] button,[data-role="lab"] select').forEach(x=>{labDisabled.push([x,x.disabled]);x.disabled=true;});}else{labDisabled.forEach(([x,was])=>x.disabled=was);labDisabled=[];}}
  async function run(){
   if(busy||!selected)return;lab?.invalidate();busy=true;const current=++token;controls(true);result=null;selection=null;el('output').innerHTML='';
   try{const ranges=readRanges();usedIdentities.add(ProjectSensitivityValidation.identity(selected));
    const next=await ProjectSensitivityGlobal.analyze(selected.params,cfg,{N:Number(el('samples').value),ranges,project:{id:selected.id,revision:selected.revision},cancelled:()=>current!==token||!host.isConnected,progress:(n,t)=>say('月度引擎重算 '+n+' / '+t+' 次')});if(current!==token||!host.isConnected)return;result=next;draw();say('分析完成，尚未应用。STi是方差影响指数，不是IRR变动百分点；交互作用下总和不必等于1。');
   }catch(e){say(e.message);}finally{busy=false;controls(false);}
  }
  function draw(state={criteria:{sti:.001,irr:.1,npv:.1,weighted:.1},overrides:{},sort:'overall',policies:classifications}){
   lab?.invalidate();
   const criteria=state.criteria,threshold=criteria.sti;
   const scored=ProjectSensitivityGlobal.scoreImpacts(result.table,result.baseline.npv).map(r=>({...r,policy:state.policies?.[r.key]||ProjectSensitivityGlobal.policy(r.key)}));
   const grade=r=>r.irrImpact.maxDeviation>=1?2:r.irrImpact.maxDeviation>=.3?1:0;
   const overall=scored.slice().sort((a,b)=>b.weightedScore-a.weightedScore||b.irrImpact.maxDeviation-a.irrImpact.maxDeviation||a.combinedRank-b.combinedRank||a.key.localeCompare(b.key));
   const position=new Map(overall.map((r,i)=>[r.key,i+1]));
   const table=state.sort==='overall'?overall:scored.slice().sort((a,b)=>state.sort==='sti'?b.STi-a.STi:state.sort==='npv'?b.npvImpact.maxDeviation-a.npvImpact.maxDeviation:b.irrImpact.maxDeviation-a.irrImpact.maxDeviation);
   const recommended=r=>ProjectSensitivityGlobal.recommend(r,criteria),checked=r=>r.policy!=='fixed'&&(state.overrides[r.key]??recommended(r));
   const chosen=table.filter(checked),excluded=table.filter(r=>r.policy!=='fixed'&&!checked(r)),rules=table.filter(r=>r.policy==='fixed');
   selection={criteria:{...criteria},keys:chosen.map(r=>r.key),policies:Object.fromEntries(table.map(r=>[r.key,r.policy]))};
   const val=v=>typeof v==='number'?Number(v.toFixed(4)):v==='lease'?'整租':v==='share'?'分成':v;
   const change=(r,key,unit)=>'<b>'+val(result.baseline[key])+unit+' → '+val(r[key+'Impact'].min)+'～'+val(r[key+'Impact'].max)+unit+'</b><small>最大偏离 '+val(r[key+'Impact'].maxDeviation)+(key==='irr'?' 个百分点':' 万元')+'</small>';
   const rows=list=>list.map(r=>'<tr><td>'+position.get(r.key)+'</td><td><input style="width:auto" type="checkbox" data-pick="'+esc(r.key)+'" aria-label="选择'+esc(r.label)+'" '+(r.policy==='fixed'?'disabled':checked(r)?'checked':'')+'></td><td>'+esc(r.label)+'<small><select data-policy="'+esc(r.key)+'" aria-label="'+esc(r.label)+'参数性质">'+[['actual','项目实际值'],['assumed','默认待确认'],['fixed','固定规则']].map(([v,label])=>'<option value="'+v+'" '+(r.policy===v?'selected':'')+'>'+label+'</option>').join('')+'</select></small><small>'+['低影响','中影响·复核','高影响'][grade(r)]+'</small><small>'+esc(r.key)+'</small><small>'+(r.policy==='fixed'?'规则压力测试；不作为AI追问项':Object.hasOwn(state.overrides,r.key)?'人工选择':recommended(r)?(r.policy==='assumed'?'达到门槛，需核实默认假设':'达到推荐门槛'):'低于推荐门槛')+'</small></td><td>'+esc(val(r.baseValue))+' → '+r.bounds.map(v=>esc(val(v))).join('～')+'<small>'+esc(r.unit)+' · '+r.points.length+'个测试点（含基准）</small></td><td>'+change(r,'irr','%')+'</td><td>'+change(r,'npv','万元')+'<small>相对偏离 '+(r.npvRelative===null?'不可用：基准NPV绝对值＜1万元':val(r.npvRelative*100)+'%')+'</small></td><td><b>'+fmt(r.weightedScore)+'</b><small>IRR 50% / NPV 50%</small></td><td><b>'+fmt(r.STi)+'</b><small>'+(r.STiLow<threshold&&r.STiHigh>=threshold?'区间跨阈值，需复核':(!recommended(r)&&r.STi>=threshold?'可能存在交互遗漏，请复核（不自动入选）':'全局交互辅助'))+'</small></td><td><details><summary>展开</summary><p>Spearman '+fmt(r.spearmanRho)+' / SRC '+fmt(r.src)+'</p><p>STi 95%区间 '+fmt(r.STiLow)+'—'+fmt(r.STiHigh)+'</p><table><tr><th>参数值</th><th>IRR %</th><th>NPV 万元</th></tr>'+r.points.map(p=>'<tr><td>'+esc(val(p.value))+'</td><td>'+val(p.irr)+'</td><td>'+val(p.npv)+'</td></tr>').join('')+'</table></details></td></tr>').join('');
   const grid=list=>'<div style="overflow:auto"><table class="tbl" style="width:100%;min-width:1050px"><tr><th>综合排名</th><th>入选</th><th>参数</th><th>基准 → 测试范围</th><th>IRR 实际影响</th><th>NPV 实际影响</th><th>综合加权得分</th><th>STi</th><th>测试与统计明细</th></tr>'+rows(list)+'</table></div>';
   el('output').innerHTML='<h3>基准 XIRR '+fmt(result.baseline.irr)+'% · NPV '+fmt(result.baseline.npv)+' 万元</h3><p>'+table.length+'个可变因素 · '+result.total+'次重算。实际影响为其他条件固定在基准的多点测试（日期及项目期限保持不变）；范围是已测试点的最小—最大值，不是精确极值或概率区间。STi来自多参数联合波动，两者不混成一个分数。</p>'
    +'<div class="psg-actions"><label>STi提醒 ≥ <input data-role="threshold" type="number" min="0" step="0.001" value="'+threshold+'"></label><label>IRR偏离 ＞（百分点）<input data-role="irr-threshold" type="number" min="0" step="0.01" placeholder="留空不启用" value="'+(criteria.irr??'')+'"></label><label>NPV相对偏离 ＞（比例，0.1=10%）<input data-role="npv-threshold" type="number" min="0" placeholder="留空不启用" value="'+(criteria.npv??'')+'"></label><label>综合得分 ＞ <input data-role="weighted-threshold" type="number" min="0" max="1" step="0.01" value="'+(criteria.weighted??'')+'" placeholder="留空不启用"></label><label>排序 <select data-role="sort"><option value="overall">综合排名</option><option value="irr">IRR实际影响</option><option value="npv">NPV实际影响</option><option value="sti">STi</option></select></label></div><p>先按参数性质筛选：固定规则不自动入选，也不能直接勾选；需要采集时先改为“默认待确认”或“项目实际值”。分类仅用于本次筛选，应用后发布分类摘要，不修改默认数值。固定规则的影响作为压力测试保留在下方，联合STi仍包含这些假设的波动，不代表规则本身存在不确定性。三项任一严格超过门槛即推荐：IRR最大偏离＞0.1个百分点、NPV最大偏离/|基准NPV|＞10%、综合得分＞0.1。综合得分=0.5×IRR偏离/本次最大IRR偏离+0.5×NPV偏离/本次最大NPV偏离；无波动维度计0。归一化使用全部可变因素，不随勾选变化，但更换范围或因素会改变得分。STi只提醒。NPV基准绝对值＜1万元时停用相对门槛，保留绝对影响及综合评分；需人工复核。高/中/低仍仅表示IRR偏离≥1、≥0.3、＜0.3个百分点，不等于是否入选。手动勾选优先，更改门槛不清除人工选择。</p>'
    +'<div class="psg-actions"><b>入选 '+chosen.length+' 项 / 未入选 '+excluded.length+' 项</b><button class="btn sm" data-role="apply">应用为 AI 关键指标</button><button class="btn sm ghost" data-role="reset-picks">恢复门槛推荐</button><button class="btn sm ghost" data-role="save">下载分析记录</button></div>'
    +grid(chosen)+'<details data-role="excluded"><summary>未入选（可展开勾选） · '+excluded.length+'项</summary>'+grid(excluded)+'</details><details data-role="rules"><summary>规则假设影响（不自动入选） · '+rules.length+'项</summary>'+grid(rules)+'</details><details><summary>联动、固定、派生及未登记输入</summary>'+result.coverage.filter(r=>r.reason).map(r=>'<p>'+esc(r.label)+'：'+esc(r.reason)+'</p>').join('')+'</details><details><summary>应用范围与数据来源</summary><p>仅替换非居改保全局AI关键指标，不修改原项目。低敏感的必要项目事实仍需提供。未登记输入阻止应用；固定值需先设置波动范围才能判断。Spearman/SRC及STi区间为复核依据，不以名次平均覆盖实际影响排序。全局配置仅发布摘要和选择，不发布本项目基准/逐点结果；下载记录包含项目数据，请妥善保管。</p></details>';
   el('sort').value=state.sort;el('sort').onchange=()=>draw({...state,sort:el('sort').value});
   host.querySelectorAll('[data-policy]').forEach(x=>x.onchange=()=>{const key=x.dataset.policy,value=x.value,overrides={...state.overrides};delete overrides[key];classifications={...state.policies,[key]:value};draw({...state,policies:classifications,overrides});say('参数性质已调整，尚未应用；默认数值未改变。');});
   const unregistered=result.coverage.some(r=>r.reason?.startsWith('未登记'));
   el('apply').disabled=unregistered;
   const readCriteria=()=>{const next={};for(const [key,role] of [['sti','threshold'],['irr','irr-threshold'],['npv','npv-threshold'],['weighted','weighted-threshold']]){const raw=el(role).value.trim(),v=raw===''&&key!=='sti'?null:Number(raw);if((raw===''&&key==='sti')||(v!==null&&(!Number.isFinite(v)||v<0)))throw Error('门槛须为非负数；IRR/NPV可留空');next[key]=v;}return next;};
   for(const role of ['threshold','irr-threshold','npv-threshold','weighted-threshold'])el(role).onchange=()=>{try{draw({...state,criteria:readCriteria()});say('门槛已调整，当前选择尚未应用。');}catch(e){selection=null;lab?.invalidate();el('apply').disabled=true;say(e.message);}};
   host.querySelectorAll('[data-pick]').forEach(x=>x.onchange=()=>{const opened=el('excluded').open;draw({...state,overrides:{...state.overrides,[x.dataset.pick]:x.checked}});el('excluded').open=opened;say('人工选择已调整，尚未应用。');});
   el('reset-picks').onclick=()=>{draw({...state,overrides:{}});say('已恢复门槛推荐，尚未应用。');};
   const publishedRows=()=>table.map(r=>Object.fromEntries(['key','label','STi','Si','STiLow','STiHigh','spearmanRho','src','combinedRank'].map(k=>[k,r[k]]).concat([['selected',checked(r)],['selectionSource',Object.hasOwn(state.overrides,r.key)?'manual':'threshold'],['irrDeviation',r.irrImpact.maxDeviation],['npvDeviation',r.npvImpact.maxDeviation],['npvRelative',r.npvRelative],['weightedScore',r.weightedScore],['policy',r.policy]])));
   el('save').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({...result,selectionMode:'impact-v4',criteria,selections:publishedRows()},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='安居乐寓版-实际影响与STi.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
   el('apply').onclick=async()=>{
    if(busy||unregistered)return;
    if(!confirm('请确认已核对波动范围符合项目实际（零值固定项尚未评估）。\n将以下 '+chosen.length+' 项应用为非居改保全局 AI 关键指标？\n'+chosen.map(r=>r.label).join('、')+'\n其他类型和已完成项目不变。'))return;
    busy=true;controls(true);el('cancel').disabled=true;el('output').querySelectorAll('input,button,select').forEach(x=>x.disabled=true);
    try{const data={version:result.version,createdAt:result.createdAt,N:result.N,seed:result.seed,threshold,selectionMode:'impact-v4',criteria,selectionApplied:true,table:publishedRows()};const response=await fetch('/api/calcconfig',{method:'POST',headers:{...(options.headers?.()||{}),'Content-Type':'application/json'},body:JSON.stringify({key:'sensitivity',applyProjectSensitivity:true,expected:applied??null,data})}),answer=await response.json();if(!response.ok||!answer.ok)throw Error(answer.error||'应用失败');applied=data;options.onApplied?.(data);say('已应用：'+chosen.length+'项。后续 AI 参数推荐按此名单读取；已完成项目不变。');}
    catch(e){say('未应用：'+e.message+'。分析结果及人工选择保留。');}finally{busy=false;controls(false);draw(state);}
   };
  }
  el('scope').onchange=reload;el('project').onchange=setup;el('reload').onclick=reload;await reload();
 }
 window.ProjectSensitivityUI={mount};
})();
