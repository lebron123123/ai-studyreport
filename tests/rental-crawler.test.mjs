import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRentalUrl,robotsAllowed,boundedRentalFetch,rentalPageText,createRentalCrawler} from '../functions/api/_rental-crawler.js';
test('失效房源不封停整个站点，成功页面同轮复用且限流仍熔断',async()=>{
 const calls=[];const crawl=createRentalCrawler({sleep:async()=>{},fetcher:async u=>{calls.push(u);return new Response(u.endsWith('robots.txt')?'User-agent: *\nAllow: /':'公开房源',{status:u.endsWith('/gone')?404:u.endsWith('/limited')?429:200});}});
 await assert.rejects(crawl('https://shenzhen.leyoujia.com/gone'),/404/);
 await crawl('https://shenzhen.leyoujia.com/good');await crawl('https://shenzhen.leyoujia.com/good');
 assert.equal(calls.filter(u=>u.endsWith('/good')).length,1);
 await assert.rejects(crawl('https://shenzhen.leyoujia.com/limited'),/限流/);
 await assert.rejects(crawl('https://shenzhen.leyoujia.com/another'),/暂停/);
});
test('重定向逐跳校验白名单和robots，保存最终证据URL',async()=>{
 const calls=[];
 const crawl=createRentalCrawler({sleep:async()=>{},fetcher:async u=>{calls.push(u);return new Response(u.endsWith('robots.txt')?'User-agent: *\nAllow: /':u.endsWith('/old')?'':'5000元/月',{...(u.endsWith('/old')?{status:302,headers:{location:'/new'}}:{})});}});
 assert.equal((await crawl('https://shenzhen.leyoujia.com/old')).url,'https://shenzhen.leyoujia.com/new');
 assert.equal(calls.length,3);
 const unsafe=createRentalCrawler({sleep:async()=>{},fetcher:async u=>u.endsWith('robots.txt')?new Response('User-agent: *\nAllow: /'):new Response('',{status:302,headers:{location:'https://127.0.0.1/private'}})});
 await assert.rejects(unsafe('https://shenzhen.leyoujia.com/old'),/白名单/);
 const denied=createRentalCrawler({sleep:async()=>{},fetcher:async u=>u.endsWith('robots.txt')?new Response('User-agent: *\nDisallow: /new'):new Response('',{status:302,headers:{location:'/new'}})});
 await assert.rejects(denied('https://shenzhen.leyoujia.com/old'),/robots/);
});
test('爬虫只访问准确白名单，不接受内网、凭据、端口和相似域名',()=>{
 for(const u of ['http://sz.lianjia.com/','https://127.0.0.1/','https://sz.lianjia.com.evil.com/','https://x@sz.lianjia.com/','https://sz.lianjia.com:444/'])assert.throws(()=>assertRentalUrl(u));
 assert.equal(assertRentalUrl('https://sz.lianjia.com/zufang/').hostname,'sz.lianjia.com');
});
test('robots按通配组、专属组和最长规则匹配',()=>{
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /','/zufang/').allowed,false);
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /\nAllow: /public/','/public/a').allowed,true);
 assert.equal(robotsAllowed('User-agent: StudyReportRentalBot\nDisallow: /private\nUser-agent: *\nDisallow: /','/a').allowed,true);
 assert.equal(robotsAllowed('User-agent: *\nDisallow: /*?token=*','/x?token=abc').allowed,false);
});
test('大小限制、验证码和重定向明确失败',async()=>{
 await assert.rejects(boundedRentalFetch('https://sz.lianjia.com/',{maxBytes:2,fetcher:async()=>new Response('long')}),/大小/);
 await assert.rejects(boundedRentalFetch('https://sz.lianjia.com/',{fetcher:async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1'}})}),/重定向/);
 assert.throws(()=>rentalPageText('<h1>安全验证</h1>'),/验证/);
 assert.equal(rentalPageText('<script>secret</script><p>租金 5000元/月</p>'),'租金 5000元/月');
});
test('禁止路径不抓正文，单站点验证失败后熔断',async()=>{
 const calls=[];const crawl=createRentalCrawler({sleep:async()=>{},fetcher:async u=>{calls.push(u);return new Response(u.endsWith('robots.txt')?'User-agent: *\nDisallow: /':'正文');}});
 await assert.rejects(crawl('https://sz.lianjia.com/zufang/'),/robots/);assert.equal(calls.length,1);
});
