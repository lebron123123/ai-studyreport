import pg from '../local-server/node_modules/pg/lib/index.js';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try{
 await db.query('BEGIN READ ONLY');
 const p=await db.query("SELECT id,user_id,name,updated_at,length(data) bytes,data FROM projects WHERE name LIKE ANY($1)",[['%税务%','%龙岗%']]);
 for(const row of p.rows){const data=JSON.parse(row.data);delete row.data;console.log(JSON.stringify({project:row,keys:Object.keys(data),meta:data.meta,archived:data.archived,versions:(data.reportVersions||[]).map(v=>({id:v.id,name:v.name,version:v.version,keys:Object.keys(v)}))}));}
 const tax=p.rows.find(r=>r.name.includes('税务'));
 if(tax){const raw=JSON.parse((await db.query('SELECT data FROM projects WHERE id=$1',[tax.id])).rows[0].data);console.log('tax metadata',JSON.stringify({project:raw.project,revision:raw.documentRevision,sessionKeys:Object.keys(raw.aiReportSession||{})}));const walk=(x,path,depth=0)=>{if(!x||typeof x!=='object'||depth>5)return;for(const [k,v]of Object.entries(x)){if(/version|history|revision|title|name|archiv|abandon/i.test(k))console.log(path+'.'+k,typeof v==='object'?JSON.stringify(Array.isArray(v)?{length:v.length,entries:v.map(y=>({id:y?.id,name:y?.name,title:y?.title,version:y?.version,keys:Object.keys(y||{})}))}:Object.keys(v||{})):String(v).slice(0,200));if(typeof v==='object'&&!['chapters','kb','materials'].includes(k))walk(v,path+'.'+k,depth+1);}};walk(raw.aiReportSession,'session');}
 console.log('studies',JSON.stringify((await db.query("SELECT id,owner_user_id,title,formal_project_id,status,version FROM research_studies WHERE title LIKE ANY($1)",[['%税务%','%龙岗%']])).rows));
 console.log('related tables',JSON.stringify((await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%backup%' OR table_name LIKE '%audit%' OR table_name LIKE '%version%')")).rows));
 await db.query('ROLLBACK');
}finally{await db.end();}
