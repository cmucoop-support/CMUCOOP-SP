import { readFile, readdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const { API } = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { API };').toString('base64'));
const unknown = [], missingAssets = [], files = [];
for (const name of await readdir(root)) {
  if (!/\.(js|html|css)$/.test(name)) continue;
  const content = await readFile(resolve(root, name), 'utf8'); files.push(name);
  for (const match of content.matchAll(/\bcall\(\s*['"]([A-Za-z][\w:]*)['"]/g)) {
    const fn = match[1].split(':')[0];
    if (!Object.hasOwn(API, fn)) unknown.push({ file: name, fn });
  }
  if (name.endsWith('.html')) {
    for (const match of content.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
      const target = match[1].split(/[?#]/)[0];
      if (!target || /^(?:https?:|data:|\/\/)/.test(target)) continue;
      try { await access(resolve(root, target)); } catch { missingAssets.push({ file: name, target }); }
    }
  }
}
console.log(JSON.stringify({ firstPartyBrowserFiles: files.length, apiFunctions: Object.keys(API).length, unknownApiCalls: unknown, missingLocalAssets: missingAssets }, null, 2));
if (unknown.length || missingAssets.length) process.exitCode = 1;
