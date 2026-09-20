import test from 'node:test';
import assert from 'node:assert/strict';
import {coverageFeatures,coverageOutline,showCoverage} from '../project-map/coverage.mjs';
import {inCityCoverage,scenePoint} from '../project-map/core.mjs';
import {nearbyTiles} from '../project-map/baoan-city-stream.mjs';
const c={origin:[114.025,22.536],scale:.6,originalTiles:[{bounds:[0,0,600,600]}],baoanTiles:[{key:'futian:a',bounds:[114.06,22.6,114.07,22.61],count:3,known:1},{key:'road',bounds:[114.2,22.6,114.21,22.61],count:0}]};
test('coverage uses real model blocks, excludes context-only cells and shares entry gate',()=>{
 const f=coverageFeatures(c).features;assert.equal(f.length,2);
 for(const item of f){const r=item.geometry.coordinates[0];assert.deepEqual(r[0],r.at(-1));assert.equal(inCityCoverage([(r[0][0]+r[2][0])/2,(r[0][1]+r[2][1])/2],c),true);}
 assert.equal(inCityCoverage([114.205,22.605],c),false);assert.equal(inCityCoverage([114.03,22.55],c),false);
});
test('coverage toggle is idempotent and reload/empty/loading safe',()=>{
 const sources=new Map(),layers=new Map();const map={isStyleLoaded:()=>true,getSource:id=>sources.get(id),addSource:(id,s)=>sources.set(id,{...s,setData(d){this.data=d;}}),addLayer:l=>layers.set(l.id,l),setLayoutProperty:(id,key,value)=>{layers.get(id)[key]=value;}};
 for(let i=0;i<10;i++){showCoverage(map,c,true);assert.equal(layers.get('model-coverage-line').visibility,'visible');showCoverage(map,c,false);assert.equal(layers.get('model-coverage-line').visibility,'none');}
 assert.equal(layers.size,1);assert.equal(sources.size,1);showCoverage(map,{...c,originalTiles:[],baoanTiles:[]},true);assert.equal(sources.get('model-coverage').data.features.length,0);
 showCoverage(null,c,true);showCoverage({isStyleLoaded:()=>false},c,true);
});
test('outline dissolves adjacent and overlapping rectangles without bridging gaps',()=>{
 const outline=rects=>coverageOutline({baoanTiles:rects.map(bounds=>({bounds,count:1}))}).features[0].geometry.coordinates;
 const length=lines=>lines.reduce((s,[a,b])=>s+Math.hypot(a[0]-b[0],a[1]-b[1]),0);
 assert.equal(length(outline([[0,0,1,1],[1,0,2,1]])),6);
 assert.equal(length(outline([[0,0,2,1],[1,0,3,1]])),8);
 assert.equal(length(outline([[0,0,1,1],[2,0,3,1]])),8);
 const ring=[];for(let x=0;x<3;x++)for(let y=0;y<3;y++)if(x!==1||y!==1)ring.push([x,y,x+1,y+1]);
 assert.equal(length(outline(ring)),16); // outer perimeter 12 + true hole 4
});
test('all districts share 9-block budget, far blocks leave candidate set',()=>{
 const tiles=Array.from({length:50},(_,i)=>({...c.baoanTiles[0],key:`district${i%4}:${i}`})),p=scenePoint([114.065,22.605],c);
 assert.equal(nearbyTiles(tiles,p,c).length,9);assert.equal(nearbyTiles(tiles,{x:1e8,z:1e8},c).length,0);
});
