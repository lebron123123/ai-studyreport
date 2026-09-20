// 非居改保：对照 calculator3.py @ 4d1c23b 的年度算法。
// 月份用于收入/摊销/运营成本；利息仍为参考模型的年度平均占用算法。

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
  if(monthIndex(dates.operateStartMonth)<monthIndex(dates.buildStartMonth)) throw new Error('运营开始年月不得早于建设开始年月');
  const years=Array.from({length:Math.max(...build.years,...op.years)-Math.min(...build.years,...op.years)+1},(_,i)=>Math.min(...build.years,...op.years)+i);
  const loanPlan=annualMap(p.loanPlan,'借款计划',years)??{[build.years[0]]:p.loan};
  const repayPlan=annualMap(p.repayPlan,'还款计划',years)??Object.fromEntries(op.years.slice(1).map(y=>[y,p.repay]));
  const occupancyRamp=annualMap(p.occupancyRamp,'出租率计划',op.years,1)??{[op.years[0]]:p.rampOcc};
  return {
    buildYears:build.years,operateYears:op.years,allYears:years,monthDict:op.months,dates,
    firstOperateMonths:op.months[op.years[0]],
    residentialArea:p.area,rentStartPrice:p.rent,rentIncreaseSpan:p.rentSpan,rentIncreaseRate:p.rentRate,
    costIncreaseSpan:p.costSpan??1,costIncreaseRate:p.costRate??0,
    occupancyRamp,stableStart:p.stableStart??op.years[0]+1,stableEnd:p.stableEnd??op.years.at(-1),occupancyStable:p.stableOcc,
    collectPrice:p.collect,decorationUnitCost:p.deco,decorationInterval:p.decoInt,redecorationRatio:p.decoRatio,
    totalUnits:p.units,unitOperateCost:p.unitCost,startupFee:p.startup,
    loanAmount:p.loan,interestBase:p.interestBase,rateDiscount:p.rateDiscount,loanAnnualRate:p.loanRate,
    loanPlan,repayPlan,loanTotalYears:p.loanTotalYears??years.length,discountRatePct:p.discount,
    collectFactor:p.mode==='share'?(p.collectPct??50)/100:1,shareRatio:p.mode==='share'?(p.sharePct??0)/100:0
  };
}
function validate(p){
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
  for(const key of ['collectFactor','shareRatio']) if(p[key]!=null&&(!Number.isFinite(p[key])||p[key]<0||p[key]>1)) throw new Error('合作比例须在0至1之间');
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
      const occ=resiOccupancy[y]||0, m=monthDict[y];
      const c = p.residentialArea*p.collectPrice*occ*m/10000 * (p.collectFactor!==undefined? p.collectFactor : 1);
      cost[y].collect=round4(c); cost[y].collectAT=round4(c/(1+K.vatOut));
    }
  });
  // 2b 工程费用（首装+重装摊销）
  const firstDeco = p.residentialArea*p.decorationUnitCost/10000;
  const maxOpYears = p.operateYears.length;
  const decoTimes = 1 + Math.max(0, Math.floor((maxOpYears-1)/p.decorationInterval));
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
    if(!isOperate[y]){ cost[y].op=0; cost[y].opAT=0; }
    else{
      const m=monthDict[y];
      const opIdx = p.operateYears.indexOf(y);
      const fullIdx = firstOpPartial? opIdx-1 : opIdx;
      const incTimes = fullIdx>=0? Math.floor(Math.max(0,fullIdx)/p.costIncreaseSpan) : 0;
      const mult = Math.pow(1+p.costIncreaseRate/100, incTimes);
      let base = p.unitOperateCost*mult*p.totalUnits*m/10000;
      if(y===firstOpYear) base += p.startupFee;
      cost[y].op=round4(base); cost[y].opAT=round4(base/(1+K.vatOps));
    }
  });
  // 2d 财务费用（还本付息表）
  const loan = {};
  let endLast=0;
  const effRate = rate*p.rateDiscount;
  const interestScale = p.loanAmount>0? p.interestBase/p.loanAmount : 1.0;
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
    cost[y].share = round4(income[y].rent * shareR);
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
      const inputT = cost[y].eng*K.vatOut/(1+K.vatOut) + (cost[y].op+cost[y].fin)*K.vatOps/(1+K.vatOps);
      const vat = Math.max(output-inputT,0);
      const surcharge = vat*K.surcharge;
      const stamp = (y===firstOpYear)? p.decorationUnitCost*p.residentialArea/10000*K.stampDeco : 0;
      tax[y]={output:round4(output),input:round4(inputT),vat:round4(vat),
              surcharge:round4(surcharge),stamp:round4(stamp),total:round4(vat+surcharge+stamp)};
    }
  });

  // ===== 4. 损益表（含五年弥补亏损） =====
  const profit = {};
  allYears.forEach(y=>{
    const inAT=income[y].rentAfterTax, costAT=cost[y].totalAT;
    const pretax = round4(inAT-costAT);
    const t=tax[y].total;
    profit[y]={incomeAT:inAT, costAT:costAT, pretax:pretax, tax:t, totalProfit:round4(pretax-t)};
  });
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

  // ===== 5. 现金流量表 =====
  const cf = {};
  let cum=0, cumNpv=0;
  allYears.forEach((y,idx)=>{
    const inflow=income[y].rent;
    const outflow=round4(cost[y].total+tax[y].total+profit[y].incomeTax);
    const net=round4(inflow-outflow);
    cum+=net;
    const n=idx+1;
    const factor=Math.pow(1+discountR, n-0.5);
    const npv=net/factor;
    cumNpv+=round4(npv);
    cf[y]={inflow:round4(inflow), outflow:outflow, net:net, cumNet:round4(cum), npv:round4(npv), cumNpv:round4(cumNpv)};
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

  const warnings=['利息采用参考模型年度平均占用算法，非逐月计息；利息备付率为参考口径，需财务复核。'];
  if(p.buildYears.some(y=>operateSet.has(y))) warnings.push('建设与运营年份重合：参考财务费用分类存在交叉，备付率不可直接作正式审签依据。');
  return { allYears, monthDict, income, cost, tax, profit, cf, loan, resiOccupancy, resiRentPrice, summary, dates:p.dates||null, modelVersion:'anju-4d1c23b-month-v1', warnings };
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

return { calc: calcNonResiReform, defaults: NR_DEFAULTS, fromParams, datesFromParams };
})();
