import {distance} from './research-core.mjs';

// Counts refer to OSM footprint representative points, not cadastral buildings.
export function summarizeBuildings(points, center, radius) {
  if (!Array.isArray(center) || center.length!==2 || !center.every(Number.isFinite) || ![500,1000,2000,3000].includes(radius)) throw Error('建筑分析范围无效');
  let count=0,footprint=0;
  const districts={};
  for (const p of points) {
    if (!Array.isArray(p)||p.length<4||!p.slice(0,3).every(Number.isFinite)||p[2]<0) throw Error('建筑数据格式异常');
    if (distance(center,p.slice(0,2))<=radius) {count++;footprint+=p[2];districts[p[3]]=(districts[p[3]]||0)+1;}
  }
  return {count,footprint:Math.round(footprint),districts,coverage:'unknown'};
}

export function validateManifest(m) {
  if(m?.version!==1||!Number.isInteger(m.records)||m.records<=0||m.completeCityClaim!==false||m.gridSizeMetres!==500||!m.districtCounts) throw Error('建筑分析数据版本不匹配');
  return m;
}
