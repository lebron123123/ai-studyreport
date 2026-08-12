// 「编制标准核查」硬规则回归测试 —— review.js 的 runAudit() 里拿真实测算参数比对
// 公司《可研报告编制与审查指引》的那部分逻辑，抽成了纯函数 calcStdHardChecks(calcParams, investCfg)
// 方便脱离浏览器环境单独测试。此前只在浏览器里用 monkey-patch 手工验证过，没有留下自动化测试。

const test = require("node:test");
const assert = require("node:assert/strict");
const { calcStdHardChecks, excelMappingChecks } = require("../review.js");

// 一组完全合规的测算参数：贷款利率3%、建设期4年、首年出租率75%（边界内）、
// 稳定期出租率95%（边界内）、管理费系数取标准7档之一、自有资金比例20%（≤30%）
const COMPLIANT_PARAMS = {
  loanRate: 3, buildYears: 4, rampOcc: 0.75, stableOcc: 0.95, manageCoeff: 0.85,
  loanAmount: 35000, totalInvestment: 50000,
};

test("calcStdHardChecks：calcParams为空时不报任何问题（不能在没测算数据时瞎报）", () => {
  assert.deepEqual(calcStdHardChecks(null, {}), []);
  assert.deepEqual(calcStdHardChecks(undefined, {}), []);
});

test("calcStdHardChecks：全部合规的参数不应产生任何warn/info", () => {
  const issues = calcStdHardChecks(COMPLIANT_PARAMS, { contingencyRate: 0.05 });
  assert.deepEqual(issues, []);
});

test("calcStdHardChecks：贷款利率超出3%±0.3容差应报警", () => {
  const issues = calcStdHardChecks(Object.assign({}, COMPLIANT_PARAMS, { loanRate: 4.5 }), {});
  assert.ok(issues.some(i => i.sev === "warn" && i.msg.includes("银行贷款利率")));
});

test("calcStdHardChecks：贷款利率在3%±0.3容差内不应报警", () => {
  const issues = calcStdHardChecks(Object.assign({}, COMPLIANT_PARAMS, { loanRate: 3.29 }), {});
  assert.ok(!issues.some(i => i.msg.includes("银行贷款利率")));
});

test("calcStdHardChecks：建设期超过4年应报警", () => {
  const issues = calcStdHardChecks(Object.assign({}, COMPLIANT_PARAMS, { buildYears: 5 }), {});
  assert.ok(issues.some(i => i.sev === "warn" && i.msg.includes("建设期")));
});

test("calcStdHardChecks：首年出租率超过75%应报警", () => {
  const issues = calcStdHardChecks(Object.assign({}, COMPLIANT_PARAMS, { rampOcc: 0.8 }), {});
  assert.ok(issues.some(i => i.msg.includes("首年出租率")));
});

test("calcStdHardChecks：稳定期出租率超过95%应报警", () => {
  const issues = calcStdHardChecks(Object.assign({}, COMPLIANT_PARAMS, { stableOcc: 0.98 }), {});
  assert.ok(issues.some(i => i.msg.includes("稳定期出租率")));
});

test("calcStdHardChecks：管理费系数不在7档标准值内应报警", () => {
  const issues = calcStdHardChecks(Object.assign({}, COMPLIANT_PARAMS, { manageCoeff: 2.3 }), {});
  assert.ok(issues.some(i => i.msg.includes("管理费区域系数")));
});

test("calcStdHardChecks：管理费系数取7档标准值中的任意一档都不应报警", () => {
  [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.5].forEach(v => {
    const issues = calcStdHardChecks(Object.assign({}, COMPLIANT_PARAMS, { manageCoeff: v }), {});
    assert.ok(!issues.some(i => i.msg.includes("管理费区域系数")), "档位"+v+"不应报警");
  });
});

test("calcStdHardChecks：不可预见费率超过8%上限应报警（用investCfg传入，未配置时按引擎默认5%不报警）", () => {
  const withHighRate = calcStdHardChecks(COMPLIANT_PARAMS, { contingencyRate: 0.09 });
  assert.ok(withHighRate.some(i => i.msg.includes("不可预见费率")));
  const withDefault = calcStdHardChecks(COMPLIANT_PARAMS, {});
  assert.ok(!withDefault.some(i => i.msg.includes("不可预见费率")));
});

test("calcStdHardChecks：自有资金比例超过30%应给info级提示（非硬性错误，允许特殊情况说明）", () => {
  // loanAmount=30000, totalInvestment=50000 → 自有资金比例=1-30000/50000=40%，超过30%上限
  const issues = calcStdHardChecks(Object.assign({}, COMPLIANT_PARAMS, { loanAmount: 30000 }), {});
  const hit = issues.find(i => i.msg.includes("自有资金比例"));
  assert.ok(hit);
  assert.equal(hit.sev, "info");   // 不是warn——这条允许项目有特殊情况，不冒充硬性判定
});

test("calcStdHardChecks：折现率/IRR达标线这类依赖项目性质分类的条目不应出现在硬规则结果里", () => {
  // 系统目前不采集"项目性质"字段，这类条目应该留给AI辅助判断（calcStdFor注入），
  // 不能在这个纯硬规则函数里冒充判定——即便参数里塞了discountPct/irr字段也不该被这个函数处理
  const issues = calcStdHardChecks(Object.assign({}, COMPLIANT_PARAMS, { discountPct: 99, irr: -50 }), {});
  assert.ok(!issues.some(i => i.msg.includes("折现率") || i.msg.includes("IRR")));
});

const EXCEL_MAP=[{field_key:"totalInvestment",field_label:"总投资",workbook_title:"测试测算表",sheet_name:"投资估算",cell_address:"B15",raw_value:"23500",display_value:"23,500"}];
test("excelMappingChecks：Excel、引擎、正文三方一致时不报警",()=>{
  assert.deepEqual(excelMappingChecks(EXCEL_MAP,{totalInvestment:23500},{},"项目总投资为23,500万元。"),[]);
});
test("excelMappingChecks：Excel与测算引擎不一致时报错并带单元格来源",()=>{
  const issues=excelMappingChecks(EXCEL_MAP,{totalInvestment:24000},{},"");
  assert.equal(issues.length,1); assert.match(issues[0].msg,/投资估算!B15/);
});
test("excelMappingChecks：正文数字与Excel不一致时报错",()=>{
  const issues=excelMappingChecks(EXCEL_MAP,{totalInvestment:23500},{},"总投资为24,000万元。");
  assert.equal(issues.length,1); assert.match(issues[0].msg,/正文值/);
});
