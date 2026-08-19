const test=require("node:test");
const assert=require("node:assert/strict");
const IR=require("../ppt-design-ir.js");

const plan={title:"项目决策汇报",purpose:"项目分析",templateId:"business-blue-160",designSpec:{},slides:new Array(6)};
const cases=[
  {layoutId:"cover",title:"项目决策汇报",subtitle:"基于正式材料"},
  {layoutId:"agenda",title:"汇报结构",bullets:["项目背景","关键指标","实施计划","决策建议"]},
  {layoutId:"statement",title:"核心结论决定项目推进节奏",subtitle:"先给结论，再展示证据"},
  {layoutId:"metric",title:"关键指标",content:{metrics:[{label:"总投资",value:"43.5亿元"},{label:"IRR",value:"5.6%"},{label:"工期",value:"16季度"},{label:"规模",value:"12万㎡"}]}},
  {layoutId:"timeline",title:"实施路径",content:{steps:[{label:"决策",text:"确认边界"},{label:"设计",text:"完成方案"},{label:"建设",text:"按期实施"},{label:"交付",text:"完成验收"}]}},
  {layoutId:"comparison",title:"方案比选",content:{columns:[{title:"方案A",items:["投资低","周期短"]},{title:"方案B",items:["品质高","弹性强"]}]},claim:"建议优先采用方案A"}
];

test("六类高频页面均生成合法Design IR",()=>{cases.forEach((slide,i)=>{const scene=IR.buildScene(slide,plan,i);assert.ok(scene,slide.layoutId);assert.equal(scene.schema,"ppt-design-ir");assert.ok(scene.elements.length>=5);const qa=IR.inspect(scene);assert.equal(qa.ok,true,qa.errors.join("；"));});});
test("浏览器预览由同一IR生成且不含undefined",()=>{const scene=IR.buildScene(cases[3],plan,3),html=IR.renderHtml(scene);assert.match(html,/ppt-ir-scene/);assert.doesNotMatch(html,/undefined|NaN/);});
test("不支持的页面回退旧渲染器",()=>{assert.equal(IR.buildScene({layoutId:"table",title:"表格"},plan,0),null);});
