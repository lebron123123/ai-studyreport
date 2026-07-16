// 非居改保财务测算引擎 —— 1:1 翻译自 calculator3.py 的 calc_non_resi_reform
// 保持与 Streamlit 版完全一致的计算口径

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
  const K = Object.assign({}, NR_DEFAULTS, cfgIn||{});
  const allYears = [...p.buildYears, ...p.operateYears].sort((a,b)=>a-b).filter((v,i,a)=>a.indexOf(v)===i);
  const operateSet = new Set(p.operateYears);
  const buildSet = new Set(p.buildYears);
  const isOperate = {}; allYears.forEach(y=>isOperate[y]=operateSet.has(y));
  const monthDict = {};
  allYears.forEach(y=>{
    if(!operateSet.has(y)) monthDict[y]=12;
    else if(y===p.operateYears[0]) monthDict[y]=p.firstOperateMonths||12;
    else monthDict[y]=12;
  });
  const rate = p.loanAnnualRate/100;
  const discountR = p.discountRatePct/100;
  const totalOperateMonths = p.operateYears.reduce((s,y)=>s+monthDict[y],0);

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
    profit[y].incomeTax = taxable>0? round4(taxable*K.incomeTax):0;
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
    cumNpv+=npv;
    cf[y]={inflow:round4(inflow), outflow:outflow, net:net, cumNet:round4(cum), npv:round4(npv), cumNpv:round4(cumNpv)};
  });

  // ===== 6. IRR（牛顿迭代，与Python excel_irr_final一致） =====
  const cfList = allYears.map(y=>cf[y].net);
  const irr = excelIrr(cfList);

  // ===== 7. 汇总指标 =====
  const sum = f=>allYears.reduce((s,y)=>s+f(y),0);
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
  };

  return { allYears, monthDict, income, cost, tax, profit, cf, loan, resiOccupancy, resiRentPrice, summary };
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

return { calc: calcNonResiReform, defaults: NR_DEFAULTS };
})();
