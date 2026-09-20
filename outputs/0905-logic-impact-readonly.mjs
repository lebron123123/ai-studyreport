// 只读指定项目；仅输出计数及逻辑差异类别，不输出正文、个人信息或凭据。
import pg from '../local-server/node_modules/pg/lib/index.js';
import policy from '../report-writing-policy.js';
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
 const row=(await db.query('SELECT data FROM projects WHERE id=$1',['1bb24013-18ce-4819-9588-09fe98e5e0c0'])).rows[0];
 const value=typeof row?.data==='string'?JSON.parse(row.data):row?.data;
 const published=(await db.query("SELECT data FROM report_logic_sets WHERE project_type='gaibao' AND status='published' ORDER BY version DESC LIMIT 1")).rows[0];
 const rules=policy.normalize(typeof published.data==='string'?JSON.parse(published.data):published.data),whole=rules.globalRequirements.housing_conversion;
 const sections=(value?.chapters||[]).flatMap(c=>c.sections||[]);
 console.log(JSON.stringify({storedSections:sections.length,logicStale:sections.filter(s=>s.staleKind==='logic'&&s.syncStatus?.includes('stale')).length,pending:sections.filter(s=>s.pendingRevision).length,missingSnapshot:sections.filter(s=>!s.logicSnapshot).length,globalDiff:sections.filter(s=>policy.snapshot(s.logicSnapshot||{}).globalRequirements!==whole).length,structureMigrated:sections.filter(s=>s.structureMigrated).length,localOverride:sections.filter(s=>s.logicSnapshot?.localOverride).length,writes:0}));
}finally{await db.end();}
