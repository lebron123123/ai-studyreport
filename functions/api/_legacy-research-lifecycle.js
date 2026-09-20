const fields=['legacyResearchAbandoned','legacyResearchAbandonedAt','legacyResearchEpoch'];
export function legacyResearchLifecycle(data){const mg=data?.workflow?.management||{};return {legacyResearchAbandoned:mg.legacyResearchAbandoned===true,legacyResearchAbandonedAt:Number(mg.legacyResearchAbandonedAt)||0,legacyResearchEpoch:Number(mg.legacyResearchEpoch)||0};}
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function reportState(data){const copy={...data};delete copy.project;delete copy.signed;copy.workflow={...copy.workflow};delete copy.workflow.management;return copy;}
export function guardLegacyResearchSave(previous,incoming,epoch){
 const state=legacyResearchLifecycle(previous),changed=stable(reportState(previous))!==stable(reportState(incoming));
 if(changed&&state.legacyResearchAbandoned)return {ok:false,error:'此可研已废止，正文与历史仅可查看；请恢复后修改',conflict:true};
 if(changed&&state.legacyResearchEpoch>0&&Number(epoch)!==state.legacyResearchEpoch)return {ok:false,error:'可研生命周期已变化，请重新打开后再保存；旧任务未写入',conflict:true};
 incoming.workflow=incoming.workflow||{};incoming.workflow.management={...incoming.workflow.management};
 for(const field of fields)incoming.workflow.management[field]=state[field];
 return {ok:true};
}
