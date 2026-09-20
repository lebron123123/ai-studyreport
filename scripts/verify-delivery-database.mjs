// Select only an existing isolated restore database; never test against the source DB.
import pg from '../local-server/node_modules/pg/lib/index.js';
import {spawnSync} from 'node:child_process';
const source=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1','[::1]'].includes(source.hostname))throw new Error('仅允许本机隔离库验证');
const client=new pg.Client({connectionString:source.toString()});await client.connect();
let name;
try{name=(await client.query("SELECT datname FROM pg_database WHERE datname ~ '^studyreport_restore_[0-9]+$' ORDER BY datname DESC LIMIT 1")).rows[0]?.datname;}finally{await client.end();}
if(!name)throw new Error('请先执行备份恢复演练以创建隔离库');
source.pathname='/'+name;console.log('隔离验证库：'+name);
const env={...process.env,AGENT_TEST_DATABASE_URL:source.toString(),TEST_DATABASE_URL:source.toString()};
for(const args of [['local-server/check-migrations.js','--require-db'],['--test','tests/agent-budget.test.mjs','tests/report-execution-postgres.test.mjs','tests/delivery-postgres.test.mjs','tests/operations-monitor.test.mjs','tests/report-route-access.test.mjs']]){
  const r=spawnSync(process.execPath,args,{env,encoding:'utf8',windowsHide:true,timeout:180000});console.log((r.stdout||'').slice(-14000));if(r.status!==0){console.error((r.stderr||'').slice(-3000));process.exitCode=1;break;}
}
