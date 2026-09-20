// A transaction wrapper may inherit only committed/preflight initialization.
// Its own DDL can still roll back, so completion must never propagate upwards.
export function createSchemaInitializer(statements) {
  const completed = new WeakSet(), pending = new WeakMap();
  return async function ensureSchema(env) {
    const db = env.DB, visited = new Set();
    for (let current = db; current && !visited.has(current); current = current._schemaParent) {
      if (completed.has(current)) return;
      visited.add(current);
    }
    if (pending.has(db)) return pending.get(db);
    const operation = (async () => {
      for (const sql of statements) await db.prepare(sql).run();
      completed.add(db);
    })();
    pending.set(db, operation);
    try { await operation; } finally { pending.delete(db); }
  };
}
