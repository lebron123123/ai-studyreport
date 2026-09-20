import {createD1Shim} from '../local-server/d1-shim.js';
const db=createD1Shim(process.env.DATABASE_URL);
try{
 for(const q of ["SELECT kind,status,error_text,updated_at FROM agent_jobs WHERE error_text<>'' ORDER BY updated_at DESC LIMIT 4","SELECT status,COUNT(*) AS n FROM agent_jobs WHERE updated_at>1789010800000 GROUP BY status"]){console.log(JSON.stringify((await db.prepare(q).all()).results));}
}finally{await db._close();}
