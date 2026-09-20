import {toWgs84} from '../project-map/core.mjs';
const point=[114.02905103405446,22.63948998565567];let gcj=[...point];
for(let i=0;i<5;i++){const w=toWgs84(gcj,'GCJ02');gcj=[gcj[0]+point[0]-w[0],gcj[1]+point[1]-w[1]];}
const url=new URL('https://restapi.amap.com/v3/place/around');
for(const [k,v] of Object.entries({key:process.env.AMAP_KEY,location:gcj.join(','),radius:'2000',keywords:'住宅小区',types:'120300',sortrule:'distance',offset:'25',page:'1',extensions:'base'}))url.searchParams.set(k,v);
const data=await (await fetch(url,{signal:AbortSignal.timeout(12000)})).json();
console.log(JSON.stringify((data.pois||[]).map(p=>({name:p.name,type:p.type,distance:p.distance,location:p.location})),null,2));
