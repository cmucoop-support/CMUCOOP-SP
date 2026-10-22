import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { D1 } from './d1.mjs';
import * as app from '../index.js';

async function setup() {
  const DB = new D1(); await DB.install(app.SCHEMA);
  const C = {env:{DB}};
  await app.kvSet(C, 'LINK_MIGRATED', '1');
  for (const [user, role] of [['admin','admin'], ['viewer','viewer']]) {
    DB.db.prepare('INSERT INTO users(username,salt,hash,role,name,perms) VALUES(?,?,?,?,?,?)')
      .run(user, '-', '-', role, user, JSON.stringify({barcode:true}));
    DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run(user,user,Date.now()+86400000);
  }
  return C;
}

test('tab preferences default to the same tab, require authentication and only admins can change them', async () => {
  const C = await setup();
  assert.deepEqual(await app.API.getCardNewTabs(C, 'viewer'), []);
  await assert.rejects(app.API.getCardNewTabs(C, ''), /SESSION_EXPIRED/);
  await assert.rejects(app.API.setCardNewTabs(C, 'viewer', ['barcode']), /ไม่มีสิทธิ์/);
  assert.equal(await app.kvGet(C, 'CARD_NEW_TABS', null), null);
});

test('tab preferences persist across users for built-in, settings and custom cards without changing visibility or permissions', async () => {
  const C = await setup();
  const [card] = await app.API.setCustomCards(C, 'admin', [{t:'ลิงก์ภายนอก',u:'https://example.test/tools'}]);
  await app.API.setHiddenCards(C, 'admin', ['sound']);
  const user = await app.API.whoami(C, 'viewer');
  const saved = await app.API.setCardNewTabs(C, 'admin', [card.k, 'settings', 'barcode']);
  assert.deepEqual(saved, ['barcode', 'settings', card.k]);
  assert.deepEqual(await app.API.getCardNewTabs({env:{DB:C.env.DB}}, 'viewer'), saved);
  // Editing a title through the pre-existing payload keeps tab settings.
  await app.API.setCustomCards(C, 'admin', [{k:card.k,t:'ชื่อใหม่',u:card.u}]);
  assert.deepEqual(await app.API.getCardNewTabs(C, 'admin'), saved);
  assert.deepEqual(await app.API.getHiddenCards(C, 'admin'), ['sound']);
  assert.deepEqual(await app.API.whoami(C, 'viewer'), user);
  await app.API.setCardNewTabs(C, 'admin', []);
  assert.deepEqual(await app.API.getCardNewTabs(C, 'viewer'), []);
});

test('invalid tab preferences do not overwrite saved data and unchanged preferences do not write again', async () => {
  const C = await setup();
  await app.API.setCardNewTabs(C, 'admin', ['music','barcode']);
  const writes = C.env.DB.writes;
  for (const invalid of [null, {}, '_blank', [123], ['missing'], Array(40).fill('music')]) {
    await assert.rejects(app.API.setCardNewTabs(C, 'admin', invalid));
    assert.deepEqual(await app.API.getCardNewTabs(C, 'viewer'), ['barcode','music']);
  }
  await app.API.setCardNewTabs(C, 'admin', ['music','barcode','music']);
  assert.equal(C.env.DB.writes, writes);
});

test('deleting a custom card cleans tab and visibility preferences atomically', async () => {
  const C = await setup();
  const [card] = await app.API.setCustomCards(C, 'admin', [{t:'ลิงก์',u:'https://example.test'}]);
  await app.API.setHiddenCards(C, 'admin', [card.k]);
  await app.API.setCardNewTabs(C, 'admin', ['settings',card.k]);
  C.env.DB.fail = q => q.sql.startsWith('INSERT INTO kv(') && q.params[0] === 'CARD_NEW_TABS';
  await assert.rejects(app.API.setCustomCards(C, 'admin', []), /injected/);
  C.env.DB.fail = null;
  assert.equal((await app.API.getCustomCards(C, 'admin'))[0].k, card.k);
  assert.deepEqual(await app.API.getHiddenCards(C, 'admin'), [card.k]);
  assert.deepEqual(await app.API.getCardNewTabs(C, 'admin'), ['settings',card.k]);
  await app.API.setCustomCards(C, 'admin', []);
  assert.deepEqual(JSON.parse(await app.kvGet(C, 'CARD_NEW_TABS', '[]')), ['settings']);
  assert.deepEqual(JSON.parse(await app.kvGet(C, 'CARD_HIDDEN', '[]')), []);
});

test('portal links apply saved targets, protect new tabs and pass the session only to built-in pages', async () => {
  const source = await readFile(new URL('../../assets/js/pages/index.js', import.meta.url), 'utf8');
  const cards = source.slice(source.indexOf('var CARD_DEF ='), source.indexOf('/* ----- ปรับขนาดการ์ด'));
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {attrs:{},setAttribute(k,v){this.attrs[k]=v;}});
    return nodes.get(id);
  }
  const context = vm.createContext({
    S:{token:'local test/#'}, pageUrl:file => 'https://portal.test/' + file,
    document:{getElementById:node,querySelector:selector => node(selector.match(/data-ck="([^"]+)"/)[1])}
  });
  vm.runInContext(cards, context);
  vm.runInContext("CUSTOM=[{k:'c_00000001',u:'https://external.test/path?x=1#part'}];applyCardTargets()", context);
  assert.equal(node('mBarcode').attrs.target, '_self');
  assert.equal(node('c_00000001').attrs.target, '_self');
  assert.equal(node('mBarcode').href, 'https://portal.test/barcode.html#t=local%20test%2F%23');
  vm.runInContext("CARD_NEW_TABS=['barcode','settings','c_00000001'];applyCardTargets()", context);
  for (const id of ['mBarcode','mSettings','c_00000001']) {
    assert.equal(node(id).attrs.target, '_blank');
    assert.equal(node(id).attrs.rel, 'noopener noreferrer');
  }
  assert.equal(node('c_00000001').href, 'https://external.test/path?x=1#part');
  assert.equal(node('mMusic').attrs.target, '_self');
  vm.runInContext('CARD_NEW_TABS=[];applyCardTargets()', context);
  assert.equal(node('mBarcode').attrs.target, '_self');
  assert.equal(node('mBarcode').attrs.rel, '');
});
