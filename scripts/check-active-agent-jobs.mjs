import {createD1Shim} from '../local-server/d1-shim.js';
const db=createD1Shim(process.env.DATABASE_URL);
try{const rows=(await db.prepare("SELECT status,COUNT(*) AS count FROM agent_jobs WHERE status IN ('queued','running','retry') GROUP BY status").all()).results;console.log(JSON.stringify(rows));if(rows.some(r=>Number(r.count)>0))process.exitCode=2;}finally{await db._close();}
