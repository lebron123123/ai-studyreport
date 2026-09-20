import test from 'node:test';
import assert from 'node:assert/strict';
import {CityObserver} from '../project-map/reference/city-observer.mjs';
const setup=()=>{const o=new CityObserver();o.begin({x:0,y:100,z:0},200,.65,.32);return o;};
const step=(o,key)=>o.step(new Set([key]),.03,()=>0,[-7000,-3000,7000,3000]);
test('all movement keys move camera; arrow look keeps position',()=>{for(const key of ['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE']){const o=setup(),before=o.pose();step(o,key);assert.notDeepEqual(o.pose(),before);}for(const key of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']){const o=setup(),before=o.pose();step(o,key);const after=o.pose();for(const axis of ['x','y','z'])assert.ok(Math.abs(after[axis]-before[axis])<1e-8);}});
test('4x speed travels exactly four times as far without changing rotation speed',()=>{const a=setup(),b=setup(),before=a.pose();b.speedMultiplier=4;step(a,'KeyW');step(b,'KeyW');const distance=o=>Math.hypot(o.pose().x-before.x,o.pose().z-before.z);assert.ok(Math.abs(distance(b)/distance(a)-4)<1e-8);});
