// paramestimate.js 单元测试 —— 参数估算调度骨架：验证分级调度、置信度合并、Sobol目标参数解析、防循环依赖
// 这几块逻辑本身不依赖真实案例数据，用构造出来的合成案例即可验证正确性。
const test = require("node:test");
const assert = require("node:assert/strict");

const ParamEstimate = require("../paramestimate.js");

function mkCase(name, location, params){
  return { name, location, params };
}

test("medianMethod：同区域优先，取中位数", () => {
  const cases = [
    mkCase("A", "深圳市坪山区龙田街道", { rent: 30 }),
    mkCase("B", "深圳市坪山区龙田街道", { rent: 50 }),
    mkCase("C", "广州市天河区", { rent: 100 }),
  ];
  const r = ParamEstimate.medianMethod("rent", cases, "坪山区龙田街道", 40);
  assert.equal(r.valid, true);
  assert.equal(r.tier, "region");
  assert.equal(r.n, 2);
  assert.equal(r.value, 40); // median(30,50)=40
});

test("medianMethod：无同区域案例时退化为不限区域中位数", () => {
  const cases = [
    mkCase("A", "广州市天河区", { rent: 60 }),
    mkCase("B", "广州市海珠区", { rent: 80 }),
  ];
  const r = ParamEstimate.medianMethod("rent", cases, "深圳市坪山区", 40);
  assert.equal(r.valid, true);
  assert.equal(r.tier, "other");
  assert.equal(r.value, 70);
});

test("medianMethod：完全没有案例时用行业默认值兜底", () => {
  const r = ParamEstimate.medianMethod("rent", [], "深圳市坪山区", 40);
  assert.equal(r.valid, false);
  assert.equal(r.tier, "default");
  assert.equal(r.value, 40);
});

test("linearMethod/rfMethod：白箱口径下永久退出正式投票，仅保留异常诊断身份", () => {
  const l = ParamEstimate.linearMethod("rent", [], []);
  const rf = ParamEstimate.rfMethod("rent", [], []);
  assert.equal(l.valid, false);
  assert.equal(rf.valid, false);
  assert.equal(l.diagnosticOnly, true);
  assert.equal(rf.diagnosticOnly, true);
  assert.ok(typeof l.reason === "string" && l.reason.length > 0);
  assert.ok(typeof rf.reason === "string" && rf.reason.length > 0);
});

test("loocvBeatsBaseline：方法是占位stub时恒为false，不会被误采信", () => {
  const cases = [mkCase("A", "x", { rent: 30 })];
  assert.equal(ParamEstimate.loocvBeatsBaseline("linear", "rent", cases, {}), false);
  assert.equal(ParamEstimate.loocvBeatsBaseline("rf", "rent", cases, {}), false);
});

test("confidenceBand：≥2个方法投票一致(CoV<5%)→高", () => {
  const votes = [{ value: 100 }, { value: 102 }];
  const band = ParamEstimate.confidenceBand(votes, { tier: "region", n: 2 });
  assert.equal(band, "高");
});

test("confidenceBand：方法间分歧大(CoV>=15%)→低且要求人工确认", () => {
  const votes = [{ value: 100 }, { value: 140 }];
  const band = ParamEstimate.confidenceBand(votes, { tier: "region", n: 2 });
  assert.match(band, /低/);
  assert.match(band, /人工/);
});

test("confidenceBand：只有中位数法一个来源时，按证据条数分级（与现行aireport.js规则一致）", () => {
  assert.equal(ParamEstimate.confidenceBand([], { tier: "region", n: 2 }), "高");
  assert.equal(ParamEstimate.confidenceBand([], { tier: "region", n: 1 }), "中");
  assert.equal(ParamEstimate.confidenceBand([], { tier: "other", n: 3 }), "中");
  assert.equal(ParamEstimate.confidenceBand([], { tier: "default", n: 0 }), "低");
});

test("estimateOne：案例库0条时，只用中位数法(默认值兜底)出结果，不假装有回归/RF投票", () => {
  const r = ParamEstimate.estimateOne("rent", [], { location: "深圳市坪山区", industryDefault: 32 });
  assert.equal(r.value, 32);
  assert.deepEqual(r.votingMethods, ["median"]);
  assert.equal(r.methods.linear.valid, false);
  assert.equal(r.methods.rf.valid, false);
});

test("estimateAll：批量对多个目标参数出结果", () => {
  const cases = [mkCase("A", "深圳市坪山区", { rent: 40, manageCoeff: 2 })];
  const out = ParamEstimate.estimateAll(["rent", "manageCoeff"], cases, { location: "深圳市坪山区", industryDefault: 0 });
  assert.equal(out.rent.value, 40);
  assert.equal(out.manageCoeff.value, 2);
});

test("resolveTargetParams：按敏感性分析combinedRank取前N，排除派生参数", () => {
  const sensResult = {
    table: [
      { key: "operateYears", label: "运营期年数", group: "期限", combinedRank: 1 },
      { key: "rent", label: "起始租金", group: "收入", combinedRank: 2 },
      { key: "manageCoeff", label: "管理系数", group: "成本", combinedRank: 3 },
      { key: "ie_landPriceResi", label: "住宅地价单价", group: "投资估算", combinedRank: 4 },
    ],
  };
  const out = ParamEstimate.resolveTargetParams(sensResult, { topN: 2, derivedKeys: ["operateYears"] });
  assert.deepEqual(out.map(x=>x.key), ["rent", "manageCoeff"]);
});

test("resolveTargetParams：没有敏感性结果时返回null，调用方应回退默认名单", () => {
  assert.equal(ParamEstimate.resolveTargetParams(null), null);
  assert.equal(ParamEstimate.resolveTargetParams({ table: [] }), null);
});

test("resolveTargetParams：没有combinedRank时按STi/spearmanRho绝对值排序", () => {
  const sensResult = {
    table: [
      { key: "a", label: "a", group: "g", STi: 0.02 },
      { key: "b", label: "b", group: "g", STi: 0.5 },
      { key: "c", label: "c", group: "g", spearmanRho: -0.3 },
    ],
  };
  const out = ParamEstimate.resolveTargetParams(sensResult, { topN: 3 });
  assert.deepEqual(out.map(x=>x.key), ["b", "c", "a"]);
});

test("assertNoLeakage：目标参数互相不能出现在对方的predictorKeys里", () => {
  assert.throws(() => {
    ParamEstimate.assertNoLeakage(["rent", "manageCoeff"], { rent: ["manageCoeff"] });
  }, /循环依赖/);
});

test("assertNoLeakage：predictorKeys里都是非目标参数时不报错", () => {
  assert.doesNotThrow(() => {
    ParamEstimate.assertNoLeakage(["rent", "manageCoeff"], { rent: ["landArea"], manageCoeff: ["units"] });
  });
});

test("checkOOD：骨架阶段恒不拦截（唯一启用方法中位数法不外推）", () => {
  const r = ParamEstimate.checkOOD("rent", [], {});
  assert.equal(r.ood, false);
});
