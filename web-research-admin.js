/* 后台联网检索治理：只展示配置状态，不向浏览器返回任何密钥。 */
(function webResearchAdminModule(global){
  "use strict";
  const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  async function wrAdminApi(body){
    const response=await fetch("/api/webresearch",{method:"POST",headers:Object.assign({"Content-Type":"application/json"},global.authHeaders?global.authHeaders():{}),body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"操作失败");return data;
  }
  function providerCard(provider,health){
    const ok=provider.configured,record=health||{},label=record.status==="healthy"?"最近调用正常":record.status==="degraded"?"最近调用失败":"尚未实测";
    return '<article class="contrib-card"><div class="contrib-head"><div><span class="contrib-kind">'+esc(provider.kind)+'</span><span class="contrib-title">'+esc(provider.name)+'</span><div class="contrib-meta">Provider ID：'+esc(provider.id)+'　·　'+(ok?"环境变量已配置":"尚未配置")+'</div></div><span class="contrib-kind" style="background:'+(ok?"#e8f7ee":"#fff1d6")+';color:'+(ok?"#227447":"#946200")+';">'+(ok?"可尝试调用":"不可调用")+'</span></div><div class="contrib-source">健康状态：'+esc(label)+(record.latency_ms?"｜最近耗时 "+record.latency_ms+" ms":"")+(record.last_checked_at?"｜检查时间 "+new Date(Number(record.last_checked_at)).toLocaleString("zh-CN"):"")+'</div>'+(record.last_error?'<div class="contrib-note">最近错误：'+esc(record.last_error)+'</div>':'')+'</article>';
  }
  function lensCard(row){
    return '<details class="contrib-card"><summary style="cursor:pointer;"><b>'+esc(row.name)+'</b> <span class="contrib-kind">'+esc(row.dimension||"通用")+'</span> <span class="contrib-meta">v'+esc(row.version)+'</span></summary><div class="grid2" style="margin-top:12px;"><label>名称<input data-wr="name" value="'+esc(row.name)+'"></label><label>维度<input data-wr="dimension" value="'+esc(row.dimension)+'"></label></div><label>优先域名（顿号分隔）<input data-wr="domains" value="'+esc((row.domains||[]).join("、"))+'"></label><label>适用业务类型（rent、sale、gaibao）<input data-wr="housingTypes" value="'+esc((row.housingTypes||[]).join("、"))+'"></label><label>查询后缀<input data-wr="querySuffix" value="'+esc(row.query_suffix||"")+'"></label><div class="bar"><button class="btn sm wr-lens-save" data-id="'+esc(row.id)+'">保存并形成新版本</button></div></details>';
  }
  global.openWebResearchAdmin=async function(){
    const box=document.getElementById("listBox"),edit=document.getElementById("editBox");if(edit)edit.style.display="none";box.style.display="block";
    box.innerHTML='<h1>联网检索治理</h1><div class="sub">统一管理公网搜索、MCP检索桥和专业数据Provider。这里只显示“是否配置”和健康状态，密钥始终只保存在服务器环境变量。</div><div class="msg" style="background:#edf6ff;border-color:#bed8f2;color:#315f8e;">推荐顺序：企业统一搜索 → Brave/Tavily → MCP桥 → 专业数据接口 → DuckDuckGo降级。候选证据必须由用户采用后才进入可研正文。</div><div class="bar"><button class="btn sm" id="wrReload">刷新状态</button></div><div id="wrAdminBody"><div class="empty">加载中…</div></div>';
    document.getElementById("wrReload").onclick=()=>global.openWebResearchAdmin();
    try{
      const data=await wrAdminApi({action:"status"}),health=Object.fromEntries((data.health||[]).map(x=>[x.provider,x]));
      document.getElementById("wrAdminBody").innerHTML='<h2>Provider 与 MCP 状态</h2><div class="grid2">'+(data.providers||[]).map(x=>providerCard(x,health[x.id]||health.all)).join("")+'</div><h2 style="margin-top:24px;">保障房检索透镜</h2><div class="sub">透镜用于追加重点域名、业务类型和查询后缀；发布后不需要改代码即可调整搜索策略。</div><div id="wrLensList">'+(data.lenses||[]).map(lensCard).join("")+'</div><button class="btn sm ghost" id="wrAddLens">＋ 新建检索透镜</button><details class="contrib-card" style="margin-top:18px;"><summary style="cursor:pointer;font-weight:700;">服务器环境变量说明</summary><div class="contrib-body">企业统一搜索：WEB_SEARCH_API_URL / WEB_SEARCH_API_KEY\nBrave：BRAVE_SEARCH_API_KEY\nTavily：TAVILY_API_KEY\nMCP HTTP桥：WEB_RESEARCH_MCP_URL / WEB_RESEARCH_MCP_KEY\n专业数据接口：PRO_DATA_API_URL / PRO_DATA_API_KEY\n超时与大小：WEB_SEARCH_TIMEOUT_MS / WEB_FETCH_TIMEOUT_MS / WEB_FETCH_MAX_BYTES</div></details>';
      bindLensActions();document.getElementById("wrAddLens").onclick=()=>{const list=document.getElementById("wrLensList"),holder=document.createElement("div");holder.innerHTML=lensCard({id:"",name:"新检索透镜",dimension:"policy",domains:[],housingTypes:["rent","sale","gaibao"],query_suffix:"",version:0});list.appendChild(holder.firstElementChild);bindLensActions();};
    }catch(e){document.getElementById("wrAdminBody").innerHTML='<div class="msg err">'+esc(e.message)+'</div>';}
  };
  function split(v){return String(v||"").split(/[、,，;；\n]+/).map(x=>x.trim()).filter(Boolean);}
  function bindLensActions(){document.querySelectorAll(".wr-lens-save").forEach(button=>button.onclick=async()=>{const card=button.closest("details"),q=k=>card.querySelector('[data-wr="'+k+'"]').value;button.disabled=true;try{await wrAdminApi({action:"saveLens",id:button.dataset.id||undefined,name:q("name"),dimension:q("dimension"),domains:split(q("domains")),housingTypes:split(q("housingTypes")),querySuffix:q("querySuffix"),status:"active"});if(global.msg)global.msg("检索透镜已保存","ok");await global.openWebResearchAdmin();}catch(e){if(global.msg)global.msg(e.message,"err");else alert(e.message);}finally{button.disabled=false;}});}
})(window);
