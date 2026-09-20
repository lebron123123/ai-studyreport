// Real user-requested public rental collection; credentials never printed.
import pg from '../local-server/node_modules/pg/lib/index.js';
import {signToken} from '../functions/api/_auth.js';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try {
 const u=(await db.query('SELECT id,username FROM users WHERE username=$1',['zgbyd'])).rows[0];
 const headers={authorization:'Bearer '+await signToken(process.env,u.id,u.username),'content-type':'application/json'};
 const query={point:[114.02905103405446,22.63948998565567],radius:2000,kind:'住宅'};
 for(let n=0;n<110;n++) {
  const r=await fetch('http://localhost:8080/api/maprentals',{method:'POST',headers,body:JSON.stringify({...query,action:n===0?'retry':'list'}),signal:AbortSignal.timeout(30000)});
  const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));
  console.log(JSON.stringify({state:data.run?.state,items:data.items?.length,channels:data.run?.channels,communities:data.run?.communities}));
  if(data.run?.state!=='running'){console.log(JSON.stringify({samples:data.items}));break;}
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
}finally {await db.end();}
