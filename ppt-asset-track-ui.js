(function(root){
  "use strict";
  if(!root.PptWorkspace||!root.PptAssetGovernance||!root.PptRenderTracks||!root.PptImageProviders)return;
  const W=root.PptWorkspace,S=W.state,A=root.PptAssetGovernance,R=root.PptRenderTracks,I=root.PptImageProviders;
  const oldRender=root.renderPptWorkspace,oldBind=root.bindPptWorkspace;
  let providerStatus=null,providerStatusLoading=false;
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const plan=()=>S.current&&S.current.data;
  const slide=()=>plan()&&(plan().slides||[])[S.selected];
  const auth=()=>{try{return typeof root.authHeaders==="function"?root.authHeaders():{};}catch{return{};}};

  function trackHtml(s,p){
    const resolved=R.resolve(s,p);
    return'<div class="ppt-render-track"><label><b>本页渲染轨</b><select id="pptRenderTrack">'
      +'<option value="auto" '+(!s.renderTrack||s.renderTrack==='auto'?'selected':'')+'>智能选择</option>'
      +'<option value="editable" '+(s.renderTrack==='editable'?'selected':'')+'>可编辑组件轨</option>'
      +'<option value="native" '+(s.renderTrack==='native'?'selected':'')+' '+(!R.nativeEligible(s,p)?'disabled':'')+'>真实模板页面轨</option>'
      +'</select></label><span>当前：'+(resolved.track==='native'?'真实模板':'可编辑组件')+' · '+esc(resolved.reason)+'</span></div>';
  }
  function providerOptions(selected){
    const rows=[
      ["local-illustration","本地智能插图（无需配置）"],
      ["nano-banana","Nano Banana（云端API）"],
      ["comfyui","ComfyUI / Stable Diffusion（本地）"],
      ["project-assets","项目已有图片"],
      ["department-assets","部门已审核素材"]
    ];
    return rows.map(([id,label])=>'<option value="'+id+'" '+(selected===id?'selected':'')+'>'+label+'</option>').join('');
  }
  function providerHint(id){
    if(id==="local-illustration")return"完全本地，不调用外部服务";
    if(id==="project-assets")return"仅检索当前项目已导入图片";
    if(id==="department-assets")return"仅检索管理员审核通过的部门素材";
    const row=providerStatus&&providerStatus.providers&&providerStatus.providers.find(x=>x.id===id);
    if(!row)return"正在读取服务状态…";
    return(row.available?"✓ 可用 · ":"⚠ 未配置 · ")+(row.model||row.reason||"");
  }
  function assetHtml(s,p){
    const rows=(s.assetCandidates||[]).slice(-6),sum=A.summary(p),selected=p.imageProviderChoice||"local-illustration";
    return'<div class="ppt-asset-govern"><div class="ppt-asset-head"><div><b>素材与AI生图候选</b><span>选择Provider后才会调用；候选必须人工采用</span></div></div>'
      +'<div class="ppt-provider-bar"><label>图片来源<select id="pptImageProvider">'+providerOptions(selected)+'</select></label>'
      +'<label>质量<select id="pptImageMode"><option value="fast" '+(p.imageProviderMode==='fast'?'selected':'')+'>快速草图</option><option value="standard" '+(!p.imageProviderMode||p.imageProviderMode==='standard'?'selected':'')+'>标准</option><option value="premium" '+(p.imageProviderMode==='premium'?'selected':'')+'>精品</option></select></label>'
      +'<button class="btn" id="pptGenerateAssets">生成/检索候选</button><small class="ppt-provider-hint">'+esc(providerHint(selected))+'</small></div>'
      +(rows.length?'<div class="ppt-asset-candidates">'+rows.map(x=>'<article class="'+esc(x.status)+'"><img src="'+esc(x.dataUrl)+'" alt=""><div><b>'+esc(x.label)+'</b><small>'+esc(x.provider)+' · '+esc(x.sourceRef)+'</small></div><footer>'+(x.status==='candidate'?'<button data-asset-approve="'+esc(x.id)+'">采用</button><button data-asset-reject="'+esc(x.id)+'">拒绝</button>':'<span>'+(x.status==='approved'?'已采用':'已拒绝')+'</span>')+'</footer></article>').join('')+'</div>':'<div class="ppt-asset-empty">尚无候选。云端或本地AI只有在主动点击后才会生成图片。</div>')
      +'<small>本项目：候选 '+sum.candidate+' · 已采用 '+sum.approved+' · 已拒绝 '+sum.rejected+'</small></div>';
  }
  root.renderPptWorkspace=function(){
    let html=oldRender(),p=plan(),s=slide();if(!p||!s)return html;
    const prepared=R.prepare(p);p.renderTrackSummary=prepared.renderTrackSummary;p.hybridTemplate=prepared.hybridTemplate;p.nativeTemplate=prepared.nativeTemplate;
    html=html.replace('<label>动态组件',trackHtml(s,p)+'<label>动态组件');
    html=html.replace('<div class="ppt-agent-toolbar">',assetHtml(s,p)+'<div class="ppt-agent-toolbar">');
    return html;
  };
  function redraw(){const sheet=document.getElementById('sheet');if(sheet){sheet.innerHTML=root.renderPptWorkspace();root.bindPptWorkspace();}}
  async function loadStatus(){
    if(providerStatus||providerStatusLoading||typeof root.fetch!=="function")return;
    providerStatusLoading=true;
    try{const response=await root.fetch('/api/ppt-image-status',{headers:auth()});const data=await response.json();if(response.ok&&data.ok)providerStatus=data;}
    catch{}finally{providerStatusLoading=false;if(providerStatus)redraw();}
  }
  root.bindPptWorkspace=function(){
    oldBind();const p=plan(),s=slide();if(!p||!s)return;loadStatus();
    const track=document.getElementById('pptRenderTrack');if(track)track.onchange=()=>{s.renderTrack=track.value;p.renderTrackSummary=R.summarize(p);redraw();};
    const provider=document.getElementById('pptImageProvider');if(provider)provider.onchange=()=>{p.imageProviderChoice=provider.value;redraw();};
    const mode=document.getElementById('pptImageMode');if(mode)mode.onchange=()=>{p.imageProviderMode=mode.value;};
    const gen=document.getElementById('pptGenerateAssets');if(gen)gen.onclick=async()=>{
      gen.disabled=true;const choice=p.imageProviderChoice||'local-illustration';
      try{
        const spec=A.promptFor(s,p),rows=await I.search(spec.query,{plan:p,style:p.templateId,accent:(p.designSpec||{}).accent,imageProviderOptions:{mode:p.imageProviderMode||'standard',aspectRatio:'16:9',imageSize:'1K'}},[choice]);
        const errors=rows.filter(x=>x.error);if(errors.length)throw new Error(errors.map(x=>x.error).join('；'));
        if(!rows.length)throw new Error('当前来源没有找到可用图片');
        S.current.data=A.addCandidates(p,s.id,rows);redraw();
      }catch(error){S.message='素材候选生成失败：'+error.message;redraw();}
    };
    document.querySelectorAll('[data-asset-approve]').forEach(b=>b.onclick=()=>{S.current.data=A.decide(p,s.id,b.dataset.assetApprove,'approve');redraw();});
    document.querySelectorAll('[data-asset-reject]').forEach(b=>b.onclick=()=>{S.current.data=A.decide(p,s.id,b.dataset.assetReject,'reject');redraw();});
  };
  if(root.document)root.document.documentElement.dataset.pptAssetTrackUi='loaded';
})(window);
