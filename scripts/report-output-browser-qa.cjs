const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const routes={'/':'tests/fixtures/report-output-browser.html','/md.js':'md.js','/report.js':'report.js','/export.js':'export.js','/report-output-policy.js':'report-output-policy.js'};
http.createServer((req,res)=>{
 if(req.url==='/api/report-pagination'){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'[系统测试]排版服务暂不可用，禁止下载'}));return;}
 const file=routes[req.url];if(!file){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'no-store'});res.end(fs.readFileSync(path.resolve(file)));
}).listen(8087,'127.0.0.1',()=>console.log('Browser QA: http://127.0.0.1:8087'));
