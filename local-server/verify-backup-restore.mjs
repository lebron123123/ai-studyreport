// Restores only into a NEW dedicated local database; never overwrites any database.
import pg from 'pg';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function hash(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
async function main(){
  const directory=await realpath(process.argv[2]||''),base=await realpath(path.join(root,'.tmp','protected-backups'));
  if(!directory.startsWith(base+path.sep))throw new Error('只允许本项目保护目录下的备份');
  const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
  for(const e of manifest.entries){const file=await realpath(path.resolve(directory,e.path));if(!file.startsWith(directory+path.sep)||await hash(file)!==e.sha256)throw new Error('备份哈希或路径校验失败');}
  const source=new URL(process.env.DATABASE_URL||'');
  if(!['localhost','127.0.0.1','[::1]'].includes(source.hostname))throw new Error('只允许本机恢复演练');
  const database='studyreport_restore_'+Date.now(),target=new URL(source);target.pathname='/'+database;
  const admin=new pg.Client({connectionString:source.toString()});await admin.connect();
  try{await admin.query('CREATE DATABASE "'+database+'"');}finally{await admin.end();}
  const r=spawnSync(path.join(process.env.PG_BIN||'','pg_restore'+(process.platform==='win32'?'.exe':'')),['--exit-on-error','--no-owner','--no-acl','--dbname='+database,path.join(directory,'database.dump')],{env:{...process.env,PGHOST:source.hostname,PGPORT:source.port||'5432',PGUSER:decodeURIComponent(source.username),PGPASSWORD:decodeURIComponent(source.password),PGCONNECT_TIMEOUT:'10'},encoding:'utf8',windowsHide:true,timeout:300000});
  if(r.error||r.status!==0)throw new Error('恢复失败；测试库保留供诊断：'+database+'；未修改原库');
  const client=new pg.Client({connectionString:target.toString()});await client.connect();
  let counts={};
  try{
    const tables=await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    for(const {tablename} of tables.rows){const quoted='"'+tablename.replaceAll('"','""')+'"';counts[tablename]=Number((await client.query('SELECT COUNT(*) AS n FROM '+quoted)).rows[0].n);}
    if(!counts.projects)throw new Error('恢复库无项目，不能通过');
  }finally{await client.end();}
  const result={verifiedAt:new Date().toISOString(),database,status:'restored-readable-not-business-approved',tableCount:Object.keys(counts).length,rowCounts:counts,objectFileHashesVerified:manifest.entries.length-1,sourceDatabaseModified:false,cleanup:'测试数据库保留；删除需确认精确名称'};
  await writeFile(path.join(directory,'restore-verification.json'),JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({database,status:result.status,tableCount:result.tableCount,projectCount:counts.projects,objectFiles:result.objectFileHashesVerified}));
}
main().catch(e=>{console.error(e.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]'));process.exitCode=1;});
