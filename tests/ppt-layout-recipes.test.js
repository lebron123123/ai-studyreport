import test from "node:test";
import assert from "node:assert/strict";
import "../ppt-layout-recipes.js";

const R=globalThis.PptLayoutRecipes;
test("整页配方首批覆盖18类高频页面",()=>{assert.equal(R.recipes.length,18);assert.ok(R.recipes.every(x=>x.sourcePages.length));});
test("无双栏数据的多方案比较优先四方案决策卡",()=>{const x=R.recommend({type:"content",layoutId:"comparison",title:"四种投资分摊方式对比",bullets:["一次性投入","平均分摊","前高后低","S型分摊"]});assert.equal(x.selected.id,"compare-scorecard");});
test("具有两组结构化columns时优先双方案结论对比",()=>{const x=R.recommend({type:"content",layoutId:"comparison",title:"两种方案对比",content:{columns:[{title:"A",items:["a"]},{title:"B",items:["b"]}]}});assert.equal(x.selected.id,"compare-dual");});
test("内容密度能区分低中高",()=>{assert.equal(R.densityOf({title:"一句结论",bullets:[]}),"low");assert.equal(R.densityOf({title:"分析",bullets:Array.from({length:8},(_,i)=>"较长分析内容"+i)}),"high");});
test("分摊对比不会被正文中的阶段词误判为计划页",()=>{const x=R.recommend({type:"content",layoutId:"comparison",title:"投资分摊模型对比：选择最优策略",bullets:["一次性投入","平均分摊","前高后低","S型分摊适合工程推进阶段"]});assert.equal(x.role,"comparison");assert.equal(x.selected.id,"compare-scorecard");});
