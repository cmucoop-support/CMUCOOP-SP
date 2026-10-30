import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import XLSX from '../../assets/vendor/xlsx.full.min.js';
import { D1 } from './d1.mjs';
import * as mod from '../index.js';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH || 'playwright');
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const preview = process.env.BARCODE_PREVIEW_DIR || resolve(root, 'previews/barcode');
await mkdir(preview, { recursive: true });
const DB = new D1(); await DB.install(mod.SCHEMA);
DB.db.prepare('INSERT INTO kv(k,v) VALUES(?,?)').run('SCHEMA_VERSION', mod.SCHEMA_VERSION);
DB.db.prepare('INSERT INTO users(username,salt,hash,role,name,perms) VALUES(?,?,?,?,?,?)').run('demo', 'salt', await mod.sha256hex('salt|demo1234'), 'admin', 'Admin SP', '{}');
DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run('seed', 'demo', Date.now() + 86400000);
const insert = DB.db.prepare('INSERT INTO barcode_items(pos,sheet,partner,cat,name,perPack,packBar,unitBar,ts,who) VALUES(?,?,?,?,?,?,?,?,?,?)');
for (let i = 0; i < 77; i++) {
  insert.run(i + 1, 'บาร์สินค้า', i % 2 ? '0007' : '0008', i < 75 ? '01 เครื่องดื่ม' : '02 นม',
    i === 0 ? 'น้ำดื่มธรรมชาติ ขวดใหญ่ แพ็คสำหรับครอบครัว พร้อมรายละเอียดภาษาไทยยาวเพื่อทดสอบการตัดบรรทัด' : 'สินค้าทดสอบ ' + (i + 1), '12',
    '001234567890' + String(i).padStart(6, '0'), '00012345' + String(i).padStart(5, '0'), Date.now(), 'ผู้ทดสอบ');
}
DB.db.prepare('INSERT INTO barcode_cats(cat) VALUES(?)').run('03 หมวดว่าง');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' };
const browser = await chromium.launch({ headless: true, downloadsPath: preview, ...(process.env.PLAYWRIGHT_CHROME_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'th-TH', timezoneId: 'Asia/Bangkok', acceptDownloads: true });
await context.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.origin !== 'https://barcode.test') { await route.abort(); return; }
  if (url.pathname === '/api') {
    const response = await mod.default.fetch(new Request(req.url(), { method: req.method(), headers: req.headers(), body: req.method() === 'POST' ? req.postDataBuffer() : undefined }), { DB }, {});
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) }); return;
  }
  const file = resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + sep)) { await route.fulfill({ status: 403 }); return; }
  try {
    let bytes = await readFile(file);
    if (extname(file) === '.html') bytes = Buffer.from(bytes.toString().replace('<head>', '<head><script>window.API_URL=location.origin+"/api";</script>'));
    await route.fulfill({ contentType: mime[extname(file)] || 'application/octet-stream', body: bytes });
  } catch { await route.fulfill({ status: 404 }); }
});
await context.addInitScript(() => {
  sessionStorage.setItem('pm_tok', 'seed');
  // Capture the exact download bytes for environments that block browser filesystem downloads.
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = blob => {
    if (blob.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') window.__excelBlob = blob;
    return create(blob);
  };
});
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(20000);
page.on('pageerror', e => errors.push(e.message));
async function download(selector, name) {
  const pending = page.waitForEvent('download'); await page.locator(selector).click();
  const file = await pending; assert.match(file.suggestedFilename(), /รายการบาร์_.*\.xlsx$/);
  const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await window.__excelBlob.arrayBuffer()))));
  await writeFile(resolve(preview, name + '.xlsx'), bytes);
  return XLSX.read(bytes, { type: 'buffer' });
}
try {
  await page.goto('https://barcode.test/index.html');
  await page.locator('body.v16-authenticated').waitFor();
  const summary = page.locator('.v16-profile .v16-account-menu > summary');
  assert.equal(await summary.innerText(), ''); assert.equal(await summary.getAttribute('title'), null);
  const dots = await summary.locator('circle').evaluateAll(nodes => nodes.map(n => [n.getAttribute('cx'), n.getAttribute('cy')]));
  assert.deepEqual(dots, [['12', '5'], ['12', '12'], ['12', '19']]);
  const b = await summary.boundingBox(), name = await page.locator('#v16UserName').boundingBox();
  assert.ok(b.x > name.x + name.width - 1); assert.ok(Math.abs(b.y - name.y) < 30);
  await summary.click();
  await page.locator('.v16-account-menu[open]').waitFor();
  const panel = await page.locator('.v16-account-menu > .v16-more-panel').boundingBox();
  assert.ok(panel.x >= 0 && panel.y >= 0 && panel.y + panel.height < b.y);
  await page.screenshot({ path: resolve(preview, 'desktop-menu.png') });
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.v16-account-menu[open]').count(), 0);
  console.log('PASS vertical icon next to username; menu opens upward and Escape restores focus');

  await page.goto('https://barcode.test/barcode.html');
  await page.locator('body.v16-authenticated').waitFor();
  await page.waitForFunction(() => S.data && S.data.rows.length === 77);
  await page.locator('[data-t="manage"]').click();
  const combined = await download('#bcExpBtn', 'combined');
  assert.deepEqual(combined.SheetNames, ['บาร์สินค้า']);
  assert.equal(combined.Sheets['บาร์สินค้า'].F7.v, '001234567890000000');
  assert.equal(combined.Sheets['บาร์สินค้า'].B7.v, '0008');
  assert.equal(combined.Sheets['บาร์สินค้า'].A83.v, 77);
  await page.locator('#bcExpSheetMode').selectOption('split');
  const split = await download('#bcExpBtn', 'split');
  assert.deepEqual(split.SheetNames, ['01 เครื่องดื่ม', '02 นม']);
  assert.equal(split.Sheets['02 นม'].A7.v, 1); assert.equal(split.Sheets['02 นม'].A8.v, 2);
  console.log('PASS combined and separate sheets download correctly with all 77 rows and text identifiers');

  await page.locator('[data-t="print"]').click();
  await page.locator('#btnPrintExcel').click();
  assert.match(await page.locator('#toast').innerText(), /เลือกหมวด/);
  await page.locator('#pAll').check();
  await page.locator('.ppchk[value="0007"]').check();
  const filtered = await download('#btnPrintExcel', 'selected-partner');
  assert.equal(filtered.SheetNames.length, 3);
  for (const sheetName of ['01 เครื่องดื่ม', '02 นม']) {
    const ws = filtered.Sheets[sheetName];
    for (const [ref, cell] of Object.entries(ws)) if (/^B\d+$/.test(ref) && Number(ref.slice(1)) >= 7 && cell.v) assert.equal(cell.v, '0007');
  }
  assert.equal(filtered.Sheets['03 หมวดว่าง'].A7.v, 'ไม่มีรายการ');
  await page.screenshot({ path: resolve(preview, 'print-controls.png') });
  console.log('PASS print-tab export uses selected categories and partner filters, including empty categories');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { clearTimeout(toastTimer); document.querySelector('#toast').className = ''; });
  await page.locator('#v16MobileMenu').click();
  await page.locator('.v16-profile summary').click();
  const mobilePanel = await page.locator('.v16-account-menu > .v16-more-panel').boundingBox();
  assert.ok(mobilePanel.x >= 0 && mobilePanel.x + mobilePanel.width <= 390 && mobilePanel.y >= 0);
  await page.screenshot({ path: resolve(preview, 'mobile-menu.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.v16-account-menu[open]').count(), 0);
  assert.equal(await page.locator('body.v16-nav-open').count(), 1);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.v16-sidebar-close').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('body.v16-nav-open').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS mobile menu stays on screen, keyboard focus remains inside sidebar, no browser errors');
} finally { await browser.close(); DB.db.close(); }
