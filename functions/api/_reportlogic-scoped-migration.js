// A housing baseline revision must never replace commercial/custom rules.
export function mergeHousingRevision(previous, target) {
  const next=structuredClone(previous),scope='housing_conversion';
  const changed=new Set([3,4,5,6,7,8,9,10,11,16,17,19,21,22,24,26,27,29,32,33,40,75,76,77,78].map(n=>`gaibao-v1-${String(n).padStart(3,'0')}`));
  for(const incoming of target.rules){
    if(!changed.has(incoming.id))continue;
    const existing=next.rules.find(r=>r.id===incoming.id);
    if(existing){
      existing.scenarios=[...new Set([...(existing.scenarios||[]),scope])];
      existing.scenarioVariants={...existing.scenarioVariants,[scope]:structuredClone(incoming.scenarioVariants[scope])};
    }else next.rules.push(structuredClone(incoming));
  }
  next.globalRequirements={...next.globalRequirements,[scope]:target.globalRequirements[scope]};
  next.structure={...next.structure,scenarioStructures:{...next.structure?.scenarioStructures,[scope]:structuredClone(target.structure.scenarioStructures[scope])}};
  next.source={...next.source,baselineId:target.source.baselineId,fileName:target.source.fileName,changeBasis:target.source.changeBasis,scopedMigration:scope};
  next.name=target.name;
  return next;
}
