/* Representative source-page governance for the 160-page template library. */
(function(root){
  "use strict";
  const TARGET=36;
  function selectGoldenPages(library={},limit=TARGET){
    const recipes=library.recipes||[],components=library.components||[],picked=[],seen=new Set(),push=(page,reason,family,ref)=>{page=Number(page);if(!page||seen.has(page)||picked.length>=limit)return;seen.add(page);const component=components.find(x=>(x.sourcePages||[]).includes(page))||{};picked.push({page,reason,family,referenceId:ref||component.id||"",status:"baseline",checks:["缩略图人工审查","形状坐标完整","槽位容量明确","原生可编辑","预览导出一致","无溢出遮挡"]});};
    recipes.forEach(r=>push(r.representativePage||(r.sourcePages||[])[0],"整页配方代表页",r.family,r.id));
    recipes.forEach(r=>(r.sourcePages||[]).slice(1).forEach(p=>push(p,"同类构图差异页",r.family,r.id)));
    components.slice().sort((a,b)=>(b.confidence||0)-(a.confidence||0)).forEach(c=>push(c.representativePage||(c.sourcePages||[])[0],"高置信组件来源页",c.family,c.id));
    return{version:1,target:limit,selected:picked.length,pages:picked,coverage:{families:[...new Set(picked.map(x=>x.family).filter(Boolean))],recipes:[...new Set(picked.map(x=>x.referenceId).filter(Boolean))].length},acceptanceRule:"六项检查全部通过后，页面或组件才能从baseline升级为active"};
  }
  function componentContract(pageProfile={}){const geometry=pageProfile.geometry||{},slots=geometry.slots||pageProfile.slotContract&&pageProfile.slotContract.slots||[];return{sourcePage:pageProfile.page,layoutId:pageProfile.layoutId||pageProfile.family||"unknown",cloneMode:"native-ooxml-group",preserveGeometry:true,preserveZOrder:true,editableShapeCount:geometry.editableShapeCount||pageProfile.shapeCount||0,slots:slots.map(x=>({shapeId:x.shapeId,role:x.role,type:x.type,capacity:x.capacity,required:!!x.required})),capacity:{minItems:Math.max(1,Math.min(3,slots.length)),maxItems:Math.max(1,Math.min(12,slots.length))},status:slots.length?"ready-for-visual-review":"needs-slot-analysis"};}
  const api={TARGET,selectGoldenPages,componentContract};root.PptTemplateGolden=api;if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
