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
    return next;
  }
  function requirements(data,scope){return normalize(data)?.globalRequirements?.[scope]||"";}
  function snapshot(snapshot){
    const next=JSON.parse(JSON.stringify(snapshot||{})),policies=[];
    next.rules=(next.rules||[]).map(rule=>{const parts=split(rule.writingLogic);policies.push(...parts.policies);return {...rule,writingLogic:parts.text};});
    next.globalRequirements=own(next,"globalRequirements")?String(next.globalRequirements??""):[...new Set(policies)].join("\n");
    return next;
  }
  const api={split,normalize,requirements,snapshot};
  root.ReportWritingPolicy=api;
  if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
