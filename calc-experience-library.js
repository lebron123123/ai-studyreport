(function(){
  'use strict';
  const TYPES={gaibao:'非居改保',rent:'出租类',sale:'出售类',commercial:'商业经营',other:'其他类型'};
  const SUMMARY_LABELS={irr:'全投资IRR',totalIncome:'全周期总收入',totalRevenue:'全周期总收入',totalCost:'总成本',totalTax:'税费合计',totalNetProfit:'净利润合计',totalProfit:'利润合计',totalNpv:'累计净现值',npv:'净现值',totalInvestment:'总投资'};
  const CATEGORY_NAMES={scope:'项目规模与期限',income:'收入与运营',cost:'成本与投资',finance:'融资与评价',tax:'税费',plan:'分年计划',results:'财务测算指标 · Excel / 人工原值'};
  const COMMON_RESULT_FIELDS=[['totalInvestment','总投资','万元','results'],['totalIncome','全周期总收入','万元','results'],['totalCost','总成本','万元','results'],['totalTax','税费合计','万元','results'],['totalNetProfit','净利润合计','万元','results'],['irr','全投资IRR','%','results']];
  const MANUAL_SCHEMAS={
    gaibao:[
      ['area','住宅面积','㎡','scope'],['units','总套数','套','scope'],['rent','起始租金','元/㎡/月','income'],['rentSpan','租金递增跨度','年','income'],['rentRate','租金递增率','%','income'],['rampOcc','首年出租率','比例','income'],['stableOcc','稳定期出租率','比例','income'],['collect','收楼单价','元/㎡/月','cost'],['deco','首次装修单方造价','元/㎡','cost'],['decoInt','装修间隔','年','cost'],['decoRatio','二次装修成本系数','比例','cost'],['unitCost','单套月运营成本','元/套/月','cost'],['startup','开办费','万元','cost'],['loan','总借款额','万元','finance'],['interestBase','计息本金','万元','finance'],['loanRate','贷款年利率','%','finance'],['discount','折现率','%','finance'],['repay','年均还款额','万元/年','finance'],['loanTotalYears','借款期限','年','finance'],
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
      const metrics=metricMap.get(record.id)||[],inputs=metrics.filter(m=>!model.isResult(m));
      let system=record.payload?.calculation;
      if(!system){try{system={summary:context.onCalculate(record.projectType,model.buildParameters(metrics,record.payload?.params||{}))};}catch(error){system={error:'历史记录尚不能完整计算，请编辑补充参数：'+error.message};}}
      const comparison=model.compareResults(metrics,system.summary||{});
      html+='<details class="cel-project"><summary><span><b>'+esc(record.projectName)+'</b><small>'+esc(record.typeName||TYPES[record.projectType])+' · '+esc(record.region||'地区未填写')+' · '+metrics.length+'项</small></span><span class="cel-status '+esc(record.status)+'">'+(scope==='private'?'个人自测':esc(statusName(record.status)))+'</span><span>展开 / 收起</span></summary><div class="cel-project-body">'+actionHtml(record);
      html+='<h3>测算参数</h3><div class="cel-table-wrap"><table class="cel-table"><thead><tr><th>类别</th><th>指标</th><th>数值</th><th>经验区间</th><th>辅助判断</th></tr></thead><tbody>'+inputs.map(m=>'<tr><td>'+esc(m.categoryName||m.category)+'</td><td>'+esc(m.metricName)+'<small>'+esc(m.periodLabel)+'</small></td><td>'+fmt(m.value??m.metricValue)+' '+esc(m.unit)+'</td><td>'+rangeHtml(record,m)+'</td><td>'+assessHtml(record,m)+'</td></tr>').join('')+'</tbody></table></div>';
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
    fields.forEach(f=>{if(['rampOcc','stableOcc','occupancyRamp'].includes(f.key))f.unit='%';});
    const extra=type==='gaibao'?[['buildStart','建设起始年','年'],['buildYears','建设期','年'],['operateYears','运营期','年'],['firstMonths','首年运营月数','月'],['rateDiscount','利率折扣系数','比例']]:type==='rent'?[['operateYears','运营期','年'],['rentSpan','租金递增跨度','年'],['parkRatio','车位出租率','比例'],['otherTotal','其他年收入','万元'],['manageCoeff','管理费系数','比例'],['landArea','土地面积','㎡'],['firstRepayRatio','首年还款比例','比例'],['repayIncreaseRate','还款递增率','%'],['loanTotalYears','借款期限','年'],['invest','资本金','万元']]:type==='sale'?[['operateYears','运营期','年']]:[];
    fields.unshift(...extra.map(([key,label,unit])=>({key,label:({parkRatio:'车位收入系数',otherTotal:'其他收入（首年一次性）',invest:'建设投资'}[key]||label),unit:key==='firstRepayRatio'?'%':unit,category:'scope'})));return fields;
  }
  function metricStorageCategory(category){return {income:'income',cost:'cost',tax:'tax',finance:'profit',scope:'parameter',plan:'operation'}[category]||'other';}
  function renderMetricEditor(type,rows){
    const mount=root.querySelector('.cel-metric-editor');if(!mount)return;
    if(formMode!=='manual'){
      const existing=(rows||[]).filter(row=>row.note!=='测算结果'),extra=schemaFor(type).filter(field=>!field.series&&!existing.some(row=>row.metricKey===field.key));
      mount.innerHTML='<div class="cel-editor-title"><b>编辑已保存 / 导入的指标</b><span>空值会移除该指标；原版本留存。系统结果不作为 Excel 原值。</span></div><div class="cel-manual-grid">'+(rows||[]).map((row,index)=>row.note==='测算结果'?'':'<label class="cel-manual-field">'+esc(row.metricName)+'<input type="number" step="any" data-existing-index="'+index+'" value="'+esc(row.metricValue??row.value)+'"><small>'+esc(row.unit||'')+' · '+esc(row.periodLabel||'')+'</small></label>').join('')+extra.map(field=>'<label class="cel-manual-field">'+esc(field.label)+'<input type="number" step="any" data-add-key="'+esc(field.key)+'"><small>'+esc(field.unit)+'</small></label>').join('')+'</div>';return;
    }
    const groups={};schemaFor(type).forEach(field=>{(groups[field.category]||(groups[field.category]=[])).push(field);});
    mount.innerHTML='<div class="cel-editor-title"><b>按类别填写指标</b><span>只填写有依据的数据，空项不会保存。分年数据采用“年份范围 + 对应数值”两栏。</span></div>'+Object.entries(groups).map(([category,fields],index)=>'<details class="cel-metric-group" '+(index<3?'open':'')+'><summary><span>'+esc(CATEGORY_NAMES[category]||category)+'</span><small>'+fields.length+'项</small></summary><div class="cel-manual-grid">'+fields.map(field=>field.series?'<div class="cel-series-field"><b>'+esc(field.label)+'</b><label>年份范围<input type="text" data-series-years="'+esc(field.key)+'" placeholder="如 2028-2030"></label><label>对应数值（分号分隔）<input type="text" data-series-values="'+esc(field.key)+'" placeholder="如 500；600；700"></label><small>单位：'+esc(field.unit||'无')+'</small></div>':'<label class="cel-manual-field"><span>'+esc(field.label)+'</span><input type="number" step="any" data-metric-key="'+esc(field.key)+'" placeholder="请输入"><small>'+esc(field.unit||'无单位')+'</small></label>').join('')+'</div></details>').join('');
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
    editing=record;formMode=sourceKind||'manual';parsedRows=(rows||[]).map(model.normalizeMetric);const form=root.querySelector('.cel-form');form.hidden=false;
    root.querySelector('#celProjectName').value=context.projectName||'';root.querySelector('#celProjectType').value=context.projectType||'gaibao';root.querySelector('#celRegion').value=context.region||'';root.querySelector('#celBaseYear').value=context.baseYear||new Date().getFullYear();root.querySelector('#celSourceNote').value=sourceKind==='calculation'?'来自当前财务测算':'';
    root.querySelector('.cel-form h3').textContent=sourceKind==='manual'?'手动新增经验数据':'新增经验数据';renderMetricEditor(root.querySelector('#celProjectType').value,parsedRows);
    root.querySelector('.cel-file-help').textContent=sourceKind==='manual'?'空白字段不会保存；保存后进入管理员审核。':(parsedRows.length?'已识别 '+parsedRows.length+' 项指标，请核对项目信息后保存。':'请选择包含指标明细的文件。');
    if(record){for(const [id,key] of [['celProjectName','projectName'],['celProjectType','projectType'],['celRegion','region'],['celBaseYear','baseYear'],['celSourceNote','sourceNote']])root.querySelector('#'+id).value=record[key]||'';root.querySelector('.cel-form h3').textContent='编辑项目 · '+record.projectName;renderMetricEditor(record.projectType,parsedRows);}
    root.querySelector('#celProjectType').disabled=!!record;
    root.querySelector('#celSave').textContent=scope==='private'?'保存自测项目':'保存并提交审核';root.querySelector('.cel-file-help').textContent=scope==='private'?'仅本人使用，保存后立即可用。':'集团共享记录，保存后需管理员审核。';root.querySelector('.cel-message').textContent='';form.scrollIntoView({block:'start'});
  }
  function normalizeSheetRows(rows){return rows.map(row=>{
    const metricName=row['指标名称']||row['指标']||row.metricName,field=schemaFor(context.projectType||'gaibao').find(x=>x.label===metricName);
    return {category:row['类别']||row['指标类别']||row.category,metricName,metricKey:row['指标键']||row.metricKey||field?.key||metricName,metricValue:row['数值']??row.metricValue??row.value,unit:row['单位']||row.unit||field?.unit,ratioPct:row['占比%']??row['占比']??row.ratioPct,periodLabel:row['期间']||row.periodLabel,note:row['备注']||row.note};
  }).filter(x=>x.metricName&&num(x.metricValue)!==null).map(model.normalizeMetric);}
  async function parseFile(file){
    const name=file.name.toLowerCase();if(name.endsWith('.json')){const data=JSON.parse(await file.text());return normalizeSheetRows(Array.isArray(data)?data:(data.metrics||[]));}
    if(!window.XLSX){if(typeof loadScript==='function')await loadScript('xlsx.full.min.js');else await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='xlsx.full.min.js';script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});}
    if(!window.XLSX)throw new Error('表格读取组件加载失败');const workbook=XLSX.read(await file.arrayBuffer(),{type:'array'}),sheet=workbook.Sheets[workbook.SheetNames[0]];return normalizeSheetRows(XLSX.utils.sheet_to_json(sheet,{defval:''}));
  }
  async function saveForm(){
    const button=root.querySelector('#celSave'),message=root.querySelector('.cel-message');let rows=parsedRows;try{if(formMode==='manual')rows=collectManualMetrics();else rows=Array.from(root.querySelectorAll('[data-existing-index]')).filter(input=>input.value.trim()!=='').map(input=>model.normalizeMetric({...parsedRows[Number(input.dataset.existingIndex)],metricValue:Number(input.value),value:Number(input.value)}));}catch(error){message.className='cel-message error';message.textContent=error.message;return;}
    root.querySelectorAll('[data-add-key]').forEach(input=>{if(input.value.trim()==='')return;const field=schemaFor(root.querySelector('#celProjectType').value).find(f=>f.key===input.dataset.addKey);rows.push({metricKey:field.key,metricName:field.label,metricValue:Number(input.value),unit:field.unit,category:metricStorageCategory(field.category),note:'测算参数'});});
    if(!rows.length){message.className='cel-message error';message.textContent='请至少填写一项有效指标。';return;}
    button.disabled=true;message.className='cel-message';message.textContent='正在保存…';
    try{const projectType=root.querySelector('#celProjectType').value,base=JSON.parse(JSON.stringify(editing?.payload?.params||(formMode==='calculation'?context.params:{})));
      parsedRows.forEach(row=>{if(rows.some(r=>r.metricKey===row.metricKey)||(model.isResult(row)&&row.metricKey!=='totalInvestment'))return;const match=String(row.metricKey).match(/^(.+)\.(\d{4})$/);if(match&&base[match[1]])delete base[match[1]][match[2]];else delete base[row.metricKey];});
      const params=model.buildParameters(rows,base);let calculation;
      try{if(typeof context.onCalculate!=='function')throw new Error('测算引擎未加载，请从财务测算重新进入');calculation={summary:context.onCalculate(projectType,params),calculatedAt:Date.now()};}catch(error){calculation={summary:{},error:'系统版待计算：'+error.message};}
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
    document.body.appendChild(root);root.querySelector('.cel-close').onclick=close;root.onclick=event=>{if(event.target===root)close();};root.querySelector('#celTypeFilter').onchange=refresh;
    const tabs=document.createElement('div');tabs.className='cel-scope-tabs';tabs.innerHTML='<button class="cel-btn primary" data-scope="group">集团项目</button><button class="cel-btn" data-scope="private">自测项目</button>';root.querySelector('.cel-toolbar').before(tabs);tabs.querySelectorAll('button').forEach(button=>button.onclick=()=>{if(!root.querySelector('.cel-form').hidden&&!confirm('切换将放弃当前未保存输入，继续吗？'))return;scope=button.dataset.scope;root.querySelector('.cel-form').hidden=true;tabs.querySelectorAll('button').forEach(b=>b.classList.toggle('primary',b===button));root.querySelector('.cel-permission-note').textContent=scope==='private'?'仅本人可见，无需集团审核；不会进入共享经验区间。':'集团共享数据，修改后重新审核。';root.querySelector('#celUpload').textContent=scope==='private'?'导入自测文件':'上传 Excel / CSV / JSON';refresh();});
    root.querySelector('#celUseCurrent').onclick=()=>{const rows=currentMetrics();if(!rows.length){alert('当前还没有可录入的财务测算结果。');return;}showForm(rows,'calculation');};
    root.querySelector('#celManual').onclick=()=>showForm([],'manual');
    root.querySelector('#celProjectType').onchange=event=>{if(formMode==='manual')renderMetricEditor(event.target.value,[]);};
    root.querySelector('#celUpload').onclick=()=>root.querySelector('#celFile').click();root.querySelector('#celFile').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{const rows=await parseFile(file);if(!rows.length)throw new Error('未识别到有效数据。表格至少需要“指标名称”和“数值”两列。');showForm(rows,'file');}catch(error){alert('文件读取失败：'+error.message);}};
    root.querySelector('#celSave').onclick=saveForm;root.querySelector('#celCancel').onclick=()=>{root.querySelector('.cel-form').hidden=true;parsedRows=[];};
  }
  function close(){refreshToken++;if(root){root.remove();root=null;}document.removeEventListener('keydown',onKey);}
  function onKey(event){if(event.key==='Escape')close();}
  async function open(nextContext){model=await import('./calc-experience-model.mjs');if(root)close();scope='group';context={...(nextContext||{})};if(!context.onCalculate&&typeof calcExperienceCalculate==='function')context.onCalculate=calcExperienceCalculate;renderShell();document.addEventListener('keydown',onKey);refresh();}
  window.CalcExperienceLibrary={open,close,currentMetrics};
})();
