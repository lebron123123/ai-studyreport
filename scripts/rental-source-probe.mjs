// Read-only diagnostics of public rental sources. Never reads browser credentials.
const urls=[
 'https://sz.lianjia.com/robots.txt',
 'https://sz.zu.fang.com/robots.txt',
 'https://sz.zu.fang.com/chuzu/3_246809391_1.htm',
 'https://shenzhen.leyoujia.com/robots.txt',
 'https://shenzhen.leyoujia.com/xq/detail/zf/1199/',
 'https://sz.zufun.cn/robots.txt',
 'https://sz.zufun.cn/apt/176950'
];
for(const url of (process.argv.length>2?process.argv.slice(2):urls)){
 try{const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'user-agent':'StudyReportRentalBot/1.0'}});const text=await r.text();console.log(JSON.stringify({url,status:r.status,location:r.headers.get('location'),length:text.length,cards:text.match(/<li class="item[^]*?<\/li>/g)?.slice(0,2),links:[...text.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m=>({url:m[1],label:m[2].replace(/<[^>]+>/g,'').trim()})).filter(x=>/岸|博海|浪琴|下一页|科技南/.test(x.label)),text:url.endsWith('robots.txt')?text:text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,1500)}));}catch(e){console.log(JSON.stringify({url,error:e.message}));}
}
