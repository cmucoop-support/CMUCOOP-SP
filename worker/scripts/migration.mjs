import { mkdir, writeFile, access } from 'node:fs/promises';
const { SCHEMA, EXPIRY_SCHEMA, EXPIRY_PRODUCT_SCHEMA, OBSOLETE_CATALOG_CLEANUP } = await import('../index.js');
await mkdir(new URL('../migrations/', import.meta.url), { recursive: true });
// Preserve already released migrations 0001-0003.
const first = new URL('../migrations/0001_stability.sql', import.meta.url);
try { await access(first); } catch {
  await writeFile(first, SCHEMA.filter(sql => !EXPIRY_SCHEMA.includes(sql) && !EXPIRY_PRODUCT_SCHEMA.includes(sql) && !OBSOLETE_CATALOG_CLEANUP.includes(sql)).map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','stable-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
}
const second = new URL('../migrations/0002_expiry.sql', import.meta.url);
try { await access(second); } catch {
  await writeFile(second, EXPIRY_SCHEMA.map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','expiry-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
}
const third = new URL('../migrations/0003_expiry_stock.sql', import.meta.url);
try { await access(third); } catch {
  await writeFile(third, EXPIRY_PRODUCT_SCHEMA.map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','expiry-stock-2') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
}
console.log('Migrations ready through 0003_expiry_stock.sql; existing migrations preserved');
