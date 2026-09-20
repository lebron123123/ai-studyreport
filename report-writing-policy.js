/* 全篇写作要求：前台、后台、生成与旧逻辑快照共用同一份无副作用投影。 */
(function(root){
  "use strict";
  const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj||{},key);
  function split(text){
    const policies=[],lines=String(text||"").split(/\r?\n/).filter(line=>{
      const match=line.match(/^\s*全篇执行[：:]\s*(.+)$/);
      if(!match)return true;
      policies.push(match[1].trim());return false;
    });
    return {text:lines.join("\n").trim(),policies:[...new Set(policies)]};
  }
  function normalize(data){
    if(!data||typeof data!=="object")return data;
    const next=JSON.parse(JSON.stringify(data)),collected={};
    const scopes=next.projectType==="gaibao"?["housing_conversion","commercial_renovation"]:[next.projectType||"rent"];
    const globals=next.globalRequirements&&typeof next.globalRequirements==="object"&&!Array.isArray(next.globalRequirements)?next.globalRequirements:{};
    scopes.forEach(scope=>collected[scope]=[]);
    (next.rules||[]).forEach(rule=>{
      const base=split(rule.writingLogic);
      scopes.forEach(scope=>{
        if(next.projectType==="gaibao"&&Array.isArray(rule.scenarios)&&rule.scenarios.length&&!rule.scenarios.includes(scope))return;
        const variant=rule.scenarioVariants?.[scope],parts=split(variant&&own(variant,"writingLogic")?variant.writingLogic:rule.writingLogic);
        collected[scope].push(...parts.policies);
      });
      rule.writingLogic=base.text;
      Object.values(rule.scenarioVariants||{}).forEach(variant=>{if(own(variant,"writingLogic"))variant.writingLogic=split(variant.writingLogic).text;});
    });
    next.globalRequirements={...globals};
    scopes.forEach(scope=>{
      // 显式字段优先，包括管理员主动清空；旧规则不能把已删除的要求重新加回来。
      next.globalRequirements[scope]=own(globals,scope)?String(globals[scope]??""):[...new Set(collected[scope])].join("\n");
    });
    if(next.projectType==="gaibao"){
      next.globalRequirements.housing_conversion=removePoiGlobal(next.globalRequirements.housing_conversion);
      (next.rules||[]).filter(r=>["gaibao-v1-022","gaibao-v1-032"].includes(r.id)).forEach(r=>{
        const variant=r.scenarioVariants?.housing_conversion;
        if(variant&&!String(variant.writingLogic||"").includes(housingEvidenceGuard))variant.writingLogic=String(variant.writingLogic||"")+"\n"+housingEvidenceGuard;
      });
    }
    return next;
  }
  const housingEvidenceGuard="非居改保正文强制约束：全文（含标题、表名、表头、图注和小结）严禁出现POI、P.O.I.、兴趣点、点位密度、岗位类占比及以地图点位推算职住比的表达；不得仅把POI改名为公司数量或产业数量。仅在有可核验的具体公司、产业园或产业类别名称清单及来源时，按实际清单客观列举周边公司、产业园或产业类别；需要数量时必须说明统计范围、时间和去重口径，清单数量不外推为区域总量，不与就业人数、人口或租赁需求等同。没有具体名单或可靠依据时省略这部分分析及表格，不写待补占位，不复述本禁令。与旧规则或输入材料冲突时以本约束为准。";
  function requirements(data,scope){
    return normalize(data)?.globalRequirements?.[scope]||"";
  }
  function removePoiGlobal(text){return String(text||"").replace(housingEvidenceGuard,"").trim();}
  function snapshot(snapshot){
    const next=JSON.parse(JSON.stringify(snapshot||{})),policies=[];
    next.rules=(next.rules||[]).map(rule=>{const parts=split(rule.writingLogic);policies.push(...parts.policies);return {...rule,writingLogic:parts.text};});
    next.globalRequirements=own(next,"globalRequirements")?String(next.globalRequirements??""):[...new Set(policies)].join("\n");
    // Undo only our exact previous global addition, not other administrator changes.
    next.globalRequirements=removePoiGlobal(next.globalRequirements);
    return next;
  }
  const api={split,normalize,requirements,snapshot};
  root.ReportWritingPolicy=api;
  if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
