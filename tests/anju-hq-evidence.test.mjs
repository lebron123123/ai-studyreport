import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {anjuHQEvidence,validateHQEvidence} from '../project-map/anju-hq-evidence.mjs';
import {scenePoint,landmarkCoordinate} from '../project-map/core.mjs';

test('headquarters uses completed-height reference and keeps uncertainty explicit',()=>{
 assert.equal(validateHQEvidence(),anjuHQEvidence);
 assert.equal(anjuHQEvidence.buildings[0].height,299.1);
 assert.equal(anjuHQEvidence.buildings[1].height,235.2);
 assert.equal(anjuHQEvidence.logo.host,'tower-a');
 assert.notEqual(anjuHQEvidence.status,'accepted');
 assert.ok(anjuHQEvidence.pending.includes('city-overlap-removal'));
});
test('headquarters footprint transforms round-trip without GCJ offset or axis swap',()=>{
 const c=JSON.parse(fs.readFileSync(new URL('../project-map/models/catalog.json',import.meta.url)));
 for(const b of anjuHQEvidence.buildings)for(const p of b.ring){
  const back=landmarkCoordinate(scenePoint(p,c),c);
  assert.ok(Math.abs(back[0]-p[0])<1e-10&&Math.abs(back[1]-p[1])<1e-10);
 }
});
test('invalid or displaced headquarters data is rejected',()=>{
 const bad=structuredClone(anjuHQEvidence);bad.buildings[0].ring[0][0]=114.2;
 assert.throws(()=>validateHQEvidence(bad));
 const wrong=structuredClone(anjuHQEvidence);wrong.logo.host='tower-b';
 assert.throws(()=>validateHQEvidence(wrong));
});
