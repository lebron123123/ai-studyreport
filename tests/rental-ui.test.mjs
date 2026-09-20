import test from 'node:test';
import assert from 'node:assert/strict';
import {createRentalUI} from '../project-map/rental-ui.mjs';
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.style={};this.value='住宅';}
 append(...nodes){this.children.push(...nodes);} prepend(...nodes){this.children.unshift(...nodes);}
 replaceChildren(...nodes){this.children=nodes;} setAttribute(k,v){this[k]=v;}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('后台轮询保留已打开价格卡，关闭图层仍关闭卡片',async()=>{
 const previous={document:globalThis.document,maplibregl:globalThis.maplibregl,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};let tick,removed=0;
 globalThis.document={createElement:tag=>new Element(tag)};globalThis.setTimeout=fn=>{tick=fn;return 1;};globalThis.clearTimeout=()=>{};
 globalThis.maplibregl={Marker:class{setLngLat(){return this;}addTo(){return this;}remove(){}},Popup:class{setLngLat(){return this;}setDOMContent(){return this;}addTo(){return this;}remove(){removed++;}}};
 try{
  const row={id:'test',community:'测试小区',point:[114,22.6],market:'sale',saleUnitPrice:50000,url:'https://example.com'};
  let source;const map={isStyleLoaded:()=>true,getSource:()=>source,addSource:()=>{source={setData(){}};},addLayer(){},getLayer:()=>true,queryRenderedFeatures:()=>[{properties:{id:'test'}}]};
  const ui=createRentalUI({request:async()=>({items:[row],run:{state:'running'}})});ui.attach(map);ui.select(row.point,2000);await flush();
  assert.equal(ui.click({point:[0,0]}),true);await tick();assert.equal(removed,0);ui.setEnabled(false);assert.equal(removed,1);ui.detach();
 }finally{Object.assign(globalThis,previous);}
});
test('底图加载期间收到价格，idle后补绘且退出清理监听',async()=>{
 const previous={document:globalThis.document,maplibregl:globalThis.maplibregl};const markers=[];
 globalThis.document={createElement:tag=>new Element(tag)};
 globalThis.maplibregl={Marker:class{constructor(o){this.element=o.element;markers.push(this);}setLngLat(){return this;}addTo(){return this;}remove(){this.removed=true;}}};
 try{
  let ready=false,source,callback;const map={isStyleLoaded:()=>ready,once:(event,fn)=>{callback=fn;},off:(event,fn)=>{if(callback===fn)callback=null;},getSource:()=>source,addSource:()=>{source={setData(){}};},addLayer(){}};
  const ui=createRentalUI({request:async()=>({items:[],run:{state:'completed',competitors:[{name:'真实公寓',point:[114,22.6]}]}})});
  ui.attach(map);ui.select([114,22.6],2000);await flush();assert.equal(markers.length,0);assert.equal(typeof callback,'function');
  ready=true;const emit=callback;callback=null;emit();assert.equal(markers.length,2);
  ready=false;ui.select([114,22.6],1000);assert.equal(typeof callback,'function');ui.detach();assert.equal(callback,null);
 }finally{Object.assign(globalThis,previous);}
});
test('竞品开启显示无租金POI，关闭清除标记且拒绝迟到响应',async()=>{
 const previous={document:globalThis.document,maplibregl:globalThis.maplibregl};
 const markers=[];globalThis.document={createElement:tag=>new Element(tag)};
 globalThis.maplibregl={Marker:class{constructor(options){this.element=options.element;markers.push(this);}setLngLat(){return this;}addTo(){return this;}remove(){this.removed=true;}}};
 try{
  let resolve;const ui=createRentalUI({request:(_,input)=>input.rental.market==='sale'?Promise.resolve({items:[]}):new Promise(r=>{resolve=r;})});let source;
  const map={isStyleLoaded:()=>true,getSource:()=>source,addSource:()=>{source={setData(data){this.data=data;}};},addLayer(){}};
  ui.attach(map);ui.select([114,22.6],2000);assert.equal(markers.length,0);ui.setEnabled(true);
  resolve({items:[],run:{state:'completed',competitors:[{name:'真实公寓',point:[114,22.6]}]}});await flush();
  assert.equal(markers.filter(m=>!m.removed).length,1);assert.match(markers[0].element['aria-label'],/真实公寓 未取得公开报价/);
  const changes=[];ui.onEnabled(v=>changes.push(v));ui.setEnabled(false);assert.equal(markers[0].removed,true);assert.equal(source.data.features.length,0);
  ui.setEnabled(true);ui.setEnabled(false);resolve({items:[],run:{competitors:[{name:'迟到公寓',point:[114,22.6]}]}});await flush();
  assert.equal(markers.filter(m=>!m.removed).length,0);assert.deepEqual(changes,[false,true,false]);ui.detach();
 }finally{Object.assign(globalThis,previous);}
});
test('默认租售双选，仅查询居住物业；单类失败不阻断其他类',async()=>{
 const prior=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
 try{
  const calls=[];const ui=createRentalUI({request:async(_,input)=>{assert.equal(input.rental.kind,'住宅');const k=input.rental.market;calls.push(k);if(k==='sale')throw Error('暂不可用');return {items:[],run:{state:'completed'}};}});
  const grid=ui.root.children.find(n=>n.children?.length===2&&n.children[0]?.children?.[0]?.type==='checkbox');
  ui.select([114,22.6],2000);await flush();assert.equal(ui.enabled,true);assert.deepEqual(calls,['rent','sale']);
  assert.match(ui.root.children.find(n=>n.role==='status').textContent,/失败/);
  calls.length=0;grid.children[1].children[0].checked=false;grid.children[1].children[0].onchange();await flush();assert.deepEqual(calls,['rent']);ui.detach();
 }finally{globalThis.document=prior;}
});
test('租金界面：空结果、加载、失败、过期回执和关闭保护',async()=>{
 const prior=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
 try{
  const calls=[];const ui=createRentalUI({request:async(action,input)=>input.rental.market==='sale'?{items:[]}:new Promise((resolve,reject)=>calls.push({action,input,resolve,reject}))});
  const status=ui.root.children.find(n=>n.role==='status');
  ui.setEnabled(true);ui.select([114,22.6],2000);assert.match(status.textContent,/读取/);assert.equal(calls[0].action,'rentals');
  ui.select([114.1,22.6],1000);calls[0].resolve({items:[{community:'不应显示'}]});await flush();assert.match(status.textContent,/读取/);
  calls[1].resolve({items:[]});await flush();assert.match(status.textContent,/0条/);
  ui.select([114,22.6],500);calls[2].reject(Error('服务暂不可用'));await flush();assert.match(status.textContent,/失败/);
  ui.select([114,22.6],3000);ui.detach();calls[3].resolve({items:[]});await flush();assert.match(status.textContent,/读取/);
  ui.select(null,2000);assert.match(status.textContent,/请选择/);
 }finally{globalThis.document=prior;}
});
