/* ============================================================
   d1-shim.js —— 让 PostgreSQL "长得像" Cloudflare D1

   业务代码里有 78 处 env.DB.prepare(...).bind(...).first()/all()/run()。
   本文件做出一个外表完全一致的对象，那 78 处就一行都不用改。

   需要翻译的三件事：
     1. 占位符：SQLite 用 ?，PostgreSQL 用 $1 $2 $3
     2. 返回结构：D1 的 .all() 返回 {results:[...]}，pg 返回 {rows:[...]}
     3. last_row_id：注册新用户时要拿自增ID，PostgreSQL 用 RETURNING 实现
   ============================================================ */

import pg from "pg";

/* 时间戳是 Date.now() 毫秒数（约1.78万亿），超出 JS 安全整数没问题，
   但 pg 默认把 BIGINT 当字符串返回，会导致业务代码里的数字比较出错。
   这里让 BIGINT(OID 20) 直接转成 Number——本系统的时间戳和计数都远小于
   2^53，转 Number 是安全的。 */
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

/** 把 SQLite 的 ? 占位符转成 PostgreSQL 的 $1 $2 …
 *  注意跳过字符串字面量里的问号，避免把 '为什么?' 这种内容也给替换了 */
export function toPgPlaceholders(sql) {
  let out = "";
  let n = 0;
  let inSingle = false, inDouble = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" && !inDouble) {
      // SQL 里连续两个单引号表示转义的单引号，不算字符串结束
      if (inSingle && sql[i + 1] === "'") { out += "''"; i++; continue; }
      inSingle = !inSingle; out += c; continue;
    }
    if (c === '"' && !inSingle) { inDouble = !inDouble; out += c; continue; }
    if (c === "?" && !inSingle && !inDouble) { out += "$" + (++n); continue; }
    out += c;
  }
  return out;
}

const isInsert = (sql) => /^\s*insert\s/i.test(sql);
const hasReturning = (sql) => /\sreturning\s/i.test(sql);

export function createD1Shim(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
  });

  async function exec(sql, params) {
    const text = toPgPlaceholders(sql);
    try {
      return await pool.query(text, params);
    } catch (e) {
      // 带上真实 SQL，否则 PostgreSQL 的报错很难定位是哪句出的问题
      e.message = "[SQL] " + e.message + "\n  语句：" + text.slice(0, 300);
      throw e;
    }
  }

  const db = {
    prepare(sql) {
      const stmt = {
        _sql: sql,
        _params: [],
        bind(...params) {
          // D1 允许 undefined，pg 不允许——统一转成 null
          stmt._params = params.map((p) => (p === undefined ? null : p));
          return stmt;
        },
        async first() {
          const r = await exec(stmt._sql, stmt._params);
          return r.rows.length ? r.rows[0] : null;
        },
        async all() {
          const r = await exec(stmt._sql, stmt._params);
          return { results: r.rows, success: true, meta: { changes: r.rowCount } };
        },
        async run() {
          let sql = stmt._sql;
          // auth.js 注册用户后要读 meta.last_row_id。
          // PostgreSQL 没有这个概念，靠 RETURNING * 把插入的行取回来再取 id。
          // 用 * 而不是 id，是因为有些表的主键不叫 id（如 outlines.key、office_chats.user_id）。
          if (isInsert(sql) && !hasReturning(sql)) sql = sql.replace(/;\s*$/, "") + " RETURNING *";
          const r = await exec(sql, stmt._params);
          const row = r.rows && r.rows[0];
          return {
            success: true,
            results: r.rows || [],
            meta: {
              last_row_id: row && row.id !== undefined ? row.id : null,
              changes: r.rowCount,
            },
          };
        },
      };
      return stmt;
    },
    /** 供本地服务器启动时自检连接用，业务代码不会调 */
    async _ping() {
      const r = await pool.query("SELECT 1 AS ok");
      return r.rows[0].ok === 1;
    },
    async _close() { await pool.end(); },
  };

  return db;
}
