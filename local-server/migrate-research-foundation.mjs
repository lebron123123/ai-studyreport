// Explicitly approved additive rollout only; never enables the feature or changes legacy rows.
import pg from 'pg';
import {readFile,realpath,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const names=['0034_research_identity.sql','0035_research_reauthentication.sql'];
async function hash(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
async function main(){
 const base=await realpath(path.join(root,'.tmp','protected-backups'));
 const directory=await realpath(process.argv[2]||'');
 if(!directory.startsWith(base+path.sep))throw new Error('必须指定本仓库已校验的备份目录');
 const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
 const restored=JSON.parse(await readFile(path.join(directory,'restore-verification.json'),'utf8'));
 if(restored.status!=='restored-readable-not-business-approved'||!restored.rowCounts?.projects)throw new Error('备份尚未通过恢复校验');
 for(const e of manifest.entries){
  const file=await realpath(path.resolve(directory,e.path));
  if(!file.startsWith(directory+path.sep)||await hash(file)!==e.sha256)throw new Error('备份路径或哈希不一致');
 }
 const source=new URL(process.env.DATABASE_URL||'');
 if(!['127.0.0.1','localhost','[::1]'].includes(source.hostname))throw new Error('仅允许迁移本地数据库');
 const scripts=await Promise.all(names.map(async name=>({name,sql:await readFile(path.join(root,'migrations',name),'utf8')})));
 for(const {sql} of scripts)if(/\b(?:DROP|DELETE|TRUNCATE|ALTER|UPDATE|INSERT)\b/i.test(sql))throw new Error('本次仅批准新增表和索引');
 const db=new pg.Client({connectionString:source.toString()});await db.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await db.query("SET LOCAL lock_timeout='10s'");
  const before=(await db.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
  const legacy=before.filter(x=>!x.table_name.startsWith('research_'));
  for(const {sql} of scripts)await db.query(sql);
  const after=(await db.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
  if(JSON.stringify(legacy)!==JSON.stringify(after.filter(x=>!x.table_name.startsWith('research_'))))throw new Error('旧表结构发生变化，撤销迁移');
  // Repeat within the same transaction to verify additive idempotence.
  for(const {sql} of scripts)await db.query(sql);
  await db.query('COMMIT');
  const result={at:new Date().toISOString(),migrations:names,legacySchemaUnchanged:true,idempotenceVerified:true,featureEnabled:false,backup:directory};
  await writeFile(path.join(directory,'research-migration-'+Date.now()+'.json'),JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify(result));
 }catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
}
main().catch(()=>{console.error('研究增量迁移未确认成功，请检查数据库和备份；功能未启用，连接凭据未输出。');process.exitCode=1;});
