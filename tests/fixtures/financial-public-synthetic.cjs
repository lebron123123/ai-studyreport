'use strict';
// Hand-authored, fictional figures. Expected values are not calculated by NRCalc.
// The first year cumulatively loses 100 then recovers 24.6914 + 75.3086.
const firstYear = [
  [-100, 0, -100, 0], [24.69136, 24.6914, 0, 0], [100, 75.3086, 24.6914, 6.1728],
  [-50, 0, -50, 0], [10, 10, 0, 0], [20, 15.3086, 4.6914, 1.1728],
  [4, 0, 4, 1], [0, 0, 0, 0], [8, 0, 8, 2],
  [12, 0, 12, 3], [16, 0, 16, 4], [20, 0, 20, 5]
];
const monthlyRows = firstYear.map((row, i) => ['1-' + (i + 1), ...row]);
// Eleven further years exercise the full 144-month contract without private Excel.
for (let year = 2; year <= 12; year++) for (let month = 1; month <= 12; month++) monthlyRows.push([year + '-' + month, 20, 0, 20, 5]);

const legacyTables = [
  [['年份', '住宅租金收入（万元）', '出租率', '租金单价（元/㎡/月）'], ['2038', '15,000.00', '50%', '90.00'], ['2039', '16,111.11', '60%', '95.00'], ['合计', '31,111.11', '—', '—']],
  [['年份', '收楼成本（万元）', '工程费用（万元）', '运营费用（万元）', '财务费用（万元）', '总成本（万元）'], ['2038', '1,000.00', '6,000.00', '3,000.00', '1,000.00', '11,000.00'], ['2039', '1,000.00', '6,222.22', '3,000.00', '1,000.00', '11,222.22'], ['合计', '2,000.00', '12,222.22', '6,000.00', '2,000.00', '22,222.22']],
  [['指标名称', '单位', '数值', '备注'], ['全周期总收入', '万元', '31,111.11', '虚构旧收入'], ['总成本费用', '万元', '22,222.22', '虚构旧成本'], ['税金及附加', '万元', '3,000.00', '虚构旧税费'], ['净利润', '万元', '888.88', '虚构旧值'], ['累计净现值（NPV）', '万元', '444.44', '折现率6%'], ['全投资内部收益率（IRR）', '%', '66.66', '虚构旧值'], ['累计净现金流回正年份', '—', '2039年', '测算期第2年']],
  [['敏感因素', '波动幅度', '全投资IRR（%）', 'IRR变动（个百分点）', '累计净现值（万元）', 'NPV变动（万元）'], ['基准方案', '—', '66.66', '—', '444.44', '—'], ['租金单价', '-10%', '【待补】', '【待补】', '【待补】', '【待补】']]
];
const currentSummary = {totalIncome: 1200, totalCost: 900, totalTax: 30, totalNetProfit: 202.75, totalNpv: 123.45, irr: 9.87, paybackInfo: {year: 2030, index: 4}, decoTimes: 1, totalEngCost: 480, totalOperateMonths: 54, interestCoverageReference: 8.5, totalLoan: 384, monthlyXirr: 9.8765, annualIrr: 10.25};
module.exports = {monthlyRows, legacyTables, currentSummary};
