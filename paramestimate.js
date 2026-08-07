// 参数估算调度层 —— 从"少量输入"推算案例库相关的测算参数初值，供 AI可研生成(aireport.js) 之类的调用方使用。
// 背景（全流程可研生成对话，2026-08-07 讨论）：目标不是每个参数单独测到多准，是让最终IRR偏离<1%；
// 因此按敏感性分析（sensitivity-core.js 的 Sobol/Spearman/SRC 排序）挑出真正决定IRR的少数目标参数，
// 每个目标参数由多个独立方法各出一个估计值——方法间"一致→高置信，分歧→强制人工确认"，比单一模型自己
// 编一个置信度标签更诚实，分歧本身就是最真实的置信度信号。
//
// 案例库(calc_cases)当前是0条：线性回归/随机森林这类需要真实数据才能验证效果的训练逻辑本次不写——
// 写了也没法证明对不对，等库里有数据后再实现。本次只把接口、分级调度、置信度合并逻辑定下来并配好单测，
// methods.linear / methods.rf 先显式返回"未启用"，调度框架（LOOCV门槛判断、越界检测、防循环依赖）已经
// 接好调用位置，以后填真实训练代码时只需要替换对应函数体，不需要改调用方。
(function(root, factory){
  if(typeof module==="object" && module.exports) module.exports = factory();
  else root.ParamEstimate = factory();
})(typeof self!=="undefined"?self:this, function(){
"use strict";

function median(nums){
  const arr = nums.filter(x=>typeof x==="number" && isFinite(x)).slice().sort((a,b)=>a-b);
  if(!arr.length) return null;
  const mid = Math.floor(arr.length/2);
  return arr.length%2 ? arr[mid] : (arr[mid-1]+arr[mid])/2;
}
// 粗略的"同区域"判断：字符串互相包含即可（与 aireport.js 现有逻辑保持一致口径）
function sameRegion(a, b){
  a = String(a||"").trim(); b = String(b||"").trim();
  if(!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

// ===== 方法1：案例(相似度)中位数法 —— 目前唯一真正启用、参与投票的方法 =====
// 三层退化：①同区域同类型案例中位数 → ②不限区域同类型案例中位数 → ③无案例，调用方给的行业默认值兜底。
// predictorKeys 现在没有参与计算——先留出参数位，等案例库积累到能验证一个合理的距离/归一化方案时，
// 再在①②之间插入"按predictorKeys做特征距离kNN"这一层，不必改这个函数的调用方式。
function medianMethod(key, cases, location, industryDefault, predictorKeys){
  const withValue = cases.filter(c=>typeof c.params[key]==="number" && isFinite(c.params[key]));
  const regionHits = location ? withValue.filter(c=>sameRegion(c.location, location)) : [];
  const otherHits = withValue.filter(c=> !regionHits.includes(c));
  if(regionHits.length){
    return { valid:true, value: median(regionHits.map(c=>c.params[key])), n:regionHits.length, tier:"region",
      evidence: regionHits.map(c=>({ name:c.name, location:c.location, value:c.params[key] })) };
  }
  if(otherHits.length){
    return { valid:true, value: median(otherHits.map(c=>c.params[key])), n:otherHits.length, tier:"other",
      evidence: otherHits.map(c=>({ name:c.name, location:c.location, value:c.params[key] })) };
  }
  return { valid:false, value: industryDefault, n:0, tier:"default", evidence:[] };
}

// ===== 方法2/3：占位 —— 案例库积累到有意义的样本量、能跑真实LOOCV验证之前，明确报告"未启用"，
// 不产出任何看起来像结果、实际没验证过的数字。样本量门槛只是参考经验值，真正的启用条件是
// loocvBeatsBaseline() 跑赢中位数法基线，不是单纯数够了就自动信。 =====
function linearMethod(/* key, cases, predictorKeys */){
  return { valid:false, reason:"案例库暂无数据，线性/GBM统计模型尚未实现——等有真实案例后再接入训练逻辑" };
}
function rfMethod(/* key, cases, predictorKeys */){
  return { valid:false, reason:"案例库暂无数据，随机森林/GBDT尚未实现（经验门槛：样本量需达到所用特征数的5-10倍）" };
}
const METHODS = { median: medianMethod, linear: linearMethod, rf: rfMethod };

// ===== LOOCV门槛（骨架）：真正接入回归/RF训练代码后，这里应对每条case做留一验证，
// 比较该方法和medianMethod在被留出的case上的预测误差(MAE)，明显优于基线才允许参与投票——
// 避免小样本训练出的模型看着有数字、实际比瞎猜中位数还不稳。方法本身是stub时恒定返回false。 =====
function loocvBeatsBaseline(methodName, key, cases, opts){
  const method = METHODS[methodName];
  if(!method) return false;
  const probe = method(key, cases, (opts&&opts.predictorKeys)||[]);
  if(!probe.valid) return false;
  // 真实实现：对cases做留一交叉验证，分别算method和medianMethod的MAE，method明显更小才return true。
  // 目前linear/rf恒定valid=false，这段永远不会走到；先占位，接口就位。
  return false;
}

// ===== 置信度分级 =====
// 有≥2个方法投票时，用方法间估计值的变异系数(CoV)判断：一致→高，小分歧→中，分歧大→低（强制人工）。
// 目前实际只有中位数法一个来源，退化为按证据条数分级（沿用 aireport.js 现行规则，行为不变）。
function confidenceBand(votes, medianResult){
  if(votes.length>=2){
    const vals = votes.map(v=>v.value);
    const mean = vals.reduce((s,v)=>s+v,0)/vals.length;
    const sd = Math.sqrt(vals.reduce((s,v)=>s+(v-mean)*(v-mean),0)/vals.length);
    const cov = mean? Math.abs(sd/mean) : (sd===0? 0 : Infinity);
    if(cov<0.05) return "高";
    if(cov<0.15) return "中";
    return "低（方法间分歧较大，建议人工确认）";
  }
  if(medianResult.tier==="region") return medianResult.n>=2 ? "高" : "中";
  if(medianResult.tier==="other") return "中";
  return "低";
}

// ===== 越界检测（骨架） =====
// 中位数法本身不外推（只会返回真实案例的中位数），暂不需要拦截；等回归/RF接入后，
// 新项目特征落在案例库分布范围外时，这里应返回 ood:true，ensemble时跳过回归/RF的投票、只信中位数法/人工。
function checkOOD(/* key, cases, targetFeatures */){
  return { ood:false, reason:"当前唯一启用的方法(中位数法)不做外推，暂不需要越界拦截" };
}

// ===== 防止目标参数互相循环依赖 =====
// targetKeys 中任意一个key，不能出现在别的目标参数的 predictorKeys 里，否则会形成"用待预测值去预测另一个待预测值"
// 的循环依赖，产生虚假置信度。predictorMap: {targetKey: [predictorKey, ...]}
function assertNoLeakage(targetKeys, predictorMap){
  const targetSet = new Set(targetKeys);
  Object.keys(predictorMap||{}).forEach(tKey=>{
    (predictorMap[tKey]||[]).forEach(p=>{
      if(p!==tKey && targetSet.has(p)){
        throw new Error("参数估算配置错误："+tKey+" 的预测特征里包含了另一个待预测目标 "+p+"，会造成循环依赖");
      }
    });
  });
}

// ===== 从敏感性分析结果里挑目标参数，替代手工维护的固定短名单 =====
// sensResult: admin.html「敏感性分析」跑完的结果对象 {table:[{key,label,group,combinedRank?,STi?,spearmanRho?,src?}], methods:[...]}
// opts.topN: 取前几名，默认10；opts.derivedKeys: 由其他参数算出来的键（如rent类型的operateYears=70-buildYears），
// 即使排名靠前也要排除——这类参数不该被"预测"，应该继续按公式推导。
// 没有可用的敏感性结果时返回null，调用方应回退到自己维护的默认目标参数名单。
function resolveTargetParams(sensResult, opts){
  opts = opts || {};
  const topN = opts.topN || 10;
  const derivedKeys = new Set(opts.derivedKeys || []);
  if(!sensResult || !Array.isArray(sensResult.table) || !sensResult.table.length) return null;
  const rankOf = (row) => {
    if(row.combinedRank!=null) return row.combinedRank;
    if(row.STi!=null) return -row.STi;
    if(row.spearmanRho!=null) return -Math.abs(row.spearmanRho);
    if(row.src!=null) return -Math.abs(row.src);
    return Infinity;
  };
  const ranked = sensResult.table.slice().sort((a,b)=>rankOf(a)-rankOf(b));
  const out = [];
  for(const row of ranked){
    if(derivedKeys.has(row.key)) continue;
    out.push({ key: row.key, label: row.label, group: row.group });
    if(out.length>=topN) break;
  }
  return out;
}

// ===== 统一入口：对一个目标参数跑全部方法，按LOOCV门槛筛选后合并投票 =====
function estimateOne(key, cases, opts){
  opts = opts || {};
  const location = opts.location || "";
  const predictorKeys = opts.predictorKeys || [];
  const results = {
    median: medianMethod(key, cases, location, opts.industryDefault, predictorKeys),
    linear: linearMethod(key, cases, predictorKeys),
    rf: rfMethod(key, cases, predictorKeys),
  };
  const votingMethods = ["linear","rf"].filter(m=> results[m].valid && loocvBeatsBaseline(m, key, cases, opts));
  const votes = [results.median].concat(votingMethods.map(m=>results[m])).filter(r=>r.valid);
  const value = votes.length ? median(votes.map(v=>v.value)) : results.median.value;
  return {
    key,
    value,
    confidence: confidenceBand(votes.length>1? votes : [], results.median),
    ood: checkOOD(key, cases, opts.targetFeatures),
    votingMethods: ["median"].concat(votingMethods),
    methods: results,
  };
}

// ===== 批量：对一批目标参数各跑一次 estimateOne =====
function estimateAll(targetKeys, cases, opts){
  const out = {};
  targetKeys.forEach(key=>{ out[key] = estimateOne(key, cases, opts); });
  return out;
}

return {
  median, sameRegion,
  medianMethod, linearMethod, rfMethod,
  loocvBeatsBaseline, confidenceBand, checkOOD, assertNoLeakage,
  resolveTargetParams, estimateOne, estimateAll,
};
});
