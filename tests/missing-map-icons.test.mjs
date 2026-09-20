import test from 'node:test';
import assert from 'node:assert/strict';
import {missingMapIcon,attachMissingMapIcons} from '../project-map/missing-map-icons.mjs';
test('known missing POIs produce distinct nonempty local icons, unknown errors stay visible',()=>{
 const fingerprints=new Set();
 for(const id of ['gate','lift_gate','bollard','cycle_barrier','swimming_pool','running']){
  const image=missingMapIcon(id);assert.equal(image.data.length,image.width*image.height*4);assert.ok(image.data.some(v=>v===255));fingerprints.add(Buffer.from(image.data).toString('base64'));
 }
 assert.equal(fingerprints.size,6);assert.equal(missingMapIcon('unrecognized-image'),null);
});
test('missing sprite handler is idempotent and detachable',()=>{
 const images=new Map();let handler;let removed=false;
 const map={on(n,h){assert.equal(n,'styleimagemissing');handler=h;},off(n,h){removed=h===handler;},hasImage:id=>images.has(id),addImage(id,image,options){assert.equal(options.pixelRatio,2);assert.ok(!images.has(id));images.set(id,image);}};
 const release=attachMissingMapIcons(map);handler({id:'gate'});handler({id:'gate'});handler({id:'unknown'});assert.equal(images.size,1);release();assert.ok(removed);
});
