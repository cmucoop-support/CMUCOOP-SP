import { readFile, mkdir, writeFile } from 'node:fs/promises';
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const { SCHEMA } = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { SCHEMA };').toString('base64'));
await mkdir(new URL('../migrations/', import.meta.url), { recursive: true });
await writeFile(new URL('../migrations/0001_stability.sql', import.meta.url),
  '-- Non-destructive schema additions. Apply before deploying the new Worker.\n' + SCHEMA.map(sql => sql + ';').join('\n') + "\nINSERT INTO kv(k,v) VALUES('SCHEMA_VERSION','stable-1') ON CONFLICT(k) DO UPDATE SET v=excluded.v;\n");
console.log('Generated migrations/0001_stability.sql');
