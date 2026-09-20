import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRenderBudget} from '../project-map/render-budget.mjs';
test('idle redraw is bounded; navigation and state changes wake rendering',()=>{
 const budget=createRenderBudget();
 for(let t=0;t<10000;t+=10)budget.shouldRender(t,{state:'same'});
 assert.equal(budget.frames,10);
 assert.equal(budget.shouldRender(9990,{state:'changed'}),true);
 assert.equal(budget.shouldRender(10000,{active:true,state:'changed'}),false);
 assert.equal(budget.shouldRender(10030,{active:true,state:'changed'}),true);
});
test('hidden tabs never render; resumed tabs can render',()=>{
 const budget=createRenderBudget();
 for(let t=0;t<10000;t+=10)budget.shouldRender(t,{hidden:true,active:true});
 assert.equal(budget.frames,0);
 assert.equal(budget.shouldRender(10000,{state:'resume'}),true);
});
