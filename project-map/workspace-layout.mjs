export function addressDistrict(address='') {
 const names=['大鹏新区','深汕特别合作区','福田区','南山区','罗湖区','宝安区','龙岗区','龙华区','坪山区','光明区','盐田区'];
 if(address.includes('东莞'))return '东莞市';
 return names.find(name=>address.includes(name))||'分区待核实';
}

// Move existing controls, preserving their handlers and state.
export function createWorkspaceLayout({root,layers,layerDetails,tools,history,legend,scopeGroup,rentalPanel}) {
 const panel=document.getElementById('search-panel'),body=document.getElementById('panel-body');
 const make=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const rail=make('nav','');rail.className='workspace-rail';rail.setAttribute('aria-label','地图功能分类');
 panel.before(rail);
 const panes={},buttons={};let current='projects',city=true;
 for(const [id,label,icon] of [['projects','项目','▦'],['layers','图层','▱'],['analysis','分析','▥'],['scene','三维','◇']]) {
  const pane=make('section','');pane.className='workspace-pane';pane.dataset.pane=id;panes[id]=pane;body.append(pane);
  const b=make('button',icon+'\n'+label);b.type='button';b.setAttribute('aria-label',label);buttons[id]=b;rail.append(b);
  b.onclick=()=>show(id);
 }
 panes.projects.append(root);
 layers.classList.add('workspace-layer-controls');panes.layers.append(layers);layerDetails.open=true;
 panes.analysis.append(tools,history);
 const rents=make('details','');rents.className='research-task';
 rents.append(make('summary','片区租金 · 官方参考'),make('p','深圳住建局参考租金用于片区背景说明；周边竞品挂牌样本在图层管理查看，不直接等同于片区成交均价。'));
 const rentLink=make('a','打开官方住房市场参考租金');rentLink.href='https://zjj.sz.gov.cn/fwzljgcx/vue/main';rentLink.target='_blank';rentLink.rel='noopener noreferrer';rents.append(rentLink,make('p','使用时核对价格年度。片区租金分析尚未启用；周边竞品与挂牌租金请在图层管理开启。'));panes.analysis.prepend(rents);if(rentalPanel)layerDetails.append(rentalPanel);
 scopeGroup.classList.add('workspace-radius');scopeGroup.open=false;
 document.querySelector('.viewport').append(scopeGroup);
 const projectIntro=[];
 for(const n of [...body.children]) {
  if(n.classList.contains('workspace-pane')||['search-form','results'].includes(n.id))continue;
  if(n.id==='model-list'||n.classList.contains('observation')||n.classList.contains('note')||n.tagName==='A')panes.scene.append(n);
  else if(n.tagName==='DETAILS')panes.layers.append(n);
  else projectIntro.push(n);
 }
 panes.projects.prepend(...projectIntro);
 const key=make('details','');key.className='workspace-legend';key.open=true;
 const summary=make('summary','图例');const projectKey=make('p','● 安居项目（红色）');projectKey.style.color='#d3463c';key.append(summary,projectKey,legend);document.querySelector('.viewport').append(key);
 function show(id) {
  if(id==='scene'&&city)return;
  if(id!=='scene'&&!city)return;
  current=id;
  for(const k of Object.keys(panes)){panes[k].hidden=k!==id;buttons[k].setAttribute('aria-pressed',String(k===id));}
  panel.querySelector('.panel-heading strong').textContent={projects:'项目管理',layers:'图层管理',analysis:'空间分析',scene:'三维地点与观察'}[id];
  if(body.hidden)document.getElementById('panel-toggle').click();
 }
 return {setCity(value){city=value;buttons.scene.hidden=value;for(const k of ['projects','layers','analysis'])buttons[k].hidden=!value;key.hidden=!value;scopeGroup.hidden=!value;show(value?(current==='scene'?'projects':current):'scene');}};
}
