(function(root){
  'use strict';
  // Explicit generation adapter. Preview, history and export must never call this
  // to silently upgrade a saved report to another calculation.
  const VERSION='calc-tables-v2';
  const kinds=new Set(['income','cost','summary','sensitivity','cashflow','funding','investment']);
  const protectedAttributes=['data-report-independent','data-report-manual','data-report-financial-manual','data-report-supplement'];
  const protectedSelector=protectedAttributes.map(name=>'['+name+']').join(', ');
  const key=value=>String(value??'').replace(/[\s（）()，,：:]/g,'').replace(/％/g,'%').replace(/m[²2]/gi,'㎡');
  function stable(value){
    if(value===undefined)return null;
    if(typeof value==='number'&&!Number.isFinite(value))return {invalidNumber:String(value)};
    if(Array.isArray(value))return value.map(stable);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k])]));
    return value;
  }
  const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
  function signature(context){
    const c=context||{},r=c.result||{},s=c.snapshot||{};
    return JSON.stringify(stable({version:VERSION,projectId:c.projectId??null,snapshot:{id:s.id,version:s.version,calcType:s.calcType,projectId:s.projectId,params:s.params,summary:s.summary},params:c.params,result:{__ctype:r.__ctype,modelVersion:r.modelVersion,taxModelVersion:r.taxModelVersion,allYears:r.allYears,dates:r.dates,monthDict:r.monthDict,operateArr:r.operateArr,income:r.income,cost:r.cost,totalCost:r.totalCost,cf:r.cf,loan:r.loan,resiOccupancy:r.resiOccupancy,resiRentPrice:r.resiRentPrice,resiOcc:r.resiOcc,resiRent:r.resiRent,summary:r.summary,sens:r.sens}}));
  }
  function invalid(message){const error=new Error('财务表同步已暂停：'+message);error.code='REPORT_FINANCIAL_SOURCE_INVALID';return error;}
  function validate(context){
    const c=context||{},r=c.result,s=c.snapshot;
    if(!s||!s.id||!s.params||!s.summary)throw invalid('请先确认并采用本项目的财务测算版本，再重新生成正文。');
    if(!r||!r.summary||!Array.isArray(r.allYears)||!r.allYears.length)throw invalid('当前没有完整测算结果，请进入财务测算重新计算并采用结果。');
    if(s.projectId!=null&&c.projectId!=null&&String(s.projectId)!==String(c.projectId))throw invalid('所选测算版本属于其他项目，请重新选择本项目测算。');
    if(!same(s.params,c.params)||!same(s.summary,r.summary))throw invalid('当前参数或测算结果与已采用版本不一致，请重新计算并采用结果。');
    if(r.__ctype&&s.calcType&&r.__ctype!==s.calcType)throw invalid('当前测算类型与已采用版本不一致。');
    if(r.allYears.some(y=>!/^\d{4}$/.test(String(y)))||new Set(r.allYears.map(String)).size!==r.allYears.length)throw invalid('测算年度缺失或重复，请重新计算。');
    return {version:VERSION,projectId:c.projectId??null,snapshotId:String(s.id),snapshotVersion:s.version??null,sourceSignature:signature(c)};
  }
  // A first-generation section may have no existing financial table. Bind its
  // adopted source explicitly without depending on whether prepare found one.
  function bindSource(context){return validate(context);}
  function assertCurrent(binding,context){
    if(!binding)return true;
    const current=bindSource(context);
    if(binding.version!==VERSION||binding.sourceSignature!==current.sourceSignature)throw invalid('正文生成期间测算版本或结果已改变，本次结果未写入；请按当前测算重新生成。');
    return true;
  }
  function container(html){
    if(!root.document?.createElement)throw invalid('页面财务表模块尚未就绪，请刷新页面后重试。');
    const box=root.document.createElement('div');box.innerHTML=String(html||'');return box;
  }
  function inheritProtection(table){
    let changed=false;
    // Frozen contracts persist table.outerHTML, not its figure/div. Preserve
    // every ancestor protection on this clone before those wrappers are lost.
    for(const name of protectedAttributes){
      if(table.hasAttribute(name))continue;
      const ancestor=table.parentElement?.closest('['+name+']');
      if(ancestor){table.setAttribute(name,ancestor.getAttribute(name));changed=true;}
    }
    // The canonical composer already respects independent tables/figures. Give
    // all explicit manual/supplement protections that existing meaning on this
    // clone, retaining every original attribute and value. Protect the entire
    // carrying figure: parsing only some of its tables could consume user data.
    if(table.closest(protectedSelector)){
      if(!table.hasAttribute('data-report-independent')){table.setAttribute('data-report-independent','true');changed=true;}
      for(let figure=table.closest('figure');figure;figure=figure.parentElement?.closest('figure')){
        if(!figure.hasAttribute('data-report-independent')){figure.setAttribute('data-report-independent',table.getAttribute('data-report-independent'));changed=true;}
      }
    }
    return changed;
  }
  function classify(table){
    if(table.closest(protectedSelector))return null;
    const stored=table.dataset.reportCalcKind;
    if(stored)return kinds.has(stored)?stored:'unsupported';
    const figure=table.closest('[data-template-id], [data-canonical-template]');
    const id=table.dataset.templateId||figure?.dataset.templateId||figure?.dataset.canonicalTemplate||'';
    if(['gaibao-housing-table-06','gaibao-housing-table-11'].includes(id))return 'summary';
    const h=Array.from(table.rows[0]?.cells||[]).map(c=>key(c.textContent)),has=v=>h.some(x=>x.includes(v));
    if(has('年份')&&has('住宅租金收入')&&has('出租率')&&has('租金单价'))return 'income';
    if(has('年份')&&has('收楼成本')&&has('工程费用')&&has('运营费用')&&has('财务费用')&&has('总成本'))return 'cost';
    if(has('年份')&&has('现金流入')&&has('现金流出')&&has('净现金流量')&&has('累计净现金流量'))return 'cashflow';
    if((has('敏感因素')||has('变动因素'))&&(has('波动幅度')||has('变动幅度'))&&has('IRR')&&(has('净现值')||has('NPV')))return 'sensitivity';
    if((has('指标名称')||has('指标')||has('项目'))&&(has('测算值')||has('数值'))&&/IRR|内部收益率|净现值|NPV/.test(table.textContent))return 'summary';
    return null;
  }
  function hasFinancialTables(html){
    if(!/<table\b/i.test(String(html||'')))return false;
    return Array.from(container(html).querySelectorAll('table')).some(table=>classify(table));
  }
  function number(value,label,nullable=false){
    if(nullable&&(value===null||value===undefined))return '—';
    if(typeof value!=='number'||!Number.isFinite(value))throw invalid(label+'缺少有效数值，不能保留旧表或补造为零。');
    return value.toLocaleString('zh-CN',{maximumFractionDigits:4,useGrouping:false});
  }
  const sum=(r,group,field)=>r.allYears.reduce((n,y)=>{const v=r[group]?.[y]?.[field];number(v,y+'年'+field);return n+v;},0);
  function dataFor(kind,context){
    const r=context.result,s=r.summary,p=context.params||{},type=r.__ctype||context.snapshot.calcType||'gaibao';
    const n=(v,label,nullable)=>number(v,label,nullable),annual=reader=>r.allYears.map(y=>[String(y),...reader(y)]);
    if(kind==='income'){
      const field=type==='rent'?'resi':'rent',occ=r.resiOccupancy||r.resiOcc,price=r.resiRentPrice||r.resiRent;
      return {headers:['年份','住宅租金收入（万元）','出租率','租金单价（元/㎡/月）'],rows:[...annual(y=>{
        const rent=r.income?.[y]?.[field],amount=n(rent,y+'年住宅租金收入');
        // Engines intentionally omit rent/occupancy assumptions for construction
        // years. Only an explicit non-operating year may display an empty basis.
        const inactive=type==='gaibao'?r.monthDict?.[y]===0:type==='rent'&&Array.isArray(r.operateArr)&&!r.operateArr.some(op=>String(op)===String(y));
        if(inactive){if(rent!==0)throw invalid(y+'年非运营期存在住宅租金收入，请重新核对测算。');return [amount,'—','—'];}
        return [amount,n(typeof occ?.[y]==='number'?occ[y]*100:undefined,y+'年出租率')+'%',n(price?.[y],y+'年租金单价')];
      }),['全周期合计',n(sum(r,'income',field),'住宅租金收入合计'),'—','—']]};
    }
    if(kind==='cost'){
      if(type!=='gaibao')throw invalid('收楼/工程/运营/财务费用旧表与当前测算类型不兼容，请核对表格口径。');
      const fields=['collect','eng','op','fin','total'];
      return {headers:['年份','收楼成本（万元）','工程费用（万元）','运营费用（万元）','财务费用（万元）','总成本（万元）'],rows:[...annual(y=>fields.map(f=>n(r.cost?.[y]?.[f],y+'年'+f))),['全周期合计',...fields.map(f=>n(sum(r,'cost',f),f+'合计'))]]};
    }
    if(kind==='cashflow'){
      return {headers:['年份','现金流入（万元）','现金流出（万元）','净现金流量（万元）','累计净现金流量（万元）'],rows:[...annual(y=>['inflow','outflow','net','cumNet'].map(f=>n(r.cf?.[y]?.[f],y+'年'+f))),['全周期合计',n(sum(r,'cf','inflow'),'现金流入合计'),n(sum(r,'cf','outflow'),'现金流出合计'),n(sum(r,'cf','net'),'净现金流合计'),n(r.cf[r.allYears.at(-1)].cumNet,'期末累计净现金流')]]};
    }
    if(kind==='summary'){
      const discount=p.discount??p.discountPct;
      const rows=[['全周期总收入','万元',n(s.totalIncome,'总收入'),'全周期'],['总成本费用','万元',n(s.totalCost,'总成本'),'损益表口径'],['净利润','万元',n(s.totalNetProfit,'净利润'),'全周期'],['累计净现值（NPV）','万元',n(s.totalNpv,'净现值'),discount!=null?'折现率'+n(discount,'折现率')+'%':'全周期'],['全投资内部收益率（IRR）','%',n(s.irr,'IRR',true),'当前测算主指标']];
      if(s.totalTax!==undefined)rows.splice(2,0,['税金及附加合计','万元',n(s.totalTax,'税金及附加'),'不含所得税']);
      if(s.monthlyXirr!==undefined)rows.push(['月度现金流XIRR','%',n(s.monthlyXirr,'月度XIRR',true),'按月度实际日期']);
      if(s.annualIrr!==undefined)rows.push(['年度现金流IRR','%',n(s.annualIrr,'年度IRR',true),'年度现金流序列']);
      const payback=s.paybackInfo??s.payback;
      if(payback!=null){if(!/^\d{4}$/.test(String(payback.year)))throw invalid('回正年份缺少有效值。');rows.push(['累计净现金流回正年份','年',String(payback.year),payback.period!=null?'投资回收期'+n(payback.period,'投资回收期')+'年（引擎值）':payback.index!=null?'测算期第'+n(payback.index,'回正序号')+'年':'当前测算结果']);}
      else rows.push(['累计净现金流回正年份','年','未回正','全周期内未回正']);
      return {headers:['指标名称','单位','数值','备注'],rows};
    }
    if(kind==='funding'){
      if(type!=='gaibao')throw invalid('当前测算类型尚无可绑定的工程借款年度明细。');
      const rows=annual(y=>{
        const loan=r.loan?.[y];
        const engineering=loan?.engineering??r.cf?.[y]?.engineering,borrow=loan?.borrow;
        n(engineering,y+'年测算工程支出');n(borrow,y+'年测算借款');
        return [n(engineering,y+'年测算工程支出'),n(borrow,y+'年测算借款'),n(Math.round((engineering-borrow)*10000)/10000,y+'年工程付款与借款差额')];
      });
      const total=column=>n(Math.round(rows.reduce((value,row)=>value+Number(row[column]),0)*10000)/10000,'工程资金年度合计');
      rows.push(['全周期合计',total(1),total(2),total(3)]);
      return {headers:['年份','测算工程支出（万元）','当年借款（万元）','工程付款减借款（万元，非审批资本金）'],rows};
    }
    if(kind==='investment'){
      return {headers:['投资费用项目','单位','测算金额','口径'],rows:[['工程费用合计','万元',n(s.totalEngCost,'测算工程费用合计'),'全周期工程费用；不等于含所有费用的批准总投资'],['其他投资费用','万元','【待补：其他投资费用及批准总投资】','当前测算未提供完整投资概算，不补造为零']]};
    }
    if(kind==='sensitivity'){
      const rows=[['基准方案','—',n(s.irr,'基准IRR',true),n(s.totalNpv,'基准净现值')]];
      if(Array.isArray(r.sens)&&r.sens.length)r.sens.forEach((scenario,i)=>{
        if(!scenario||typeof scenario.label!=='string'||!scenario.label.trim())throw invalid('敏感性情景'+(i+1)+'缺少名称。');
        const label=scenario.label.trim(),split=label.match(/^(.*?)\s+([+−-].+)$/);
        rows.push([split?split[1]:label,split?split[2]:'—',n(scenario.irr,label+' IRR',true),n(scenario.npv,label+'净现值')]);
      });else rows.push(['【待补：当前测算敏感性分析结果】','—','—','—']);
      return {headers:['敏感因素','波动幅度','全投资IRR（%）','累计净现值（万元）'],rows};
    }
    throw invalid('发现无法同步的程序财务表，请核对表格类型后重试。');
  }
  function replace(table,kind,context,binding){
    const data=dataFor(kind,context),next=table.ownerDocument.createElement('table');
    // Preserve trusted layout attributes and classes. Values and old source
    // annotations are regenerated, never mixed with another snapshot's rows.
    for(const attr of table.attributes)if(attr.name==='class'||attr.name==='style'||attr.name.startsWith('data-')&&!attr.name.startsWith('data-report-calc-')&&attr.name!=='data-report-program-table')next.setAttribute(attr.name,attr.value);
    next.dataset.reportCalcKind=kind;next.dataset.reportCalcSnapshot=binding.snapshotId;next.dataset.reportCalcVersion=String(binding.snapshotVersion??'');
    next.dataset.reportCalcSource=VERSION;
    if(binding.projectId!=null)next.dataset.reportCalcProject=String(binding.projectId);
    if(table.hasAttribute('data-report-program-table'))next.dataset.reportProgramTable=table.dataset.reportProgramTable;
    const head=next.createTHead().insertRow();data.headers.forEach(value=>{const cell=table.ownerDocument.createElement('th');cell.textContent=value;head.appendChild(cell);});
    const body=next.createTBody();data.rows.forEach(values=>{const row=body.insertRow();values.forEach(value=>{row.insertCell().textContent=value;});});
    table.replaceWith(next);
  }
  function exposeProgramSummary(box){
    let changed=false;
    // The canonical composer deliberately skips unknown figures. Our original
    // summary seed had that wrapper, so allocation missed the protected notes
    // produced later from its frozen table. Expose only this exact program-owned
    // shape to the same raw-table path; never unwrap canonical or manual figures.
    box.querySelectorAll('figure[data-report-program-table="summary"]').forEach(figure=>{
      if(figure.attributes.length!==1||figure.closest(protectedSelector)||figure.querySelector(protectedSelector))return;
      const [caption,table]=figure.children;
      if(figure.children.length!==2||caption.tagName!=='FIGCAPTION'||table.tagName!=='TABLE'||table.dataset.reportCalcKind!=='summary')return;
      const label=box.ownerDocument.createElement('p');
      for(const attr of caption.attributes)label.setAttribute(attr.name,attr.value);
      label.classList.add('rpt-table-caption');label.append(...caption.childNodes);
      table.dataset.reportProgramTable='summary';figure.replaceWith(label,table);changed=true;
    });
    return changed;
  }
  function prepare(entries,context,options){
    const source=Array.isArray(entries)?entries:[],copies=source.map(entry=>({...entry}));
    let binding=null,updatedCount=0;
    copies.forEach(entry=>{
      const field=Object.hasOwn(entry,'html')?'html':'text',html=entry[field]||'';
      if(!/<table\b/i.test(html))return;
      const box=container(html),tables=Array.from(box.querySelectorAll('table'));let changed=false;
      // Finish figure protection before replacing any table. In mixed figures
      // this must not depend on whether the manual table is first or last.
      tables.forEach(table=>{if(inheritProtection(table))changed=true;});
      tables.forEach(table=>{
        if(inheritProtection(table))changed=true;
        const kind=classify(table);if(!kind)return;
        if(!binding)binding=bindSource(context);
        replace(table,kind,context,binding);updatedCount++;changed=true;
      });
      if(exposeProgramSummary(box))changed=true;
      // Only regenerated tables or inherited protection change the clone;
      // unrelated entries and every original entry remain untouched.
      if(changed)entry[field]=box.innerHTML;
    });
    // Only an explicit generation request may create a missing program table.
    // Ordinary prepare/preview/export calls retain their refresh-only behavior.
    const duties=Array.isArray(options?.sections)?options.sections:options?.sectionKey&&Array.isArray(options.requiredTables)?[options]:[];
    const dutyKeys=new Set();
    for(const duty of duties){
      if(!duty?.sectionKey||!Array.isArray(duty.requiredTables)||dutyKeys.has(duty.sectionKey))throw invalid('财务表生成职责无效或重复。');
      dutyKeys.add(duty.sectionKey);
      const entry=copies.find(row=>row.key===duty.sectionKey);
      if(!entry)throw invalid('财务表生成职责小节不存在。');
      const field=Object.hasOwn(entry,'html')?'html':'text',box=container(entry[field]||'');
      const tableKinds=new Set(Array.from(box.querySelectorAll('table')).map(classify).filter(Boolean));
      const requiredKinds={'现金流量汇总表':'cashflow','财务评价指标表':'summary','成本费用表':'cost','收入测算表':'income','资金筹措表':'funding','投资估算表':'investment'};
      let added=false;
      for(const required of duty.requiredTables){
        const kind=requiredKinds[required.title];if(!kind||tableKinds.has(kind))continue;
        // Explicitly protected tables must not be duplicated or relabelled.
        if(box.querySelector(protectedSelector))continue;
        if(!binding)binding=bindSource(context);
        const figure=box.ownerDocument.createElement('figure'),caption=box.ownerDocument.createElement('figcaption'),table=box.ownerDocument.createElement('table');
        figure.dataset.reportProgramTable=kind;caption.textContent=required.title;figure.append(caption,table);box.appendChild(figure);
        replace(table,kind,context,binding);tableKinds.add(kind);updatedCount++;added=true;
      }
      if(added){exposeProgramSummary(box);entry[field]=box.innerHTML;}
    }
    return {entries:copies,binding,updatedCount};
  }
  // These are roles of already adopted inputs, not independently verified facts.
  // Read annual occupancy from the calculator; do not repeat its formula here.
  function buildCurrentAssumptions(context={}){
    const p=context.params||{},r=context.result||{},finite=x=>x!==null&&x!==''&&x!==undefined&&Number.isFinite(Number(x))?Number(x):null;
    const projectType=r.__ctype||context.snapshot?.calcType||context.projectType||'gaibao';
    const monthly=p.occupancyMode==='monthly-phases';
    return {version:'current-assumptions-v1',projectType,rent:finite(p.rent),uniformRent:projectType==='gaibao',engineeringCost:finite(r.summary?.totalEngCost),
      operateStartMonth:r.dates?.operateStartMonth||p.operateStartMonth||null,operateEndMonth:r.dates?.operateEndMonth||p.operateEndMonth||null,
      totalOperateMonths:finite(r.summary?.totalOperateMonths),occupancyMode:monthly?'monthly-phases':'annual',
      rampStartMonth:p.rampStartMonth||null,rampEndMonth:p.rampEndMonth||null,rampInterval:finite(p.rampInterval),
      stableStartMonth:p.stableStartMonth||null,firstPhasePercent:finite(p.rampOcc)===null?null:Number(p.rampOcc)*100,
      stablePercent:finite(p.stableOcc)===null?null:Number(p.stableOcc)*100,
      rampPercentages:Array.isArray(p.rampRates)?p.rampRates.map(x=>finite(x)===null?null:Number(x)*100):[],
      annualOccupancy:(r.allYears||[]).filter(y=>finite(r.resiOccupancy?.[y])!==null&&Number(r.monthDict?.[y])>0)
        .map(y=>({year:Number(y),percent:Number(r.resiOccupancy[y])*100,operatingMonths:Number(r.monthDict[y])}))};
  }
  function currentAssumptionsPrompt(a){
    if(!a||a.projectType!=='gaibao')return '';
    const fmt=x=>x===null||x===undefined?'待核对':String(Number(Number(x).toFixed(4)));
    const rows=['【当前参数的含义：旧材料可以比较，不可冒充当前方案】'];
    if(a.rent!==null)rows.push('本次统一起始租金 '+fmt(a.rent)+' 元/㎡/月；不是分小区分别取租金。旧材料分点位报价须注明“原方案/材料值”。');
    if(a.engineeringCost!==null&&a.engineeringCost!==undefined)rows.push('本次引擎工程费用合计 '+fmt(a.engineeringCost)+' 万元；这不等于已批准总投资。项目登记“投资规模”可能是未核对的旧数，材料中的其他投资估算应分别注明来源、范围和待确认状态，不与本次工程费用混用。');
    if(a.operateStartMonth)rows.push('本次运营开始月 '+a.operateStartMonth+'，结束月 '+a.operateEndMonth+'；计算引擎实际运营 '+fmt(a.totalOperateMonths)+' 个月，跨五个年度不等于运营满五年。');
    if(a.occupancyMode==='monthly-phases')rows.push('出租率使用月度爬坡：首个阶段 '+fmt(a.firstPhasePercent)+'%，各阶段 '+a.rampPercentages.map(fmt).join('/')+'%，稳定期 '+fmt(a.stablePercent)+'%。首个阶段/首月出租率不是首年出租率。爬坡起止 '+a.rampStartMonth+' 至 '+a.rampEndMonth+'，稳定期从 '+a.stableStartMonth+' 开始。');
    if(a.annualOccupancy.length)rows.push('引擎按当年实际运营月份计算的年度平均出租率：'+a.annualOccupancy.map(x=>x.year+'年 '+fmt(x.percent)+'%（'+x.operatingMonths+'个运营月）').join('；')+'。');
    return '\n'+rows.join('\n')+'\n以上是用户采用的测算假设，不是已经核实的合同或市场事实；无关章节无需重复。';
  }
  function inspectCurrentAssumptions(content,a){
    if(!a||a.projectType!=='gaibao')return [];
    const html=String(content||'').replace(/<!--[\s\S]*?-->/g,'');
    const text=html.replace(/<\/(?:p|div|h[1-6]|tr|li)>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
    const issues=[],seen=new Set(),annual=a.annualOccupancy||[];
    const historical=/原(?:投资)?(?:立项(?:的)?)?请示|原方案|原计划|原测算|旧方案|旧测算|旧材料|历史报告|历史版本|材料中|材料记载|材料采用|材料所列|原报告|初步方案|参考项目|对比项目|市场样本/;
    const current=/本次|当前|现行|本报告|已采用|测算采用|本项目测算/;
    // These named sources describe comparison values, not this report's adopted
    // inputs. Resolve the role at each captured value; leave date/duration
    // checks on their existing, stricter scope.
    const historicalValue=new RegExp(historical.source+'|材料测算(?:结果|值)?|材料所载|立项(?:的)?请示|研究报告|立项阶段(?:的)?测算(?:结果|值)|市场调研(?:预估|预计|测算)');
    // Prefer the complete adopted-source marker over its shorter "当前/本次"
    // prefix, so the following document title cannot reverse the current role.
    const namedSource='(?:'+historicalValue.source+'|收入预估)';
    const currentValue=new RegExp('(?:'+current.source+')[^，,。；;\\n]{0,20}?(?:采用|沿用)\\s*'+namedSource+'|(?:已采用|测算采用)\\s*'+namedSource+'|(?:本|本次|当前|现行)(?:采用|沿用|的)?(?:原(?:投资)?(?:立项(?:的)?)?请示|研究报告|立项(?:的)?请示|市场调研|收入预估)|'+current.source);
    function isHistoric(s,index){const before=s.slice(0,index);let old=-1,now=-1;for(const m of before.matchAll(new RegExp(historical.source,'g')))old=m.index+m[0].length;for(const m of before.matchAll(new RegExp(currentValue.source,'g')))now=m.index+m[0].length;return old>=0&&old>now;}
    function isHistoricValue(s,index,comparisonIncome){
      const before=s.slice(0,index),oldPattern=comparisonIncome?new RegExp(historicalValue.source+'|收入预估'):historicalValue;
      let old=-1,now=-1;
      for(const m of before.matchAll(new RegExp(oldPattern.source,'g')))old=m.index+m[0].length;
      for(const m of before.matchAll(new RegExp(currentValue.source,'g')))now=m.index+m[0].length;
      return old>=0&&old>now;
    }
    const valuePosition=m=>m.index+m[0].lastIndexOf(m[1]);
    // Negation belongs only to the immediately following predicate/value.
    // Two adjacent negations do not excuse a positive assertion.
    function isNegatedPredicate(s,index){
      let before=s.slice(0,index).trimEnd(),count=0,match;
      while((match=before.match(/(?:不等同于|不等于|并非|并不|不是|不再|不会|不应|不得|不能|不为|没有|无需|未|不|非)\s*$/))){count++;before=before.slice(0,match.index).trimEnd();}
      return count%2===1;
    }
    function add(sentence,message){const excerpt=sentence.trim();if(!excerpt||seen.has(excerpt+message))return;seen.add(excerpt+message);issues.push({code:'current-assumption-conflict',severity:'error',repairable:true,message,excerpt});}
    // Keep the complete original short sentence/cell as a unique repair anchor.
    for(const sentence of text.split(/(?<=[。！？；;])|\n/).map(s=>s.trim()).filter(Boolean)){
      for(const m of sentence.matchAll(/(?:首年|第一年|第1年|全年|当年|年度|年均|(?:20\d{2})\s*年)[^。，,；;\n]{0,12}?出租率(?:[^\d。，,；;\n]{0,8}|\s*[,，]\s*)(\d+(?:\.\d+)?)\s*%/g)){
        if(isHistoricValue(sentence,valuePosition(m)))continue;
        // A dated monthly phase is not an annual claim. Inspect only this
        // matched clause, so a later explicit full-year claim is still checked.
        const scope=m[0].slice(0,m[0].lastIndexOf(m[1]));
        // Preserve explicit "首年出租率，15%", but a label that already follows
        // its own percentage must not borrow a number from the next clause.
        if(/[,，]/.test(scope)&&/\d+(?:\.\d+)?\s*%\s*(?:为|是|即)[^，,。；;\n\d%]{0,8}$/.test(sentence.slice(0,m.index)))continue;
        if(/^20\d{2}\s*年/.test(scope)&&/(?:\d{1,2}\s*月|首月|阶段|爬坡)/.test(scope)&&!/(?:全年|当年|年度|年均|首年|第一年|第1年)/.test(scope))continue;
        let percent=Number(m[1]);
        if(isNegatedPredicate(sentence,m.index)||isNegatedPredicate(scope,scope.length)){
          // "不是55.8333%，而是15%" still asserts an incorrect annual value.
          // Do not carry the annual label into unrelated later clauses.
          const correction=sentence.slice(m.index+m[0].length).match(/^\s*[,，]?\s*(?:而(?:是|为)|实际(?:为|是)|仍(?:为|是|采用)|应(?:为|是))\s*(\d+(?:\.\d+)?)\s*%/);
          if(!correction)continue;
          percent=Number(correction[1]);
        }
        const years=[...sentence.slice(0,m.index+m[0].length).matchAll(/20\d{2}\s*年/g)],year=years.at(-1)?.[0],row=year?annual.find(x=>x.year===Number(year.match(/20\d{2}/)[0])):annual[0];
        if(row&&Math.abs(percent-row.percent)>.055)add(sentence,'当前'+row.year+'年平均出租率为'+Number(row.percent.toFixed(4))+'%，不能把首月/旧方案出租率写成首年出租率。');
      }
      const rentMatches=[...sentence.matchAll(/(?:当前|本次|测算|起始|平均)[^。；;\n]{0,10}?租金[^\d。，,；;：:\n、]{0,8}(\d+(?:\.\d+)?)\s*元/g),
        ...sentence.matchAll(/租金[^。；;\n]{0,45}?(?:本次|当前|现行)(?:也|仍|亦)(?:为|是|采用)?\s*(\d+(?:\.\d+)?)\s*元/g)];
      // An explicitly contrasted income estimate is a reference value only
      // when the same sentence also identifies the correct current rent.
      const comparisonIncome=/(?:与|相比|比较)/.test(sentence)&&/(?:差异|不一致|尚未统一)/.test(sentence)&&rentMatches.some(m=>a.rent!==null&&Math.abs(Number(m[1])-a.rent)<=.005&&!isHistoricValue(sentence,valuePosition(m)));
      for(const m of rentMatches){
        // The role may change inside the match ("起始租金与材料原方案42.44元").
        // Resolve it at the amount, not at the earlier rent label.
        if(!isHistoricValue(sentence,valuePosition(m),comparisonIncome)&&a.rent!==null&&Math.abs(Number(m[1])-a.rent)>.005)add(sentence,'当前统一起始租金为'+a.rent+'元/㎡/月；材料或旧方案报价须明确身份，不能替换当前假设。');
      }
      if(a.uniformRent)for(const m of sentence.matchAll(/按小区分别取值|分小区分别|按各小区分别/g)){
        const before=sentence.slice(0,m.index);
        if(/(?:当前|本次|本项目|收入测算|已在)[^。；;\n]{0,35}$/.test(before)&&!isNegatedPredicate(sentence,m.index)&&!isHistoric(sentence,m.index))add(sentence,'当前测算统一采用起始租金，不按小区分别取值；分点位报价只能作为材料比较。');
      }
      for(const m of sentence.matchAll(/(20\d{2})年\s*(\d{1,2})月[^。，,；;\n]{0,18}(?:正式运营|投入运营|开始运营|入市)/g)){
        const ym=m[1]+'-'+m[2].padStart(2,'0');
        if(a.operateStartMonth&&ym!==a.operateStartMonth&&!isHistoric(sentence,m.index)&&current.test(sentence))add(sentence,'当前运营开始月为'+a.operateStartMonth+'；不同入市月份须注明原方案，不可混用。');
      }
      if(a.totalOperateMonths!==null&&a.totalOperateMonths%12!==0&&/(?:运营期|运营期限|运营年限|共运营|运营共)[^。；;\n]{0,8}(?:5|五)年/.test(sentence)&&a.totalOperateMonths!==60&&!isHistoric(sentence,sentence.length))add(sentence,'当前实际运营'+a.totalOperateMonths+'个月；可以说明跨五个年度，不能说运营满五年。');
    }
    return issues;
  }
  const api={VERSION,prepare,bindSource,signature,assertCurrent,hasFinancialTables,buildCurrentAssumptions,currentAssumptionsPrompt,inspectCurrentAssumptions};
  root.ReportFinancialTables=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
