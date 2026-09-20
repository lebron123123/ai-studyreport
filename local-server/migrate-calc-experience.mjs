// 财务经验库增量迁移：只新增0037中的表和索引，执行前要求可恢复备份。
import pg from 'pg';
import {readFile,realpath,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function hash(file){const digest=createHash('sha256');for await(const bytes of createReadStream(file))digest.update(bytes);return digest.digest('hex');}
async function main(){
  const backupRoot=await realpath(path.join(root,'.tmp','protected-backups'));
  const directory=await realpath(process.argv[2]||'');
  if(!directory.startsWith(backupRoot+path.sep))throw new Error('必须指定本仓库已校验的备份目录');
  const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
  const restored=JSON.parse(await readFile(path.join(directory,'restore-verification.json'),'utf8'));
  if(!restored.status?.startsWith('restored-readable')||!restored.rowCounts?.projects)throw new Error('备份尚未通过独立恢复校验');
  for(const entry of manifest.entries){
    const file=await realpath(path.resolve(directory,entry.path));
    if(!file.startsWith(directory+path.sep)||await hash(file)!==entry.sha256)throw new Error('备份路径或哈希不一致');
  }
  const source=new URL(process.env.DATABASE_URL||'');
  if(!['127.0.0.1','localhost','[::1]'].includes(source.hostname))throw new Error('本脚本仅允许迁移本机数据库');
  const migration=process.argv.includes('--workspaces')?'0038_calc_experience_workspaces.sql':'0037_calc_experience_library.sql';
  const sql=await readFile(path.join(root,'migrations',migration),'utf8');
  if(/\b(?:DROP|DELETE|TRUNCATE|ALTER|UPDATE|INSERT)\b/i.test(sql))throw new Error('迁移不是纯新增结构，已拒绝执行');
  const client=new pg.Client({connectionString:source.toString()});await client.connect();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await client.query("SET LOCAL lock_timeout='10s'");
    const before=await client.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name NOT LIKE 'calc_experience_%' ORDER BY table_name,ordinal_position");
    const projectCount=Number((await client.query('SELECT COUNT(*) AS count FROM projects')).rows[0].count);
    await client.query(sql);await client.query(sql);
    const after=await client.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name NOT LIKE 'calc_experience_%' ORDER BY table_name,ordinal_position");
    if(JSON.stringify(before.rows)!==JSON.stringify(after.rows))throw new Error('旧表结构发生变化，已撤销迁移');
    const tables=await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'calc_experience_%' ORDER BY table_name");
    if(tables.rowCount<(migration.startsWith('0038')?5:3))throw new Error('经验库表未完整建立');
    if(Number((await client.query('SELECT COUNT(*) AS count FROM projects')).rows[0].count)!==projectCount)throw new Error('原项目数量变化，已撤销迁移');
    await client.query('COMMIT');
    const result={at:new Date().toISOString(),migration,tables:tables.rows.map(x=>x.table_name),existingProjects:projectCount,legacySchemaUnchanged:true,existingDataRewritten:false,idempotenceVerified:true,backup:directory};
    await writeFile(path.join(directory,'calc-experience-migration-'+Date.now()+'.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
  }catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
}
main().catch(error=>{console.error('财务经验库迁移未完成：'+error.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]'));process.exitCode=1;});
