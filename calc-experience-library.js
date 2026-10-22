(function(){
  'use strict';
  const TYPES={gaibao:'非居改保',rent:'出租类',sale:'出售类',commercial:'商业经营',other:'其他类型'};
  const SUMMARY_LABELS={irr:'全投资IRR',totalIncome:'全周期总收入',totalRevenue:'全周期总收入',totalCost:'总成本',totalTax:'税费合计',totalNetProfit:'净利润合计',totalProfit:'利润合计',totalNpv:'累计净现值',npv:'净现值',totalInvestment:'总投资'};
  const CATEGORY_NAMES={scope:'项目规模与期限',income:'收入与运营',cost:'成本与投资',finance:'融资与评价',tax:'税费',plan:'分年计划',results:'财务测算指标 · Excel / 人工原值'};
  const COMMON_RESULT_FIELDS=[['totalInvestment','总投资','万元','results'],['totalIncome','全周期总收入','万元','results'],['totalCost','总成本','万元','results'],['totalTax','税费合计','万元','results'],['totalNetProfit','净利润合计','万元','results'],['irr','全投资IRR','%','results']];
  const MANUAL_SCHEMAS={
    gaibao:[
      ['area','住宅面积','㎡','scope'],['units','总套数','套','scope'],['rent','起始租金','元/㎡/月','income'],['rentSpan','租金递增跨度','年','income'],['rentRate','租金递增率','%','income'],['rampOcc','首年出租率','比例','income'],['stableOcc','稳定期出租率','比例','income'],['collect','固定收楼单价','元/㎡/月','cost'],['collectRentPct','实收租金收楼比例','%','cost'],['collectReductionPct','固定收楼租金减免','%','cost'],['projectSharePct','项目保留租金收益','%','cost'],['deco','首次装修单方造价','元/㎡','cost'],['decoInt','装修间隔','年','cost'],['decoRatio','二次装修成本系数','比例','cost'],['unitCost','单套月运营成本','元/套/月','cost'],['startup','开办费','万元','cost'],['loan','总借款额','万元','finance'],['interestBase','计息本金','万元','finance'],['loanRate','贷款年利率','%','finance'],['discount','折现率','%','finance'],['repay','年均还款额','万元/年','finance'],['loanTotalYears','借款期限','年','finance'],
      {key:'occupancyRamp',label:'分年出租率',unit:'比例',category:'plan',series:true},{key:'loanPlan',label:'借款计划',unit:'万元',category:'plan',series:true},{key:'repayPlan',label:'还款计划',unit:'万元',category:'plan',series:true},...COMMON_RESULT_FIELDS
    ],
    rent:[
      ['buildStart','建设起始年','年','scope'],['buildYears','建设期','年','scope'],['landTerm','土地使用年限','年','scope'],['area','住宅面积','㎡','scope'],['totalBuildArea','总建筑面积','㎡','scope'],['rent','起始租金','元/㎡/月','income'],['rentRate','租金递增率','%','income'],['rampOcc','首年出租率','比例','income'],['stableOcc','稳定期出租率','比例','income'],['parkCount','车位个数','个','income'],['parkPrice','车位月租金','元/个/月','income'],['decorationCost','住宅装修造价','万元','cost'],['constructionCost','建安工程费','万元','cost'],['loanAmount','总借款额','万元','finance'],['loanRate','贷款年利率','%','finance'],['discountPct','折现率','%','finance'],...COMMON_RESULT_FIELDS
    ],
    sale:[
      ['buildStart','建设起始年','年','scope'],['buildYears','建设期','年','scope'],['landTerm','土地使用年限','年','scope'],['saleArea','可售面积','㎡','scope'],['saleAvgPrice','销售单价','元/㎡','income'],['rate1','运营第1年销售率','比例','income'],['rate2','运营第2年销售率','比例','income'],['rate3','运营第3年销售率','比例','income'],['commArea','商业出租面积','㎡','income'],['commRent','商业起始租金','元/㎡/月','income'],['landFloorPrice','划拨土地楼面价','元/㎡','cost'],['loanAmount','总借款额','万元','finance'],['loanRate','贷款年利率','%','finance'],['repayAmount','每年还款额','万元','finance'],['discountPct','折现率','%','finance'],...COMMON_RESULT_FIELDS
    ],
    commercial:[...COMMON_RESULT_FIELDS],other:[...COMMON_RESULT_FIELDS]
  };
  MANUAL_SCHEMAS.gaibao.splice(MANUAL_SCHEMAS.gaibao.findIndex(field=>Array.isArray(field)&&field[0]==='unitCost')+1,0,['operateRentPct','实收租金运营成本比例','%','cost']);
  let context={},state={records:[],metrics:[],benchmarks:[],deleteRequests:[],isAdmin:false},root=null,parsedRows=[],formMode='manual',scope='group',editing=null,model=null,refreshToken=0;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num=value=>{if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;};
  const fmt=value=>{const n=num(value);return n===null?'—':n.toLocaleString('zh-CN',{maximumFractionDigits:2});};
  const headers=()=>Object.assign({'Content-Type':'application/json'},typeof authHeaders==='function'?authHeaders():{});
  function categoryFor(key,label,source){
    const text=(key+' '+label).toLowerCase();
    if(/税|tax|vat/.test(text))return 'tax';
    if(/利润|profit|irr|npv|收益/.test(text))return 'profit';
    if(/收入|租金|售价|income|revenue|rent|sale/.test(text))return 'income';
    if(/成本|费用|支出|cost|expense/.test(text))return 'cost';
    if(/投资|建安|改造|capex|investment/.test(text))return 'investment';
    if(/运营|出租率|去化|occupancy|operation/.test(text))return 'operation';
    return source==='params'?'parameter':'other';
  }
  function unitFor(key,label,meta,value){
    if(meta&&meta.unit)return meta.unit;
    const text=(key+' '+label).toLowerCase();
    if(/irr|率|ratio|rate|pct|percent/.test(text))return Number(value)>=0&&Number(value)<=1?'比例':'%';
    if(/面积|area/.test(text))return '㎡';
    if(/年|year/.test(text))return '年';
    return /收入|成本|税|利润|投资|npv|income|cost|profit|revenue/.test(text)?'万元':'';
  }
  function currentMetrics(){
    const rows=[],seen=new Set(),meta=context.paramMeta||{};
    const add=(key,value,source,periodLabel)=>{
      if(num(value)===null||seen.has(key))return;
      const baseKey=key.includes('.')?key.slice(0,key.lastIndexOf('.')):key;
      seen.add(key);const schema=schemaFor(context.projectType).find(x=>x.key===baseKey),info=meta[key]||meta[baseKey]||schema||{},label=info.label||SUMMARY_LABELS[key]||SUMMARY_LABELS[baseKey]||baseKey;
      if(source==='params'&&['rampOcc','stableOcc','occupancyRamp'].includes(baseKey))value=Number(value)*100;
      const unit=source==='summary'&&key==='irr'?'%':unitFor(key,label,info,value);
      const isRatio=unit==='比例'||unit==='%'||/率|ratio|rate|pct|irr/i.test(key+' '+label);
      rows.push({category:categoryFor(key,label,source),metricKey:key,metricName:label,metricValue:Number(value),unit,ratioPct:isRatio?(unit==='比例'?Number(value)*100:Number(value)):null,periodLabel:periodLabel||'当前测算',note:source==='summary'?'测算结果':'测算参数'});
    };
    Object.entries(context.summary||{}).forEach(([key,value])=>add(key,value,'summary'));
    Object.entries(context.params||{}).forEach(([key,value])=>{
      if(key==='repaymentSchedule'||Array.isArray(value))return;
      if(value&&typeof value==='object'&&!Array.isArray(value))Object.entries(value).forEach(([period,item])=>add(key+'.'+period,item,'params',period+'年'));
      else add(key,value,'params');
    });
    return rows.slice(0,800).map(model.normalizeMetric);
  }
  function statusName(status){return {pending:'待管理员审核',confirmed:'已确认',rejected:'已驳回'}[status]||status;}
  function benchmarkFor(record,metric){return state.benchmarks.find(x=>x.projectType===record.projectType&&x.metricKey===metric.metricKey)||null;}
  function currentFor(metric){return currentMetrics().find(x=>x.metricKey===metric.metricKey)||null;}
  function rangeHtml(record,metric){
    const b=benchmarkFor(record,metric);if(!b)return '<span>暂无已确认样本</span>';
    const ratio=metric.ratioPct!=null&&b.minRatio!=null,low=ratio?b.minRatio:b.minValue,high=ratio?b.maxRatio:b.maxValue,suffix=ratio?'%':(' '+(metric.unit||''));
    return '<span class="cel-range">'+fmt(low)+'～'+fmt(high)+esc(suffix)+'</span><small>'+b.sampleCount+'个已确认项目</small>';
  }
  function assessHtml(record,metric){
    const b=benchmarkFor(record,metric),current=currentFor(metric);if(!b||!current)return '—';
    const ratio=current.ratioPct!=null&&b.minRatio!=null,value=ratio?current.ratioPct:current.metricValue,low=ratio?b.minRatio:b.minValue,high=ratio?b.maxRatio:b.maxValue;
    if(value<low)return '<span class="cel-assess warn">低于经验区间</span>';
    if(value>high)return '<span class="cel-assess warn">高于经验区间</span>';
    return '<span class="cel-assess good">处于经验区间</span>';
  }
  function actionHtml(record){
    const buttons=[],recordMetrics=state.metrics.filter(metric=>metric.recordId===record.id);
    if(record.ownedByMe||(state.isAdmin&&record.scope!=='private'))buttons.push('<button class="cel-btn" data-action="edit" data-id="'+esc(record.id)+'">编辑项目</button>');
    const matchesCurrentType=!context.projectType||record.projectType===context.projectType;
    if(typeof context.onApply==='function'&&matchesCurrentType&&['gaibao','rent','sale'].includes(record.projectType)&&recordMetrics.length)buttons.push('<button class="cel-btn primary" data-action="apply" data-id="'+esc(record.id)+'">应用到当前测算</button>');
    if(state.isAdmin&&record.scope!=='private'&&record.status==='pending')buttons.push('<button class="cel-btn" data-action="confirm" data-id="'+esc(record.id)+'">审核通过</button><button class="cel-btn" data-action="reject" data-id="'+esc(record.id)+'">驳回</button>');
    if(state.isAdmin||(record.scope==='private'&&record.ownedByMe))buttons.push('<button class="cel-btn danger" data-action="delete" data-id="'+esc(record.id)+'">删除</button>');
    else if(record.ownedByMe)buttons.push('<button class="cel-btn danger" data-action="requestDelete" data-id="'+esc(record.id)+'">申请删除</button>');
    return buttons.length?'<div class="cel-record-action">'+buttons.join('')+'</div>':'—';
  }
  function renderTable(){
    const body=root.querySelector('.cel-content'),metricMap=new Map();state.metrics.forEach(m=>{if(!metricMap.has(m.recordId))metricMap.set(m.recordId,[]);metricMap.get(m.recordId).push(m);});
    const totalMetrics=state.metrics.length,confirmed=state.records.filter(x=>x.status==='confirmed').length;
    let html='<div class="cel-summary"><div class="cel-stat"><b>'+state.records.length+'</b><span>当前列表项目记录</span></div><div class="cel-stat"><b>'+totalMetrics+'</b><span>收入、成本、税费等明细</span></div><div class="cel-stat"><b>'+confirmed+'</b><span>'+(scope==='private'?'已保存、可直接使用':'已审核、可参与经验判断')+'</span></div></div>';
    html+='<p class="cel-note">'+(scope==='private'?'自测项目仅本人可见，导入或保存即可使用，不需提交集团审核。':'经验区间只使用管理员确认的数据；编辑后需重新审核，不影响原正式项目。')+'</p>';
    if(!state.records.length){body.innerHTML=html+'<div class="cel-empty">还没有经验数据。可手动新增、录入当前测算，或上传 Excel / CSV / JSON。</div>';bindActions();return;}
    state.records.forEach(record=>{
      const metrics=metricMap.get(record.id)||[],inputs=metrics.filter(m=>!model.isResult(m)&&!(record.projectType==='gaibao'&&['loan','interestBase','loanPlan','repayPlan'].includes(String(m.metricKey).split('.')[0])));
      // Recompute from this record only; saved snapshots may use older formulas.
      // Rendering never overwrites the original Excel/manual values or posts data.
      let system;
      try{system={summary:context.onCalculate(record.projectType,model.buildParameters(metrics,record.payload?.params||{}))};}
      catch(error){system={summary:record.payload?.calculation?.summary||{},error:'未能更新系统指标；已有数值为保存时快照，请编辑补充参数：'+error.message};}
      const comparison=model.compareResults(metrics,system.summary||{});
      html+='<details class="cel-project"><summary><span><b>'+esc(record.projectName)+'</b><small>'+esc(record.typeName||TYPES[record.projectType])+' · '+esc(record.region||'地区未填写')+' · '+metrics.length+'项</small></span><span class="cel-status '+esc(record.status)+'">'+(scope==='private'?'个人自测':esc(statusName(record.status)))+'</span><span>展开 / 收起</span></summary><div class="cel-project-body">'+actionHtml(record);
      const dates=record.payload?.params||{};
      if(record.projectType==='gaibao'){
        const mode=dates.mode==='share'?'减租后合作分成':dates.mode==='rent-percent'?'按每月实际租金比例':'每月固定单价';
        html+='<div class="cel-note"><b>收楼流出方式：</b>'+esc(mode)+(dates.mode==='share'?'；固定收楼租金减免 '+esc(dates.collectReductionPct??100-(dates.collectPct??50))+'%；项目保留收益 '+esc(dates.projectSharePct??100-(dates.sharePct??30))+'%；分成起始月 '+esc(dates.shareStartMonth||dates.operateStartMonth||'运营首月'):dates.mode==='rent-percent'?'；实际租金 '+esc(dates.collectRentPct??'未填写')+'%':'；单价 '+esc(dates.collect??'未填写')+' 元/㎡/月')+'</div>';
        html+='<div class="cel-note"><b>运营成本方式：</b>'+(dates.operateCostMode==='rent-percent'?'实际月租金 '+esc(dates.operateRentPct??15.7)+'%':'单套月成本 '+esc(dates.unitCost??'未填写')+' 元/套/月')+'</div>';
      }
      if(record.projectType==='gaibao')html+='<details class="cel-metric-group"><summary>建设与运营时间</summary><div class="cel-manual-grid">'+Object.entries(model.monthFields).map(([key,label])=>'<div>'+esc(label)+'<br><b>'+esc(dates[key]||'未填写')+'</b></div>').join('')+'</div></details>';
      if(dates.repaymentSchedule&&record.projectType!=='gaibao'){const plan=dates.repaymentSchedule;html+='<div class="cel-note"><b>还款计划</b>：每 '+esc(plan.intervalMonths)+' 个月；首次：'+esc(plan.firstMonth||'未填写')+'；每期金额（万元）：'+esc((plan.amounts||[]).join('；')||'未填写')+'。周期明细仅记录，计算仍采用年度计划。</div>';}
      const grouped={};inputs.forEach(m=>{const field=schemaFor(record.projectType).find(f=>f.key===m.metricKey||m.metricKey.startsWith(f.key+'.')),key=field?.category||'scope';(grouped[key]||(grouped[key]=[])).push(m);});
      html+=Object.keys(CATEGORY_NAMES).filter(key=>grouped[key]).map(key=>'<details class="cel-metric-group"><summary>'+esc(CATEGORY_NAMES[key])+' · '+grouped[key].length+'项</summary><div class="cel-table-wrap"><table class="cel-table"><thead><tr><th>指标</th><th>数值</th><th>经验区间</th><th>辅助判断</th></tr></thead><tbody>'+grouped[key].map(m=>'<tr><td>'+esc(m.metricName)+'<small>'+esc(m.periodLabel)+'</small></td><td>'+fmt(m.value??m.metricValue)+' '+esc(m.unit)+'</td><td>'+rangeHtml(record,m)+'</td><td>'+assessHtml(record,m)+'</td></tr>').join('')+'</tbody></table></div></details>').join('');
      html+='<h3>财务测算指标 · 双版本对照</h3><p class="cel-note">'+esc(system.error||'系统版按本记录参数计算；Excel / 人工原值独立保留，差额为系统版减原值。')+'</p><div class="cel-table-wrap"><table class="cel-table"><thead><tr><th>指标</th><th>单位</th><th>系统计算版</th><th>Excel / 人工原值</th><th>差额</th></tr></thead><tbody>'+comparison.map(m=>'<tr><td>'+esc(m.name)+'</td><td>'+esc(m.unit)+'</td><td>'+fmt(m.computed)+'</td><td>'+fmt(m.excel)+'</td><td>'+fmt(m.difference)+'</td></tr>').join('')+'</tbody></table></div></div></details>';
    });
    if(state.isAdmin&&state.deleteRequests.length){html+='<div class="cel-admin-requests"><h3>待处理删除申请</h3>'+state.deleteRequests.map(item=>'<div class="cel-request"><span><b>'+esc(item.project_name||'项目记录')+'</b>｜'+esc(item.requester_username||'用户')+'：'+esc(item.reason)+'</span><span><button class="cel-btn danger" data-action="approveDelete" data-id="'+esc(item.id)+'">同意删除</button> <button class="cel-btn" data-action="rejectDelete" data-id="'+esc(item.id)+'">保留</button></span></div>').join('')+'</div>';}
    body.innerHTML=html;bindActions();
  }
  async function api(method,body,query){
    const response=await fetch('/api/calcexperience'+(query||''),{method,headers:headers(),body:body?JSON.stringify(body):undefined});
    const data=await response.json().catch(()=>({error:'服务器返回格式异常'}));if(!response.ok||!data.ok)throw new Error(data.error||'请求失败');return data;
  }
  async function refresh(){
    const filter=root.querySelector('#celTypeFilter')?.value||'',token=++refreshToken;root.querySelector('.cel-content').innerHTML='<div class="cel-loading">正在读取经验数据…</div>';
    try{const next=await api('GET',null,'?scope='+scope+'&type='+encodeURIComponent(filter));if(!root||token!==refreshToken)return;state=next;renderTable();}catch(error){if(!root||token!==refreshToken)return;root.querySelector('.cel-content').innerHTML='<div class="cel-empty">读取失败：'+esc(error.message)+'<br><button class="cel-btn" id="celRetry">重试</button></div>';root.querySelector('#celRetry').onclick=refresh;}
  }
  function schemaFor(type){
    const fields=(MANUAL_SCHEMAS[type]||MANUAL_SCHEMAS.other).map(field=>Array.isArray(field)?{key:field[0],label:field[1],unit:field[2],category:field[3]}:{...field});
    if(type==='gaibao')fields.push({key:'firstDecoLoanPct',label:'首次装修借款比例',unit:'%',category:'finance'},
      {key:'principalRepayIntervalMonths',label:'还本间隔',unit:'月',category:'finance'},
      {key:'principalRepayPct',label:'每期归还本金比例',unit:'%',category:'finance'},
      {key:'principalRepayFinalMonth',label:'末期还本月',unit:'月',category:'finance'});
    fields.forEach(f=>{if(['rampOcc','stableOcc','occupancyRamp'].includes(f.key))f.unit='%';});
    const extra=type==='gaibao'?[['buildStart','建设起始年','年'],['buildYears','建设期','年'],['operateYears','运营期','年'],['firstMonths','首年运营月数','月'],['rateDiscount','利率折扣系数','比例']]:type==='rent'?[['operateYears','运营期','年'],['rentSpan','租金递增跨度','年'],['parkRatio','车位出租率','比例'],['otherTotal','其他年收入','万元'],['manageCoeff','管理费系数','比例'],['landArea','土地面积','㎡'],['firstRepayRatio','首年还款比例','比例'],['repayIncreaseRate','还款递增率','%'],['loanTotalYears','借款期限','年'],['invest','资本金','万元']]:type==='sale'?[['operateYears','运营期','年']]:[];
    fields.unshift(...extra.map(([key,label,unit])=>({key,label:({parkRatio:'车位收入系数',otherTotal:'其他收入（首年一次性）',invest:'建设投资'}[key]||label),unit:key==='firstRepayRatio'?'%':unit,category:'scope'})));return fields;
  }
  function metricStorageCategory(category){return {income:'income',cost:'cost',tax:'tax',finance:'profit',scope:'parameter',plan:'operation'}[category]||'other';}
  const hiddenLegacyFields=new Set(['loan','interestBase','repay','loanTotalYears','loanPlan','repayPlan','buildStart','buildYears','operateYears','firstMonths','rateDiscount']);
  function mountRepaymentOptions(params){
    if(root.querySelector('#celProjectType').value==='gaibao')root.querySelectorAll('[data-metric-key="firstDecoLoanPct"],[data-add-key="firstDecoLoanPct"]').forEach(input=>{if(input.value==='')input.value=params?.firstDecoLoanPct??80;});
    return; // 新模型内置借款还款计划，以下旧周期编辑实现仅保留备查。
    const mount=root.querySelector('.cel-metric-editor');
    let target=mount.querySelector('[data-series-years="repayPlan"]')?.closest('.cel-series-field');
    if(!target){const index=parsedRows.findIndex(row=>/^repayPlan\.\d{4}$/.test(row.metricKey));target=index<0?null:mount.querySelector('[data-existing-index="'+index+'"]')?.closest('.cel-manual-grid');}
    if(!target)target=Array.from(mount.querySelectorAll('details')).find(group=>group.querySelector('summary')?.textContent.includes('分年计划'))?.querySelector('.cel-manual-grid');
    if(!target){mount.insertAdjacentHTML('beforeend','<div class="cel-series-field" data-repayment-plan><b>还款计划（万元）</b></div>');target=mount.querySelector('[data-repayment-plan]');}
    target.insertAdjacentHTML('beforeend',calcRepaymentFields(params,'celRepay'));
  }
  function mountExperienceMonths(){
    if(!window.CalcMonthPicker)return;
    root.querySelectorAll('input[type="month"]').forEach(input=>{input.type='text';input.setAttribute('data-calc-month','');input.placeholder='YYYY-MM';});
    window.CalcMonthPicker.mount(root);
  }
  let formTemplateParams=null;
  function renderGaibaoEditor(mount,rows){
    const original=formTemplateParams||(context.updateSource&&editing?.id===context.updateSource.record.id?context.params:null)||editing?.payload?.params||(formMode==='calculation'?context.params:{});
    const params=model.buildParameters(rows,original);
    const datesPresent=Object.keys(model.monthFields).some(key=>params[key])||params.buildStart!==undefined;
    mount.innerHTML='<div data-cel-gaibao>'+calcFormHtml(params)+'</div>';
    if(original?.mode&&original.collectRentPct===undefined&&original.collectReductionPct===undefined&&original.projectSharePct===undefined)mount.insertAdjacentHTML('afterbegin','<p class="cel-note">此记录沿用旧收楼计算口径；保存后将按当前选择的方式重新测算，请核对收楼单价、减免和分成比例。</p>');
    const area=mount.querySelector('[data-cel-gaibao]');
    area.querySelectorAll('[id]').forEach(el=>{el.id='cel_'+el.id;});
    area.querySelectorAll('[data-calc-month-for]').forEach(el=>{el.dataset.calcMonthFor='cel_'+el.dataset.calcMonthFor;});
    area.querySelectorAll('input,select').forEach(input=>{
      const key=input.id.replace(/^cel_c_/,'');input.dataset.celParam=key;
      if(Object.hasOwn(model.monthFields,key)){input.dataset.monthKey=key;if(!datesPresent)input.value='';}
      else if(key==='rampOcc'){if(params.rampOcc===undefined&&!Array.isArray(params.rampRates))input.value='';}
      else if(key==='firstDecoLoanPct')input.value=params[key]??80;
      else if(key==='mode')input.value=params.mode||'lease';
      else if(key==='operateCostMode')input.value=params.operateCostMode||'per-unit';
      else if(key==='operateRentPct')input.value=params.operateRentPct??15.7;
      else if(key==='startup')input.value=params.startup??0;
      else if(key==='principalRepayMode')input.value=params.principalRepayMode||'principal-percent';
      else if(key==='principalRepayIntervalMonths')input.value=params.principalRepayIntervalMonths??6;
      else if(key==='principalRepayPct')input.value=params.principalRepayPct??2.5;
      else if(key==='principalRepayFinalMonth')input.value=params.principalRepayFinalMonth??60;
      else if(key==='collectRentPct')input.value=params.collectRentPct??20;
      else if(key==='collectReductionPct')input.value=params.collectReductionPct??(100-(params.collectPct??70));
      else if(key==='projectSharePct')input.value=params.projectSharePct??(100-(params.sharePct??40));
      else if(key==='shareStartMonth')input.value=params.shareStartMonth||params.operateStartMonth||'';
      else if(params[key]===undefined&&!(params.occupancyMode==='monthly-phases'&&key==='rampIntervalMonths'))input.value='';
    });
    const mode=area.querySelector('[data-cel-param="mode"]');mode.removeAttribute('onchange');
    mode.onchange=()=>{area.querySelectorAll('[data-collect-mode]').forEach(el=>{el.style.display=el.dataset.collectMode.split(' ').includes(mode.value)?'':'none';});};
    const costMode=area.querySelector('[data-cel-param="operateCostMode"]');costMode.removeAttribute('onchange');
    costMode.onchange=()=>{area.querySelectorAll('[data-operate-cost-mode]').forEach(el=>{el.style.display=el.dataset.operateCostMode===costMode.value?'':'none';});};
    const repayMode=area.querySelector('[data-cel-param="principalRepayMode"]');repayMode.removeAttribute('onchange');
    repayMode.onchange=()=>{area.querySelectorAll('[data-principal-repay-mode]').forEach(el=>{el.style.display=el.dataset.principalRepayMode===repayMode.value?'':'none';});};
    const results=new Map(COMMON_RESULT_FIELDS.map(([key,label,unit])=>[key,{metricKey:key,metricName:label,unit}]));
    rows.filter(row=>model.isResult(row)&&row.note!=='测算结果'&&row.resultVersion!=='system').forEach(row=>results.set(row.metricKey,row));
    mount.insertAdjacentHTML('beforeend','<details class="cel-metric-group"><summary>财务测算指标 · Excel / 人工原值</summary><div class="cel-manual-grid">'+Array.from(results.values()).map((row,index)=>'<label>'+esc(row.metricName)+'<input type="number" step="any" data-cel-result="'+index+'" value="'+esc(row.metricValue??row.value??'')+'"><small>'+esc(row.unit)+'</small></label>').join('')+'</div></details>');
    mount._celResults=Array.from(results.values());
  }
  function collectGaibaoEditor(){
    const mount=root.querySelector('.cel-metric-editor'),params={},rows=[];
    mount.querySelectorAll('[data-cel-param]').forEach(input=>{
      const key=input.dataset.celParam,value=input.value.trim();if(!value)return;
      if(key==='rampOcc'){
        const parts=value.split(/[；;]/).map(x=>x.trim());
        if(parts.some(x=>x===''||!Number.isFinite(Number(x))||Number(x)<0||Number(x)>100))throw new Error('爬坡出租率须为0—100的百分数，用分号分隔');
        params.rampRates=parts.map(x=>Number(x)/100);params.rampOcc=params.rampRates[0];
      }else if(input.type==='number'){if(!Number.isFinite(Number(value)))throw new Error('请填写有效数字');params[key]=Number(value);}
      else params[key]=value;
    });
    if(params.stableOcc!==undefined){if(params.stableOcc<0||params.stableOcc>100)throw new Error('稳定期出租率须在0—100之间');params.stableOcc/=100;}
    if(params.operateCostMode==='rent-percent'&&(!Number.isFinite(params.operateRentPct)||params.operateRentPct<0||params.operateRentPct>100))throw new Error('运营成本占实际租金比例须为0—100%');
    if(params.principalRepayMode==='principal-percent'&&(!Number.isInteger(params.principalRepayIntervalMonths)||params.principalRepayIntervalMonths<1||params.principalRepayIntervalMonths>1200||!Number.isFinite(params.principalRepayPct)||params.principalRepayPct<0||params.principalRepayPct>100||!Number.isInteger(params.principalRepayFinalMonth)||params.principalRepayFinalMonth<1||params.principalRepayFinalMonth>1200))throw new Error('按本金比例还本时，请核对还本间隔、每期比例及末期还本月');
    if(params.mode==='rent-percent'&&(!Number.isFinite(params.collectRentPct)||params.collectRentPct<0||params.collectRentPct>100))throw new Error('实际租金收楼比例须为0—100%');
    model.validateMonths(params);
    const phaseKeys=['rampStartMonth','rampEndMonth','stableStartMonth','rampIntervalMonths'];
    if(phaseKeys.some(key=>params[key]!==undefined)){
      if(!phaseKeys.every(key=>params[key]!==undefined)||!params.rampRates||params.stableOcc===undefined||!params.operateStartMonth)throw new Error('请完整填写爬坡起止月、间隔、出租率及稳定期和运营时间');
      params.occupancyMode='monthly-phases';NRCalc.fromParams(params);
    }else if(params.rampRates?.length>1)throw new Error('多段爬坡出租率需要填写起止月和间隔月数');
    params.firstDecoLoanPct??=80;params.debtModel='monthly-v2';
    for(const [key,value] of Object.entries(params)){
      if(typeof value!=='number')continue;
      if((key==='collect'&&params.mode==='rent-percent')||(key==='collectRentPct'&&params.mode!=='rent-percent')||(['collectReductionPct','projectSharePct'].includes(key)&&params.mode!=='share')||(key==='unitCost'&&params.operateCostMode==='rent-percent')||(key==='operateRentPct'&&params.operateCostMode!=='rent-percent')||(['principalRepayIntervalMonths','principalRepayPct','principalRepayFinalMonth'].includes(key)&&params.principalRepayMode==='rent-surplus'))continue;
      const field=schemaFor('gaibao').find(f=>f.key===key),input=mount.querySelector('[data-cel-param="'+key+'"]');
      const percent=['rampOcc','stableOcc'].includes(key),display=percent?value*100:value;
      rows.push(model.normalizeMetric({metricKey:key,metricName:field?.label||input?.parentElement.querySelector('label')?.textContent||key,metricValue:display,unit:percent?'%':field?.unit||'',category:metricStorageCategory(field?.category||'scope'),note:'测算参数'}));
    }
    mount.querySelectorAll('[data-cel-result]').forEach(input=>{if(input.value.trim()==='')return;const value=Number(input.value);if(!Number.isFinite(value))throw new Error('经济指标须为有效数字');rows.push({...mount._celResults[Number(input.dataset.celResult)],metricValue:value,value,note:'人工/Excel原值',resultVersion:'excel'});});
    return {params,rows};
  }
  function renderMetricEditor(type,rows){
    const mount=root.querySelector('.cel-metric-editor');if(!mount)return;
    if(type==='gaibao'){renderGaibaoEditor(mount,rows);return;}
    // Dates remain typed parameters, not numeric benchmark metrics.
    const dateParams=editing?.payload?.params||(formMode==='calculation'?context.params:{});
    const renderDates=()=>{if(type!=='gaibao')return;mount.insertAdjacentHTML('afterbegin','<details class="cel-metric-group" open><summary>建设与运营时间</summary><div class="cel-manual-grid">'+Object.entries(model.monthFields).map(([key,label])=>'<label class="cel-manual-field">'+esc(label)+'<input type="month" min="1900-01" max="2200-12" data-month-key="'+key+'" value="'+esc(dateParams?.[key]||'')+'"></label>').join('')+'</div></details>');};
    if(formMode!=='manual'){
      const existing=(rows||[]).filter(row=>row.note!=='测算结果'),extra=schemaFor(type).filter(field=>!field.series&&!existing.some(row=>row.metricKey===field.key));
      const groups={};
      const add=(category,html)=>{(groups[category]||(groups[category]=[])).push(html);};
      (rows||[]).forEach((row,index)=>{if(row.note==='测算结果'||(type==='gaibao'&&hiddenLegacyFields.has(row.metricKey.split('.')[0])))return;const field=schemaFor(type).find(f=>f.key===row.metricKey||row.metricKey.startsWith(f.key+'.'));add(model.isResult(row)?'results':field?.category||'scope','<label class="cel-manual-field">'+esc(row.metricName)+'<input type="number" step="any" data-existing-index="'+index+'" value="'+esc(row.metricValue??row.value)+'"><small>'+esc(row.unit||'')+' · '+esc(row.periodLabel||'')+'</small></label>');});
      extra.filter(field=>type!=='gaibao'||!hiddenLegacyFields.has(field.key)).forEach(field=>add(field.category,'<label class="cel-manual-field">'+esc(field.label)+'<input type="number" step="any" data-add-key="'+esc(field.key)+'"><small>'+esc(field.unit)+'</small></label>'));
      mount.innerHTML='<div class="cel-editor-title"><b>分类编辑指标</b><span>空值会移除该指标；原版本留存。系统结果不作为 Excel 原值。</span></div>'+Object.keys(CATEGORY_NAMES).filter(key=>groups[key]).map(key=>'<details class="cel-metric-group"><summary>'+esc(CATEGORY_NAMES[key])+' · '+groups[key].length+'项</summary><div class="cel-manual-grid">'+groups[key].join('')+'</div></details>').join('');renderDates();return;
    }
    const groups={};schemaFor(type).filter(field=>type!=='gaibao'||!hiddenLegacyFields.has(field.key)).forEach(field=>{(groups[field.category]||(groups[field.category]=[])).push(field);});
    mount.innerHTML='<div class="cel-editor-title"><b>按类别填写指标</b><span>只填写有依据的数据，空项不会保存。分年数据采用“年份范围 + 对应数值”两栏。</span></div>'+Object.entries(groups).map(([category,fields],index)=>'<details class="cel-metric-group" '+(index<3?'open':'')+'><summary><span>'+esc(CATEGORY_NAMES[category]||category)+'</span><small>'+fields.length+'项</small></summary><div class="cel-manual-grid">'+fields.map(field=>field.series?'<div class="cel-series-field"><b>'+esc(field.label)+'</b><label>年份范围<input type="text" data-series-years="'+esc(field.key)+'" placeholder="如 2028-2030"></label><label>对应数值（分号分隔）<input type="text" data-series-values="'+esc(field.key)+'" placeholder="如 500；600；700"></label><small>单位：'+esc(field.unit||'无')+'</small></div>':'<label class="cel-manual-field"><span>'+esc(field.label)+'</span><input type="number" step="any" data-metric-key="'+esc(field.key)+'" placeholder="请输入"><small>'+esc(field.unit||'无单位')+'</small></label>').join('')+'</div></details>').join('');
  }
  function renderMonthInputs(){
    const mount=root.querySelector('.cel-metric-editor');
    if(mount.querySelector('[data-cel-gaibao]'))return;
    if(root.querySelector('#celProjectType').value!=='gaibao'||mount.querySelector('[data-month-key]'))return;
    mount.insertAdjacentHTML('afterbegin','<details class="cel-metric-group" open><summary>建设与运营时间</summary><div class="cel-manual-grid">'+Object.entries(model.monthFields).map(([key,label])=>'<label class="cel-manual-field">'+esc(label)+'<input type="month" min="1900-01" max="2200-12" data-month-key="'+key+'"></label>').join('')+'</div></details>');
  }
  function parseYears(text){
    const clean=String(text||'').replace(/年/g,'').trim(),match=clean.match(/^(\d{4})\s*[-至~～]\s*(\d{4})$/);let years=[];
    if(match){const start=Number(match[1]),end=Number(match[2]);if(end<start||end-start>100)throw new Error('分年数据的年份范围不合法');for(let year=start;year<=end;year++)years.push(String(year));}
    else years=clean.split(/[；;,，\s]+/).filter(Boolean);
    if(years.some(year=>!/^\d{4}$/.test(year))||new Set(years).size!==years.length)throw new Error('年份请填写“2028-2030”或用分号列出，且不能重复');return years;
  }
  function collectManualMetrics(){
    const type=root.querySelector('#celProjectType').value,fields=new Map(schemaFor(type).map(field=>[field.key,field])),rows=[];
    root.querySelectorAll('[data-metric-key]').forEach(input=>{if(input.value.trim()==='')return;const field=fields.get(input.dataset.metricKey),value=Number(input.value);if(!field||!Number.isFinite(value))throw new Error('请填写有效数值：'+(field?field.label:input.dataset.metricKey));rows.push({category:metricStorageCategory(field.category),metricKey:field.key,metricName:field.label,metricValue:value,unit:field.unit,ratioPct:field.unit==='比例'?value*100:(field.unit==='%'?value:null),periodLabel:'手动录入',note:'测算参数'});});
    root.querySelectorAll('[data-series-years]').forEach(yearInput=>{const key=yearInput.dataset.seriesYears,valueInput=root.querySelector('[data-series-values="'+key+'"]'),yearsText=yearInput.value.trim(),valuesText=valueInput.value.trim();if(!yearsText&&!valuesText)return;if(!yearsText||!valuesText)throw new Error('请同时填写'+fields.get(key).label+'的年份范围和对应数值');const years=parseYears(yearsText),values=valuesText.split(/[；;,，\s]+/).filter(Boolean).map(Number);if(values.some(value=>!Number.isFinite(value))||values.length!==years.length)throw new Error(fields.get(key).label+'的数值个数必须与年份个数一致');years.forEach((year,index)=>rows.push({category:'operation',metricKey:key+'.'+year,metricName:fields.get(key).label,metricValue:values[index],unit:fields.get(key).unit,ratioPct:fields.get(key).unit==='比例'?values[index]*100:null,periodLabel:year+'年',note:'测算参数'}));});
    return rows.map(model.normalizeMetric);
  }
  function showForm(rows,sourceKind,record=null){
    editing=record;formMode=sourceKind||'manual';formTemplateParams=rows?.templateParams||null;parsedRows=(rows||[]).map(model.normalizeMetric);const form=root.querySelector('.cel-form');form.hidden=false;
    root.querySelector('#celProjectName').value=context.projectName||'';root.querySelector('#celProjectType').value=context.projectType||'gaibao';root.querySelector('#celRegion').value=context.region||'';root.querySelector('#celBaseYear').value=context.baseYear||new Date().getFullYear();root.querySelector('#celSourceNote').value=sourceKind==='calculation'?'来自当前财务测算':'';
    root.querySelector('.cel-form h3').textContent=sourceKind==='manual'?'手动新增经验数据':'新增经验数据';renderMetricEditor(root.querySelector('#celProjectType').value,parsedRows);
    root.querySelector('.cel-file-help').textContent=sourceKind==='manual'?'空白字段不会保存；保存后进入管理员审核。':(parsedRows.length?'已识别 '+parsedRows.length+' 项指标，请核对项目信息后保存。':'请选择包含指标明细的文件。');
    if(record){for(const [id,key] of [['celProjectName','projectName'],['celProjectType','projectType'],['celRegion','region'],['celBaseYear','baseYear'],['celSourceNote','sourceNote']])root.querySelector('#'+id).value=record[key]||'';root.querySelector('.cel-form h3').textContent='编辑项目 · '+record.projectName;renderMetricEditor(record.projectType,parsedRows);}
    renderMonthInputs();
    mountRepaymentOptions(rows?.templateParams||(context.updateSource&&record?.id===context.updateSource.record.id?context.params:null)||record?.payload?.params||(sourceKind==='calculation'?context.params:{}));
    if(rows?.templateParams)root.querySelectorAll('[data-month-key]').forEach(input=>{input.value=rows.templateParams[input.dataset.monthKey]||'';});
    mountExperienceMonths();root.querySelector('#celProjectType').disabled=!!record;
    root.querySelector('#celSave').textContent=scope==='private'?'保存自测项目':'保存并提交审核';root.querySelector('.cel-file-help').textContent=scope==='private'?'仅本人使用，保存后立即可用。':'集团共享记录，保存后需管理员审核。';root.querySelector('.cel-message').textContent='';form.scrollIntoView({block:'start'});
  }
  function normalizeSheetRows(rows){return rows.map(row=>{
    const metricName=row['指标名称']||row['指标']||row.metricName,field=schemaFor(context.projectType||'gaibao').find(x=>x.label===metricName);
    return {category:row['类别']||row['指标类别']||row.category,metricName,metricKey:row['指标键']||row.metricKey||field?.key||metricName,metricValue:row['数值']??row.metricValue??row.value,unit:row['单位']||row.unit||field?.unit,ratioPct:row['占比%']??row['占比']??row.ratioPct,periodLabel:row['期间']||row.periodLabel,note:row['备注']||row.note};
  }).filter(x=>x.metricName&&num(x.metricValue)!==null).map(model.normalizeMetric);}
  async function parseFile(file){
    const name=file.name.toLowerCase();if(name.endsWith('.json')){const data=JSON.parse(await file.text());return normalizeSheetRows(Array.isArray(data)?data:(data.metrics||[]));}
    if(!window.XLSX){if(typeof loadScript==='function')await loadScript('xlsx.full.min.js');else await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='xlsx.full.min.js';script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});}
    if(!window.XLSX)throw new Error('表格读取组件加载失败');const workbook=XLSX.read(await file.arrayBuffer(),{type:'array'}),sheet=workbook.Sheets[workbook.SheetNames[0]];
    const rows=normalizeSheetRows(XLSX.utils.sheet_to_json(sheet,{defval:''}));
    rows.templateParams={};if(workbook.Sheets['建设运营时间'])for(const row of XLSX.utils.sheet_to_json(workbook.Sheets['建设运营时间'],{defval:''})){if(model.monthFields[row['指标键']]&&row['年月'])rows.templateParams[row['指标键']]=String(row['年月']).trim();}
    if(workbook.Sheets['周期还款计划']){const p=XLSX.utils.sheet_to_json(workbook.Sheets['周期还款计划'],{defval:''})[0];if(p&&p['间隔月数']){const interval=Number(p['间隔月数']),amounts=String(p['每期万元']||'').trim();if(!Number.isInteger(interval)||interval<1||interval>120)throw new Error('还款间隔须为 1—120 个整月');rows.templateParams.repaymentSchedule={intervalMonths:interval,firstMonth:String(p['首次年月']||''),amounts:amounts?amounts.split(/[；;,，\s]+/).map(Number):[]};}}
    model.validateMonths(rows.templateParams);return rows;
  }
  async function downloadTemplate(){
    try{if(!window.XLSX)await loadScript('xlsx.full.min.js');const wb=XLSX.utils.book_new(),type=context.projectType||'gaibao';
      const rows=schemaFor(type).filter(f=>!f.series&&(type!=='gaibao'||!hiddenLegacyFields.has(f.key))).map(f=>({'类别':metricStorageCategory(f.category),'指标键':f.key,'指标名称':f.label,'数值':f.key==='firstDecoLoanPct'?80:'','单位':f.unit||'','备注':f.unit==='%'?'填写百分数，例如 95，不填 0.95':'空白不导入'}));
      schemaFor(type).filter(f=>f.series&&(type!=='gaibao'||!hiddenLegacyFields.has(f.key))).forEach(f=>rows.push({'类别':'operation','指标键':f.key+'.2028','指标名称':f.label,'数值':'','单位':f.unit,'备注':'一行一个年度，可复制行并修改指标键末尾年份；空白不导入'}));
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'指标填写');
      if(type==='gaibao')XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(Object.entries(model.monthFields).map(([key,label])=>({'指标键':key,'指标名称':label,'年月':'','填写说明':'文本格式 YYYY-MM，例如 2027-01；四项一起填写'}))),'建设运营时间');
      XLSX.writeFile(wb,'财务经验库填写模板.xlsx');
    }catch(error){alert('模板下载失败：'+error.message);}
  }
  async function saveForm(){
    if(context.canSave&&!context.canSave()){root.querySelector('.cel-message').textContent='项目已切换，请关闭并重新应用经验项目后更新';return;}
    const button=root.querySelector('#celSave'),message=root.querySelector('.cel-message');let rows=parsedRows,gaibaoDraft=null;try{if(root.querySelector('[data-cel-gaibao]')){gaibaoDraft=collectGaibaoEditor();rows=gaibaoDraft.rows;}else if(formMode==='manual')rows=collectManualMetrics();else rows=Array.from(root.querySelectorAll('[data-existing-index]')).filter(input=>input.value.trim()!=='').map(input=>model.normalizeMetric({...parsedRows[Number(input.dataset.existingIndex)],metricValue:Number(input.value),value:Number(input.value)}));}catch(error){message.className='cel-message error';message.textContent=error.message;return;}
    root.querySelectorAll('[data-add-key]').forEach(input=>{if(input.value.trim()==='')return;const field=schemaFor(root.querySelector('#celProjectType').value).find(f=>f.key===input.dataset.addKey);rows.push({metricKey:field.key,metricName:field.label,metricValue:Number(input.value),unit:field.unit,category:metricStorageCategory(field.category),note:'测算参数'});});
    if(!rows.length){message.className='cel-message error';message.textContent='请至少填写一项有效指标。';return;}
    button.disabled=true;message.className='cel-message';message.textContent='正在保存…';
    try{const projectType=root.querySelector('#celProjectType').value,base=JSON.parse(JSON.stringify(editing?.payload?.params||(formMode==='calculation'?context.params:{})));
      parsedRows.forEach(row=>{if(projectType==='gaibao'&&hiddenLegacyFields.has(row.metricKey.split('.')[0]))return;if(rows.some(r=>r.metricKey===row.metricKey)||(model.isResult(row)&&row.metricKey!=='totalInvestment'))return;const match=String(row.metricKey).match(/^(.+)\.(\d{4})$/);if(match&&base[match[1]])delete base[match[1]][match[2]];else delete base[row.metricKey];});
      root.querySelectorAll('[data-month-key]').forEach(input=>{if(input.value)base[input.dataset.monthKey]=input.value;else delete base[input.dataset.monthKey];});
      if(root.querySelector('#celRepayInterval'))base.repaymentSchedule=calcReadRepayment('celRepay');
      const params=model.validateMonths(gaibaoDraft?gaibaoDraft.params:model.buildParameters(rows,base));
      if(projectType==='gaibao'){params.firstDecoLoanPct??=80;params.debtModel='monthly-v2';if(!Number.isFinite(params.firstDecoLoanPct)||params.firstDecoLoanPct<0||params.firstDecoLoanPct>100)throw new Error('首次装修借款比例须在0%至100%之间');}
      let calculation;
      try{if(typeof context.onCalculate!=='function')throw new Error('测算引擎未加载，请从财务测算重新进入');calculation={summary:context.onCalculate(projectType,params),calculatedAt:Date.now()};}catch(error){if(context.updateSource&&editing?.id===context.updateSource.record.id)throw error;calculation={summary:{},error:'系统版待计算：'+error.message};}
      const data=await api('POST',{action:editing?'edit':undefined,recordId:editing?.id,revision:editing?.revision,scope,payload:{params,calculation},projectId:editing?.projectId||context.projectId||'',projectName:root.querySelector('#celProjectName').value,projectType,region:root.querySelector('#celRegion').value,baseYear:root.querySelector('#celBaseYear').value,sourceKind:formMode,sourceNote:root.querySelector('#celSourceNote').value,metrics:rows});message.textContent=data.message;parsedRows=[];root.querySelector('.cel-form').hidden=true;await refresh();}catch(error){message.className='cel-message error';message.textContent=error.message;}finally{button.disabled=false;}
  }
  async function recordAction(action,id){
    try{
      if(action==='edit'){const record=state.records.find(item=>item.id===id);showForm(state.metrics.filter(item=>item.recordId===id),'edit',record);return;}
      if(action==='apply'){
        const record=state.records.find(item=>item.id===id),metrics=state.metrics.filter(item=>item.recordId===id);
        if(!record||!metrics.length)throw new Error('这条经验记录没有可应用的测算参数。');
        if(context.projectType&&record.projectType!==context.projectType)throw new Error('只能应用与当前测算类型一致的经验数据。');
        context.onApply(record,metrics);return;
      }
      if(action==='requestDelete'){const reason=prompt('请填写申请删除原因（管理员处理前数据仍保留）：');if(!reason)return;await api('POST',{action,recordId:id,reason});}
      else if(action==='delete'){if(!confirm('确认删除这条经验记录？正式项目和原测算不会被删除。'))return;await api('DELETE',null,'?id='+encodeURIComponent(id));}
      else if(action==='confirm'||action==='reject'){const note=prompt(action==='confirm'?'审核备注（可不填）：':'请填写驳回原因：')||'';await api('PATCH',{action,recordId:id,note});}
      else {const note=prompt(action==='approveDelete'?'删除审核备注（可不填）：':'保留原因（可不填）：')||'';await api('PATCH',{action,requestId:id,note});}
      await refresh();
    }catch(error){alert(error.message);}
  }
  function bindActions(){root.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>recordAction(button.dataset.action,button.dataset.id));}
  function renderShell(){
    root=document.createElement('div');root.className='cel-overlay';root.innerHTML='<section class="cel-modal" role="dialog" aria-modal="true" aria-label="财务测算经验库"><header class="cel-head"><div><h2>财务测算经验库</h2><p>按项目类型集中查看收入、成本、税费、利润和关键比例，为当前测算提供经验区间参考。</p></div><button class="cel-close" aria-label="关闭">×</button></header><div class="cel-toolbar"><label>项目类型<select id="celTypeFilter"><option value="">全部类型</option>'+Object.entries(TYPES).map(([key,name])=>'<option value="'+key+'">'+name+'</option>').join('')+'</select></label><button class="cel-btn primary" id="celUseCurrent">录入当前测算</button><button class="cel-btn" id="celManual">手动新增数据</button><button class="cel-btn" id="celUpload">上传 Excel / CSV / JSON</button><input type="file" id="celFile" accept=".xlsx,.xls,.csv,.json" hidden><span class="cel-permission-note">普通用户可录入、上传和申请删除；只有管理员可审核、删除。</span></div><div class="cel-body"><section class="cel-form" hidden><h3>新增经验数据</h3><div class="cel-fields"><div class="cel-field project"><label>项目名称</label><input id="celProjectName" maxlength="120"></div><div class="cel-field"><label>项目类型</label><select id="celProjectType">'+Object.entries(TYPES).map(([key,name])=>'<option value="'+key+'">'+name+'</option>').join('')+'</select></div><div class="cel-field"><label>基准年份</label><input id="celBaseYear" type="number" min="1900" max="2200"></div><div class="cel-field region"><label>地区</label><input id="celRegion" maxlength="120"></div><div class="cel-field note"><label>数据说明</label><input id="celSourceNote" maxlength="300"></div></div><div class="cel-metric-editor"></div><div class="cel-upload-row"><button class="cel-btn primary" id="celSave">保存并提交审核</button><button class="cel-btn" id="celCancel">取消</button><span class="cel-file-help"></span></div><div class="cel-message"></div></section><div class="cel-content"><div class="cel-loading">正在读取经验数据…</div></div></div></section>';
    document.body.appendChild(root);root.querySelector('.cel-close').onclick=requestClose;root.querySelector('#celTypeFilter').onchange=refresh;
    const tabs=document.createElement('div');tabs.className='cel-scope-tabs';tabs.innerHTML='<button class="cel-btn primary" data-scope="group">集团项目</button><button class="cel-btn" data-scope="private">自测项目</button>';root.querySelector('.cel-toolbar').before(tabs);tabs.querySelectorAll('button').forEach(button=>button.onclick=()=>{if(!root.querySelector('.cel-form').hidden&&!confirm('切换将放弃当前未保存输入，继续吗？'))return;scope=button.dataset.scope;root.querySelector('.cel-form').hidden=true;tabs.querySelectorAll('button').forEach(b=>b.classList.toggle('primary',b===button));root.querySelector('.cel-permission-note').textContent=scope==='private'?'仅本人可见，无需集团审核；不会进入共享经验区间。':'集团共享数据，修改后重新审核。';root.querySelector('#celUpload').textContent=scope==='private'?'导入自测文件':'上传 Excel / CSV / JSON';refresh();});
    root.querySelector('#celUseCurrent').onclick=()=>{const rows=currentMetrics();if(!rows.length){alert('当前还没有可录入的财务测算结果。');return;}showForm(rows,'calculation');};
    root.querySelector('#celManual').onclick=()=>showForm([],'manual');
    root.querySelector('#celUpload').insertAdjacentHTML('beforebegin','<button class="cel-btn" id="celTemplate">下载 Excel 填写模板</button>');root.querySelector('#celTemplate').onclick=downloadTemplate;
    root.querySelector('#celProjectType').onchange=event=>{if(formMode==='manual'){renderMetricEditor(event.target.value,[]);renderMonthInputs();mountRepaymentOptions({});mountExperienceMonths();}};
    root.querySelector('#celUpload').onclick=()=>root.querySelector('#celFile').click();root.querySelector('#celFile').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{const rows=await parseFile(file);if(!rows.length)throw new Error('未识别到有效数据。表格至少需要“指标名称”和“数值”两列。');showForm(rows,'file');}catch(error){alert('文件读取失败：'+error.message);}};
    root.querySelector('#celSave').onclick=async()=>{const previous=editing;await saveForm();if(context.updateSource&&root.querySelector('.cel-form').hidden&&previous){const fresh=state.records.find(r=>r.id===previous.id);if(fresh){context.updateSource.record=JSON.parse(JSON.stringify(fresh));context.updateSource.metrics=state.metrics.filter(m=>m.recordId===fresh.id);}}};root.querySelector('#celCancel').onclick=()=>{root.querySelector('.cel-form').hidden=true;parsedRows=[];};
  }
  function requestClose(){
    if(root&&!root.querySelector('.cel-form').hidden&&!confirm('当前经验数据尚未保存。确定关闭并放弃输入吗？'))return;
    close();
  }
  function close(){refreshToken++;if(root){window.CalcMonthPicker?.close();root.remove();root=null;}document.removeEventListener('keydown',onKey);}
  function onKey(event){if(event.key==='Escape')requestClose();}
  async function open(nextContext){model=await import('./calc-experience-model.mjs');if(!window.NRCalc&&typeof loadScript==='function')await loadScript('nrcalc.js');if(root)return;scope=nextContext?.updateSource?.record.scope||'group';context={...(nextContext||{})};if(!context.onCalculate&&typeof calcExperienceCalculate==='function')context.onCalculate=calcExperienceCalculate;renderShell();document.addEventListener('keydown',onKey);refresh();
    if(context.updateSource){const source=context.updateSource,record={...source.record,payload:{...source.record.payload,params:context.params}};const rows=currentMetrics().filter(r=>!model.isResult(r)).concat(source.metrics.filter(model.isResult));showForm(rows,'edit',record);root.querySelector('.cel-form h3').textContent='更新当前项目测算版本 · '+record.projectName;root.querySelector('#celSave').textContent='确认更新原经验项目';root.querySelector('.cel-file-help').textContent='以当前参数替代该经验项目的最新测算版，不新增项目；保留历史版本与Excel原值。'+(scope==='group'?'集团项目更新后重新审核。':'');}
  }
  window.CalcExperienceLibrary={open,close,currentMetrics};
})();
