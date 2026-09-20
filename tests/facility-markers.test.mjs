import test from 'node:test';
import assert from 'node:assert/strict';
import {facilityStyles,facilityIcon,installFacilityLayer} from '../project-map/facility-markers.mjs';
test('six local icons have distinct colors and transparent corners',()=>{
 assert.equal(Object.keys(facilityStyles).length,6);
 const pixels=new Set();for(const style of Object.values(facilityStyles)){const icon=facilityIcon(style);assert.equal(icon.data.length,32*32*4);assert.equal(icon.data[3],0);assert.ok(icon.data.some((v,i)=>i%4===3&&v===255));pixels.add(Buffer.from(icon.data).toString('base64'));}assert.equal(pixels.size,6);
 assert.equal(facilityStyles['商业配套'].shape,'square');assert.equal(facilityStyles['公交'].shape,'circle');
});
test('layer installation is idempotent and restores after style reset',()=>{
 const images=new Map(),layers=new Map();const map={hasImage:id=>images.has(id),addImage:(id,v)=>images.set(id,v),getLayer:id=>layers.get(id),addLayer:v=>{assert.ok(!layers.has(v.id));layers.set(v.id,v);}};
 installFacilityLayer(map);installFacilityLayer(map);assert.equal(images.size,6);assert.equal(layers.size,1);assert.deepEqual(layers.get('research-facilities').filter,['==',['get','kind'],'facility']);images.clear();layers.clear();installFacilityLayer(map);assert.equal(images.size,6);assert.equal(layers.size,1);
});
