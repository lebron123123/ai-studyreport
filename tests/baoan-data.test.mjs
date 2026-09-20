import {test} from 'node:test';
import assert from 'node:assert/strict';
import {heightInfo,nearestTiles} from '../project-map/baoan-data.mjs';
test('height provenance and invalid heights are never silently invented',()=>{
 assert.equal(heightInfo({height:'36 m'}).height,36);
 assert.equal(heightInfo({'building:levels':'5'}).height,15);
 for(const height of ['-5','unknown','12 ft','2000',''])assert.equal(heightInfo({height}).kind,'unknown');
 assert.equal(heightInfo({height:'20','building:levels':'5'}).kind,'tag');
});
test('nearby budget and out of coverage',()=>{
 const tiles=[0,1,2,3].map(i=>({center:[113.88+i*.001,22.6]}));
 assert.equal(nearestTiles(tiles,[113.88,22.6]).length,2);
 assert.equal(nearestTiles(tiles,[114.5,22.6]).length,0);
 assert.throws(()=>nearestTiles(tiles,[NaN,22]));
});
