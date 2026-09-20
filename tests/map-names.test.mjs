import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyBaseNames} from '../project-map/map-names.mjs';
test('name modes preserve mixed icons, roads and original opacity expressions',()=>{
 const expression=['interpolate',['linear'],['zoom'],10,0,15,1];
 const layers=[{id:'road',type:'line'},{id:'mixed',type:'symbol',layout:{'text-field':'name','icon-image':'bus'}},{id:'dim',type:'symbol',layout:{'text-field':'name'}},{id:'icon',type:'symbol',layout:{'icon-image':'bus'}}];
 const values=new Map([['mixed',expression],['dim',0]]),map={getStyle:()=>({layers}),getPaintProperty:id=>values.get(id),setPaintProperty:(id,key,v)=>{assert.equal(key,'text-opacity');values.set(id,v);}};
 const originals=new Map();
 for(let i=0;i<5;i++){applyBaseNames(map,'important',originals);assert.equal(values.get('mixed'),0);applyBaseNames(map,'none',originals);applyBaseNames(map,'all',originals);assert.deepEqual(values.get('mixed'),expression);assert.equal(values.get('dim'),0);}
 assert.equal(values.has('road'),false);assert.equal(values.has('icon'),false);assert.equal(layers[1].layout['icon-image'],'bus');
 layers.push({id:'new',type:'symbol',layout:{'text-field':'name'}});applyBaseNames(map,'none',originals);assert.equal(values.get('new'),0);applyBaseNames(map,'all',originals);assert.equal(values.get('new'),1);
});
