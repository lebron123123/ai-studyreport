import {competitorRows,rentalUnitPrice,rentalExample} from './competitor-core.mjs';
import {rentalReferenceLabel,rentalOfferLabel} from './rental-identity.mjs';
const make=(tag,text='')=>{const node=document.createElement(tag);node.textContent=text;return node;};
export function createRentalUI({request}){
 const root=make('details'),summary=make('summary','▥ 周边竞品 · 租售单价');root.className='research-task';root.open=true;root.append(summary);
 const kind=make('div'),choices=new Map(),results=new Map();kind.style.cssText='display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:10px 0';
 for(const name of ['租金','售价']){const label=make('label'),input=make('input');input.type='checkbox';input.checked=true;input.setAttribute('aria-label','竞品'+name);label.style.cssText='display:flex;align-items:center;gap:6px;padding:10px 6px;border:1px solid #bcd4e5;border-radius:8px;background:#f3f8fc';label.append(input,make('span',name));kind.append(label);choices.set(name,input);}
 const note=make('p','仅查询住宅、公寓、城中村及统建楼等居住竞品，不查询办公、商铺和产业园。租金：元/㎡·月；售价：元/㎡，两者不混算。选定地点后自动查询，共用右上角范围；本地库优先 → 搜索找路 → 网页取证。无公开价格不推测。分批查询最近最多25处物业，未完成项可续查。'),status=make('p');status.setAttribute('role','status');
 const crawlerInfo=make('details');crawlerInfo.append(make('summary','爬虫 · 来源与覆盖范围'),make('p','链家、房天下、乐有家分别交叉搜索，再从允许访问的公开网页提取价格。已有乐有家直连目录覆盖南山4处小区及龙华锦绣江南四期，其他小区通过搜索发现入口。'),make('p','每轮爬虫最多8页，遵循站点robots和访问间隔；不绕过登录或验证码。搜索命中不等于取得价格；访问限制、下架、无匹配分别保留提示。'),make('p','采集的是挂牌候选，不是成交租金；每条保留原始链接和采集日期。搜索失败与爬虫失败分别展示。'));
 const refresh=make('button','更新 / 重试失败项'),list=make('div'),toggle=make('input');toggle.type='checkbox';toggle.checked=true;toggle.setAttribute('aria-label','显示周边竞品');const label=make('label',' 显示周边竞品（自动查询租售价格）');label.prepend(toggle);
 const official=make('a','住建局片区参考租金');official.href='https://zjj.sz.gov.cn/fwzljgcx/vue/main';official.target='_blank';official.rel='noopener noreferrer';
 root.append(note,kind,label,refresh,status,list,crawlerInfo,official);
 crawlerInfo.replaceChildren(make('summary','爬虫 · 来源与覆盖范围'),make('p','链家、房天下、乐有家交叉搜索，优先复用本地证据和已核实小区入口。每轮公开页预算32页；遵循robots及访问间隔，不绕过登录或验证码。'),make('p','本小区未取得报价时可补已确认的其他分期参考价，明确标注来源，不混入本小区价格统计。采集的是挂牌候选，不是成交价；原链接和日期保留。'));
 let query=null,epoch=0,timer=null,map=null,items=[],popup=null,markers=[],competitors=[],pendingPaint=null;
 const listeners=new Set();status.textContent='租金、售价默认开启；选定地点后自动查询。';
 function removeMarkers(){for(const marker of markers)marker.remove();markers=[];}
 function clear(){clearTimeout(timer);timer=null;popup?.remove();}
 function cancelPaint(){if(pendingPaint)map?.off?.('idle',pendingPaint);pendingPaint=null;}
 function paint(){
  removeMarkers();
  if(!map)return;
  if(!map.isStyleLoaded()){
   if(!pendingPaint&&map.once){const target=map;pendingPaint=()=>{pendingPaint=null;if(map===target)paint();};map.once('idle',pendingPaint);}
   return;
  }
  if(!map.getSource('rental-samples')){map.addSource('rental-samples',{type:'geojson',data:{type:'FeatureCollection',features:[]}});map.addLayer({id:'rental-samples',type:'circle',source:'rental-samples',paint:{'circle-color':'#b65bca','circle-radius':8,'circle-stroke-color':'#fff','circle-stroke-width':2}});}
  map.getSource('rental-samples').setData({type:'FeatureCollection',features:toggle.checked?items.map(row=>({type:'Feature',geometry:{type:'Point',coordinates:row.point},properties:{id:row.id}})):[]});
  if(toggle.checked&&globalThis.maplibregl?.Marker)for(const row of competitors.slice(0,80)){
   const button=make('button');button.type='button';button.setAttribute('aria-label',row.name+' '+row.rent);
   button.style.cssText='border:1px solid #b65bca;border-radius:6px;background:#fff;color:#773b8c;padding:4px 7px;text-align:left;max-width:190px;box-shadow:0 1px 5px #0002;cursor:pointer;font:12px/18px system-ui';
   const title=make('strong','▥ '+row.name),price=make('span',row.rent);title.style.cssText='display:block;max-width:175px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';price.style.display='block';button.append(title,price);
   for(const example of row.examples){const line=make('span',example);line.style.cssText='display:block;font-size:11px';button.append(line);}
   button.onclick=e=>{e.stopPropagation();if(row.items.length)show(row.items,row.point);else{popup?.remove();popup=new maplibregl.Popup().setLngLat(row.point).setDOMContent(make('p',row.name+' · '+row.kind+'：'+row.rent+'。失败时可在左侧点击“更新 / 重试失败项”。')).addTo(map);}};
   markers.push(new maplibregl.Marker({element:button,anchor:row.kind==='售价'?'top-left':'bottom-left',offset:row.kind==='售价'?[8,8]:[8,-8]}).setLngLat(row.point).addTo(map));
  }
 }
 function card(row){const box=make('section');box.style.cssText='background:#fff6ce;padding:12px;color:#493d23';box.append(make('h3',row.community),make('p',row.monthlyRent?row.monthlyRent+'元/月'+(row.area?' · '+row.area+'㎡':''):'尚无明确月租'),make('p',[row.kind,row.leaseType||'租赁形式待核实',row.district,row.street].filter(Boolean).join(' · ')),make('p','挂牌候选，非成交价；地图点为小区参考位置'+(row.stale?'；样本已过30天，请复核':'')),make('p','采集日期：'+new Date(row.observedAt).toLocaleDateString()));const a=make('a','查看原始房源');a.href=row.url;a.target='_blank';a.rel='noopener noreferrer';box.append(a);return box;}
 function render(result){
  items=result.items||[];competitors=competitorRows([...choices].filter(([,c])=>c.checked).map(([k])=>[k,results.get(k)||{}]));list.replaceChildren();const run=result.run;
  status.textContent='已选'+[...choices].filter(([,c])=>c.checked).map(([name])=>name).join('、')+' · 共'+items.length+'条样本'+(run?.state==='running'?' · 查询中…':'')+(Object.values(run?.channels||{}).some(c=>c.state==='failed')?' · 部分查询失败，可重试':'');
  if(run?.error)list.append(make('p',run.error));
  if(run)list.append(make('p',run.coverage));
  for(const [channel,value]of Object.entries(run?.channels||{})){list.append(make('p',channel+'：'+({pending:'等待',running:'进行中',completed:'完成',failed:'有失败项'}[value.state]||value.state)+'，'+value.count+'条候选'));if(value.errors?.length){const errors=make('details');errors.append(make('summary','查看失败原因'));for(const message of value.errors)errors.append(make('p',message));list.append(errors);}}
  for(const [channel,value]of Object.entries(run?.channels||{})){if(!channel.includes('搜索找路'))continue;for(const [name,task]of Object.entries(value.tasks||{})){if(!task.sources?.length)continue;list.append(make('p',name+' · '+task.sources.map(s=>s.site+'：'+({matched:'找到链接',empty:'无匹配',failed:'检索失败'}[s.state]||s.state)).join(' / ')));}}
  if(result.truncated)list.append(make('p','样本较多，当前仅显示部分；请缩小范围。'));
  list.append(make('p','地图显示 '+Math.min(competitors.length,80)+' 处竞品；每类新查询最多4处。单价为各房源月租÷对应面积的区间（元/㎡·月），不是成交均价；下列最多3条为房源示例，合租单独标注，缺面积不折算、缺户型不推测。'));
  if(!items.length)list.append(make('p','当前没有可展示租金样本，不代表周边没有出租房源。'));
  for(const [name,input] of choices){if(!input.checked)continue;const rows=items.filter(row=>(row.market==='sale'?'售价':'租金')===name),group=make('details');group.open=true;group.append(make('summary',name+' · '+rows.length+'条'));for(const row of rows.slice(0,30)){const b=make('button',row.community+' · '+(rentalOfferLabel(row)||(row.market==='sale'?(row.saleUnitPrice?row.saleUnitPrice+'元/㎡':'售价待核实'):(row.monthlyRent?row.monthlyRent+'元/月':'租金待核实')))+(rentalReferenceLabel(row)?' · '+rentalReferenceLabel(row):''));b.onclick=()=>show([row],row.point);group.append(b);}list.append(group);}
  paint();
 }
 function show(rows,point){if(!map||!globalThis.maplibregl)return;popup?.remove();const box=make('div');for(const row of rows){
  if(rentalOfferLabel(row)){const item=make('section');item.style.cssText='background:#fff6ce;padding:12px;color:#493d23';const link=make('a','查看运营方公开户型页');link.href=row.evidenceUrl||row.url;link.target='_blank';link.rel='noopener noreferrer';item.append(make('h3',row.community),make('p',row.layout||''),make('p',rentalOfferLabel(row)),make('p','面积约'+row.areaRange.join('–')+'㎡；面积与租金未逐套配对，不折算单价，不混入市场租金均值。'),link);box.append(item);continue;}
  const reference=rentalReferenceLabel(row);if(reference){const warning=make('p',reference);warning.style.cssText='background:#fff6ce;color:#9a5412;font-weight:bold;padding:8px';box.append(warning);}
  if(row.propertySubtype)box.append(make('p','物业口径：'+row.propertySubtype));
  if(row.market==='sale'){const item=make('section');item.style.cssText='background:#fff6ce;padding:12px;color:#493d23';const link=make('a','查看原网页');link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';item.append(make('h3',row.community),make('p',row.saleUnitPrice?row.saleUnitPrice+' 元/㎡':'售价待核实'),make('p','网页参考售价，非成交价；不代表该物业具备销售资格。'+(row.stale?'样本已过期，请复核。':'')),link);box.append(item);continue;}
  const item=card(row),unit=rentalUnitPrice(row);if(unit!==null)item.append(make('p','折合 '+unit.toFixed(1)+' 元/㎡·月'),make('p',rentalExample(row)));box.append(item);}popup=new maplibregl.Popup({maxWidth:'360px'}).setLngLat(point).setDOMContent(box).addTo(map);}
 async function load(action='collect'){
  clearTimeout(timer);timer=null;if(action!=='list')popup?.remove();const ticket=++epoch;if(!toggle.checked)return;if(!query){status.textContent='请选择已确认的项目或地图地点';return;}status.textContent='正在读取共享租售价格库…';
  const selected=[...choices].filter(([,c])=>c.checked).map(([name])=>name);
  if(!selected.length){items=[];competitors=[];list.replaceChildren();status.textContent='请勾选至少一种租金类型';paint();return;}
  for(const name of selected){
   try{const prior=results.get(name),nextAction=action==='list'&&prior?.busy?'collect':action;const result=await request('rentals',{rental:{...query,kind:'住宅',market:name==='售价'?'sale':'rent',action:nextAction}});if(ticket!==epoch)return;results.set(name,result);}
   catch(error){if(ticket!==epoch)return;results.set(name,{items:results.get(name)?.items||[],run:{competitors:results.get(name)?.run?.competitors||[],state:'failed',channels:{search:{state:'failed',count:0,errors:['租金查询失败：'+error.message+'；可点击更新重试。']}}}});}
   const combined={items:[],run:{channels:{}}};
   for(const k of selected){const r=results.get(k);if(!r)continue;combined.items.push(...(r.items||[]));combined.run.channels[k+' · 本地样本']={state:r.run?.state==='running'||r.busy?'running':'completed',count:r.items?.length||0,errors:r.run?.error?[r.run.error]:[]};for(const [c,v]of Object.entries(r.run?.channels||{}))combined.run.channels[k+' · '+(c==='crawler'?'网页取证':'搜索找路')]=v;if(r.run?.state==='running'||r.busy)combined.run.state='running';}
   render(combined);
  }
  if(selected.some(name=>{const r=results.get(name);return r?.busy||r?.run?.state==='running';}))timer=setTimeout(()=>load('list'),5000);
 }
 refresh.onclick=()=>load('retry');for(const input of choices.values())input.onchange=()=>{const selected=[...choices].filter(([,c])=>c.checked);items=selected.flatMap(([name])=>results.get(name)?.items||[]);competitors=competitorRows(selected.map(([k])=>[k,results.get(k)||{}]));paint();load();};toggle.onchange=()=>{for(const listener of listeners)listener(toggle.checked);if(toggle.checked)load();else{epoch++;clear();status.textContent='竞品图层已关闭，已存租金样本保留。';paint();}};
 return {root,get enabled(){return toggle.checked;},setEnabled(value){toggle.checked=!!value;toggle.onchange();},onEnabled(listener){listeners.add(listener);},select(point,radius){epoch++;clear();results.clear();query=point?{point:[...point],radius}:null;items=[];competitors=[];list.replaceChildren();paint();if(query)load();else status.textContent='请选择已确认的项目或地图地点';},attach(instance){cancelPaint();map=instance;paint();if(toggle.checked&&query)load('list');},detach(){epoch++;clear();cancelPaint();removeMarkers();map=null;},click(e){if(!map?.getLayer('rental-samples'))return false;const hits=map.queryRenderedFeatures(e.point,{layers:['rental-samples']});if(!hits.length)return false;const ids=new Set(hits.map(x=>x.properties.id)),rows=items.filter(x=>ids.has(x.id));if(!rows.length)return false;show(rows,rows[0].point);return true;}};
}
