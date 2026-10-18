import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const { SCHEMA, EXPIRY_SCHEMA, EXPIRY_PRODUCT_SCHEMA, SCHEMA_VERSION } = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { SCHEMA, EXPIRY_SCHEMA, EXPIRY_PRODUCT_SCHEMA, SCHEMA_VERSION };').toString('base64'));
await mkdir(new URL('../migrations/', import.meta.url), { recursive: true });
// Preserve already released migrations; append this feature as a new migration.
const first = new URL('../migrations/0001_stability.sql', import.meta.url);
try { await access(first); } catch {
  await writeFile(first, SCHEMA.filter(sql => !EXPIRY_SCHEMA.includes(sql) && !EXPIRY_PRODUCT_SCHEMA.includes(sql)).map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','stable-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
}
const second = new URL('../migrations/0002_expiry.sql', import.meta.url);
try { await access(second); } catch {
  await writeFile(second, EXPIRY_SCHEMA.map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','expiry-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
}
const third = new URL('../migrations/0003_expiry_stock.sql', import.meta.url);
try { await access(third); } catch {
  await writeFile(third, EXPIRY_PRODUCT_SCHEMA.map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','" + SCHEMA_VERSION + "') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
}
console.log('Migrations ready through 0003_expiry_stock.sql; existing migrations preserved');
