// 敏感性分析核心逻辑 —— Node(scripts/sensitivity.js)和浏览器(admin.html「敏感性分析」页)共用同一份代码，
// 保证命令行跑出来的排序和后台页面看到的排序永远一致，不会出现"两处逻辑分叉"。
// 依赖：调用前必须已经加载好 window.NRCalc / window.RentCalc / window.InvestEstimate / window.SaleCalc
//      （Node下用 global.window={} 之后 require 各引擎文件；浏览器下用<script src>顺序加载）。
//
// 提供三种互相独立的敏感性度量方法，可任选1~3个同时跑，自动按"平均名次"合并成一个综合排序：
//   1. sobol    —— 方差分解(Sobol指数，Saltelli抽样估计)，能识别参数间的交互效应，成本最高(N*(K+2)次评估)
//   2. spearman —— Spearman秩相关系数，只看该参数和IRR的单调关系，不管其他参数，成本最低(N次评估，和sobol共用同一批基础样本)
//   3. src      —— 标准化回归系数(多元线性回归)，控制了其他参数后该参数的线性贡献，成本同spearman
// 选1和2/3一起跑时，2/3直接复用sobol抽样时算出的A矩阵结果，不需要额外调用引擎。
(function(root, factory){
  if(typeof module==="object" && module.exports) module.exports = factory();
  else root.SensitivityCore = factory();
})(typeof self!=="undefined"?self:this, function(){
"use strict";

// ===== 通用：拉丁超立方抽样 + 可复现伪随机数 =====
function mulberry32(seed){ return function(){ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function lhsUnit(N, k, rng){
  const M = Array.from({length:N}, ()=>new Array(k));
  for(let j=0;j<k;j++){
    const perm = Array.from({length:N},(_,i)=>i);
    for(let i=N-1;i>0;i--){ const s=Math.floor(rng()*(i+1)); [perm[i],perm[s]]=[perm[s],perm[i]]; }
    for(let i=0;i<N;i++) M[i][j] = (perm[i] + rng()) / N;
  }
  return M;
}

// ===== 方法2：Spearman秩相关系数 =====
function rankArray(arr){
  const idx = arr.map((v,i)=>i).sort((a,b)=>arr[a]-arr[b]);
  const r = new Array(arr.length);
  let i=0;
  while(i<idx.length){
    let j=i;
    while(j+1<idx.length && arr[idx[j+1]]===arr[idx[i]]) j++;
    const avgRank = (i+j)/2 + 1;
    for(let m=i;m<=j;m++) r[idx[m]] = avgRank;
    i = j+1;
  }
  return r;
}
function spearman(xs, ys){
  const n = xs.length;
  if(n<3) return null;
  const rx = rankArray(xs), ry = rankArray(ys);
  const mx = rx.reduce((s,v)=>s+v,0)/n, my = ry.reduce((s,v)=>s+v,0)/n;
  let cov=0, vx=0, vy=0;
  for(let i=0;i<n;i++){ cov += (rx[i]-mx)*(ry[i]-my); vx += (rx[i]-mx)*(rx[i]-mx); vy += (ry[i]-my)*(ry[i]-my); }
  if(vx===0||vy===0) return 0;
  return cov/Math.sqrt(vx*vy);
}

// ===== 方法3：标准化回归系数(SRC，多元线性回归) =====
function standardize(arr){
  const n = arr.length;
  const mean = arr.reduce((s,v)=>s+v,0)/n;
  const sd = Math.sqrt(arr.reduce((s,v)=>s+(v-mean)*(v-mean),0)/n) || 1;
  return arr.map(v=>(v-mean)/sd);
}
function solveLinearSystem(Amat, bvec){
  // 高斯消元(带部分主元)解 Amat·x = bvec；矩阵奇异时对应系数置0，不抛错中断整体分析
  const n = bvec.length;
  const M = Amat.map((row,i)=>row.concat([bvec[i]]));
  for(let col=0; col<n; col++){
    let piv = col;
    for(let r=col+1;r<n;r++) if(Math.abs(M[r][col])>Math.abs(M[piv][col])) piv=r;
    if(Math.abs(M[piv][col])<1e-9) continue;
    const tmp=M[col]; M[col]=M[piv]; M[piv]=tmp;
    for(let r=0;r<n;r++){
      if(r===col) continue;
      const factor = M[r][col]/M[col][col];
      for(let c=col;c<=n;c++) M[r][c] -= factor*M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for(let i=0;i<n;i++) x[i] = Math.abs(M[i][i])>1e-9 ? M[i][n]/M[i][i] : 0;
  return x;
}
function stdRegressionCoeffs(Xmat, yArr){
  const N = Xmat.length, K = Xmat[0].length;
  const Xs = []; for(let j=0;j<K;j++) Xs.push(standardize(Xmat.map(row=>row[j])));
  const ys = standardize(yArr);
  const XtX = Array.from({length:K}, ()=>new Array(K).fill(0));
  const Xty = new Array(K).fill(0);
  for(let i=0;i<K;i++){
    for(let j=0;j<K;j++){ let s=0; for(let r=0;r<N;r++) s += Xs[i][r]*Xs[j][r]; XtX[i][j] = s/N; }
    let sy=0; for(let r=0;r<N;r++) sy += Xs[i][r]*ys[r]; Xty[i] = sy/N;
  }
  return solveLinearSystem(XtX, Xty);
}

function rankByAbsMetric(list){ // list: [{key, metric}] -> {key: rank(1-based，metric绝对值越大排名越靠前)}
  const arr = list.map(v=>({key:v.key, m: v.metric===null||v.metric===undefined? -Infinity : Math.abs(v.metric)}));
  arr.sort((a,b)=>b.m-a.m);
  const out = {}; arr.forEach((v,i)=>{ out[v.key]=i+1; });
  return out;
}

// ===== 出租类(RentCalc) 51维参数空间 =====
const RENT_PARAMS = [
  {k:"buildYears", label:"建设期年数(年)", lo:1, hi:6, group:"期限"},
  {k:"firstMonths", label:"运营首年月数(月)", lo:6, hi:12, group:"期限"},
  {k:"area", label:"住宅面积(㎡)", lo:30000, hi:38000, group:"收入"},
  {k:"rent", label:"起始租金(元/㎡/月)", lo:30, hi:60, group:"收入"},
  {k:"rentSpan", label:"租金递增跨度(年)", lo:2, hi:4, group:"收入"},
  {k:"rentRate", label:"租金递增率(%)", lo:2, hi:8, group:"收入"},
  {k:"rampOcc", label:"首年出租率(填了爬坡数组则不生效)", lo:0.5, hi:0.85, group:"收入"},
  {k:"stableOcc", label:"稳定期出租率", lo:0.8, hi:0.98, group:"收入"},
  {k:"occRamp0", label:"爬坡出租率-第1年", lo:0.5, hi:0.85, group:"收入"},
  {k:"occRamp1", label:"爬坡出租率-第2年", lo:0.6, hi:0.9, group:"收入"},
  {k:"rentDiscount", label:"租金折扣系数", lo:0.8, hi:1.0, group:"收入"},
  {k:"subsidyArea", label:"政府补贴对应面积(㎡)", lo:0, hi:10000, group:"收入"},
  {k:"subsidyPrice", label:"补贴单价(元/㎡/月)", lo:0, hi:30, group:"收入"},
  {k:"subsidyDiscount", label:"补贴折扣系数", lo:0.2, hi:1, group:"收入"},
  {k:"subsidyStableOcc", label:"补贴部分出租率", lo:0, hi:0.9, group:"收入"},
  {k:"parkCount", label:"车位个数", lo:300, hi:500, group:"收入"},
  {k:"parkPrice", label:"车位月租金(元/个)", lo:150, hi:300, group:"收入"},
  {k:"parkRatio", label:"车位收入系数", lo:0.3, hi:0.7, group:"收入"},
  {k:"otherTotal", label:"其他收入(万元)", lo:0, hi:300, group:"收入"},
  {k:"parkOccRamp0", label:"车位爬坡出租率-第1年", lo:0.4, hi:0.8, group:"收入"},
  {k:"parkOccRamp1", label:"车位爬坡出租率-第2年", lo:0.5, hi:0.85, group:"收入"},
  {k:"areaPostOffice", label:"邮政支局面积(㎡)", lo:0, hi:3000, group:"配套"},
  {k:"postOfficePrice", label:"邮政支局回购单价(元/㎡)", lo:0, hi:5000, group:"配套"},
  {k:"areaKindergarten", label:"幼儿园面积(㎡)", lo:0, hi:3000, group:"配套"},
  {k:"areaPropertyRoom", label:"物业服务用房面积(㎡)", lo:1000, hi:6000, group:"配套"},
  {k:"areaPoliceRoom", label:"社区警务室面积(㎡)", lo:0, hi:1000, group:"配套"},
  {k:"manageCoeff", label:"管理系数", lo:0.5, hi:1, group:"成本"},   // 公司标准7档区域系数取值范围是0.5(深汕)~1.0(南山/福田)，原lo:1~hi:5超出真实有效域
  {k:"decorationCost", label:"住宅装修造价(万元)", lo:500, hi:1200, group:"成本"},
  {k:"landArea", label:"用地面积(㎡)", lo:7000, hi:10000, group:"投资"},
  {k:"loanAmount", label:"总借款额(万元)", lo:6000, hi:40000, group:"融资"},
  {k:"loanRate", label:"贷款年利率(%)", lo:2, hi:5, group:"融资"},
  {k:"firstRepayRatio", label:"首次还本比例(%)", lo:1, hi:6, group:"融资"},
  {k:"repayIncreaseRate", label:"还本递增率(%)", lo:2, hi:8, group:"融资"},
  {k:"loanTotalYears", label:"借款总年数", lo:10, hi:25, group:"融资"},
  {k:"discountPct", label:"折现率(%)", lo:2, hi:6, group:"折现"},
  {k:"ie_basementArea", label:"地下室面积(㎡)", lo:15000, hi:28000, group:"投资估算"},
  {k:"ie_commArea", label:"商业面积(㎡)", lo:0, hi:5000, group:"投资估算"},
  {k:"ie_landPriceResi", label:"住宅地价单价(元/㎡)", lo:5000, hi:15000, group:"投资估算"},
  {k:"ie_postOfficeLandPrice", label:"邮政支局地价单价(元/㎡)", lo:0, hi:8000, group:"投资估算"},
  {k:"ie_curbCutCount", label:"路口开设个数", lo:0, hi:6, group:"投资估算"},
  {k:"ie_highVoltageBuryFee", label:"高压线下地费(万元)", lo:0, hi:200, group:"投资估算"},
  {k:"ie_treeRelocFee", label:"苗木迁移费(万元)", lo:0, hi:100, group:"投资估算"},
  {k:"ie_fenceArea", label:"围挡面积(㎡)", lo:0, hi:3000, group:"投资估算"},
  {k:"ie_facilityArea", label:"临时设施面积(㎡)", lo:0, hi:2000, group:"投资估算"},
  {k:"ie_facilityUnitPrice", label:"临时设施单价(万元/㎡)", lo:0, hi:0.5, group:"投资估算"},
  {k:"ie_occupyArea", label:"临时场地占用面积(㎡)", lo:0, hi:3000, group:"投资估算"},
  {k:"ie_feasibilityFee", label:"可研费(万元)", lo:0, hi:150, group:"投资估算"},
  {k:"ie_envReportFee", label:"环境报告编制费(万元)", lo:0, hi:100, group:"投资估算"},
  {k:"ie_geoHazardFee", label:"地质灾害危险评估费(万元)", lo:0, hi:100, group:"投资估算"},
  {k:"ie_chargerCount", label:"充电桩个数", lo:0, hi:100, group:"投资估算"},
  {k:"ie_displayArea", label:"样板展示面积(㎡)", lo:0, hi:1500, group:"投资估算"},
];
function rentEvalIrr(vec, cfg){
  const RentCalc = window.RentCalc, InvestEstimate = window.InvestEstimate;
  const g = {}; RENT_PARAMS.forEach((p,i)=>{ g[p.k]=vec[i]; });
  const buildStart = 2026, landTerm = 70, houseType = "公租房";
  const buildYears = Math.round(g.buildYears);
  const p = {
    buildStart, buildYears, operateYears: Math.max(1, landTerm-buildYears), firstMonths: Math.round(g.firstMonths),
    area: g.area, rent: g.rent, rentSpan: Math.max(1,Math.round(g.rentSpan)), rentRate: g.rentRate,
    rampOcc: g.rampOcc, stableOcc: g.stableOcc, occRamp: [g.occRamp0, g.occRamp1],
    parkCount: Math.round(g.parkCount), parkPrice: g.parkPrice, parkRatio: g.parkRatio,
    parkRampOcc: g.rampOcc, parkStableOcc: g.stableOcc, parkOccRamp: [g.parkOccRamp0, g.parkOccRamp1],
    rentDiscount: g.rentDiscount, subsidyArea: g.subsidyArea, subsidyPrice: g.subsidyPrice,
    subsidyDiscount: g.subsidyDiscount, subsidyStableOcc: g.subsidyStableOcc, subsidyRampOcc: g.subsidyStableOcc,
    areaPostOffice: g.areaPostOffice, postOfficePrice: g.postOfficePrice,
    areaKindergarten: g.areaKindergarten, areaPropertyRoom: g.areaPropertyRoom, areaPoliceRoom: g.areaPoliceRoom,
    otherTotal: g.otherTotal, manageCoeff: g.manageCoeff, decorationCost: g.decorationCost, houseType,
    landArea: g.landArea, loanAmount: g.loanAmount, loanRate: g.loanRate, firstRepayRatio: g.firstRepayRatio,
    repayIncreaseRate: g.repayIncreaseRate, loanTotalYears: Math.round(g.loanTotalYears), discountPct: g.discountPct,
  };
  const iePar = {
    landArea: p.landArea, resiArea: p.area, areaKindergarten: p.areaKindergarten, areaPostOffice: p.areaPostOffice,
    areaPropertyRoom: p.areaPropertyRoom, areaPoliceRoom: p.areaPoliceRoom, parkCount: p.parkCount, buildYears: p.buildYears,
    basementArea: g.ie_basementArea, commArea: g.ie_commArea,
    landPriceResi: g.ie_landPriceResi, postOfficeLandPrice: g.ie_postOfficeLandPrice,
    curbCutCount: Math.round(g.ie_curbCutCount), highVoltageBuryFee: g.ie_highVoltageBuryFee, treeRelocFee: g.ie_treeRelocFee,
    fenceArea: g.ie_fenceArea, facilityArea: g.ie_facilityArea, facilityUnitPrice: g.ie_facilityUnitPrice,
    occupyArea: g.ie_occupyArea, feasibilityFee: g.ie_feasibilityFee, envReportFee: g.ie_envReportFee,
    geoHazardFee: g.ie_geoHazardFee, chargerCount: Math.round(g.ie_chargerCount), displayArea: g.ie_displayArea,
  };
  try{
    const est = InvestEstimate.estimate(iePar, (cfg&&cfg.invest)||{});
    const sch = InvestEstimate.schedule(est, p.buildStart, p.buildYears, (cfg&&cfg.invest)||{});
    p.totalBuildArea = est.summary.totalBuildArea;
    p.totalInvestment = est.summary.buildInvestment;
    p.constructionCost = est.summary.constructionCostTotal;
    p.invest = est.summary.buildInvestment;
    p.investPlan = sch.investPlan;
    if(p.loanAmount && est.summary.buildInvestment){
      const scale = p.loanAmount/est.summary.buildInvestment;
      p.loanPlan = {}; Object.keys(sch.investPlan).forEach(y=>{ p.loanPlan[y] = sch.investPlan[y]*scale; });
    }
    return RentCalc.calc(p, (cfg&&cfg.rent)||{}).summary.irr;
  }catch(e){ return null; }
}

// ===== 非居改保类(NRCalc) 22维参数空间(固定lease模式) =====
const GAIBAO_PARAMS = [
  {k:"buildYears", label:"建设期年数(年)", lo:1, hi:3, group:"期限"},
  {k:"operateYears", label:"运营期年数(年)", lo:8, hi:16, group:"期限"},
  {k:"firstMonths", label:"运营首年实际月数(月)", lo:6, hi:12, group:"期限"},
  {k:"area", label:"住宅面积(㎡)", lo:15000, hi:25000, group:"收入"},
  {k:"rent", label:"起始租金(元/㎡/月)", lo:55, hi:95, group:"收入"},
  {k:"rentSpan", label:"租金递增跨度(年)", lo:2, hi:4, group:"收入"},
  {k:"rentRate", label:"租金递增率(%)", lo:2, hi:8, group:"收入"},
  {k:"rampOcc", label:"首年出租率(爬坡)", lo:0.7, hi:0.95, group:"收入"},
  {k:"stableOcc", label:"稳定期出租率", lo:0.85, hi:0.99, group:"收入"},
  {k:"collect", label:"收楼单价(元/㎡/月)", lo:15, hi:35, group:"成本"},
  {k:"deco", label:"首次装修单方造价(元/㎡)", lo:1000, hi:2200, group:"成本"},
  {k:"decoInt", label:"装修间隔(年)", lo:6, hi:15, group:"成本"},
  {k:"decoRatio", label:"二次装修成本系数", lo:0.15, hi:0.45, group:"成本"},
  {k:"units", label:"总套数", lo:300, hi:700, group:"成本"},
  {k:"unitCost", label:"单套月运营成本(元/套/月)", lo:500, hi:1200, group:"成本"},
  {k:"startup", label:"开办费(万元)", lo:20, hi:100, group:"成本"},
  {k:"loan", label:"总借款额(万元)", lo:8000, hi:20000, group:"融资"},
  {k:"interestBase", label:"计息本金(万元)", lo:6000, hi:15000, group:"融资"},
  {k:"rateDiscount", label:"利率折扣系数", lo:0.6, hi:1.0, group:"融资"},
  {k:"loanRate", label:"贷款年利率(%)", lo:2, hi:5, group:"融资"},
  {k:"discount", label:"折现率(%)", lo:3, hi:8, group:"折现"},
  {k:"repay", label:"年均还款额(万元/年)", lo:500, hi:2000, group:"融资"},
];
function assembleCalcInputStandalone(p){
  const buildYearsArr = Array.from({length:p.buildYears},(_,i)=>p.buildStart+i);
  const opStart = p.buildStart + p.buildYears;
  const operateYearsArr = Array.from({length:p.operateYears},(_,i)=>opStart+i);
  const loanPlan = {}; loanPlan[p.buildStart] = p.loan;
  const repayPlan = {};
  for(let i=1;i<p.operateYears;i++){ repayPlan[opStart+i] = p.repay; }
  const ramp = {}; ramp[opStart] = p.rampOcc;
  return {
    buildYears:buildYearsArr, operateYears:operateYearsArr, firstOperateMonths:p.firstMonths,
    residentialArea:p.area, rentStartPrice:p.rent, rentIncreaseSpan:p.rentSpan, rentIncreaseRate:p.rentRate,
    costIncreaseSpan:1, costIncreaseRate:0,
    occupancyRamp:ramp, stableStart:opStart+1, stableEnd:operateYearsArr[operateYearsArr.length-1], occupancyStable:p.stableOcc,
    collectPrice:p.collect, decorationUnitCost:p.deco, decorationInterval:p.decoInt, redecorationRatio:p.decoRatio,
    totalUnits:p.units, unitOperateCost:p.unitCost, startupFee:p.startup,
    loanAmount:p.loan, interestBase:p.interestBase, rateDiscount:p.rateDiscount, loanAnnualRate:p.loanRate,
    loanPlan:loanPlan, repayPlan:repayPlan, discountRatePct:p.discount,
    collectFactor: p.mode==="share"? (p.collectPct||50)/100 : 1,
    shareRatio: p.mode==="share"? (p.sharePct||0)/100 : 0,
  };
}
function gaibaoEvalIrr(vec, cfg){
  const NRCalc = window.NRCalc;
  const g = {}; GAIBAO_PARAMS.forEach((p,i)=>{ g[p.k]=vec[i]; });
  const p = {
    buildStart:2026, buildYears:Math.round(g.buildYears), operateYears:Math.round(g.operateYears), firstMonths:Math.round(g.firstMonths),
    area:g.area, rent:g.rent, rentSpan:Math.max(1,Math.round(g.rentSpan)), rentRate:g.rentRate,
    rampOcc:g.rampOcc, stableOcc:g.stableOcc, collect:g.collect, deco:g.deco, decoInt:Math.max(1,Math.round(g.decoInt)),
    decoRatio:g.decoRatio, units:Math.round(g.units), unitCost:g.unitCost, startup:g.startup,
    loan:g.loan, interestBase:g.interestBase, rateDiscount:g.rateDiscount, loanRate:g.loanRate,
    discount:g.discount, repay:g.repay, mode:"lease", collectPct:100, sharePct:0,
  };
  try{ return NRCalc.calc(assembleCalcInputStandalone(p), (cfg&&cfg.gaibao)||{}).summary.irr; }catch(e){ return null; }
}

// ===== 出售类(SaleCalc) 35维参数空间 =====
const SALE_PARAMS = [
  {k:"buildYears", label:"建设期年数(年)", lo:2, hi:7, group:"期限"},
  {k:"otherTotal", label:"其他收入(万元)", lo:0, hi:300, group:"收入"},
  {k:"saleArea", label:"配保房销售面积(㎡)", lo:45000, hi:65000, group:"收入"},
  {k:"saleAvgPrice", label:"可售售价(元/㎡)", lo:10000, hi:15000, group:"收入"},
  {k:"rate1", label:"运营第1年销售率", lo:0.7, hi:1.0, group:"收入"},
  {k:"rate2", label:"运营第2年销售率", lo:0, hi:0.3, group:"收入"},
  {k:"rate3", label:"运营第3年销售率", lo:0, hi:0.1, group:"收入"},
  {k:"commArea", label:"商业出租面积(㎡)", lo:1000, hi:2500, group:"商业出租"},
  {k:"commRent", label:"商业起始租金(元/㎡/月)", lo:45, hi:85, group:"商业出租"},
  {k:"commRentSpan", label:"商业租金递增跨度(年)", lo:5, hi:15, group:"商业出租"},
  {k:"commRentRate", label:"商业租金递增率(%)", lo:0, hi:5, group:"商业出租"},
  {k:"commStableOcc", label:"商业稳定期出租率", lo:0.85, hi:0.99, group:"商业出租"},
  {k:"leaseMonths", label:"商业租赁月数(每年)", lo:10, hi:12, group:"商业出租"},
  {k:"parkCount", label:"商业停车位个数", lo:0, hi:50, group:"商业出租"},
  {k:"landCost", label:"(非配售)土地成本费(万元)", lo:700, hi:1400, group:"投资"},
  {k:"constructionCost", label:"(非配售)建安工程费(万元)", lo:4000, hi:6500, group:"投资"},
  {k:"infraCost", label:"(非配售)基础设施建设费(万元)", lo:50, hi:150, group:"投资"},
  {k:"otherEngCost", label:"(非配售)工程建设其他费用(万元)", lo:300, hi:550, group:"投资"},
  {k:"devCost", label:"(非配售)开发成本费(万元)", lo:6000, hi:8500, group:"投资"},
  {k:"saleConstructionCost", label:"(配售)建安工程费(万元)", lo:40000, hi:60000, group:"投资"},
  {k:"saleInfraCost", label:"(配售)基础设施费(万元)", lo:600, hi:1100, group:"投资"},
  {k:"projectInputTax", label:"工程进项税(万元)", lo:0, hi:100, group:"投资"},
  {k:"landUseArea", label:"用地面积(㎡)", lo:12000, hi:17000, group:"投资"},
  {k:"landFloorPrice", label:"划拨土地楼面价(元/㎡)", lo:500, hi:1500, group:"投资"},
  {k:"totalInvestment", label:"项目总投资(万元)", lo:60000, hi:85000, group:"投资"},
  {k:"prop2AnnualBase", label:"房产税2年基数(万元)", lo:10, hi:40, group:"税费"},
  {k:"devSaleBaseOverride", label:"开发成本·销售部分(万元)", lo:50000, hi:75000, group:"税费"},
  {k:"devDepBaseOverride", label:"开发成本·折旧摊销部分(万元)", lo:1500, hi:3000, group:"税费"},
  {k:"saleTaxTotalOverride", label:"销售税金及附加合计(万元)", lo:500, hi:1200, group:"税费"},
  {k:"loanAmount", label:"总借款额(万元)", lo:7000, hi:11000, group:"融资"},
  {k:"loanRate", label:"贷款年利率(%)", lo:2, hi:5, group:"融资"},
  {k:"loanTotalYears", label:"借款总年数", lo:15, hi:30, group:"融资"},
  {k:"repayAmount", label:"每年还款额(万元)", lo:0, hi:500, group:"融资"},
  {k:"repayYears", label:"还款年数", lo:0, hi:10, group:"融资"},
  {k:"discountPct", label:"折现率(%)", lo:2, hi:6, group:"折现"},
];
function saleEvalIrr(vec, cfg){
  const SaleCalc = window.SaleCalc;
  const g = {}; SALE_PARAMS.forEach((p,i)=>{ g[p.k]=vec[i]; });
  const buildStart=2025, landTerm=70;
  const buildYears = Math.round(g.buildYears);
  const p = {
    buildStart, buildYears, operateYears: Math.max(1, landTerm-buildYears),
    otherTotal:g.otherTotal, saleArea:g.saleArea, saleAvgPrice:g.saleAvgPrice,
    rate1:g.rate1, rate2:g.rate2, rate3:g.rate3,
    commArea:g.commArea, commRent:g.commRent, commRentSpan:Math.max(1,Math.round(g.commRentSpan)), commRentRate:g.commRentRate,
    commOccRamp:[0.125,0.51,0.765], commStableOcc:g.commStableOcc,
    commRentStableStart: buildStart+buildYears+4, leaseMonths:Math.round(g.leaseMonths), parkCount:Math.round(g.parkCount),
    landCost:g.landCost, constructionCost:g.constructionCost, infraCost:g.infraCost,
    otherEngCost:g.otherEngCost, devCost:g.devCost,
    saleConstructionCost:g.saleConstructionCost, saleInfraCost:g.saleInfraCost,
    projectInputTax:g.projectInputTax, landUseArea:g.landUseArea, landFloorPrice:g.landFloorPrice,
    totalInvestment:g.totalInvestment,
    prop2AnnualBase:g.prop2AnnualBase, vacFactors:[0.88,0.98],
    devSaleBaseOverride:g.devSaleBaseOverride, devDepBaseOverride:g.devDepBaseOverride,
    saleTaxTotalOverride:g.saleTaxTotalOverride,
    loanAmount:g.loanAmount, loanRate:g.loanRate, loanTotalYears:Math.round(g.loanTotalYears),
    repayStart: buildStart+buildYears+1, repayAmount:g.repayAmount, repayYears:Math.round(g.repayYears),
    discountPct:g.discountPct,
  };
  const opStart = p.buildStart + p.buildYears;
  const ramp = {}; if(p.rate1) ramp[opStart]=p.rate1; if(p.rate2) ramp[opStart+1]=p.rate2; if(p.rate3) ramp[opStart+2]=p.rate3;
  const repay = {}; for(let i=0;i<p.repayYears;i++) repay[p.repayStart+i]=p.repayAmount;
  try{ return SaleCalc.calc(Object.assign({}, p, {saleRamp:ramp, customRepay:repay}), (cfg&&cfg.sale)||{}).summary.irr; }catch(e){ return null; }
}

const REGISTRY = {
  gaibao: { params: GAIBAO_PARAMS, evalIrr: gaibaoEvalIrr, label: "非居改保类" },
  rent: { params: RENT_PARAMS, evalIrr: rentEvalIrr, label: "出租类" },
  sale: { params: SALE_PARAMS, evalIrr: saleEvalIrr, label: "出售类" },
};
const METHOD_LABELS = { sobol:"Sobol方差分解", spearman:"Spearman秩相关", src:"标准化回归系数" };

function combineRanks(perParam, methods){
  const rankMaps = [];
  if(methods.includes("sobol")) rankMaps.push(rankByAbsMetric(perParam.map(p=>({key:p.key, metric:p.STi}))));
  if(methods.includes("spearman")) rankMaps.push(rankByAbsMetric(perParam.map(p=>({key:p.key, metric:p.spearmanRho}))));
  if(methods.includes("src")) rankMaps.push(rankByAbsMetric(perParam.map(p=>({key:p.key, metric:p.src}))));
  perParam.forEach(p=>{
    const ranks = rankMaps.map(m=>m[p.key]).filter(r=>r!==undefined);
    p.combinedRank = ranks.length? Math.round((ranks.reduce((s,v)=>s+v,0)/ranks.length)*100)/100 : null;
  });
  perParam.sort((a,b)=>(a.combinedRank===null?9999:a.combinedRank)-(b.combinedRank===null?9999:b.combinedRank));
  return perParam;
}
function spearmanAndSrc(perParam, A, fA, N, K, methods){
  const validIdx = []; for(let r=0;r<N;r++) if(fA[r]!==null) validIdx.push(r);
  const Aval = validIdx.map(r=>A[r]);
  const yval = validIdx.map(r=>fA[r]);
  if(methods.includes("spearman")){
    for(let i=0;i<K;i++) perParam[i].spearmanRho = spearman(Aval.map(row=>row[i]), yval);
  }
  if(methods.includes("src")){
    if(yval.length > K+2){
      const betas = stdRegressionCoeffs(Aval, yval);
      for(let i=0;i<K;i++) perParam[i].src = betas[i];
    }else{
      for(let i=0;i<K;i++) perParam[i].src = null;
    }
  }
}

/** 同步主入口(命令行用，没有UI要保持响应，不用分块)：analyze(type, methods, N, cfg, seed)
 *  type: gaibao|rent|sale；methods: ["sobol","spearman","src"]的任意非空子集，默认["sobol"]
 *  N: 抽样次数；cfg: {gaibao,rent,sale,invest}覆盖引擎内置系数；seed: 随机种子(保证可复现)
 *  返回 {type,label,N,K,methods,elapsedSec,table:[{key,label,group,Si?,STi?,spearmanRho?,src?,combinedRank}]}(已按combinedRank升序排好) */
function analyze(type, methods, N, cfg, seed){
  if(!REGISTRY[type]) throw new Error("未知类型: "+type+"，可选 gaibao/rent/sale");
  if(typeof methods === "number"){ seed = cfg; cfg = N; N = methods; methods = ["sobol"]; } // 兼容旧签名 analyze(type,N,cfg,seed)
  methods = (methods && methods.length) ? methods : ["sobol"];
  const PARAMS = REGISTRY[type].params;
  const K = PARAMS.length;
  const evalIrr = vec => REGISTRY[type].evalIrr(vec, cfg);
  const t0 = Date.now();
  const toMatrix = unitM => unitM.map(row=>row.map((u,j)=>PARAMS[j].lo + u*(PARAMS[j].hi-PARAMS[j].lo)));
  const rng = mulberry32(seed||20260806);
  const A = toMatrix(lhsUnit(N, K, rng));
  const fA = A.map(evalIrr);
  const perParam = PARAMS.map(p=>({key:p.k, label:p.label, group:p.group}));

  if(methods.includes("sobol")){
    const B = toMatrix(lhsUnit(N, K, rng));
    const fB = B.map(evalIrr);
    for(let i=0;i<K;i++){
      const ABi = A.map((rowA,r)=> rowA.map((v,j)=> j===i? B[r][j] : v));
      const fABi = ABi.map(evalIrr);
      let sumSi=0, sumSTi=0, n=0, ys=[];
      for(let r=0;r<N;r++){
        const a=fA[r], b=fB[r], ab=fABi[r];
        if(a===null||b===null||ab===null) continue;
        sumSi += b*(ab-a); sumSTi += (a-ab)*(a-ab); ys.push(a); ys.push(b); n++;
      }
      const mean = ys.length? ys.reduce((s,v)=>s+v,0)/ys.length : 0;
      const varY = ys.length? ys.reduce((s,v)=>s+(v-mean)*(v-mean),0)/ys.length : 0;
      perParam[i].Si = varY>0 && n>0 ? (sumSi/n)/varY : null;
      perParam[i].STi = varY>0 && n>0 ? (sumSTi/(2*n))/varY : null;
    }
  }
  spearmanAndSrc(perParam, A, fA, N, K, methods);
  combineRanks(perParam, methods);
  return { type, label: REGISTRY[type].label, N, K, methods, elapsedSec: (Date.now()-t0)/1000, table: perParam };
}

/** 异步主入口(浏览器后台面板用)：analyzeAsync(type, methods, N, cfg, seed, onProgress)
 *  和 analyze() 算法完全一致，唯一区别是按"已花时间"而不是"已评估次数"让出主线程——
 *  每累计约80ms计算量就 await 一次 setTimeout(0)，把控制权交还浏览器处理点击/重绘。
 *  按时间而不是按固定次数分块，是因为三类引擎单次评估耗时差很多(非居改保~0.15ms、出租类~0.86ms)，
 *  固定次数分块要么对慢引擎让步太少(还是卡)，要么对快引擎让步太频繁(纯粹空转的setTimeout开销反而拖慢总时长，
 *  尤其是浏览器后台标签页时setTimeout(0)可能被节流到接近1000ms一次，之前就是卡在这上面了)。
 *  onProgress(可选)：({stage,done,total}|{stage:"sobol参数",index,total,key}) => void */
function sleep0(){ return new Promise(resolve=>setTimeout(resolve, 0)); }
const YIELD_BUDGET_MS = 80;
function nowMs(){ return (typeof performance!=="undefined" && performance.now)? performance.now() : Date.now(); }
async function analyzeAsync(type, methods, N, cfg, seed, onProgress){
  if(!REGISTRY[type]) throw new Error("未知类型: "+type+"，可选 gaibao/rent/sale");
  methods = (methods && methods.length) ? methods : ["sobol"];
  const PARAMS = REGISTRY[type].params;
  const K = PARAMS.length;
  const evalIrr = vec => REGISTRY[type].evalIrr(vec, cfg);
  const t0 = Date.now();
  const toMatrix = unitM => unitM.map(row=>row.map((u,j)=>PARAMS[j].lo + u*(PARAMS[j].hi-PARAMS[j].lo)));
  const rng = mulberry32(seed||20260806);
  const notify = stage => (done,total)=>{ if(onProgress) onProgress({stage,done,total}); };

  let lastYield = nowMs();
  const evalBatch = async (mat, onChunk) => {
    const out = new Array(mat.length);
    for(let r=0;r<mat.length;r++){
      out[r] = evalIrr(mat[r]);
      if(nowMs()-lastYield >= YIELD_BUDGET_MS){
        if(onChunk) onChunk(r+1, mat.length);
        await sleep0();
        lastYield = nowMs();
      }
    }
    return out;
  };

  const A = toMatrix(lhsUnit(N, K, rng));
  const fA = await evalBatch(A, notify("基础样本A"));
  const perParam = PARAMS.map(p=>({key:p.k, label:p.label, group:p.group}));

  if(methods.includes("sobol")){
    const B = toMatrix(lhsUnit(N, K, rng));
    const fB = await evalBatch(B, notify("基础样本B"));
    for(let i=0;i<K;i++){
      const ABi = A.map((rowA,r)=> rowA.map((v,j)=> j===i? B[r][j] : v));
      const fABi = await evalBatch(ABi, notify("参数"+(i+1)+"/"+K+"："+PARAMS[i].label));
      if(onProgress) onProgress({stage:"sobol参数", index:i+1, total:K, key:PARAMS[i].k, label:PARAMS[i].label});
      let sumSi=0, sumSTi=0, n=0, ys=[];
      for(let r=0;r<N;r++){
        const a=fA[r], b=fB[r], ab=fABi[r];
        if(a===null||b===null||ab===null) continue;
        sumSi += b*(ab-a); sumSTi += (a-ab)*(a-ab); ys.push(a); ys.push(b); n++;
      }
      const mean = ys.length? ys.reduce((s,v)=>s+v,0)/ys.length : 0;
      const varY = ys.length? ys.reduce((s,v)=>s+(v-mean)*(v-mean),0)/ys.length : 0;
      perParam[i].Si = varY>0 && n>0 ? (sumSi/n)/varY : null;
      perParam[i].STi = varY>0 && n>0 ? (sumSTi/(2*n))/varY : null;
    }
  }
  spearmanAndSrc(perParam, A, fA, N, K, methods);
  combineRanks(perParam, methods);
  return { type, label: REGISTRY[type].label, N, K, methods, elapsedSec: (Date.now()-t0)/1000, table: perParam };
}

return { mulberry32, lhsUnit, spearman, stdRegressionCoeffs, REGISTRY, METHOD_LABELS, analyze, analyzeAsync };
});
