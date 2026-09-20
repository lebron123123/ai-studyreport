import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const db=createD1Shim(process.env.DATABASE_URL);
try{
 console.log(JSON.stringify((await db.prepare('SELECT t.section_key,t.created_at,j.updated_at,j.status FROM report_section_tasks t JOIN agent_jobs j ON j.run_id=t.run_id ORDER BY t.created_at DESC LIMIT 8').all()).results.map(x=>({section:x.section_key,secondsToLastUpdate:(x.updated_at-x.created_at)/1000,status:x.status}))));
 const rows=(await db.prepare('SELECT t.id,t.section_key,t.user_id,u.username FROM report_section_tasks t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 8').all()).results;
 if(rows[0]){const token=await signToken(process.env,rows[0].user_id,rows[0].username);const r=await fetch('http://localhost:8080/api/reporttables?projectType=gaibao-housing',{headers:{authorization:'Bearer '+token}});const d=await r.json();console.log(JSON.stringify({api:'reporttables',http:r.status,ok:d.ok,error:d.error,version:d.config?.version}));}
 for(const row of rows){const token=await signToken(process.env,row.user_id,row.username);const r=await fetch('http://localhost:8080/api/reportexecution?id='+encodeURIComponent(row.id),{headers:{authorization:'Bearer '+token}});const d=await r.json();console.log(JSON.stringify({section:row.section_key,http:r.status,error:d.error,status:d.task?.status,textLength:d.task?.text?.length,taskError:d.task?.error}));}
}finally{await db._close();}
