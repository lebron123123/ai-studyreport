import test from 'node:test';
import assert from 'node:assert/strict';
import {signDimensions, createAnjuRooftopSign, ANJU_LOGO_URL} from '../project-map/anju-rooftop-sign.mjs';

test('preserves supplied artwork ratio without cropping', () => {
  assert.deepEqual(signDimensions(10, 1495, 1426), {width:10, height:10*1426/1495});
  assert.match(ANJU_LOGO_URL, /anju-logo-user\.png$/);
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => signDimensions(value, 10, 10));
});

test('requires host building and finite local anchor', () => {
  assert.throws(() => createAnjuRooftopSign({}, {}, {width:10,imageWidth:10,imageHeight:10,position:{x:0,y:0,z:0}}));
});

test('parent unloading releases geometry, material and texture exactly once', () => {
  const released = [], callbacks = [];
  const B = {
    Mesh: {DOUBLESIDE:2},
    MeshBuilder: {CreatePlane: () => ({position:{set(){}},rotation:{},dispose(){released.push('mesh');}})},
    StandardMaterial: class {dispose(){released.push('material');}},
    Texture: class {dispose(){released.push('texture');}}, Color3: class {}
  };
  const sign = createAnjuRooftopSign(B, {}, {
    parent:{onDisposeObservable:{addOnce(fn){callbacks.push(fn);}}},
    width:10,imageWidth:1495,imageHeight:1426,position:{x:0,y:300,z:0}
  });
  assert.equal(sign.mesh.metadata.status, 'requested-signage-not-surveyed');
  callbacks[0](); sign.dispose();
  assert.deepEqual(released, ['mesh','material','texture']);
});
