// 出租类(公租房/保租房)财务测算引擎 —— 1:1 翻译自 calculator3.py
window.RentCalc = (function(){
const RENT_DEFAULTS = {
  mgHouseUnit: 1.92,     // 管理费(住房) 元/㎡/月系数
  mgParkRatio: 0.4,      // 管理费(车位)=车位收入×此比率
  insPerSqm: 0.3,        // 保险费 元/㎡(总建面,年)
  repairRate: 0.02,      // 维修费=住宅租金收入×此比率
  fundPerSqm: 0.25,      // 维修基金 元/㎡/月
  vacPerSqm: 3.9,        // 空置物业费 元/㎡/月
  resetRatio: 0.7,       // 装修重置=装修造价×此比率
  resetPublic: 20,       // 公租房重置周期(年)
  resetAffordable: 10,   // 保租房重置周期(年)
  resetSpread: 10,       // 重置费分摊年数
  depResidual: 0.2,      // 折旧残值率
  depYears: 50,          // 折旧年限
  vatResi: 0.015,        // 住宅租金增值税率(简易)
  vatResiBase: 0.05,     // 住宅价税分离基数(5%)
  vatPark: 0.09,         // 车位增值税率
  stampRate: 0.0005,     // 印花税率
  citySur: 0.07,         // 城建附加
  eduSur: 0.05,          // 教育附加
  propResi: 0.04,        // 房产税-住宅从租
  propPark: 0.12,        // 房产税-车位从租
  propBase: 0.7,         // 房产税从价基数比率
  propRate: 0.012,       // 房产税从价税率
  propFreeYears: 3,      // 房产税免征年数
  landTaxPerSqm: 3,      // 土地使用税 元/㎡
  incomeTax: 0.25,       // 所得税率
  lossCarry: 5,          // 亏损弥补年限
};

function r4(x){ return Math.round(x*10000)/10000; }

/** p: buildStart, buildYears, operateYears, firstMonths,
 *  area, rent, rentSpan, rentRate, rampOcc, stableOcc,
 *  parkCount, parkPrice, parkRatio, parkRampOcc, parkStableOcc,
 *  otherName, otherTotal,
 *  totalBuildArea, manageCoeff, decorationCost(万元), houseType("公租房"|"保租房"),
 *  totalInvestment(万元,折旧基数), landArea(㎡), constructionCost(万元,建安),
 *  loanAmount, loanRate(%), firstRepayRatio(%), repayIncreaseRate(%), loanTotalYears,
 *  investPlan {年:万元} 建设投资计划, discountPct
 */
function calc(p, cfgIn){
  const K = Object.assign({}, RENT_DEFAULTS, cfgIn||{});
  const buildYearsArr = Array.from({length:p.buildYears},(_,i)=>p.buildStart+i);
  const opStart = p.buildStart + p.buildYears;
  const operateArr = Array.from({length:p.operateYears},(_,i)=>opStart+i);
  const allYears = [...buildYearsArr, ...operateArr];
  const isOp = {}; allYears.forEach(y=>isOp[y]=y>=opStart);
  const monthD = {}; allYears.forEach(y=>monthD[y]= isOp[y] ? (y===opStart? (p.firstMonths||12):12) : 12);

  // ===== 1. 收入（住宅+车位+其他） =====
  const resiOcc={}, resiRent={}, parkOcc={};
  operateArr.forEach((y,idx)=>{
    resiOcc[y] = (y===opStart)? p.rampOcc : p.stableOcc;
    parkOcc[y] = (y===opStart)? (p.parkRampOcc!=null?p.parkRampOcc:p.rampOcc) : (p.parkStableOcc!=null?p.parkStableOcc:p.stableOcc);
    resiRent[y] = p.rent * Math.pow(1+p.rentRate/100, Math.floor(idx/p.rentSpan));
  });
  const income = {};
  allYears.forEach(y=>{
    if(!isOp[y]){ income[y]={resi:0, park:0, other:0, total:0}; return; }
    const m=monthD[y];
    const resi = r4(p.area * resiRent[y] * resiOcc[y] * m / 10000);
    const park = r4(p.parkCount * p.parkPrice * parkOcc[y] * m * p.parkRatio / 10000);
    const other = (y===opStart)? r4(p.otherTotal||0) : 0;
    income[y]={resi, park, other, total:r4(resi+park+other)};
  });

  // ===== 2. 经营成本（8项） =====
  const opIndex={}; operateArr.forEach((y,i)=>opIndex[y]=i+1);
  const maxOpNum = operateArr.length;
  const singleReset = p.decorationCost * K.resetRatio;
  const resetPeriod = p.houseType==="公租房"? K.resetPublic : K.resetAffordable;
  const resetDict={}; operateArr.forEach(y=>resetDict[y]=0);
  for(let rn=resetPeriod; rn<=maxOpNum; rn+=resetPeriod){
    const end = Math.min(rn+K.resetSpread-1, maxOpNum);
    const share = singleReset / (end-rn+1);
    operateArr.forEach(y=>{ const n=opIndex[y]; if(n>=rn && n<=end) resetDict[y]+=share; });
  }
  const cost = {};
  allYears.forEach(y=>{
    if(!isOp[y]){ cost[y]={mgH:0,mgP:0,ins:0,rep:0,fund:0,vac:0,reset:0,dep:0,operating:0}; return; }
    const occ=resiOcc[y]||0, m=monthD[y], rent=resiRent[y]||0, parkInc=income[y].park;
    const mgH = p.area*occ*12*K.mgHouseUnit*p.manageCoeff/10000;
    const mgP = parkInc*K.mgParkRatio;
    const ins = p.totalBuildArea*K.insPerSqm/10000;
    const rep = (p.area*rent*occ*m/10000)*K.repairRate;
    const fund = p.area*occ*m*K.fundPerSqm/10000;
    const vac = p.area*(1-occ)*m*K.vacPerSqm/10000;
    const reset = resetDict[y];
    const dep = opIndex[y]<=K.depYears? p.totalInvestment*(1-K.depResidual)/K.depYears : 0;
    cost[y]={mgH:r4(mgH),mgP:r4(mgP),ins:r4(ins),rep:r4(rep),fund:r4(fund),vac:r4(vac),reset:r4(reset),dep:r4(dep),
      operating:r4(mgH+mgP+ins+rep+fund+vac+reset+dep)};
  });

  // ===== 3. 还本付息（迭代） =====
  const loanPlan={}; loanPlan[p.buildStart]=p.loanAmount;
  const totalLoan=p.loanAmount, rate=p.loanRate/100, fr=p.firstRepayRatio/100, ir=p.repayIncreaseRate/100;
  const firstLoanYear=p.buildStart, lastLoanYear=firstLoanYear+p.loanTotalYears-1;
  const repayPlan={};
  {
    let started=false, lastRep=0, stepN=0;
    allYears.forEach(y=>{
      if(y>=opStart && y<=lastLoanYear){
        let rp;
        if(!started){ rp=totalLoan*fr; started=true; }
        else{ stepN++; rp=lastRep*(1+fr*Math.pow(1+ir, stepN)); }
        repayPlan[y]=rp; lastRep=rp;
      }else repayPlan[y]=0;
    });
  }
  const loan={}; const finCost={};
  let endLast=0;
  allYears.forEach(y=>{
    const begin=endLast, cur=loanPlan[y]||0;
    const interest=(begin+cur/2)*rate;
    const payInt=interest;
    const maxRepay=begin+cur+interest-payInt;
    const rp = y<lastLoanYear? Math.min(repayPlan[y]||0, maxRepay) : maxRepay;
    let end=begin+cur+interest-payInt-rp; end=Math.max(end,0);
    loan[y]={begin:r4(begin),borrow:r4(cur),interest:r4(interest),repay:r4(rp),payInt:r4(payInt),total:r4(rp+payInt),end:r4(end)};
    finCost[y]=r4(payInt);
    endLast=end;
  });

  // ===== 4. 税金（六项） =====
  const tax={};
  allYears.forEach(y=>{
    if(!isOp[y]){ tax[y]={vat:0,stamp:0,city:0,edu:0,prop:0,land:0,total:0}; return; }
    const resi=income[y].resi, park=income[y].park, tot=income[y].total;
    const occ=resiOcc[y]||0, m=monthD[y];
    const vat = resi*(K.vatResi/(1+K.vatResiBase)) + park*(K.vatPark/(1+K.vatPark));
    const stamp = tot*(K.stampRate/(1+K.vatPark));
    const city = vat*K.citySur, edu = vat*K.eduSur;
    let prop=0;
    if(opIndex[y]>K.propFreeYears){
      prop = resi*occ*(K.propResi/(1+K.vatResiBase)) + park*(K.propPark/(1+K.vatPark)) + (p.constructionCost*K.propBase*K.propRate/(1+K.vatPark))*(1-occ)*(m/12);
    }
    const land = p.landArea*K.landTaxPerSqm/10000;
    tax[y]={vat:r4(vat),stamp:r4(stamp),city:r4(city),edu:r4(edu),prop:r4(prop),land:r4(land),
      total:r4(vat+stamp+city+edu+prop+land)};
  });

  // ===== 5. 总成本（经营成本+运营期财务费用，不含税金、不含建设期财务费用） =====
  const totalCost={};
  allYears.forEach(y=>{
    const finB = isOp[y]?0:(finCost[y]||0);
    const finO = isOp[y]?(finCost[y]||0):0;
    totalCost[y]={finBuild:r4(finB), finOp:r4(finO), total:r4(cost[y].operating+finO)};
  });

  // ===== 6. 损益（五年弥补亏损） =====
  const profit={};
  let lossHist=[], firstProfitYear=null, lastNeg=0, lossUsed=0;
  allYears.forEach((y,idx)=>{
    const pt = r4(income[y].total - totalCost[y].total - tax[y].total);
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

  // ===== 7. 现金流（流出=建设投资+税金+6项现金成本+所得税；不含折旧/财务费用） =====
  const discount=p.discountPct/100;
  const cf={}; let cum=0, cumNpv=0;
  allYears.forEach((y,idx)=>{
    const inflow=income[y].total;
    const invest=(p.investPlan&&p.investPlan[y])||0;
    const c=cost[y];
    const outflow=r4(invest + tax[y].total + c.mgH+c.mgP + c.vac + c.rep + c.ins + c.reset + c.fund + profit[y].incomeTax);
    const net=r4(inflow-outflow);
    cum+=net;
    const npv=net/Math.pow(1+discount, idx+0.5);
    cumNpv+=npv;
    cf[y]={inflow:r4(inflow), invest:r4(invest), outflow, net, cumNet:r4(cum), npv:r4(npv), cumNpv:r4(cumNpv)};
  });

  // ===== 8. IRR + 利息保障倍数 =====
  const cfList=allYears.map(y=>cf[y].net);
  const irr=excelIrr(cfList);
  const loanYears=allYears.filter(y=>y>=firstLoanYear&&y<=lastLoanYear);
  const bF=allYears.reduce((s,y)=>s+totalCost[y].finBuild,0);
  const oF=allYears.reduce((s,y)=>s+totalCost[y].finOp,0);
  const loanProfit=loanYears.reduce((s,y)=>s+profit[y].total,0);
  const icr=(bF+oF)!==0? Math.round((loanProfit+oF)/(bF+oF)*100)/100 : 0;

  const sum=f=>allYears.reduce((s,y)=>s+f(y),0);
  let payback=null;
  for(let i=0;i<allYears.length;i++){ if(cf[allYears[i]].cumNet>=0){ payback={year:allYears[i], index:i+1}; break; } }

  return { allYears, operateArr, income, cost, loan, tax, totalCost, profit, cf, resiOcc, resiRent,
    summary:{
      totalIncome: Math.round(sum(y=>income[y].total)*100)/100,
      totalCost: Math.round(sum(y=>totalCost[y].total)*100)/100,
      totalTax: Math.round(sum(y=>tax[y].total)*100)/100,
      totalNetProfit: Math.round(sum(y=>profit[y].net)*100)/100,
      totalInterest: Math.round(sum(y=>loan[y].payInt)*100)/100,
      totalNpv: Math.round(cumNpv*100)/100,
      irr: irr!==null? Math.round(irr*10000)/100 : null,
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
return { calc };
})();
