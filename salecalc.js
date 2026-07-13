// 出售类(配保房/可售型人才房等)财务测算引擎 —— 1:1 翻译自 calculator3.py 出售类逻辑
// 覆盖：配保房销售收入 + 商业出租净收益现值 + 住宅/车位/其他收入；出租情况表；
//       还本付息迭代；销售专属总成本费用表（地价抵减增值税模型）；损益（五年弥补亏损）；
//       出售类现金流（回收固定资产余值 + 调整所得税）；IRR / NPV / 利息保障倍数。
window.SaleCalc = (function(){
  function r4(x){ return Math.round(x*10000)/10000; }
  function r2(x){ return Math.round(x*100)/100; }

  /* ============ IRR / NPV 工具（与 rentcalc.js 完全一致口径）============ */
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

  /* ============ 住宅 + 车位 + 其他收入（calc_income 翻译）============ */
  function calcIncome(allYears, monthD, isOp, p, operateArr){
    const resiOcc={}, resiRent={}, parkOcc={}, parkRent={};
    operateArr.forEach(y=>{
      if(p.occupancyRampDict[y]!==undefined) resiOcc[y]=p.occupancyRampDict[y];
      else if(p.stableStart<=y && y<=p.stableEnd) resiOcc[y]=p.occupancyStable;
      else resiOcc[y]=0.0;
      if(p.parkOccupancyRampDict[y]!==undefined) parkOcc[y]=p.parkOccupancyRampDict[y];
      else if(p.parkStableStart<=y && y<=p.parkStableEnd) parkOcc[y]=p.parkStableOcc;
      else parkOcc[y]=0.0;
    });
    // 住宅租金递增（固定跨度）
    operateArr.forEach((y,idx)=>{
      const times=Math.floor(idx/p.rentIncreaseSpan);
      resiRent[y]=p.rentStartPrice*Math.pow(1+p.rentIncreaseRate/100, times);
      parkRent[y]=p.parkRentStartPrice;
    });
    const income={};
    allYears.forEach(y=>{
      if(!isOp[y]){ income[y]={resi:0,park:0,other:0}; return; }
      const m=monthD[y];
      const resi=r4(p.residentialArea*resiRent[y]*resiOcc[y]*m/10000);
      const park=r4(p.parkCount*parkRent[y]*parkOcc[y]*m*p.parkIncomeRatio/10000);
      const other=(y===operateArr[0])? r4(p.otherIncomeTotal||0) : 0;
      income[y]={resi,park,other};
    });
    return {income, resiOcc, resiRent};
  }

  /* ============ 出租情况表（calc_rental_operation_table 翻译）============ */
  function calcRentalOperation(allYears, isOp, operateArr, p){
    const commOcc={}, commRent={};
    // 商业出租率
    operateArr.forEach(y=>{
      if(p.commOccupancyRampDict[y]!==undefined) commOcc[y]=p.commOccupancyRampDict[y];
      else if(p.commStableStart<=y && y<=p.commStableEnd) commOcc[y]=p.commOccupancyStable;
      else commOcc[y]=0.0;
    });
    // 商业租金单价（固定规则，按稳定年冻结）
    const stableStartYear = p.commRentStableStart;
    let lastPriceBeforeStable = p.commRentStartPrice;
    operateArr.forEach((y,idx)=>{
      const times=Math.floor(idx/p.commRentIncreaseSpan);
      let price=p.commRentStartPrice*Math.pow(1+p.commRentIncreaseRate/100, times);
      if(y>=stableStartYear){
        if(y===stableStartYear) lastPriceBeforeStable=price;
        price=lastPriceBeforeStable;
      } else { lastPriceBeforeStable=price; }
      commRent[y]=r4(price);
    });
    // 预循环：全周期进项税基数
    let totalManageIns=0, totalVacancy=0;
    operateArr.forEach(y=>{
      const occ=commOcc[y]||0, cr=commRent[y]||0;
      const commIncome=p.commArea*cr*occ*p.leaseMonths/10000;
      totalManageIns += commIncome*0.08 + (p.commArea*1.86)/10000;
      totalVacancy += (p.commArea*(1-occ)*8*12)/10000;
    });
    const totalInputTaxCalc = totalManageIns*(0.06/1.06) + totalVacancy*(0.09/1.09) + (p.projectInputTax||0);
    let remainingInput = totalInputTaxCalc;

    const rental={};
    const areaSum = p.saleArea + p.commArea;
    allYears.forEach(y=>{
      if(!isOp[y]){
        rental[y]={occ:0,rent:0,income:0,opCost:0,rentTax:0,netIncome:0,pvNet:0};
        return;
      }
      const occ=commOcc[y], cr=commRent[y];
      const commIncome=p.commArea*cr*occ*p.leaseMonths/10000;
      const tax1=commIncome*(0.12/1.09);
      const tax2Base=(areaSum!==0)?(p.landCost+p.constructionCost+p.infraCost+p.otherEngCost + p.constructionCost*0.02*p.commArea/areaSum):0;
      const tax2=tax2Base*0.7*0.012*(1-occ);
      const manageComm=commIncome*0.08;
      const managePark=p.parkCount*80*12/10000;
      const propertyFund=(p.commArea*p.leaseMonths*0.25)/10000;
      const repairFee=commIncome*0.02;
      const vacancyService=(p.commArea*(1-occ)*8*12)/10000;
      const insuranceFee=(p.commArea*1.86)/10000;
      const landTax=(p.landUseArea*(areaSum!==0?p.commArea/areaSum:0)*3)/10000;
      const opCost=tax1+tax2+manageComm+managePark+propertyFund+repairFee+vacancyService+insuranceFee+landTax;
      // 出租经营税金
      const outputTax=commIncome>0? commIncome*(0.09/1.09):0.0;
      const inputBefore=remainingInput;
      const vat=Math.max(outputTax-inputBefore,0.0);
      remainingInput=Math.max(inputBefore-outputTax,0.0);
      const vatSurcharge=vat*0.12;
      const stampTax=commIncome*0.0005;
      const totalRentalTax=vat+vatSurcharge+stampTax;
      const netIncome=r4(commIncome)-r4(opCost)-r4(totalRentalTax);
      const yearIdx=operateArr.indexOf(y)+1;
      const pvNet=netIncome/Math.pow(1.035, yearIdx);
      rental[y]={occ:r4(occ),rent:r4(cr),income:r4(commIncome),opCost:r4(opCost),
        rentTax:r4(totalRentalTax),netIncome:r4(netIncome),pvNet:r4(pvNet)};
    });
    return rental;
  }

  /* ============ 还本付息（calc_loan_repayment 翻译，custom 模式）============ */
  function calcLoan(allYears, opStart, p){
    const rate=p.loanRate/100, fr=p.firstRepayRatio/100, ir=p.repayIncreaseRate/100;
    const loanPlan=p.loanPlanDict||{};
    const totalLoan=Object.values(loanPlan).reduce((s,v)=>s+v,0);
    const loanYearsKeys=Object.keys(loanPlan).map(Number);
    const firstLoanYear=loanYearsKeys.length? Math.min(...loanYearsKeys): allYears[0];
    const lastLoanYear=firstLoanYear+p.loanTotalYears-1;
    // 还本计划
    const repayPlan={};
    const hasCustom = p.repayPlanDict && Object.keys(p.repayPlanDict).length>0;
    if(hasCustom){
      allYears.forEach(y=>{ repayPlan[y]= (y<=lastLoanYear)? (p.repayPlanDict[y]||0.0):0.0; });
    } else {
      let started=false, lastRep=0, stepN=0;
      allYears.forEach(y=>{
        if(y>=opStart && y<=lastLoanYear){
          let rp;
          if(!started){ rp=totalLoan*fr; started=true; }
          else{ stepN++; rp=lastRep*(1+fr*Math.pow(1+ir, stepN)); }
          repayPlan[y]=rp; lastRep=rp;
        } else repayPlan[y]=0.0;
      });
    }
    const loan={}; const finCost={};
    let endLast=0;
    allYears.forEach(y=>{
      const begin=endLast, cur=loanPlan[y]||0.0;
      const interest=(begin+cur/2)*rate;
      const payInt=interest;
      const maxRepay=begin+cur+interest-payInt;
      const rp = y<lastLoanYear? Math.min(repayPlan[y]||0, maxRepay) : maxRepay;
      let end=begin+cur+interest-payInt-rp; end=Math.max(end,0);
      loan[y]={begin:r4(begin),borrow:r4(cur),interest:r4(interest),repay:r4(rp),payInt:r4(payInt),total:r4(rp+payInt),end:r4(end)};
      finCost[y]=r4(payInt);
      endLast=end;
    });
    return {loan, finCost};
  }

  /* ============ 主函数 ============ */
  function calc(p){
    // 默认值兜底
    p.leaseMonths = p.leaseMonths || 12;
    p.firstRepayRatio = (p.firstRepayRatio!=null)? p.firstRepayRatio : 3.0;
    p.repayIncreaseRate = (p.repayIncreaseRate!=null)? p.repayIncreaseRate : 4.5;
    p.stampTaxRate = p.stampTaxRate || 0;
    p.occupancyRampDict = p.occupancyRampDict || {};
    p.parkOccupancyRampDict = p.parkOccupancyRampDict || {};
    p.commOccupancyRampDict = p.commOccupancyRampDict || {};
    p.saleRampDict = p.saleRampDict || {};
    p.loanPlanDict = p.loanPlanDict || {};
    p.repayPlanDict = p.repayPlanDict || {};
    p.devCostPlanDict = p.devCostPlanDict || {};

    // 年份体系
    const buildYearsArr = Array.from({length:p.buildYears},(_,i)=>p.buildStart+i);
    const opStart = p.buildStart + p.buildYears;
    const operateArr = Array.from({length:p.operateYears},(_,i)=>opStart+i);
    const allYears = [...buildYearsArr, ...operateArr];
    const isOp={}; allYears.forEach(y=>isOp[y]=y>=opStart);
    const monthD={}; allYears.forEach(y=>monthD[y]= isOp[y]?12:0);

    // 1. 住宅 + 车位 + 其他收入
    const inc = calcIncome(allYears, monthD, isOp, p, operateArr);
    const baseIncome = inc.income;

    // 2. 出租情况表（商业）
    const rental = calcRentalOperation(allYears, isOp, operateArr, p);
    let rentalPvTotal=0; allYears.forEach(y=>{ rentalPvTotal+=rental[y].pvNet; });
    rentalPvTotal=r4(rentalPvTotal);

    // 3. 配保房销售收入 + 出租净收益现值 + 总收入
    const income={};
    allYears.forEach(y=>{
      const sr=p.saleRampDict[y]||0.0;
      const saleInc = isOp[y]? r4(p.saleArea*p.salePrice*sr/10000) : 0;
      const pvRent = (y===operateArr[0])? rentalPvTotal : 0;
      const b=baseIncome[y];
      const total=r4(saleInc + pvRent + b.resi + b.park + b.other);
      income[y]={sale:saleInc, pvRent:pvRent, resi:b.resi, park:b.park, other:b.other, total:total};
    });

    // 4. 还本付息 → 财务费用
    const loanRes = calcLoan(allYears, opStart, p);
    const finCost=loanRes.finCost;
    const finBuild={}, finOp={};
    allYears.forEach(y=>{ finBuild[y]= isOp[y]?0:r4(finCost[y]||0); finOp[y]= isOp[y]?r4(finCost[y]||0):0; });
    const buildFinTotal = allYears.reduce((s,y)=>s+finBuild[y],0);

    // 5. 销售专属总成本费用表
    const areaTotal=p.saleArea+p.commArea;
    const areaRatioSale = areaTotal!==0? p.saleArea/areaTotal:0.0;
    const areaRatioComm = 1-areaRatioSale;
    const landDeductTotal = p.saleArea*p.landFloorPrice/10000;
    const nonSaleDevCost = p.landCost + p.devCost;
    let totalSaleIncomeAll=0; allYears.forEach(y=>{ totalSaleIncomeAll+=income[y].sale; });
    const totalSaleFeeAll = totalSaleIncomeAll*0.015;
    const totalDevCostSaleBase = p.totalInvestment - buildFinTotal*areaRatioSale - totalSaleIncomeAll*0.015;
    const totalDevCostDepBase = (nonSaleDevCost - buildFinTotal*areaRatioComm)*0.8;

    const saleCost={};
    let cumOutputVat=0, cumInputVat=0, cumVatTotal=0;
    allYears.forEach(y=>{
      const saleIncomeYear=income[y].sale;
      const saleRateYear=p.saleRampDict[y]||0.0;
      const otherIncomeYear=income[y].other;
      const saleFeeYear=saleIncomeYear*0.015;
      const outputVatYear=saleIncomeYear>0? (saleIncomeYear+otherIncomeYear - landDeductTotal*saleRateYear)*(0.09/1.09):0.0;
      const inputVat6=(areaRatioComm!==0)? (p.otherEngCost/areaRatioComm + totalSaleFeeAll)*saleRateYear*(0.06/1.06):0.0;
      const inputVat9=(p.saleConstructionCost + p.saleInfraCost + p.constructionCost + p.infraCost)*saleRateYear*(0.09/1.09);
      const inputVatYear=inputVat6+inputVat9;
      cumOutputVat+=outputVatYear; cumInputVat+=inputVatYear;
      const vatYear=Math.max(cumOutputVat-cumInputVat-cumVatTotal,0.0);
      cumVatTotal+=vatYear;
      const vatSurchargeYear=vatYear*0.12;
      const stampYear=saleIncomeYear>0? saleIncomeYear*p.stampTaxRate/1.09:0.0;
      const saleTaxTotalYear=vatYear+vatSurchargeYear+stampYear;
      const devCostSaleYear=totalDevCostSaleBase*saleRateYear;
      const devCostDepYear=(y===operateArr[0])? totalDevCostDepBase:0.0;
      let devCostDep2Year=0.0;
      if(isOp[y]){ const opNo=operateArr.indexOf(y)+1; if(opNo<=50) devCostDep2Year=totalDevCostDepBase/50; }
      const totalCostYear=devCostSaleYear+devCostDepYear+saleFeeYear+saleTaxTotalYear+finBuild[y]+finOp[y];
      saleCost[y]={
        devSale:r4(devCostSaleYear), devDep:r4(devCostDepYear), devDep2:r4(devCostDep2Year),
        saleFee:r4(saleFeeYear), saleTax:r4(saleTaxTotalYear),
        vat:r4(vatYear), outputVat:r4(outputVatYear), inputVat:r4(inputVatYear), landDeduct:r4(landDeductTotal*saleRateYear),
        vatSurcharge:r4(vatSurchargeYear), finBuild:r4(finBuild[y]), finOp:r4(finOp[y]),
        total:r4(totalCostYear)
      };
    });

    // 6. 损益（五年弥补亏损，出售类利润总额=总收入-总成本，不扣税金及附加）
    const profit={};
    let lossHist=[], firstProfitYear=null, lastNeg=0, lossUsed=0;
    allYears.forEach((y,idx)=>{
      const pt=r4(income[y].total - saleCost[y].total);
      lossHist.push(pt);
      if(firstProfitYear===null && pt>0) firstProfitYear=y;
      let makeup=0;
      if(firstProfitYear!==null){
        if(lossUsed>=5) makeup=0;
        else if(y===firstProfitYear) makeup=lossHist.slice(Math.max(0,idx-5),idx).reduce((s,v)=>s+v,0);
        else makeup=lastNeg<0? lastNeg:0;
      }
      const taxable=pt+makeup;
      if(firstProfitYear!==null && makeup!==0) lossUsed++;
      lastNeg=taxable<0? taxable:0;
      const incomeTax=taxable>0? r4(taxable*0.25):0;
      profit[y]={total:pt, makeup:r4(makeup), taxable:r4(taxable), incomeTax:incomeTax, net:r4(pt-incomeTax)};
    });

    // 7. 出售类现金流
    const commRatio=areaTotal!==0? p.commArea/areaTotal:0;
    const recoverFixed=(p.landCost + p.devCost - buildFinTotal*commRatio)*0.2;
    const devCostBase=areaTotal!==0? p.totalInvestment*(p.saleArea/areaTotal):0.0;
    const discount=p.discountPct/100;
    const cf={};
    allYears.forEach(y=>{
      const recover=(y===operateArr[0])? recoverFixed:0.0;
      const inflow=r4(income[y].sale + income[y].other + rental[y].income + recover);
      const saleFee=saleCost[y].saleFee, saleTax=saleCost[y].saleTax;
      const rentTax=rental[y].rentTax, rentCost=rental[y].opCost;
      const devCostSale=saleCost[y].devSale, devCostDep=saleCost[y].devDep2;
      const devInvest=p.devCostPlanDict[y]||0.0;
      const adjustTax=Math.max((inflow - recover - (devCostSale+devCostDep+saleFee+saleTax+rentCost+rentTax))*0.25, 0.0);
      const outflow=r4(devInvest + saleFee + saleTax + rentTax + rentCost + adjustTax);
      const net=r4(inflow-outflow);
      cf[y]={inflow:inflow, recover:r4(recover), devInvest:r4(devInvest), saleFee:r4(saleFee), saleTax:r4(saleTax),
        rentTax:r4(rentTax), rentCost:r4(rentCost), adjustTax:r4(adjustTax), outflow:outflow, net:net};
    });
    // 累计净现金流
    let cum=0; allYears.forEach(y=>{ cum+=cf[y].net; cf[y].cumNet=r4(cum); });
    // NPV（出售类：首个实际现金流年份记为0期）
    const nonzeroYears=allYears.filter(y=>Math.abs(cf[y].net)>1e-9);
    const firstCfYear=nonzeroYears.length? nonzeroYears[0]: allYears[0];
    const firstCfIdx=allYears.indexOf(firstCfYear);
    let cumNpv=0;
    allYears.forEach((y,idx)=>{
      const salePeriod=idx-firstCfIdx;
      const factor=salePeriod<0? 1.0 : Math.pow(1+discount, salePeriod);
      const npv=cf[y].net/factor;
      cumNpv+=npv;
      cf[y].npv=r4(npv); cf[y].cumNpv=r4(cumNpv);
    });

    // 8. IRR
    const cfList=allYears.map(y=>cf[y].net);
    const irr=excelIrr(cfList);

    // 9. 利息保障倍数（出售类专属公式）
    const netProfitTotal=allYears.reduce((s,y)=>s+profit[y].net,0);
    const operateFinCost=allYears.reduce((s,y)=>s+saleCost[y].finOp,0);
    const buildFinCost=allYears.reduce((s,y)=>s+saleCost[y].finBuild,0);
    const incomeTaxTotal=allYears.reduce((s,y)=>s+profit[y].incomeTax,0);
    const devCostDepTotal=allYears.reduce((s,y)=>s+saleCost[y].devDep,0);
    const otherIncomeTotal=allYears.reduce((s,y)=>s+income[y].other,0);
    const numerator=netProfitTotal+operateFinCost+incomeTaxTotal+devCostDepTotal-0.8*otherIncomeTotal;
    const denominator=buildFinCost+operateFinCost;
    const icr=denominator!==0? Math.round(numerator/denominator*100)/100 : 0;

    // 汇总
    const totalIncome=r2(allYears.reduce((s,y)=>s+income[y].total,0));
    const totalCost=r2(allYears.reduce((s,y)=>s+saleCost[y].total,0));
    const totalNetProfit=r2(netProfitTotal);
    const totalNpv=r2(allYears.reduce((s,y)=>s+cf[y].npv,0));
    const totalInterest=r2(allYears.reduce((s,y)=>s+loanRes.loan[y].payInt,0));
    let payback=null;
    for(let i=0;i<allYears.length;i++){ if(cf[allYears[i]].cumNet>=0){ payback={year:allYears[i], index:i+1}; break; } }

    return {
      allYears, operateArr, income, saleCost, rental, profit, cf, loan:loanRes.loan,
      rentalPvTotal,
      summary:{
        totalIncome, totalCost, totalNetProfit, totalNpv, totalInterest,
        irr: irr!==null? Math.round(irr*10000)/100 : null,
        icr, payback,
        saleIncomeTotal: r2(allYears.reduce((s,y)=>s+income[y].sale,0)),
        rentalPvTotal: r2(rentalPvTotal),
      }
    };
  }

  return { calc };
})();
