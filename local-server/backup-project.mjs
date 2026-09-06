// Local, non-destructive backup. Never puts connection credentials in argv or the manifest.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, readdir, lstat, copyFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function hash(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('备份不跟随符号链接');if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}return out.sort();}
function runPg(name,args,connection){
  const u=new URL(connection),binary=path.join(process.env.PG_BIN||'',name+(process.platform==='win32'?'.exe':''));
  const r=spawnSync(binary,args,{env:{...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGCONNECT_TIMEOUT:'10'},encoding:'utf8',windowsHide:true,timeout:300000});
  if(r.error||r.status!==0)throw new Error(name+'失败；请检查PG_BIN、数据库连接与磁盘空间（未输出连接密钥）');
  return r.stdout;
}
async function main(){
  if(!process.env.DATABASE_URL)throw new Error('缺少 DATABASE_URL');
  const destination=path.join(root,'.tmp','protected-backups',new Date().toISOString().replace(/[:.]/g,'-'));
  await mkdir(destination,{recursive:true});
  const dump=path.join(destination,'database.dump');
  runPg('pg_dump',['--format=custom','--no-owner','--no-acl','--file='+dump],process.env.DATABASE_URL);
  const listing=runPg('pg_restore',['--list',dump],process.env.DATABASE_URL);
  if(!listing.includes('TABLE DATA'))throw new Error('备份缺少表数据');
  const entries=[{path:'database.dump',sha256:await hash(dump),bytes:(await lstat(dump)).size}];
  const sources=[path.join(root,'local-data')];
  if(process.env.RAG_OBJECT_ROOT&&!sources.includes(path.resolve(process.env.RAG_OBJECT_ROOT)))sources.push(path.resolve(process.env.RAG_OBJECT_ROOT));
  for(let i=0;i<sources.length;i++){
    const source=sources[i];let before;
    try{before=await files(source);}catch(e){if(e.code==='ENOENT')continue;throw e;}
    for(const file of before){
      const rel=path.join('files-'+i,path.relative(source,file)),target=path.join(destination,rel),initial=await hash(file);
      await mkdir(path.dirname(target),{recursive:true});await copyFile(file,target);
      if(initial!==await hash(target)||initial!==await hash(file))throw new Error('备份期间文件变化，禁止使用本次副本迁移');
      entries.push({path:rel,sha256:initial,bytes:(await lstat(target)).size});
    }
    if(JSON.stringify(before)!==JSON.stringify(await files(source)))throw new Error('备份期间文件清单变化，请静止写入后重试');
  }
  const manifest={createdAt:new Date().toISOString(),status:'archive-verified-not-restore-tested',consistency:'database snapshot; files copied afterwards; quiescent restore verification required',containsPrivateBusinessData:true,secretsConfigurationIncluded:false,entries};
  await writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
  console.log(JSON.stringify({destination,status:manifest.status,files:entries.length,bytes:entries.reduce((s,e)=>s+e.bytes,0)}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
