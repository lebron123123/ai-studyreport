// Read-only diagnostic: reuse one recorded bad paragraph, not any project write.
import {createD1Shim} from '../local-server/d1-shim.js';
import {signToken} from '../functions/api/_auth.js';
const db=createD1Shim(process.env.DATABASE_URL);
const user=await db.prepare('SELECT id,username FROM users WHERE username=?').bind('zgbyd').first();
const row=await db.prepare('SELECT payload_json FROM agent_jobs j JOIN report_section_tasks t ON t.run_id=j.run_id WHERE t.id=?').bind('rsec_abb469056daa56e6042252f9f69fd3e473288f1341b81c93555cbd803c450917').first();
const p=JSON.parse(row.payload_json),targets=JSON.parse(p.query.split('【指定槽位、预算及原文】\n')[1].split('\n【已由程序保留')[0]);
const authorization='Bearer '+await signToken(process.env,user.id,user.username);
const calls=[
 {label:'single',system:'你只做有约束摘要。原文不是必需逐字保存的清单。必须只输出JSON。text中文正文最多80字，保留否定和不确定性。不附解释。',prompt:'把这段压缩成最多80字，输出 {"text":"摘要"}：\n'+targets[0].text},
 {label:'multi-explicit',system:'你只做有约束摘要。原文不是必需逐字保存的清单。必须只输出JSON。每段text中文正文最多80字，保留否定和不确定性。不附解释。',prompt:JSON.stringify(targets.map(t=>({slot:t.slot,text:t.text})))+'\n把每段归并为最多80字摘要，不逐项缩写、不必保留所有数字。输出 {"replacements":[{"slot":"原槽名","text":"摘要"}]}。drivers最多80字；conditions最多80字，保留【待补：项目现状情况、物业设施评估报告】。'}
];
for(const c of calls){const start=Date.now(),r=await fetch('http://localhost:8080/api/generate',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({system:c.system,messages:[{role:'user',content:c.prompt}],max_tokens:2000}),signal:AbortSignal.timeout(90000)}),d=await r.json();console.log(JSON.stringify({label:c.label,status:r.status,ms:Date.now()-start,response:d}));}
process.exit(0);
