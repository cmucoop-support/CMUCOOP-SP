import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { DatabaseSync } = await import('node:sqlite').catch(() =>
  createRequire(import.meta.url)(process.env.SQLITE_ADDON || '/tmp/sqlite_sync.node')
);

// Real SQLite transactions/JSON1, with the D1 binding's result shape and limits.
// Network/CPU limits and distributed D1 scheduling still require staging tests.
export class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.calls = 0; this.writes = 0; this.maxValue = 0; this.fail = null; this.hook = null; }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    await this.hook?.(statements);
    this.db.exec('BEGIN');
    try {
      const results = statements.map(q => this.execute(q));
      this.db.exec('COMMIT');
      return results;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  execute(q) {
    this.calls++;
    if (q.params.length > 100) throw new Error('D1 too many bound parameters');
    if (Buffer.byteLength(q.sql) > 100000) throw new Error('D1 SQL too long');
    for (const p of q.params) {
      if (typeof p === 'string') {
        const bytes = Buffer.byteLength(p); this.maxValue = Math.max(this.maxValue, bytes);
        if (bytes > 2000000) throw new Error('D1 value too large');
      }
    }
    if (this.fail?.(q)) throw new Error('injected storage failure');
    const compiled = this.db.prepare(q.sql);
    if (compiled.columns().length) return { success: true, results: compiled.all(...q.params), meta: { changes: 0 } };
    const out = compiled.run(...q.params);
    const changes = Number(out.changes);
    this.writes += changes;
    return { success: true, results: [], meta: { changes, last_row_id: Number(out.lastInsertRowid) } };
  }
  async install(schema) { await this.batch(schema.map(sql => this.prepare(sql))); }
}
class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  async run() { return this.db.execute(this); }
  async all() { return this.db.execute(this); }
  async first(column) { const row = this.db.execute(this).results[0] || null; return column && row ? row[column] : row; }
}
