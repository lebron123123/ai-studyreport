import {portfolioCategories,validatePortfolio} from './portfolio-core.mjs';
import {validatePortfolioLocation} from './portfolio-location.mjs';
import {splitPortfolioFields} from './portfolio-fields.mjs';
const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
export function portfolioCard(p,{compact=false}={}){
 const box=node('section','');box.className='portfolio-card';box.style.cssText='background:#fff6cf;color:#463d25;padding:14px;border:1px solid #e5ce7b;border-radius:10px;max-height:55vh;overflow:auto;font:13px/1.6 system-ui;min-width:240px;';
 box.append(node('h3',p.name),node('p',portfolioCategories[p.category]+(p.potentialTier?' · '+p.potentialTier:'')),node('p',p.locationStatus==='confirmed'?'地址：'+p.address:'地址待核实 · 暂不落点'));
 if(!compact&&p.locationEvidence)box.append(node('p','定位核对：'+p.locationEvidence));
 if(!compact&&p.locationSource)box.append(node('small','地址来源：'+p.locationSource.sourceFile+'；点位仅表达项目位置，不代表宗地边界或具体楼栋。'));
 for(const [i,record] of p.records.entries()){
  if(compact&&i!==p.preferredRecord)continue;
  const details=node('details','');details.open=i===p.preferredRecord;details.append(node('summary',compact?'项目关键数据':record.sheet+' · 第'+record.row+'行'+(i===p.preferredRecord?'（主展示）':'')));
  const table=node('table','');table.style.cssText='border-collapse:collapse;width:100%';
  const [main,side]=splitPortfolioFields(record.fields);
  for(const f of main){const tr=node('tr',''),label=node('th',f.label),value=node('td',f.display);label.style.cssText='text-align:left;font-weight:500;padding:5px;border-bottom:1px solid #e7dcae;width:48%';value.style.cssText='padding:5px;border-bottom:1px solid #e7dcae;overflow-wrap:anywhere';tr.append(label,value);table.append(tr);}details.append(table);
  if(!compact&&side.length){const extra=node('details','');extra.append(node('summary','原表右侧独立对照列（不计入本项目）'));for(const f of side)extra.append(node('p',f.label+'：'+f.display));details.append(extra);}box.append(details);
 }
 if(!compact)box.append(node('small','来源：'+p.sourceFile+'。不同工作表保留原值，不自动合并冲突数值；分类不代表竣工或租售核验。'));return box;
}
export async function fetchPortfolio(headers,signal){
 const items=[];let offset=0;do{const r=await fetch('/api/projectportfolio?offset='+offset,{headers:headers(),signal}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'台账读取失败');if(!Array.isArray(d.items)||d.nextOffset!==null&&(!Number.isInteger(d.nextOffset)||d.nextOffset<=offset))throw Error('台账分页响应无效');items.push(...d.items);offset=d.nextOffset;if(items.length>10000)throw Error('台账超出单次地图容量，请分批筛选');}while(offset!==null);return items;
}
export function openPortfolioImport({headers,onSaved}){
 const dialog=node('dialog','');dialog.style.cssText='width:min(700px,90vw);border:1px solid #ddd;border-radius:12px;padding:20px';
 const title=node('h2','安居项目台账'),status=node('p','选择台账或已核对的位置补充包。位置补充仅更新地址与定位，不覆盖财务资料。'),input=node('input','');input.type='file';input.accept='.json';const list=node('div',''),run=node('button','导入到投资项目库'),close=node('button','关闭');run.disabled=true;let projects=[],busy=false,locationMode=false;
 dialog.append(title,status,input,run,close,list);document.body.append(dialog);dialog.showModal();close.onclick=()=>{if(!busy)dialog.close();};dialog.oncancel=e=>{if(busy)e.preventDefault();};dialog.onclose=()=>dialog.remove();
 input.onchange=async()=>{run.disabled=true;try{const f=input.files[0];if(!f)return;if(f.size>8*1024*1024)throw Error('导入包最多8MiB');const b=JSON.parse(await f.text());locationMode=b.format==='anju-portfolio-locations-v1';if(!locationMode&&b.format!=='anju-portfolio-v1'||!Array.isArray(b.projects)||!b.projects.length||b.projects.length>2000)throw Error('台账格式无效');projects=b.projects.map(locationMode?validatePortfolioLocation:validatePortfolio);if(new Set(projects.map(p=>p.sourceKey)).size!==projects.length)throw Error('导入包包含重复项目');status.textContent='核对完成：'+projects.length+'个项目；'+projects.filter(p=>(p.status||p.locationStatus)!=='confirmed').length+'个待定位，暂不画点。';run.textContent=locationMode?'更新项目位置（保留财务资料）':'导入到投资项目库';run.disabled=false;}catch(e){status.textContent=e.message;}};
 run.onclick=async()=>{if(busy)return;busy=true;run.disabled=input.disabled=close.disabled=true;let created=0,skipped=0,failed=0;list.replaceChildren();try{const existing=locationMode?await fetchPortfolio(headers):[];for(const [i,project] of projects.entries()){status.textContent='正在导入 '+(i+1)+' / '+projects.length;try{const matches=existing.filter(p=>p.portfolio.sourceKey===project.sourceKey&&p.permissions?.edit);if(locationMode&&matches.length!==1)throw Error('没有唯一可编辑的已有项目，请核对台账');const body=locationMode?{action:'location',id:matches[0].id,expectedUpdatedAt:matches[0].updated_at,location:project}:{action:'import',project};const r=await fetch('/api/projectportfolio',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify(body)}),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'导入失败');(d.created||d.updated)?created++:skipped++;}catch(e){failed++;list.append(node('p',project.name+'：'+e.message));}}status.textContent=`${locationMode?'更新位置':'新增'}${created}；重复跳过${skipped}；失败${failed}。财务原始资料未覆盖。`;await onSaved?.();}catch(e){status.textContent='导入中止：'+e.message;}finally{busy=false;run.disabled=input.disabled=close.disabled=false;}};
}
