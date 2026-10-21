import pg from '../local-server/node_modules/pg/lib/index.js';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{await db.query('BEGIN READ ONLY');const r=(await db.query("SELECT id,data,updated_at,user_id FROM projects WHERE id=$1",['1bb24013-18ce-4819-9588-09fe98e5e0c0'])).rows[0];const d=JSON.parse(r.data);
console.log('rank', (await db.query('SELECT count(*) FROM projects WHERE user_id=$1 AND updated_at>$2',[r.user_id,r.updated_at])).rows);
console.log('workflow keys',Object.keys(d.workflow||{}),'session type',typeof d.aiReportSession,'management',JSON.stringify(d.workflow?.management));
function scan(x,path,depth=0){if(!x||typeof x!=='object'||depth>4)return;for(const[k,v]of Object.entries(x)){if(/version|history|revision/i.test(k))console.log(path+'.'+k,Array.isArray(v)?v.map(y=>({id:y?.id,name:y?.name,label:y?.label,version:y?.version,keys:Object.keys(y||{})})):typeof v==='object'?Object.keys(v||{}):String(v).slice(0,100));if(typeof v==='object'&&!['kb','project','materials','sections'].includes(k))scan(v,path+'.'+k,depth+1);}}scan(d,'root');
console.log('chapter count',d.chapters?.length);
await db.query('ROLLBACK');}finally{await db.end();}
