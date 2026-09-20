// Read-only project selection. Public collection is explicit via --collect.
import pg from '../local-server/node_modules/pg/lib/index.js';
import {signToken} from '../functions/api/_auth.js';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
 const records=await db.query("SELECT name,data FROM projects WHERE data LIKE '%portfolio%' ORDER BY name");
 const selected=[];
 for(const row of records.rows){const p=JSON.parse(row.data).project?.portfolio;if(!p)continue;if(/未来之光|颂龙|鸣鹿|百泉|凤凰苑/.test(p.name))selected.push({name:p.name,location:p.locationSource});}
 console.log(JSON.stringify(selected.map(p=>({name:p.name,point:p.location?.point})),null,2));
 if(process.argv.includes('--collect')||process.argv.includes('--audit')){
  const user=(await db.query('SELECT id,username FROM users WHERE username=$1',['zgbyd'])).rows[0];
  const headers={authorization:'Bearer '+await signToken(process.env,user.id,user.username),'content-type':'application/json'};
  for(const project of selected){
   if(project.location?.status!=='confirmed')continue;
   await Promise.all(['rent','sale'].map(async market=>{
    for(let n=0;n<125;n++){
     const r=await fetch('http://localhost:8080/api/maprentals',{method:'POST',headers,body:JSON.stringify({point:project.location.point,radius:2000,kind:'住宅',market,action:n===0&&!process.argv.includes('--audit')?'retry':'list'}),signal:AbortSignal.timeout(30000)});
     const data=await r.json();if(!r.ok)throw Error('API '+r.status+': '+data.error);
     if(data.run?.state!=='running'&&!data.busy){console.log(JSON.stringify({project:project.name,market,state:data.run?.state,communities:data.run?.competitors,samples:data.items?.filter(x=>x.monthlyRent||x.saleUnitPrice).map(x=>({name:x.community,monthlyRent:x.monthlyRent,area:x.area,saleUnitPrice:x.saleUnitPrice,url:x.url})),channels:process.argv.includes('--audit')?Object.fromEntries(Object.entries(data.run?.channels||{}).map(([k,v])=>[k,{state:v.state,count:v.count,errors:v.errors}])):data.run?.channels}));return;}
     await new Promise(resolve=>setTimeout(resolve,5000));
    }
    console.log(JSON.stringify({project:project.name,market,error:'验收等待超时'}));
   }));
  }
 }
}finally{await db.end();}
