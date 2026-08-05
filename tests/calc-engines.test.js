// 三类财务测算引擎（nrcalc.js/rentcalc.js/salecalc.js）基准数值回归测试
// 目的：任何重构（拆分函数、改变量名、调整实现方式等）都不能让这些数字跑偏。
// 基准数值来源：index.html 表单默认参数 + 引擎默认配置（CALC_CFG 为空覆盖，即取引擎自带 DEFAULTS）
// 下方三组入参 1:1 复刻自 index.html 里 calcFormHtml()/rentFormHtml()/saleFormHtml() 的默认值，
// 以及 assembleCalcInput()/scRun 里对出售类 saleRamp、customRepay 的组装逻辑。
// 若 index.html 的默认参数改变，属于产品行为变化，需要同步评估是否更新本文件的基准值——
// 但引擎公式本身（nrcalc.js/rentcalc.js/salecalc.js 内部实现）不应导致这些数字变化。

const test = require("node:test");
const assert = require("node:assert/strict");

// 三个引擎文件用 `window.XxxCalc = (function(){...})()` 的写法挂到 window 上，
// 在 Node 里用一个全局对象顶替 window 即可直接 require（它们是普通脚本，非 ES module）。
global.window = global;
require("../nrcalc.js");
require("../rentcalc.js");
require("../salecalc.js");

const { NRCalc, RentCalc, SaleCalc } = global.window;

// ---------- 非居改保：复刻 index.html 的 assembleCalcInput() ----------
function assembleGaibaoInput(p) {
  const buildYearsArr = Array.from({ length: p.buildYears }, (_, i) => p.buildStart + i);
  const opStart = p.buildStart + p.buildYears;
  const operateYearsArr = Array.from({ length: p.operateYears }, (_, i) => opStart + i);
  const loanPlan = {};
  loanPlan[p.buildStart] = p.loan;
  const repayPlan = {};
  for (let i = 1; i < p.operateYears; i++) repayPlan[opStart + i] = p.repay;
  const ramp = {};
  ramp[opStart] = p.rampOcc;
  return {
    buildYears: buildYearsArr, operateYears: operateYearsArr, firstOperateMonths: p.firstMonths,
    residentialArea: p.area, rentStartPrice: p.rent, rentIncreaseSpan: p.rentSpan, rentIncreaseRate: p.rentRate,
    costIncreaseSpan: 1, costIncreaseRate: 0,
    occupancyRamp: ramp, stableStart: opStart + 1, stableEnd: operateYearsArr[operateYearsArr.length - 1], occupancyStable: p.stableOcc,
    collectPrice: p.collect, decorationUnitCost: p.deco, decorationInterval: p.decoInt, redecorationRatio: p.decoRatio,
    totalUnits: p.units, unitOperateCost: p.unitCost, startupFee: p.startup,
    loanAmount: p.loan, interestBase: p.interestBase, rateDiscount: p.rateDiscount, loanAnnualRate: p.loanRate,
    loanPlan, repayPlan, discountRatePct: p.discount,
    collectFactor: p.mode === "share" ? (p.collectPct || 50) / 100 : 1,
    shareRatio: p.mode === "share" ? (p.sharePct || 0) / 100 : 0,
  };
}

// index.html calcFormHtml() 默认值
const GAIBAO_DEFAULT_PARAMS = {
  buildStart: 2026, buildYears: 1, operateYears: 12, firstMonths: 12, area: 20000, rent: 75,
  rentSpan: 3, rentRate: 5, rampOcc: 0.85, stableOcc: 0.95, collect: 25, deco: 1500, decoInt: 10,
  decoRatio: 0.30, units: 500, unitCost: 800, startup: 50, loan: 13892, interestBase: 10600,
  rateDiscount: 0.80, loanRate: 3.5, discount: 6, repay: 1157.67, mode: "lease", collectPct: 50, sharePct: 30,
};

// index.html rentFormHtml() 默认值（parkRampOcc/parkStableOcc 复用 rampOcc/stableOcc 的输入框）
const RENT_DEFAULT_PARAMS = {
  buildStart: 2026, buildYears: 1, operateYears: 20, firstMonths: 12, area: 20000, rent: 45,
  rentSpan: 3, rentRate: 5, rampOcc: 0.85, stableOcc: 0.95, parkCount: 200, parkPrice: 300, parkRatio: 0.5,
  parkRampOcc: 0.85, parkStableOcc: 0.95, otherTotal: 100, totalBuildArea: 25000, manageCoeff: 3,
  decorationCost: 800, houseType: "公租房", totalInvestment: 15000, landArea: 8000, constructionCost: 6000,
  loanAmount: 9000, loanRate: 3, firstRepayRatio: 3, repayIncreaseRate: 4.5, loanTotalYears: 20,
  invest: 15000, discountPct: 3.5,
};

// index.html saleFormHtml() 默认值
const SALE_DEFAULT_PARAMS = {
  buildStart: 2026, buildYears: 2, operateYears: 10, otherTotal: 500, saleArea: 56105, saleAvgPrice: 12880,
  rate1: 0.5, rate2: 0.3, rate3: 0.2, commArea: 20000, commRent: 120, commRentSpan: 3, commRentRate: 5,
  commRampOcc: 0.7, commStableOcc: 0.9, commRentStableStart: 2033, leaseMonths: 12, parkCount: 300,
  landCost: 30000, constructionCost: 40000, infraCost: 5000, otherEngCost: 3000, devCost: 8000,
  saleConstructionCost: 28000, saleInfraCost: 3500, projectInputTax: 200, landUseArea: 25000,
  landFloorPrice: 1000, totalInvestment: 90000, loanAmount: 50000, loanRate: 3, loanTotalYears: 12,
  repayStart: 2030, repayAmount: 10000, repayYears: 4, discountPct: 3.5,
};

function runGaibao() {
  return NRCalc.calc(assembleGaibaoInput(GAIBAO_DEFAULT_PARAMS), {});
}

function runRent() {
  const input = Object.assign({}, RENT_DEFAULT_PARAMS, {
    investPlan: { [RENT_DEFAULT_PARAMS.buildStart]: RENT_DEFAULT_PARAMS.invest },
  });
  return RentCalc.calc(input, {});
}

function runSale() {
  const p = SALE_DEFAULT_PARAMS;
  const opStart = p.buildStart + p.buildYears;
  const ramp = {};
  if (p.rate1) ramp[opStart] = p.rate1;
  if (p.rate2) ramp[opStart + 1] = p.rate2;
  if (p.rate3) ramp[opStart + 2] = p.rate3;
  const repay = {};
  for (let i = 0; i < p.repayYears; i++) repay[p.repayStart + i] = p.repayAmount;
  const input = Object.assign({}, p, { saleRamp: ramp, customRepay: repay });
  return SaleCalc.calc(input, {});
}

test("非居改保（NRCalc）默认参数基准数值回归", () => {
  const r = runGaibao();
  // 用户确认的核心基准数值
  assert.equal(r.summary.totalIncome, 21930.94);
  assert.equal(r.summary.totalNetProfit, 1097.78);
  assert.equal(r.summary.totalNpv, 768.04);
  assert.equal(r.summary.irr, 23.11);
  // 完整汇总快照，防止其它字段悄悄跑偏
  assert.deepEqual(r.summary, {
    totalIncome: 21930.94,
    totalCost: 18839.66,
    totalTax: 1160.46,
    totalNetProfit: 1097.78,
    totalNpv: 768.04,
    irr: 23.11,
    paybackInfo: { year: 2033, index: 8 },
    decoTimes: 2,
    totalEngCost: 3900,
  });
});

test("出租类（RentCalc）默认参数基准数值回归", () => {
  const r = runRent();
  // 用户确认的核心基准数值
  assert.equal(r.summary.totalIncome, 24358.56);
  // 完整汇总快照，防止其它字段悄悄跑偏
  assert.deepEqual(r.summary, {
    totalIncome: 24358.56,
    totalCost: 12338.99,
    totalTax: 1348.47,
    totalNetProfit: 8003.32,
    totalInterest: 3526.17,
    totalNpv: -3487.11,
    irr: 0.73,
    icr: 3.89,
    payback: { year: 2045, index: 20 },
  });
});

test("出售类（SaleCalc）默认参数基准数值回归", () => {
  const r = runSale();
  // 用户确认的核心基准数值
  assert.equal(r.summary.totalIncome, 87051.73);
  // 完整汇总快照，防止其它字段悄悄跑偏
  assert.deepEqual(r.summary, {
    totalIncome: 87051.73,
    totalCost: 128918.26,
    totalSaleIncome: 72263.24,
    rentalPvTotal: 14288.49,
    totalNetProfit: -41866.53,
    totalNpv: -3895.34,
    irr: 1.76,
    icr: -0.37,
    payback: { year: 2035, index: 10 },
  });
});

// IRR 求解器（三个引擎各自内置一份 excelIrr，逻辑相同）在现金流全正或全负时应返回 null，
// 而不是抛异常或返回错误的收敛值——重构时容易在这类边界条件上出错。
test("边界：全周期现金流无正负号切换时 IRR 应为 null（三引擎一致）", () => {
  const allNegativeGaibao = assembleGaibaoInput(Object.assign({}, GAIBAO_DEFAULT_PARAMS, { rent: 0 }));
  const r = NRCalc.calc(allNegativeGaibao, {});
  assert.equal(r.summary.irr, null);
});
