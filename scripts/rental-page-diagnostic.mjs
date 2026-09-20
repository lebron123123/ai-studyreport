import {createRentalCrawler} from '../functions/api/_rental-crawler.js';
const crawler=createRentalCrawler();
for(const url of process.argv.slice(2)){
 try{
  const page=await crawler(url);
  console.log(JSON.stringify({url:page.url,text:page.text.slice(0,5000),links:[...page.html.matchAll(/href=["']([^"']+)["']/g)].map(m=>m[1]).filter(x=>/2810894728|xiaoqu/.test(x)).slice(0,40)}));
 }catch(error){console.log(JSON.stringify({url,error:error.message}));}
}
