// Create a fresh local database for the entire suite. Never test against a user's database.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import pg from '../local-server/node_modules/pg/lib/index.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
if(!source)throw new Error('数据库门禁必须配置 TEST_DATABASE_URL（或本机 DATABASE_URL），禁止跳过');
const url=new URL(source);
if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('仅允许本机 PostgreSQL 隔离验证');
url.pathname='/postgres';
const admin=new pg.Client({connectionString:url.toString()});
const name='studyreport_restore_'+Date.now()+String(process.pid).padStart(6,'0');
if(!/^studyreport_restore_\d+$/.test(name))throw new Error('隔离库名称校验失败');
let created=false,connection;
try{
  await admin.connect();
  await admin.query('CREATE DATABASE "'+name+'"');created=true;
  url.pathname='/'+name;
  connection=new pg.Client({connectionString:url.toString()});await connection.connect();
  await connection.query(fs.readFileSync(path.join(root,'local-server/schema-postgres.sql'),'utf8'));
  for(const file of fs.readdirSync(path.join(root,'migrations')).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort())await connection.query(fs.readFileSync(path.join(root,'migrations',file),'utf8'));
  await connection.query('INSERT INTO users(username,pass_hash,salt,created_at) VALUES($1,$2,$3,$4)',['[系统测试]数据库门禁','disabled-no-login','disabled',Date.now()]);
  await connection.end();connection=null;
  console.log('已创建全新隔离测试库：'+name+'（无用户数据）');
  const env={...process.env,AGENT_TEST_DATABASE_URL:url.toString(),TEST_DATABASE_URL:url.toString(),REQUIRE_DATABASE_TESTS:'1'};
  const args=process.argv.slice(2);
  for(const command of [['local-server/check-migrations.js','--require-db'],['--test',...args]]){
    const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,command,{cwd:root,env,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',(code)=>resolve(code??1));});
    if(code){process.exitCode=code;break;}
  }
}finally{
  if(connection)await connection.end();
  // Only the exact database successfully created by this process is eligible for cleanup.
  if(created){await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');console.log('已移除本轮临时隔离测试库：'+name);}
  await admin.end();
}
