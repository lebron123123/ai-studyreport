(function(root){
  'use strict';
  const METRICS={revenue:{label:'经营收入',unit:'万元',additive:true},constructionInvestment:{label:'建设投资支出',unit:'万元',additive:true},contracted:{label:'合同承诺',unit:'万元',additive:true},performed:{label:'已履约',unit:'万元',additive:true},payable:{label:'应付',unit:'万元',additive:true},paid:{label:'已付',unit:'万元',additive:true},leasedArea:{label:'已出租面积',unit:'平方米',additive:true},occupancy:{label:'出租率',unit:'%',additive:false}};
  const fail=message=>{throw Object.assign(new Error(message),{status:400});};
  const text=(v,n=500)=>String(v??'').trim().slice(0,n);
  const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
  function normalizeActual(input){
    const x=input||{},metric=METRICS[x.metricKey];if(!metric)fail('不支持此实际指标；IRR不属于可直接录入汇总的经营实际值');
    if(typeof x.value!=='number'||!Number.isFinite(x.value))fail('实际值必须为有限数字，缺值不能记为0');
    if(!validDate(x.periodStart)||!validDate(x.periodEnd)||x.periodStart>x.periodEnd)fail('实际值起止期间无效');
    if(x.unit!==metric.unit||x.currency!=='CNY')fail('当前仅接受该指标的人民币标准单位，不自动换算');
    if(['leasedArea','occupancy'].includes(x.metricKey)&&x.value<0||x.metricKey==='occupancy'&&x.value>100)fail('面积或出租率超出有效范围');
    if(!text(x.basis,180)||!text(x.sourceRef,1000)||!text(x.sourceEvidenceId,100))fail('请提供完整口径、来源说明和项目已确认的来源证据ID');
    if(x.confirmed!==true)fail('请由录入人明确确认实际值和口径，预测不能替代实际值');
    if(!Number.isInteger(x.expectedVersion)||x.expectedVersion<0)fail('实际值必须携带当前版本号；首次为0');
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(x.requestKey||''))fail('实际值缺少有效幂等请求标识');
    return {metricKey:x.metricKey,value:x.value,periodStart:x.periodStart,periodEnd:x.periodEnd,unit:metric.unit,currency:'CNY',basis:text(x.basis,180),sourceRef:text(x.sourceRef,1000),sourceEvidenceId:text(x.sourceEvidenceId,100),confirmed:true,expectedVersion:x.expectedVersion,requestKey:x.requestKey};
  }
  function basisKey(x){return [x.metricKey,x.periodStart,x.periodEnd,x.unit,x.currency,x.basis].join('|');}
  function latestActuals(items){const rows=new Map();for(const x of items||[]){const key=basisKey(x),old=rows.get(key);if(!old||x.version>old.version)rows.set(key,x);}return [...rows.values()];}
  function compareActuals(forecast,actuals){
    const expected=forecast?.annualValues||[];
    return latestActuals(actuals).map(actual=>{const matches=expected.filter(x=>basisKey(x)===basisKey(actual)),planned=matches.length===1&&Number.isFinite(matches[0].value)?matches[0].value:null,delta=planned===null?null:actual.value-planned;
      return {...actual,forecastValue:planned,delta,relativeDelta:planned===null||planned===0?null:delta/Math.abs(planned),comparable:planned!==null,reason:planned===null?'缺少同指标、期间、单位、币种及口径的预测，未折算或摊分':'',attribution:{quantity:null,price:null,timing:null,basis:null,unexplained:delta},approvalStatus:'forecast_only'};});
  }
  function changedPaths(a,b,prefix=''){
    const keys=new Set([...Object.keys(a||{}),...Object.keys(b||{})]),out=[];
    for(const key of [...keys].sort()){const before=a?.[key],after=b?.[key],path=prefix?prefix+'.'+key:key;if(JSON.stringify(before)===JSON.stringify(after))continue;if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after))out.push(...changedPaths(before,after,path));else out.push({path,before:before===undefined?null:before,after:after===undefined?null:after});}return out;
  }
  function previewChange(baseline,forecast){
    const parameters=changedPaths(baseline?.parameters,forecast?.parameters),previous=baseline?.annualValues||[],annual=[];
    for(const next of forecast?.annualValues||[]){const same=previous.filter(x=>basisKey(x)===basisKey(next));annual.push({...next,before:same.length===1?same[0].value:null,delta:same.length===1?next.value-same[0].value:null});}
    return {parameters,annual,dependenciesChanged:changedPaths(baseline?.dependencies,forecast?.dependencies),baselineKind:baseline?.kind||null,targetKind:'forecast',formalApproval:false,warning:'仅比较已冻结预测，申请不会改变批准基准；未配置企业审批职责与规则，不支持正式批准。'};
  }
  function aggregateActuals(projects){
    const groups=new Map();for(const project of projects||[])for(const item of latestActuals(project.actuals)){if(!METRICS[item.metricKey]?.additive||!Number.isFinite(item.value))continue;const key=basisKey(item);if(!groups.has(key))groups.set(key,{metricKey:item.metricKey,periodStart:item.periodStart,periodEnd:item.periodEnd,unit:item.unit,currency:item.currency,basis:item.basis,value:0,projectIds:[]});const group=groups.get(key);group.value+=item.value;group.projectIds.push(project.projectId);}
    return {groups:[...groups.values()],excludedMetrics:['irr','capitalIrr','occupancy'],warning:'仅汇总授权项目已录入实际值；合同、履约、应付、已付分组展示，不跨层相加；不平均IRR或出租率。'};
  }
  const drafts=new Map(),bindings=new WeakMap(),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(data,mode='plan',namespace){
    if(!data)return '<div class="pm-ops-block"><p role="status">投资版本与实际值加载中…</p></div>';
    const id=data.projectId||'',key=String(namespace??data.actorUserId??'unidentified')+':'+id,draft=drafts.get(key)||{},versions=(data.versions||[]).filter(x=>x.valid),canEdit=data.permissions?.edit,canManage=data.permissions?.manage,latest=versions[0],option=versions.map(v=>'<option value="'+escape(v.id)+'">预测 V'+v.number+' · '+escape(v.name)+'</option>').join(''),input=(name,label,type='text',extra='')=>'<label>'+label+'<input data-il-field="'+name+'" type="'+type+'" value="'+escape(draft[name]??'')+'" '+extra+'></label>';
    let html='<section class="pm-ops-block" data-il-project="'+escape(id)+'"><h3>'+(mode==='operations'?'投后实际值与差异':'项目计划与冻结版本')+'</h3><p class="pm-hint">'+escape(data.warning)+'</p><p>原批准基准：未配置 · 批准调整版：未配置 · 当前采纳：'+escape(data.selectedScenario?.name||'未明确采纳')+'</p><p data-il-message role="status"></p>';
    if(mode==='plan')html+=(canManage?'<div class="pm-inline">'+input('name','预测版本名称')+'<button class="ub-btn" data-il-action="freeze" '+(!data.selectedScenario?'disabled':'')+'>冻结当前采纳方案为预测</button></div>':'')+'<div class="pm-two"><section><h4>不可变预测版本</h4>'+(versions.map(v=>'<p>V'+v.number+' · '+escape(v.name)+' · <b>未批准预测</b> · '+new Date(v.createdAt).toISOString().slice(0,10)+'</p>').join('')||'<p>暂无冻结预测；先保存并明确采纳可信测算方案。</p>')+'</section><section><h4>审批申请记录</h4>'+((data.requests||[]).map(r=>'<p>待配置审签 · '+escape(r.reason)+'</p>').join('')||'<p>暂无申请，系统不会自动审批。</p>')+'</section></div>'+(versions.length?'<div class="pm-inline"><label>对比版本<select data-il-field="baselineVersionId">'+option+'</select></label><label>目标预测<select data-il-field="versionId">'+option+'</select></label><button class="ub-btn ghost" data-il-action="preview">预演已冻结版本差异</button></div><div data-il-preview></div>'+(canEdit?'<div class="pm-inline">'+input('reason','申请原因')+'<button class="ub-btn" data-il-action="request">登记原基准审批申请（不批准）</button></div>':''):'');
    if(mode==='operations'){
      html+='<p>对比预测：'+escape(latest?'V'+latest.number+' '+latest.name:'暂无')+'。不自动归因；合同、履约、应付、已付分别记账。</p>';
      if(canEdit)html+='<details class="pm-ops-block" open><summary>录入或修正实际值</summary><div class="pm-inline"><label>指标<select data-il-field="metricKey">'+Object.entries(METRICS).map(([key,m])=>'<option value="'+key+'" '+(draft.metricKey===key?'selected':'')+'>'+m.label+'（'+m.unit+'）</option>').join('')+'</select></label>'+input('periodStart','期间开始','date')+input('periodEnd','期间结束','date')+input('value','实际值','number','step="any"')+'</div><div class="pm-inline">'+input('basis','口径标识（须与来源一致）')+input('sourceEvidenceId','已确认项目证据ID')+input('sourceRef','来源说明')+'</div><p class="pm-hint">预测口径示例：'+escape(latest?.payload?.annualValues?.[0]?.basis||'未提供；请据真实来源填写')+'。只在期间与口径完全相同时对比；其他月份不自动摊分。</p><label><input type="checkbox" data-il-field="confirmed" '+(draft.confirmed?'checked':'')+'>我已核对真实来源、期间和口径；此值不是预测</label><button class="ub-btn" data-il-action="actual">确认录入（保留旧版本）</button></details>';
      const values=data.variance||[];html+='<div class="pm-compare">'+(values.map(x=>'<div><b>'+escape(METRICS[x.metricKey]?.label||x.metricKey)+'</b><span>'+escape(x.periodStart)+' 至 '+escape(x.periodEnd)+' · V'+x.version+'</span><span>实际 '+escape(x.value)+' '+escape(x.unit)+' · 预测 '+escape(x.forecastValue??'不可比')+' · 差额 '+escape(x.delta??'—')+'</span><span>'+escape(x.basis)+' · '+escape(x.sourceRef)+'</span><small>'+(x.comparable?'量价时间原因尚无证据，差额暂未解释':escape(x.reason))+'</small>'+(canEdit?'<button class="ub-btn ghost" data-il-correct="'+escape(x.id)+'">修正留新版本</button>':'')+'</div>').join('')||'<p>尚无已确认录入的实际值，不展示虚构经营指标。</p>')+'</div>';
    }
    return html+'</section>';
  }
  function bind(host,{projectId,data,post,refresh,namespace}={}){
    if(!host||!projectId||typeof post!=='function')return ()=>{};
    bindings.get(host)?.dispose();const token={},key=String(namespace??data.actorUserId??'unidentified')+':'+projectId;bindings.set(host,token);
    const fields=()=>Object.fromEntries([...host.querySelectorAll('[data-il-field]')].map(el=>[el.dataset.ilField,el.type==='checkbox'?el.checked:el.value]));
    const remember=()=>{drafts.set(key,{...(drafts.get(key)||{}),...fields()});};
    const note=message=>{if(bindings.get(host)!==token)return;const el=host.querySelector('[data-il-message]');if(el)el.textContent=message;};
    const click=async event=>{
      const button=event.target.closest?.('[data-il-action],[data-il-correct]');if(!button||!host.contains(button))return;event.preventDefault();event.stopPropagation();if(token.busy)return;
      if(button.dataset.ilCorrect){const row=(data.actuals||[]).find(x=>x.id===button.dataset.ilCorrect);if(row){for(const el of host.querySelectorAll('[data-il-field]')){if(el.type==='checkbox')el.checked=false;else if(row[el.dataset.ilField]!==undefined)el.value=row[el.dataset.ilField];}remember();note('已载入现值；修改后重新核对确认，将保留旧版本。');}return;}
      const values=fields(),action=button.dataset.ilAction;remember();
      if(action==='preview'){const before=data.versions?.find(x=>x.id===values.baselineVersionId),next=data.versions?.find(x=>x.id===values.versionId),target=host.querySelector('[data-il-preview]');if(target&&before?.valid&&next?.valid){const result=previewChange(before.payload,next.payload);target.innerHTML='<p>'+result.parameters.length+' 项参数变化；'+result.annual.filter(x=>x.delta!==null&&x.delta!==0).length+' 项同口径年度值变化。未批准、未更新基准。</p>'+result.parameters.map(x=>'<p>'+escape(x.path)+'：'+escape(JSON.stringify(x.before))+' → '+escape(JSON.stringify(x.after))+'</p>').join('');}return;}
      const signature=JSON.stringify({action,values}),pending=drafts.get(key);if(pending?._signature!==signature){pending._signature=signature;pending._requestKey='ui-'+(root.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2));}
      let body;if(action==='freeze')body={action:'freezeForecast',scenarioId:data.selectedScenario?.id,name:values.name,requestKey:pending._requestKey};
      if(action==='request')body={action:'requestInvestmentApproval',versionId:values.versionId,reason:values.reason,requestKey:pending._requestKey};
      if(action==='actual'){
        const actual={metricKey:values.metricKey,value:values.value.trim()===''?null:Number(values.value),periodStart:values.periodStart,periodEnd:values.periodEnd,unit:METRICS[values.metricKey]?.unit,currency:'CNY',basis:values.basis,sourceRef:values.sourceRef,sourceEvidenceId:values.sourceEvidenceId,confirmed:values.confirmed,requestKey:pending._requestKey};actual.expectedVersion=Math.max(0,...(data.actuals||[]).filter(x=>basisKey(x)===basisKey(actual)).map(x=>x.version));body={action:'recordActual',actual};
      }
      if(!body)return;token.busy=true;button.disabled=true;note('正在保存，请勿重复操作…');
      try{const result=await post({...body,projectId});if(bindings.get(host)!==token)return;drafts.delete(key);note(result.warning||'已保存；未执行正式批准。');await refresh?.();}catch(error){note(error.message||'保存失败，输入已保留，请重试');}finally{token.busy=false;if(bindings.get(host)===token)button.disabled=false;}
    };
    host.addEventListener('input',remember);host.addEventListener('change',remember);host.addEventListener('click',click);token.dispose=()=>{host.removeEventListener('input',remember);host.removeEventListener('change',remember);host.removeEventListener('click',click);if(bindings.get(host)===token)bindings.delete(host);};return token.dispose;
  }
  const api={METRICS,normalizeActual,basisKey,latestActuals,compareActuals,previewChange,aggregateActuals,render,bind};root.InvestmentLifecycle=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
