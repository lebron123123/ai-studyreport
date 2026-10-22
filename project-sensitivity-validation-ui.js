(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=v=>Number.isFinite(v)?Number(v.toFixed(5)):'—';
 function mount(host,options){
  const V=root.ProjectSensitivityValidation,{base,records}=options;let calibration=null,report=null,stabilityReport=null;
  const q=k=>host.querySelector('[data-lab="'+k+'"]'),say=s=>q('status').textContent=s;
  const list=role=>records.map((r,i)=>'<label style="display:block"><input style="width:auto" type="checkbox" data-'+role+'="'+i+'"> '+esc(r.projectName)+' · 修订 '+esc(r.revision)+'</label>').join('');
  host.innerHTML='<details open><summary>实验室 · 范围校准、稳定性与留出验证</summary><p>在当前数据来源中选择项目；自己的项目请在顶部选择“我的自测项目”。只重算副本，不覆盖项目或自动应用关键指标。实验不持久化，刷新后请重新选择；可下载记录。</p>'
   +'<details><summary>① 选择参考与验证项目，生成可修改的中位数</summary><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px"><div><b>参考项目（用于经验值与范围）</b>'+list('reference')+'</div><div><b>验证项目（从参考中排除）</b>'+list('validation')+'</div></div><p>同类型、合作模式、月度模型才可比；地域、品质、价格基期等需人工核对。至少3个有效参考值且有差异才建议样本最小—最大范围，否则保留现有范围，不能称已校准。此处不是概率分布拟合。</p><button class="btn sm" data-lab="median">生成参考中位数</button><div data-lab="values"></div></details>'
   +'<details><summary>② 多随机种子稳定性复核</summary><p>使用当前范围和门槛，重新联合抽样。实际影响评分为确定性单因素测试，相同范围下入选频率通常为100%或0%，不是准确率；重点比较STi及其排名。STi−Si仅为交互提示，不是已确认交互量。</p><div class="psg-actions"><label>基础样本N <select data-lab="samples"><option>300</option><option selected>1000</option><option>2000</option></select></label><label>重复次数 <input data-lab="repeats" type="number" min="2" max="10" value="3"></label><label>起始种子 <input data-lab="seed" type="number" value="20260921"></label><button class="btn sm" data-lab="stability">复核稳定性</button></div><div data-lab="stability-result"></div></details>'
   +'<details><summary>③ 留出项目：完整参数 vs 关键参数＋经验值</summary><p>先在上方完成主分析、选择关键指标，再验证。日期、面积、套数、合作模式、爬坡阶段安排和派生字段保留原值；只替换未选的可比参数。失败项计入分母、不静默剔除。近零NPV（绝对值＜1万元）改用绝对误差容限。当前会话参与筛选/校准的项目仅算内部复核；跨会话使用历史需人工确认。</p><div class="psg-actions"><label>IRR容限（百分点）<input data-lab="irr-tol" type="number" min="0" value="0.1" step="0.01"></label><label>NPV相对容限（%）<input data-lab="npv-tol" type="number" min="0" value="10"></label><label>近零NPV绝对容限（万元）<input data-lab="abs-tol" type="number" min="0" value="1"></label></div><label><input style="width:auto" type="checkbox" data-lab="independent">确认其他验证项目也未在历史筛选、调参或经验值制定中使用；看过结果再调参后应换新留出项目</label><div class="psg-actions"><button class="btn sm" data-lab="validate">运行副本对照</button><button class="btn sm ghost" data-lab="download" disabled>下载实验记录</button></div><div data-lab="validation-result"></div></details><p role="status" data-lab="status"></p></details>';
  const selected=role=>Array.from(host.querySelectorAll('[data-'+role+']:checked')).map(x=>records[+x.getAttribute('data-'+role)]);
  function invalidate(){report=null;stabilityReport=null;q('validation-result').innerHTML='';q('stability-result').innerHTML='';q('download').disabled=true;}
  function readValues(){const values={};host.querySelectorAll('[data-experience]').forEach(x=>values[x.dataset.experience]=x.value.trim()===''?null:Number(x.value));return values;}
  function table(headers,rows){return '<div style="overflow:auto"><table class="tbl"><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
  host.querySelectorAll('[data-reference],[data-validation]').forEach(x=>x.onchange=()=>{calibration=null;q('values').innerHTML='';invalidate();say('项目选择已变更，请重新生成中位数。');});
  q('median').onclick=()=>{try{
   invalidate();calibration=V.calibrate(base,selected('reference'),selected('validation'));calibration.references.forEach(r=>options.used.add(r.identity));
   q('values').innerHTML='<p>可比参考项目 '+calibration.references.length+' 个；排除重复选择的验证项目 '+calibration.excluded.length+' 个。整数中位数按四舍五入取合法整数；空缺须填写，不默认填零。</p><div style="overflow:auto;max-height:420px"><table class="tbl"><tr><th>参数/单位</th><th>有效样本</th><th>实际最小—最大</th><th>中位数</th><th>本次经验值（可修改）</th></tr>'+calibration.rows.map(r=>'<tr><td>'+esc(r.label)+' ('+esc(r.unit)+')</td><td>'+r.count+'</td><td>'+fmt(r.min)+'—'+fmt(r.max)+(r.calibrated?'':'（未校准）')+'</td><td>'+fmt(r.median)+'</td><td><input data-experience="'+esc(r.key)+'" aria-label="'+esc(r.label)+'经验值" type="number" step="any" value="'+esc(r.value)+'"></td></tr>').join('')+'</table></div><button class="btn sm ghost" data-lab="ranges">将有效样本范围填入主分析（需重新运行）</button>';
   host.querySelectorAll('[data-experience]').forEach(x=>x.oninput=()=>{invalidate();say('经验值已修改，请重新验证。');});
   q('ranges').onclick=()=>{const ranges={};calibration.rows.filter(r=>r.calibrated).forEach(r=>ranges[r.key]=[Math.min(r.min,r.value,base.params[r.key]),Math.max(r.max,r.value,base.params[r.key])]);if(!Object.keys(ranges).length){say('有效样本不足或范围无差异，没有覆盖当前范围。');return;}calibration.references.forEach(r=>options.used.add(r.identity));options.applyRanges(ranges);invalidate();say('已填入 '+Object.keys(ranges).length+' 项参考范围（含基准值），请核对后重新运行主分析；其他范围保留。');};
   say('中位数已生成，可逐项修改；尚未验证或覆盖项目。');
  }catch(e){calibration=null;q('values').innerHTML='';say(e.message);}};
  async function task(work){const session=options.begin();if(!session)return;invalidate();try{await work(session);q('download').disabled=!(report||stabilityReport);}catch(e){say(e.message);}finally{options.end();q('download').disabled=!(report||stabilityReport);}}
  q('stability').onclick=()=>task(async session=>{
   const selection=options.selection();if(!selection)throw Error('请先运行主分析，确认门槛和范围');
   const r=await V.stability(base.params,options.config,options.ranges(),selection.criteria,{policies:selection.policies,N:Number(q('samples').value),repeats:Number(q('repeats').value),seed:Number(q('seed').value),cancelled:session.cancelled,progress:(i,t,n,total)=>say('复核第 '+i+'/'+t+' 轮 · '+n+'/'+total+' 次')});
   if(session.cancelled())throw Error('复核已取消');stabilityReport=r;
   q('stability-result').innerHTML=table(['参数','综合排名范围','STi排名范围','STi范围','推荐入选频率','最大STi−Si'],r.table.map(x=>[x.label,x.rankMin+'—'+x.rankMax,x.sobolRankMin+'—'+x.sobolRankMax,fmt(x.stiMin)+'—'+fmt(x.stiMax),fmt(x.selectionFrequency*100)+'%',fmt(x.interactionMax)]));say('复核完成；排名跨度大或STi临界项需增加样本或核对范围，不代表95%准确。');
  });
  q('validate').onclick=()=>task(async session=>{
   if(!calibration)throw Error('请先生成参考中位数');const selection=options.selection();if(!selection)throw Error('请先运行主分析并选择关键指标');
   const projects=selected('validation'),used=new Set(options.used);if(!q('independent').checked)projects.forEach(r=>used.add(V.identity(r)));
   for(const name of ['irr-tol','npv-tol','abs-tol'])if(!q(name).value.trim())throw Error('请填写误差容限');
   const r=await V.validate(base,projects,calibration,readValues(),selection.keys,options.config,{usedIdentities:Array.from(used),irrTolerance:Number(q('irr-tol').value),npvTolerance:Number(q('npv-tol').value)/100,npvAbsoluteTolerance:Number(q('abs-tol').value),cancelled:session.cancelled,progress:(n,t)=>say('对照 '+n+'/'+t+' 个项目')});
   if(session.cancelled())throw Error('验证已取消');report=r;projects.forEach(r=>options.used.add(V.identity(r)));
   const s=r.summary;q('validation-result').innerHTML='<p>独立留出 '+s.n+' 项，达容限 '+s.passed+' 项；符合率 '+(s.rate===null?'不适用':fmt(s.rate*100)+'%')+'；Wilson 95%区间 '+(s.interval?s.interval.map(v=>fmt(v*100)+'%').join('—'):'不适用')+'。这是本批误差达标率，不是总体准确率；独立项目少时不能推断95%。再次使用本批项目将标为内部复核。</p>'+table(['项目','性质','完整→简化 IRR(%)','IRR误差(百分点)','完整→简化 NPV(万元)','NPV误差','结果'],r.rows.map(x=>[x.name,x.independent?'独立留出':'内部复核',x.full?fmt(x.full.irr)+' → '+fmt(x.reduced.irr):'—',fmt(x.irrError),x.full?fmt(x.full.npv)+' → '+fmt(x.reduced.npv):'—',x.npvRelative===null?fmt(x.npvError)+'万元':fmt(x.npvRelative*100)+'%',x.error|| (x.pass?'符合容限':'超出容限')]))+'<details><summary>逐项替换明细</summary>'+r.rows.map(x=>'<h4>'+esc(x.name)+'</h4>'+table(['参数','原值','本次经验值'],(x.replaced||[]).map(v=>[v.key,v.original,v.value]))).join('')+'</details>';say('对照完成，原项目与已应用配置均未修改。');
  });
  for(const name of ['irr-tol','npv-tol','abs-tol','independent','samples','repeats','seed'])q(name).onchange=()=>{invalidate();say('实验条件已变更，请重新运行。');};
  q('download').onclick=()=>{const payload={version:'anju-validation-v1',base:{id:base.id,revision:base.revision},config:options.config,ranges:options.ranges(),calibration,values:readValues(),selection:options.selection(),stability:stabilityReport,validation:report};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='安居乐寓-校准与验证记录.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return {invalidate};
 }
 root.ProjectSensitivityValidationUI={mount};
})(window);
