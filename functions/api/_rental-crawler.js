// Restricted, cookie-free collector. No proxy rotation, CAPTCHA bypass or arbitrary URLs.
export const rentalHosts=new Set(['sz.lianjia.com','sz.zu.ke.com','shenzhen.anjuke.com','sz.58.com','zu.fang.com','sz.zu.fang.com','sz.esf.fang.com','sz.zufun.cn','sz.ziroom.com','shenzhen.leyoujia.com','wap.leyoujia.com']);
const agent='StudyReportRentalBot';
rentalHosts.add('zzaj-h5.szajfw.com');
rentalHosts.add('www.fang.com');
export function assertRentalUrl(value) {
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port||!rentalHosts.has(u.hostname))throw Error('该房源站点尚未接入采集白名单');
 if(u.hostname==='www.fang.com'&&u.pathname!=='/robots.txt'&&!/^\/xiaoqu\/sz-\d+\/$/.test(u.pathname))throw Error('仅采集房天下深圳小区公开页');
 if(u.hostname==='wap.leyoujia.com'&&u.pathname!=='/robots.txt'&&!u.pathname.startsWith('/shenzhen/'))throw Error('仅采集深圳公开房源页面');
 if(u.hostname==='zzaj-h5.szajfw.com'&&!['/robots.txt','/room-type/list','/room-type/detail'].includes(u.pathname))throw Error('仅采集运营方公开房源页面');
 return u;
}
export function robotsAllowed(text,path) {
 const groups=[];let group=null,hasRules=false;
 for(const raw of text.split(/\r?\n/)){
  const line=raw.replace(/#.*$/,'').trim(),i=line.indexOf(':');if(i<0)continue;
  const key=line.slice(0,i).trim().toLowerCase(),value=line.slice(i+1).trim();
  if(key==='user-agent'){if(!group||hasRules){group={agents:[],rules:[]};groups.push(group);hasRules=false;}group.agents.push(value.toLowerCase());}
  else if(group&&['allow','disallow','crawl-delay'].includes(key)){hasRules=true;group.rules.push({key,value});}
 }
 const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&agent.toLowerCase().includes(a))),chosen=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
 let best=-1,allowed=true,delay=2000;
 for(const g of chosen)for(const {key,value} of g.rules){
  if(key==='crawl-delay'){if(Number.isFinite(Number(value)))delay=Math.max(delay,Number(value)*1000);continue;}
  if(!value)continue;
  const end=value.endsWith('$'),pattern=(end?value.slice(0,-1):value).split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
  if(new RegExp('^'+pattern+(end?'$':'')).test(path)){const size=value.replace(/[*$]/g,'').length;if(size>best||size===best&&key==='allow'){best=size;allowed=key==='allow';}}
 }
 return {allowed,delay};
}
export async function boundedRentalFetch(value,{fetcher=fetch,maxBytes=1000000}={}) {
 const u=assertRentalUrl(value),response=await fetcher(u.href,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'user-agent':agent+'/1.0','accept':'text/html,text/plain'}});
 if(response.status>=300&&response.status<400){await response.body?.cancel();const error=Error('站点重定向，需核查后接入');error.redirectLocation=response.headers.get('location');throw error;}
 if(!response.ok){await response.body?.cancel();const error=Error(response.status===429?'站点限流，停止本轮采集':'房源站点返回HTTP '+response.status);error.status=response.status;throw error;}
 if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw Error('房源页面超过采集大小限制');}
 const reader=response.body?.getReader();if(!reader)throw Error('房源页面为空');
 const decoder=new TextDecoder();let bytes=0,text='';
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maxBytes)throw Error('房源页面超过采集大小限制');text+=decoder.decode(part.value,{stream:true});}return text+decoder.decode();}finally{await reader.cancel().catch(()=>{});}
}
export function rentalPageText(html) {
 const text=html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim().slice(0,60000);
 if(/captcha|人机验证|安全验证|访问过于频繁|请完成验证/i.test(text))throw Error('站点要求验证，未绕过；请使用其他来源');
 return text;
}
export function createRentalCrawler({fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,maxPages=8}={}) {
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>32)throw Error('页面预算须为1至32页');
 const policies=new Map(),last=new Map(),blocked=new Set(),pages=new Map();let requests=0,queue=Promise.resolve();
 const crawl=async (value,redirects=0)=>{
  const u=assertRentalUrl(value);if(blocked.has(u.hostname))throw Error('该站点本轮已暂停');if(requests>=maxPages)throw Error('本轮页面采集预算已用完');
  let policy=policies.get(u.hostname);
  if(!policy){try{policy=await boundedRentalFetch(u.origin+'/robots.txt',{fetcher,maxBytes:256000});if(/<html|<!doctype|captcha|安全验证|人机验证/i.test(policy))throw Error('非规则文本');policies.set(u.hostname,policy);last.set(u.hostname,now());}catch{blocked.add(u.hostname);throw Error('无法核实站点采集规则，本轮跳过该站点');}}
  const rule=robotsAllowed(policy,u.pathname+u.search);if(!rule.allowed)throw Error('站点robots规则不允许本采集器访问');
  if(rule.delay>10000)throw Error('站点要求较长采集间隔，本轮预算不足');
  await sleep(Math.max(0,rule.delay-(now()-(last.get(u.hostname)||0))));requests++;last.set(u.hostname,now());
  try{const html=await boundedRentalFetch(u.href,{fetcher});return {url:u.href,html,text:rentalPageText(html),fetchedAt:new Date(now()).toISOString()};}catch(e){
   if(e.redirectLocation){if(redirects>=3)throw Error('房源链接重定向过多');const target=assertRentalUrl(new URL(e.redirectLocation,u).href);return crawl(target.href,redirects+1);}
   // A removed listing is not a site-wide denial. Keep other communities usable.
   if([401,403,429].includes(e.status)||/验证|访问过于频繁/.test(e.message))blocked.add(u.hostname);throw e;
  }
 };
 return value=>{const key=assertRentalUrl(value).href;if(pages.has(key))return pages.get(key);const next=queue.then(()=>crawl(key));pages.set(key,next);next.catch(()=>pages.delete(key));queue=next.catch(()=>{});return next;};
}
