import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { walkFiles } from './files.mjs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
let scripts = 0, modules = 0;
for (const file of await walkFiles(root)) {
  const name = relative(root, file);
  if (name.endsWith('.html')) {
    const html = await readFile(file, 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/.test(match[1]) || /application\/(?:ld\+)?json/.test(match[1])) continue;
      new vm.Script(match[2], { filename: name }); scripts++;
    }
  } else if (/\.(?:js|mjs)$/.test(name)) {
    if (name.startsWith('worker')) {
      const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (check.status !== 0) throw new Error(check.stderr || 'Syntax check failed: ' + name);
      modules++;
    } else { new vm.Script(await readFile(file, 'utf8'), { filename: name }); scripts++; }
  }
}
await import('../index.js');
console.log(`Syntax and module imports passed: ${scripts} browser scripts, ${modules} worker/test/tool modules`);
