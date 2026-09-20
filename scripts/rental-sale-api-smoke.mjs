// User-requested public market-price collection; never print credentials.
import pg from '../local-server/node_modules/pg/lib/index.js';
import {signToken} from '../functions/api/_auth.js';
import assert from 'node:assert/strict';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
 const u=(await db.query('SELECT id,username FROM users WHERE username=$1',['zgbyd'])).rows[0];assert.ok(u);
 const headers={authorization:'Bearer '+await signToken(process.env,u.id,u.username),'content-type':'application/json'};
 for(let n=0;n<36;n++){
  const r=await fetch('http://localhost:8080/api/maprentals',{method:'POST',headers,body:JSON.stringify({point:[114.02905103405446,22.63948998565567],radius:2000,kind:'住宅',market:'sale',action:n===0?'collect':'list'}),signal:AbortSignal.timeout(30000)});
  const data=await r.json();assert.equal(r.status,200);assert.ok((data.items||[]).every(x=>x.market==='sale'&&!x.monthlyRent));
  console.log(JSON.stringify({state:data.run?.state,busy:data.busy,items:data.items?.length,channels:data.run?.channels,samples:data.items?.map(x=>({name:x.community,price:x.saleUnitPrice,url:x.url}))}));
  if(data.run?.state!=='running'&&!data.busy)break;
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
}finally{await db.end();}
