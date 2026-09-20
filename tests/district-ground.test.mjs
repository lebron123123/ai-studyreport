import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateDistrictGround} from '../project-map/district-ground.mjs';
const data=JSON.parse(fs.readFileSync(new URL('../project-map/city-relief-v1/luohu-ground.json',import.meta.url)));
const catalog=JSON.parse(fs.readFileSync(new URL('../project-map/models/catalog.json',import.meta.url)));
test('published Luohu ground is finite, indexed and in the city frame',()=>{
 assert.equal(validateDistrictGround(data,catalog),data);assert.equal(data.indices.length/3,6238);
 assert.ok(data.areaDifference<1e-12);assert.equal(data.sources.length,2);
});
test('invalid geometry and incompatible frames are rejected',()=>{
 assert.throws(()=>validateDistrictGround({...data,scale:999},catalog));
 assert.throws(()=>validateDistrictGround({...data,indices:[-1,0,1]},catalog));
 assert.throws(()=>validateDistrictGround({...data,positions:[NaN,0,0]},catalog));
});
