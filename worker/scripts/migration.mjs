import { mkdir, writeFile, access } from 'node:fs/promises';
import { PRODUCT_SCHEMA } from '../src/modules/catalog.js';
const { SCHEMA, EXPIRY_SCHEMA, EXPIRY_PRODUCT_SCHEMA, SCHEMA_VERSION } = await import('../index.js');
await mkdir(new URL('../migrations/', import.meta.url), { recursive: true });
// Preserve already released migrations; append this feature as a new migration.
const first = new URL('../migrations/0001_stability.sql', import.meta.url);
try { await access(first); } catch {
  await writeFile(first, SCHEMA.filter(sql => !EXPIRY_SCHEMA.includes(sql) && !EXPIRY_PRODUCT_SCHEMA.includes(sql) && !PRODUCT_SCHEMA.includes(sql)).map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','stable-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
}
const second = new URL('../migrations/0002_expiry.sql', import.meta.url);
try { await access(second); } catch {
  await writeFile(second, EXPIRY_SCHEMA.map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','expiry-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
}
const third = new URL('../migrations/0003_expiry_stock.sql', import.meta.url);
try { await access(third); } catch {
  await writeFile(third, EXPIRY_PRODUCT_SCHEMA.map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','expiry-stock-2') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
}
const fourth = new URL('../migrations/0004_product_catalog.sql', import.meta.url);
try { await access(fourth); } catch {
  await writeFile(fourth, PRODUCT_SCHEMA.map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','" + SCHEMA_VERSION + "') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
}
console.log('Migrations ready through 0004_product_catalog.sql; existing migrations preserved');
