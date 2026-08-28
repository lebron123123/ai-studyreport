/* 联网研究公共核心：零 Node 依赖，Cloudflare Pages 与本地 Hono 共用。 */

const WR_STOP_WORDS = new Set(["项目","分析","情况","有关","相关","研究","报告","建设","深圳市","住房"]);

export function wrText(value, max=500){
  return String(value == null ? "" : value).replace(/\s+/g," ").trim().slice(0,max);
}

export function wrCanonicalUrl(value){
  try{
    const url=new URL(String(value||""));
    url.hash="";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","spm","from"].forEach(k=>url.searchParams.delete(k));
    if(url.pathname!=="/")url.pathname=url.pathname.replace(/\/+$/," ").trim();
    return url.toString();
  }catch(e){return "";}
}

export function wrAssertPublicUrl(value){
  let url;
  try{url=new URL(String(value||""));}catch(e){throw new Error("网址格式无效");}
  if(!["http:","https:"].includes(url.protocol))throw new Error("只允许访问 HTTP/HTTPS 网址");
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,"");
  if(!host||host==="localhost"||host.endsWith(".local")||host.endsWith(".internal"))throw new Error("禁止访问本机或内网地址");
  const v4=host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if(v4){
    const a=v4.slice(1).map(Number);if(a.some(x=>x>255))throw new Error("IP 地址无效");
    if(a[0]===10||a[0]===127||a[0]===0||(a[0]===169&&a[1]===254)||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168)||(a[0]===100&&a[1]>=64&&a[1]<=127)||a[0]>=224)throw new Error("禁止访问本机或内网地址");
  }
  if(host==="::1"||host.startsWith("fc")||host.startsWith("fd")||host.startsWith("fe80:"))throw new Error("禁止访问本机或内网地址");
  return url;
}

export function wrProviderCatalog(env={}){
  const rows=[
    {id:"deepseek-web",name:"DeepSeek 原生联网搜索",configured:wrDeepSeekWebConfigured(env),kind:"search",priority:1},
    {id:"custom",name:"企业/第三方统一搜索",configured:!!env.WEB_SEARCH_API_URL,kind:"search",priority:2},
    {id:"brave",name:"Brave Search",configured:!!env.BRAVE_SEARCH_API_KEY,kind:"search",priority:3},
    {id:"tavily",name:"Tavily",configured:!!env.TAVILY_API_KEY,kind:"search",priority:4},
    {id:"mcp",name:"MCP 联网检索桥",configured:!!env.WEB_RESEARCH_MCP_URL,kind:"mcp",priority:5},
    {id:"licensed",name:"专业数据 Provider",configured:!!env.PRO_DATA_API_URL,kind:"licensed",priority:6},
    {id:"duckduckgo",name:"DuckDuckGo 公网降级",configured:env.WEB_SEARCH_DDG_DISABLED!=="1",kind:"search",priority:9,experimental:true}
  ];
  return rows.sort((a,b)=>a.priority-b.priority);
}

function wrFirstEnv(env,keys){
  for(const key of keys){const value=String(env[key]||"").trim();if(value)return value;}
  return "";
}

function wrDeepSeekWebConfigured(env={}){
  if(String(env.DEEPSEEK_WEB_SEARCH_DISABLED||"")==="1")return false;
  return !!wrFirstEnv(env,["DEEPSEEK_API_KEY","LLM_API_KEY"]);
}

export function wrDeepSeekResponsesUrl(env={}){
  const raw=wrFirstEnv(env,["DEEPSEEK_RESPONSES_URL","DEEPSEEK_API_URL","DEEPSEEK_BASE_URL","LLM_BASE_URL"])||"https://api.deepseek.com";
  const extracted=(String(raw).match(/https?:\/\/[^\s]+/i)||[String(raw)])[0].replace(/[，。；;]+$/,"").replace(/\/+$/,"");
  if(/\/responses$/i.test(extracted))return extracted;
  if(/\/chat\/completions$/i.test(extracted))return extracted.replace(/\/chat\/completions$/i,"/responses");
  return extracted+"/responses";
}

export function wrNormalizeDeepSeekSearchResponse(payload,provider="deepseek-web"){
  const rows=[],seen=new Map(),outputs=Array.isArray(payload?.output)?payload.output:[];
  const add=(url,title,snippet,index)=>{
    const clean=wrText(url,1600),canonical=wrCanonicalUrl(clean);if(!canonical)return;
    let host="";try{host=new URL(canonical).hostname;}catch(e){}
    const nextTitle=wrText(title,220),nextSnippet=wrText(snippet,1000);
    if(seen.has(canonical)){
      const old=rows[seen.get(canonical)];
      if(nextTitle&&(!old.title||old.title===old.publisher||old.title===canonical))old.title=nextTitle;
      if(nextSnippet.length>String(old.snippet||"").length)old.snippet=nextSnippet;
      return;
    }
    seen.set(canonical,rows.length);
    rows.push({title:nextTitle||host||canonical,url:clean,snippet:nextSnippet,publisher:host,provider,rank:index||rows.length+1});
  };
  const titleNear=(text,offset)=>{
    const before=String(text||"").slice(Math.max(0,offset-360),offset),bold=[...before.matchAll(/\*\*([^*\n]{3,220})\*\*/g)];
    if(bold.length)return wrText(bold[bold.length-1][1].replace(/^\d+[.、]\s*/,""),220);
    const lines=before.split(/\r?\n/).map(x=>wrText(x.replace(/^[-*#>\s]+/,"").replace(/^\d+[.、]\s*/,""),220)).filter(Boolean);
    return [...lines].reverse().find(x=>!/(网址|链接|来源|发布日期)[:：]?$/.test(x)&&!/^https?:\/\//i.test(x))||"";
  };
  for(const item of outputs){
    if(item?.type!=="message"||!Array.isArray(item.content))continue;
    for(const content of item.content){
      if(content?.type!=="output_text")continue;
      const text=String(content.text||"");
      for(const annotation of (Array.isArray(content.annotations)?content.annotations:[])){
        const citation=annotation?.url_citation||annotation||{},start=Number(citation.start_index),end=Number(citation.end_index);
        const nearby=Number.isFinite(start)?text.slice(Math.max(0,start-140),Number.isFinite(end)?Math.min(text.length,end+280):Math.min(text.length,start+420)):text.slice(0,800);
        add(citation.url,citation.title,nearby,rows.length+1);
      }
      for(const match of text.matchAll(/https?:\/\/[^\s)）\]】>]+/g))add(match[0].replace(/[，。；;]+$/,"").trim(),titleNear(text,match.index||0),text.slice(Math.max(0,(match.index||0)-160),Math.min(text.length,(match.index||0)+500)),rows.length+1);
    }
  }
  return rows;
}

function wrHousingLabel(type){return type==="sale"?"配售型保障性住房":type==="gaibao"?"非居住存量房屋改建保障性租赁住房":"保障性租赁住房";}

export function buildHousingSearchPlan(input={}){
  const project=wrText(input.projectName,80),location=wrText(input.location,100),chapter=wrText(input.chapter,80),section=wrText(input.section,100),need=wrText(input.requirement||input.requiredSources,180),housing=wrHousingLabel(input.projectType);
  const place=(location||project||"深圳").replace(/\s+/g,"");
  const dimensions=[];
  const push=(dimension,query,domains=[],reason="")=>{query=wrText(query,220);if(query&&!dimensions.some(x=>x.query===query))dimensions.push({dimension,query,domains,reason});};
  push("project",[project,place,"项目 批复 规划 公示"].filter(Boolean).join(" "),[],"核验项目层面的批复、公示和建设信息");
  push("policy",[place,housing,"政策 实施办法 认定标准"].join(" "),["gov.cn","sz.gov.cn"],"查找现行政策口径和适用边界");
  push("statistics",[place,"统计公报 常住人口 就业 人口结构"].join(" "),["stats.gov.cn","tjj.sz.gov.cn"],"补充人口与经济社会统计依据");
  push("market",[place,housing,"租金 房价 供应 需求 市场"].join(" "),[],"形成市场与供需分析证据");
  push("planning",[place,"国土空间规划 住房发展规划 产业规划"].join(" "),["pnr.sz.gov.cn","zjj.sz.gov.cn"],"核验规划与空间发展方向");
  if(chapter||section)push("section",[place,chapter,section,need].filter(Boolean).join(" "),[],"直接服务当前可研小节");
  if(need)push("evidence",[place,need].join(" "),[],"按生成逻辑中指定的材料名称检索");
  push("official",[place,housing,"site:gov.cn"].join(" "),["gov.cn"],"优先召回政府官方来源");
  return {projectName:project,location,projectType:input.projectType||"rent",chapter,section,queries:dimensions.slice(0,Math.max(1,Math.min(Number(input.maxQueries)||8,12)))};
}

function wrDecodeHtml(s){return String(s||"").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));}
function wrStripHtml(s){return wrText(wrDecodeHtml(String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")),20000);}

export function wrNormalizeSearchPayload(payload,provider){
  const candidates=Array.isArray(payload)?payload:(payload?.results||payload?.web?.results||payload?.data?.results||payload?.data||payload?.items||[]);
  return (Array.isArray(candidates)?candidates:[]).map((r,index)=>({
    title:wrText(r.title||r.name||r.heading,220),url:wrText(r.url||r.link||r.href,1600),snippet:wrText(r.snippet||r.description||r.content||r.text,1000),publisher:wrText(r.publisher||r.source||r.site_name||r.domain,120),publishedAt:wrText(r.publishedAt||r.published_at||r.date||r.age,60),provider,rank:index+1
  })).filter(x=>x.title&&wrCanonicalUrl(x.url));
}

export function wrAuthority(url,publisher=""){
  let host="";try{host=new URL(url).hostname.toLowerCase();}catch(e){}
  const label=(publisher+" "+host).toLowerCase();
  if(/\.gov\.cn$|(^|\.)gov\.cn$|stats\.gov\.cn|tjj\.|zjj\.|pnr\./.test(host))return {level:"A",score:95,reason:"政府或统计主管部门"};
  if(/\.edu\.cn$|\.ac\.cn$|高校|研究院|科学院/.test(label))return {level:"B",score:82,reason:"高校或权威研究机构"};
  if(/新华社|人民网|央视|证券时报|经济日报/.test(label))return {level:"B",score:78,reason:"主流权威媒体"};
  if(/中指|wind|克而瑞|贝壳|安居客|行业协会/.test(label))return {level:"C",score:66,reason:"行业数据或市场平台"};
  return {level:"D",score:45,reason:"一般公开网页，需交叉核验"};
}

export function wrDeduplicate(results){
  const map=new Map();
  for(const row of results||[]){
    const canonical=wrCanonicalUrl(row.url);if(!canonical)continue;
    const key=canonical.toLowerCase();const authority=wrAuthority(canonical,row.publisher);
    const value={...row,canonicalUrl:canonical,authorityLevel:authority.level,authorityScore:authority.score,authorityReason:authority.reason};
    const old=map.get(key);if(!old||value.authorityScore>old.authorityScore)map.set(key,value);
  }
  return [...map.values()].sort((a,b)=>b.authorityScore-a.authorityScore||a.rank-b.rank);
}

function wrTokens(value){
  const words=String(value||"").toLowerCase().match(/[\u4e00-\u9fa5]{2,8}|[a-z0-9]{3,}/g)||[];
  return new Set(words.filter(x=>!WR_STOP_WORDS.has(x)).slice(0,120));
}
export function wrCrossVerify(results){
  const rows=(results||[]).map(x=>({...x,verificationCount:0,verificationStatus:"single"}));
  const tokens=rows.map(x=>wrTokens((x.title||"")+" "+(x.snippet||"")));
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    let same=0;for(const t of tokens[i])if(tokens[j].has(t))same++;
    let hi="",hj="";try{hi=new URL(rows[i].url).hostname;hj=new URL(rows[j].url).hostname;}catch(e){}
    if(same>=2&&hi&&hj&&hi!==hj){rows[i].verificationCount++;rows[j].verificationCount++;}
  }
  return rows.map(x=>({...x,verificationStatus:x.verificationCount>=2?"multi_source":x.verificationCount===1?"cross_checked":"single",confidence:Math.min(99,Math.round((x.authorityScore||45)+(x.verificationCount*8)))}));
}

async function wrFetchWithTimeout(url,options={},timeoutMs=12000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort("timeout"),timeoutMs);
  try{return await fetch(url,{...options,signal:controller.signal});}finally{clearTimeout(timer);}
}

function wrDdgHtml(html){
  const rows=[];const blocks=String(html||"").split(/class="result\s/gi).slice(1);
  for(const block of blocks){
    const link=block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);if(!link)continue;
    let href=wrDecodeHtml(link[1]);try{const u=new URL(href,"https://duckduckgo.com");href=u.searchParams.get("uddg")||u.toString();}catch(e){}
    const sn=block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    rows.push({title:wrStripHtml(link[2]),url:href,snippet:wrStripHtml(sn&&(sn[1]||sn[2])||"")});
  }
  return rows;
}

export async function wrSearchProvider(env,provider,query,options={}){
  const started=Date.now(),limit=Math.max(1,Math.min(Number(options.limit)||10,20));let response,payload;
  if(provider==="deepseek-web"){
    const apiKey=wrFirstEnv(env,["DEEPSEEK_API_KEY","LLM_API_KEY"]);if(!apiKey)throw new Error("未配置 DEEPSEEK_API_KEY 或 LLM_API_KEY");
    const model=wrFirstEnv(env,["DEEPSEEK_WEB_SEARCH_MODEL","DEEPSEEK_MODEL","LLM_MODEL"])||"deepseek-v4-flash";
    response=await wrFetchWithTimeout(wrDeepSeekResponsesUrl(env),{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+apiKey},body:JSON.stringify({model,input:"请联网搜索以下内容，优先返回政府官方网站、统计部门和原始发布页；只引用真实可访问网页，并给出标题、发布时间和原始网址。\n\n检索词："+query,tools:[{type:"web_search"}],tool_choice:{type:"web_search"},reasoning:{effort:"low"},max_output_tokens:Math.max(700,Math.min(1800,limit*120))})},Number(env.DEEPSEEK_WEB_SEARCH_TIMEOUT_MS)||30000);
    payload=await response.json();
    if(!response.ok)throw new Error(wrText(payload?.error?.message||payload?.message||("HTTP "+response.status),240));
    const results=wrNormalizeDeepSeekSearchResponse(payload,provider).slice(0,limit);
    return {provider,latencyMs:Date.now()-started,results:wrNormalizeSearchPayload(results,provider)};
  }else if(provider==="custom"){
    const url=env.WEB_SEARCH_API_URL;if(!url)throw new Error("未配置 WEB_SEARCH_API_URL");
    response=await wrFetchWithTimeout(url,{method:"POST",headers:{"content-type":"application/json",...(env.WEB_SEARCH_API_KEY?{"authorization":"Bearer "+env.WEB_SEARCH_API_KEY}: {})},body:JSON.stringify({query,q:query,limit,count:limit})},Number(env.WEB_SEARCH_TIMEOUT_MS)||12000);
    payload=await response.json();
  }else if(provider==="brave"){
    if(!env.BRAVE_SEARCH_API_KEY)throw new Error("未配置 BRAVE_SEARCH_API_KEY");
    response=await wrFetchWithTimeout("https://api.search.brave.com/res/v1/web/search?q="+encodeURIComponent(query)+"&count="+limit,{headers:{"accept":"application/json","x-subscription-token":env.BRAVE_SEARCH_API_KEY}},12000);payload=await response.json();
  }else if(provider==="tavily"){
    if(!env.TAVILY_API_KEY)throw new Error("未配置 TAVILY_API_KEY");
    response=await wrFetchWithTimeout("https://api.tavily.com/search",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({api_key:env.TAVILY_API_KEY,query,max_results:limit,search_depth:"advanced",include_answer:false})},15000);payload=await response.json();
  }else if(provider==="mcp"||provider==="licensed"){
    const url=provider==="mcp"?env.WEB_RESEARCH_MCP_URL:env.PRO_DATA_API_URL,key=provider==="mcp"?env.WEB_RESEARCH_MCP_KEY:env.PRO_DATA_API_KEY;if(!url)throw new Error("未配置 "+(provider==="mcp"?"WEB_RESEARCH_MCP_URL":"PRO_DATA_API_URL"));
    response=await wrFetchWithTimeout(url,{method:"POST",headers:{"content-type":"application/json",...(key?{"authorization":"Bearer "+key}: {})},body:JSON.stringify({action:"search",query,limit,domain:"affordable_housing"})},18000);payload=await response.json();
  }else if(provider==="duckduckgo"){
    response=await wrFetchWithTimeout("https://html.duckduckgo.com/html/?q="+encodeURIComponent(query),{headers:{"accept":"text/html","user-agent":"Mozilla/5.0 compatible ResearchBot/1.0"}},12000);payload=wrDdgHtml(await response.text());
  }else throw new Error("未知检索 Provider");
  if(!response.ok)throw new Error("HTTP "+response.status);
  return {provider,latencyMs:Date.now()-started,results:wrNormalizeSearchPayload(payload,provider)};
}

export async function wrSearch(env,query,options={}){
  const catalog=wrProviderCatalog(env),wanted=options.providers?.length?options.providers:catalog.filter(x=>x.configured).map(x=>x.id),errors=[];
  for(const provider of wanted){
    try{const out=await wrSearchProvider(env,provider,query,options);if(out.results.length)return {...out,errors};errors.push({provider,error:"未返回结果"});}
    catch(e){errors.push({provider,error:wrText(e.message,180)});}
  }
  return {provider:"",latencyMs:0,results:[],errors};
}

export async function wrFetchDocument(env,value,options={}){
  let current=wrAssertPublicUrl(value),response;const started=Date.now(),maxRedirects=4;
  for(let i=0;i<=maxRedirects;i++){
    response=await wrFetchWithTimeout(current.toString(),{redirect:"manual",headers:{"accept":"text/html,application/xhtml+xml,application/pdf,text/plain,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document","user-agent":"AI-StudyReport-Research/1.0"}},Number(env.WEB_FETCH_TIMEOUT_MS)||15000);
    if(response.status>=300&&response.status<400&&response.headers.get("location")){current=wrAssertPublicUrl(new URL(response.headers.get("location"),current).toString());continue;}break;
  }
  if(!response||!response.ok)throw new Error("网页获取失败：HTTP "+(response?.status||0));
  const size=Number(response.headers.get("content-length")||0),max=Number(env.WEB_FETCH_MAX_BYTES)||8*1024*1024;if(size>max)throw new Error("文件超过联网取证大小上限");
  const type=(response.headers.get("content-type")||"").toLowerCase();let title="",text="",extractStatus="text",dataBase64="";
  if(type.includes("text/")||type.includes("html")||type.includes("json")||type.includes("xml")){
    const raw=(await response.text()).slice(0,max);title=wrStripHtml((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"");text=type.includes("html")||type.includes("xml")?wrStripHtml(raw):wrText(raw,20000);
  }else{
    const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>max)throw new Error("文件超过联网取证大小上限");
    if(env.AI?.toMarkdown){const result=await env.AI.toMarkdown([{name:current.pathname.split("/").pop()||"document",blob:new Blob([bytes],{type:type||"application/octet-stream"})}]);const first=Array.isArray(result)?result[0]:result;text=wrText(first?.data,30000);extractStatus=text?"markdown":"empty";}
    else{extractStatus="binary_needs_local_parser";let binary="";const step=0x8000;for(let i=0;i<bytes.length;i+=step)binary+=String.fromCharCode(...bytes.subarray(i,i+step));dataBase64=btoa(binary);}
  }
  return {url:current.toString(),title,text,contentType:type,extractStatus,dataBase64,latencyMs:Date.now()-started,fetchedAt:new Date().toISOString()};
}
