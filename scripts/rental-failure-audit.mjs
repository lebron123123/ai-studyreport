// Read-only diagnostics: no tokens, credentials or private reports in output.
import pg from '../local-server/node_modules/pg/lib/index.js';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try {
 const result=await db.query('SELECT query,state,data FROM map_rental_runs WHERE data LIKE $1 ORDER BY updated_at DESC LIMIT 3',['%'+(process.argv[2]||'华越')+'%']);
 for(const row of result.rows){const data=JSON.parse(row.data);console.log(JSON.stringify({query:row.query,state:row.state,communities:data.communities,channels:data.channels,error:data.error},null,2));}
 const samples=await db.query('SELECT data FROM map_rental_observations WHERE data LIKE $1 ORDER BY observed_at DESC LIMIT 5',['%'+(process.argv[2]||'华越')+'%']);
 for(const row of samples.rows)console.log('OBSERVATION',row.data);
}finally{await db.end();}
