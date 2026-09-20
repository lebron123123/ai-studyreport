import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectObserver} from '../project-map/project-observer.mjs';
const tick=o=>o.step(new Set(),.04,()=>0,[-7000,-3000,7000,3000]);
test('scene rebuild restores exact district pose and copies state, invalid snapshots do not mutate',()=>{
 const first=new ProjectObserver();first.overview([-15000,0,-5000,20000]);first.setSpeed(20);first.rotate(25,-15);
 const saved=first.snapshot(),next=new ProjectObserver();assert.equal(next.restore(saved),true);assert.deepEqual(next.pose(),first.pose());assert.equal(next.speedMultiplier,20);assert.equal(next.ceiling,24000);
 saved.focus.x=999;assert.notEqual(next.focus.x,999);const before=next.snapshot();assert.equal(next.restore({...before,distance:NaN}),false);assert.deepEqual(next.snapshot(),before);
});
test('terrain collision applies after fast vertical descent and newly loaded relief',()=>{
 const o=new ProjectObserver();o.begin({x:0,y:205,z:0},3,0,0);o.setSpeed(40);
 o.step(new Set(['KeyQ']),.05,()=>200,[-1000,-1000,1000,1000]);
 assert.ok(o.pose().y>=201.5);
 o.step(new Set(),.05,()=>250,[-1000,-1000,1000,1000]);
 assert.ok(o.pose().y>=251.5);
});
test('street descent levels the aerial pitch without teleporting horizontal position',()=>{const o=new ProjectObserver();o.begin({x:-8000,y:38,z:1500},700,.65,.6);const before=o.pose();for(let i=0;i<30;i++)o.elevate(-20);const after=o.pose();assert.ok(Math.abs(after.x-before.x)<1e-6&&Math.abs(after.z-before.z)<1e-6);assert.ok(after.y>=1.5-1e-6);assert.ok(Math.abs(o.pitch)<1e-6);o.look(0,-.2);assert.equal(o.pitch,-.2);});
test('explicit district overview retains altitude until returning to normal focus',()=>{const o=new ProjectObserver();o.overview([-15000,0,-5000,20000]);const y=o.pose().y;tick(o);assert.ok(o.pose().y>2200);assert.ok(Math.abs(o.pose().y-y)<1e-6);o.begin({x:0,y:20,z:0},200,0,.2);assert.equal(o.ceiling,2200);assert.equal(o.maxDistance,3200);});
test('wheel cannot push target into sky, and reverse zoom returns',()=>{
 for(const pitch of [-1,-.2,.2,1]){
  const o=new ProjectObserver();o.begin({x:0,y:500,z:0},200,0,pitch);
  const focus={...o.focus};
  for(let i=0;i<100;i++){o.zoom(1e6);tick(o);}
  assert.ok(o.pose().y>=1.5-1e-6&&o.pose().y<=2200+1e-6);
  assert.ok(Math.abs(o.focus.y-focus.y)<1e-6);
  const far=o.distance;o.zoom(-120);tick(o);assert.ok(o.distance<far);
 }
});
test('high altitude descent works even after close zoom; elevation bounded',()=>{
 const o=new ProjectObserver();o.begin({x:0,y:1500,z:0},3,0,.2);
 const y=o.pose().y;for(let i=0;i<20;i++)o.step(new Set(['KeyQ']),.05,()=>0,[-7000,-3000,7000,3000]);
 assert.ok(y-o.pose().y>200);
 o.elevate(-1e6);assert.ok(Math.abs(o.pose().y-1.5)<1e-6);
 o.elevate(1e6);assert.ok(Math.abs(o.pose().y-2200)<1e-6);
});
