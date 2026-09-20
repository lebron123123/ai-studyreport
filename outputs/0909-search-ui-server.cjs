const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const routes={'/':'outputs/0909-search-ui.html','/0909-search-ui-frame.html':'outputs/0909-search-ui-frame.html','/web-research-tools.js':'web-research-tools.js'};
http.createServer((req,res)=>{const p=routes[req.url];if(!p){res.writeHead(404);return res.end();}res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'..',p)));}).listen(8086,'127.0.0.1',()=>console.log('isolated UI fixture 8086'));
