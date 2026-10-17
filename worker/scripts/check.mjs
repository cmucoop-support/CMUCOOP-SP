import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
let scripts = 0;
for (const name of await readdir(root)) {
  if (name.endsWith('.html')) {
    const html = await readFile(resolve(root, name), 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/.test(match[1]) || /application\/(?:ld\+)?json/.test(match[1])) continue;
      new vm.Script(match[2], { filename: name }); scripts++;
    }
  } else if (name.endsWith('.js')) {
    new vm.Script(await readFile(resolve(root, name), 'utf8'), { filename: name }); scripts++;
  }
}
const check = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('../index.js', import.meta.url))], { encoding: 'utf8' });
if (check.status) throw new Error(check.stderr);
console.log(`Syntax passed: ${scripts} browser scripts and worker/index.js`);
