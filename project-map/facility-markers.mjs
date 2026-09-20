// Local icons: no remote sprite or font dependency.
export const facilityStyles = {
  '轨道交通': {color:'#13834b',shape:'circle',legend:'🚇',glyph:'train'},
  '公交': {color:'#42a86a',shape:'circle',legend:'🚍',glyph:'bus'},
  '教育': {color:'#326bd1',shape:'triangle',legend:'🏫',glyph:'school'},
  '医疗': {color:'#a34ac0',shape:'cross',legend:'✚',glyph:'cross'},
  '商业配套': {color:'#e29016',shape:'square',legend:'🛍',glyph:'shop'},
  '产业园区': {color:'#148d99',shape:'diamond',legend:'🏢',glyph:'office'}
};
export function facilityIcon(style,size=32){
 const data=new Uint8Array(size*size*4),rgb=style.color.match(/\w\w/g).map(v=>parseInt(v,16));
 const inside=(x,y,r)=>style.shape==='square'?Math.max(Math.abs(x),Math.abs(y))<=r:style.shape==='diamond'?Math.abs(x)+Math.abs(y)<=r*1.35:style.shape==='triangle'?y>=-r&&y<=r&&Math.abs(x)<=(y+r)/2:style.shape==='cross'?Math.max(Math.abs(x),Math.abs(y))<=r&&Math.min(Math.abs(x),Math.abs(y))<=r*.38:x*x+y*y<=r*r;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const dx=x-(size-1)/2,dy=y-(size-1)/2,i=(y*size+x)*4;if(inside(dx,dy,14)){data.set(inside(dx,dy,10)?rgb:[255,255,255],i);data[i+3]=255;}}
 // Small original pixel pictograms, kept local to work offline without font sprites.
 const glyphs={bus:['1111111','1001001','1001001','1111111','1100011','1111111','0100010'],train:['0111110','1101011','1101011','1111111','1100011','0111110','1100011'],school:['0001000','0011100','1111111','1001001','1111111','1101011','1101011'],cross:['0011100','0011100','1111111','1111111','1111111','0011100','0011100'],shop:['1111111','1010101','1111111','1000001','1011101','1011101','1111111'],office:['1111111','1010101','1111111','1010101','1111111','1101011','1101011']};
 if(glyphs[style.glyph]){
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const dx=(x+.5)/size-.5,dy=(y+.5)/size-.5,i=(y*size+x)*4;data[i+3]=0;if(dx*dx+dy*dy<.22){data.set(dx*dx+dy*dy<.18?rgb:[255,255,255],i);data[i+3]=255;}const gx=Math.floor((x/size-.28)/.064),gy=Math.floor((y/size-.28)/.064);if(glyphs[style.glyph][gy]?.[gx]==='1'){data.set([255,255,255,255],i);}}
 }
 return {width:size,height:size,data};
}
export function installFacilityLayer(map){
 for(const [category,style] of Object.entries(facilityStyles)){const id='facility-'+category;if(!map.hasImage(id))map.addImage(id,facilityIcon(style),{pixelRatio:2});}
 if(!map.getLayer('research-facilities'))map.addLayer({id:'research-facilities',type:'symbol',source:'research',filter:['==',['get','kind'],'facility'],layout:{'icon-image':['concat','facility-',['get','category']],'icon-size':1.15,'icon-allow-overlap':true,'icon-ignore-placement':true}});
}
