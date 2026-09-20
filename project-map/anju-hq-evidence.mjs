// WGS84 footprints retained from the local OSM source; not a measured survey.
// Height selection deliberately does not use the older 311/247 m OSM tags.
export const anjuHQEvidence = Object.freeze({
 id:'anju-hq', name:'深安居总部 · 深圳湾创新科技中心 2 栋 A 座',
 crs:'WGS84', status:'reference-reconstruction-not-accepted',
 sources:{
  address:'https://www.szajjt.com/detail.aspx?cid=8037&siteid=27546',
  completedHeights:'https://www.protectwell.com.cn/case/index_s75.html',
  appearance:'https://rmjm.com/portfolio/shenzhen-bay-centre/',
  footprints:'outputs/nanshan-source/audit/-9_-1.geojson'
 },
 buildings:[
  {id:'tower-a',osm:'way/781258408',height:299.1,base:0,kind:'office',ring:[[113.9412978,22.5318613],[113.9413005,22.5314272],[113.9417811,22.5314298],[113.9417798,22.5316468],[113.9417785,22.5318638],[113.9415688,22.5318627]]},
  {id:'tower-b',osm:'way/781258407',height:235.2,base:0,kind:'office',ring:[[113.9419008,22.5322734],[113.9419021,22.5320621],[113.9419024,22.5320187],[113.9419035,22.5318393],[113.942151,22.5318407],[113.9423841,22.5318419],[113.9423815,22.5322759]]},
  {id:'upper-link',osm:'way/1270117300',height:159,base:146,kind:'bridge',heightStatus:'OSM-not-surveyed',ring:[[113.9412978,22.5318613],[113.9415688,22.5318627],[113.9417785,22.5318638],[113.9417798,22.5316468],[113.942151,22.5318407],[113.9419035,22.5318393],[113.9419024,22.5320187]]},
  {id:'lower-link',osm:'way/1270117301',height:38,base:25,kind:'bridge',heightStatus:'OSM-not-surveyed',ring:[[113.9415688,22.5318627],[113.9417785,22.5318638],[113.9419021,22.5320621],[113.9419008,22.5322734]]}
 ],
 // The site contains three additional apartment blocks. Individual height-to-
 // footprint mapping has not been independently confirmed; do not invent it.
 pending:['apartment-height-mapping','podium-and-entrance','rear-facade-photo','city-overlap-removal','browser-acceptance'],
 logo:{host:'tower-a',status:'user-requested-display-not-existing-signage'}
});

export function validateHQEvidence(value=anjuHQEvidence){
 if(value.crs!=='WGS84'||value.logo.host!=='tower-a')throw Error('总部坐标或 LOGO 楼栋不正确');
 for(const building of value.buildings){
  if(!(building.height>building.base&&building.base>=0)||building.ring.length<3)throw Error('总部建筑范围无效');
  for(const p of building.ring)if(p.length!==2||!p.every(Number.isFinite)||p[0]<113.941||p[0]>113.943||p[1]<22.530||p[1]>22.533)throw Error('总部轮廓超出核对区域');
 }
 return value;
}
