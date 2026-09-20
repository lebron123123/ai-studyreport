import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectObserver} from '../project-map/project-observer.mjs';
const make=value=>{const o=new ProjectObserver();o.begin({x:0,y:100,z:0},200,.65,.32);o.setSpeed(value);return o;};
test('all five speed presets scale actual planar movement and preserve look sensitivity',()=>{
 const distance=value=>{const o=make(value),before=o.pose();o.step(new Set(['KeyW']),.03,()=>0,[-50000,-50000,50000,50000]);return Math.hypot(o.pose().x-before.x,o.pose().z-before.z);};
 const base=distance(1);for(const speed of [1,5,10,20,40]){assert.ok(Math.abs(distance(speed)/base-speed)<1e-8);const o=make(speed),yaw=o.yaw;o.step(new Set(['ArrowRight']),.03,()=>0,[-50000,-50000,50000,50000]);assert.ok(Math.abs(o.yaw-yaw-.0315)<1e-8);}
});
test('invalid or obsolete speed restores safe 1x and 40x elevation stays within limits',()=>{
 for(const v of [null,undefined,'bad',NaN,Infinity,0,-1,4,100])assert.equal(make(v).speedMultiplier,1);
 const o=make('40');assert.equal(o.speedMultiplier,40);for(let i=0;i<200;i++)o.step(new Set(['KeyE']),.05,()=>0,[-50000,-50000,50000,50000]);assert.ok(o.pose().y<=2200);for(let i=0;i<500;i++)o.step(new Set(['KeyQ']),.05,()=>0,[-50000,-50000,50000,50000]);assert.ok(o.pose().y>=1.5);
});
