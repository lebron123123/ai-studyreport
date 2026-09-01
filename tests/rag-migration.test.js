import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildBulkUpsertSql,
  buildUpsertSql,
  createRecordHasher,
  selectRagTables,
  validateHeader,
  validateTrailer,
} from "../local-server/rag-migration-core.js";
import { createRagObjectStore, ragObjectStorageKey, resolveRagObjectPath } from "../local-server/rag-object-store.js";

test("RAG migration defaults to core knowledge only", () => {
  const tables = selectRagTables().map((item) => item.table);
  assert.ok(tables.includes("rag_text_chunks"));
  assert.ok(tables.includes("rag_vectors"));
  assert.ok(tables.includes("wiki_pages"));
  assert.ok(!tables.includes("personal_notes"));
  assert.ok(!tables.includes("web_evidence"));
  assert.ok(!tables.includes("rag_logs"));
});

test("optional scopes are explicit and deduplicated", () => {
  const tables = selectRagTables({ includePersonal: true, includeEvidence: true, includeHistory: true }).map((item) => item.table);
  assert.ok(tables.includes("personal_notes"));
  assert.ok(tables.includes("web_evidence"));
  assert.ok(tables.includes("rag_feedback"));
  assert.equal(new Set(tables).size, tables.length);
});

test("owned core knowledge declares user mapping columns", () => {
  const tables = new Map(selectRagTables().map((item) => [item.table, item]));
  assert.deepEqual(tables.get("wiki_pages").userColumns, ["created_by"]);
  assert.deepEqual(tables.get("source_assets").userColumns, ["created_by"]);
  assert.deepEqual(tables.get("rag_source_objects").userColumns, ["created_by"]);
  assert.ok(tables.has("rag_source_links"));
  assert.ok(tables.has("source_asset_objects"));
});

test("upsert SQL is idempotent and casts vector columns", () => {
  const sql = buildUpsertSql("rag_vectors", ["id", "embedding", "metadata"], ["id"], ["embedding"]);
  assert.match(sql, /ON CONFLICT \("id"\) DO UPDATE/);
  assert.match(sql, /\$2::vector/);
  assert.match(sql, /"metadata"=EXCLUDED\."metadata"/);
});

test("bulk upsert numbers parameters across rows", () => {
  const sql = buildBulkUpsertSql("rag_vectors", ["id", "embedding"], ["id"], ["embedding"], 2);
  assert.match(sql, /VALUES \(\$1,\$2::vector\),\(\$3,\$4::vector\)/);
  assert.throws(() => buildBulkUpsertSql("rag_vectors", ["id"], ["id"], [], 501), /1至500/);
});

test("bundle checksum detects modification", () => {
  const record = { type: "row", table: "rag_files_v2", row: { title: "A" } };
  const good = createRecordHasher();
  good.update(record);
  const digest = good.digest();
  validateHeader({ type: "header", format: "ai-studyreport-rag-bundle", version: 1, tables: [] });
  assert.equal(validateTrailer({ type: "trailer", counts: { rag_files_v2: 1 }, recordsSha256: digest }, { rag_files_v2: 1 }, digest), true);
  assert.throws(() => validateTrailer({ type: "trailer", counts: { rag_files_v2: 1 }, recordsSha256: "bad" }, { rag_files_v2: 1 }, digest), /哈希不一致/);
});

test("unsafe SQL identifiers are rejected", () => {
  assert.throws(() => buildUpsertSql("rag_vectors;DROP TABLE users", ["id"], ["id"]), /不安全/);
});

test("content-addressed source store deduplicates and verifies originals", async () => {
  const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),"rag-object-test-"));
  try{
    const store=createRagObjectStore(root),bytes=Buffer.from("原件迁移测试内容","utf8");
    const first=await store.put({bytes,fileName:"测试.docx",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
    const second=await store.put({bytes,fileName:"同内容改名.docx"});
    assert.equal(first.contentHash,second.contentHash);
    assert.equal(second.deduplicated,true);
    assert.equal(first.storageKey,ragObjectStorageKey(first.contentHash));
    assert.equal((await store.verify(first.storageKey,first.contentHash)).ok,true);
    assert.throws(()=>resolveRagObjectPath(root,"../escape.bin"),/越界/);
  }finally{await fs.promises.rm(root,{recursive:true,force:true});}
});
