/* ============================ ตัวช่วย ============================ */
var $ = function (s) { return document.querySelector(s); };
var esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
};
function call(fn) {
  var args = Array.prototype.slice.call(arguments, 1);
  if (fn !== 'login' && fn !== 'recoverAdmin' && fn !== 'loginByLink') args.unshift(S.token);
  return new Promise(function (res, rej) {
    var r = google.script.run.withSuccessHandler(res).withFailureHandler(function (e) {
      var msg = (e && e.message) || String(e);
      if (/SESSION_EXPIRED/.test(msg)) {
        msg = 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง';
        showLogin(msg);
      }
      rej(new Error(msg));
    });
    r[fn].apply(r, args);
  });
}
var toastTimer;
function toast(msg, isErr) {
  var t = $('#toast');
  t.setAttribute('role', isErr ? 'alert' : 'status');
  t.setAttribute('aria-live', isErr ? 'assertive' : 'polite');
  t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.className = ''; }, isErr ? 10000 : 6000);
}
/* ปิดปุ่มระหว่างรอ + แสดงข้อผิดพลาดเป็น toast */
async function busy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
}
function copyField(sel, msg) {
  var el = $(sel); el.focus(); el.select();
  try { document.execCommand('copy'); toast(msg); } catch (e) { toast('คัดลอกไม่สำเร็จ กรุณาคัดลอกเอง', true); }
}
/* แสดงวันที่แบบ พ.ศ. เหมือนในชีต */
function pad2(n) { return String(n).padStart(2, '0'); }
function thDate(ts) {
  var d = new Date(ts + 7 * 3600000);
  return pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1) + '/' + (d.getUTCFullYear() + 543);
}
function thTime(ts) {
  var d = new Date(ts + 7 * 3600000);
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}
function fmt(ts) { return thDate(ts) + ' เวลา ' + thTime(ts) + ' น.'; }


/* ============================ สถานะ ============================ */
var S = { cats: [], sheets: {}, schemas: {}, cur: null, data: null, overall: null, offset: 0, saving: 0, token: '', me: null };
(function initToken() {
  var m = (location.hash || '').match(/[#&]t=([^&]+)/);
  if (m) {
    try { S.token = decodeURIComponent(m[1]); sessionStorage.setItem('pm_tok', S.token); } catch (e) {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  } else {
    try { S.token = sessionStorage.getItem('pm_tok') || ''; } catch (e) {}
  }
  if (S.token) {
    try { var cm = sessionStorage.getItem('pm_me'); if (cm) S.me = JSON.parse(cm); } catch (e) {}
  }
})();

var USE_LAST = {};
function logUse(area, action, detail) {
  if (!S.token) return;
  var k = area + '|' + action + '|' + (detail || ''), t = Date.now();
  if (USE_LAST[k] && t - USE_LAST[k] < 1500) return;
  USE_LAST[k] = t;
  try { google.script.run.withFailureHandler(function () {}).logUse(S.token, area, action, detail || ''); } catch (e) {}
}

function thaiDayIso(ts) {
  var date = new Date(ts == null ? Date.now() : ts);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    var obj = {};
    parts.forEach(function (part) { obj[part.type] = part.value; });
    return obj.year + '-' + obj.month + '-' + obj.day;
  } catch (e) {
    return new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  }
}
function nowMs() { return Date.now() + S.offset; }
function fresh(l) {
  if (!l) return { cls: 'none', rel: '' };
  var m = Math.floor((nowMs() - l.ts) / 60000);
  var rel = m < 1 ? 'เมื่อสักครู่' : m < 60 ? m + ' นาทีที่แล้ว' : m < 1440 ? Math.floor(m / 60) + ' ชั่วโมงที่แล้ว' : Math.floor(m / 1440) + ' วันที่แล้ว';
  return { cls: m < 1440 ? 'ok' : m < 10080 ? 'warn' : 'old', rel: rel };
}
function schemaOfCat(c) { return S.schemas[S.sheets[c.sheet].schema]; }
function allCat() {                                // หมวดเสมือน "ทั้งหมด" (ทุกหมวดในชีตหลัก) ใช้เป็นค่าเริ่มต้นก่อนเลือกหมวด
  var sh = (S.cats[0] && S.cats[0].sheet) || Object.keys(S.sheets || {})[0] || '';
  return { key: sh + '|*', sheet: sh, cat: '', label: 'ทั้งหมด', all: true };
}
function curCat() {
  var a = allCat();
  if (S.cur === a.key) return a;
  return S.cats.filter(function (c) { return c.key === S.cur; })[0];
}

function renderStatus() { /* เอาแถบสถานะการอัพเดตออกแล้ว (ประวัติทั้งหมดอยู่ที่ ตั้งค่า > ประวัติการใช้งาน) */ }
function withSaving(p) {
  S.saving++; renderStatus();
  return p.then(function (r) { S.saving--; renderStatus(); return r; },
                function (e) { S.saving--; renderStatus(); throw e; });
}

/* ============================ รายการหมวด (ซ้าย) ============================ */
function renderSide() {
  var html = '', lastSheet = null;
  S.cats.forEach(function (c) {
    if (c.sheet !== lastSheet) {
      if (lastSheet !== null) html += '</ul>';
      html += '<div class="gh">' + esc(c.sheet) + '<small>' + esc(S.sheets[c.sheet].statusText || 'ไม่มีข้อความสถานะ') + '</small></div><ul class="cats">';
      lastSheet = c.sheet;
    }
    var f = fresh(c.last);
    html += '<li><button type="button" class="cat ' + (c.key === S.cur ? 'on' : '') + '" data-k="' + esc(c.key) + '" aria-pressed="' + (c.key === S.cur ? 'true' : 'false') + '">' +
      '<span class="dot ' + f.cls + '"></span><span class="cn">' + esc(c.label) + '</span>' +
      '<span class="cm">' + c.items + ' รายการ' + '</span>' +
      '<span class="cm">' + (c.last ? 'อัพเดต ' + f.rel : 'ยังไม่มีข้อมูลสถานะ') + '</span></button></li>';
  });
  $('#catSide').innerHTML = html + (lastSheet !== null ? '</ul>' : '') || '<div class="muted">ไม่พบชีตข้อมูล</div>';
  if (window.WorkspaceUI) WorkspaceUI.barcodeStats();
}
$('#btnNewCat').addEventListener('click', async function () {
  var name = (prompt('ชื่อหมวดใหม่ (เช่น ขนม, นม, บะหมี่)') || '').trim();
  if (!name) return;
  try {
    var r = await withSaving(call('createCategory', name));
    toast('สร้างหมวดแล้ว: ' + name);
    await refreshCats();
    await selectCat(r.key);
  } catch (e) { toast(e.message, true); }
});
$('#catSide').addEventListener('click', function (e) {
  var b = e.target.closest('.cat'); if (b) selectCat(b.dataset.k);
});
async function refreshCats() {
  var r = await call('getInit');
  S.cats = r.categories; S.sheets = r.sheets; S.schemas = r.schemas; S.overall = r.overall;
  S.offset = r.now - Date.now();
  renderSide(); renderStatus(); renderPrintList(); pfRender(r.printFont, r.printFonts);
}

/* ============================ เลือกหมวด / ตาราง ============================ */
var categoryLoadId = 0;
async function selectCat(key) {
  var c = key === allCat().key ? allCat() : S.cats.filter(function (x) { return x.key === key; })[0];
  if (!c) return;
  var loadId = ++categoryLoadId, token = S.token;
  S.cur = key; S.data = null; renderSide();
  $('#btnAdd').disabled = true; $('#count').textContent = '';
  $('#addForm').innerHTML = '';
  closeEdit();
  $('#dTitle').textContent = c.sheet + (c.all ? ' / ทั้งหมด' : c.cat ? ' / ' + c.label : '');
  $('#tbody').innerHTML = '<tr><td class="empty" colspan="12">กำลังโหลด…</td></tr>';
  var data;
  try { data = await call('getCategoryData', c.sheet, c.all ? '*' : c.cat); }
  catch (e) {
    if (loadId === categoryLoadId && token === S.token) {
      $('#tbody').innerHTML = '<tr><td class="empty" colspan="12">โหลดข้อมูลไม่สำเร็จ กรุณากดรีเฟรชเพื่อลองอีกครั้ง</td></tr>';
      toast(e.message, true);
    }
    return;
  }
  if (loadId !== categoryLoadId || token !== S.token || !S.me) return;
  S.data = data; S.tablePage = 0;
  var sc = schemaOfCat(c);
  buildForm(sc, c);
  buildHead(sc);
  $('#btnAdd').disabled = false;
  renderCurStatus(); renderTable();
}
function renderCurStatus() {}
function buildHead(sc) {
  $('#thead').innerHTML = '<tr>' + sc.cols.map(function (c) { return '<th data-col="'+esc(c.k)+'">' + esc(c.label) + '</th>'; }).join('') + '<th>จัดการ</th></tr>';
}
function rowHtml(sc, x) {
  return '<tr data-r="' + x.r + '" data-n="' + esc(x.v[sc.nameCol - 1]) + '">' + sc.cols.map(function (c, j) {
    var cls = c.num ? 'n' : c.text ? 'code' : c.k === 'name' ? 'nm' : '';
    return '<td data-col="'+esc(c.k)+'" class="' + cls + '">' + esc(x.v[j]) + '</td>';
  }).join('') + '<td class="act"><button class="btn ghost small" data-a="edit">แก้ไข</button><button class="btn danger small" data-a="del">ลบ</button></td></tr>';
}
var BC_TABLE_PAGE = 200, bcSearchTimer = null;
function renderTable() {
  if (!S.data) return;
  var c = curCat(), sc = schemaOfCat(c);
  var q = $('#q').value.trim().toLowerCase();
  var rows = S.data.rows.filter(function (x) { return !q || x.v.join(' ').toLowerCase().indexOf(q) >= 0; });
  var pages = Math.max(1, Math.ceil(rows.length / BC_TABLE_PAGE));
  S.tablePage = Math.max(0, Math.min(S.tablePage || 0, pages - 1));
  var start = S.tablePage * BC_TABLE_PAGE, visible = rows.slice(start, start + BC_TABLE_PAGE);
  $('#count').textContent = 'แสดง ' + (rows.length ? start + 1 : 0) + '–' + (start + visible.length) + ' จาก ' + rows.length + ' รายการ (ทั้งหมด ' + S.data.rows.length + ')';
  $('#bcPageInfo').textContent = 'หน้า ' + (S.tablePage + 1) + ' / ' + pages;
  $('#bcPrevPage').disabled = S.tablePage === 0;
  $('#bcNextPage').disabled = S.tablePage >= pages - 1;
  if (window.WorkspaceUI) WorkspaceUI.barcodeStats();
  $('#tbody').innerHTML = visible.map(function (x) { return rowHtml(sc, x); }).join('') ||
    '<tr><td class="empty" colspan="' + (sc.cols.length + 1) + '">ไม่พบรายการ</td></tr>';
}
$('#q').addEventListener('input', function () { S.tablePage = 0; clearTimeout(bcSearchTimer); bcSearchTimer = setTimeout(renderTable, 150); });
$('#bcPrevPage').addEventListener('click', function () { S.tablePage--; renderTable(); });
$('#bcNextPage').addEventListener('click', function () { S.tablePage++; renderTable(); });

/* ============================ แก้ไข / ลบรายการ (Admin) ============================ */
var editing = null;
$('#tbody').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-a]'); if (!b) return;
  var tr = b.closest('tr'), c = curCat(); if (!c || !S.data) return;
  var item = S.data.rows.filter(function (x) { return x.r === Number(tr.dataset.r); })[0];
  if (!item) return;
  if (b.dataset.a === 'edit') openEdit(c, item); else delItem(c, item);
});
function openEdit(c, item) {
  var sc = schemaOfCat(c);
  editing = { c: c, item: item, oldName: item.v[sc.nameCol - 1] };
  $('#eTitle').textContent = 'แก้ไขรายการ: ' + editing.oldName;
  $('#eForm').innerHTML = sc.cols.map(function (k, j) {
    if (k.calc || k.edit) return '';
    return '<label class="' + (k.k === 'name' ? 'wide' : '') + '">' + esc(k.label) +
      '<input type="text" data-k="' + k.k + '" autocomplete="off" value="' + esc(item.v[j]) + '"' +
      (k.k === 'cat' ? ' list="dlCats"' : '') + (k.text ? ' inputmode="numeric"' : '') + '></label>';
  }).join('');
  $('#editModal').classList.remove('hidden');
  $('#eBc').innerHTML = '';
  var f = $('#eForm input[data-k="name"]'); if (f) f.focus();
}
function closeEdit() { $('#editModal').classList.add('hidden'); editing = null; $('#eBc').innerHTML = ''; }
async function saveEdit(force) {
  if (!editing) return;
  var c = editing.c, vals = {};
  document.querySelectorAll('#eForm input').forEach(function (i) { vals[i.dataset.k] = i.value.trim(); });
  if (!vals.name) { toast('กรุณากรอกชื่อรายการ', true); return; }
  $('#eSave').disabled = true;
  try {
    var r = await withSaving(call('editItem', c.sheet, editing.item.r, editing.oldName, vals, !!force, editing.item.revision));
    if (r.duplicate) {
      $('#eSave').disabled = false;
      if (confirm(r.message + '\nต้องการบันทึกซ้ำหรือไม่?')) return saveEdit(true);
      return;
    }
    var name = vals.name;
    closeEdit();
    toast(r.nochange ? 'ไม่มีการเปลี่ยนแปลง' : 'แก้ไขแล้ว: ' + name);
    await refreshCats();
    var key = c.sheet + '|' + (r.cat !== undefined && c.cat !== '' ? r.cat : c.cat);
    await selectCat(!c.all && S.cats.some(function (x) { return x.key === key; }) ? key : c.key);
  } catch (e) { toast(e.message, true); }
  $('#eSave').disabled = false;
}
async function delItem(c, item) {
  var sc = schemaOfCat(c), name = item.v[sc.nameCol - 1];
  if (!confirm('ลบรายการนี้ออกจากชีตถาวร?\n\n' + name + '\n\n(ลบแล้วกู้คืนจากระบบไม่ได้)')) return;
  try {
    await withSaving(call('deleteItem', c.sheet, item.r, name, item.revision));
    toast('ลบแล้ว: ' + name);
    await refreshCats();
    await selectCat(c.all || S.cats.some(function (x) { return x.key === c.key; }) ? c.key : (S.cats[0] ? S.cats[0].key : allCat().key));
  } catch (e) { toast(e.message, true); }
}
$('#eSave').addEventListener('click', function () { saveEdit(false); });
$('#eCancel').addEventListener('click', closeEdit);
$('#eForm').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveEdit(false); }
});

/* ============================ ค้นหาเลขบาร์ในระบบระหว่างกรอก ============================ */
var bcSeq = { add: 0, edit: 0 }, bcTimer = { add: null, edit: null };
function bcCheck(mode) {
  var form = mode === 'add' ? '#addForm' : '#eForm', box = $(mode === 'add' ? '#addBc' : '#eBc');
  var fields = [['packBar', 'เลขบาร์แพ็ค'], ['unitBar', 'เลขบาร์เดี่ยว']].map(function (f) {
    var i = document.querySelector(form + ' input[data-k="' + f[0] + '"]');
    return { label: f[1], code: i ? i.value.trim() : '' };
  }).filter(function (f) { return f.code.length >= 5; });
  var seq = ++bcSeq[mode];
  if (!fields.length) { box.innerHTML = ''; return; }
  var ex = mode === 'edit' && editing ? [editing.c.sheet, editing.item.r] : ['', 0];
  Promise.all(fields.map(function (f) {
    return call('findBarcode', f.code, ex[0], ex[1]).then(function (r) { return { f: f, r: r }; });
  })).then(function (all) {
    if (seq !== bcSeq[mode]) return;                      // ผลเก่า ข้าม
    box.innerHTML = all.map(function (x) {
      if (!x.r.length) return '<div class="good">' + esc(x.f.label) + ' ' + esc(x.f.code) + ': ไม่พบในระบบ ใช้ได้</div>';
      return x.r.map(function (m) {
        return '<div class="bad">' + esc(x.f.label) + ' ' + esc(x.f.code) + ' มีในระบบแล้ว (' + esc(m.field) + '): ' + esc(m.name) +
          ' [' + esc(m.sheet) + (m.cat ? ' / ' + esc(m.cat) : '') + '] <a href="#" data-go="1" data-s="' + esc(m.sheet) + '" data-c="' + esc(m.cat) + '" data-r="' + m.row + '">ไปที่รายการ</a></div>';
      }).join('');
    }).join('');
  }).catch(function () { if (seq === bcSeq[mode]) box.innerHTML = ''; });
}
function bcSchedule(mode, e) {
  if (!e.target || (e.target.dataset.k !== 'packBar' && e.target.dataset.k !== 'unitBar')) return;
  clearTimeout(bcTimer[mode]);
  bcTimer[mode] = setTimeout(function () { bcCheck(mode); }, 450);
}
$('#addForm').addEventListener('input', function (e) { bcSchedule('add', e); });
$('#eForm').addEventListener('input', function (e) { bcSchedule('edit', e); });
document.addEventListener('click', async function (e) {
  var a = e.target.closest('a[data-go]'); if (!a) return;
  e.preventDefault();
  var key = a.dataset.s + '|' + a.dataset.c;
  closeEdit();
  $('#q').value = '';
  try {
    await selectCat(key);
    var tr = document.querySelector('#tbody tr[data-r="' + a.dataset.r + '"]');
    if (tr) { tr.scrollIntoView({ block: 'center' }); tr.classList.add('flash'); }
  } catch (err) { toast(err.message, true); }
});

/* ============================ เพิ่มรายการ ============================ */
function buildForm(sc, c) {
  var cats = S.cats.filter(function (x) { return x.sheet === c.sheet && x.cat; }).map(function (x) { return x.cat; });
  $('#dlCats').innerHTML = cats.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('');
  var keep = {};
  document.querySelectorAll('#addForm input').forEach(function (i) { keep[i.dataset.k] = i.value; });
  $('#addForm').innerHTML = sc.cols.filter(function (k) { return !k.calc && !k.edit; }).map(function (k) {
    var val = k.k === 'cat' ? c.cat : (keep[k.k] || '');
    if (k.k === 'cat') {                        // ช่องหมวด = เลือกจากรายการหมวดของชีตนี้ (เลือกแล้วสลับตารางไปหมวดนั้นด้วย) หรือเลือก "สร้างหมวดใหม่" แล้วพิมพ์เอง
      return '<label>' + esc(k.label) +
        '<select id="addCatSel"><option value="__all"' + (c.all ? ' selected' : '') + '>ทั้งหมด</option>' +
        cats.map(function (x) { return '<option value="' + esc(x) + '"' + (x === c.cat ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
        '<option value="__new">＋ สร้างหมวดใหม่…</option></select>' +
        '<input type="text" class="hidden" id="addCatNew" data-k="cat" autocomplete="off" placeholder="พิมพ์ชื่อหมวดใหม่" value="' + esc(val) + '" style="margin-top:6px"></label>';
    }
    return '<label class="' + (k.k === 'name' ? 'wide' : '') + '">' + esc(k.label) +
      '<input type="text" data-k="' + k.k + '" autocomplete="off" value="' + esc(val) + '"' +
      (k.text ? ' inputmode="numeric"' : '') + '></label>';
  }).join('');
  $('#addHint').textContent = 'รายการใหม่จะแทรกต่อจากรายการของคู่ค้า/หมวดเดียวกันในชีต เลือกหมวดจากช่อง "หมวด" หรือเลือก "สร้างหมวดใหม่" เพื่อตั้งชื่อหมวดใหม่';
}
async function addItem(force) {
  var c = curCat(); if (!c) return;
  var item = {};
  document.querySelectorAll('#addForm input').forEach(function (i) { item[i.dataset.k] = i.value.trim(); });
  if (!item.name) { toast('กรุณากรอกชื่อรายการ', true); return; }
  if (c.all && !item.cat) { toast('กรุณาเลือกหมวดก่อนเพิ่มรายการ', true); return; }
  $('#btnAdd').disabled = true;
  try {
    var r = await withSaving(call('addItem', c.sheet, c.cat, item, !!force));
    if (r.duplicate) {
      $('#btnAdd').disabled = false;
      if (confirm(r.message + '\nต้องการเพิ่มซ้ำหรือไม่?')) return addItem(true);
      return;
    }
    toast('เพิ่มแล้ว: ' + item.name);
    $('#addBc').innerHTML = '';
    document.querySelectorAll('#addForm input').forEach(function (i) {      // เก็บรหัสคู่ค้า/หมวดไว้กรอกต่อ
      if (i.dataset.k !== 'partner' && i.dataset.k !== 'cat') i.value = '';
    });
    $('#q').value = '';
    await refreshCats();
    await selectCat(c.sheet + '|' + r.cat);
    var tr = document.querySelector('#tbody tr[data-r="' + r.row + '"]');
    if (tr) { tr.scrollIntoView({ block: 'center' }); tr.classList.add('flash'); }
    var first = document.querySelector('#addForm input[data-k="name"]'); if (first) first.focus();
  } catch (e) { toast(e.message, true); }
  $('#btnAdd').disabled = false;
}
$('#addForm').addEventListener('change', function (e) {
  if (e.target.id !== 'addCatSel') return;
  var v = e.target.value, inp = $('#addCatNew'), c = curCat();
  if (v === '__new') { inp.value = ''; inp.classList.remove('hidden'); inp.focus(); return; }
  if (v === '__all') { inp.classList.add('hidden'); inp.value = ''; if (c && !c.all) selectCat(allCat().key); return; }
  inp.classList.add('hidden'); inp.value = v;
  if (v && c && v !== c.cat) selectCat(c.sheet + '|' + v);          // เลือกหมวดแล้วสลับตารางไปหมวดนั้น (ข้อมูลที่กรอกค้างไว้คงเดิม)
});
$('#btnAdd').addEventListener('click', function () { addItem(false); });
$('#addForm').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); addItem(false); }
});

/* ============================ ปริ้น ============================ */
function checkedCatKeys() {
  return Array.prototype.map.call(document.querySelectorAll('.pchk:checked'), function (x) { return x.value; });
}
function renderPrintList() {
  var checked = {};
  document.querySelectorAll('.pchk:checked').forEach(function (x) { checked[x.value] = true; });
  var html = '', lastSheet = null;
  S.cats.forEach(function (c) {
    if (c.sheet !== lastSheet) {
      html += '<label class="pgroup"><input type="checkbox" class="pgrp" data-s="' + esc(c.sheet) + '"> ' + esc(c.sheet) + '</label>';
      lastSheet = c.sheet;
    }
    html += '<label class="pitem"><input type="checkbox" class="pchk" data-s="' + esc(c.sheet) + '" value="' + esc(c.key) + '"' +
      (checked[c.key] ? ' checked' : '') + '><span><b>' + esc(c.label) + '</b> <span class="muted">' + c.items + ' รายการ' +
      (c.last && S.me && S.me.role === 'admin' ? ' | อัพเดต ' + fmt(c.last.ts) : '') + '</span></span></label>';
  });
  $('#pList').innerHTML = html;
  renderPartners();
}
var pSel = {};
function renderPartners() {
  var keys = checkedCatKeys();
  var cats = S.cats.filter(function (c) { return !keys.length || keys.indexOf(c.key) >= 0; });
  var tot = {};
  cats.forEach(function (c) { Object.keys(c.partners || {}).forEach(function (p) { tot[p] = (tot[p] || 0) + c.partners[p]; }); });
  var list = Object.keys(tot).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
  $('#pPartners').innerHTML = list.map(function (p) {
    return '<label class="pitem"><input type="checkbox" class="ppchk" value="' + esc(p) + '"' + (pSel[p] ? ' checked' : '') + '><span><b>' + esc(p) +
      '</b> <span class="muted">' + tot[p] + ' รายการ</span></span></label>';
  }).join('') || '<div class="muted">ไม่มีรหัสคู่ค้า</div>';
}
function selectedPartners() {
  return Array.prototype.map.call(document.querySelectorAll('.ppchk:checked'), function (x) { return x.value; });
}
$('#pPartners').addEventListener('change', function (e) { var i = e.target.closest('.ppchk'); if (i) pSel[i.value] = i.checked; });
$('#pPartnerClear').addEventListener('click', function () { pSel = {}; renderPartners(); });
$('#pList').addEventListener('change', function (e) {
  var g = e.target.closest('.pgrp');
  if (g) {
    document.querySelectorAll('.pchk').forEach(function (x) { if (x.dataset.s === g.dataset.s) x.checked = g.checked; });
    renderPartners();
  } else if (e.target.closest('.pchk')) renderPartners();
});
$('#pAll').addEventListener('change', function () {
  var on = this.checked;
  document.querySelectorAll('.pchk,.pgrp').forEach(function (x) { x.checked = on; });
  renderPartners();
});

function headLbl(t) {
  var m = /^(จำนวน(?:ใน|ต่อ)?)\s*(.+)$/.exec(String(t));
  return m ? esc(m[1]) + '<br>' + esc(m[2]) : esc(t);
}
function headRows(sc) {
  var grp = {}, done = {}, r1 = '', r2 = '';
  sc.groups.forEach(function (g) { for (var i = g.from; i <= g.to; i++) grp[i] = g; });
  sc.cols.forEach(function (c, j) {
    var g = grp[j + 1];
    if (!g) { r1 += '<th rowspan="2">' + headLbl(c.label) + '</th>'; return; }
    if (!done[g.label]) { r1 += '<th colspan="' + (g.to - g.from + 1) + '">' + esc(g.label) + '</th>'; done[g.label] = 1; }
    r2 += '<th>' + headLbl(c.label) + '</th>';
  });
  return '<tr>' + r1 + '</tr><tr>' + r2 + '</tr>';
}
function printSection(d) {
  var c = S.cats.filter(function (x) { return x.sheet === d.sheet && x.cat === d.cat; })[0];
  var sc = schemaOfCat(c), n = sc.cols.length, h = d.header;
  var chosen = selectedPartners(), ip = sc.cols.map(function (k) { return k.k; }).indexOf('partner');
  var rows = d.rows.filter(function (x) {
    return !(chosen.length && chosen.indexOf(String(x.v[ip]).trim()) < 0);
  });
  var body = rows.map(function (x) {
    return '<tr>' + x.v.map(function (v, j) { return '<td class="' + (sc.cols[j].k === 'name' ? 'nm' : '') + (sc.cols[j].text ? ' bc' : '') + '">' + esc(v) + '</td>'; }).join('') + '</tr>';
  }).join('') || '<tr><td colspan="' + n + '" style="text-align:center">ไม่มีรายการ</td></tr>';
  var stx = String(h.statusText || '');
  if (stx && !/\d{1,2}:\d{2}/.test(stx) && d.last && d.last.ts) {   /* ข้อความในชีตยังไม่มีเวลา -> เติมเวลาจากบันทึกล่าสุด ถ้าเป็นวันเดียวกัน */
    if (stx.indexOf(thDate(d.last.ts)) >= 0) stx += ' เวลา ' + thTime(d.last.ts) + ' น.';
  }
  var top = '<div class="ptop">' +
    (h.company ? '<div class="co">' + esc(coName(h.company)) + '</div>' : '') +
    '<div class="l">' + sc.handLines.map(function (t) { return esc(handLbl(t)); }).join('&emsp;&emsp;') + '</div>' +
    '<div class="l">' + esc(stx) + '</div>' +
    '<div class="l title">' + esc(h.title) + (d.cat ? ' | หมวด ' + esc(d.cat) : '') + '</div></div>';
  return '<section class="psec">' + top + '<table class="pt"><colgroup>' +
    sc.cols.map(function (k) { return '<col style="width:' + pw(k) + '%">'; }).join('') + '</colgroup><thead>' +
    headRows(sc) + '</thead><tbody>' + body + '</tbody></table>' +
    '<div class="foot">พิมพ์เมื่อ ' + fmt(nowMs()) + '</div></section>';
}
/* สร้าง PDF ที่เซิร์ฟเวอร์ (ไม่ขึ้นกับเบราว์เซอร์/ฟอนต์ของเครื่อง) แล้วเปิดเพื่อปริ้น */
var pdfUrl = '';
function pdfBlob(b64) {
  var bin = atob(b64), u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: 'application/pdf' });
}
function closePdf() { $('#pdfModal').classList.add('hidden'); if (pdfUrl) { URL.revokeObjectURL(pdfUrl); pdfUrl = ''; } }
$('#pdfClose').addEventListener('click', closePdf);
/* ============================ สร้าง PDF ในเบราว์เซอร์ (ไม่ต้องพึ่งเซิร์ฟเวอร์/ฟอนต์เครื่อง/ไลบรารีภายนอก) ============================
 * วาดแต่ละหน้า A4 ลง canvas (เบราว์เซอร์จัดวรรณยุกต์ไทยให้เอง) แล้วห่อเป็นไฟล์ PDF · หน้าตาเหมือนกันทุกเครื่อง */
var PW = { no: 5, partner: 7.5, cat: 6, name: 19, perPack: 7, packBar: 14, qtyPack: 7.5, unitBar: 14, qtyUnit: 7.5, spread: 6.5, old: 6 };   /* สัดส่วนความกว้างคอลัมน์ (%) */
function pw(k) { return PW[k.k] || k.w; }
var PDF_FONT_TAIL = "'Bai Jamjuree','TH Sarabun New','THSarabunNew','TH SarabunPSK','Sarabun','Leelawadee UI','Tahoma','Noto Sans Thai',sans-serif";
var PRINT_FONT = 'Bai Jamjuree', PDF_FONT = "'Bai Jamjuree'," + PDF_FONT_TAIL;
var PDF_DPI = 200, PX = PDF_DPI / 25.4, PT = PDF_DPI / 72;   /* px ต่อ mm / px ต่อ pt */
var PDF_W = 210, PDF_H = 297, PDF_M = 2;   /* A4 แนวตั้ง */
var PDF_BODY = 10;                          /* ขนาดตัวอักษรในตาราง (pt) คงที่ ไม่ย่ออัตโนมัติ */
var PDF_TOP = 14;
var PDF_TIME = 10;                           /* ขนาดตัวอักษรนอกตาราง: ชื่อร้าน หัวเรื่อง ท้ายหน้า (pt) */
var _seg = null;
function thWords(s) {
  try { if (!_seg && window.Intl && Intl.Segmenter) _seg = new Intl.Segmenter('th', { granularity: 'word' }); } catch (e) {}
  if (_seg) return Array.from(_seg.segment(s), function (x) { return x.segment; });
  return String(s).split(/(\s+)/);
}
/* ตัดบรรทัดตามความกว้าง (px) — ตัดคำไทยได้ ถ้าคำเดียวยาวเกินช่องจะตัดกลางคำ */
function wrapText(ctx, text, maxW) {
  text = String(text == null ? '' : text);
  var lines = [], cur = '';
  thWords(text).forEach(function (w) {
    if (ctx.measureText(cur + w).width <= maxW) { cur += w; return; }
    if (cur.trim()) { lines.push(cur.trim()); cur = ''; }
    if (ctx.measureText(w).width <= maxW) { cur = w.replace(/^\s+/, ''); return; }
    Array.from(w).forEach(function (ch) {
      if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ''; }
      cur += ch;
    });
  });
  if (cur.trim()) lines.push(cur.trim());
  return lines.length ? lines : [''];
}
function pdfFont(ctx, pt, bold) { ctx.font = (bold ? '700 ' : '400 ') + Math.round(pt * PT) + 'px ' + PDF_FONT; }
function coName(t) { t = String(t || '').trim(); return /เชียงใหม่$/.test(t) ? t + ' จำกัด' : t; }
function handLbl(t) { return String(t).replace(/^ผู้ตรวจนับ/, 'ชื่อ'); }
function fitPt(ctx, lines, maxW, pt, bold) {
  pdfFont(ctx, pt, bold);
  while (pt > 6 && lines.some(function (t) { return ctx.measureText(t).width > maxW; })) { pt -= 0.5; pdfFont(ctx, pt, bold); }
  return pt;
}
function headSplit(t) {                      /* หัวคอลัมน์ไม่เกิน 3 บรรทัด: "จำนวน / ในระบบ / แพ็ค" (คอลัมน์แคบ เหลือที่ให้ชื่อรายการ) */
  t = String(t);
  var m = /^จำนวน(ต่อ|ใน)?\s*(.+)$/.exec(t);
  if (m) { var r = m[2].split(/\s+/); if (m[1]) r[0] = m[1] + r[0]; return ['จำนวน'].concat(r); }
  return t === 'รหัสคู่ค้า' ? ['รหัส', 'คู่ค้า'] : [t];
}

/* ความกว้างคอลัมน์ (mm) ที่ 10pt: เลขบาร์/หัวตารางต้องไม่ถูกตัดหรือย่อ ที่เหลือให้คอลัมน์ชื่อรายการ */
function fixedWidths(ctx, sc, rows, tw) {
  var PADMM = 1.5, n = sc.cols.length, need = [], hmin = [], nameJ = -1;
  sc.cols.forEach(function (k, j) {
    if (k.k === 'name') nameJ = j;
    pdfFont(ctx, PDF_BODY, true);
    var hd = Math.max.apply(null, headSplit(k.label).map(function (t) { return ctx.measureText(t).width; })) / PX + PADMM;
    pdfFont(ctx, PDF_BODY, false);
    var bd = 0; rows.forEach(function (x) { bd = Math.max(bd, ctx.measureText(String(x.v[j] == null ? '' : x.v[j])).width / PX + PADMM); });
    hmin[j] = k.text ? hd : Math.max(hd, Math.min(bd, 18));   /* ห้ามย่อต่ำกว่าข้อมูลจริง (รหัสคู่ค้า/หมวดไม่ถูกตัดขึ้นบรรทัดใหม่) */
    need[j] = k.text ? Math.max(hd, bd) : Math.max(hd, Math.min(bd, 18));
  });
  [['spread', 'old'], ['qtyPack', 'qtyUnit']].forEach(function (g) {   /* คอลัมน์ชุดเดียวกันกว้างเท่ากัน */
    var js = [], mx = 0; sc.cols.forEach(function (k, j) { if (g.indexOf(k.k) >= 0) { js.push(j); mx = Math.max(mx, need[j]); hmin[j] = Math.max.apply(null, js.map(function (q) { return hmin[q]; })); } });
    js.forEach(function (j) { need[j] = mx; });
  });
  var NAME_MIN = 38, fixed = 0, sum;
  need.forEach(function (w, j) { if (j !== nameJ) fixed += w; });
  var nameW = nameJ >= 0 ? tw - fixed : 0;
  if (nameJ >= 0 && nameW < NAME_MIN) {                              // ไม่พอ: ลดคอลัมน์ที่ไม่ใช่เลขบาร์ลงไม่เกินความกว้างหัวตาราง
    var slack = 0; need.forEach(function (w, j) { if (j !== nameJ && !sc.cols[j].text) slack += w - hmin[j]; });
    var cut = Math.min(slack, NAME_MIN - nameW);
    if (slack > 0) need.forEach(function (w, j) { if (j !== nameJ && !sc.cols[j].text) need[j] = w - (w - hmin[j]) / slack * cut; });
    fixed = 0; need.forEach(function (w, j) { if (j !== nameJ) fixed += w; });
    nameW = tw - fixed;
  }
  if (nameJ >= 0) need[nameJ] = Math.max(nameW, 14);
  sum = need.reduce(function (a, b) { return a + b; }, 0);
  if (sum > tw) {                                                    // ยังเกิน: ย่อเฉพาะคอลัมน์ที่ไม่ใช่เลขบาร์ (เลขบาร์ห้ามถูกตัด)
    var over = sum - tw, shr = 0;
    need.forEach(function (w, j) { if (!sc.cols[j].text) shr += w; });
    need.forEach(function (w, j) { if (!sc.cols[j].text) need[j] = w - over * w / shr; });
  } else if (nameJ < 0 || sum < tw) {                                // เหลือ: เฉลี่ยให้ทุกคอลัมน์
    need = need.map(function (w) { return w * tw / sum; });
  }
  return sc.cols.map(function (k, j) { return { k: k, w: need[j] }; });
}
/* จัดหน้า: คืนรายการหน้า {sec, rows:[{cells:[lines..], h}], first} */
function layoutSection(ctx, d) {
  var c = S.cats.filter(function (x) { return x.sheet === d.sheet && x.cat === d.cat; })[0];
  var sc = schemaOfCat(c), h = d.header;
  var chosen = selectedPartners(), ip = sc.cols.map(function (k) { return k.k; }).indexOf('partner');
  var rows = d.rows.filter(function (x) { return !(chosen.length && chosen.indexOf(String(x.v[ip]).trim()) < 0); });
  var tw = PDF_W - PDF_M * 2;
    var cols = fixedWidths(ctx, sc, rows, tw);
  var padX = 0.7 * PX, LH = 0, MINH = 0;
  /* หัวข้อด้านบน */
  var stx = String(h.statusText || '');
  if (stx && !/\d{1,2}:\d{2}/.test(stx) && d.last && d.last.ts && stx.indexOf(thDate(d.last.ts)) >= 0) stx += ' เวลา ' + thTime(d.last.ts) + ' น.';
  var topLines = {
    company: coName(h.company), hand: sc.handLines.map(handLbl).join('        '), status: stx,
    title: String(h.title || '') + (d.cat ? ' | หมวด ' + d.cat : '')
  };
  var TOP_H = (h.company ? 9 : 0) + 8 + 8 + 10;                 /* mm */
  var HEAD_H = 22;                                              /* mm หัวตาราง 2 แถว */
  var FOOT_H = 10;
  var bodyTop1 = PDF_M + TOP_H + HEAD_H, bodyTopN = PDF_M + HEAD_H, bodyBot = PDF_H - PDF_M - FOOT_H;
  /* ฟอนต์เลขบาร์: ใช้ขนาดเดียวกันทั้งตาราง (ย่อให้พอดีกับเลขที่ยาวที่สุด ไม่ให้ชนคอลัมน์ข้างเคียง) */
  var bpt = PDF_BODY;   /* ขนาดคงที่ 10pt (ความกว้างคอลัมน์ปรับตามเลขบาร์แทน) */
  /* ฟอนต์หัวตาราง: ขนาดเดียวกันทุกคอลัมน์ */
  var hpt = PDF_BODY;
  LH = bpt * 0.3528 * 1.25 * PX; MINH = Math.max(7 * PX, LH + 2.4 * PX);
  /* วัดแต่ละแถว */
  var items = rows.map(function (x, ri) {
    var cells = x.v.map(function (v, j) {
      var k = cols[j].k, maxW = cols[j].w * PX - padX * 2;
      if (k.text) return { lines: [String(v)], pt: bpt };
      pdfFont(ctx, bpt, false);
      return { lines: wrapText(ctx, v, maxW), pt: bpt };
    });
    var nl = Math.max.apply(null, cells.map(function (c) { return c.lines.length; }));
    return { cells: cells, h: Math.max(MINH, nl * LH + 2.4 * PX), n: ri };
  });
  var pages = [], cur = null, y = 0;
  function newPage(first) { cur = { first: first, rows: [] }; pages.push(cur); y = (first ? bodyTop1 : bodyTopN) * PX; }
  newPage(true);
  items.forEach(function (it) {
    if (y + it.h > bodyBot * PX && cur.rows.length) newPage(false);
    cur.rows.push({ it: it, y: y }); y += it.h;
  });
  return { sc: sc, cols: cols, top: topLines, hasCo: !!h.company, pages: pages, empty: !items.length, headH: HEAD_H, topH: TOP_H, hpt: hpt };
}

function drawPage(ctx, W, H, L, pg, pageNo, pageTotal, printedAt) {
  var sc = L.sc, cols = L.cols, x0 = PDF_M * PX, LINE = '#6f6f6f';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
  var y = PDF_M * PX;
  if (pg.first) {
    ctx.textAlign = 'center';
    if (L.hasCo) { pdfFont(ctx, PDF_TOP, true); ctx.fillText(L.top.company, W / 2, y + 4.5 * PX); y += 9 * PX; }
    ctx.textAlign = 'left'; pdfFont(ctx, PDF_TOP, false);
    ctx.fillText(L.top.hand, x0, y + 4 * PX); y += 8 * PX;
    ctx.fillText(L.top.status, x0, y + 4 * PX); y += 8 * PX;
    pdfFont(ctx, PDF_TOP, true); ctx.fillText(L.top.title, x0, y + 5 * PX); y += 10 * PX;
  }
  /* หัวตาราง */
  var hy = y, h1 = 8 * PX, h2 = 14 * PX, hh = h1 + h2;
  var grp = {}; sc.groups.forEach(function (g) { for (var i = g.from; i <= g.to; i++) grp[i] = g; });
  var xs = [x0]; cols.forEach(function (c) { xs.push(xs[xs.length - 1] + c.w * PX); });
  ctx.lineWidth = 2; ctx.strokeStyle = LINE; ctx.textAlign = 'center';
  var doneG = {};
  cols.forEach(function (c, j) {
    var g = grp[j + 1], cx = (xs[j] + xs[j + 1]) / 2, w = xs[j + 1] - xs[j];
    ctx.fillStyle = '#d0d0d0';
    if (!g) {
      ctx.fillRect(xs[j], hy, w, hh); ctx.strokeRect(xs[j], hy, w, hh);
      ctx.fillStyle = '#000'; var ln = headSplit(c.k.label); pdfFont(ctx, L.hpt, true);
      ln.forEach(function (t, i) { ctx.fillText(t, cx, hy + hh / 2 + (i - (ln.length - 1) / 2) * L.hpt * 0.3528 * 1.25 * PX); });
    } else {
      if (!doneG[g.label]) {
        doneG[g.label] = 1; var gx = xs[g.from - 1], gw = xs[g.to] - gx;
        ctx.fillRect(gx, hy, gw, h1); ctx.strokeRect(gx, hy, gw, h1);
        ctx.fillStyle = '#000'; pdfFont(ctx, PDF_BODY, true); ctx.fillText(g.label, gx + gw / 2, hy + h1 / 2);
      }
      ctx.fillStyle = '#d0d0d0'; ctx.fillRect(xs[j], hy + h1, w, h2); ctx.strokeRect(xs[j], hy + h1, w, h2);
      ctx.fillStyle = '#000'; var l2 = headSplit(c.k.label); pdfFont(ctx, L.hpt, true);
      l2.forEach(function (t, i) { ctx.fillText(t, cx, hy + h1 + h2 / 2 + (i - (l2.length - 1) / 2) * L.hpt * 0.3528 * 1.25 * PX); });
    }
  });
  /* เนื้อหา */
  if (L.empty) {
    var ey = hy + hh, eh = 10 * PX; ctx.strokeRect(x0, ey, xs[xs.length - 1] - x0, eh);
    ctx.fillStyle = '#000'; pdfFont(ctx, PDF_BODY, false); ctx.fillText('ไม่มีรายการ', (x0 + xs[xs.length - 1]) / 2, ey + eh / 2);
  }
  pg.rows.forEach(function (r) {
    var ty = r.y, it = r.it, odd = (it.n % 2) === 0;
    cols.forEach(function (c, j) {
      var w = xs[j + 1] - xs[j], cell = it.cells[j];
      ctx.fillStyle = odd ? '#ececec' : '#fff'; ctx.fillRect(xs[j], ty, w, it.h);
      ctx.strokeStyle = LINE; ctx.strokeRect(xs[j], ty, w, it.h);
      ctx.fillStyle = '#000'; pdfFont(ctx, cell.pt, false);
      var left = c.k.k === 'name';
      ctx.textAlign = left ? 'left' : 'center';
      var tx = left ? xs[j] + 1.2 * PX : (xs[j] + xs[j + 1]) / 2, n = cell.lines.length, LH = cell.pt * 0.3528 * 1.25 * PX;
      cell.lines.forEach(function (t, i) { ctx.fillText(t, tx, ty + it.h / 2 + (i - (n - 1) / 2) * LH); });
    });
  });
  /* ท้ายหน้า */
  ctx.fillStyle = '#444'; pdfFont(ctx, PDF_TIME, false);
  ctx.textAlign = 'left'; ctx.fillText('พิมพ์เมื่อ ' + printedAt, x0, H - PDF_M * PX - 3 * PX);
}

function canvasJpeg(cv) {
  return new Promise(function (res, rej) {
    cv.toBlob(function (b) {
      if (!b) return rej(new Error('สร้างภาพหน้า PDF ไม่สำเร็จ'));
      b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }, rej);
    }, 'image/jpeg', 0.93);
  });
}
function pdfFromJpegs(jp) {
  var PWd = (PDF_W / 25.4 * 72).toFixed(2), PHt = (PDF_H / 25.4 * 72).toFixed(2);
  var enc = new TextEncoder(), parts = [], offs = [], len = 0, N = jp.length;
  function push(x) { var b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; }
  function obj(n, fn) { offs[n] = len; push(n + ' 0 obj\n'); fn(); push('\nendobj\n'); }
  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
  obj(1, function () { push('<< /Type /Catalog /Pages 2 0 R >>'); });
  obj(2, function () { push('<< /Type /Pages /Count ' + N + ' /Kids [' + jp.map(function (_, i) { return (3 + 3 * i) + ' 0 R'; }).join(' ') + '] >>'); });
  jp.forEach(function (j, i) {
    var p = 3 + 3 * i, c = p + 1, im = p + 2, cs = 'q ' + PWd + ' 0 0 ' + PHt + ' 0 0 cm /Im0 Do Q';
    obj(p, function () { push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PWd + ' ' + PHt + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + c + ' 0 R >>'); });
    obj(c, function () { push('<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream'); });
    obj(im, function () {
      push('<< /Type /XObject /Subtype /Image /Width ' + j.w + ' /Height ' + j.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + j.bytes.length + ' >>\nstream\n');
      push(j.bytes); push('\nendstream');
    });
  });
  var xref = len, total = 3 * N + 3, x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
  for (var n = 1; n < total; n++) x += String(offs[n]).padStart(10, '0') + ' 00000 n \n';
  push(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
  return new Blob(parts, { type: 'application/pdf' });
}
/* ฟอนต์ Bai Jamjuree: ใช้จากเครื่องถ้ามี ไม่งั้นโหลดจาก Google Fonts (ถ้าออฟไลน์จะใช้ฟอนต์ไทยสำรองของเครื่อง) */
function fontInstalled(name) {
  var c = document.createElement('canvas').getContext('2d'), t = 'ทดสอบกขค็้ิ๊123';
  c.font = '40px monospace'; var a = c.measureText(t).width;
  c.font = '40px "' + name + '", monospace';
  return c.measureText(t).width !== a;
}
var PF_LOCAL = { 'TH Sarabun New': 1, 'Tahoma': 1 };   /* ฟอนต์ในเครื่อง ไม่โหลดจาก Google Fonts */
function applyPrintFont(name) {                          /* ตั้งฟอนต์ปริ้นทั้งแบบ PDF (canvas) และแบบปริ้นจากเบราว์เซอร์ */
  name = String(name || 'Bai Jamjuree').replace(/['"\\;{}<>]/g, '');
  PRINT_FONT = name;
  PDF_FONT = "'" + name + "'," + PDF_FONT_TAIL;
  document.documentElement.style.setProperty('--pfont', "'" + name + "'");
}
async function ensureThaiFont() {
  var name = PRINT_FONT;
  if (PF_LOCAL[name] || fontInstalled(name)) return;
  try {
    var id = 'pfCss-' + name.replace(/\s+/g, '-');
    if (!document.getElementById(id)) {
      var l = document.createElement('link'); l.id = id; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') + ':wght@400;700&display=swap';
      document.head.appendChild(l);
    }
    await Promise.race([
      Promise.all([document.fonts.load('400 32px "' + name + '"', 'ทดสอบ'), document.fonts.load('700 32px "' + name + '"', 'ทดสอบ')]),
      new Promise(function (r) { setTimeout(r, 5000); })
    ]);
  } catch (e) {}
}
async function pfRender(font, list) {                    /* แถวเลือกฟอนต์ในแท็บปริ้น: Admin เปลี่ยนได้ ผู้ใช้อื่นเห็นเฉพาะที่ตั้งไว้ */
  var sel = $('#pFont'); if (!sel) return;
  if (list && !sel.options.length) sel.innerHTML = list.map(function (f) { return '<option>' + esc(f) + '</option>'; }).join('');
  applyPrintFont(font); sel.value = PRINT_FONT;
  var admin = S.me && S.me.role === 'admin';
  sel.disabled = !admin;
  $('#pFontNote').textContent = admin ? 'Admin ตั้งได้ · ใช้กับทุกคนที่ปริ้นรายงาน' : 'ตั้งโดย Admin (เฉพาะ Admin เปลี่ยนได้)';
  $('#pFontSample').style.fontFamily = PDF_FONT;
  await ensureThaiFont();
  $('#pFontSample').style.fontFamily = PDF_FONT;
}
async function buildPrintPdf(results) {
  await ensureThaiFont();
  var W = Math.round(PDF_W * PX), H = Math.round(PDF_H * PX);
  var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
  var layouts = results.map(function (d) { return layoutSection(ctx, d); });
  var total = layouts.reduce(function (s, L) { return s + L.pages.length; }, 0), no = 0, jp = [], at = fmt(nowMs());
  for (var a = 0; a < layouts.length; a++) {
    for (var b = 0; b < layouts[a].pages.length; b++) {
      drawPage(ctx, W, H, layouts[a], layouts[a].pages[b], ++no, total, at);
      jp.push({ bytes: await canvasJpeg(cv), w: W, h: H });
    }
  }
  return pdfFromJpegs(jp);
}

$('#btnPrint').addEventListener('click', async function () {
  var keys = checkedCatKeys();
  if (!keys.length) { toast('เลือกหมวดที่ต้องการปริ้นก่อน', true); return; }
  logUse('barcode', 'สร้าง PDF เพื่อปริ้น', '');
  var btn = this, label = btn.textContent; btn.textContent = 'กำลังสร้าง PDF…';
  await busy(btn, async function () {
    var results = await Promise.all(keys.map(function (k) {
      var c = S.cats.filter(function (x) { return x.key === k; })[0];
      return call('getCategoryData', c.sheet, c.cat);
    }));
    var blob = await buildPrintPdf(results);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = URL.createObjectURL(blob);
    var nm = 'รายการบาร์_' + thaiDayIso() + '.pdf';
    $('#pdfName').textContent = nm + ' · ' + results.length + ' หมวด · ' + Math.round(blob.size / 1024) + ' KB';
    $('#pdfOpen').href = pdfUrl; $('#pdfDl').href = pdfUrl; $('#pdfDl').setAttribute('download', nm);
    $('#pdfModal').classList.remove('hidden');
  });
  btn.textContent = label;
});
$('#pFont').addEventListener('change', async function () {
  var sel = this, prev = PRINT_FONT, v = sel.value;
  try { var r = await call('setPrintFont', v); pfRender(r.font); toast('ตั้งฟอนต์ปริ้นเป็น ' + r.font + ' แล้ว'); }
  catch (err) { toast(err.message, true); sel.value = prev; }
});
$('#btnPrintOld').addEventListener('click', async function () {
  logUse('barcode', 'ปริ้นจากเบราว์เซอร์', '');
  var keys = checkedCatKeys();
  if (!keys.length) { toast('เลือกหมวดที่ต้องการปริ้นก่อน', true); return; }
  var btn = this; btn.textContent = 'กำลังเตรียมข้อมูล…';
  await busy(btn, async function () {
    var results = await Promise.all(keys.map(function (k) {
      var c = S.cats.filter(function (x) { return x.key === k; })[0];
      return call('getCategoryData', c.sheet, c.cat);
    }));
    await ensureThaiFont();
    $('#printArea').innerHTML = results.map(printSection).join('');
    setTimeout(function () { window.print(); }, 150);
  });
  btn.textContent = 'ปริ้นจากเบราว์เซอร์ (สำรอง)';
});

/* ============================ นำเข้า / ส่งออก / สำเนา (รายการบาร์) ============================ */
var BC_BK = [];
function bcBkFmt(ts) { return new Date(ts).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'medium' }); }
function bcBkRender() {
  $('#bcBkBtn').textContent = 'สำเนา (' + BC_BK.length + '/2)';
  $('#bcBkList').innerHTML = BC_BK.length ? '<table class="logt"><thead><tr><th>#</th><th>เวลา</th><th>ข้อมูล</th><th></th></tr></thead><tbody>' +
    BC_BK.map(function (b, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(bcBkFmt(b.ts)) + '</td><td>' + esc(b.name) + '</td><td class="act"><div class="actw"><button class="btn ghost small" data-dl="' + b.id + '">ดาวน์โหลด CSV</button><button class="btn ghost small" data-rs="' + b.id + '">กู้คืน</button></div></td></tr>'; }).join('') + '</tbody></table>'
    : '<div class="muted">ยังไม่มีสำเนา</div>';
}
function bcLoadBk() { call('barcodeBackupList').then(function (r) { BC_BK = r.backups || []; bcBkRender(); }).catch(function () {}); }
$('#bcBkBtn').addEventListener('click', function () { bcBkRender(); $('#bcBkModal').classList.remove('hidden'); bcLoadBk(); });
$('#bcBkClose').addEventListener('click', function () { $('#bcBkModal').classList.add('hidden'); });
$('#bcBkList').addEventListener('click', async function (e) {
  var b = e.target.closest('button'); if (!b) return;
  if (b.dataset.dl) {
    b.disabled = true;
    try {
      var r = await call('barcodeBackupData', Number(b.dataset.dl)), a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8' }));
      a.download = r.name + '_' + thaiDayIso() + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { toast(err.message, true); }
    b.disabled = false;
  } else if (b.dataset.rs) {
    if (!confirm('กู้คืนข้อมูลจากสำเนานี้?\n\nข้อมูลปัจจุบันจะถูกแทนที่ (ระบบทำสำเนาข้อมูลปัจจุบันไว้ให้ก่อน)')) return;
    b.disabled = true;
    try {
      var rr = await withSaving(call('barcodeRestore', Number(b.dataset.rs)));
      BC_BK = rr.backups || BC_BK; bcBkRender(); $('#bcBkModal').classList.add('hidden');
      toast('กู้คืนแล้ว ' + rr.count + ' รายการ'); await refreshCats(); await selectCat(allCat().key);
    } catch (err) { toast(err.message, true); }
    b.disabled = false;
  }
});
$('#bcImpFile').addEventListener('change', function () { $('#bcImpBtn').disabled = !this.files.length; });
$('#bcImpBtn').addEventListener('click', function () {
  var f = $('#bcImpFile').files[0], mode = $('#bcImpMode').value; if (!f) return;
  if (f.size > 100 * 1024 * 1024) { toast('ไฟล์ใหญ่เกิน 100 MB กรุณาแบ่งไฟล์ก่อนนำเข้า', true); return; }
  if (typeof XLSX === 'undefined') { toast('โหลดตัวอ่าน Excel ไม่สำเร็จ ลองรีเฟรชหน้านี้', true); return; }
  var fr = new FileReader();
  fr.onerror = function () { toast('อ่านไฟล์ไม่ได้', true); };
  fr.onload = function () {
    var sheets;
    try {
      var wb = XLSX.read(fr.result, { type: 'array', dense: true, cellStyles: false, cellFormula: false, cellHTML: false });
      sheets = wb.SheetNames.map(function (n) { var g = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); delete wb.Sheets[n]; return { name: n, grid: g }; });
    } catch (err) { toast('อ่านไฟล์ Excel ไม่สำเร็จ: ' + err.message, true); return; }
    if (!confirm('นำเข้าจากไฟล์ "' + f.name + '" (' + sheets.length + ' แผ่นงาน)\n\n' + (mode === 'replace' ? 'ข้อมูลรายการบาร์ในระบบจะถูกแทนที่ทั้งหมด' : 'เพิ่มต่อท้ายข้อมูลเดิม (ข้ามรายการที่ซ้ำ)') + '\nระบบทำสำเนาข้อมูลเดิมไว้ให้ก่อน')) return;
    busy($('#bcImpBtn'), async function () {
      var r = await withSaving(call('importBarcodeData', sheets, mode));
      BC_BK = r.backups || BC_BK; bcBkRender();
      $('#bcImpFile').value = ''; $('#bcImpBtn').disabled = true;
      toast('นำเข้าแล้ว ' + r.count + ' รายการ' + (r.duplicates ? ' (ข้ามซ้ำ ' + r.duplicates + ')' : '') + (r.notes && r.notes.length ? ' · ข้ามบางแผ่นงาน: ' + r.notes.join(' | ') : ''));
      await refreshCats(); await selectCat(allCat().key);
    });
  };
  fr.readAsArrayBuffer(f);
});
$('#bcExpBtn').addEventListener('click', function () {
  if (typeof XLSX === 'undefined') { toast('โหลดตัวสร้าง Excel ไม่สำเร็จ ลองรีเฟรชหน้านี้', true); return; }
  busy(this, async function () {
    var d = await call('getCategoryData', allCat().sheet, '*');
    var aoa = [['ลำดับ', 'รหัสคู่ค้า', 'หมวด', 'ชื่อรายการ', 'จำนวนต่อแพ็ค', 'เลขบาร์แพ็ค', 'เลขบาร์เดี่ยว']].concat(d.rows.map(function (x) { return [x.v[0], x.v[1], x.v[2], x.v[3], x.v[4], x.v[5], x.v[7]]; }));
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'บาร์สินค้า');
    XLSX.writeFile(wb, 'รายการบาร์_' + thaiDayIso() + '.xlsx');
  });
});

/* ============================ ประวัติ / แท็บ ============================ */
function switchTab(t) {
  if (S.me && S.me.role !== 'admin' && t !== 'print') t = 'print';
  document.querySelectorAll('.tab').forEach(function (x) { var on=x.dataset.t===t;x.classList.toggle('on',on);x.setAttribute('aria-selected',String(on));x.tabIndex=on?0:-1; });
  ['data', 'manage', 'print'].forEach(function (k) { $('#v-' + k).classList.toggle('hidden', k !== t); });
  if (t === 'print') renderPrintList();
}
document.querySelector('.tabs').addEventListener('click', function (e) {
  var b = e.target.closest('.tab'); if (!b) return;
  switchTab(b.dataset.t);
});


/* ============================ เข้าสู่ระบบ / ออกจากระบบ ============================ */
function showLogin(msg) {
  S.token = ''; S.me = null; S.cur = null; S.data = null; S.cats = []; S.overall = null;
  try { sessionStorage.removeItem('pm_tok'); sessionStorage.removeItem('pm_me'); } catch (e) {}
  document.body.classList.add('locked');
  document.querySelectorAll('.modalwrap,.overlay').forEach(function (dialog) { dialog.classList.add('hidden'); });
  if ($('#login')) $('#login').classList.remove('hidden');
  $('#lgErr').textContent = msg || ''; $('#lgPass').value = '';
  $('#tbody').innerHTML = ''; $('#pList').innerHTML = ''; $('#catSide').innerHTML = '';
  setTimeout(function () { $('#lgUser').focus(); }, 50);
}
function hasPerm(k) { return !!(S.me && (S.me.role === 'admin' || (S.me.perms && S.me.perms[k]))); }
function goPortal() {
  location.href = pageUrl('index.html', 'https://cmucoop-support.github.io/CMUCOOP-SP/index.html');
}
async function openBarcode() {
  var me = S.me; if (!me || !hasPerm('barcode')) return;
  $('#me').textContent = me.name + ' (' + (me.role === 'admin' ? 'Admin' : 'ผู้ใช้งาน') + ')';
  var admin = me.role === 'admin';
  document.querySelectorAll('.tab').forEach(function (t) {
    t.classList.toggle('hidden', !admin && (t.dataset.t === 'data' || t.dataset.t === 'manage'));
  });
  $('.layout').classList.toggle('single', !admin);
  $('aside').classList.toggle('hidden', !admin);
  switchTab(admin ? 'data' : 'print');
  if (admin) bcLoadBk();
  try {
    await refreshCats();
    if (admin) await selectCat(allCat().key);          // เปิดมาแสดงรายการทั้งหมดก่อน
  } catch (e) { if (S.me) toast('โหลดข้อมูลไม่สำเร็จ: ' + e.message, true); }
}

async function startApp(me) {
  S.me = me;
  if (!hasPerm('barcode')) {
    showLogin('บัญชีนี้ยังไม่ได้รับสิทธิ์การ์ดรายการบาร์เดี่ยว/บาร์แพ็ค — ติดต่อ Admin หรือเข้าสู่ระบบด้วยบัญชีอื่น');
    return;
  }
  document.body.classList.remove('locked');
  if ($('#login')) $('#login').classList.add('hidden');
  try { if (me && me.role) sessionStorage.setItem('pm_me', JSON.stringify(me)); } catch (e) {}
  await openBarcode();
}
async function doLogin() {
  if ($('#lgBtn').disabled) return;
  var u = $('#lgUser').value.trim(), p = $('#lgPass').value;
  if (!u || !p) { $('#lgErr').textContent = 'กรุณากรอกรหัสผู้ใช้และรหัสผ่าน'; return; }
  $('#lgBtn').disabled = true; $('#lgErr').textContent = '';
  try {
    var r = await call('login', u, p);
    S.token = r.token;
    try { sessionStorage.setItem('pm_tok', r.token); sessionStorage.setItem('pm_me', JSON.stringify(r)); } catch (e) {}
    $('#lgPass').value = '';
    await startApp(r);
  } catch (e) { $('#lgErr').textContent = e.message; $('#lgPass').value = ''; }
  $('#lgBtn').disabled = false;
}
$('#lgBtn').addEventListener('click', doLogin);
$('#lgForgot').addEventListener('click', function (e) {
  e.preventDefault(); $('#rcBox').classList.toggle('hidden');
  if (!$('#rcBox').classList.contains('hidden')) { $('#rcUser').value = $('#lgUser').value.trim(); $('#rcCode').focus(); }
});
$('#rcBtn').addEventListener('click', async function () {
  this.disabled = true; $('#lgErr').textContent = '';
  try {
    await call('recoverAdmin', $('#rcUser').value.trim(), $('#rcCode').value, $('#rcPass').value);
    $('#lgUser').value = $('#rcUser').value.trim();
    ['#rcCode', '#rcPass'].forEach(function (x) { $(x).value = ''; });
    $('#rcBox').classList.add('hidden');
    $('#lgErr').textContent = 'ตั้งรหัสผ่านใหม่แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่';
    $('#lgPass').focus();
  } catch (e) { $('#lgErr').textContent = e.message; }
  this.disabled = false;
});
$('#lgPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
$('#lgUser').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#lgPass').focus(); });

document.querySelectorAll('#btnLogout,.js-logout').forEach(function (b) {
  b.addEventListener('click', async function () {
    try { await call('logout'); } catch (e) {}
    showLogin('');
  });
});
$('#btnHome').addEventListener('click', goPortal);

/* ============================ เริ่มต้น ============================ */
$('#btnReload').addEventListener('click', async function () {
  try { await refreshCats(); if (S.cur) await selectCat(S.cur); toast('โหลดข้อมูลล่าสุดแล้ว'); }
  catch (e) { toast(e.message, true); }
});
setInterval(function () { if (!S.saving && S.me && !document.hidden) { renderStatus(); renderSide(); } }, 60000);

function linkParams() {
  return new Promise(function (res) {
    try { google.script.url.getLocation(function (l) { res((l && l.parameter) || {}); }); }
    catch (e) { res({}); }
  });
}
(async function init() {
  var q = await linkParams();
  if (q.u && q.k) {                               // เข้าด้วยลิงก์ที่ Admin ออกให้
    try {
      var r = await call('loginByLink', q.u, q.k);
      S.token = r.token;
      try { sessionStorage.setItem('pm_tok', r.token); } catch (e) {}
      await startApp(r); return;
    } catch (e) { showLogin(e.message); return; }
  }
  if (S.token) {                                  // กู้เซสชันเดิมทันทีโดยไม่กะพริบหน้าล็อกอิน
    try { var me = await call('whoami'); await startApp(me); return; }
    catch (e) { showLogin(e.message); return; }
  }
  showLogin('');
})();
