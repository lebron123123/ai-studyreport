import {createRadiusSlider} from './radius-slider.mjs';
import {circle} from './research-core.mjs';
import {summarizeBuildings,validateManifest} from './building-analysis-core.mjs';

const empty=()=>({type:'FeatureCollection',features:[]});
const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
export function createBuildingAnalysis(parent) {
  let map=null,manifest=null,grid=null,points=null,loading=null,controller=null,generation=0,picking=false,center=null,mode='off',paintedMode=null,heat=null;
  const box=node('details'),summary=node('summary','▥ 建筑密度与热力'),hint=node('p','按需加载全深圳 OSM 建筑。空白表示数据未知，不代表没有建筑。');
  box.className='research-task';box.append(summary,hint);parent.append(box);
  const label=node('label','建筑图层'),select=node('select');select.setAttribute('aria-label','建筑图层');
  for(const [v,t] of [['off','关闭'],['heat','建筑热力（轮廓记录数）'],['density','建筑占地密度（500米网格）']]){const o=node('option',t);o.value=v;select.append(o);}label.append(select);box.append(label);
  const legend=node('div');legend.className='density-legend';
  for(const [color,text] of [['#d1e9fa','低于10%'],['#74b9d4','10%–不足30%'],['#eab953','30%–不足60%'],['#dc6251','60%及以上']]){const item=node('span',text),chip=node('i');chip.style.background=color;item.prepend(chip);legend.append(item);}
  box.append(legend,node('p','热力：蓝→黄→红，表示建筑轮廓记录由疏到密；不代表人口或容积率。'));const scope=node('p','覆盖：全深圳已收录建筑；密度按500米网格，不随下方缓冲半径改变。缓冲半径仅用于点选位置的周边统计。');box.append(scope);
  const rangeLabel=node('label','缓冲半径'),range=node('select');range.setAttribute('aria-label','建筑缓冲半径');for(const r of [500,1000,2000,3000]){const o=node('option',r+'米');o.value=r;range.append(o);}range.value='1000';rangeLabel.append(range);box.append(rangeLabel);rangeLabel.hidden=true;createRadiusSlider(range,box,'建筑缓冲半径');
  const pick=node('button','点选位置 · 分析周边建筑'),clear=node('button','清除缓冲'),status=node('p','可在深圳任意位置点选，无需创建项目。');pick.type=clear.type='button';status.setAttribute('role','status');box.append(pick,clear,status);
  const audit=node('details'),auditSummary=node('summary','数据范围与口径'),auditBody=node('p');audit.append(auditSummary,auditBody);box.append(audit);
  function note(s){status.textContent=s;}
  async function load(){
    if(manifest&&grid&&points)return;
    if(loading)return loading;
    controller=new AbortController();const signal=controller.signal,ticket=generation;
    const timeout=setTimeout(()=>controller?.abort(),45000);
    note('正在读取本机全市建筑分析数据…');
    loading=(async()=>{
      const get=async file=>{const r=await fetch(new URL('./building-analysis-v1/'+file,import.meta.url),{signal});if(!r.ok)throw Error('数据文件未就绪（HTTP '+r.status+'）');return r.json();};
      const m=validateManifest(await get('manifest.json'));
      const [g,p]=await Promise.all([get('grid.geojson'),get('points.json')]);
      if(ticket!==generation)return;
      if(g.type!=='FeatureCollection'||g.features.length!==m.gridCells||!Array.isArray(p)||p.length!==m.records)throw Error('数据条数校验失败，请重新生成分析数据');
      manifest=m;grid=g;points=p;
      auditBody.textContent=`${m.sourceDate} · ${m.attribution} · ${m.license}。共 ${m.records.toLocaleString()} 条建筑轮廓。`+Object.entries(m.districtCounts).map(([n,c])=>`${n} ${c.toLocaleString()}`).join('；')+'。'+m.limitations.join(' ');
      hint.textContent='全市边界内已收录建筑 · 数据日期 '+m.sourceDate+'；缺漏未知，非全市完整普查。';
      note('已加载全市建筑数据。可选热力、密度，或点选缓冲。');
    })().finally(()=>{clearTimeout(timeout);if(ticket===generation)loading=null;});
    return loading;
  }
  async function guard(action){try{await action();}catch(e){if(e.name!=='AbortError')note('建筑分析未完成：'+e.message+'。重新选择图层或点击分析可重试。');else note('加载已取消或超时，可重试。');}}
  function paint(){
    if(!map?.isStyleLoaded())return;
    if(!map.getSource('city-building-grid')){
      paintedMode=null;
      map.addSource('city-building-grid',{type:'geojson',data:empty(),attribution:'© OpenStreetMap contributors · ODbL'});
      map.addSource('city-building-heat',{type:'geojson',data:empty()});
      map.addSource('city-building-buffer',{type:'geojson',data:empty()});
      map.addLayer({id:'city-building-density',type:'fill',source:'city-building-grid',paint:{'fill-color':['step',['get','density'],'#d1e9fa',10,'#74b9d4',30,'#eab953',60,'#dc6251'],'fill-opacity':.58}});
      map.addLayer({id:'city-building-heat',type:'heatmap',source:'city-building-heat',paint:{'heatmap-weight':['interpolate',['linear'],['get','count'],0,0,100,1,500,3],'heatmap-radius':28,'heatmap-opacity':.7}});
      map.addLayer({id:'city-building-buffer',type:'line',source:'city-building-buffer',paint:{'line-color':'#8535b4','line-width':3,'line-dasharray':[3,2]}});
    }
    if(paintedMode!==mode||(!paintedMode&&points)){
    if(mode==='heat'&&points&&!heat)heat={type:'FeatureCollection',features:points.map(p=>({type:'Feature',properties:{count:1},geometry:{type:'Point',coordinates:p.slice(0,2)}}))};
    map.getSource('city-building-grid').setData(mode==='density'&&grid?grid:empty());
    map.getSource('city-building-heat').setData(mode==='heat'&&heat?heat:empty());
    paintedMode=points?mode:null;
    }
    // Per-record heat weighting is fixed; zoom changes smoothing, not dataset totals.
    map.setPaintProperty('city-building-heat','heatmap-weight',1);
    map.setPaintProperty('city-building-heat','heatmap-intensity',['interpolate',['linear'],['zoom'],8,.015,11,.08,14,.5,17,1]);
    map.getSource('city-building-buffer').setData(center?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[circle(center,Number(range.value))]}}]}:empty());
  }
  function analyze(){if(!center||!points)return;const result=summarizeBuildings(points,center,Number(range.value));note(`半径${range.value}米：${result.count.toLocaleString()}条轮廓代表点；对应轮廓总占地约${result.footprint.toLocaleString()}㎡（未按圆边界裁剪、未跨轮廓去重，不作为密度）。`+(result.count?'数据可能缺漏。':'本地数据未收录，不代表没有建筑。'));paint();}
  select.onchange=()=>guard(async()=>{mode=select.value;if(mode!=='off')await load();paint();});
  pick.onclick=()=>guard(async()=>{await load();if(!points)return;picking=true;note('请点击地图任意位置，统计其直线缓冲范围内的已收录建筑。');});
  clear.onclick=()=>{picking=false;center=null;paint();note('已清除缓冲；建筑图层保留。');};
  range.onchange=()=>analyze();
  return {
    attach(instance){map=instance;paint();if(mode!=='off')guard(async()=>{await load();paint();});},
    detach(){generation++;controller?.abort();controller=null;loading=null;map=null;manifest=grid=points=heat=null;paintedMode=null;picking=false;},
    click(e){if(picking){center=[e.lngLat.lng,e.lngLat.lat];picking=false;analyze();return true;}if(mode==='density'&&map?.getLayer('city-building-density')){const f=map.queryRenderedFeatures(e.point,{layers:['city-building-density']})[0];if(f){note(`500米网格：${f.properties.count}条代表点；已收录轮廓占地密度${Number(f.properties.density).toFixed(1)}%。非完整普查、非容积率。`);return true;}}return false;}
  };
}
