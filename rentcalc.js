// 出租类(公租房/保租房)财务测算引擎 —— 1:1 翻译自 calculator3.py
window.RentCalc = (function(){
const RENT_DEFAULTS = {
  mgHouseUnit: 1.92,     // 管理费(住房) 元/㎡/月系数
  mgParkRatio: 0.4,      // 管理费(车位)=车位收入×此比率
  insPerSqm: 0.3,        // 保险费 元/㎡(总建面,年)——公司《编制与审查指引》写的是"重置价格×0.1%"，
                          // 但本项目确认实际就是按总建面这个口径算，不跟着改，维持原样
  repairRate: 0.02,      // 维修费=住宅租金收入×此比率
  fundPerSqm: 0.25,      // 维修基金 元/㎡/月
  vacPerSqm: 3.9,        // 空置物业费 元/㎡/月
  resetRatio: 0.7,       // 装修重置=装修造价×此比率
  resetPublic: 20,       // 公租房重置周期(年)
  resetAffordable: 10,   // 保租房重置周期(年)
  resetSpread: 1,        // 重置费分摊年数（1=重置当年一次性计入，与Excel口径一致）
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

/** 五年弥补亏损通用序列：ptByYear为逐年"利润总额"输入，返回逐年{total,makeup,taxable,incomeTax,net}。
 *  提取成公用函数是因为损益表(六)和调整损益表(八)要各自独立跑一遍五年弥补亏损规则——
 *  两张表的利润总额基数不同(是否扣运营期财务费用)，弥补亏损、应纳税所得额、所得税因此也各自独立。 */
function profitSeries(allYears, ptByYear, lossCarry, incomeTaxRate){
  const result={};
  let lossHist=[], firstProfitYear=null, lastNeg=0, lossUsed=0;
  allYears.forEach((y,idx)=>{
    const pt = ptByYear[y];
    lossHist.push(pt);
    if(firstProfitYear===null && pt>0) firstProfitYear=y;
    let makeup=0;
    if(firstProfitYear!==null){
      if(lossUsed>=lossCarry) makeup=0;
      else if(y===firstProfitYear) makeup=lossHist.slice(Math.max(0,idx-lossCarry),idx).reduce((s,v)=>s+v,0);
      else makeup = lastNeg<0? lastNeg:0;
    }
    const taxable=pt+makeup;
    if(firstProfitYear!==null && makeup!==0) lossUsed++;
    lastNeg = taxable<0? taxable:0;
    const incomeTax = taxable>0? r4(taxable*incomeTaxRate):0;
    result[y]={total:pt, makeup:r4(makeup), taxable:r4(taxable), incomeTax, net:r4(pt-incomeTax)};
  });
  return result;
}

/** 静态/动态投资回收期通用公式（doc九、43.2/43.3）：
 *  从左到右遍历累计序列，找最后一个"≤0"的位置记作第N年(1-based)，取该年累计负值的绝对值，
 *  除以下一年的对比序列值(静态用年度现金流入、动态用当年净现值)得到小数部分，回收期=N+小数部分。 */
function paybackPeriod(allYears, cumByYear, flowByYear){
  let idx=-1;
  for(let i=0;i<allYears.length;i++){ if(cumByYear[allYears[i]]<=0) idx=i; }
  if(idx===-1) return {year:allYears[0], index:0, period:0};      // 首年累计已为正，视为立即回正
  if(idx>=allYears.length-1) return null;                          // 到最后一年仍未转正，全周期未回正
  const N=idx+1;
  const negAbs=Math.abs(cumByYear[allYears[idx]]);
  const nextFlow=flowByYear[allYears[idx+1]];
  if(!(nextFlow>0)) return null;
  return { year:allYears[idx+1], index:N, period: Math.round((N+negAbs/nextFlow)*10000)/10000 };
}

/** p: buildStart, buildYears, operateYears, firstMonths,
 *  area, rent, rentSpan, rentRate, rampOcc, stableOcc,
 *  ── 政府补贴租金收入（Excel「二、政府补贴租金收入」科目；面积填0＝该项目无补贴）──
 *  rentDiscount      住宅租金折扣系数（默认1；若 rent 填的是市场租金，可填0.6）
 *  subsidyArea       补贴部分对应面积㎡，默认0＝不启用
 *  subsidyPrice      补贴单价 元/㎡/月（不填则取 rent）
 *  subsidyDiscount   补贴折扣系数（默认1；如按市场租金×0.3 则填0.3）
 *  subsidyRampOcc    补贴部分爬坡期出租率（不填则取 rampOcc）
 *  subsidyStableOcc  补贴部分稳定期出租率（不填则取 stableOcc）
 *  ── 配套面积与其他收入 ──
 *  areaKindergarten, areaPostOffice, areaPropertyRoom, areaPoliceRoom  各配套面积㎡
 *  postOfficePrice 邮政支局成本回购单价 元/㎡（与 areaPostOffice 同时填写才生效）
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
  /* 计租月数：支持逐年指定（对齐Python原版的 month_dict）。
     monthDict 形如 {2030:12, 2031:6}；未指定的年份走原有规则（运营首年取 firstMonths，其余12）。*/
  const monthD = {}; allYears.forEach(y=>{
    const md = p.monthDict && p.monthDict[y];
    monthD[y] = (md!=null) ? md : (isOp[y] ? (y===opStart? (p.firstMonths||12):12) : 12);
  });
  /* 出租率爬坡：对齐Python原版的 occupancy_ramp_dict。
     occRamp 为数组时表示运营期前N年的逐年出租率（如 [0.7,0.8] 表示两年爬坡，第3年起用稳定值）；
     不传则退化为"首年 rampOcc、其后 stableOcc"的原有两段行为。 */
  const rampOf = (arr, fallbackFirst) =>
    (Array.isArray(arr) && arr.length) ? arr.map(Number) : (fallbackFirst!=null ? [fallbackFirst] : []);
  const resiRampArr = rampOf(p.occRamp, p.rampOcc);
  const parkRampArr = rampOf(p.parkOccRamp, (p.parkRampOcc!=null?p.parkRampOcc:p.rampOcc));

  // ===== 1. 收入（住宅租金 + 政府补贴租金 + 车位 + 其他） =====
  /* 对齐Excel的两个独立收入科目：「一、住宅租金收入」与「二、政府补贴租金收入」，
     两者的面积、单价、出租率均独立设定（补贴部分出租率常单独取值，如75%），
     不能用一个平均出租率替代。
     subsidyArea 为0（默认）时，补贴科目不产生任何影响，结果与改造前完全一致。 */
  const tierDefs = [
    { area: p.area||0,      price: (p.rent||0)*(p.rentDiscount!=null?p.rentDiscount:1),
      ramp: p.rampOcc,      stable: p.stableOcc },
    { area: p.subsidyArea||0, price: ((p.subsidyPrice!=null?p.subsidyPrice:p.rent)||0)*(p.subsidyDiscount!=null?p.subsidyDiscount:1),
      ramp: (p.subsidyRampOcc!=null?p.subsidyRampOcc:p.rampOcc),
      stable:(p.subsidyStableOcc!=null?p.subsidyStableOcc:p.stableOcc) },
  ];
  const totalResiArea = tierDefs.reduce((s,t)=>s+t.area, 0);

  const resiOcc={}, resiRent={}, parkOcc={}, resiTier={};
  // 按年聚合量：面积×出租率、面积×空置率、收入×出租率（房产税从租用）
  const areaOcc={}, areaVac={}, incomeOcc={};
  operateArr.forEach((y,idx)=>{
    const grow = Math.pow(1+p.rentRate/100, Math.floor(idx/p.rentSpan));
    const rows = tierDefs.map(t=>{
      // 爬坡期按逐年数组取值，超出爬坡年数后用稳定期出租率
      const occ = (idx < resiRampArr.length) ? resiRampArr[idx] : t.stable;
      return { area:t.area, occ:(occ||0), price:t.price*grow };
    });
    resiTier[y]=rows;
    // 车位出租率独立爬坡（Python原版即为独立字典，不跟随住宅）
    parkOcc[y] = (idx < parkRampArr.length) ? parkRampArr[idx]
               : (p.parkStableOcc!=null? p.parkStableOcc : p.stableOcc);
    // 对外仍暴露第一档的出租率与单价，保持既有报表与调用方兼容
    resiOcc[y]  = rows[0].occ;
    resiRent[y] = rows[0].price;
    areaOcc[y] = rows.reduce((s,t)=>s+t.area*t.occ, 0);
    areaVac[y] = rows.reduce((s,t)=>s+t.area*(1-t.occ), 0);
  });

  const income = {};
  allYears.forEach(y=>{
    if(!isOp[y]){ income[y]={resi:0, resiTiers:[], park:0, other:0, total:0}; areaOcc[y]=0; areaVac[y]=0; incomeOcc[y]=0; return; }
    const m=monthD[y];
    const tiers = resiTier[y].map(t=>r4(t.area * t.price * t.occ * m / 10000));
    const resi = r4(tiers.reduce((s,v)=>s+v, 0));
    incomeOcc[y] = resiTier[y].reduce((s,t,i)=> s + tiers[i]*t.occ, 0);   // Σ(各档租金×该档出租率)
    const park = r4(p.parkCount * p.parkPrice * parkOcc[y] * m * p.parkRatio / 10000);
    // 邮政支局成本回购收入：与既有 otherTotal 一并计入运营期首年
    const postInc = (p.areaPostOffice && p.postOfficePrice)
      ? r4(p.areaPostOffice * p.postOfficePrice / 10000) : 0;
    const other = (y===opStart)? r4((p.otherTotal||0) + postInc) : 0;
    income[y]={resi, resiTiers:tiers, park, other, total:r4(resi+park+other)};
  });

  // ===== 2. 经营成本（8项） =====
  const opIndex={}; operateArr.forEach((y,i)=>opIndex[y]=i+1);
  const maxOpNum = operateArr.length;
  const singleReset = p.decorationCost * K.resetRatio;
  const resetPeriod = p.houseType==="公租房"? K.resetPublic : K.resetAffordable;
  const resetDict={}; operateArr.forEach(y=>resetDict[y]=0);
  /* 装修重置：resetSpread<=1 表示重置年一次性计入（与Excel口径一致）；
     >1 则按该年数分摊。默认改为一次性，因实测Excel是在重置当年整笔计入。 */
  const spread = Math.max(1, K.resetSpread||1);
  for(let rn=resetPeriod; rn<=maxOpNum; rn+=resetPeriod){
    const end = Math.min(rn+spread-1, maxOpNum);
    const share = singleReset / (end-rn+1);
    operateArr.forEach(y=>{ const n=opIndex[y]; if(n>=rn && n<=end) resetDict[y]+=share; });
  }
  const cost = {};
  allYears.forEach(y=>{
    if(!isOp[y]){ cost[y]={mgH:0,mgP:0,ins:0,rep:0,fund:0,vac:0,reset:0,dep:0,operating:0}; return; }
    const m=monthD[y], parkInc=income[y].park;
    // 以下各项按"各档面积×该档出租率"聚合，单档时与原实现完全等价
    const aOcc=areaOcc[y]||0, aVac=areaVac[y]||0;
    const mgH = aOcc*12*K.mgHouseUnit*p.manageCoeff/10000;
    const mgP = parkInc*K.mgParkRatio;
    const ins = p.totalBuildArea*K.insPerSqm/10000;
    const rep = income[y].resi*K.repairRate;          // 维修费=住宅租金收入×2%
    const fund = aOcc*m*K.fundPerSqm/10000;
    // 空置物业服务费按当年出租率分档打折：出租率≤50%按88折，50%~85%按98折，≥85%按全额计收
    // （公司《编制与审查指引》标准，此前只实现了"空置面积×单价"这一层，没有按出租率打折这一层）
    const occRate = (aOcc+aVac)>0? aOcc/(aOcc+aVac) : 0;
    const vacDiscount = occRate<=0.5? 0.88 : occRate<0.85? 0.98 : 1;
    const vac = aVac*m*K.vacPerSqm/10000*vacDiscount;
    const reset = resetDict[y];
    const dep = opIndex[y]<=K.depYears? p.totalInvestment*(1-K.depResidual)/K.depYears : 0;
    cost[y]={mgH:r4(mgH),mgP:r4(mgP),ins:r4(ins),rep:r4(rep),fund:r4(fund),vac:r4(vac),reset:r4(reset),dep:r4(dep),
      operating:r4(mgH+mgP+ins+rep+fund+vac+reset+dep)};
  });

  // ===== 3. 还本付息（迭代） =====
  /* 借款分年投放：对齐Python原版的 loan_plan_dict。
     loanPlan 形如 {2025:6440.51, 2026:6255.48,...}；不传则退回"全额一次性计入建设期首年"。
     这一项对利息影响很大——一次性投放会让计息基数从第一年起就是满额，利息明显偏高。 */
  const loanPlan={};
  if(p.loanPlan && typeof p.loanPlan==="object" && Object.keys(p.loanPlan).length){
    Object.keys(p.loanPlan).forEach(k=>{ const v=Number(p.loanPlan[k])||0; if(v) loanPlan[Number(k)]=v; });
  }else{
    loanPlan[p.buildStart]=p.loanAmount;
  }
  const totalLoan=Object.values(loanPlan).reduce((s,v)=>s+v,0) || p.loanAmount;
  const rate=p.loanRate/100, fr=p.firstRepayRatio/100, ir=p.repayIncreaseRate/100;
  const loanYearsKeys=Object.keys(loanPlan).map(Number).sort((a,b)=>a-b);
  const firstLoanYear=loanYearsKeys.length? loanYearsKeys[0] : p.buildStart;
  const lastLoanYear=firstLoanYear+p.loanTotalYears-1;
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
    const m=monthD[y];
    // 空置率按各档面积加权，避免多档时用单档出租率导致从价房产税失真
    const vacRatio = totalResiArea>0 ? (areaVac[y]||0)/totalResiArea : 0;
    const vat = resi*(K.vatResi/(1+K.vatResiBase)) + park*(K.vatPark/(1+K.vatPark));
    const stamp = tot*(K.stampRate/(1+K.vatPark));
    const city = vat*K.citySur, edu = vat*K.eduSur;
    let prop=0;
    if(opIndex[y]>K.propFreeYears){
      // 从租部分按"各档租金×该档出租率"求和；从价部分按加权空置率
      prop = (incomeOcc[y]||0)*(K.propResi/(1+K.vatResiBase)) + park*(K.propPark/(1+K.vatPark))
           + (p.constructionCost*K.propBase*K.propRate/(1+K.vatPark))*vacRatio*(m/12);
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
  const ptMain={}; allYears.forEach(y=>{ ptMain[y]=r4(income[y].total - totalCost[y].total - tax[y].total); });
  const profit = profitSeries(allYears, ptMain, K.lossCarry, K.incomeTax);

  // ===== 6b. 调整损益表（八、全投资口径：总成本费用不含任何财务费用，含建设期与经营期）=====
  /* cost[y].operating 本就不含财务费用（建设期计息进总投资、经营期计息单独放totalCost.finOp），
     所以"调整总成本费用"直接等于 cost[y].operating，不需要另算。
     但弥补亏损/应纳税所得额/所得税必须在这套"调整利润总额"上独立跑一遍五年规则——
     两张表哪年盈利、哪年亏损可能不是同一年，不能共用同一套弥补亏损状态。 */
  const ptAdj={}; allYears.forEach(y=>{ ptAdj[y]=r4(income[y].total - cost[y].operating - tax[y].total); });
  const profitAdj = profitSeries(allYears, ptAdj, K.lossCarry, K.incomeTax);

  // ===== 6c. 资金来源与运用（五）=====
  /* 自有资金：引擎未建模独立的资本金投入计划，筹资活动现金来源目前仅计入银行借款；
     余值回收：出租类项目长期持有运营，不设定期末资产处置，固定为0。 */
  const funds={};
  allYears.forEach(y=>{
    const c=cost[y];
    const opSource = income[y].total;
    const financeSource = loan[y].borrow;
    const recover = 0;
    const source = r4(opSource + financeSource + recover);
    const use = r4((p.investPlan&&p.investPlan[y]||0) + tax[y].total + c.mgH+c.mgP+c.ins+c.rep+c.fund+c.vac+c.reset
      + profit[y].incomeTax + loan[y].repay + loan[y].payInt);
    funds[y]={opSource:r4(opSource), financeSource:r4(financeSource), recover:r4(recover), source,
      use, surplus:r4(source-use)};
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

  // ===== 10. 资本金现金流量表 =====
  /* (一)现金流入、(三)净现金流量、(四)累计净现金流量、(五)净现值、(六)累计净现值：doc明确"同全投资现金流量表"，
     即计算方法与九完全一致，只是(二)现金流出多算了本期还款/本期付息——两张表数值因此不同，方法相同。
     "总投资"沿用与九、38"建设投资"相同的按年度投资计划取值口径（现金流量表逐年展开，不会把总投资一次性计入单一年份）。 */
  const capitalCf={}; let cumCap=0, cumNpvCap=0;
  const discount2=p.discountPct/100;
  allYears.forEach((y,idx)=>{
    const inflow=income[y].total;
    const invest=(p.investPlan&&p.investPlan[y])||0;
    const c=cost[y];
    const outflow=r4(invest + loan[y].repay + loan[y].payInt + tax[y].total
      + c.mgH+c.mgP+c.ins+c.rep+c.fund+c.vac+c.reset + profit[y].incomeTax);
    const net=r4(inflow-outflow);
    cumCap+=net;
    const npv=net/Math.pow(1+discount2, idx+0.5);
    cumNpvCap+=npv;
    capitalCf[y]={inflow:r4(inflow), invest:r4(invest), outflow, net, cumNet:r4(cumCap), npv:r4(npv), cumNpv:r4(cumNpvCap)};
  });

  // ===== 9. IRR + 利息保障倍数 =====
  const cfList=allYears.map(y=>cf[y].net);
  const irr=excelIrr(cfList);
  const loanYears=allYears.filter(y=>y>=firstLoanYear&&y<=lastLoanYear);
  const bF=allYears.reduce((s,y)=>s+totalCost[y].finBuild,0);
  const oF=allYears.reduce((s,y)=>s+totalCost[y].finOp,0);
  const loanProfit=loanYears.reduce((s,y)=>s+profit[y].total,0);
  const icr=(bF+oF)!==0? Math.round((loanProfit+oF)/(bF+oF)*100)/100 : 0;

  const sum=f=>allYears.reduce((s,y)=>s+f(y),0);
  const seriesOf=(obj,key)=>{ const o={}; allYears.forEach(y=>o[y]=obj[y][key]); return o; };
  // 43.2/43.3：全投资现金流量表口径
  const payback = paybackPeriod(allYears, seriesOf(cf,"cumNet"), seriesOf(cf,"inflow"));
  const paybackDynamic = paybackPeriod(allYears, seriesOf(cf,"cumNpv"), seriesOf(cf,"npv"));
  // 45.1-45.3：资本金现金流量表口径（doc标注"同全投资现金流量表"，指计算方法相同，基于本表自身序列另算）
  const capitalIrrRaw = excelIrr(allYears.map(y=>capitalCf[y].net));
  const capitalPayback = paybackPeriod(allYears, seriesOf(capitalCf,"cumNet"), seriesOf(capitalCf,"inflow"));
  const capitalPaybackDynamic = paybackPeriod(allYears, seriesOf(capitalCf,"cumNpv"), seriesOf(capitalCf,"npv"));

  const totalIncomeSum = sum(y=>income[y].total);
  const totalProfitSum = sum(y=>profit[y].total);
  const totalNetProfitSum = sum(y=>profit[y].net);
  const totalProfitAdjSum = sum(y=>profitAdj[y].total);
  const totalNetProfitAdjSum = sum(y=>profitAdj[y].net);
  // 六、32 与 八、36 的四个核心指标：投资回报率=利润总额/总投资；净投资回报率=净利润/总投资；经营收入利润率=利润总额/总经营收入
  const ratioOf=(num,den)=> den? Math.round(num/den*10000)/10000 : null;

  return { allYears, operateArr, income, cost, loan, tax, totalCost, profit, profitAdj, funds, cf, capitalCf, resiOcc, resiRent,
    summary:{
      totalIncome: Math.round(totalIncomeSum*100)/100,
      totalCost: Math.round(sum(y=>totalCost[y].total)*100)/100,
      totalTax: Math.round(sum(y=>tax[y].total)*100)/100,
      totalNetProfit: Math.round(totalNetProfitSum*100)/100,
      totalInterest: Math.round(sum(y=>loan[y].payInt)*100)/100,
      totalNpv: Math.round(cumNpv*100)/100,
      irr: irr!==null? Math.round(irr*10000)/100 : null,
      icr, payback, paybackDynamic,
      investReturnRate: ratioOf(totalProfitSum, p.totalInvestment),
      netInvestReturnRate: ratioOf(totalNetProfitSum, p.totalInvestment),
      opProfitMargin: ratioOf(totalProfitSum, totalIncomeSum),
      totalProfitAdj: Math.round(totalProfitAdjSum*100)/100,
      totalNetProfitAdj: Math.round(totalNetProfitAdjSum*100)/100,
      investReturnRateAdj: ratioOf(totalProfitAdjSum, p.totalInvestment),
      netInvestReturnRateAdj: ratioOf(totalNetProfitAdjSum, p.totalInvestment),
      opProfitMarginAdj: ratioOf(totalProfitAdjSum, totalIncomeSum),
      capitalIrr: capitalIrrRaw!==null? Math.round(capitalIrrRaw*10000)/100 : null,
      capitalPayback, capitalPaybackDynamic,
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
return { calc, defaults: RENT_DEFAULTS };
})();