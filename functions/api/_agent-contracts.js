export const AGENT_RISK_LEVELS = Object.freeze({READ:"read",WRITE:"write",EXTERNAL:"external",DESTRUCTIVE:"destructive"});
export const AGENT_TOOLSETS = Object.freeze({REPORT:"report",CALC:"calc",KNOWLEDGE:"knowledge",PPT:"ppt",OFFICE:"office",SYSTEM:"system"});

export function normalizeAgentTool(name,def={}){
  const risk=Object.values(AGENT_RISK_LEVELS).includes(def.risk)?def.risk:AGENT_RISK_LEVELS.READ;
  return {
    name, version:String(def.version||"1.0.0"), risk,
    toolset:String(def.toolset||AGENT_TOOLSETS.SYSTEM),
    requiresApproval:def.requiresApproval===true || risk===AGENT_RISK_LEVELS.DESTRUCTIVE,
    idempotent:def.idempotent!==false,
    timeoutMs:Math.max(1000,Math.min(Number(def.timeoutMs)||30000,120000))
  };
}

export function buildAgentContextLayers(input={}){
  return {
    instruction:{system:String(input.system||""),latestUser:String(input.latestUser||"")},
    working:{projectId:String(input.projectId||""),state:input.state||{},recentMessages:(input.recentMessages||[]).slice(-12)},
    knowledge:{rag:input.rag||[],wiki:input.wiki||[],rules:input.rules||[]},
    memory:{preferences:input.preferences||[],skills:input.skills||[],historySummary:String(input.historySummary||"")}
  };
}

export function contextLayersToPrompt(layers){
  const x=layers||buildAgentContextLayers();
  const parts=[];
  if(x.working && Object.keys(x.working.state||{}).length) parts.push("【当前任务状态】\n"+JSON.stringify(x.working.state));
  if(x.knowledge && (x.knowledge.rules||[]).length) parts.push("【适用规则】\n"+x.knowledge.rules.join("\n"));
  if(x.memory && (x.memory.skills||[]).length) parts.push("【已审核技能】\n"+x.memory.skills.join("\n"));
  return parts.length?"\n\n"+parts.join("\n\n"):"";
}
