// 出售类(配保房/可售型人才房等)财务测算引擎 —— 1:1 翻译自 calculator3.py
window.SaleCalc = (function(){
const SALE_DEFAULTS = {
  saleFeeRate: 0.015,     // 销售费用率
  vatSale: 0.09,          // 销售/商业租金增值税率
  vatIn6: 0.06,           // 进项税6%档
  surcharge: 0.12,        // 增值税附加率
  mgCommRate: 0.08,       // 商业管理费率
  parkMgUnit: 80,         // 停车管理费 元/位/月
  fundPerSqm: 0.25,       // 维修金 元/㎡/月
  repairRate: 0.02,       // 维修费率
  vacPerSqm: 8,           // 空置服务费 元/㎡/月
  insPerSqm: 1.86,        // 保险 元/㎡(年)
  landTaxPerSqm: 3,       // 土地使用税 元/㎡
  prop1Rate: 0.12,        // 房产税1(从租)
  prop2Base: 0.7,         // 房产税2从价基数
  prop2Rate: 0.012,       // 房产税2税率
  extraEngRate: 0.02,     // 房产税2中建安附加率
  rentalPvRate: 0.035,    // 出租净收益折现率
  devDepRatio: 0.8,       // 折旧摊销基数比率
  depYears: 50,           // 摊销年限
  recoverRatio: 0.2,      // 回收固定资产余值比率
  adjTaxRate: 0.25,       // 调整所得税率
  incomeTax: 0.25,        // 所得税率
  lossCarry: 5,           // 亏损弥补年限
  stampSaleRate: 0,       // 销售印花税率(默认0)
};

function r4(x){ return Math.round(x*10000)/10000; }
function r2(x){ return Math.round(x*100)/100; }

/** p:
 *  buildStart, buildYears, operateYears,
 *  saleArea(㎡), saleAvgPrice(元/㎡), saleRamp {年:销售率} 各年销售率(合计≤1),
 *  otherTotal(万元,其他收入,运营首年一次性),
 *  —— 商业出租(净收益现值口径) ——
 *  commArea(㎡), commRent(元/㎡/月), commRentSpan, commRentRate(%), commRampOcc, commStableOcc,
 *  commRentStableStart(年,租金冻结起始年,可null=最后一年), leaseMonths(默认12),
 *  parkCount(个,商业停车管理费用),
 *  —— 成本参数 ——
 *  landCost(非配售土地成本,万), constructionCost(非配售建安,万), infraCost(非配售基础设施,万),
 *  otherEngCost(非配售工程其他,万), devCost(非配售开发成本,万),
 *  saleConstructionCost(配售建安,万), saleInfraCost(配售基础设施,万),
 *  projectInputTax(工程进项税,万), landUseArea(用地面积㎡), landFloorPrice(划拨楼面价 元/㎡),
 *  totalInvestment(总投资,万), devCostPlan {年:万元} 开发成本投资计划(默认建设期平摊),
 *  —— 融资 ——
 *  loanAmount(万), loanRate(%), loanTotalYears, customRepay {年:万元} 自定义还款计划,
 *  discountPct(%)
 */
function calc(p, cfgIn){
  const K = Object.assign({}, SALE_DEFAULTS, cfgIn||{});
  const buildArr = Array.from({length:p.buildYears},(_,i)=>p.buildStart+i);
  const opStart = p.buildStart + p.buildYears;
  const opArr = Array.from({length:p.operateYears},(_,i)=>opStart+i);
  const allYears = [...buildArr, ...opArr];
  const isOp = {}; allYears.forEach(y=>isOp[y]=y>=opStart);
  const leaseMonths = p.leaseMonths||12;
  const areaTotal = p.saleArea + p.commArea;
  const ratioSale = areaTotal!==0? p.saleArea/areaTotal : 0;
  const ratioComm = 1 - ratioSale;

  // ===== 1. 商业出租情况表（净收益现值口径） =====
  const commOcc={}, commRentP={};
  const stableStartY = (p.commRentStableStart && opArr.includes(p.commRentStableStart))? p.commRentStableStart : opArr[opArr.length-1];
  {
    let lastBefore = p.commRent;
    opArr.forEach((y,idx)=>{
      commOcc[y] = (idx===0)? p.commRampOcc : p.commStableOcc;
      let yp = p.commRent * Math.pow(1+p.commRentRate/100, Math.floor(idx/p.commRentSpan));
      if(y >= stableStartY){
        if(y === stableStartY) lastBefore = yp;
        yp = lastBefore;
      }else lastBefore = yp;
      commRentP[y] = r4(yp);
    });
  }
  // 全周期进项税合计（预循环）
  let totManageIns=0, totVacancy=0;
  opArr.forEach(y=>{
    const inc = p.commArea*commRentP[y]*commOcc[y]*leaseMonths/10000;
    totManageIns += inc*K.mgCommRate + p.commArea*K.insPerSqm/10000;
    totVacancy += p.commArea*(1-commOcc[y])*K.vacPerSqm*12/10000;
  });
  const totalInputTax = totManageIns*(K.vatIn6/(1+K.vatIn6)) + totVacancy*(K.vatSale/(1+K.vatSale)) + (p.projectInputTax||0);
  let remainInput = totalInputTax;
  const rental = {};
  opArr.forEach((y,idx)=>{
    const occ=commOcc[y], cr=commRentP[y];
    const inc = p.commArea*cr*occ*leaseMonths/10000;
    const tax1 = inc*(K.prop1Rate/(1+K.vatSale));
    const tax2base = areaTotal!==0?
      (p.landCost + p.constructionCost + p.infraCost + p.otherEngCost + p.constructionCost*K.extraEngRate*p.commArea/areaTotal) : 0;
    const tax2 = tax2base*K.prop2Base*K.prop2Rate*(1-occ);
    const mgC = inc*K.mgCommRate;
    const mgP = p.parkCount*K.parkMgUnit*12/10000;
    const fund = p.commArea*leaseMonths*K.fundPerSqm/10000;
    const rep = inc*K.repairRate;
    const vac = p.commArea*(1-occ)*K.vacPerSqm*12/10000;
    const ins = p.commArea*K.insPerSqm/10000;
    const landT = areaTotal!==0? p.landUseArea*(p.commArea/areaTotal)*K.landTaxPerSqm/10000 : 0;
    const costTot = tax1+tax2+mgC+mgP+fund+rep+vac+ins+landT;
    const outputT = inc>0? inc*(K.vatSale/(1+K.vatSale)) : 0;
    const inputBefore = remainInput;
    const vat = Math.max(outputT-inputBefore, 0);
    remainInput = Math.max(inputBefore-outputT, 0);
    const vatSur = vat*K.surcharge;
    const stamp = inc*0.0005;
    const taxTot = vat+vatSur+stamp;
    const netInc = inc - costTot - taxTot;
    const pv = netInc/Math.pow(1+K.rentalPvRate, idx+1);
    rental[y] = {occ:r4(occ), rent:r4(cr), income:r4(inc), tax1:r4(tax1), tax2:r4(tax2),
      mgC:r4(mgC), mgP:r4(mgP), fund:r4(fund), rep:r4(rep), vac:r4(vac), ins:r4(ins), landT:r4(landT),
      costTotal:r4(costTot), outputT:r4(outputT), inputT:r4(inputBefore), vat:r4(vat), vatSur:r4(vatSur),
      stamp:r4(stamp), taxTotal:r4(taxTot), netIncome:r4(netInc), pv:r4(pv)};
  });
  const rentalPvTotal = r4(opArr.reduce((s,y)=>s+rental[y].pv,0));

  // ===== 2. 收入（配保房销售 + 出租净收益现值(首年) + 其他收入(首年)） =====
  const income = {};
  allYears.forEach(y=>{
    const rate = (p.saleRamp&&p.saleRamp[y])||0;
    const sale = isOp[y]? r4(p.saleArea*p.saleAvgPrice*rate/10000) : 0;
    const other = (y===opStart)? r4(p.otherTotal||0) : 0;
    const rentPv = (y===opStart)? rentalPvTotal : 0;
    income[y] = {sale, other, rentPv, commIncome: rental[y]? rental[y].income:0,
      total: r4(sale + other + rentPv)};
  });

  // ===== 3. 还本付息（自定义还款计划模式） =====
  const loanPlan={}; loanPlan[p.buildStart]=p.loanAmount;
  const rate=p.loanRate/100;
  const firstLoanYear=p.buildStart, lastLoanYear=firstLoanYear+p.loanTotalYears-1;
  const loan={}, finCost={};
  let endLast=0;
  allYears.forEach(y=>{
    const begin=endLast, cur=loanPlan[y]||0;
    const interest=(begin+cur/2)*rate;
    const payInt=interest;
    const plan = (y<=lastLoanYear)? ((p.customRepay&&p.customRepay[y])||0) : 0;
    const maxRepay=begin+cur+interest-payInt;
    const rp = y<lastLoanYear? Math.min(plan, maxRepay) : maxRepay;
    let end=begin+cur+interest-payInt-rp; end=Math.max(end,0);
    loan[y]={begin:r4(begin),borrow:r4(cur),interest:r4(interest),repay:r4(rp),payInt:r4(payInt),total:r4(rp+payInt),end:r4(end)};
    finCost[y]=r4(payInt);
    endLast=end;
  });
  const buildFinTotal = buildArr.reduce((s,y)=>s+finCost[y],0);

  // ===== 4. 出售类总成本表（累计增值税+地价抵减） =====
  const landDeductTotal = p.saleArea*p.landFloorPrice/10000;
  const totalSaleIncomeAll = allYears.reduce((s,y)=>s+income[y].sale,0);
  const totalSaleFeeAll = totalSaleIncomeAll*K.saleFeeRate;
  const devCostSaleBase = p.totalInvestment - buildFinTotal*ratioSale - totalSaleFeeAll;
  const devCostDepBase = (p.landCost + p.devCost - buildFinTotal*ratioComm)*K.devDepRatio;
  const cost = {};
  let cumOut=0, cumIn=0, cumVat=0;
  allYears.forEach(y=>{
    const saleInc = income[y].sale;
    const saleRate = (p.saleRamp&&p.saleRamp[y])||0;
    const otherInc = income[y].other;
    const saleFee = saleInc*K.saleFeeRate;
    const outVat = saleInc>0? (saleInc + otherInc - landDeductTotal*saleRate)*(K.vatSale/(1+K.vatSale)) : 0;
    const inVat6 = ratioComm!==0? (p.otherEngCost/ratioComm + totalSaleFeeAll)*saleRate*(K.vatIn6/(1+K.vatIn6)) : 0;
    const inVat9 = (p.saleConstructionCost + p.saleInfraCost + p.constructionCost + p.infraCost)*saleRate*(K.vatSale/(1+K.vatSale));
    const inVat = inVat6+inVat9;
    cumOut += outVat; cumIn += inVat;
    const vat = Math.max(cumOut - cumIn - cumVat, 0);
    cumVat += vat;
    const vatSur = vat*K.surcharge;
    const stamp = saleInc*K.stampSaleRate/(1+K.vatSale);
    const saleTax = vat + vatSur + stamp;
    const devSale = devCostSaleBase*saleRate;
    const devDep = (y===opStart)? devCostDepBase : 0;
    let devDep2 = 0;
    if(isOp[y]){
      const no = opArr.indexOf(y)+1;
      if(no<=K.depYears) devDep2 = devCostDepBase/K.depYears;
    }
    const finB = isOp[y]?0:finCost[y];
    const finO = isOp[y]?finCost[y]:0;
    const total = devSale + devDep + saleFee + saleTax + finB + finO;
    cost[y] = {devSale:r4(devSale), devDep:r4(devDep), devDep2:r4(devDep2), saleFee:r4(saleFee),
      saleTax:r4(saleTax), vat:r4(vat), outVat:r4(outVat), inVat:r4(inVat),
      landDeduct:r4(landDeductTotal*saleRate), vatSur:r4(vatSur),
      finBuild:r4(finB), finOp:r4(finO), total:r4(total)};
  });

  // ===== 5. 损益（出售类：利润总额=收入-成本，不扣税金；五年弥补亏损） =====
  const profit={};
  let lossHist=[], firstProfitYear=null, lastNeg=0, lossUsed=0;
  allYears.forEach((y,idx)=>{
    const pt = r4(income[y].total - cost[y].total);
    lossHist.push(pt);
    if(firstProfitYear===null && pt>0) firstProfitYear=y;
    let makeup=0;
    if(firstProfitYear!==null){
      if(lossUsed>=K.lossCarry) makeup=0;
      else if(y===firstProfitYear) makeup=lossHist.slice(Math.max(0,idx-K.lossCarry),idx).reduce((s,v)=>s+v,0);
      else makeup = lastNeg<0? lastNeg:0;
    }
    const taxable=pt+makeup;
    if(firstProfitYear!==null && makeup!==0) lossUsed++;
    lastNeg = taxable<0? taxable:0;
    const incomeTax = taxable>0? r4(taxable*K.incomeTax):0;
    profit[y]={total:pt, makeup:r4(makeup), taxable:r4(taxable), incomeTax, net:r4(pt-incomeTax)};
  });

  // ===== 6. 现金流（出售类专属口径） =====
  // 流入=配保房销售+其他收入+商业出租收入+回收固定资产余值(运营首年)
  const recoverFixed = r4((p.landCost + p.devCost - buildFinTotal*ratioComm)*K.recoverRatio);
  // 开发成本投资计划(默认建设期平摊总投资)
  const devPlan = p.devCostPlan || (function(){ const o={}; buildArr.forEach(y=>o[y]=p.totalInvestment/buildArr.length); return o; })();
  const discount=p.discountPct/100;
  const cf={};
  let cum=0;
  allYears.forEach(y=>{
    const inflow = r4(income[y].sale + income[y].other + (rental[y]?rental[y].income:0) + (y===opStart?recoverFixed:0));
    const rentTax = rental[y]? rental[y].taxTotal:0;
    const rentCost = rental[y]? rental[y].costTotal:0;
    const adjTax = Math.max((inflow - (y===opStart?recoverFixed:0)
      - (cost[y].devSale + cost[y].devDep2 + cost[y].saleFee + cost[y].saleTax + rentCost + rentTax))*K.adjTaxRate, 0);
    const invest = devPlan[y]||0;
    const outflow = r4(invest + cost[y].saleFee + cost[y].saleTax + rentTax + rentCost + adjTax);
    const net = r4(inflow-outflow);
    cum += net;
    cf[y]={inflow, invest:r4(invest), saleFee:cost[y].saleFee, saleTax:cost[y].saleTax,
      rentTax:r4(rentTax), rentCost:r4(rentCost), adjTax:r4(adjTax),
      recover:(y===opStart?recoverFixed:0), outflow, net, cumNet:r4(cum)};
  });
  // NPV：从首个非零现金流年记0期
  const nonzero = allYears.filter(y=>Math.abs(cf[y].net)>1e-9);
  const firstIdx = nonzero.length? allYears.indexOf(nonzero[0]) : 0;
  let cumNpv=0;
  allYears.forEach((y,idx)=>{
    const period = idx - firstIdx;
    const factor = period<0? 1.0 : Math.pow(1+discount, period);
    const npv = cf[y].net/factor;
    cumNpv += npv;
    cf[y].npv = r4(npv); cf[y].cumNpv = r4(cumNpv);
  });

  // ===== 7. IRR + 出售类利息保障倍数 =====
  const irr = excelIrr(allYears.map(y=>cf[y].net));
  const sum=f=>allYears.reduce((s,y)=>s+f(y),0);
  const oF = sum(y=>cost[y].finOp), bF = sum(y=>cost[y].finBuild);
  const icrNum = sum(y=>profit[y].net) + oF + sum(y=>profit[y].incomeTax) + sum(y=>cost[y].devDep) - K.devDepRatio*sum(y=>income[y].other);
  const icr = (bF+oF)!==0? r2(icrNum/(bF+oF)) : 0;
  let payback=null;
  for(let i=0;i<allYears.length;i++){ if(cf[allYears[i]].cumNet>=0){ payback={year:allYears[i], index:i+1}; break; } }

  return { allYears, opArr, income, rental, rentalPvTotal, cost, loan, profit, cf, recoverFixed,
    summary:{
      totalIncome: r2(sum(y=>income[y].total)),
      totalCost: r2(sum(y=>cost[y].total)),
      totalSaleIncome: r2(totalSaleIncomeAll),
      rentalPvTotal: r2(rentalPvTotal),
      totalNetProfit: r2(sum(y=>profit[y].net)),
      totalNpv: r2(cumNpv),
      irr: irr!==null? r2(irr*100):null,
      icr, payback,
    }};
}
function npvAt(r,fl){ let s=0; fl.forEach((f,i)=>{ s+=f/Math.pow(1+r,i); }); return s; }
function excelIrr(fl,maxIter=1000,tol=1e-7){
  if(!fl.some(f=>f>0)||!fl.some(f=>f<0)) return null;
  for(const g of [-0.01,-0.02,-0.03,-0.04,-0.05,0.0,0.1]){
    let r=g;
    for(let i=0;i<maxIter;i++){
      const v=npvAt(r,fl);
      if(Math.abs(v)<tol && r>=-0.5 && r<=0.5) return r;
      const h=1e-8, d=(npvAt(r+h,fl)-v)/h;
      if(Math.abs(d)<1e-12) break;
      let nr=Math.max(-0.5,Math.min(r-v/d,0.5));
      if(Math.abs(nr-r)<tol){ if(nr>=-0.5&&nr<=0.5) return nr; break; }
      r=nr;
    }
  }
  return null;
}
return { calc, defaults: SALE_DEFAULTS };
})();
