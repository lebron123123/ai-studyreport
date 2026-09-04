import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const migrationDir=path.join(root,"migrations");
const files=fs.readdirSync(migrationDir).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort();
const requireDb=process.argv.includes("--require-db");
const databaseUrl=process.env.TEST_DATABASE_URL||"";
if(!files.length)throw new Error("未发现迁移文件");
const bad=[];
for(const file of files){
  const sql=fs.readFileSync(path.join(migrationDir,file),"utf8");
  if(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i.test(sql))bad.push(`${file}: CREATE TABLE 缺少 IF NOT EXISTS`);
  if(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i.test(sql))bad.push(`${file}: CREATE INDEX 缺少 IF NOT EXISTS`);
  if(/\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE)\b/i.test(sql))bad.push(`${file}: 含破坏性DDL`);
}
if(bad.length)throw new Error("迁移静态门禁失败：\n- "+bad.join("\n- "));
if(!databaseUrl){
  if(requireDb)throw new Error("要求真实迁移验证，但未设置 TEST_DATABASE_URL");
  console.log(JSON.stringify({ok:true,mode:"static",files:files.length,latest:files.at(-1),database:"skipped"}));
  process.exit(0);
}

const client=new pg.Client({connectionString:databaseUrl});
const prefix="migration_gate_"+crypto.randomBytes(6).toString("hex");
const schemas=[prefix+"_empty",prefix+"_upgrade"];
const quote=name=>'"'+name.replaceAll('"','""')+'"';
async function apply(schema,subset){
  await client.query(`SET search_path TO ${quote(schema)}, public`);
  for(const file of subset)await client.query(fs.readFileSync(path.join(migrationDir,file),"utf8"));
}
async function fingerprint(schema){
  const {rows}=await client.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,ordinal_position",[schema]);
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
try{
  await client.connect();
  for(const schema of schemas)await client.query(`CREATE SCHEMA ${quote(schema)}`);
  await apply(schemas[0],files);
  const emptyHash=await fingerprint(schemas[0]);
  await apply(schemas[0],files);
  const repeatHash=await fingerprint(schemas[0]);
  const split=Math.max(1,Math.floor(files.length/2));
  await apply(schemas[1],files.slice(0,split));
  await apply(schemas[1],files);
  const upgradeHash=await fingerprint(schemas[1]);
  if(emptyHash!==repeatHash||emptyHash!==upgradeHash)throw new Error("空库、重复执行、旧库升级后的结构指纹不一致");
  console.log(JSON.stringify({ok:true,mode:"postgres",files:files.length,latest:files.at(-1),checks:["empty","idempotent","upgrade"],schemaSha256:emptyHash},null,2));
}finally{
  if(client._connected){
    for(const schema of schemas)await client.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
    await client.end();
  }
}
