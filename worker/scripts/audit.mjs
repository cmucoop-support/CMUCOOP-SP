import { readFile, access } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API } from '../index.js';
import { walkFiles } from './files.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const unknown = [], missingAssets = [], files = [];
for (const file of await walkFiles(root, new Set(['node_modules', '.git', 'worker', 'vendor', 'previews']))) {
  const name = relative(root, file);
  if (!/\.(js|html|css)$/.test(name)) continue;
  const content = await readFile(file, 'utf8'); files.push(name);
  for (const match of content.matchAll(/\bcall\(\s*['"]([A-Za-z][\w:]*)['"]/g)) {
    const fn = match[1].split(':')[0];
    if (!Object.hasOwn(API, fn)) unknown.push({ file: name, fn });
  }
  if (name.endsWith('.html')) {
    for (const match of content.matchAll(/<(?:script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
      const target = match[1].split(/[?#]/)[0];
      if (!target || /^(?:https?:|data:|\/\/)/.test(target)) continue;
      try { await access(resolve(dirname(file), target)); } catch { missingAssets.push({ file: name, target }); }
    }
  }
  if (name.endsWith('.css')) for (const match of content.matchAll(/url\(["']?([^\s)'";]+)["']?\)/gi)) {
    const target = match[1].split(/[?#]/)[0];
    if (!target || /^(?:[a-z]+:|\/\/|#)/i.test(target)) continue;
    try { await access(resolve(dirname(file), target)); } catch { missingAssets.push({ file: name, target }); }
  }
}
console.log(JSON.stringify({ firstPartyBrowserFiles: files.length, apiFunctions: Object.keys(API).length, unknownApiCalls: unknown, missingLocalAssets: missingAssets }, null, 2));
if (unknown.length || missingAssets.length) process.exitCode = 1;
