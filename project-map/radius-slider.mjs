export const radiusStops=[500,1000,2000,3000];
export function createRadiusSlider(select,parent,title='配套查询半径'){
 const box=document.createElement('div');box.className='radius-slider';
 const label=document.createElement('label'),value=document.createElement('output'),input=document.createElement('input'),ticks=document.createElement('div');
 label.textContent=title+' ';label.append(value);input.type='range';input.min=0;input.max=3;input.step=1;input.setAttribute('aria-label',title);ticks.className='radius-stops';
 const sync=()=>{input.value=Math.max(0,radiusStops.indexOf(Number(select.value)));value.textContent=select.value+' 米';input.setAttribute('aria-valuetext',select.value+'米');};
 const commit=()=>{select.value=String(radiusStops[Number(input.value)]);sync();select.dispatchEvent(new Event('change',{bubbles:true}));};
 input.oninput=()=>{value.textContent=radiusStops[Number(input.value)]+' 米';input.setAttribute('aria-valuetext',value.textContent);};input.onchange=commit;
 for(const [i,r] of radiusStops.entries()){const b=document.createElement('button');b.type='button';b.textContent=r+'米';b.onclick=()=>{input.value=i;commit();};ticks.append(b);}
 box.append(label,input,ticks);parent.append(box);sync();return {sync};
}
