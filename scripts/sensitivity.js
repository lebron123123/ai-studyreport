#!/usr/bin/env node
// CLI入口 —— 敏感性分析：三类测算引擎的填空参数 对 IRR 的影响排序
// 核心算法与参数空间定义在 ../sensitivity-core.js（和后台admin.html「敏感性分析」页共用同一份逻辑）
// 用法：node scripts/sensitivity.js <gaibao|rent|sale|all> [N] [methods]
//   N       = 抽样次数，默认1500，调试用几十就够
//   methods = 逗号分隔，任选 sobol,spearman,src 的子集，默认 sobol,spearman,src(三个都跑，自动综合排序)
"use strict";
global.window = {};
const path = require("path");
const ROOT = path.join(__dirname, "..");
require(path.join(ROOT, "nrcalc.js"));
require(path.join(ROOT, "rentcalc.js"));
require(path.join(ROOT, "investestimate.js"));
require(path.join(ROOT, "salecalc.js"));
const Core = require(path.join(ROOT, "sensitivity-core.js"));

function printTable(result){
  const methodsStr = result.methods.map(m=>Core.METHOD_LABELS[m]||m).join(" + ");
  console.log("\n=== "+result.label+" ("+result.type+") — N="+result.N+"，"+result.K+"个参数，方法：["+methodsStr+"]，耗时"+result.elapsedSec.toFixed(1)+"s ===");
  const cols = ["综合排名".padEnd(6), "参数".padEnd(24), "具体指标".padEnd(28), "分组".padEnd(8)];
  if(result.methods.includes("sobol")) cols.push("Si".padEnd(9), "STi".padEnd(9));
  if(result.methods.includes("spearman")) cols.push("Spearman".padEnd(10));
  if(result.methods.includes("src")) cols.push("SRC".padEnd(9));
  if(result.methods.length>1) cols.push("综合名次");
  console.log(cols.join(""));
  result.table.forEach((r,i)=>{
    const row = [String(i+1).padEnd(6), r.key.padEnd(24), r.label.padEnd(28), r.group.padEnd(8)];
    if(result.methods.includes("sobol")) row.push((r.Si!==null?r.Si.toFixed(4):"null").padEnd(9), (r.STi!==null?r.STi.toFixed(4):"null").padEnd(9));
    if(result.methods.includes("spearman")) row.push((r.spearmanRho!==null?r.spearmanRho.toFixed(4):"null").padEnd(10));
    if(result.methods.includes("src")) row.push((r.src!==null&&r.src!==undefined?r.src.toFixed(4):"null").padEnd(9));
    if(result.methods.length>1) row.push(r.combinedRank!==null?String(r.combinedRank):"null");
    console.log(row.join(""));
  });
}

function main(){
  const typeArg = process.argv[2] || "all";
  const N = parseInt(process.argv[3]||"1500", 10);
  const methods = (process.argv[4]||"sobol,spearman,src").split(",").map(s=>s.trim()).filter(Boolean);
  const types = typeArg==="all" ? Object.keys(Core.REGISTRY) : [typeArg];
  const out = {};
  types.forEach(type=>{
    const result = Core.analyze(type, methods, N);
    printTable(result);
    out[type] = result;
  });
  if(process.env.SENSITIVITY_JSON){
    require("fs").writeFileSync(process.env.SENSITIVITY_JSON, JSON.stringify(out, null, 1));
  }
}

main();
