import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import XLSX from '../../assets/vendor/xlsx.full.min.js';
import { unzip } from './market-fixtures.mjs';
import { API, SCHEMA } from '../index.js';
import { D1 } from './d1.mjs';

async function fixture() {
  const DB = new D1(); await DB.install(SCHEMA);
  DB.db.prepare('INSERT INTO users(username,role,name,perms) VALUES(?,?,?,?)').run('demo', 'admin', 'ผู้ทดสอบ', '{}');
  DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run('token', 'demo', Date.now() + 86400000);
  const C = { env: { DB } };
  const schema = (await API.getInit(C, 'token')).schemas.bar;
  const c = vm.createContext({ TextEncoder, Uint8Array, Uint32Array, DataView, ArrayBuffer, Response, CompressionStream });
  vm.runInContext(await readFile(new URL('../../assets/js/pages/barcode-export.js', import.meta.url), 'utf8'), c);
  const values = [1, '0007', '01', '=ชื่อสินค้า <ทดสอบ> & น้ำดื่ม', '12', '00123456789012345678', '', '0001234567890', '', '', ''];
  const report = { name: '01', top: { company: 'ร้านสหกรณ์ มหาวิทยาลัยเชียงใหม่ จำกัด', hand: 'ชื่อ ......................        วันที่ ......................', status: 'ข้อมูลอัพเดตล่าสุดวันที่ 30/10/2569 เวลา 14:30 น.', title: 'รายการบาร์เดี่ยว/บาร์แพ็ค | หมวด 01' },
    groups: schema.groups, cols: schema.cols.map(k => ({ k, w: k.w * 2, header: k.label.replace(/^จำนวน/, 'จำนวน\n').replace('รหัสคู่ค้า', 'รหัส\nคู่ค้า') })), rows: [{ v: values, height: 28 }] };
  return { c, C, report, values };
}

test('barcode report preserves all print columns, text identifiers and importable data', async () => {
  const { c, C, report, values } = await fixture();
  const bytes = await c.bcXlBuild([report], { font: 'Sarabun', printedAt: '30/10/2569 เวลา 14:30 น.' });
  const wb = XLSX.read(bytes, { type: 'array', cellStyles: true }), ws = wb.Sheets['01'];
  assert.equal(ws.A7.v, 1); assert.equal(ws.A7.t, 'n');
  for (const [j, col] of [[1, 'B'], [2, 'C'], [3, 'D'], [5, 'F'], [7, 'H']]) {
    assert.equal(ws[col + '7'].v, values[j]); assert.equal(ws[col + '7'].t, 's');
  }
  assert.equal(ws.D7.f, undefined, 'names starting with = remain text');
  for (const col of ['G', 'I', 'J', 'K']) assert.ok(!ws[col + '7'] || !ws[col + '7'].v);
  assert.equal(ws.K6.v, 'ของเดิม');
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const result = await API.importBarcodeData(C, 'token', [{ name: '01', grid }], 'replace');
  assert.equal(result.count, 1);
  const d = await API.getCategoryData(C, 'token', '', '*');
  assert.equal(d.rows[0].v[1], '0007'); assert.equal(d.rows[0].v[2], '01');
  assert.equal(d.rows[0].v[5], values[5]); assert.equal(d.rows[0].v[7], values[7]);
});

test('barcode report has print styling, merged headings and A4 repeating table headers', async () => {
  const { c, report } = await fixture();
  report.rows.push({ v: [...report.rows[0].v], height: 20 });
  const files = unzip(await c.bcXlBuild([report], { font: 'Sarabun', printedAt: '30/10/2569' }));
  const sheet = files['xl/worksheets/sheet1.xml'], wb = files['xl/workbook.xml'], styles = files['xl/styles.xml'];
  assert.match(sheet, /mergeCell ref="A5:I5"/); assert.match(sheet, /mergeCell ref="J5:K5"/);
  assert.match(sheet, /paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/);
  assert.match(sheet, /showGridLines="0"/); assert.match(sheet, /ySplit="6"/);
  assert.match(sheet, /<c r="D7" s="7"/); assert.match(sheet, /<c r="D8" s="8"/);
  assert.match(sheet, /<oddFooter>.*พิมพ์เมื่อ.*&amp;P/);
  assert.match(wb, /_xlnm.Print_Titles[^>]*>&apos;01&apos;!\$5:\$6/);
  assert.match(wb, /_xlnm.Print_Area[^>]*>&apos;01&apos;!\$A\$1:\$K\$8/);
  assert.match(styles, /name val="Sarabun"/); assert.match(styles, /FFD0D0D0/); assert.match(styles, /FFECECEC/);
  const count = Number(/cellXfs count="(\d+)"/.exec(styles)[1]);
  for (const match of sheet.matchAll(/<c [^>]*s="(\d+)"/g)) assert.ok(Number(match[1]) < count);
});

test('barcode report handles empty categories, duplicate sheet names and ZIP fallback', async () => {
  const { c, report } = await fixture();
  c.CompressionStream = undefined;
  const empty = { ...report, name: "'A/B'", rows: [] };
  const bytes = await c.bcXlBuild([empty, { ...empty, name: 'a_b' }, { ...empty, name: '__proto__' }]);
  const wb = XLSX.read(bytes, { type: 'array' });
  assert.deepEqual(wb.SheetNames, ['A_B', 'a_b_2', '__proto__']);
  assert.equal(wb.Sheets.A_B.A7.v, 'ไม่มีรายการ');
  assert.equal(wb.Sheets.A_B.A9.v, 'พิมพ์เมื่อ ');
  await assert.rejects(c.bcXlBuild([]), /ไม่มีหมวด/);
});

test('barcode report exports 20,000 rows without truncating identifiers or the final row', async () => {
  const { c, report } = await fixture();
  report.rows = Array.from({ length: 20000 }, (_, i) => ({ v: [i + 1, '0007', '01', 'สินค้า ' + (i + 1), '12', '001234567890' + String(i).padStart(6, '0'), '', '00012345' + String(i).padStart(5, '0'), '', '', ''], height: 20 }));
  const wb = XLSX.read(await c.bcXlBuild([report]), { type: 'array' }), ws = wb.Sheets['01'];
  assert.equal(ws.A20006.v, 20000); assert.equal(ws.F20006.v, '001234567890019999');
  assert.equal(ws.H20006.v, '0001234519999');
  assert.equal(ws['!ref'], 'A1:K20008');
});
