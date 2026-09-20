// Explicit coordinate provenance: existing project POI uses AMap GCJ-02.
export function coordinate(value) {
  const p=Array.isArray(value)?value:String(value||'').split(',');
  if(p.length!==2||p.some(v=>String(v).trim()===''))return null;
  const n=p.map(Number);return n.every(Number.isFinite)&&Math.abs(n[0])<=180&&Math.abs(n[1])<=90?n:null;
}
function delta(lon,lat){
  const x=lon-105,y=lat-35,pi=Math.PI;
  let a=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));
  let b=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  a+=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  b+=(20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  a+=(20*Math.sin(y*pi)+40*Math.sin(y*pi/3))*2/3+(160*Math.sin(y*pi/12)+320*Math.sin(y*pi/30))*2/3;
  b+=(20*Math.sin(x*pi)+40*Math.sin(x*pi/3))*2/3+(150*Math.sin(x*pi/12)+300*Math.sin(x*pi/30))*2/3;
  const rad=lat*pi/180,magic=1-.006693421622965943*Math.sin(rad)**2;
  return [b*180/(6378245/Math.sqrt(magic)*Math.cos(rad)*pi),a*180/((6378245*(1-.006693421622965943))/(magic*Math.sqrt(magic))*pi)];
}
export function toWgs84(value,crs){
  const p=coordinate(value);if(!p)return null;if(crs==='WGS84')return p;
  if(crs!=='GCJ02')return null;
  if(p[0]<72.004||p[0]>137.8347||p[1]<.8293||p[1]>55.8271)return p;
  let w=[...p];for(let i=0;i<5;i++){const d=delta(...w);w=[w[0]-(w[0]+d[0]-p[0]),w[1]-(w[1]+d[1]-p[1])];}return w;
}
export function landmarkCoordinate(m,catalog){
  if(Number.isFinite(m.lon)&&Number.isFinite(m.lat))return coordinate([m.lon,m.lat]);
  const [lon,lat]=catalog.origin,scale=catalog.scale;
  return coordinate([lon+m.x/scale/(111320*Math.cos(lat*Math.PI/180)),lat+m.z/scale/111320]);
}
export function publicSnapshot(p){return {name:String(p?.name||'当前项目').slice(0,100),location:coordinate(p?.poiLoc),crs:'GCJ02'};}
export function scenePoint(point,catalog){
  const p=coordinate(point);if(!p||!catalog)return null;
  const [lon,lat]=catalog.origin;
  return {x:(p[0]-lon)*111320*Math.cos(lat*Math.PI/180)*catalog.scale,z:(p[1]-lat)*111320*catalog.scale};
}
export function inCityCoverage(point,catalog){
  const p=scenePoint(point,catalog);
  const original=catalog?.originalTiles?catalog.originalTiles.some(t=>p&&p.x>=t.bounds[0]&&p.x<=t.bounds[2]&&p.z>=t.bounds[1]&&p.z<=t.bounds[3]):p&&p.x>=-6788.1&&p.x<=6788.1&&p.z>=-2604.89&&p.z<=2604.89;
  return !!p&&(original||!!catalog.baoanTiles?.some(t=>t.count!==0&&point[0]>=t.bounds[0]&&point[0]<=t.bounds[2]&&point[1]>=t.bounds[1]&&point[1]<=t.bounds[3]));
}
