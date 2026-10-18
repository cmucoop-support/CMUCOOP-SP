import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../assets/js/pages/catalog.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../../catalog.html', import.meta.url), 'utf8');
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const product = (name, key = 'b:A|001') => ({ productKey: key, branchCode: 'b:A', branch: 'สาขา A', code: '001', name, codes: ['001'], names: [name], categories: [], sources: ['stock'], conflictCount: 0, conflicts: [], updatedAt: 1729200000000 });
const list = rows => ({ rows, total: rows.length, nextCursor: null, revision: '1', syncedAt: 1729200000000 });
const overview = { revision: '1', total: 1, conflictCount: 0, branches: [{ branchCode: 'b:A', name: 'สาขา A', total: 1 }], sources: [{ id: 'stock', count: 1 }], syncedAt: 1729200000000 };

// A deliberately small DOM: assigning dynamic HTML throws, so regressions that
// introduce source-data HTML interpolation fail while exercising the real client.
function client(handler) {
  const nodes = new Map(), events = new Map(), calls = [];
  class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.value = ''; this.checked = false; this.hidden = false; this.disabled = false; this.open = false; this.listeners = new Map(); this._text = ''; }
    set id(value) { this._id = value; nodes.set('#' + value, this); }
    get id() { return this._id; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(_) { throw new Error('Dynamic HTML is forbidden'); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this._text = ''; this.children = [...children]; }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(name, listener) { const group = this.listeners.get(name) || []; group.push(listener); this.listeners.set(name, group); }
    async emit(name, properties = {}) { for (const listener of this.listeners.get(name) || []) await listener({ target: this, preventDefault() {}, ...properties }); }
    closest() { return this; }
    focus() {}
    close() { this.open = false; this.emit('close'); }
    showModal() { this.open = true; }
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) { const node = new Element(); node.id = id; }
  const document = { querySelector: selector => nodes.get(selector), createElement: tag => new Element(tag), hidden: false, addEventListener: (name, fn) => events.set(name, fn) };
  const runner = (success, failure) => new Proxy({}, { get(_, name) {
    if (name === 'withSuccessHandler') return callback => runner(callback, failure);
    if (name === 'withFailureHandler') return callback => runner(success, callback);
    return (...args) => { calls.push({ name, args }); Promise.resolve().then(() => handler(name, args)).then(success, error => failure({ message: error.message })); };
  } });
  const store = new Map([['pm_tok', 'seed']]);
  const window = { addEventListener: (name, listener) => events.set(name, listener) };
  vm.runInContext(source, vm.createContext({ window, document, google: { script: { run: runner() } }, location: { hash: '', pathname: '/catalog.html', search: '' }, history: { replaceState() {} }, sessionStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) }, Intl, Date, Number, String, URLSearchParams, Promise, Error, setTimeout, clearTimeout }));
  return { nodes, calls, events, document };
}
const defaultHandler = (name) => {
  if (name === 'whoami') return { role: 'admin', name: 'ผู้ดูแล' };
  if (name === 'productCatalogSummary') return overview;
  if (name === 'productCatalogList') return list([product('สินค้า')]);
  if (name === 'logout') return true;
  throw new Error('Unexpected API ' + name);
};

test('catalog renders untrusted product and branch names only as text and labels global records explicitly', async () => {
  const unsafe = '<img src=x onerror=alert(1)>';
  const app = client(name => name === 'productCatalogList' ? list([{ ...product(unsafe), branchCode: '__global__', branch: 'ทุกสาขา', sources: ['barcode'] }]) : defaultHandler(name));
  await tick();
  assert.equal(app.nodes.get('#workspace').hidden, false);
  const text = app.nodes.get('#rows').textContent;
  assert.ok(text.includes(unsafe)); assert.match(text, /ข้อมูลกลาง.*ไม่ระบุสาขา/);
  assert.equal(app.nodes.get('#rows').children.length, 1);
  assert.equal(app.calls.filter(call => call.name === 'productCatalogList').length, 1);
});

test('an older catalog request cannot overwrite results after a filter change', async () => {
  const old = deferred(); let reads = 0;
  const app = client(name => name === 'productCatalogList' ? (++reads === 1 ? old.promise : list([product('ผลใหม่')])) : defaultHandler(name));
  await tick();
  app.nodes.get('#search').value = 'ผลใหม่';
  await app.nodes.get('#search').emit('keydown', { key: 'Enter' }); await tick();
  old.resolve(list([product('ผลเก่า')])); await tick();
  assert.match(app.nodes.get('#rows').textContent, /ผลใหม่/);
  assert.ok(!app.nodes.get('#rows').textContent.includes('ผลเก่า'));
  const request = app.calls.filter(call => call.name === 'productCatalogList').at(-1);
  assert.equal(request.args[1].search, 'ผลใหม่');
});

test('late responses cannot reveal catalog data after logout', async () => {
  const pending = deferred();
  const app = client(name => name === 'productCatalogList' ? pending.promise : defaultHandler(name));
  await tick(); await app.nodes.get('#logout').emit('click');
  pending.resolve(list([product('ข้อมูลลับ')])); await tick();
  assert.equal(app.nodes.get('#workspace').hidden, true);
  assert.equal(app.nodes.get('#rows').textContent, '');
});

test('catalog permission is required and denied users do not request product data', async () => {
  const app = client(name => name === 'whoami' ? { role: 'viewer', name: 'ผู้ใช้', perms: {} } : defaultHandler(name));
  await tick();
  assert.equal(app.nodes.get('#workspace').hidden, true);
  assert.match(app.nodes.get('#loginError').textContent, /ยังไม่มีสิทธิ์/);
  assert.equal(app.calls.filter(call => call.name === 'productCatalogList').length, 0);
});

test('a filter response from a newer revision refreshes summary counts before rendering', async () => {
  let revision = '1';
  const app = client(name => name === 'productCatalogList' ? { ...list([product('สินค้า ' + revision)]), revision }
    : name === 'productCatalogSummary' ? { ...overview, revision, total: Number(revision) } : defaultHandler(name));
  await tick(); revision = '2';
  await app.nodes.get('#search').emit('keydown', { key: 'Enter' }); await tick();
  assert.match(app.nodes.get('#rows').textContent, /สินค้า 2/);
  assert.equal(app.nodes.get('#totalCount').textContent, '2');
  assert.equal(app.calls.filter(call => call.name === 'productCatalogSummary').length, 2);
});

test('cross-tab save notifications are debounced and hidden tabs do not poll', async () => {
  const app = client(defaultHandler); await tick();
  for (let i = 0; i < 8; i++) app.events.get('storage')({ key: 'cmucoop_catalog_changed' });
  await new Promise(resolve => setTimeout(resolve, 550)); await tick();
  assert.equal(app.calls.filter(call => call.name === 'productCatalogList').length, 2);
  app.document.hidden = true;
  app.events.get('storage')({ key: 'cmucoop_catalog_changed' });
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal(app.calls.filter(call => call.name === 'productCatalogList').length, 2);
});
