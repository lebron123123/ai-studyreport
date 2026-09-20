import test from 'node:test';
import assert from 'node:assert/strict';
import {offlineStyle,geometryLayers,attachOffline} from '../project-map/offline-map.mjs';
test('offline style has no external resource dependency',()=>{assert.equal(JSON.stringify(offlineStyle()).includes('https:'),false);assert.equal(offlineStyle().glyphs,undefined);});
test('geometry layer IDs and sources are isolated per chunk',()=>{const layers=geometryLayers('tile-a');assert.equal(new Set(layers.map(l=>l.id)).size,4);assert.ok(layers.every(l=>l.source==='tile-a'));assert.ok(layers.every(l=>!geometryLayers('tile-b').some(b=>b.id===l.id)));});
test('nearby chunks capped at 16 and removed when zooming out',async()=>{
 const original=globalThis.fetch, sources=new Set(), events={};let zoom=13;
 globalThis.fetch=async()=>({ok:true,json:async()=>({tiles:Array.from({length:30},(_,i)=>(2274+i)+'_452')})});
 const map={once:(e,f)=>{events[e]=f;},on:(e,f)=>{events[e]=f;},off:()=>{},addSource:id=>sources.add(id),removeSource:id=>sources.delete(id),addLayer:()=>{},removeLayer:()=>{},getBounds:()=>({getWest:()=>113.7,getEast:()=>115.2,getSouth:()=>22.6,getNorth:()=>22.64}),getCenter:()=>({lng:114,lat:22.6}),getZoom:()=>zoom};
 try{await attachOffline(map,()=>{});assert.equal(sources.size,17);zoom=10;events.moveend();assert.deepEqual([...sources],['offline-overview']);events.remove();}finally{globalThis.fetch=original;}
});
