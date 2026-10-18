import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const { SCHEMA, EXPIRY_SCHEMA, SCHEMA_VERSION } = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { SCHEMA, EXPIRY_SCHEMA, SCHEMA_VERSION };').toString('base64'));
await mkdir(new URL('../migrations/', import.meta.url), { recursive: true });
// Preserve already released migrations; append this feature as a new migration.
const first = new URL('../migrations/0001_stability.sql', import.meta.url);
try { await access(first); } catch {
  await writeFile(first, SCHEMA.filter(sql => !EXPIRY_SCHEMA.includes(sql)).map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','stable-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
}
await writeFile(new URL('../migrations/0002_expiry.sql', import.meta.url),
  '-- Independent expiry lots. This migration does not modify stock data.\n' + EXPIRY_SCHEMA.map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','" + SCHEMA_VERSION + "') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
console.log('Generated migrations/0002_expiry.sql; preserved 0001_stability.sql');
