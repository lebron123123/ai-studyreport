#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ragObjectStorageKey, resolveRagObjectPath } from "./rag-object-store.js";
import {
  RAG_MIGRATION_FORMAT,
  RAG_MIGRATION_VERSION,
  buildBulkUpsertSql,
  canonicalRecordLine,
  createRecordHasher,
  normalizeDbValue,
  quoteIdentifier,
  restoreDbValue,
  selectRagTables,
  validateHeader,
  validateTrailer,
} from "./rag-migration-core.js";

const SCRIPT_DIR=path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const command = args.shift() || "help";
const flag = (name) => args.includes("--" + name);
const option = (name, fallback = "") => {
  const prefix = "--" + name + "=";
  const item = args.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
};

function usage(exitCode = 0) {
  console.log(`RAG 批量迁移工具

导出（本机）：
  node --env-file=.env rag-migrate.js export --out=../backups/rag-knowledge.rag.gz

验证迁移包：
  node rag-migrate.js verify --file=../backups/rag-knowledge.rag.gz

导入预检（机房服务器）：
  TARGET_DATABASE_URL=postgres://... node rag-migrate.js import --file=../backups/rag-knowledge.rag.gz --dry-run

正式合并导入（不会清空服务器已有数据）：
  TARGET_DATABASE_URL=postgres://... node rag-migrate.js import --file=../backups/rag-knowledge.rag.gz

可选导出范围：--include-personal --include-evidence --include-history
危险覆盖模式：--mode=replace --confirm-replace（默认 merge）`);
  process.exitCode = exitCode;
}

function connectionString(target = false) {
  const value = target ? (process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL) : process.env.DATABASE_URL;
  if (!value) throw new Error(target ? "缺少 TARGET_DATABASE_URL（或 DATABASE_URL）" : "缺少 DATABASE_URL");
  return value;
}

function openPool(target = false) {
  return new pg.Pool({ connectionString: connectionString(target), max: 2, idleTimeoutMillis: 10000 });
}

function ragObjectRoot() {
  return path.resolve(process.env.RAG_OBJECT_ROOT || path.join(SCRIPT_DIR, "..", "local-data", "rag-objects"));
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function tableInfo(client, table) {
  const exists = await client.query("SELECT to_regclass($1) AS name", ["public." + table]);
  if (!exists.rows[0]?.name) return null;
  const columns = await client.query(
    `SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type
       FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
    [table],
  );
  const pk = await client.query(
    `SELECT a.attname AS name FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum,ord) ON true
       JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
      WHERE n.nspname='public' AND c.relname=$1 AND i.indisprimary ORDER BY k.ord`,
    [table],
  );
  return { columns: columns.rows, primaryKey: pk.rows.map((row) => row.name) };
}

async function writeLine(stream, line) {
  if (!stream.write(line)) await new Promise((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function exportBundle() {
  const output = path.resolve(option("out", path.join("backups", `rag-${new Date().toISOString().slice(0,10)}.rag.gz`)));
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  const pool = openPool(false);
  const client = await pool.connect();
  const requested = selectRagTables({
    includePersonal: flag("include-personal"),
    includeEvidence: flag("include-evidence"),
    includeHistory: flag("include-history"),
  });
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables = [];
    for (const spec of requested) {
      const info = await tableInfo(client, spec.table);
      if (!info) {
        if (spec.required) throw new Error("源数据库缺少必要表：" + spec.table);
        continue;
      }
      if (!info.primaryKey.length) {
        if (spec.required) throw new Error("必要表缺少主键：" + spec.table);
        console.warn("跳过无主键表：" + spec.table);
        continue;
      }
      const where = spec.where ? " WHERE " + spec.where : "";
      const count = Number((await client.query(`SELECT COUNT(*)::bigint AS n FROM ${quoteIdentifier(spec.table)}${where}`)).rows[0].n);
      tables.push({
        table: spec.table,
        count,
        columns: info.columns.map((column) => column.name),
        columnTypes: Object.fromEntries(info.columns.map((column) => [column.name, column.type])),
        primaryKey: info.primaryKey,
        vectorColumns: spec.vectorColumns || [],
        userColumns: spec.userColumns || [],
        where: spec.where || "",
      });
    }
    const userIds = new Set();
    for (const table of tables) {
      for (const column of table.userColumns || []) {
        if (!table.columns.includes(column)) continue;
        const whereParts = [`${quoteIdentifier(column)} IS NOT NULL`];
        if (table.where) whereParts.push(`(${table.where})`);
        const rows = await client.query(`SELECT DISTINCT ${quoteIdentifier(column)} AS id FROM ${quoteIdentifier(table.table)} WHERE ${whereParts.join(" AND ")}`);
        for (const row of rows.rows) userIds.add(String(row.id));
      }
    }
    let users = [];
    if (userIds.size) {
      const result = await client.query("SELECT id,username FROM users WHERE id::text = ANY($1::text[]) ORDER BY id", [[...userIds]]);
      users = result.rows.map((row) => ({ sourceId: String(row.id), username: String(row.username || "") }));
      const found = new Set(users.map((user) => user.sourceId));
      const missing = [...userIds].filter((id) => !found.has(id));
      if (missing.length) throw new Error("源数据库存在无法识别的用户引用：" + missing.join(","));
    }
    const objects=[];
    if(tables.some((table)=>table.table==="rag_source_objects")){
      const rows=await client.query("SELECT content_hash,storage_key,size_bytes FROM rag_source_objects ORDER BY content_hash");
      for(const row of rows.rows){
        const contentHash=String(row.content_hash||"").toLowerCase(),storageKey=String(row.storage_key||ragObjectStorageKey(contentHash));
        const file=resolveRagObjectPath(ragObjectRoot(),storageKey),stat=await fs.promises.stat(file);
        const actual=await sha256File(file);
        if(actual!==contentHash)throw new Error(`原件 ${storageKey} 的文件哈希与数据库不一致`);
        if(Number(row.size_bytes)!==stat.size)throw new Error(`原件 ${storageKey} 的文件大小与数据库不一致`);
        objects.push({contentHash,storageKey,sizeBytes:stat.size,chunks:Math.ceil(stat.size/(1024*1024))});
      }
    }
    const header = {
      type: "header",
      format: RAG_MIGRATION_FORMAT,
      version: RAG_MIGRATION_VERSION,
      createdAt: new Date().toISOString(),
      source: "postgresql",
      options: { includePersonal: flag("include-personal"), includeEvidence: flag("include-evidence"), includeHistory: flag("include-history") },
      tables,
      users,
      objects,
    };
    const gzip = zlib.createGzip({ level: 9 });
    const file = fs.createWriteStream(output, { flags: "wx" });
    gzip.pipe(file);
    await writeLine(gzip, JSON.stringify(header) + "\n");
    const hasher = createRecordHasher();
    const counts = {};
    const pageSize = Math.max(50, Math.min(1000, Number(option("page-size", 250)) || 250));
    for (const table of tables) {
      counts[table.table] = 0;
      const selectColumns = table.columns.map((column) => table.vectorColumns.includes(column)
        ? `${quoteIdentifier(column)}::text AS ${quoteIdentifier(column)}`
        : quoteIdentifier(column)).join(",");
      const where = table.where ? " WHERE " + table.where : "";
      const order = table.primaryKey.map(quoteIdentifier).join(",");
      for (let offset = 0; offset < table.count; offset += pageSize) {
        const result = await client.query(`SELECT ${selectColumns} FROM ${quoteIdentifier(table.table)}${where} ORDER BY ${order} LIMIT $1 OFFSET $2`, [pageSize, offset]);
        for (const sourceRow of result.rows) {
          const row = Object.fromEntries(table.columns.map((column) => [column, normalizeDbValue(sourceRow[column])]));
          const record = { type: "row", table: table.table, row };
          hasher.update(record);
          counts[table.table]++;
          await writeLine(gzip, canonicalRecordLine(record));
        }
      }
      console.log(`已导出 ${table.table}: ${counts[table.table]} 行`);
    }
    counts["@objects"]=0;
    for(const object of objects){
      const file=resolveRagObjectPath(ragObjectRoot(),object.storageKey);let offset=0;
      for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024})){
        const record={type:"object",contentHash:object.contentHash,offset,dataBase64:chunk.toString("base64")};
        hasher.update(record);counts["@objects"]++;offset+=chunk.length;await writeLine(gzip,canonicalRecordLine(record));
      }
      console.log(`已封装原件 ${object.contentHash.slice(0,12)}…: ${object.sizeBytes} 字节`);
    }
    await writeLine(gzip, JSON.stringify({ type: "trailer", counts, recordsSha256: hasher.digest() }) + "\n");
    gzip.end();
    await new Promise((resolve, reject) => { file.on("close", resolve); file.on("error", reject); gzip.on("error", reject); });
    await client.query("COMMIT");
    const packageHash = await sha256File(output);
    await fs.promises.writeFile(output + ".sha256", packageHash + "  " + path.basename(output) + "\n", { flag: "wx" });
    console.log(`迁移包：${output}`);
    console.log(`SHA-256：${packageHash}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function scanBundle(file, onRecord = null) {
  const input = fs.createReadStream(file);
  const lines = readline.createInterface({ input: input.pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let header = null, trailer = null;
  const counts = {};
  const objectStates=new Map();
  const hasher = createRecordHasher();
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber++;
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { throw new Error(`迁移包第 ${lineNumber} 行 JSON 损坏`); }
    if (!header) { header = validateHeader(record); continue; }
    if (record.type === "trailer") { trailer = record; continue; }
    if(record.type==="object"){
      if(!/^[a-f0-9]{64}$/.test(String(record.contentHash||""))||!Number.isInteger(record.offset)||typeof record.dataBase64!=="string")throw new Error(`迁移包第 ${lineNumber} 行原件记录无效`);
      const spec=(header.objects||[]).find(item=>item.contentHash===record.contentHash);if(!spec)throw new Error(`迁移包包含未登记原件 ${record.contentHash}`);
      let state=objectStates.get(record.contentHash);if(!state){state={hash:crypto.createHash("sha256"),size:0,chunks:0};objectStates.set(record.contentHash,state);}
      if(record.offset!==state.size)throw new Error(`原件 ${record.contentHash} 分片偏移不连续`);
      const bytes=Buffer.from(record.dataBase64,"base64");state.hash.update(bytes);state.size+=bytes.length;state.chunks++;
    }else if (record.type !== "row" || !record.table || !record.row) throw new Error(`迁移包第 ${lineNumber} 行记录无效`);
    if (trailer) throw new Error("迁移包结尾校验信息之后仍有数据");
    hasher.update(record);
    const countKey=record.type==="object"?"@objects":record.table;
    counts[countKey] = (counts[countKey] || 0) + 1;
    if (onRecord) await onRecord(record, header);
  }
  const digest = hasher.digest();
  validateTrailer(trailer, counts, digest);
  for (const table of header.tables) {
    if (Number(counts[table.table] || 0) !== Number(table.count || 0)) throw new Error(`${table.table} 与头部清单行数不一致`);
  }
  for(const object of header.objects||[]){
    const state=objectStates.get(object.contentHash),actual=state&&state.hash.digest("hex");
    if(!state||actual!==object.contentHash||state.size!==Number(object.sizeBytes)||state.chunks!==Number(object.chunks))throw new Error(`原件 ${object.contentHash} 内容、大小或分片校验失败`);
  }
  return { header, trailer, counts, digest };
}

async function verifyBundle() {
  const file = path.resolve(option("file"));
  if (!option("file")) throw new Error("请提供 --file=迁移包路径");
  const result = await scanBundle(file);
  console.log("迁移包完整，校验通过：" + file);
  for (const table of result.header.tables) console.log(`${table.table}: ${result.counts[table.table] || 0} 行`);
  console.log(`原件对象: ${(result.header.objects||[]).length} 个，${result.counts["@objects"]||0} 个分片`);
  console.log("记录 SHA-256：" + result.digest);
}

async function preflightTarget(client, header) {
  const plans = new Map();
  const userIdMap = new Map();
  for (const sourceUser of header.users || []) {
    const result = await client.query("SELECT id FROM users WHERE username=$1", [sourceUser.username]);
    if (!result.rows[0]) throw new Error(`目标数据库缺少用户 ${sourceUser.username}；请先创建同名用户再迁移其资料`);
    userIdMap.set(String(sourceUser.sourceId), result.rows[0].id);
  }
  for (const source of header.tables) {
    const target = await tableInfo(client, source.table);
    if (!target) throw new Error("目标数据库缺少表：" + source.table + "；请先执行最新 schema-postgres.sql");
    const targetNames = new Set(target.columns.map((column) => column.name));
    const missing = source.columns.filter((column) => !targetNames.has(column));
    if (missing.length) throw new Error(`${source.table} 缺少字段：${missing.join(", ")}；请先升级目标数据库结构`);
    if (source.vectorColumns?.length) {
      for (const column of source.vectorColumns) {
        const sourceType = source.columnTypes?.[column] || "";
        const targetType = target.columns.find((item) => item.name === column)?.type || "";
        if (sourceType !== targetType) throw new Error(`${source.table}.${column} 类型不一致：源 ${sourceType}，目标 ${targetType}`);
      }
    }
    const primaryKey = source.primaryKey?.length ? source.primaryKey : target.primaryKey;
    if (primaryKey.join("|") !== target.primaryKey.join("|")) throw new Error(`${source.table} 主键结构与目标数据库不一致`);
    plans.set(source.table, { ...source, primaryKey, userIdMap });
  }
  return plans;
}

async function importBundle() {
  const fileValue = option("file");
  if (!fileValue) throw new Error("请提供 --file=迁移包路径");
  const file = path.resolve(fileValue);
  const verified = await scanBundle(file);
  const mode = option("mode", "merge");
  if (!['merge', 'replace'].includes(mode)) throw new Error("--mode 只允许 merge 或 replace");
  if (mode === "replace" && !flag("confirm-replace")) throw new Error("replace 会清空目标知识表；确认后必须同时传入 --confirm-replace");
  const pool = openPool(true);
  const client = await pool.connect();
  const createdObjects=[];let activeObject=null;
  try {
    const plans = await preflightTarget(client, verified.header);
    console.log(`目标预检通过：${plans.size} 张表，${Object.values(verified.counts).reduce((a,b)=>a+b,0)} 行，模式 ${mode}`);
    if (flag("dry-run")) { console.log("dry-run 完成：未写入任何数据"); return; }
    await client.query("BEGIN");
    if (mode === "replace") {
      for (const table of [...verified.header.tables].reverse()) await client.query(`DELETE FROM ${quoteIdentifier(table.table)}`);
    }
    const imported = {};
    const batchSize = Math.max(1, Math.min(500, Number(option("batch-size", 100)) || 100));
    let activeTable = "", batch = [];
    const targetObjectRoot=ragObjectRoot();await fs.promises.mkdir(targetObjectRoot,{recursive:true});
    const objectSpecs=new Map((verified.header.objects||[]).map(item=>[item.contentHash,item]));
    const finishObject=async()=>{
      if(!activeObject)return;
      await activeObject.handle.close();
      const digest=activeObject.hash.digest("hex");
      if(digest!==activeObject.spec.contentHash||activeObject.size!==Number(activeObject.spec.sizeBytes)){await fs.promises.rm(activeObject.temp,{force:true});throw new Error(`原件 ${activeObject.spec.contentHash} 恢复后哈希不一致`);}
      const target=resolveRagObjectPath(targetObjectRoot,activeObject.spec.storageKey||ragObjectStorageKey(activeObject.spec.contentHash));
      await fs.promises.mkdir(path.dirname(target),{recursive:true});
      try{const existing=await sha256File(target);if(existing!==digest)throw new Error("目标对象已存在但内容哈希错误");await fs.promises.rm(activeObject.temp,{force:true});}
      catch(error){if(error.code!=="ENOENT")throw error;await fs.promises.rename(activeObject.temp,target);createdObjects.push(target);}
      activeObject=null;
    };
    const flush = async () => {
      if (!batch.length) return;
      const plan = plans.get(activeTable);
      const sql = buildBulkUpsertSql(plan.table, plan.columns, plan.primaryKey, plan.vectorColumns, batch.length);
      await client.query(sql, batch.flat());
      imported[activeTable] = (imported[activeTable] || 0) + batch.length;
      batch = [];
    };
    await scanBundle(file, async (record) => {
      if(record.type==="object"){
        await flush();
        if(!activeObject||activeObject.spec.contentHash!==record.contentHash){await finishObject();const spec=objectSpecs.get(record.contentHash);if(!spec)throw new Error("未登记的原件对象");const temp=path.join(targetObjectRoot,".import-"+record.contentHash+"-"+process.pid);await fs.promises.rm(temp,{force:true});activeObject={spec,temp,handle:await fs.promises.open(temp,"wx"),hash:crypto.createHash("sha256"),size:0};}
        const bytes=Buffer.from(record.dataBase64,"base64");if(record.offset!==activeObject.size)throw new Error("原件写入偏移不连续");await activeObject.handle.write(bytes);activeObject.hash.update(bytes);activeObject.size+=bytes.length;return;
      }
      const plan = plans.get(record.table);
      if (!plan) throw new Error("未通过预检的表出现在数据中：" + record.table);
      const values = plan.columns.map((column) => {
        const value = restoreDbValue(record.row[column]);
        if (!plan.userColumns?.includes(column) || value === null || value === "") return value;
        const mapped = plan.userIdMap.get(String(value));
        if (mapped === undefined) throw new Error(`${record.table}.${column} 的用户 ${value} 未通过目标映射`);
        return mapped;
      });
      if (activeTable && activeTable !== record.table) await flush();
      activeTable = record.table;
      batch.push(values);
      if (batch.length >= batchSize) await flush();
    });
    await flush();
    await finishObject();
    await client.query("COMMIT");
    console.log("导入完成：");
    for (const table of verified.header.tables) console.log(`${table.table}: ${imported[table.table] || 0} 行`);
    console.log(`原件对象: ${(verified.header.objects||[]).length} 个已校验恢复`);
  } catch (error) {
    if(activeObject){try{await activeObject.handle.close();}catch{}try{await fs.promises.rm(activeObject.temp,{force:true});}catch{}}
    for(const file of createdObjects.reverse()){try{await fs.promises.rm(file,{force:true});}catch{}}
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

try {
  if (command === "export") await exportBundle();
  else if (command === "verify") await verifyBundle();
  else if (command === "import") await importBundle();
  else usage(command === "help" ? 0 : 1);
} catch (error) {
  console.error("迁移失败：" + error.message);
  process.exitCode = 1;
}
