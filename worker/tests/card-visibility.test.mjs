import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { D1 } from './d1.mjs';
import * as app from '../index.js';

async function setup() {
  const DB = new D1(); await DB.install(app.SCHEMA);
  for (const [user, role, perms] of [['admin', 'admin', {}], ['viewer', 'viewer', {music:false, barcode:true}]]) {
    DB.db.prepare('INSERT INTO users(username,salt,hash,role,name,perms) VALUES(?,?,?,?,?,?)')
      .run(user, '-', '-', role, user, JSON.stringify(perms));
    DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run(user, user, Date.now()+86400000);
  }
  // Test only this feature without invoking legacy link migration.
  await app.kvSet({env:{DB}}, 'LINK_MIGRATED', '1');
  return {env:{DB}};
}

test('card visibility defaults to visible and requires authentication; only admins can save', async () => {
  const C = await setup();
  assert.deepEqual(await app.API.getHiddenCards(C, 'admin'), []);
  await assert.rejects(app.API.getHiddenCards(C, ''), /SESSION_EXPIRED/);
  await assert.rejects(app.API.setHiddenCards(C, 'viewer', ['barcode']), /ไม่มีสิทธิ์/);
  assert.equal(await app.kvGet(C, 'CARD_HIDDEN', null), null);
});

test('hidden standard and custom cards persist across users and requests without changing permissions', async () => {
  const C = await setup();
  const custom = await app.API.setCustomCards(C, 'admin', [{t:'เครื่องมือภายใน',u:'https://example.test/tools'}]);
  const me = await app.API.whoami(C, 'viewer');
  const saved = await app.API.setHiddenCards(C, 'admin', [custom[0].k, 'barcode', 'barcode']);
  assert.deepEqual(saved, ['barcode', custom[0].k]);
  assert.deepEqual(await app.API.getHiddenCards({env:{DB:C.env.DB}}, 'viewer'), saved);
  assert.deepEqual(await app.API.whoami(C, 'viewer'), me);
  assert.equal((await app.API.getCustomCards(C, 'admin'))[0].k, custom[0].k);
  await app.API.setHiddenCards(C, 'admin', []);
  assert.deepEqual(await app.API.getHiddenCards(C, 'viewer'), []);
});

test('invalid visibility updates and hiding settings leave the saved configuration unchanged', async () => {
  const C = await setup();
  await app.API.setHiddenCards(C, 'admin', ['sound']);
  for (const invalid of [null, {}, 'music', [123], ['missing'], ['settings'], Array(40).fill('music')]) {
    await assert.rejects(app.API.setHiddenCards(C, 'admin', invalid));
    assert.deepEqual(await app.API.getHiddenCards(C, 'admin'), ['sound']);
  }
});

test('unchanged visibility does not write a second setting or activity entry', async () => {
  const C = await setup();
  await app.API.setHiddenCards(C, 'admin', ['music', 'barcode']);
  const writes = C.env.DB.writes;
  await app.API.setHiddenCards(C, 'admin', ['barcode', 'music', 'music']);
  await app.API.getHiddenCards(C, 'viewer');
  assert.equal(C.env.DB.writes, writes);
});

test('deleting a custom card removes its hidden flag in the same transaction', async () => {
  const C = await setup();
  const [card] = await app.API.setCustomCards(C, 'admin', [{t:'เครื่องมือ',u:'https://example.test'}]);
  await app.API.setHiddenCards(C, 'admin', ['sound', card.k]);
  C.env.DB.fail = q => q.sql.startsWith('INSERT INTO kv(') && q.params[0] === 'CARD_HIDDEN';
  await assert.rejects(app.API.setCustomCards(C, 'admin', []), /injected/);
  C.env.DB.fail = null;
  assert.equal((await app.API.getCustomCards(C, 'admin'))[0].k, card.k);
  assert.deepEqual(await app.API.getHiddenCards(C, 'admin'), ['sound', card.k]);
  await app.API.setCustomCards(C, 'admin', []);
  assert.deepEqual(JSON.parse(await app.kvGet(C, 'CARD_HIDDEN', '[]')), ['sound']);
});

const indexSource = await readFile(new URL('../../assets/js/pages/index.js', import.meta.url), 'utf8');
const cardSource = indexSource.slice(indexSource.indexOf('var CARD_DEF ='), indexSource.indexOf('/* ----- ปรับขนาดการ์ด'));

function menuClient(role, perms = {}, call = () => Promise.resolve([])) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {id, hidden:false, textContent:'', parentElement:{hidden:false}, attributes:{},
        setAttribute(k,v) {this.attributes[k]=v;},
        classList:{toggle(k,on) {if(on)classes.add(k);else classes.delete(k);},contains(k){return classes.has(k);}}
      });
    }
    return elements.get(id);
  }
  const ids = ['mBarcode','mSound','mMusic','mStock','mMarket','mExpiry','mSettings','custom'];
  ids.forEach(element);
  const S = {token:'local-test',me:{role,perms}};
  const context = vm.createContext({S, call,
    hasPerm: k => S.me.role === 'admin' || !!S.me.perms[k],
    document:{getElementById:element,
      querySelector: selector => selector==='#portal .menu'?element('menu'):element('custom'),
      querySelectorAll: () => ids.map(element)},
    $: selector => element(selector.slice(1)), loadExpiryCardCount() {}
  });
  vm.runInContext(cardSource, context);
  return {context, elements, element};
}

test('portal visibility combines hidden flags with permissions and always keeps admin settings reachable', () => {
  const admin = menuClient('admin');
  vm.runInContext("CARD_HIDDEN=['barcode','settings'];CUSTOM=[{k:'c_00000001'}];applyCardVisibility()", admin.context);
  assert.equal(admin.element('mBarcode').classList.contains('hidden'), true);
  assert.equal(admin.element('mSettings').classList.contains('hidden'), false);
  const viewer = menuClient('viewer', {barcode:true,music:false,c_00000001:false});
  vm.runInContext("CARD_HIDDEN=[];CUSTOM=[{k:'c_00000001'}];applyCardVisibility()", viewer.context);
  assert.equal(viewer.element('mBarcode').classList.contains('hidden'), false);
  assert.equal(viewer.element('mMusic').classList.contains('hidden'), true);
  assert.equal(viewer.element('mSettings').classList.contains('hidden'), true);
  assert.equal(viewer.element('custom').classList.contains('hidden'), true);
  vm.runInContext("CARD_HIDDEN=['barcode'];applyCardVisibility()", viewer.context);
  assert.equal(viewer.element('mBarcode').classList.contains('hidden'), true);
});

test('failed visibility reads do not reveal cards and offer a retry while preserving access to settings', async () => {
  const admin = menuClient('admin', {}, fn => fn === 'getHiddenCards'
    ? Promise.reject(new Error('ไม่รู้จักคำสั่ง: getHiddenCards')) : Promise.resolve([]));
  await vm.runInContext('loadCardOrder()', admin.context);
  for (const id of ['mBarcode','mSound','mMusic','mStock','mMarket','mExpiry','custom']) {
    assert.equal(admin.element(id).classList.contains('hidden'), true);
  }
  assert.equal(admin.element('mSettings').classList.contains('hidden'), false);
  assert.equal(admin.element('portalReloadCards').hidden, false);
  assert.match(admin.element('portalCardsStatus').textContent, /Cloudflare Worker/);
  assert.equal(admin.element('menu').attributes['aria-busy'], 'false');
});
