import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../../assets/js/shared/gas-shim.js', import.meta.url), 'utf8');
function client(fetch) {
  const context = vm.createContext({ window: {}, fetch, console, AbortController, Set, Map, TypeError, URLSearchParams, Promise, Math, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  return (fn, ...args) => new Promise((resolve, reject) => context.window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args));
}
const ok = data => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });

test('shared navigation receives only verified sessions and retains a token when storage is unavailable', async () => {
  const events = [];
  const window = { dispatchEvent(event) { events.push(event); } };
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  let fail = false;
  const me = { user: 'test', name: 'ผู้ใช้ทดสอบ', role: 'viewer', perms: { expiry: true } };
  const context = vm.createContext({window,CustomEvent,fetch:async()=>fail?{ok:true,json:async()=>({ok:false,error:'SESSION_EXPIRED'})}:ok(me),console,AbortController,Set,Map,TypeError,URLSearchParams,Promise,Math,setTimeout,clearTimeout});
  vm.runInContext(source,context);
  const call = (fn,...args) => new Promise((resolve,reject)=>window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args));
  await call('whoami','memory-token');
  assert.equal(window.CMUCOOP_SESSION,me);
  assert.equal(window.CMUCOOP_SESSION_TOKEN,'memory-token');
  assert.equal(events.length,1); assert.equal(events[0].type,'cmucoop:session');
  fail=true; await assert.rejects(call('whoami','bad-token'));
  assert.equal(events.length,1); assert.equal(window.CMUCOOP_SESSION_TOKEN,'memory-token');
  fail=false; await call('logout','memory-token');
  assert.equal(window.CMUCOOP_SESSION,null); assert.equal(window.CMUCOOP_SESSION_TOKEN,'');
  assert.equal(events.at(-1).detail.me,null);
});
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
  const html = await readFile(new URL('../../assets/js/pages/barcode.js', import.meta.url), 'utf8');
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

test("barcode pairing does not auto-fill category unless explicitly chosen before upload", async () => {
  const js = await readFile(new URL("../../assets/js/pages/barcode.js", import.meta.url), "utf8");
  const start = js.indexOf("var PAIR_STORAGE_KEY =");
  const end = js.indexOf("function renderDraftBar()", start);
  const context = vm.createContext({
    window: {}, Set, Map, Math, Number, String, Boolean, Array, Object, RegExp, Date, JSON,
    $: () => null
  });
  vm.runInContext(js.slice(start, end), context);
  const sampleSheets = [{
    name: "ขนมขบเคี้ยว",
    grid: [
      ["รหัสคู่ค้า", "หมวด", "ชื่อสินค้า", "เลขบาร์โค้ด", "ราคาขาย", "คงเหลือ"],
      ["1021", "ขนม", "สาหร่ายเถ้าแก่น้อย 32 กรัม", "8858702499001", 39, 24],
      ["1021", "ขนม", "สาหร่ายเถ้าแก่น้อย 32 กรัม แพ็ค 6", "P8858702499002", 210, 5]
    ]
  }];
  const withoutCat = context.matchBarcodePairsFromSheets(sampleSheets, { minSim: 50, defaultCat: "", existingRows: [], pairWithDb: true, stockMap: {} });
  assert.equal(withoutCat.pairs.length, 1);
  assert.equal(withoutCat.pairs[0].cat, "");
  assert.equal(withoutCat.pairs[0].unitBar, "8858702499001");
  assert.equal(withoutCat.pairs[0].packBar, "8858702499002");

  const withCat = context.matchBarcodePairsFromSheets(sampleSheets, { minSim: 50, defaultCat: "ขนม", existingRows: [], pairWithDb: true, stockMap: {} });
  assert.equal(withCat.pairs.length, 1);
  assert.equal(withCat.pairs[0].cat, "ขนม");
});
