(function(root){
  'use strict';
  const VERSION='anju-le-yu-v1.0', clone=v=>JSON.parse(JSON.stringify(v));
  const definitions={
    area:['住宅面积','㎡'],units:['总套数','套','integer'],rent:['起始租金','元/㎡/月'],rentSpan:['租金递增跨度','年','integer'],rentRate:['租金递增率','%','rate'],
    collect:['收楼单价','元/㎡/月'],deco:['首次装修单方造价','元/㎡'],decoInt:['装修间隔','年','integer'],decoRatio:['二次装修成本系数','比例'],
    unitCost:['单套月运营成本','元/套/月'],operateRentPct:['实收租金运营成本比例','%','percent'],operateCostMode:['运营成本方式','','mode'],startup:['开办费','万元'],costSpan:['运营成本递增跨度','年','integer'],costRate:['运营成本递增率','%','rate'],
    firstDecoLoanPct:['首次装修借款比例','%','percent'],loanRate:['贷款年利率','%','rate'],discount:['折现率','%','rate'],
    principalRepayMode:['归还本金方式','','mode'],principalRepayIntervalMonths:['还本间隔','月','integer'],principalRepayPct:['每期归还本金比例','%','percent'],principalRepayFinalMonth:['末期还本月','月','integer'],
    stableOcc:['稳定期出租率','比例','ratio'],collectPct:['旧版收楼支付比例','%','percent'],sharePct:['旧版业主分成比例','%','percent'],collectRentPct:['实收租金收楼比例','%','percent'],collectReductionPct:['固定收楼租金减免','%','percent'],projectSharePct:['项目保留租金收益','%','percent'],shareStartMonth:['分成起始月','','month'],
    buildStartMonth:['建设开始年月','','month'],buildEndMonth:['建设结束年月','','month'],operateStartMonth:['运营开始年月','','month'],operateEndMonth:['运营结束年月','','month'],
    rampStartMonth:['爬坡开始年月','','month'],rampEndMonth:['爬坡结束年月','','month'],stableStartMonth:['稳定期起始年月','','month'],rampIntervalMonths:['爬坡间隔','月','integer'],mode:['收楼流出方式','','mode']
  };
  const legacy=new Set(['loan','interestBase','repay','loanTotalYears','rateDiscount','loanPlan','repayPlan','repaymentSchedule','buildStart','buildYears','operateYears','firstMonths']);
  function ordinal(s){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(s))throw Error('年月格式须为 YYYY-MM');const [y,m]=s.split('-').map(Number);return y*12+m-1;}
  function month(n){return Math.floor(n/12)+'-'+String(n%12+1).padStart(2,'0');}
  function leaves(value,prefix=''){return Object.entries(value).flatMap(([k,v])=>{const key=prefix?prefix+'.'+k:k;return v&&typeof v==='object'&&Object.keys(v).length?leaves(v,key):[{key,value:v}];});}
  function inventory(params){
    const complete={operateCostMode:'per-unit',operateRentPct:15.7,principalRepayMode:'principal-percent',principalRepayIntervalMonths:6,principalRepayPct:2.5,principalRepayFinalMonth:60,...params};
    return leaves(complete).map(({key,value})=>{
      const base=key.split('.')[0],def=definitions[key]||(base==='rampRates'?['爬坡第'+(Number(key.split('.')[1])+1)+'阶段出租率','比例','ratio']:null);
      let reason='';
      if(legacy.has(base))reason='旧字段/派生值：由当前年月、工程及借款比例计算，不独立扰动';
      else if(['debtModel','occupancyMode','operateCostMode','principalRepayMode'].includes(base))reason='计取方式属于模型结构决策，不作为连续数值扰动';
      else if(base==='rampOcc'&&Array.isArray(params.rampRates))reason='首个爬坡值的兼容副本；逐阶段分析 rampRates';
      else if(['stableStart','stableEnd','occupancyRamp'].includes(base)&&params.occupancyMode==='monthly-phases')reason='已由月度出租率安排替代';
      else if(['collectPct','sharePct'].includes(base)&&['collectReductionPct','projectSharePct'].some(k=>params[k]!==undefined))reason='旧版兼容字段，已由减免率及项目留存比例替代';
      else if(base==='collect'&&params.mode==='rent-percent')reason='按租金比例收楼时，固定单价不生效';
      else if(base==='collectRentPct'&&params.mode!=='rent-percent')reason='仅按实际租金比例收楼时生效';
      else if(base==='unitCost'&&params.operateCostMode==='rent-percent')reason='按实际租金比例计算运营成本时，单套成本不生效';
      else if(base==='operateRentPct'&&params.operateCostMode!=='rent-percent')reason='仅按实际租金比例计算运营成本时生效';
      else if(['principalRepayIntervalMonths','principalRepayPct','principalRepayFinalMonth'].includes(base)&&params.principalRepayMode==='rent-surplus')reason='按月租金结余还本时，定期比例还本参数不生效';
      else if(['collectReductionPct','projectSharePct','shareStartMonth','collectPct','sharePct'].includes(base)&&params.mode!=='share')reason='仅减租分成方式生效';
      else if(!def)reason='未登记字段：需人工核对，禁止假定无影响';
      return {key,label:def?.[0]||key,unit:def?.[1]||'',kind:def?.[2]||'number',value,reason};
    });
  }
  function defaults(row,percent=5){
    const v=row.value,k=row.kind;
    if(k==='month')return [month(ordinal(v)-1),month(ordinal(v)+1)];
    if(k==='mode')return ['lease','rent-percent','share'];
    const step=k==='integer'?1:k==='ratio'?percent/100:k==='percent'||k==='rate'?percent:Math.abs(v)*percent/100;
    if(!Number.isFinite(v))return [v,v];
    const min=k==='integer'?1:k==='rate'&&['rentRate','costRate'].includes(row.key)?-99.99:0,max=k==='ratio'?1:k==='percent'?100:Infinity;
    return [Math.max(min,v-step),Math.min(max,v+step)].map(x=>Number(x.toFixed(8)));
  }
  function change(params,key,value){
    const p=clone(params),parts=key.split('.');
    if(parts.length===2){p[parts[0]][parts[1]]=value;}else p[key]=value;
    if(['operateStartMonth','rampStartMonth'].includes(key)){
      const delta=ordinal(value)-ordinal(params.operateStartMonth);
      p.operateStartMonth=value;p.rampStartMonth=value;
      p.rampEndMonth=month(ordinal(params.rampEndMonth)+delta);p.stableStartMonth=month(ordinal(params.stableStartMonth)+delta);
    }
    if(key==='rampEndMonth')p.stableStartMonth=month(ordinal(value)+1);
    if(key==='stableStartMonth')p.rampEndMonth=month(ordinal(value)-1);
    if(['rampEndMonth','stableStartMonth','rampIntervalMonths'].includes(key)){
      const count=Math.ceil((ordinal(p.rampEndMonth)-ordinal(p.rampStartMonth)+1)/p.rampIntervalMonths);
      if(!Number.isInteger(p.rampIntervalMonths)||p.rampIntervalMonths<1||count<1||count>1200)throw Error('爬坡期间或间隔无效');
      p.rampRates=Array.from({length:count},(_,i)=>params.rampRates[Math.min(params.rampRates.length-1,Math.floor(i*p.rampIntervalMonths/params.rampIntervalMonths))]);
    }
    if(p.rampRates?.length)p.rampOcc=p.rampRates[0];
    return p;
  }
  function evaluate(params,cfg){
    if(params.debtModel==='legacy-annual')throw Error('旧年度模型请先在测算页面核对并保存为安居乐寓版');
    if(params.operateCostMode!==undefined&&!['per-unit','rent-percent'].includes(params.operateCostMode))throw Error('运营成本方式无效');
    const required=[...Object.keys(definitions).filter(k=>!['collectPct','sharePct','collectRentPct','collectReductionPct','projectSharePct','shareStartMonth','operateRentPct','operateCostMode','unitCost','principalRepayMode','principalRepayIntervalMonths','principalRepayPct','principalRepayFinalMonth'].includes(k)),'rampRates'];
    if(params.mode==='rent-percent')required.push('collectRentPct');
    if(params.mode==='share'&&params.collectReductionPct!==undefined)required.push('collectReductionPct','projectSharePct');
    required.push(params.operateCostMode==='rent-percent'?'operateRentPct':'unitCost');
    const missing=required.filter(k=>params[k]===undefined||params[k]===null||params[k]==='');
    if(missing.length)throw Error('项目参数不完整，请先在测算页核对保存：'+missing.join('、'));
    if(params.occupancyMode!=='monthly-phases')throw Error('请先保存完整月度出租率安排');
    for(const row of inventory(params).filter(r=>!r.reason)){
      if(row.kind==='month')ordinal(row.value);
      else if(row.kind==='mode'){if(!((row.key==='operateCostMode'?['per-unit','rent-percent']:['lease','rent-percent','share']).includes(row.value)))throw Error(row.key==='operateCostMode'?'运营成本方式无效':'收楼方式无效');}
      else if(typeof row.value!=='number'||!Number.isFinite(row.value)||(row.kind==='integer'&&(!Number.isInteger(row.value)||row.value<1))||(row.kind==='ratio'&&(row.value<0||row.value>1))||(row.kind==='percent'&&(row.value<0||row.value>100)))throw Error('参数无效：'+row.label);
    }
    const r=root.NRCalc.calc(root.NRCalc.fromParams(params),cfg),ms=r.monthlyCashflow;
    if(!ms?.length)throw Error('缺少真实月度现金流');
    let accumulated=0,min=0;for(const m of ms){accumulated+=m.net;min=Math.min(min,accumulated);}
    return {irr:r.summary.monthlyXirr,npv:r.summary.totalNpv,gap:-min,months:ms};
  }
  async function analyze(params,cfg={},options={}){
    const snapshot=clone(params),config=clone(cfg),baseline=evaluate(snapshot,config),rows=inventory(snapshot),result={version:VERSION,createdAt:new Date().toISOString(),params:snapshot,config,baseline,rows,project:clone(options.project||{})};
    for(let i=0;i<rows.length;i++){
      if(options.cancelled?.())throw Error('分析已取消，原项目未修改');
      const row=rows[i];if(!row.reason){
        const values=options.ranges?.[row.key]||defaults(row,options.percent??5);
        row.scenarios=values.map(value=>{try{const changed=change(snapshot,row.key,value),output=evaluate(changed,config);return {value,output,delta:Object.fromEntries(['irr','npv','gap'].map(k=>[k,output[k]===null||baseline[k]===null?null:output[k]-baseline[k]]))};}catch(e){return {value,error:e.message};}});
      }
      options.progress?.(i+1,rows.length);await new Promise(resolve=>setTimeout(resolve,0));
    }
    return result;
  }
  root.ProjectSensitivity={VERSION,definitions,inventory,defaults,change,evaluate,analyze};
})(typeof window==='undefined'?globalThis:window);
