// 非居改保：对照 calculator3.py @ 4d1c23b 的年度算法。
// 默认按月工程付款、借款及还本计息；legacy-annual 保留旧年度算法供历史核对。

window.NRCalc = (function(){
const NR_DEFAULTS = {
  vatOut: 0.09,        // 租金/收楼/工程增值税率
  vatOps: 0.06,        // 运营/财务费用进项税率
  surcharge: 0.12,     // 增值税附加率
  incomeTax: 0.25,     // 企业所得税率
  stampDeco: 0.0003,   // 装修合同印花税率
  lossCarry: 5,        // 亏损弥补年限
};


function round4(x){ return Math.round(x * 10000) / 10000; }
function round2(x){ return Math.round(x * 100) / 100; }

function monthIndex(value){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value))) throw new Error('请填写有效的起止年月（YYYY-MM）');
  const [y,m]=String(value).split('-').map(Number);
  if(y<1900 || y>2200) throw new Error('年份须在1900至2200之间');
  return y*12+m-1;
}
function period(start,end){
  const a=monthIndex(start), b=monthIndex(end);
  if(b<a || b-a>=1200) throw new Error('结束年月不得早于开始年月，单个期间不得超过100年');
  const months={};
  for(let i=a;i<=b;i++){const y=Math.floor(i/12);months[y]=(months[y]||0)+1;}
  return {years:Object.keys(months).map(Number),months};
}
function datesFromParams(p){
  if(p.buildStartMonth || p.buildEndMonth || p.operateStartMonth || p.operateEndMonth){
    ['buildStartMonth','buildEndMonth','operateStartMonth','operateEndMonth'].forEach(k=>monthIndex(p[k]));
    return Object.fromEntries(['buildStartMonth','buildEndMonth','operateStartMonth','operateEndMonth'].map(k=>[k,p[k]]));
  }
  const bs=Number(p.buildStart), by=Number(p.buildYears), oy=Number(p.operateYears), fm=Number(p.firstMonths??12);
  if(![bs,by,oy,fm].every(Number.isInteger)||by<1||by>100||oy<1||oy>100||fm<1||fm>12) throw new Error('建设/运营年数须为1至100的整数，首年月数须为1至12');
  const op=bs+by;
  return {buildStartMonth:bs+'-01',buildEndMonth:(op-1)+'-12',operateStartMonth:op+'-'+String(13-fm).padStart(2,'0'),operateEndMonth:(op+oy-1)+'-12'};
}
function annualMap(value,label,years,maximum){
  if(value==null) return null;
  if(typeof value!=='object'||Array.isArray(value)) throw new Error(label+'须为年度数值表');
  const result={};
  Object.entries(value).forEach(([y,v])=>{
    if(!/^\d{4}$/.test(y)||!years.includes(Number(y))||typeof v!=='number'||!Number.isFinite(v)||v<0||(maximum!=null&&v>maximum)) throw new Error(label+'含越界年份或无效数值：'+y);
    result[y]=v;
  });
  return result;
}
// 页面、报告、敏感性统一调用，不再复制年度适配逻辑。
function fromParams(p){
  const dates=datesFromParams(p), build=period(dates.buildStartMonth,dates.buildEndMonth), op=period(dates.operateStartMonth,dates.operateEndMonth);
  const mode=p.mode||'lease',shareStartMonth=p.shareStartMonth||dates.operateStartMonth;
  const operateCostMode=p.operateCostMode||'per-unit';
  if(!['per-unit','rent-percent'].includes(operateCostMode))throw new Error('运营成本方式无效');
  if(operateCostMode==='rent-percent'&&(!Number.isFinite(p.operateRentPct??15.7)||(p.operateRentPct??15.7)<0||(p.operateRentPct??15.7)>100))throw new Error('运营成本租金比例须为0%至100%');
  const principalRepayMode=p.principalRepayMode||'principal-percent';
  if(!['principal-percent','rent-surplus'].includes(principalRepayMode))throw new Error('归还本金方式无效');
  const principalRepayIntervalMonths=p.principalRepayIntervalMonths??6,principalRepayPct=p.principalRepayPct??2.5,principalRepayFinalMonth=p.principalRepayFinalMonth??60;
  if(principalRepayMode==='principal-percent'&&(!Number.isInteger(principalRepayIntervalMonths)||principalRepayIntervalMonths<1||principalRepayIntervalMonths>1200))throw new Error('还本间隔须为1至1200的整数月');
  if(principalRepayMode==='principal-percent'&&(!Number.isFinite(principalRepayPct)||principalRepayPct<0||principalRepayPct>100))throw new Error('每期归还本金比例须为0%至100%');
  if(principalRepayMode==='principal-percent'&&(!Number.isInteger(principalRepayFinalMonth)||principalRepayFinalMonth<1||principalRepayFinalMonth>1200))throw new Error('末期还本月须为1至1200的整数月');
  const legacyCollection=p.collectRentPct===undefined&&p.collectReductionPct===undefined&&p.projectSharePct===undefined;
  if(!['lease','rent-percent','share'].includes(mode))throw new Error('收楼方式无效');
  if(mode==='rent-percent'&&(!Number.isFinite(p.collectRentPct??20)||(p.collectRentPct??20)<0||(p.collectRentPct??20)>100))throw new Error('实收租金收楼比例须为0%至100%');
  if(mode==='share'){
    const reduction=p.collectReductionPct??(100-(p.collectPct??50)),retained=p.projectSharePct??(100-(p.sharePct??30));
    if(!Number.isFinite(reduction)||reduction<0||reduction>100)throw new Error('固定收楼租金减免须为0%至100%');
    if(!Number.isFinite(retained)||retained<0||retained>100)throw new Error('项目保留收益须为0%至100%');
  }
  if(mode==='share'&&(monthIndex(shareStartMonth)<monthIndex(dates.operateStartMonth)||monthIndex(shareStartMonth)>monthIndex(dates.operateEndMonth)))throw new Error('分成起始月须在运营期内');
  if(monthIndex(dates.operateStartMonth)<monthIndex(dates.buildStartMonth)) throw new Error('运营开始年月不得早于建设开始年月');
  const years=Array.from({length:Math.max(...build.years,...op.years)-Math.min(...build.years,...op.years)+1},(_,i)=>Math.min(...build.years,...op.years)+i);
  const legacy=p.debtModel==='legacy-annual';
  const loanPlan=legacy?(annualMap(p.loanPlan,'借款计划',years)??{[build.years[0]]:p.loan}):{};
  const repayPlan=legacy?(annualMap(p.repayPlan,'还款计划',years)??Object.fromEntries(op.years.slice(1).map(y=>[y,p.repay]))):{};
  let occupancyRamp=p.occupancyMode==='monthly-phases'?{}:(annualMap(p.occupancyRamp,'出租率计划',op.years,1)??{[op.years[0]]:p.rampOcc}),occupancyPhaseInterval=null;
  if(p.occupancyMode==='monthly-phases'){
    const start=monthIndex(dates.operateStartMonth),end=monthIndex(dates.operateEndMonth);
    const a=monthIndex(p.rampStartMonth),b=monthIndex(p.rampEndMonth),c=monthIndex(p.stableStartMonth);
    if(a!==start||b<a||b>end||c!==b+1)throw new Error('爬坡期须从运营开始月起，稳定期须紧接爬坡期结束月');
    if(![p.rampOcc,p.stableOcc].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new Error('出租率须在0%至100%之间');
    const rawInterval=p.rampIntervalMonths??(b-a+1),interval=Number(rawInterval),rates=p.rampRates??[p.rampOcc];
    if(!Number.isInteger(interval)||interval<1||interval>1200)throw new Error('爬坡间隔须为1至1200的整数月');
    occupancyPhaseInterval=interval;
    if(!Array.isArray(rates)||rates.length!==Math.ceil((b-a+1)/interval))throw new Error('爬坡出租率个数须等于爬坡月数÷间隔月数向上取整');
    if(!rates.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new Error('每个爬坡出租率须在0%至100%之间');
    const sums={};for(let m=start;m<=end;m++){const y=Math.floor(m/12);sums[y]=(sums[y]||0)+(m<c?rates[Math.floor((m-a)/interval)]:p.stableOcc);}
    occupancyRamp=Object.fromEntries(op.years.map(y=>[y,sums[y]/op.months[y]]));
  }
  return {
    buildYears:build.years,operateYears:op.years,allYears:years,monthDict:op.months,dates,
    firstOperateMonths:op.months[op.years[0]],
    residentialArea:p.area,rentStartPrice:p.rent,rentIncreaseSpan:p.rentSpan,rentIncreaseRate:p.rentRate,
    costIncreaseSpan:p.costSpan??1,costIncreaseRate:p.costRate??0,
    occupancyRamp,stableStart:p.stableStart??op.years[0]+1,stableEnd:p.stableEnd??op.years.at(-1),occupancyStable:p.stableOcc,
    collectPrice:mode==='rent-percent'?(p.collect??0):p.collect,decorationUnitCost:p.deco,decorationInterval:p.decoInt,redecorationRatio:p.decoRatio,
    totalUnits:p.units,unitOperateCost:p.unitCost??0,startupFee:p.startup??0,
    operateCostMode,operateRentRatio:operateCostMode==='rent-percent'?(p.operateRentPct??15.7)/100:0,
    debtModel:p.debtModel||'monthly-v2',firstDecoLoanPct:p.firstDecoLoanPct??80,
    principalRepayMode,principalRepayIntervalMonths,principalRepayPct,principalRepayFinalMonth,
    loanAmount:p.loan??0,interestBase:p.interestBase??0,rateDiscount:p.rateDiscount??1,loanAnnualRate:p.loanRate,
    loanPlan,repayPlan,loanTotalYears:p.loanTotalYears??years.length,discountRatePct:p.discount,
    occupancyPhases:p.occupancyMode==='monthly-phases'?{start:p.rampStartMonth,end:p.rampEndMonth,interval:occupancyPhaseInterval,rates:p.rampRates??[p.rampOcc],stable:p.stableOcc}:null,
    collectMode:legacyCollection?'legacy':mode,collectRentRatio:mode==='rent-percent'?(p.collectRentPct??20)/100:0,
    collectFactor:mode==='share'?(1-(p.collectReductionPct??(100-(p.collectPct??50)))/100):1,
    shareRatio:mode==='share'?(1-(p.projectSharePct??(100-(p.sharePct??30)))/100):0,
    shareStartMonth
  };
}
function validate(p){
  if(p.debtModel==='monthly-v2'&&(!Number.isFinite(p.firstDecoLoanPct)||p.firstDecoLoanPct<0||p.firstDecoLoanPct>100)) throw new Error('首次装修借款比例须在0%至100%之间');
  for(const key of ['buildYears','operateYears']){
    if(!Array.isArray(p[key])||!p[key].length||p[key].length>100||p[key].some((y,i,a)=>!Number.isInteger(y)||y<1900||y>2200||(i&&y<=a[i-1]))) throw new Error('建设及运营年份须按顺序填写且不得重复');
  }
  for(const key of ['residentialArea','rentStartPrice','collectPrice','decorationUnitCost','redecorationRatio','totalUnits','unitOperateCost','startupFee','loanAmount','interestBase','rateDiscount','loanAnnualRate','discountRatePct']){
    if(typeof p[key]!=='number'||!Number.isFinite(p[key])||p[key]<0) throw new Error('参数须为有效非负数：'+key);
  }
  for(const key of ['rentIncreaseSpan','costIncreaseSpan','decorationInterval']) if(!Number.isInteger(p[key])||p[key]<1) throw new Error('递增跨度及装修间隔须为正整数');
  for(const key of ['rentIncreaseRate','costIncreaseRate']) if(!Number.isFinite(p[key])||p[key]<=-100) throw new Error('递增率须大于-100%');
  if(!Number.isFinite(p.occupancyStable)||p.occupancyStable<0||p.occupancyStable>1) throw new Error('出租率须在0至1之间');
  if(!Number.isInteger(p.stableStart)||!Number.isInteger(p.stableEnd)||p.stableStart>p.stableEnd+1) throw new Error('稳定期年份范围无效');
}

/**
 * p 参数对象（与Streamlit输入一一对应，含默认值）:
 *  buildYears: [2026]            建设期年份数组
 *  operateYears: [2027,...,2038] 运营期年份数组
 *  firstOperateMonths: 12        运营首年实际运营月数（支持年中开业）
 *  residentialArea: 20000        住宅面积㎡
 *  rentStartPrice: 75            起始租金 元/㎡/月
 *  rentIncreaseSpan: 3           租金递增跨度（年）
 *  rentIncreaseRate: 5           租金递增率 %
 *  costIncreaseSpan: 1           成本递增跨度（年）
 *  costIncreaseRate: 0           成本递增率 %
 *  occupancyRamp: {2027:0.85}    爬坡期出租率（年->率）
 *  stableStart: 2028             稳定期起始年
 *  stableEnd: 2038               稳定期结束年
 *  occupancyStable: 0.95         稳定期出租率
 *  collectPrice: 25              收楼单价 元/㎡/月
 *  decorationUnitCost: 1500      首次装修单方造价 元/㎡
 *  decorationInterval: 10        装修间隔（年）
 *  redecorationRatio: 0.30       二次装修成本系数
 *  totalUnits: 500               总套数
 *  unitOperateCost: 800          单套月运营成本 元/套/月
 *  startupFee: 50                开办费（万元，首个运营年计入）
 *  loanAmount: 13892             总借款额（万元）
 *  interestBase: 10600           计息本金（万元）
 *  rateDiscount: 0.80            利率折扣系数
 *  loanAnnualRate: 3.5           贷款年利率 %
 *  loanPlan: {2026:13892}        借款计划（年->万元）
 *  repayPlan: {2030:2000,...}    还款计划（年->万元）
 *  discountRatePct: 6            折现率 %
 */
function calcNonResiReform(p, cfgIn){
  p=Object.assign({costIncreaseSpan:1,costIncreaseRate:0,loanPlan:{},repayPlan:{},occupancyRamp:{}},p);
  validate(p);
  const K = Object.assign({}, NR_DEFAULTS, cfgIn||{});
  const allYears = [...(p.allYears||[]),...p.buildYears, ...p.operateYears].sort((a,b)=>a-b).filter((v,i,a)=>a.indexOf(v)===i);
  if(allYears.some(y=>!Number.isInteger(y)||y<1900||y>2200)) throw new Error('测算年份无效');
  for(const key of ['collectFactor','shareRatio','collectRentRatio']) if(p[key]!=null&&(!Number.isFinite(p[key])||p[key]<0||p[key]>1)) throw new Error('收楼及合作比例须在0至100%之间');
  annualMap(p.loanPlan,'借款计划',allYears);annualMap(p.repayPlan,'还款计划',allYears);annualMap(p.occupancyRamp,'出租率计划',p.operateYears,1);
  const operateSet = new Set(p.operateYears);
  const buildSet = new Set(p.buildYears);
  const isOperate = {}; allYears.forEach(y=>isOperate[y]=operateSet.has(y));
  const monthDict = {};
  allYears.forEach(y=>{
    if(!operateSet.has(y)) monthDict[y]=0;
    else if(p.monthDict) monthDict[y]=p.monthDict[y];
    else if(y===p.operateYears[0]) monthDict[y]=p.firstOperateMonths??12;
    else monthDict[y]=12;
    if(!Number.isInteger(monthDict[y])||monthDict[y]<0||monthDict[y]>12) throw new Error('年度运营月数须为0至12的整数：'+y);
  });
  const rate = p.loanAnnualRate/100;
  const discountR = p.discountRatePct/100;
  const totalOperateMonths = p.operateYears.reduce((s,y)=>s+monthDict[y],0);
  if(!totalOperateMonths) throw new Error('总运营月数须大于0');

  // ===== 1. 收入 =====
  const resiOccupancy = {}, resiRentPrice = {};
  p.operateYears.forEach(y=>{
    if(p.occupancyRamp[y]!==undefined) resiOccupancy[y]=p.occupancyRamp[y];
    else if(p.stableStart<=y && y<=p.stableEnd) resiOccupancy[y]=p.occupancyStable;
    else resiOccupancy[y]=0;
  });
  p.operateYears.forEach((y,idx)=>{
    const times = Math.floor(idx/p.rentIncreaseSpan);
    resiRentPrice[y] = p.rentStartPrice*Math.pow(1+p.rentIncreaseRate/100, times);
  });
  const income = {};
  allYears.forEach(y=>{
    if(!isOperate[y]){ income[y]={rent:0, rentAfterTax:0}; }
    else{
      const occ=resiOccupancy[y]||0, rp=resiRentPrice[y]||0, m=monthDict[y];
      const ri = p.residentialArea*rp*occ*m/10000;
      income[y]={rent:round4(ri), rentAfterTax:round4(ri/(1+K.vatOut))};
    }
  });

  // ===== 2. 成本 =====
  const cost = {};
  // 2a 收楼成本
  allYears.forEach(y=>{
    cost[y]={};
    if(!isOperate[y]){ cost[y].collect=0; cost[y].collectAT=0; }
    else{
      const m=monthDict[y];
      const c = p.collectMode==='rent-percent'?income[y].rent*p.collectRentRatio:p.residentialArea*p.collectPrice*m/10000*(p.collectMode&&p.collectMode!=='legacy'?1:(resiOccupancy[y]||0))*(p.collectFactor!==undefined?p.collectFactor:1);
      cost[y].collect=round4(c); cost[y].collectAT=round4(c/(1+K.vatOut));
    }
  });
  // 2b 工程费用（首装+重装摊销）
  const firstDeco = p.residentialArea*p.decorationUnitCost/10000;
  const maxOpYears = p.operateYears.length;
  const debtMonths=p.dates?monthIndex(p.dates.operateEndMonth)-monthIndex(p.dates.buildStartMonth)+1:0;
  const decoTimes = p.debtModel==='monthly-v2'?Math.ceil(debtMonths/(p.decorationInterval*12)):1 + Math.max(0, Math.floor((maxOpYears-1)/p.decorationInterval));
  const totalEng = firstDeco + (decoTimes-1)*firstDeco*p.redecorationRatio;
  const monthlyAmort = totalOperateMonths>0? totalEng/totalOperateMonths : 0;
  allYears.forEach(y=>{
    if(!isOperate[y]){ cost[y].eng=0; cost[y].engAT=0; }
    else{ const e=monthlyAmort*monthDict[y]; cost[y].eng=round4(e); cost[y].engAT=round4(e/(1+K.vatOut)); }
  });
  // 2c 运营费用
  const firstOpYear = p.operateYears[0];
  const firstOpPartial = monthDict[firstOpYear]<12;
  allYears.forEach(y=>{
    if(!isOperate[y]){ cost[y].op=0; cost[y].opRecurring=0; cost[y].startup=0; cost[y].opAT=0; }
    else{
      const m=monthDict[y];
      const opIdx = p.operateYears.indexOf(y);
      const fullIdx = firstOpPartial? opIdx-1 : opIdx;
      const incTimes = fullIdx>=0? Math.floor(Math.max(0,fullIdx)/p.costIncreaseSpan) : 0;
      const mult = Math.pow(1+p.costIncreaseRate/100, incTimes);
      const recurring = p.operateCostMode==='rent-percent'?income[y].rent*p.operateRentRatio:p.unitOperateCost*mult*p.totalUnits*m/10000;
      const startup = y===firstOpYear?p.startupFee:0;
      const total = recurring+startup;
      cost[y].opRecurring=round4(recurring); cost[y].startup=round4(startup);
      cost[y].op=round4(total); cost[y].opAT=round4(total/(1+K.vatOps));
    }
  });
  const monthlyDebt=p.debtModel==='monthly-v2'?monthlyDebtPlan(p,firstDeco,income,cost,resiOccupancy):null;
  // 2d 财务费用（还本付息表）
  const loan = {};
  let endLast=0;
  const effRate = rate*p.rateDiscount;
  const interestScale = p.loanAmount>0? p.interestBase/p.loanAmount : 1.0;
  // 旧年度算法保留：仅 legacy-annual / 历史直接调用时使用。
  allYears.forEach(y=>{
    const begin=endLast;
    const cur=p.loanPlan[y]||0;
    const rep=p.repayPlan[y]||0;
    const avgBal = begin+cur/2;
    let interest = avgBal*effRate*interestScale;
    interest = Math.max(interest,0);
    const repPrincipal = Math.min(rep, begin+cur);
    let end = begin+cur-repPrincipal; end=Math.max(end,0);
    loan[y]={begin:round4(begin), borrow:round4(cur), interest:round4(interest),
             repay:round4(repPrincipal), payTotal:round4(repPrincipal+interest), end:round4(end)};
    endLast=end;
  });
  if(monthlyDebt) allYears.forEach(y=>{loan[y]=monthlyDebt.annual[y]||{begin:0,borrow:0,interest:0,repay:0,payTotal:0,end:0,engineering:0};});
  allYears.forEach(y=>{
    const f=loan[y].interest;
    cost[y].fin=round4(f);
    cost[y].finAT = f>0? round4(f/(1+K.vatOps)):0;
    // 保留参考分类，重合年份可能两列同时出现，不能再次相加作为总成本。
    cost[y].finBuild=buildSet.has(y)?round4(f):0;
    cost[y].finOperate=operateSet.has(y)?round4(f):0;
  });
  // 2e 总成本
  allYears.forEach(y=>{
    const shareR = p.shareRatio!==undefined? p.shareRatio : 0;
    let eligibleRent=income[y].rent;
    if(p.shareStartMonth&&p.dates&&isOperate[y]){
      const start=monthIndex(p.dates.operateStartMonth),end=monthIndex(p.dates.operateEndMonth),shareStart=monthIndex(p.shareStartMonth);
      let allWeight=0,eligibleWeight=0;
      for(let m=Math.max(start,y*12);m<=Math.min(end,y*12+11);m++){
        const phase=p.occupancyPhases;
        const occ=phase?(m<=monthIndex(phase.end)?phase.rates[Math.floor((m-monthIndex(phase.start))/phase.interval)]:phase.stable):(resiOccupancy[y]||0);
        allWeight+=occ;if(m>=shareStart)eligibleWeight+=occ;
      }
      eligibleRent=allWeight?income[y].rent*eligibleWeight/allWeight:0;
    }
    cost[y].share = round4(eligibleRent * shareR);
    cost[y].shareAT = round4(cost[y].share/(1+K.vatOut));
    cost[y].total = round4(cost[y].collect+cost[y].eng+cost[y].op+cost[y].fin+cost[y].share);
    cost[y].totalAT = round4(cost[y].collectAT+cost[y].engAT+cost[y].opAT+cost[y].finAT+cost[y].shareAT);
  });

  // ===== 3. 税金 =====
  const tax = {};
  allYears.forEach(y=>{
    if(!isOperate[y]){ tax[y]={output:0,input:0,vat:0,surcharge:0,stamp:0,total:0}; }
    else{
      const ri=income[y].rent;
      const output = ri/(1+K.vatOut)*K.vatOut;
      const inputT = (cost[y].collect+cost[y].eng)*K.vatOut/(1+K.vatOut) + (cost[y].op+cost[y].fin)*K.vatOps/(1+K.vatOps);
      const vat = Math.max(output-inputT,0);
      const surcharge = vat*K.surcharge;
      const stamp = (y===firstOpYear)? p.decorationUnitCost*p.residentialArea/10000*K.stampDeco : 0;
      tax[y]={output:round4(output),input:round4(inputT),vat:round4(vat),
              surcharge:round4(surcharge),stamp:round4(stamp),total:round4(vat+surcharge+stamp)};
    }
  });

  // ===== 4. 损益表（Excel逐月累计利润补亏，年度汇总） =====
  const profit = {};
  allYears.forEach(y=>{
    const inAT=income[y].rentAfterTax, costAT=cost[y].totalAT;
    const pretax = round4(inAT-costAT);
    // 利润只扣附加及印花税；增值税仍留在 tax.total 供现金流使用。
    const t=round4(tax[y].surcharge+tax[y].stamp);
    profit[y]={incomeAT:inAT, costAT:costAT, pretax:pretax, tax:t, totalProfit:round4(pretax-t)};
  });
  /* # 停用：原年度五年补亏算法，仅保留历史核对，不参与任何当前计算。
  let lossHistory=[], firstProfitYear=null, lastNegTaxable=0, lossYearsUsed=0;
  allYears.forEach((y,idx)=>{
    const cur=profit[y].totalProfit;
    lossHistory.push(cur);
    if(firstProfitYear===null && cur>0) firstProfitYear=y;
    let makeup=0;
    if(firstProfitYear!==null){
      if(lossYearsUsed>=K.lossCarry) makeup=0;
      else if(y===firstProfitYear){
        const prev5 = lossHistory.slice(Math.max(0,idx-K.lossCarry), idx);
        makeup = prev5.reduce((s,v)=>s+v,0);
      }else{
        makeup = lastNegTaxable<0? lastNegTaxable:0;
      }
    }
    const taxable = cur+makeup;
    if(firstProfitYear!==null && makeup!==0) lossYearsUsed++;
    lastNegTaxable = taxable<0? taxable:0;
    profit[y].makeup=round4(makeup);
    profit[y].taxable=round4(taxable);
    profit[y].incomeTax = profit[y].taxable>0? round4(profit[y].taxable*K.incomeTax):0;
    profit[y].netProfit = round4(profit[y].totalProfit - profit[y].incomeTax);
  });
  */
  const monthlyProfit=monthlyAccounting(p,K,{allYears,monthDict,income,cost,tax,profit,loan,monthlyDebt:monthlyDebt?.months||null,resiOccupancy});
  allYears.forEach(y=>{
    const months=monthlyProfit.filter(m=>Number(m.date.slice(0,4))===y);
    for(const key of ['makeup','taxable','incomeTax','netProfit'])profit[y][key]=round4(months.reduce((s,m)=>s+m[key],0));
  });

  // ===== 5. 现金流量表 =====
  const cf = {};
  let cum=0, cumNpv=0;
  allYears.forEach((y,idx)=>{
    const inflow=income[y].rent;
    const engineering=monthlyDebt?loan[y].engineering:cost[y].eng;
    const cashCost=round4(cost[y].collect+engineering+cost[y].op+cost[y].fin+cost[y].share);
    const outflow=round4(cashCost+tax[y].total+profit[y].incomeTax);
    const net=round4(inflow-outflow);
    cum+=net;
    const n=idx+1;
    const factor=Math.pow(1+discountR, n-0.5);
    const npv=net/factor;
    cumNpv+=round4(npv);
    cf[y]={engineering,cashCost,inflow:round4(inflow), outflow:outflow, net:net, cumNet:round4(cum), npv:round4(npv), cumNpv:round4(cumNpv)};
  });

  // ===== 6. IRR（牛顿迭代，与Python excel_irr_final一致） =====
  const cfList = allYears.map(y=>cf[y].net);
  const irr = excelIrr(cfList);

  // ===== 7. 汇总指标 =====
  const sum = f=>allYears.reduce((s,y)=>s+f(y),0);
  const loanTotalYears=p.loanTotalYears??allYears.length;
  if(!Number.isInteger(loanTotalYears)||loanTotalYears<1||loanTotalYears>100) throw new Error('借款期限须为1至100年');
  const lastLoanYear=p.buildYears[0]+loanTotalYears-1;
  const refFin=sum(y=>cost[y].finBuild+cost[y].finOperate);
  const refProfit=sum(y=>y>=p.buildYears[0]&&y<=lastLoanYear?profit[y].totalProfit:0);
  const summary = {
    totalIncome: round2(sum(y=>income[y].rent)),
    totalCost: round2(sum(y=>cost[y].total)),
    totalTax: round2(sum(y=>tax[y].total)),
    totalNetProfit: round2(sum(y=>profit[y].netProfit)),
    totalNpv: round2(cumNpv),
    irr: irr!==null? round2(irr*100) : null,
    paybackInfo: calcPayback(allYears, cf),
    decoTimes: decoTimes,
    totalEngCost: round2(totalEng),
    totalOperateMonths,
    interestCoverageReference:refFin?round2((refProfit+sum(y=>cost[y].finOperate))/refFin):0,
  };

  const warnings=[monthlyDebt?'现金流工程支出采用月度实际付款计划，损益表仍采用工程摊销；前期补亏与所得税按Excel逐月计算后汇总。':'利息采用参考模型年度平均占用算法，非逐月计息；前期补亏及所得税已改为逐月计算，利息备付率需财务复核。'];
  if(monthlyDebt&&monthlyDebt.months.at(-1).end>0.00005) warnings.push(p.principalRepayMode==='rent-surplus'?'按月租金扣除运营费用还本后，测算期末仍有未归还本金；未自动追加清偿。':'末期还本后仍有未归还本金（可能有末期之后的贷款拨款或测算期不足）；未自动提前还款。');
  if(p.buildYears.some(y=>operateSet.has(y))) warnings.push('建设与运营年份重合：参考财务费用分类存在交叉，备付率不可直接作正式审签依据。');
  if(monthlyDebt)summary.totalLoan=round4(firstDeco*p.firstDecoLoanPct/100);
  const collectEquivalent={};
  allYears.forEach(y=>{const areaMonths=p.residentialArea*monthDict[y],rent=income[y].rent,collect=cost[y].collect;
    collectEquivalent[y]={fixedPrice:areaMonths>0?collect*10000/areaMonths:null,rentRatio:rent>0?collect/rent:null};
  });
  const result={ allYears, monthDict, income, cost, collectEquivalent, tax, profit, cf, loan, monthlyDebt:monthlyDebt?.months||null, monthlyProfit, taxModelVersion:NR_TAX_MODEL_VERSION, resiOccupancy, resiRentPrice, summary, dates:p.dates||null, modelVersion:monthlyDebt?'anju-monthly-debt-v2':'anju-4d1c23b-month-v1', warnings };
  if(monthlyDebt){
    result.monthlyCashflow=finalizeMonthlyCashflow(monthlyProfit,result);
    const rate=xirr(result.monthlyCashflow.map(m=>m.net),result.monthlyCashflow.map(m=>m.date));
    summary.monthlyXirr=rate===null?null:rate*100;
    summary.annualIrr=summary.irr;
    summary.irr=summary.monthlyXirr===null?null:Math.round(summary.monthlyXirr*100)/100;
    warnings.push('前期补亏按项目开始至上月累计利润计算，正数从本月利润扣除；所得税对本月正计税基础计提，不因后月亏损冲回，不代表实际申报缴税计划。增值税及附加仍按年度分配；原Excel累计恰好归零时补亏为0的边界保留。');
  }
  return result;
}

// Annual accounting remains the reconciliation authority. Payment and interest
// retain their actual month; other components use their operational drivers.
function monthlyAccounting(p,K,R){
  const rows=R.monthlyDebt?R.monthlyDebt.map(m=>({date:m.date+'-01',engineering:m.engineering,interest:m.interest})):R.allYears.flatMap(y=>Array.from({length:12},(_,i)=>({date:y+'-'+String(i+1).padStart(2,'0')+'-01',engineering:0,interest:0})));
  const dates=p.dates||{operateStartMonth:p.operateYears[0]+'-'+String(13-R.monthDict[p.operateYears[0]]).padStart(2,'0'),operateEndMonth:p.operateYears.at(-1)+'-12'};
  const start=monthIndex(dates.operateStartMonth),end=monthIndex(dates.operateEndMonth);
  for(const y of R.allYears){
    const group=rows.filter(m=>Number(m.date.slice(0,4))===y);
    if(!group.length)continue;
    const active=group.map(m=>{const i=monthIndex(m.date.slice(0,7));return i>=start&&i<=end?1:0;});
    const occ=group.map((m,i)=>{
      if(!active[i])return 0;
      const phase=p.occupancyPhases,index=monthIndex(m.date.slice(0,7));
      return phase?(index<=monthIndex(phase.end)?phase.rates[Math.floor((index-monthIndex(phase.start))/phase.interval)]:phase.stable):(R.resiOccupancy[y]||0);
    });
    const assign=(key,total,weights)=>{
      let sum=weights.reduce((a,b)=>a+b,0),used=0;
      if(!sum){weights=group.map((_,i)=>i===group.length-1?1:0);sum=1;}
      const last=weights.findLastIndex(v=>v!==0);
      group.forEach((m,i)=>{m[key]=i===last?round4(total-used):round4(total*weights[i]/sum);used=round4(used+m[key]);});
    };
    assign('engineering',R.monthlyDebt?R.loan[y].engineering:R.cost[y].eng,R.monthlyDebt?group.map(m=>m.engineering):active);
    assign('interest',R.monthlyDebt?R.loan[y].interest:R.cost[y].fin,R.monthlyDebt?group.map(m=>m.interest):group.map(()=>1));
    assign('inflow',R.income[y].rent,occ);
    assign('collect',R.cost[y].collect,p.collectMode==='rent-percent'||p.collectMode==='legacy'||!p.collectMode?occ:active);
    const shareWeights=occ.map((v,i)=>v&&monthIndex(group[i].date.slice(0,7))>=monthIndex(p.shareStartMonth||dates.operateStartMonth)?v:0);
    assign('share',R.cost[y].share,shareWeights);
    const first=y===p.operateYears[0]?active.indexOf(1):-1;
    const baseOp=(R.cost[y].op-(first>=0?p.startupFee:0))/(active.reduce((a,b)=>a+b,0)||1);
    const opWeights=active.map((a,i)=>(p.operateCostMode==='rent-percent'?group[i].inflow*p.operateRentRatio:a*baseOp)+(i===first?p.startupFee:0));
    assign('operations',R.cost[y].op,opWeights);
    assign('amortization',R.cost[y].eng,active);
    assign('vat',R.tax[y].vat,occ);
    assign('surcharge',R.tax[y].surcharge,occ);
    assign('stamp',R.tax[y].stamp,group.map((_,i)=>i===first?1:0));
    assign('incomeAT',R.income[y].rentAfterTax,occ);
    for(const [key,total,weights] of [
      ['collectAT',R.cost[y].collectAT,p.collectMode==='rent-percent'||p.collectMode==='legacy'||!p.collectMode?occ:active],['engAT',R.cost[y].engAT,active],
      ['opAT',R.cost[y].opAT,opWeights],['finAT',R.cost[y].finAT,group.map(m=>m.interest)],['shareAT',R.cost[y].shareAT,shareWeights]
    ])assign(key,total,weights);
    let cumulativeProfit=0;
    group.forEach((m,i)=>{
      m.profit=round4(m.incomeAT-m.collectAT-m.engAT-m.opAT-m.finAT-m.shareAT-m.surcharge-m.stamp);
      if(i===group.length-1)m.profit=round4(R.profit[y].totalProfit-cumulativeProfit);
      cumulativeProfit=round4(cumulativeProfit+m.profit);
      /* # 停用：原年内所得税累计计提差额（允许负数冲回）。
      const accrued=i===group.length-1?R.profit[y].incomeTax:round4(Math.max(0,cumulativeProfit+R.profit[y].makeup)*K.incomeTax);
      m.incomeTax=round4(accrued-previousTax);previousTax=accrued;
      */
    });
  }
  applyMonthlyLossOffset(rows,K.incomeTax);
  return rows;
}

const NR_TAX_MODEL_VERSION='excel-monthly-loss-v1';
// 对应原表42行两个严格AND条件；首月为0，累计恰为0时也为0。
// 累计项目净利润跨年延续，不重置、不附加旧年度五年窗口。
function applyMonthlyLossOffset(rows,rate){
  let cumulative=0;
  rows.forEach((m,i)=>{
    const previous=cumulative;
    cumulative+=m.profit;
    const makeup=i>0&&cumulative>0&&m.profit>0&&previous<0?-previous:
      i>0&&cumulative<0&&m.profit>0?m.profit:0;
    const taxable=m.profit-makeup;
    m.makeup=round4(makeup);
    m.taxable=round4(taxable);
    m.incomeTax=round4(Math.max(0,taxable)*rate);
    m.netProfit=round4(m.profit-m.incomeTax);
    m.cumulativeProfit=round4(cumulative);
  });
  return rows;
}

function finalizeMonthlyCashflow(rows,R){
  for(const y of R.allYears){
    const group=rows.filter(m=>Number(m.date.slice(0,4))===y);
    let netSum=0;
    group.forEach((m,i)=>{
      m.outflow=round4(m.engineering+m.interest+m.collect+m.operations+m.share+m.vat+m.surcharge+m.stamp+m.incomeTax);
      m.reconciliation=0;
      m.net=round4(m.inflow-m.outflow);
      if(i===group.length-1){m.reconciliation=round4(m.net-(R.cf[y].net-netSum));m.outflow=round4(m.outflow+m.reconciliation);m.net=round4(R.cf[y].net-netSum);}
      netSum=round4(netSum+m.net);
    });
  }
  return rows;
}

// Excel XIRR basis: actual UTC day differences / 365; scan in log-rate
// space and choose the root nearest Excel's default 10% guess.
function xirr(flows,dates){
  if(flows.length!==dates.length||flows.length<2||!flows.every(Number.isFinite)||!flows.some(v=>v>0)||!flows.some(v=>v<0))return null;
  const times=dates.map(d=>Date.parse(d+'T00:00:00Z'));
  if(!times.every(Number.isFinite)||times.some(t=>t<times[0]))return null;
  const years=times.map(t=>(t-times[0])/86400000/365),scale=Math.max(...flows.map(Math.abs));
  const value=q=>flows.reduce((s,v,i)=>s+v/scale*Math.exp(-q*years[i]),0);
  const roots=[];let lo=-16,flo=value(lo);
  for(let hi=-15.98;hi<=16;hi+=.02){
    const fhi=value(hi);
    if(flo===0)roots.push(Math.expm1(lo));
    else if(Math.sign(flo)!==Math.sign(fhi)){
      let a=lo,b=hi,fa=flo;
      for(let i=0;i<100;i++){const mid=(a+b)/2,f=value(mid);if(Math.sign(f)===Math.sign(fa)){a=mid;fa=f;}else b=mid;}
      roots.push(Math.expm1((a+b)/2));
    }
    lo=hi;flo=fhi;
  }
  return roots.length?roots.sort((a,b)=>Math.abs(a-.1)-Math.abs(b-.1))[0]:null;
}

// 金额单位万元。保留未四舍五入余额运算，只在输出时取四位小数。
function monthlyDebtPlan(p,firstDeco,income,cost,resiOccupancy){
  const start=monthIndex(p.dates.buildStartMonth),last=monthIndex(p.dates.operateEndMonth);
  if(last<start)throw new Error('运营结束年月不得早于建设开始年月');
  const count=last-start+1,ratio=p.firstDecoLoanPct/100,totalLoan=firstDeco*ratio;
  const payments=Array(count).fill(0),firstPayments=Array(count).fill(0);
  let decoTimes=0;
  for(let origin=0;origin<count;origin+=p.decorationInterval*12){
    decoTimes++;
    const amount=firstDeco*(origin===0?1:p.redecorationRatio);
    [[1,.20],[3,.35],[5,.25],[13,.17],[28,.03]].forEach(([month,share])=>{
      const index=Math.min(origin+month-1,count-1);
      payments[index]+=amount*share;
      if(origin===0)firstPayments[index]+=amount*share;
    });
  }
  const months=[],annual={};let balance=0;
  const opStart=monthIndex(p.dates.operateStartMonth),opEnd=monthIndex(p.dates.operateEndMonth);
  const monthlySurplus={};
  if(p.principalRepayMode==='rent-surplus')for(const year of p.operateYears){
    const indices=[];for(let idx=Math.max(opStart,year*12);idx<=Math.min(opEnd,year*12+11);idx++)indices.push(idx);
    const weights=indices.map(idx=>{const phase=p.occupancyPhases;return phase?(idx<=monthIndex(phase.end)?phase.rates[Math.floor((idx-monthIndex(phase.start))/phase.interval)]:phase.stable):(resiOccupancy[year]||0);});
    const weightSum=weights.reduce((sum,value)=>sum+value,0),rentTotal=income[year]?.rent||0,opTotal=cost[year]?.op||0;
    const rents=indices.map((_,i)=>weightSum?rentTotal*weights[i]/weightSum:0);
    const startup=year===p.operateYears[0]?p.startupFee:0,normalOp=opTotal-startup;
    indices.forEach((idx,i)=>{const operating=p.operateCostMode==='rent-percent'?(rentTotal?normalOp*rents[i]/rentTotal:0):normalOp/(indices.length||1);monthlySurplus[idx]=Math.max(0,rents[i]-operating-(i===0?startup:0));});
  }
  for(let i=0;i<count;i++){
    const index=start+i,year=Math.floor(index/12),month=i+1,begin=balance,borrow=firstPayments[i]*ratio;
    // 月初提款、月末还本：当月还本仍占用本月资金，从次月起减少计息余额。
    // 若取得实际放款/还款日，应改按实际占用天数计息，不能只改扣本月份。
    const interest=Math.max(0,begin+borrow)*p.loanAnnualRate/100/12;
    const finalMonth=p.principalRepayFinalMonth||60,interval=p.principalRepayIntervalMonths||6;
    const scheduled=p.principalRepayMode==='rent-surplus'?(monthlySurplus[index]||0):month===finalMonth?begin+borrow:month<finalMonth&&month%interval===0?totalLoan*(p.principalRepayPct??2.5)/100:0;
    const repay=Math.min(begin+borrow,scheduled);
    balance=Math.max(0,begin+borrow-repay);
    const raw={begin,borrow,interest,repay,payTotal:repay+interest,end:balance,engineering:payments[i]};
    months.push({month,date:year+'-'+String(index%12+1).padStart(2,'0'),...Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,round4(v)]))});
    if(!annual[year])annual[year]={begin,borrow:0,interest:0,repay:0,payTotal:0,end:0,engineering:0};
    for(const key of ['borrow','interest','repay','payTotal','engineering'])annual[year][key]+=raw[key];
    annual[year].end=balance;
  }
  Object.values(annual).forEach(row=>Object.keys(row).forEach(key=>row[key]=round4(row[key])));
  return {months,annual,decoTimes};
}

function calcNpvAtRate(r, flows){
  let s=0;
  flows.forEach((f,i)=>{ s += f/Math.pow(1+r, i+1); });
  return s;
}
function excelIrr(flows, maxIter=1000, tol=1e-7){
  const hasPos=flows.some(f=>f>0), hasNeg=flows.some(f=>f<0);
  if(!hasPos||!hasNeg) return null;
  const guesses=[-0.01,-0.02,-0.03,-0.04,-0.05,0.0,0.1];
  for(const g of guesses){
    let r=g;
    for(let i=0;i<maxIter;i++){
      const npv=calcNpvAtRate(r,flows);
      if(Math.abs(npv)<tol && r>=-0.5 && r<=0.5) return r;
      const h=1e-8;
      const d=(calcNpvAtRate(r+h,flows)-npv)/h;
      if(Math.abs(d)<1e-12) break;
      let nr=r-npv/d;
      nr=Math.max(-0.5,Math.min(nr,0.5));
      if(Math.abs(nr-r)<tol){ if(nr>=-0.5&&nr<=0.5) return nr; break; }
      r=nr;
    }
  }
  return null;
}
function calcPayback(years, cf){
  for(let i=0;i<years.length;i++){
    if(cf[years[i]].cumNet>=0){
      return { year: years[i], index: i+1 };
    }
  }
  return null;
}

return { name:'安居乐寓版', version:'anju-le-yu-v1.0', taxModelVersion:NR_TAX_MODEL_VERSION, calc: calcNonResiReform, defaults: NR_DEFAULTS, fromParams, datesFromParams, applyMonthlyLossOffset, xirr };
})();
