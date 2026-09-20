import {anjuHQEvidence,validateHQEvidence} from './anju-hq-evidence.mjs';
import {scenePoint} from './core.mjs';

// Photo-based facade reconstruction, NOT as-built BIM. Heights/footprints retain
// their separate provenance in anju-hq-evidence; facade spacing is illustrative.
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export function triangulateRing(input){
 const ring=input.map(p=>[...p]);
 if(ring.length<3||ring.some(p=>p.length!==2||!p.every(Number.isFinite)))throw Error('Invalid footprint');
 if(ring.reduce((v,p,i)=>v+p[0]*ring[(i+1)%ring.length][1]-ring[(i+1)%ring.length][0]*p[1],0)<0)ring.reverse();
 // Remove collinear OSM way nodes before ear clipping.
 for(let i=ring.length-1;i>=0&&ring.length>3;i--)if(Math.abs(cross(ring[(i+ring.length-1)%ring.length],ring[i],ring[(i+1)%ring.length]))<1e-8)ring.splice(i,1);
 const remaining=ring.map((_,i)=>i),triangles=[];
 while(remaining.length>3){
  let clipped=false;
  for(let i=0;i<remaining.length;i++){
   const a=remaining[(i+remaining.length-1)%remaining.length],b=remaining[i],c=remaining[(i+1)%remaining.length];
   if(cross(ring[a],ring[b],ring[c])<=1e-8)continue;
   if(remaining.some(j=>j!==a&&j!==b&&j!==c&&cross(ring[a],ring[b],ring[j])>=-1e-8&&cross(ring[b],ring[c],ring[j])>=-1e-8&&cross(ring[c],ring[a],ring[j])>=-1e-8))continue;
   triangles.push(a,b,c);remaining.splice(i,1);clipped=true;break;
  }
  if(!clipped)throw Error('Cannot triangulate footprint; no fallback fan permitted');
 }
 triangles.push(...remaining);return {ring,triangles};
}

function buffer(){return {positions:[],indices:[],colors:[],uvs:[]};}
function quad(out,points,color){const start=out.positions.length/3;out.positions.push(...points.flat());out.indices.push(start,start+1,start+2,start,start+2,start+3);for(let i=0;i<4;i++)out.colors.push(...color,1);}
function tint(floor,column,side,ratio){
 const hash=((floor*73856093)^(column*19349663)^(side*83492791))>>>0;
 // The architect's reference has pale panel clusters low down, dark glazing
 // above. This deterministic pattern does not claim individual panel accuracy.
 if(ratio<.42&&(hash%100)/100<.32)return [.57,.65,.70];
 const v=(hash%5)/100;return [.17+v,.30+v,.40+v];
}
export function buildHQGeometry(catalog,evidence=anjuHQEvidence,{detail=true}={}){
 validateHQEvidence(evidence);
 if(!(catalog?.scale>0))throw Error('Invalid map scale');
 const anchor=scenePoint([113.94154,22.531646],catalog),scale=catalog.scale;
 const bodies=[];
 for(const b of evidence.buildings){
  const outline=b.ring.map(p=>{const v=scenePoint(p,catalog);return [v.x-anchor.x,v.z-anchor.z];});
  const {ring,triangles}=triangulateRing(outline),shell=buffer(),panels=buffer(),frames=buffer();
  const lo=b.base*scale,hi=b.height*scale;
  const roof=detail&&b.kind==='office'?hi-3*scale:hi;
  for(const y of [lo,roof]){const offset=shell.positions.length/3;for(const p of ring){shell.positions.push(p[0],y,p[1]);shell.colors.push(.22,.28,.31,1);}for(let i=0;i<triangles.length;i+=3){const ids=triangles.slice(i,i+3);shell.indices.push(...(y===roof?ids.reverse():ids).map(j=>j+offset));}}
  for(let side=0;side<ring.length;side++){
   const a=ring[side],z=ring[(side+1)%ring.length],dx=z[0]-a[0],dz=z[1]-a[1],length=Math.hypot(dx,dz);
   const point=(t,y,outset=0)=>[a[0]+dx*t+dz/length*outset,y,a[1]+dz*t-dx/length*outset];
   quad(shell,[point(0,lo),point(0,hi),point(1,hi),point(1,lo)],[.19,.30,.38]);
   if(!detail)continue;
   const floors=Math.max(1,Math.round((b.height-b.base)/(b.kind==='bridge'?4.3:4.2))),columns=Math.max(1,Math.round(length/scale/1.65));
   // One mipmapped facade per wall instead of subpixel coplanar strips.
   // This preserves window rhythm nearby without geometry moire at city scale.
   quad(panels,[point(0,lo,.45*scale),point(0,hi,.45*scale),point(1,hi,.45*scale),point(1,lo,.45*scale)],[1,1,1]);
   panels.uvs.push(0,0,0,1,columns/32,1,columns/32,0);
   // Wider frame at each building corner and narrow roof parapet.
   const w=Math.min(.25,.3*scale/length);
   quad(frames,[point(0,lo,.12*scale),point(0,hi,.12*scale),point(w,hi,.12*scale),point(w,lo,.12*scale)],[.55,.60,.63]);
   quad(frames,[point(0,hi-.6*scale,.13*scale),point(0,hi,.13*scale),point(1,hi,.13*scale),point(1,hi-.6*scale,.13*scale)],[.45,.49,.52]);
  }
  if(detail&&b.kind==='office'){
   // Recessed roof plant enclosure; its top remains within the stated total height.
   const cx=ring.reduce((n,p)=>n+p[0],0)/ring.length,cz=ring.reduce((n,p)=>n+p[1],0)/ring.length;
   const inner=ring.map(p=>[cx+(p[0]-cx)*.62,cz+(p[1]-cz)*.62]);
   for(let i=0;i<inner.length;i++){const p=inner[i],q=inner[(i+1)%inner.length];quad(frames,[[p[0],hi-3*scale,p[1]],[p[0],hi,p[1]],[q[0],hi,q[1]],[q[0],hi-3*scale,q[1]]],[.63,.67,.69]);}
  }
  bodies.push({id:b.id,height:b.height,floors:Math.max(1,Math.round((b.height-b.base)/4.2)),ring,shell,panels,frames});
 }
 const a=bodies.find(b=>b.id===evidence.logo.host),xs=a.ring.map(p=>p[0]),zs=a.ring.map(p=>p[1]);
 return {anchor,scale,bodies,logo:{host:a.id,width:10*scale,position:{x:(Math.min(...xs)+Math.max(...xs))/2,y:(a.height-8)*scale,z:Math.min(...zs)-1.1*scale}},status:evidence.status};
}

export function buildHQFacadePixels(floors){
 const width=256,height=1024,pixels=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const ratio=y/height,f=Math.floor(ratio*floors),c=Math.floor(x/8);
  let color=tint(f,c,0,ratio);
  if(x%8===0&&ratio>.39)color=[.59,.65,.68];
  else if((ratio*floors)%1<.045)color=[.13,.23,.30];
  const i=(y*width+x)*4;for(let k=0;k<3;k++)pixels[i+k]=Math.round(color[k]*255);pixels[i+3]=255;
 }
 return {width,height,pixels};
}
