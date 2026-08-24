import test from "node:test";
import assert from "node:assert/strict";
import { enrichCustomTemplatePlan, usableTemplatePages } from "../local-server/ppt-custom-template-export.js";

const page=(n,role="analysis",review="accepted")=>({
  id:"page:"+n,page:n,name:"模板页 "+n,role,layoutId:role,status:review==="accepted"?"approved":"candidate",
  review:{status:review},slotContract:{slots:[
    {shapeId:"shape_"+n+"_title",sourceId:String(n*10+1),nativeKey:"shape:"+(n*10+1),role:"title",capacity:60,required:true},
    {shapeId:"shape_"+n+"_body",sourceId:String(n*10+2),nativeKey:"shape:"+(n*10+2),role:"body",capacity:180}
  ]}
});

test("已发布真实模板只把准入页送入导出选择",()=>{
  const profile={pages:[page(1,"cover","accepted"),page(2,"analysis","rejected"),page(3,"analysis","candidate")]};
  assert.deepEqual(usableTemplatePages(profile,{published:true}).map(item=>item.page),[1]);
  assert.deepEqual(usableTemplatePages(profile,{published:false}).map(item=>item.page),[1,3]);
});

test("整套真实模板导出计划为每页选择独立源页并生成Shape ID填充",()=>{
  const record={id:"pt_demo",name:"青年人才住房模板",status:"draft",profile:{pages:[page(1,"cover"),page(2,"analysis"),page(3,"analysis")]}};
  const plan={title:"项目决策汇报",purpose:"经营决策",slides:[
    {title:"项目决策汇报",layoutId:"cover"},
    {title:"项目价值判断",layoutId:"analysis",bullets:["具备推进条件"]}
  ]};
  const out=enrichCustomTemplatePlan(plan,record);
  assert.equal(out.nativeTemplate,true);
  assert.equal(out.nativeTemplateMode,"explicit-pages");
  assert.equal(out.realTemplateRecordId,"pt_demo");
  assert.deepEqual(out.slides.map(slide=>slide.templatePage),[1,2]);
  assert.equal(out.slides[0].templateFillMode,"strict-shape-id");
  assert.deepEqual(out.slides[1].templateFillPlan.actions.map(action=>action.sourceId),["21","22"]);
});
