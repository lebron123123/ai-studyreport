import test from 'node:test';import assert from 'node:assert/strict';
import {selectLabels} from '../project-map/place-labels.mjs';
test('labels prioritize important places and reject collisions, offscreen and invalid coordinates',()=>{
 const result=selectLabels([{id:'a',name:'重要地标',priority:100,x:200,y:100},{id:'b',name:'普通道路',priority:20,x:205,y:100},{id:'c',name:'无效',x:NaN,y:0},{id:'d',name:'屏外',x:-1,y:20}],800,600);
 assert.deepEqual(result.map(i=>i.id),['a']);
});
test('labels enforce visible budget and support empty catalog',()=>{
 assert.deepEqual(selectLabels([],800,600),[]);
 const rows=Array.from({length:40},(_,i)=>({id:i,name:'楼',x:80+(i%8)*100,y:50+Math.floor(i/8)*80}));
 assert.equal(selectLabels(rows,900,600,12).length,12);
});
