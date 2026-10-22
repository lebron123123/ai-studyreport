// Paginate read-only report copies; does not save either project.
import fs from 'node:fs/promises';
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const db=createD1Shim(process.env.DATABASE_URL);
try {
 const user=await db.prepare('SELECT id,username FROM users ORDER BY id LIMIT 1').first();
 const headers={authorization:'Bearer '+await signToken(process.env,user.id,user.username),'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
 const results=[];
 for(const name of ['tax','longgang']) {
  const body=await fs.readFile(`outputs/report-standardization/${name}-audit.docx`);
  const response=await fetch('http://localhost:8080/api/report-pagination',{method:'POST',headers,body,signal:AbortSignal.timeout(75000)});
  const result={name,status:response.status,...await response.json()};results.push(result);console.log(result);
 }
 await fs.writeFile('outputs/report-standardization/pages.json',JSON.stringify(results,null,2));
} finally {await db._close();}
