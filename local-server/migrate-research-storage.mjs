// Authorized additive migration. Backup and restore evidence are prerequisites.
import pg from 'pg';
import {readFile,realpath,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function main(){
 const dir=await realpath(process.argv[2]||''),base=await realpath(path.join(root,'.tmp','protected-backups'));
 if(!dir.startsWith(base+path.sep))throw Error('备份目录不在保护范围内');
 const manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));
 const restore=JSON.parse(await readFile(path.join(dir,'restore-verification.json'),'utf8'));
 if(!restore.status?.startsWith('restored-readable'))throw Error('尚未完成恢复演练');
 for(const e of manifest.entries){
  const file=await realpath(path.resolve(dir,e.path));if(!file.startsWith(dir+path.sep))throw Error('备份路径无效');
  const hash=createHash('sha256');for await(const data of createReadStream(file))hash.update(data);
  if(hash.digest('hex')!==e.sha256)throw Error('备份校验失败');
 }
 const url=new URL(process.env.DATABASE_URL);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('本次授权仅限本机数据库');
 const sql=await readFile(path.join(root,'migrations/0036_research_state_objects.sql'),'utf8');
 const client=new pg.Client({connectionString:url.toString()});await client.connect();
 try{
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='10s'");
  const before=(await client.query('SELECT count(*) AS count FROM research_runs')).rows[0].count;
  await client.query(sql);await client.query(sql);
  const after=(await client.query('SELECT count(*) AS count FROM research_runs')).rows[0].count;
  if(before!==after)throw Error('轮次数量变化，未提交迁移');
  await client.query('COMMIT');
  const result={status:'additive-schema-ready',migration:'0036',existingRuns:Number(after),originalDataRewritten:false};
  await writeFile(path.join(dir,'storage-migration.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(e){await client.query('ROLLBACK');throw e;}finally{await client.end();}
}
main().catch(()=>{console.error('存储迁移未完成，请检查备份、恢复记录或数据库；未输出连接密钥');process.exitCode=1;});
