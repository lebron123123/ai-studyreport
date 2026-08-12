import test from "node:test";
import assert from "node:assert/strict";
import {governanceTrigger,configTrigger} from "../functions/api/_paramreview.js";

test("公式常量发布触发高优先级白箱重评估",()=>{
  const e=governanceTrigger("coeff_rent",[{key:"landUseTax",fields:["expertValue"]}]);
  assert.equal(e.calcType,"rent");assert.equal(e.triggerType,"formula_coefficient_change");assert.equal(e.severity,"high");
});

test("参数边界和影响等级发布触发对应重评估类型",()=>{
  let e=governanceTrigger("rent",[{key:"rent",fields:["min","max"]}]);assert.equal(e.triggerType,"parameter_rule_change");
  e=governanceTrigger("rent",[{key:"rent",fields:["impactLevel"]}]);assert.equal(e.triggerType,"impact_classification_change");
});

test("敏感性排名变化被识别并保留前后Top序列",()=>{
  const before={rent:{table:[{key:"a",combinedRank:1},{key:"b",combinedRank:2}]}},after={rent:{table:[{key:"b",combinedRank:1},{key:"a",combinedRank:2}]}};
  const e=configTrigger("sensitivity",before,after);assert.equal(e.triggerType,"sensitivity_result_change");assert.equal(e.detail.rankChanges.rent.positionsChanged,2);
});

test("完全相同配置不制造重复提醒",()=>{assert.equal(configTrigger("rent",{a:1},{a:1}),null);});
