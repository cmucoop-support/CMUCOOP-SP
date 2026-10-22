import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function walkFiles(dir, ignored = new Set(['node_modules', '.git', 'previews', 'vendor'])) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.filter(e => !ignored.has(e.name)).map(e => e.isDirectory() ? walkFiles(join(dir, e.name), ignored) : [join(dir, e.name)]))).flat();
}
