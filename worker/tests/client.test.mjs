import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../../gas-shim.js', import.meta.url), 'utf8');
function client(fetch) {
  const context = vm.createContext({ window: {}, fetch, console, AbortController, Set, Map, TypeError, URLSearchParams, Promise, Math, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  return (fn, ...args) => new Promise((resolve, reject) => context.window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args));
}
const ok = data => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
test('browser shares identical in-flight reads and bounds concurrent requests at four', async () => {
  let active = 0, max = 0, requests = 0;
  const call = client(async (_, req) => {
    requests++; active++; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 10)); active--;
    return ok(JSON.parse(req.body).args[0]);
  });
  const result = await Promise.all([call('stockGet', 'same'), call('stockGet', 'same'), ...Array.from({ length: 10 }, (_, i) => call('marketGet', i))]);
  assert.equal(result[0], 'same'); assert.equal(result[1], 'same');
  assert.equal(requests, 11); assert.ok(max <= 4);
});
test('browser never retries a write after an uncertain network failure', async () => {
  let count = 0;
  const call = client(async () => { count++; throw new TypeError('connection lost'); });
  await assert.rejects(call('stockLostAdd', 'token', [{ code: 'x', qty: 1 }]), e => /เชื่อมต่อ/.test(e.message));
  assert.equal(count, 1);
});
test('browser retries only the explicit schema-initialized response before a write ran', async () => {
  let count = 0;
  const call = client(async () => { count++; return count === 1 ? { ok: true, status: 200, json: async () => ({ ok: false, code: 'SCHEMA_INITIALIZED' }) } : ok('saved'); });
  assert.equal(await call('stockSave', 'token', {}), 'saved'); assert.equal(count, 2);
});
test('browser retries one transient read without retrying API validation errors', async () => {
  let count = 0;
  const call = client(async () => { count++; if (count === 1) throw new TypeError('offline'); return ok('data'); });
  assert.equal(await call('stockGet', 'token'), 'data'); assert.equal(count, 2);
  let errors = 0;
  const denied = client(async () => { errors++; return { ok: true, status: 200, json: async () => ({ ok: false, error: 'permission denied' }) }; });
  await assert.rejects(denied('stockGet', 'token'), e => e.message === 'permission denied'); assert.equal(errors, 1);
});

test('barcode table renders only one page of 20,000 records and searches every record', async () => {
  const html = await readFile(new URL('../../barcode.html', import.meta.url), 'utf8');
  const start = html.indexOf('var BC_TABLE_PAGE =');
  const end = html.indexOf("$('#q').addEventListener('input'", start);
  const elements = Object.fromEntries(['#q', '#count', '#bcPageInfo', '#bcPrevPage', '#bcNextPage', '#tbody'].map(k => [k, { value: '', textContent: '', innerHTML: '' }]));
  let rendered = 0;
  const context = vm.createContext({
    S: { data: { rows: Array.from({ length: 20000 }, (_, i) => ({ r: i, v: ['สินค้า' + i] })) }, tablePage: 0 },
    window: {}, $: selector => elements[selector], curCat: () => ({}), schemaOfCat: () => ({ cols: [1] }),
    rowHtml: (_, row) => { rendered++; return '<tr><td>' + row.v[0] + '</td></tr>'; }
  });
  vm.runInContext(html.slice(start, end), context);
  vm.runInContext('renderTable()', context);
  assert.equal(rendered, 200); assert.equal(elements['#bcPageInfo'].textContent, 'หน้า 1 / 100');
  assert.equal(elements['#bcPrevPage'].disabled, true);
  rendered = 0; elements['#q'].value = 'สินค้า19999';
  vm.runInContext('renderTable()', context);
  assert.equal(rendered, 1); assert.match(elements['#tbody'].innerHTML, /19999/);
});
