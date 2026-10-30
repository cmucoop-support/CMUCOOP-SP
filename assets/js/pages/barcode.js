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

/* ============================ รายการหมวด (ด้านบนตาราง) ============================ */
function renderPairCatOptions() {
  var sel = $('#bcPairCatSel'), inp = $('#bcPairDefCat');
  if (!sel) return;
  var prevVal = sel.value;
  var typedVal = inp ? inp.value.trim() : '';
  var cats = [];
  (S.cats || []).forEach(function (c) {
    if (c && c.cat && cats.indexOf(c.cat) < 0) cats.push(c.cat);
  });
  var opts = '<option value="">-- ไม่เลือกหมวด (เว้นว่างไว้ก่อน) --</option>' +
    cats.map(function (cat) { return '<option value="' + esc(cat) + '">' + esc(cat) + '</option>'; }).join('') +
    '<option value="__new">＋ พิมพ์ชื่อหมวดใหม่…</option>';
  sel.innerHTML = opts;
  if (prevVal === '__new') {
    sel.value = '__new';
    if (inp) inp.classList.remove('hidden');
  } else if (typedVal && cats.indexOf(typedVal) >= 0) {
    sel.value = typedVal;
    if (inp) inp.classList.add('hidden');
  } else if (typedVal) {
    sel.value = '__new';
    if (inp) inp.classList.remove('hidden');
  } else {
    sel.value = '';
    if (inp) inp.classList.add('hidden');
  }
}
function renderSide() {
  var html = '', lastSheet = null;
  var totalItems = 0;
  S.cats.forEach(function (c) {
    totalItems += Number(c.items) || 0;
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
  if ($('#catSide')) $('#catSide').innerHTML = html + (lastSheet !== null ? '</ul>' : '') || '<div class="muted">ไม่พบชีตข้อมูล</div>';
  var catSel = $('#bcCatSelect');
  if (catSel) {
    var aKey = allCat().key;
    var curKey = S.cur || aKey;
    var selHtml = '<option value="' + esc(aKey) + '"' + (curKey === aKey ? ' selected' : '') + '>ทุกหมวดรวมกัน (' + S.cats.length + ' หมวด · ' + totalItems + ' รายการ)</option>';
    S.cats.forEach(function (c) {
      var f = fresh(c.last);
      selHtml += '<option value="' + esc(c.key) + '"' + (c.key === curKey ? ' selected' : '') + '>' +
        esc(c.label) + ' (' + c.items + ' รายการ' + (c.last && f.rel ? ' · อัพเดต ' + f.rel : '') + ')</option>';
    });
    catSel.innerHTML = selHtml;
    catSel.value = curKey;
  }
  if ($('#bcCatDrawerCount')) {
    $('#bcCatDrawerCount').textContent = '(' + S.cats.length + ' หมวด)';
  }
  renderPairCatOptions();
  if (window.WorkspaceUI) WorkspaceUI.barcodeStats();
}
if ($('#bcCatSelect')) {
  $('#bcCatSelect').addEventListener('change', function () {
    if (this.value) selectCat(this.value);
  });
}
if ($('#bcPairCatSel')) {
  $('#bcPairCatSel').addEventListener('change', function () {
    var inp = $('#bcPairDefCat');
    if (!inp) return;
    if (this.value === '__new') {
      inp.value = '';
      inp.classList.remove('hidden');
      inp.focus();
    } else {
      inp.classList.add('hidden');
      inp.value = this.value || '';
    }
  });
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
  if (stx && !/\d{1,2}:\d{2}/.test(stx) && d.last && d.last.ts) {
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
var pdfUrl = '';
function pdfBlob(b64) {
  var bin = atob(b64), u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: 'application/pdf' });
}
function closePdf() { $('#pdfModal').classList.add('hidden'); if (pdfUrl) { URL.revokeObjectURL(pdfUrl); pdfUrl = ''; } }
$('#pdfClose').addEventListener('click', closePdf);

var PW = { no: 5, partner: 7.5, cat: 6, name: 19, perPack: 7, packBar: 14, qtyPack: 7.5, unitBar: 14, qtyUnit: 7.5, spread: 6.5, old: 6 };
function pw(k) { return PW[k.k] || k.w; }
var PDF_FONT_TAIL = "'Bai Jamjuree','TH Sarabun New','THSarabunNew','TH SarabunPSK','Sarabun','Leelawadee UI','Tahoma','Noto Sans Thai',sans-serif";
var PRINT_FONT = 'Bai Jamjuree', PDF_FONT = "'Bai Jamjuree'," + PDF_FONT_TAIL;
var PDF_DPI = 200, PX = PDF_DPI / 25.4, PT = PDF_DPI / 72;
var PDF_W = 210, PDF_H = 297, PDF_M = 2;
var PDF_BODY = 10;
var PDF_TOP = 14;
var PDF_TIME = 10;
var _seg = null;
function thWords(s) {
  try { if (!_seg && window.Intl && Intl.Segmenter) _seg = new Intl.Segmenter('th', { granularity: 'word' }); } catch (e) {}
  if (_seg) return Array.from(_seg.segment(s), function (x) { return x.segment; });
  return String(s).split(/(\s+)/);
}
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
function headSplit(t) {
  t = String(t);
  var m = /^จำนวน(ต่อ|ใน)?\s*(.+)$/.exec(t);
  if (m) { var r = m[2].split(/\s+/); if (m[1]) r[0] = m[1] + r[0]; return ['จำนวน'].concat(r); }
  return t === 'รหัสคู่ค้า' ? ['รหัส', 'คู่ค้า'] : [t];
}

function fixedWidths(ctx, sc, rows, tw) {
  var PADMM = 1.5, n = sc.cols.length, need = [], hmin = [], nameJ = -1;
  sc.cols.forEach(function (k, j) {
    if (k.k === 'name') nameJ = j;
    pdfFont(ctx, PDF_BODY, true);
    var hd = Math.max.apply(null, headSplit(k.label).map(function (t) { return ctx.measureText(t).width; })) / PX + PADMM;
    pdfFont(ctx, PDF_BODY, false);
    var bd = 0; rows.forEach(function (x) { bd = Math.max(bd, ctx.measureText(String(x.v[j] == null ? '' : x.v[j])).width / PX + PADMM); });
    hmin[j] = k.text ? hd : Math.max(hd, Math.min(bd, 18));
    need[j] = k.text ? Math.max(hd, bd) : Math.max(hd, Math.min(bd, 18));
  });
  [['spread', 'old'], ['qtyPack', 'qtyUnit']].forEach(function (g) {
    var js = [], mx = 0; sc.cols.forEach(function (k, j) { if (g.indexOf(k.k) >= 0) { js.push(j); mx = Math.max(mx, need[j]); hmin[j] = Math.max.apply(null, js.map(function (q) { return hmin[q]; })); } });
    js.forEach(function (j) { need[j] = mx; });
  });
  var NAME_MIN = 38, fixed = 0, sum;
  need.forEach(function (w, j) { if (j !== nameJ) fixed += w; });
  var nameW = nameJ >= 0 ? tw - fixed : 0;
  if (nameJ >= 0 && nameW < NAME_MIN) {
    var slack = 0; need.forEach(function (w, j) { if (j !== nameJ && !sc.cols[j].text) slack += w - hmin[j]; });
    var cut = Math.min(slack, NAME_MIN - nameW);
    if (slack > 0) need.forEach(function (w, j) { if (j !== nameJ && !sc.cols[j].text) need[j] = w - (w - hmin[j]) / slack * cut; });
    fixed = 0; need.forEach(function (w, j) { if (j !== nameJ) fixed += w; });
    nameW = tw - fixed;
  }
  if (nameJ >= 0) need[nameJ] = Math.max(nameW, 14);
  sum = need.reduce(function (a, b) { return a + b; }, 0);
  if (sum > tw) {
    var over = sum - tw, shr = 0;
    need.forEach(function (w, j) { if (!sc.cols[j].text) shr += w; });
    need.forEach(function (w, j) { if (!sc.cols[j].text) need[j] = w - over * w / shr; });
  } else if (nameJ < 0 || sum < tw) {
    need = need.map(function (w) { return w * tw / sum; });
  }
  return sc.cols.map(function (k, j) { return { k: k, w: need[j] }; });
}

function layoutSection(ctx, d, partners) {
  var c = S.cats.filter(function (x) { return x.sheet === d.sheet && x.cat === d.cat; })[0];
  var sc = c ? schemaOfCat(c) : S.schemas[S.sheets[d.sheet].schema], h = d.header;
  var chosen = Array.isArray(partners) ? partners : selectedPartners(), ip = sc.cols.map(function (k) { return k.k; }).indexOf('partner');
  var rows = d.rows.filter(function (x) { return !(chosen.length && chosen.indexOf(String(x.v[ip]).trim()) < 0); });
  var tw = PDF_W - PDF_M * 2;
  var cols = fixedWidths(ctx, sc, rows, tw);
  var padX = 0.7 * PX, LH = 0, MINH = 0;
  var stx = String(h.statusText || '');
  if (stx && !/\d{1,2}:\d{2}/.test(stx) && d.last && d.last.ts && stx.indexOf(thDate(d.last.ts)) >= 0) stx += ' เวลา ' + thTime(d.last.ts) + ' น.';
  var topLines = {
    company: coName(h.company), hand: sc.handLines.map(handLbl).join('        '), status: stx,
    title: String(h.title || '') + (d.cat ? ' | หมวด ' + d.cat : '')
  };
  var TOP_H = (h.company ? 9 : 0) + 8 + 8 + 10;
  var HEAD_H = 22;
  var FOOT_H = 10;
  var bodyTop1 = PDF_M + TOP_H + HEAD_H, bodyTopN = PDF_M + HEAD_H, bodyBot = PDF_H - PDF_M - FOOT_H;
  var bpt = PDF_BODY;
  var hpt = PDF_BODY;
  LH = bpt * 0.3528 * 1.25 * PX; MINH = Math.max(7 * PX, LH + 2.4 * PX);
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
function fontInstalled(name) {
  var c = document.createElement('canvas').getContext('2d'), t = 'ทดสอบกขค็้ิ๊123';
  c.font = '40px monospace'; var a = c.measureText(t).width;
  c.font = '40px "' + name + '", monospace';
  return c.measureText(t).width !== a;
}
var PF_LOCAL = { 'TH Sarabun New': 1, 'Tahoma': 1 };
function applyPrintFont(name) {
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
async function pfRender(font, list) {
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
function bcExcelReport(d, partners) {
  var sc = S.schemas[S.sheets[d.sheet].schema], ip = sc.cols.map(function (c) { return c.k; }).indexOf('partner');
  var rows = d.rows.filter(function (x) { return !partners.length || partners.indexOf(String(x.v[ip]).trim()) >= 0; });
  var ctx = document.createElement('canvas').getContext('2d');
  var layout = layoutSection(ctx, Object.assign({}, d, { rows: rows }), []), heights = [];
  layout.pages.forEach(function (p) { p.rows.forEach(function (r) { heights.push(r.it.h * 72 / PDF_DPI); }); });
  return { name: d.cat || 'บาร์สินค้า', top: layout.top,
    cols: layout.cols.map(function (c) { return Object.assign({}, c, { header: headSplit(c.k.label).join('\n') }); }), groups: sc.groups,
    rows: rows.map(function (x, i) { return { v: x.v, height: heights[i] }; }) };
}
async function bcExportReports(results, partners) {
  await ensureThaiFont();
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  var bytes = await bcXlBuild(results.map(function (d) { return bcExcelReport(d, partners); }), { font: PRINT_FONT, printedAt: fmt(nowMs()) });
  bcXlDownload(bytes, 'รายการบาร์_' + thaiDayIso() + '.xlsx');
  toast('สร้างไฟล์ Excel เรียบร้อยแล้ว');
}
$('#bcExpBtn').addEventListener('click', function () {
  busy(this, async function () {
    var d = await call('getCategoryData', allCat().sheet, '*');
    var mode = ($('#bcExpSheetMode') && $('#bcExpSheetMode').value) || 'single', results = [d];
    if (mode === 'split' && d.rows.length) {
      var byCat = new Map();
      d.rows.forEach(function (x) {
        var cat = String(x.v[2] || '').trim() || 'ไม่ระบุหมวด';
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(x);
      });
      results = Array.from(byCat, function (entry) {
        var rows = entry[1].map(function (x, i) { var v = x.v.slice(); v[0] = i + 1; return Object.assign({}, x, { v: v }); });
        var ts = rows.reduce(function (t, x) { return Math.max(t, x.revision || 0); }, 0);
        return Object.assign({}, d, { cat: entry[0], rows: rows, last: ts ? { ts: ts } : d.last,
          header: Object.assign({}, d.header, { statusText: ts ? 'ข้อมูลอัพเดตล่าสุดวันที่ ' + thDate(ts) : d.header.statusText }) });
      });
    }
    await bcExportReports(results, []);
  });
});
$('#btnPrintExcel').addEventListener('click', function () {
  var keys = checkedCatKeys();
  if (!keys.length) { toast('เลือกหมวดที่ต้องการส่งออกก่อน', true); return; }
  busy(this, async function () {
    var results = await Promise.all(keys.map(function (k) {
      var c = S.cats.filter(function (x) { return x.key === k; })[0];
      return call('getCategoryData', c.sheet, c.cat);
    }));
    await bcExportReports(results, selectedPartners());
  });
});

/* ============================ จับคู่บาร์เดี่ยว / บาร์แพ็คจากชื่อที่คล้ายกัน ============================ */
var PAIR_STORAGE_KEY = "cmucoop_bc_pair_draft_v1";
var PAIR_TTL_MS = 7 * 24 * 60 * 60 * 1000;
var PAIR_STATE = {
  pairs: [],
  unmatchedUnits: [],
  unmatchedPacks: [],
  nextId: 1,
  savedAt: 0,
  expiresAt: 0,
  stockMap: {},
  dbBarMap: {}
};
var pairCloudSaveTimer = null;

// ตัดช่องว่าง เครื่องหมายอัญประกาศ และตัวอักษร P ออกเสมอเมื่ออ่าน/เปรียบเทียบ/บันทึกเลขบาร์โค้ด
function cleanBarcodeStr(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  var s = String(v).trim().replace(/^['"]+|['"]+$/g, "").replace(/\s+/g, "").replace(/[pP]/g, "");
  if (/^\d+\.\d+e\+\d+$/i.test(s)) {
    var n = Number(s);
    if (Number.isFinite(n)) s = String(Math.round(n));
  }
  return s.slice(0, 60);
}

function parseOptNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  var s = String(v).replace(/,/g, "").replace(/[฿$\s]/g, "").trim();
  if (!s || !/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  var n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function fmtOptNum(v) {
  if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) return "–";
  return Number(v).toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

function lookupStockEntry(code, stockMap) {
  var map = stockMap || PAIR_STATE.stockMap || {};
  var k = cleanBarcodeStr(code);
  if (!k) return null;
  return map[k] || map["P" + k] || map["p" + k] || null;
}

function resolvePairQty(code, rawQty, stockMap) {
  if (rawQty !== null && rawQty !== undefined && rawQty !== "" && Number.isFinite(Number(rawQty))) {
    return Math.round(Number(rawQty) * 100) / 100;
  }
  var entry = lookupStockEntry(code, stockMap);
  if (entry && entry.qty !== undefined && entry.qty !== null && Number.isFinite(Number(entry.qty))) {
    return Math.round(Number(entry.qty) * 100) / 100;
  }
  return null;
}

function resolvePairPrice(code, rawPrice, stockMap) {
  if (rawPrice !== null && rawPrice !== undefined && rawPrice !== "" && Number.isFinite(Number(rawPrice)) && Number(rawPrice) > 0) {
    return Math.round(Number(rawPrice) * 100) / 100;
  }
  var entry = lookupStockEntry(code, stockMap);
  if (entry && entry.price !== undefined && Number(entry.price) > 0) {
    return Math.round(Number(entry.price) * 100) / 100;
  }
  return null;
}

function buildDbBarcodeMap(existingRows) {
  var map = Object.create(null);
  (existingRows || []).forEach(function (x) {
    var v = (x && x.v) || [];
    var rec = {
      id: x.r || v[0] || 0,
      partner: String(v[1] || "").trim(),
      cat: String(v[2] || "").trim() || "ไม่ระบุหมวด",
      name: String(v[3] || "").trim(),
      perPack: String(v[4] || "").trim(),
      packBar: cleanBarcodeStr(v[5]),
      unitBar: cleanBarcodeStr(v[7])
    };
    if (rec.unitBar && !map[rec.unitBar]) map[rec.unitBar] = rec;
    if (rec.packBar && !map[rec.packBar]) map[rec.packBar] = rec;
  });
  return map;
}

function evaluatePairDuplicate(pair, dbMap) {
  var map = dbMap || PAIR_STATE.dbBarMap || {};
  var uBar = cleanBarcodeStr(pair && pair.unitBar);
  var pBar = cleanBarcodeStr(pair && pair.packBar);
  var uHit = uBar && map[uBar] ? map[uBar] : null;
  var pHit = pBar && map[pBar] ? map[pBar] : null;
  if (!uHit && !pHit) return null;

  var primary = uHit || pHit;
  var matchedParts = [];
  if (uHit) matchedParts.push("บาร์เดี่ยว " + uBar + " ตรงกับ \"" + uHit.name + "\" (หมวด " + uHit.cat + ")");
  if (pHit && (!uHit || pHit.id !== uHit.id)) matchedParts.push("บาร์แพ็ค " + pBar + " ตรงกับ \"" + pHit.name + "\" (หมวด " + pHit.cat + ")");
  else if (pHit && uHit && pHit.id === uHit.id) matchedParts.push("บาร์แพ็ค " + pBar + " อยู่ในรายการเดียวกันแล้ว");

  return {
    isDup: true,
    uMatch: uHit,
    pMatch: pHit,
    primary: primary,
    existingName: primary.name,
    existingCat: primary.cat,
    existingUnitBar: primary.unitBar || "–",
    existingPackBar: primary.packBar || "–",
    detailText: matchedParts.join(" · ")
  };
}

function refreshAllPairDuplicates(existingRows) {
  if (Array.isArray(existingRows)) {
    PAIR_STATE.dbBarMap = buildDbBarcodeMap(existingRows);
  }
  var map = PAIR_STATE.dbBarMap || {};
  (PAIR_STATE.pairs || []).forEach(function (p) {
    p.unitBar = cleanBarcodeStr(p.unitBar);
    p.packBar = cleanBarcodeStr(p.packBar);
    p.dupInfo = evaluatePairDuplicate(p, map);
  });
}

function analyzeBarcodeItemName(rawName, rawUnit, rawPerPack, roleHint) {
  var name = String(rawName == null ? "" : rawName).replace(/\s+/g, " ").trim();
  var unit = String(rawUnit == null ? "" : rawUnit).replace(/\s+/g, " ").trim();
  var isPack = roleHint === "pack" ? true : roleHint === "unit" ? false : false;
  var base = name;

  var packRegexes = [
    /(?:ยก)?(?:แพ็ค|แพค|แพ็ก|ลัง|หิ้ว|มัด|ถาด|ชุด|กล่องใหญ่|กล่อง|pack|box|case|ctn)\s*(?:ละ\s*)?(\d{1,4})\s*(?:ชิ้น|อัน|ขวด|กระป๋อง|ซอง|กล่อง|ถุง|ห่อ|เล่ม|แท่ง|ก้อน|หลอด|เม็ด|ด้าม|ใบ|ม้วน|กป\.?|ขวด)?/gi,
    /(?:บรรจุ|ขนาดบรรจุ)\s*(\d{1,4})\s*(?:ชิ้น|อัน|ขวด|กระป๋อง|ซอง|กล่อง|ถุง|ห่อ|กป\.?)/gi,
    /\(?\s*(?:1\s*[xX×*]\s*)?(\d{1,4})\s*(?:ชิ้น|อัน|ขวด|กระป๋อง|ซอง|กล่อง|ถุง|ห่อ)\s*\/\s*(?:แพ็ค|แพค|แพ็ก|กล่อง|ลัง|หิ้ว|มัด|ถาด|pack|box)\s*\)?/gi,
    /\(\s*(?:แพ็ค|แพค|แพ็ก|ลัง|กล่อง|pack|box)\s*(\d{1,4})\s*\)/gi,
    /(?:1\s*)?[xX×*]\s*(\d{1,3})(?:\s*(?:ชิ้น|อัน|ขวด|กระป๋อง|ซอง|กล่อง|ถุง|ห่อ|แพ็ค|แพค))?(?=$|[\s)])/g
  ];

  for (var i = 0; i < packRegexes.length; i++) {
    base = base.replace(packRegexes[i], function (m, cnt) {
      var n = Number(cnt);
      if (n >= 2 && n <= 500) {
        if (roleHint !== "unit") isPack = true;
        return " ";
      }
      return m;
    });
  }

  base = base.replace(/(\d{1,2})\s*โหล/g, function () {
    if (roleHint !== "unit") isPack = true;
    return " ";
  });
  if (/(?:ยกโหล|\(\s*โหล\s*\)|\sโหล$)/i.test(base)) {
    if (roleHint !== "unit") isPack = true;
    base = base.replace(/(?:ยกโหล|\(\s*โหล\s*\)|\sโหล$)/gi, " ");
  }

  if (/(?:ยกลัง|ยกแพ็ค|ยกแพค|ยกแพ็ก|ยกกล่อง|ยกถาด|ยกหิ้ว|ยกมัด|\(\s*(?:แพ็ค|แพค|แพ็ก|ลัง|หิ้ว|มัด|ถาด)\s*\)|(?:\s|^)(?:แพ็ค|แพค|แพ็ก|ยกลัง)(?:\s|$))/i.test(base)) {
    if (roleHint !== "unit") isPack = true;
    base = base.replace(/(?:ยกลัง|ยกแพ็ค|ยกแพค|ยกแพ็ก|ยกกล่อง|ยกถาด|ยกหิ้ว|ยกมัด|\(\s*(?:แพ็ค|แพค|แพ็ก|ลัง|หิ้ว|มัด|ถาด)\s*\)|(?:\s|^)(?:แพ็ค|แพค|แพ็ก)(?:\s|$))/gi, " ");
  }

  if (unit && roleHint !== "unit") {
    if (/^(?:แพ็ค|แพค|แพ็ก|ลัง|โหล|หิ้ว|มัด|ถาด|กล่องใหญ่|pack|box|case|ctn|dozen)$/i.test(unit)) {
      isPack = true;
    } else if (/^(?:ชิ้น|อัน|ขวด|กระป๋อง|ซอง|ถุง|ห่อ|เล่ม|แท่ง|ก้อน|หลอด|ด้าม|ใบ|ม้วน|กป\.?|pcs?|unit|ea|bottle|can)$/i.test(unit) && roleHint !== "pack") {
      isPack = false;
    }
  }

  var cleanName = base.replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").replace(/[-–—/.,]+$/, "").trim() || name;

  var normMeasure = cleanName.toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*(?:มล\.?|มิลลิลิตร|ซีซี|ml\b|cc\b)\.?/gi, " $1ml ")
    .replace(/(\d+(?:\.\d+)?)\s*(?:ลิตร|ล\.|liter\b|ltr\b|l\b)\.?/gi, " $1l ")
    .replace(/(\d+(?:\.\d+)?)\s*(?:กรัม|ก\.|gram\b|gm\b|g\b)\.?/gi, " $1g ")
    .replace(/(\d+(?:\.\d+)?)\s*(?:กิโลกรัม|กก\.?|kg\b)\.?/gi, " $1kg ")
    .replace(/(\d+(?:\.\d+)?)\s*(?:ออนซ์|oz\b)\.?/gi, " $1oz ");

  var measureTokens = normMeasure.match(/\d+(?:\.\d+)?(?:ml|l|g|kg|oz)/g) || [];

  var normBase = normMeasure
    .replace(/[()[\]{}.,/_*'"\-–—+]+/g, " ")
    .replace(/(?:ขวด|กระป๋อง|กป|ซอง|ถุง|ห่อ|กล่อง|ชิ้น|อัน|รส)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  var tokens = normBase ? normBase.split(" ").filter(Boolean) : [];
  var compactBase = normBase.replace(/\s+/g, "");

  return {
    name: name,
    cleanName: cleanName,
    normBase: normBase || name.toLowerCase(),
    compactBase: compactBase || name.toLowerCase().replace(/\s+/g, ""),
    tokens: tokens,
    measureTokens: measureTokens,
    isPack: isPack,
    perPack: ""
  };
}

function charBigramDice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  var map = Object.create(null);
  var aCount = a.length - 1, bCount = b.length - 1;
  for (var i = 0; i < aCount; i++) {
    var bg = a.slice(i, i + 2);
    map[bg] = (map[bg] || 0) + 1;
  }
  var inter = 0;
  for (var j = 0; j < bCount; j++) {
    var bg2 = b.slice(j, j + 2);
    if (map[bg2] > 0) { inter++; map[bg2]--; }
  }
  return (2 * inter) / (aCount + bCount);
}

function tokenSetSimilarity(tA, tB) {
  if (!tA.length || !tB.length) return 0;
  var matchedA = 0, matchedB = 0;
  for (var i = 0; i < tA.length; i++) {
    var a = tA[i];
    if (tB.some(function (b) { return b === a || (a.length >= 3 && b.length >= 3 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)); })) matchedA++;
  }
  for (var j = 0; j < tB.length; j++) {
    var b = tB[j];
    if (tA.some(function (a) { return a === b || (a.length >= 3 && b.length >= 3 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)); })) matchedB++;
  }
  return (matchedA + matchedB) / (tA.length + tB.length);
}

function computeBarcodeNameSimilarity(uItem, pItem) {
  if (!uItem || !pItem) return 0;
  if (uItem.barcode && pItem.barcode && uItem.barcode === pItem.barcode) return 0;

  var a = uItem.info || analyzeBarcodeItemName(uItem.name, uItem.unit, "", "unit");
  var b = pItem.info || analyzeBarcodeItemName(pItem.name, pItem.unit, "", "pack");

  var score = 0;
  if (a.compactBase && a.compactBase === b.compactBase) {
    score = 0.98;
  } else {
    var dice = charBigramDice(a.compactBase, b.compactBase);
    var tokSim = tokenSetSimilarity(a.tokens, b.tokens);
    var prefixSim = 0;
    var minLen = Math.min(a.compactBase.length, b.compactBase.length);
    var maxLen = Math.max(a.compactBase.length, b.compactBase.length);
    if (minLen >= 4 && (a.compactBase.indexOf(b.compactBase) === 0 || b.compactBase.indexOf(a.compactBase) === 0)) {
      prefixSim = 0.78 + 0.20 * (minLen / maxLen);
    } else if (minLen >= 5 && (a.compactBase.indexOf(b.compactBase) >= 0 || b.compactBase.indexOf(a.compactBase) >= 0)) {
      prefixSim = 0.72 + 0.20 * (minLen / maxLen);
    }
    score = Math.max(dice * 0.58 + tokSim * 0.42, prefixSim);
  }

  if (a.measureTokens.length && b.measureTokens.length) {
    var sameMeasure = a.measureTokens.some(function (m) { return b.measureTokens.indexOf(m) >= 0; });
    if (sameMeasure) score += 0.05;
    else score -= 0.28;
  }

  if (uItem.partner && pItem.partner && uItem.partner === pItem.partner) score += 0.03;

  var pct = Math.round(Math.max(0, Math.min(0.99, score)) * 100);
  if (a.compactBase && a.compactBase === b.compactBase && pct < 96) pct = 98;
  return pct;
}

// กฎการจัดฝั่ง: ถ้าราคาต่างกัน ให้รายการที่ราคาถูกกว่าเป็น "บาร์เดี่ยว" (unit) และราคาแพงกว่าเป็น "บาร์แพ็ค" (pack) เสมอ
function orientUnitAndPack(a, b) {
  var pa = (a && a.price !== null && a.price !== undefined && Number.isFinite(Number(a.price)) && Number(a.price) > 0) ? Number(a.price) : null;
  var pb = (b && b.price !== null && b.price !== undefined && Number.isFinite(Number(b.price)) && Number(b.price) > 0) ? Number(b.price) : null;
  if (pa !== null && pb !== null && pa !== pb) {
    return pa < pb ? { unit: a, pack: b } : { unit: b, pack: a };
  }
  if (Boolean(a.isPack) !== Boolean(b.isPack)) {
    return a.isPack ? { unit: b, pack: a } : { unit: a, pack: b };
  }
  if ((a.name || "").length !== (b.name || "").length) {
    return (a.name || "").length < (b.name || "").length ? { unit: a, pack: b } : { unit: b, pack: a };
  }
  return { unit: a, pack: b };
}

function extractRawItemsFromSheet(grid, sheetName, roleHint, defaultCat) {
  grid = Array.isArray(grid) ? grid : [];
  var prePaired = [], singleRows = [];
  if (!grid.length) return { prePaired: prePaired, singleRows: singleRows };

  var hRow = -1, cols = {};
  for (var r = 0; r < Math.min(grid.length, 25); r++) {
    var row = grid[r] || [];
    var cMap = {};
    row.forEach(function (cell, c) {
      var t = String(cell == null ? "" : cell).replace(/\s+/g, " ").trim();
      if (!t) return;
      if (cMap.perPack === undefined && /ต่อแพ็ค|ต่อแพค|บรรจุ|ขนาดบรรจุ|ตัวคูณ|per\s*pack|pack\s*size/i.test(t)) cMap.perPack = c;
      else if (cMap.packBar === undefined && /แพ็ค|แพค|pack|ลัง|กล่อง/i.test(t) && /บาร์|bar|รหัส|เลข|code/i.test(t)) cMap.packBar = c;
      else if (cMap.unitBar === undefined && /เดี่ยว|เดียว|unit|single|ชิ้น|ย่อย/i.test(t) && /บาร์|bar|รหัส|เลข|code/i.test(t)) cMap.unitBar = c;
      else if (cMap.qtyPack === undefined && /คงเหลือ.*(?:แพ็ค|แพค|pack)|(?:แพ็ค|แพค|pack).*คงเหลือ|จำนวนในระบบ.*แพ็ค/i.test(t)) cMap.qtyPack = c;
      else if (cMap.qtyUnit === undefined && /คงเหลือ.*(?:เดี่ยว|เดียว|unit)|(?:เดี่ยว|เดียว|unit).*คงเหลือ|จำนวนในระบบ.*เดี่ยว/i.test(t)) cMap.qtyUnit = c;
      else if (cMap.pricePack === undefined && /ราคา.*(?:แพ็ค|แพค|pack)|(?:แพ็ค|แพค|pack).*ราคา/i.test(t)) cMap.pricePack = c;
      else if (cMap.priceUnit === undefined && /ราคา.*(?:เดี่ยว|เดียว|unit)|(?:เดี่ยว|เดียว|unit).*ราคา/i.test(t)) cMap.priceUnit = c;
      else if (cMap.barcode === undefined && /^(?:บาร์โค้ด|รหัสบาร์โค้ด|เลขบาร์โค้ด|เลขบาร์|บาร์|รหัสสินค้า|รหัสบาร์|รหัส|barcode|bar\s*code|item\s*code|product\s*code|plu|ean|sku|code)$/i.test(t)) cMap.barcode = c;
      else if (cMap.name === undefined && /(?:ชื่อสินค้า|ชื่อรายการ|รายการสินค้า|^รายการ$|^ชื่อ$|สินค้า|รายละเอียด|product\s*name|item\s*name|^name$|description)/i.test(t)) cMap.name = c;
      else if (cMap.unit === undefined && /^(?:หน่วย|หน่วยนับ|หน่วยขาย|unit|uom)$/i.test(t)) cMap.unit = c;
      else if (cMap.partner === undefined && /(?:รหัสคู่ค้า|คู่ค้า|รหัสผู้ขาย|ผู้ขาย|ผู้จำหน่าย|เจ้าหนี้|ซัพพลายเออร์|vender\s*code|vendor\s*code|vender\s*id|vendor\s*id|vender|vendor|supplier|partner)/i.test(t)) cMap.partner = c;
      else if (cMap.cat === undefined && /(?:หมวด|หมวดสินค้า|หมวดหมู่|กลุ่มสินค้า|^กลุ่ม$|ประเภท|category|group)/i.test(t)) cMap.cat = c;
      else if (cMap.qty === undefined && /(?:คงเหลือ|จำนวนคงเหลือ|จำนวนคงเหลือสินค้า|ยอดคงเหลือ|สต็อกคงเหลือ|สต๊อกคงเหลือ|สต็อก|สต๊อก|จำนวนในระบบ|^จำนวน$|qty|quantity|stock|balance|on\s*hand|remain)/i.test(t)) cMap.qty = c;
      else if (cMap.price === undefined && /(?:ราคาขายปลีก|ราคาขาย|ราคาต่อหน่วย|^ราคา$|ราคาปลีก|sale\s*price|selling\s*price|unit\s*price|retail\s*price|retail|^price$)/i.test(t)) cMap.price = c;
      else if (cMap.cost === undefined && /(?:ต้นทุนล่าสุด|ต้นทุน|ราคาทุน|^ทุน$|cost)/i.test(t)) cMap.cost = c;
    });
    if (cMap.price === undefined && cMap.cost !== undefined) cMap.price = cMap.cost;
    if (cMap.name !== undefined && (cMap.barcode !== undefined || cMap.packBar !== undefined || cMap.unitBar !== undefined)) {
      hRow = r;
      cols = cMap;
      break;
    }
  }

  if (hRow < 0) {
    var sampleRows = grid.slice(0, Math.min(grid.length, 15)).filter(function (r) { return Array.isArray(r) && r.some(Boolean); });
    if (sampleRows.length) {
      var maxC = Math.max.apply(null, sampleRows.map(function (r) { return r.length; }));
      var bcCol = -1, nameCol = -1, bestBcHits = 0, bestNameLen = 0;
      for (var c = 0; c < maxC; c++) {
        var bcHits = 0, totalLen = 0, textHits = 0;
        sampleRows.forEach(function (r) {
          var v = cleanBarcodeStr(r[c]);
          var raw = String(r[c] == null ? "" : r[c]).trim();
          if (/^\d{5,20}$/.test(v)) bcHits++;
          else if (raw && /[ก-๙a-zA-Z]/.test(raw)) { textHits++; totalLen += raw.length; }
        });
        if (bcHits > bestBcHits) { bestBcHits = bcHits; bcCol = c; }
        if (textHits > 0 && totalLen > bestNameLen && c !== bcCol) { bestNameLen = totalLen; nameCol = c; }
      }
      if (bcCol >= 0 && nameCol >= 0) {
        hRow = -1;
        cols = { barcode: bcCol, name: nameCol };
      }
    }
  }

  if (cols.name === undefined) return { prePaired: prePaired, singleRows: singleRows };

  var sheetRole = roleHint || (/แพ็ค|แพค|ลัง|pack|box/i.test(sheetName) ? "pack" : (/เดี่ยว|เดียว|ชิ้น|unit|single/i.test(sheetName) ? "unit" : ""));
  var explicitCat = String(defaultCat || "").trim();

  for (var ri = hRow + 1; ri < grid.length; ri++) {
    var g = grid[ri] || [];
    var name = String(g[cols.name] == null ? "" : g[cols.name]).replace(/\s+/g, " ").trim();
    if (!name || /^(?:รวม|รวมทั้งสิ้น|ชื่อสินค้า|ชื่อรายการ)$/i.test(name)) continue;

    var partner = cols.partner !== undefined ? String(g[cols.partner] == null ? "" : g[cols.partner]).trim() : "";
    var cat = explicitCat;
    var unit = cols.unit !== undefined ? String(g[cols.unit] == null ? "" : g[cols.unit]).trim() : "";
    var price = cols.price !== undefined ? parseOptNum(g[cols.price]) : null;
    var qty = cols.qty !== undefined ? parseOptNum(g[cols.qty]) : null;

    var pBar = cols.packBar !== undefined ? cleanBarcodeStr(g[cols.packBar]) : "";
    var uBar = cols.unitBar !== undefined ? cleanBarcodeStr(g[cols.unitBar]) : "";
    var singleBar = cols.barcode !== undefined ? cleanBarcodeStr(g[cols.barcode]) : "";

    if (pBar && uBar && pBar !== uBar) {
      var info = analyzeBarcodeItemName(name, unit, "", "");
      var uPrice = cols.priceUnit !== undefined ? parseOptNum(g[cols.priceUnit]) : null;
      var pPrice = cols.pricePack !== undefined ? parseOptNum(g[cols.pricePack]) : null;
      var uQty = cols.qtyUnit !== undefined ? parseOptNum(g[cols.qtyUnit]) : qty;
      var pQty = cols.qtyPack !== undefined ? parseOptNum(g[cols.qtyPack]) : null;
      if (uPrice !== null && pPrice !== null && uPrice > 0 && pPrice > 0 && uPrice > pPrice) {
        var tmpB = uBar; uBar = pBar; pBar = tmpB;
        var tmpP = uPrice; uPrice = pPrice; pPrice = tmpP;
        var tmpQ = uQty; uQty = pQty; pQty = tmpQ;
      }
      prePaired.push({
        similarity: 100,
        unitSourceName: name,
        packSourceName: name,
        partner: partner,
        cat: cat,
        name: info.cleanName || name,
        perPack: "",
        packBar: pBar,
        unitBar: uBar,
        unitPrice: uPrice,
        packPrice: pPrice,
        unitQty: uQty,
        packQty: pQty
      });
    } else if (pBar && !uBar) {
      var pInfo = analyzeBarcodeItemName(name, unit, "", "pack");
      singleRows.push({ barcode: pBar, name: name, unit: unit, perPack: "", partner: partner, cat: cat, price: price, qty: qty, isPack: true, info: pInfo });
    } else if (uBar && !pBar) {
      var uInfo = analyzeBarcodeItemName(name, unit, "", "unit");
      singleRows.push({ barcode: uBar, name: name, unit: unit, perPack: "", partner: partner, cat: cat, price: price, qty: qty, isPack: false, info: uInfo });
    } else if (singleBar) {
      var sInfo = analyzeBarcodeItemName(name, unit, "", sheetRole);
      singleRows.push({ barcode: singleBar, name: name, unit: unit, perPack: "", partner: partner, cat: cat, price: price, qty: qty, isPack: sInfo.isPack, info: sInfo });
    }
  }

  return { prePaired: prePaired, singleRows: singleRows };
}

function matchBarcodePairsFromSheets(sheets, options) {
  options = options || {};
  var minSim = Number(options.minSim) || 50;
  var defaultCat = String(options.defaultCat || "").trim();
  var existingRows = Array.isArray(options.existingRows) ? options.existingRows : [];
  var includeDbSingleForPairing = options.pairWithDb !== false;
  var stockMap = options.stockMap || PAIR_STATE.stockMap || {};
  var dbBarMap = buildDbBarcodeMap(existingRows);
  PAIR_STATE.dbBarMap = dbBarMap;

  var prePaired = [];
  var allSingle = [];
  var seenBar = new Set();

  (sheets || []).forEach(function (sh) {
    var extracted = extractRawItemsFromSheet(sh.grid, sh.name || "", sh.roleHint || "", defaultCat);
    extracted.prePaired.forEach(function (p) { prePaired.push(p); });
    extracted.singleRows.forEach(function (r) {
      r.barcode = cleanBarcodeStr(r.barcode);
      if (!r.barcode) return;
      if (r.qty === null || r.qty === undefined) r.qty = resolvePairQty(r.barcode, null, stockMap);
      if (r.price === null || r.price === undefined) r.price = resolvePairPrice(r.barcode, null, stockMap);
      var stEntry = lookupStockEntry(r.barcode, stockMap);
      if (!r.partner && stEntry && stEntry.partner) r.partner = stEntry.partner;
      var key = r.barcode + "|" + r.name;
      if (seenBar.has(key)) return;
      seenBar.add(key);
      allSingle.push(r);
    });
  });

  if (includeDbSingleForPairing) {
    existingRows.forEach(function (x) {
      var v = x.v || [];
      var partner = String(v[1] || "").trim();
      var cat = String(v[2] || "").trim();
      var name = String(v[3] || "").trim();
      var packBar = cleanBarcodeStr(v[5]);
      var unitBar = cleanBarcodeStr(v[7]);
      if (!name) return;
      if (unitBar && !packBar) {
        var uInfo = analyzeBarcodeItemName(name, "", "", "unit");
        var uSt = lookupStockEntry(unitBar, stockMap);
        allSingle.push({
          barcode: unitBar,
          name: name,
          unit: "",
          perPack: "",
          partner: partner || (uSt && uSt.partner) || "",
          cat: cat,
          price: resolvePairPrice(unitBar, null, stockMap),
          qty: resolvePairQty(unitBar, null, stockMap),
          isPack: false,
          fromDb: true,
          info: uInfo
        });
      } else if (packBar && !unitBar) {
        var pInfo = analyzeBarcodeItemName(name, "", "", "pack");
        var pSt = lookupStockEntry(packBar, stockMap);
        allSingle.push({
          barcode: packBar,
          name: name,
          unit: "",
          perPack: "",
          partner: partner || (pSt && pSt.partner) || "",
          cat: cat,
          price: resolvePairPrice(packBar, null, stockMap),
          qty: resolvePairQty(packBar, null, stockMap),
          isPack: true,
          fromDb: true,
          info: pInfo
        });
      }
    });
  }

  var primaryCandidates = [];
  var secondaryCandidates = [];

  for (var i = 0; i < allSingle.length; i++) {
    for (var j = i + 1; j < allSingle.length; j++) {
      var a = allSingle[i], b = allSingle[j];
      if (a.fromDb && b.fromDb) continue;
      if (a.barcode === b.barcode) continue;
      var sim = computeBarcodeNameSimilarity(a, b);
      if (sim < minSim) continue;

      var hasDiffPrice = (a.price !== null && a.price > 0 && b.price !== null && b.price > 0 && a.price !== b.price);
      var hasSamePrice = (a.price !== null && a.price > 0 && b.price !== null && b.price > 0 && a.price === b.price);
      var hasDiffPackFlag = (Boolean(a.isPack) !== Boolean(b.isPack));

      if (hasDiffPrice || (hasDiffPackFlag && !hasSamePrice)) {
        var bonus = (hasDiffPrice ? 2 : 0) + (hasDiffPackFlag ? 1 : 0);
        primaryCandidates.push({ i: i, j: j, sim: sim, rank: sim * 10 + bonus });
      } else if (!hasSamePrice && sim >= Math.max(minSim, 65)) {
        secondaryCandidates.push({ i: i, j: j, sim: sim, rank: sim * 10 });
      }
    }
  }

  primaryCandidates.sort(function (x, y) { return y.rank - x.rank; });
  secondaryCandidates.sort(function (x, y) { return y.rank - x.rank; });

  var usedIdx = new Set();
  var pairs = [];
  var seq = 1;

  prePaired.forEach(function (pp) {
    var uCode = cleanBarcodeStr(pp.unitBar);
    var pCode = cleanBarcodeStr(pp.packBar);
    var uSt = lookupStockEntry(uCode, stockMap);
    var pSt = lookupStockEntry(pCode, stockMap);
    var pairObj = {
      id: "pair_" + (seq++),
      selected: true,
      saved: false,
      similarity: pp.similarity,
      unitSourceName: pp.unitSourceName,
      packSourceName: pp.packSourceName,
      partner: pp.partner || (uSt && uSt.partner) || (pSt && pSt.partner) || "",
      cat: defaultCat || "",
      name: pp.name,
      perPack: "",
      packBar: pCode,
      unitBar: uCode,
      unitPrice: resolvePairPrice(uCode, pp.unitPrice, stockMap),
      packPrice: resolvePairPrice(pCode, pp.packPrice, stockMap),
      unitQty: resolvePairQty(uCode, pp.unitQty, stockMap),
      packQty: resolvePairQty(pCode, pp.packQty, stockMap)
    };
    pairObj.dupInfo = evaluatePairDuplicate(pairObj, dbBarMap);
    pairs.push(pairObj);
  });

  function addCandidatePair(c, minSelectSim) {
    if (usedIdx.has(c.i) || usedIdx.has(c.j)) return;
    usedIdx.add(c.i);
    usedIdx.add(c.j);
    var oriented = orientUnitAndPack(allSingle[c.i], allSingle[c.j]);
    var u = oriented.unit, p = oriented.pack;
    var uCode = cleanBarcodeStr(u.barcode);
    var pCode = cleanBarcodeStr(p.barcode);
    var pairObj = {
      id: "pair_" + (seq++),
      selected: c.sim >= minSelectSim,
      saved: false,
      similarity: c.sim,
      unitSourceName: u.name + (u.fromDb ? " (ในระบบ)" : ""),
      packSourceName: p.name + (p.fromDb ? " (ในระบบ)" : ""),
      partner: u.partner || p.partner || "",
      cat: defaultCat || "",
      name: (u.info && u.info.cleanName) || u.name,
      perPack: "",
      packBar: pCode,
      unitBar: uCode,
      unitPrice: resolvePairPrice(uCode, u.price, stockMap),
      packPrice: resolvePairPrice(pCode, p.price, stockMap),
      unitQty: resolvePairQty(uCode, u.qty, stockMap),
      packQty: resolvePairQty(pCode, p.qty, stockMap)
    };
    pairObj.dupInfo = evaluatePairDuplicate(pairObj, dbBarMap);
    pairs.push(pairObj);
  }

  primaryCandidates.forEach(function (c) { addCandidatePair(c, 60); });
  secondaryCandidates.forEach(function (c) { addCandidatePair(c, 75); });

  var unmatchedUnits = [];
  var unmatchedPacks = [];
  allSingle.forEach(function (it, idx) {
    if (usedIdx.has(idx) || it.fromDb) return;
    if (it.isPack) unmatchedPacks.push(it);
    else unmatchedUnits.push(it);
  });

  return { pairs: pairs, unmatchedUnits: unmatchedUnits, unmatchedPacks: unmatchedPacks };
}

function renderDraftBar() {
  var bar = $("#bcPairDraftBar"), statusEl = $("#bcPairDraftStatus");
  if (!bar || !statusEl) return;
  var hasData = (PAIR_STATE.pairs && PAIR_STATE.pairs.length > 0) ||
                (PAIR_STATE.unmatchedUnits && PAIR_STATE.unmatchedUnits.length > 0) ||
                (PAIR_STATE.unmatchedPacks && PAIR_STATE.unmatchedPacks.length > 0);
  if (!hasData || !PAIR_STATE.expiresAt || Date.now() > PAIR_STATE.expiresAt) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  var daysLeft = Math.max(1, Math.ceil((PAIR_STATE.expiresAt - Date.now()) / 86400000));
  statusEl.textContent = "บันทึกชั่วคราวไว้แล้วเมื่อ " + fmt(PAIR_STATE.savedAt || Date.now()) +
    " · เก็บไว้ 7 วัน (หมดอายุ " + thDate(PAIR_STATE.expiresAt) + " · เหลืออีก " + daysLeft + " วัน)";
}

function serializePairDraft() {
  return {
    savedAt: PAIR_STATE.savedAt,
    expiresAt: PAIR_STATE.expiresAt,
    nextId: PAIR_STATE.nextId || 1,
    pairs: (PAIR_STATE.pairs || []).map(function (p) {
      return {
        id: p.id,
        selected: !!p.selected,
        saved: !!p.saved,
        similarity: p.similarity,
        unitSourceName: p.unitSourceName || "",
        packSourceName: p.packSourceName || "",
        partner: p.partner || "",
        cat: p.cat || "",
        name: p.name || "",
        perPack: p.perPack || "",
        packBar: cleanBarcodeStr(p.packBar),
        unitBar: cleanBarcodeStr(p.unitBar),
        unitPrice: p.unitPrice !== undefined ? p.unitPrice : null,
        packPrice: p.packPrice !== undefined ? p.packPrice : null,
        unitQty: p.unitQty !== undefined ? p.unitQty : null,
        packQty: p.packQty !== undefined ? p.packQty : null
      };
    }),
    unmatchedUnits: (PAIR_STATE.unmatchedUnits || []).map(function (u) {
      return { barcode: cleanBarcodeStr(u.barcode), name: u.name, unit: u.unit || "", partner: u.partner || "", cat: u.cat || "", price: u.price, qty: u.qty, isPack: false };
    }),
    unmatchedPacks: (PAIR_STATE.unmatchedPacks || []).map(function (p) {
      return { barcode: cleanBarcodeStr(p.barcode), name: p.name, unit: p.unit || "", partner: p.partner || "", cat: p.cat || "", price: p.price, qty: p.qty, isPack: true };
    })
  };
}

function savePairDraftTemp(immediateCloud) {
  var hasData = (PAIR_STATE.pairs && PAIR_STATE.pairs.length > 0) ||
                (PAIR_STATE.unmatchedUnits && PAIR_STATE.unmatchedUnits.length > 0) ||
                (PAIR_STATE.unmatchedPacks && PAIR_STATE.unmatchedPacks.length > 0);
  if (!hasData) {
    PAIR_STATE.savedAt = 0;
    PAIR_STATE.expiresAt = 0;
    try { localStorage.removeItem(PAIR_STORAGE_KEY); } catch (_) {}
    renderDraftBar();
    return Promise.resolve(null);
  }
  var nowTs = Date.now();
  PAIR_STATE.savedAt = nowTs;
  PAIR_STATE.expiresAt = nowTs + PAIR_TTL_MS;
  var payload = serializePairDraft();
  try { localStorage.setItem(PAIR_STORAGE_KEY, JSON.stringify(payload)); } catch (_) {}
  renderDraftBar();

  if (!S.token) return Promise.resolve(payload);
  clearTimeout(pairCloudSaveTimer);
  if (immediateCloud) {
    return call("barcodePairDraftSave", payload).catch(function () { return payload; });
  }
  pairCloudSaveTimer = setTimeout(function () {
    call("barcodePairDraftSave", payload).catch(function () {});
  }, 600);
  return Promise.resolve(payload);
}

async function clearPairDraftTemp() {
  PAIR_STATE.pairs = [];
  PAIR_STATE.unmatchedUnits = [];
  PAIR_STATE.unmatchedPacks = [];
  PAIR_STATE.savedAt = 0;
  PAIR_STATE.expiresAt = 0;
  clearTimeout(pairCloudSaveTimer);
  try { localStorage.removeItem(PAIR_STORAGE_KEY); } catch (_) {}
  renderDraftBar();
  renderPairTable();
  if (S.token) {
    try { await call("barcodePairDraftSave", { clear: true }); } catch (_) {}
  }
}

function applyLoadedDraftToState(draft) {
  if (!draft || !draft.expiresAt || Date.now() > Number(draft.expiresAt)) return false;
  PAIR_STATE.savedAt = Number(draft.savedAt) || Date.now();
  PAIR_STATE.expiresAt = Number(draft.expiresAt);
  PAIR_STATE.pairs = Array.isArray(draft.pairs) ? draft.pairs.map(function (p, i) {
    var obj = {
      id: p.id || ("pair_" + (i + 1)),
      selected: p.selected !== undefined ? !!p.selected : !p.saved,
      saved: !!p.saved,
      similarity: Number(p.similarity) || 100,
      unitSourceName: p.unitSourceName || p.name || "",
      packSourceName: p.packSourceName || p.name || "",
      partner: p.partner || "",
      cat: p.cat !== undefined && p.cat !== null ? String(p.cat) : "",
      name: p.name || "",
      perPack: p.perPack !== undefined ? String(p.perPack) : "",
      packBar: cleanBarcodeStr(p.packBar),
      unitBar: cleanBarcodeStr(p.unitBar),
      unitPrice: p.unitPrice !== undefined ? p.unitPrice : null,
      packPrice: p.packPrice !== undefined ? p.packPrice : null,
      unitQty: p.unitQty !== undefined ? p.unitQty : null,
      packQty: p.packQty !== undefined ? p.packQty : null
    };
    obj.dupInfo = evaluatePairDuplicate(obj, PAIR_STATE.dbBarMap);
    return obj;
  }) : [];
  PAIR_STATE.unmatchedUnits = Array.isArray(draft.unmatchedUnits) ? draft.unmatchedUnits.map(function (u) {
    return Object.assign({}, u, { barcode: cleanBarcodeStr(u.barcode), info: analyzeBarcodeItemName(u.name, u.unit, "", "unit") });
  }) : [];
  PAIR_STATE.unmatchedPacks = Array.isArray(draft.unmatchedPacks) ? draft.unmatchedPacks.map(function (p) {
    return Object.assign({}, p, { barcode: cleanBarcodeStr(p.barcode), info: analyzeBarcodeItemName(p.name, p.unit, "", "pack") });
  }) : [];
  PAIR_STATE.nextId = (PAIR_STATE.pairs.length || 0) + 1;
  return true;
}

function enrichPairStateFromStockMap() {
  var map = PAIR_STATE.stockMap || {};
  (PAIR_STATE.pairs || []).forEach(function (p) {
    p.unitBar = cleanBarcodeStr(p.unitBar);
    p.packBar = cleanBarcodeStr(p.packBar);
    p.unitQty = resolvePairQty(p.unitBar, p.unitQty, map);
    p.packQty = resolvePairQty(p.packBar, p.packQty, map);
    p.unitPrice = resolvePairPrice(p.unitBar, p.unitPrice, map);
    p.packPrice = resolvePairPrice(p.packBar, p.packPrice, map);
    if (!p.partner) {
      var uSt = lookupStockEntry(p.unitBar, map), pSt = lookupStockEntry(p.packBar, map);
      p.partner = (uSt && uSt.partner) || (pSt && pSt.partner) || "";
    }
    p.dupInfo = evaluatePairDuplicate(p, PAIR_STATE.dbBarMap);
  });
  (PAIR_STATE.unmatchedUnits || []).forEach(function (u) {
    u.barcode = cleanBarcodeStr(u.barcode);
    u.qty = resolvePairQty(u.barcode, u.qty, map);
    u.price = resolvePairPrice(u.barcode, u.price, map);
  });
  (PAIR_STATE.unmatchedPacks || []).forEach(function (p) {
    p.barcode = cleanBarcodeStr(p.barcode);
    p.qty = resolvePairQty(p.barcode, p.qty, map);
    p.price = resolvePairPrice(p.barcode, p.price, map);
  });
}

async function ensureDbBarMapLoaded() {
  if (!S.token) return;
  try {
    var dbAll = (S.data && curCat() && curCat().all) ? S.data : await call("getCategoryData", allCat().sheet, "*");
    if (dbAll && Array.isArray(dbAll.rows)) {
      refreshAllPairDuplicates(dbAll.rows);
    }
  } catch (_) {}
}

async function initPairContextAndRestoreDraft() {
  var restoredLocal = false;
  try {
    var rawLocal = localStorage.getItem(PAIR_STORAGE_KEY);
    if (rawLocal) {
      var parsedLocal = JSON.parse(rawLocal);
      if (parsedLocal && parsedLocal.expiresAt && Date.now() <= Number(parsedLocal.expiresAt)) {
        restoredLocal = applyLoadedDraftToState(parsedLocal);
      } else {
        localStorage.removeItem(PAIR_STORAGE_KEY);
      }
    }
  } catch (_) {}

  if (restoredLocal) {
    renderDraftBar();
    renderPairTable();
  }

  if (!S.token) return;
  try {
    var ctx = await call("barcodePairContext");
    if (ctx && ctx.stockMap) {
      PAIR_STATE.stockMap = ctx.stockMap;
    }
    if (ctx && ctx.draft && ctx.draft.expiresAt && Date.now() <= Number(ctx.draft.expiresAt)) {
      if (!restoredLocal || (Number(ctx.draft.savedAt) > (PAIR_STATE.savedAt || 0))) {
        if (applyLoadedDraftToState(ctx.draft)) {
          try { localStorage.setItem(PAIR_STORAGE_KEY, JSON.stringify(serializePairDraft())); } catch (_) {}
        }
      }
    }
    await ensureDbBarMapLoaded();
    enrichPairStateFromStockMap();
    renderDraftBar();
    renderPairTable();
  } catch (_) {}
}

function buildPairExportData() {
  var pairs = PAIR_STATE.pairs || [];
  var head = [
    "ลำดับ",
    "สถานะในระบบ",
    "ความคล้าย (%)",
    "รหัสคู่ค้า (Vender)",
    "หมวด",
    "ชื่อรายการ",
    "จำนวนต่อแพ็ค",
    "เลขบาร์เดี่ยว",
    "ราคาบาร์เดี่ยว",
    "คงเหลือบาร์เดี่ยว",
    "เลขบาร์แพ็ค",
    "ราคาบาร์แพ็ค",
    "คงเหลือบาร์แพ็ค",
    "ชื่อบาร์เดี่ยวในไฟล์",
    "ชื่อบาร์แพ็คในไฟล์",
    "ข้อมูลเดิมในระบบ (กรณีซ้ำ)",
    "ผลการตรวจหน้าร้าน / หมายเหตุ"
  ];
  var rows = pairs.map(function (p, i) {
    var uCode = cleanBarcodeStr(p.unitBar);
    var pCode = cleanBarcodeStr(p.packBar);
    var uQty = resolvePairQty(uCode, p.unitQty);
    var pQty = resolvePairQty(pCode, p.packQty);
    var uPrice = resolvePairPrice(uCode, p.unitPrice);
    var pPrice = resolvePairPrice(pCode, p.packPrice);
    var dup = p.dupInfo || evaluatePairDuplicate(p, PAIR_STATE.dbBarMap);
    var sysStatus = p.saved
      ? "บันทึกเข้าระบบแล้ว"
      : (dup ? "มีในระบบแล้ว (รอยืนยันบันทึกทับ)" : "รายการใหม่ (ยังไม่มีในระบบ)");
    var dupDetail = dup
      ? (dup.existingName + " [หมวด " + dup.existingCat + " · เดี่ยวเดิม: " + dup.existingUnitBar + " / แพ็คเดิม: " + dup.existingPackBar + "]")
      : "";
    return [
      i + 1,
      sysStatus,
      p.similarity != null ? p.similarity : "",
      p.partner || "",
      p.cat || "",
      p.name || "",
      p.perPack || "",
      uCode,
      uPrice !== null ? uPrice : "",
      uQty !== null ? uQty : "",
      pCode,
      pPrice !== null ? pPrice : "",
      pQty !== null ? pQty : "",
      p.unitSourceName || "",
      p.packSourceName || "",
      dupDetail,
      ""
    ];
  });
  return { head: head, rows: rows, filename: "ตารางตรวจสอบจับคู่บาร์เดี่ยว-แพ็ค_" + thaiDayIso() + ".xlsx" };
}

function exportPairedBarcodesToExcel() {
  if (!PAIR_STATE.pairs || !PAIR_STATE.pairs.length) {
    toast("ยังไม่มีรายการจับคู่สำหรับส่งออก", true);
    return null;
  }
  if (typeof XLSX === "undefined") {
    toast("โหลดตัวสร้าง Excel ไม่สำเร็จ กรุณารีเฟรชหน้านี้", true);
    return null;
  }
  var exp = buildPairExportData();
  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet([exp.head].concat(exp.rows));
  ws["!cols"] = [
    { wch: 6 }, { wch: 24 }, { wch: 12 }, { wch: 15 }, { wch: 14 },
    { wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 14 },
    { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 26 }, { wch: 26 },
    { wch: 34 }, { wch: 22 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, "ตรวจสอบจับคู่บาร์");
  if (typeof XLSX.writeFile === "function") {
    try { XLSX.writeFile(wb, exp.filename); } catch (_) {}
  }
  toast("ส่งออกไฟล์ " + exp.filename + " (" + exp.rows.length + " คู่) เรียบร้อยแล้ว");
  return exp;
}

function readWorkbookSheetsFromFile(file, roleHint) {
  return new Promise(function (resolve, reject) {
    var fr = new FileReader();
    fr.onerror = function () { reject(new Error("อ่านไฟล์ " + file.name + " ไม่ได้")); };
    fr.onload = function () {
      try {
        var wb = XLSX.read(fr.result, { type: "array", dense: true, cellStyles: false, cellFormula: false, cellHTML: false });
        var sheets = wb.SheetNames.map(function (n) {
          var g = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" });
          delete wb.Sheets[n];
          return { name: n, grid: g, roleHint: roleHint || "" };
        });
        resolve(sheets);
      } catch (e) {
        reject(new Error("อ่านไฟล์ Excel ไม่สำเร็จ: " + e.message));
      }
    };
    fr.readAsArrayBuffer(file);
  });
}

function pairReviewSource(kind, name, barcode, price, qty) {
  return '<div class="pair-source">' +
    '<div class="pair-source-head"><span class="pair-source-kind">' + kind + '</span><span class="pair-source-name">' + esc(name || '–') + '</span></div>' +
    '<div class="pair-source-meta"><code>' + esc(barcode || '–') + '</code>' +
      (price !== null ? '<span>ราคา ฿' + esc(fmtOptNum(price)) + '</span>' : '') +
      '<span>คงเหลือ ' + esc(fmtOptNum(qty)) + '</span></div></div>';
}

function pairReviewRow(p, idx) {
  var uCode = cleanBarcodeStr(p.unitBar), pCode = cleanBarcodeStr(p.packBar);
  var uQty = resolvePairQty(uCode, p.unitQty), pQty = resolvePairQty(pCode, p.packQty);
  var uPrice = resolvePairPrice(uCode, p.unitPrice), pPrice = resolvePairPrice(pCode, p.packPrice);
  var dup = p.dupInfo && p.dupInfo.isDup ? p.dupInfo : null;
  var disabled = p.saved ? ' disabled' : '';
  var matchNote = p.similarity >= 80 ? 'ตรงกันมาก' : p.similarity >= 65 ? 'คล้ายกัน' : 'ควรตรวจสอบ';
  var state = p.saved ? 'บันทึกแล้ว' : dup ? 'มีในระบบ' : 'รายการใหม่';
  var duplicate = dup ? '<details class="pair-existing"><summary>ยืนยันแล้วจะบันทึกทับ: ' + esc(dup.existingName) + '</summary>' +
    '<div>หมวด ' + esc(dup.existingCat || '–') + '<br>บาร์เดี่ยวเดิม <code>' + esc(dup.existingUnitBar || '–') + '</code>' +
    '<br>บาร์แพ็คเดิม <code>' + esc(dup.existingPackBar || '–') + '</code></div></details>' : '';
  return '<tr data-pair-id="' + esc(p.id) + '" class="' + (p.saved ? 'pair-saved' : dup ? 'pair-dup' : '') + '">' +
    '<td class="pair-select-cell"><input type="checkbox" class="pair-sel-chk" data-pair-act="check"' +
      (p.selected ? ' checked' : '') + disabled + ' aria-label="เลือกคู่ ' + esc(p.name) + '"><span class="pair-row-no">' + (idx + 1) + '</span></td>' +
    '<td><div class="pair-sources">' +
      pairReviewSource('เดี่ยว', p.unitSourceName, uCode, uPrice, uQty) +
      pairReviewSource('แพ็ค', p.packSourceName, pCode, pPrice, pQty) + duplicate + '</div></td>' +
    '<td class="pair-status-cell"><span class="pair-sim-value">' + esc(p.similarity) + '%</span><small class="pair-match-note">' + matchNote + '</small>' +
      '<span class="pair-state ' + (p.saved ? 'saved' : dup ? 'dup' : 'new') + '">' + state + '</span></td>' +
    '<td><div class="pair-edit-stack"><label class="pair-mini-lbl">ชื่อสินค้า<input type="text" data-pair-field="name" value="' + esc(p.name) + '"' + disabled + '></label>' +
      '<div class="pair-sub-grid"><label class="pair-mini-lbl">รหัสคู่ค้า<input type="text" data-pair-field="partner" value="' + esc(p.partner) + '"' + disabled + '></label>' +
        '<label class="pair-mini-lbl">หมวดสินค้า<input type="text" data-pair-field="cat" list="dlCats" value="' + esc(p.cat) + '"' + disabled + ' placeholder="เว้นว่างได้"></label>' +
        '<label class="pair-mini-lbl">จำนวนต่อแพ็ค<input type="text" data-pair-field="perPack" value="' + esc(p.perPack) + '"' + disabled + ' placeholder="เว้นว่างได้"></label></div></div></td>' +
    '<td><div class="pair-bars-stack"><label class="pair-bar-field"><span>เดี่ยว</span><input type="text" class="code-inp" data-pair-field="unitBar" value="' + esc(uCode) + '"' + disabled + ' placeholder="เลขบาร์เดี่ยว"></label>' +
      '<label class="pair-bar-field"><span>แพ็ค</span><input type="text" class="code-inp" data-pair-field="packBar" value="' + esc(pCode) + '"' + disabled + ' placeholder="เลขบาร์แพ็ค"></label>' +
      '<button type="button" class="pair-swap" data-pair-act="swap"' + disabled + ' aria-label="สลับบาร์เดี่ยวกับบาร์แพ็คของ ' + esc(p.name) + '">สลับเดี่ยว / แพ็ค</button></div></td>' +
    '<td class="act"><div class="pair-act-stack">' + (p.saved ? '<span class="pair-save-note">—</span>' :
      '<button type="button" class="btn ghost small' + (dup ? ' pair-overwrite' : '') + '" data-pair-act="confirm-one">' + (dup ? 'บันทึกทับ' : 'บันทึก') + '</button>' +
      '<button type="button" class="pair-remove" data-pair-act="remove">ตัดออก</button>') + '</div></td></tr>';
}


function renderPairTable() {
  var card = $("#bcPairResultCard"), manualCard = $("#bcPairManualCard");
  if (!card) return;
  renderDraftBar();
  var pairs = PAIR_STATE.pairs || [];
  if (!pairs.length && !PAIR_STATE.unmatchedUnits.length && !PAIR_STATE.unmatchedPacks.length) {
    card.classList.add("hidden");
    if (manualCard) manualCard.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");

  var q = ($("#bcPairSearch") ? $("#bcPairSearch").value : "").trim().toLowerCase();
  var filterMode = ($("#bcPairFilterMode") ? $("#bcPairFilterMode").value : "all") || "all";

  var activePairs = pairs.filter(function (p) { return !p.saved; });
  var dupPairs = activePairs.filter(function (p) { return !!(p.dupInfo && p.dupInfo.isDup); });
  var newPairs = activePairs.filter(function (p) { return !(p.dupInfo && p.dupInfo.isDup); });
  var selectedPairs = activePairs.filter(function (p) { return p.selected; });
  var selectedDupCount = selectedPairs.filter(function (p) { return !!(p.dupInfo && p.dupInfo.isDup); }).length;
  var savedCount = pairs.length - activePairs.length;

  var visible = pairs.filter(function (p) {
    var isDup = !!(p.dupInfo && p.dupInfo.isDup);
    if (filterMode === "new" && (isDup || p.saved)) return false;
    if (filterMode === "dup" && (!isDup || p.saved)) return false;
    if (filterMode === "selected" && !p.selected) return false;
    if (!q) return true;
    return [
      p.name, p.unitSourceName, p.packSourceName, p.packBar, p.unitBar, p.cat, p.partner,
      isDup ? p.dupInfo.existingName : ""
    ].join(" ").toLowerCase().indexOf(q) >= 0;
  });

  $("#bcPairSummaryText").innerHTML =
    '<span class="pair-stat-chip">ทั้งหมด <b>' + pairs.length + '</b> คู่</span>' +
    '<span class="pair-stat-chip">ใหม่ <b>' + newPairs.length + '</b></span>' +
    '<span class="pair-stat-chip">มีในระบบ <b>' + dupPairs.length + '</b></span>' +
    '<span class="pair-stat-chip sel">เลือก <b>' + selectedPairs.length + '</b> คู่' + (selectedDupCount ? ' · บันทึกทับ ' + selectedDupCount : '') + '</span>' +
    (savedCount ? '<span class="pair-stat-chip">บันทึกแล้ว <b>' + savedCount + '</b></span>' : '');
  var confirmBtn = $("#bcPairConfirmSelectedBtn");
  if (confirmBtn) {
    confirmBtn.disabled = selectedPairs.length === 0;
    confirmBtn.textContent = 'บันทึก ' + selectedPairs.length + ' คู่ที่เลือก' + (selectedDupCount ? ' (ทับ ' + selectedDupCount + ')' : '');
  }
  $("#bcPairTbody").innerHTML = visible.length ? visible.map(pairReviewRow).join('') : '<tr><td colspan="6" class="empty">ไม่พบคู่รายการตามตัวกรองหรือคำค้นหา</td></tr>';

  if (manualCard) {
    var uList = PAIR_STATE.unmatchedUnits || [];
    var pList = PAIR_STATE.unmatchedPacks || [];
    if (uList.length || pList.length) {
      manualCard.classList.remove("hidden");
      $("#bcPairUnmatchedCount").textContent = "รายการที่ยังไม่ถูกจับคู่: ฝั่งบาร์เดี่ยว " + uList.length + " รายการ · ฝั่งบาร์แพ็ค " + pList.length + " รายการ";
      var allPool = uList.concat(pList);
      var fmtOpt = function (it, idx) {
        var bCode = cleanBarcodeStr(it.barcode);
        var qv = resolvePairQty(bCode, it.qty);
        var pv = resolvePairPrice(bCode, it.price);
        return "<option value=\"" + idx + "\">" + esc(it.name) + " (" + esc(bCode) +
          (pv !== null ? " · ฿" + esc(fmtOptNum(pv)) : "") +
          " · คงเหลือ " + esc(fmtOptNum(qv)) + ")</option>";
      };
      var uOpts = (uList.length ? uList : allPool).map(fmtOpt).join("");
      var pOpts = (pList.length ? pList : allPool).map(fmtOpt).join("");
      $("#bcPairManualUnit").innerHTML = uOpts || "<option value=\"\">-- ไม่มีรายการ --</option>";
      $("#bcPairManualPack").innerHTML = pOpts || "<option value=\"\">-- ไม่มีรายการ --</option>";
    } else {
      manualCard.classList.add("hidden");
    }
  }
}

async function confirmAndSavePairItems(pairObjs) {
  if (!pairObjs || !pairObjs.length) {
    toast("กรุณาเลือกคู่ที่ต้องการยืนยันอย่างน้อย 1 คู่", true);
    return;
  }
  for (var i = 0; i < pairObjs.length; i++) {
    var p = pairObjs[i];
    p.unitBar = cleanBarcodeStr(p.unitBar);
    p.packBar = cleanBarcodeStr(p.packBar);
    if (!String(p.name || "").trim()) {
      toast("กรุณากรอกชื่อรายการที่จะบันทึกให้ครบถ้วน", true);
      return;
    }
    if (!p.packBar && !p.unitBar) {
      toast("รายการ \"" + p.name + "\" ต้องมีเลขบาร์แพ็คหรือเลขบาร์เดี่ยว", true);
      return;
    }
    p.dupInfo = evaluatePairDuplicate(p, PAIR_STATE.dbBarMap);
  }

  var dupItems = pairObjs.filter(function (p) { return !!(p.dupInfo && p.dupInfo.isDup); });
  if (dupItems.length > 0) {
    var previewLines = dupItems.slice(0, 6).map(function (p) {
      return "• " + p.name + " (เดี่ยว: " + (p.unitBar || "-") + " / แพ็ค: " + (p.packBar || "-") + ") → มีในระบบแล้ว: \"" + p.dupInfo.existingName + "\" [หมวด " + p.dupInfo.existingCat + "]";
    }).join("\n");
    if (dupItems.length > 6) previewLines += "\n...และอีก " + (dupItems.length - 6) + " คู่";
    var okOverwrite = confirm(
      "พบรายการที่มีเลขรหัสบาร์ซ้ำกับในระบบ จำนวน " + dupItems.length + " คู่:\n\n" +
      previewLines +
      "\n\nต้องการบันทึกทับข้อมูลเดิมในระบบหรือไม่? (ระบบจะตัดตัวอักษร P ออกจากเลขบาร์ให้อัตโนมัติ)"
    );
    if (!okOverwrite) return;
  }

  var payload = pairObjs.map(function (p) {
    return {
      partner: String(p.partner || "").trim(),
      cat: String(p.cat || "").trim() || "ไม่ระบุหมวด",
      name: String(p.name || "").trim(),
      perPack: String(p.perPack || "").trim(),
      packBar: cleanBarcodeStr(p.packBar),
      unitBar: cleanBarcodeStr(p.unitBar)
    };
  });
  var res = await withSaving(call("confirmBarcodePairs", { pairs: payload }));
  BC_BK = res.backups || BC_BK;
  bcBkRender();
  pairObjs.forEach(function (p) { p.saved = true; p.selected = false; });
  savePairDraftTemp(true);
  await refreshCats();
  if (S.cur) await selectCat(S.cur);
  await ensureDbBarMapLoaded();
  renderPairTable();
  toast("ยืนยันบันทึกคู่บาร์เดี่ยว/แพ็คสำเร็จ " + res.count + " คู่ (เพิ่มใหม่ " + res.created + " · บันทึกทับ/อัปเดต " + res.updated + ")");
}

if ($("#btnOpenPairTab")) {
  $("#btnOpenPairTab").addEventListener("click", function () { switchTab("pair"); });
}
if ($("#bcPairFile")) {
  $("#bcPairFile").addEventListener("change", function () {
    $("#bcPairAnalyzeBtn").disabled = !this.files.length;
  });
}
if ($("#bcPairAnalyzeBtn")) {
  $("#bcPairAnalyzeBtn").addEventListener("click", function () {
    var f1 = $("#bcPairFile").files && $("#bcPairFile").files[0];
    var f2 = $("#bcPairPackFile") && $("#bcPairPackFile").files && $("#bcPairPackFile").files[0];
    if (!f1) { toast("กรุณาเลือกไฟล์รายการสินค้าก่อน", true); return; }
    if (typeof XLSX === "undefined") { toast("โหลดตัวอ่าน Excel ไม่สำเร็จ กรุณารีเฟรชหน้านี้", true); return; }
    busy(this, async function () {
      var sheets1 = await readWorkbookSheetsFromFile(f1, f2 ? "unit" : "");
      var sheets2 = f2 ? await readWorkbookSheetsFromFile(f2, "pack") : [];
      var allSheets = sheets1.concat(sheets2);

      // ดึงข้อมูลในระบบเสมอเพื่อใช้เทียบเช็คเลขบาร์ซ้ำ (ไม่รวมตัว P)
      var existingRows = [];
      try {
        var dbAll = (S.data && curCat() && curCat().all) ? S.data : await call("getCategoryData", allCat().sheet, "*");
        existingRows = (dbAll && dbAll.rows) || [];
      } catch (_) {}

      try {
        var ctx = await call("barcodePairContext");
        if (ctx && ctx.stockMap) PAIR_STATE.stockMap = ctx.stockMap;
      } catch (_) {}

      var minSim = Number($("#bcPairMinSim") ? $("#bcPairMinSim").value : 50) || 50;
      var defCat = ($("#bcPairDefCat") ? $("#bcPairDefCat").value : "").trim();
      var pairWithDb = !($("#bcPairWithDb") && !$("#bcPairWithDb").checked);
      var result = matchBarcodePairsFromSheets(allSheets, {
        minSim: minSim,
        defaultCat: defCat,
        existingRows: existingRows,
        pairWithDb: pairWithDb,
        stockMap: PAIR_STATE.stockMap
      });
      PAIR_STATE.pairs = result.pairs;
      PAIR_STATE.unmatchedUnits = result.unmatchedUnits;
      PAIR_STATE.unmatchedPacks = result.unmatchedPacks;
      PAIR_STATE.nextId = result.pairs.length + 1;
      await savePairDraftTemp(true);
      renderPairTable();
      if (!result.pairs.length) {
        toast("ไม่พบคู่ที่มีความคล้ายตั้งแต่ " + minSim + "% ขึ้นไป (ลองลดเปอร์เซ็นต์ความคล้ายขั้นต่ำ หรือจับคู่ด้วยตนเองด้านล่าง)", true);
      } else {
        var dupCnt = result.pairs.filter(function (p) { return !!(p.dupInfo && p.dupInfo.isDup); }).length;
        toast("พบคู่บาร์เดี่ยว/แพ็ค " + result.pairs.length + " คู่ (รายการใหม่ " + (result.pairs.length - dupCnt) + " · มีในระบบแล้ว " + dupCnt + " คู่)");
      }
    });
  });
}
if ($("#bcPairSaveDraftBtn")) {
  $("#bcPairSaveDraftBtn").addEventListener("click", function () {
    busy(this, async function () {
      await savePairDraftTemp(true);
      toast("บันทึกการจับคู่ไว้ชั่วคราว 7 วันเรียบร้อยแล้ว");
    });
  });
}
if ($("#bcPairClearDraftBtn")) {
  $("#bcPairClearDraftBtn").addEventListener("click", function () {
    if (!confirm("ล้างข้อมูลการจับคู่ที่บันทึกไว้ชั่วคราวทั้งหมดหรือไม่?")) return;
    busy(this, async function () {
      await clearPairDraftTemp();
      toast("ล้างข้อมูลการจับคู่ชั่วคราวแล้ว");
    });
  });
}
if ($("#bcPairExportBtn")) {
  $("#bcPairExportBtn").addEventListener("click", function () {
    exportPairedBarcodesToExcel();
  });
}
if ($("#bcPairSearch")) {
  $("#bcPairSearch").addEventListener("input", renderPairTable);
}
if ($("#bcPairFilterMode")) {
  $("#bcPairFilterMode").addEventListener("change", renderPairTable);
}
if ($("#bcPairSelectAllBtn")) {
  $("#bcPairSelectAllBtn").addEventListener("click", function () {
    (PAIR_STATE.pairs || []).forEach(function (p) { if (!p.saved) p.selected = true; });
    savePairDraftTemp(false);
    renderPairTable();
  });
}
if ($("#bcPairSelectNewBtn")) {
  $("#bcPairSelectNewBtn").addEventListener("click", function () {
    (PAIR_STATE.pairs || []).forEach(function (p) {
      if (!p.saved) p.selected = !(p.dupInfo && p.dupInfo.isDup);
    });
    savePairDraftTemp(false);
    renderPairTable();
  });
}
if ($("#bcPairSelectHighBtn")) {
  $("#bcPairSelectHighBtn").addEventListener("click", function () {
    (PAIR_STATE.pairs || []).forEach(function (p) { if (!p.saved) p.selected = p.similarity >= 70; });
    savePairDraftTemp(false);
    renderPairTable();
  });
}
if ($("#bcPairClearSelBtn")) {
  $("#bcPairClearSelBtn").addEventListener("click", function () {
    (PAIR_STATE.pairs || []).forEach(function (p) { p.selected = false; });
    savePairDraftTemp(false);
    renderPairTable();
  });
}
if ($("#bcPairApplyBulkCatBtn")) {
  $("#bcPairApplyBulkCatBtn").addEventListener("click", function () {
    var catVal = ($("#bcPairBulkCatInput") ? $("#bcPairBulkCatInput").value : "").trim();
    var targets = (PAIR_STATE.pairs || []).filter(function (p) { return !p.saved && p.selected; });
    if (!targets.length) {
      toast("กรุณาติ๊กเลือกคู่รายการที่ต้องการกำหนดหมวดหมู่ก่อน", true);
      return;
    }
    targets.forEach(function (p) { p.cat = catVal; });
    savePairDraftTemp(false);
    renderPairTable();
    toast(catVal ? ("กำหนดหมวด \"" + catVal + "\" ให้ " + targets.length + " คู่ที่เลือกแล้ว") : ("ล้างหมวดของ " + targets.length + " คู่ที่เลือกแล้ว"));
  });
}
if ($("#bcPairConfirmSelectedBtn")) {
  $("#bcPairConfirmSelectedBtn").addEventListener("click", function () {
    var chosen = (PAIR_STATE.pairs || []).filter(function (p) { return !p.saved && p.selected; });
    if (!chosen.length) { toast("กรุณาติ๊กเลือกคู่ที่ต้องการยืนยันอย่างน้อย 1 คู่", true); return; }
    busy(this, function () { return confirmAndSavePairItems(chosen); });
  });
}
if ($("#bcPairTbody")) {
  $("#bcPairTbody").addEventListener("input", function (e) {
    var inp = e.target.closest("input[data-pair-field]");
    if (!inp) return;
    var tr = inp.closest("tr[data-pair-id]");
    if (!tr) return;
    var item = (PAIR_STATE.pairs || []).filter(function (p) { return p.id === tr.dataset.pairId; })[0];
    if (item && !item.saved) {
      var fld = inp.dataset.pairField;
      if (fld === "packBar" || fld === "unitBar") {
        var cleaned = cleanBarcodeStr(inp.value);
        if (inp.value !== cleaned) inp.value = cleaned;
        item[fld] = cleaned;
        item.dupInfo = evaluatePairDuplicate(item, PAIR_STATE.dbBarMap);
      } else {
        item[fld] = inp.value;
      }
      savePairDraftTemp(false);
    }
  });
  $("#bcPairTbody").addEventListener("change", function (e) {
    var inpField = e.target.closest("input[data-pair-field]");
    if (inpField && (inpField.dataset.pairField === "packBar" || inpField.dataset.pairField === "unitBar")) {
      renderPairTable();
      return;
    }
    var chk = e.target.closest("input[data-pair-act=\"check\"]");
    if (!chk) return;
    var tr = chk.closest("tr[data-pair-id]");
    if (!tr) return;
    var item = (PAIR_STATE.pairs || []).filter(function (p) { return p.id === tr.dataset.pairId; })[0];
    if (item && !item.saved) {
      item.selected = chk.checked;
      savePairDraftTemp(false);
      renderPairTable();
    }
  });
  $("#bcPairTbody").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-pair-act]");
    if (!btn) return;
    var tr = btn.closest("tr[data-pair-id]");
    if (!tr) return;
    var item = (PAIR_STATE.pairs || []).filter(function (p) { return p.id === tr.dataset.pairId; })[0];
    if (!item || item.saved) return;
    var act = btn.dataset.pairAct;
    if (act === "swap") {
      var tmpBar = item.unitBar; item.unitBar = item.packBar; item.packBar = tmpBar;
      var tmpNm = item.unitSourceName; item.unitSourceName = item.packSourceName; item.packSourceName = tmpNm;
      var tmpPr = item.unitPrice; item.unitPrice = item.packPrice; item.packPrice = tmpPr;
      var tmpQt = item.unitQty; item.unitQty = item.packQty; item.packQty = tmpQt;
      item.dupInfo = evaluatePairDuplicate(item, PAIR_STATE.dbBarMap);
      savePairDraftTemp(false);
      renderPairTable();
    } else if (act === "remove") {
      PAIR_STATE.pairs = PAIR_STATE.pairs.filter(function (p) { return p.id !== item.id; });
      savePairDraftTemp(false);
      renderPairTable();
    } else if (act === "confirm-one") {
      busy(btn, function () { return confirmAndSavePairItems([item]); });
    }
  });
}
if ($("#bcPairManualAddBtn")) {
  $("#bcPairManualAddBtn").addEventListener("click", function () {
    var uList = PAIR_STATE.unmatchedUnits.length ? PAIR_STATE.unmatchedUnits : PAIR_STATE.unmatchedUnits.concat(PAIR_STATE.unmatchedPacks);
    var pList = PAIR_STATE.unmatchedPacks.length ? PAIR_STATE.unmatchedPacks : PAIR_STATE.unmatchedUnits.concat(PAIR_STATE.unmatchedPacks);
    var uIdx = Number($("#bcPairManualUnit").value);
    var pIdx = Number($("#bcPairManualPack").value);
    var selA = uList[uIdx], selB = pList[pIdx];
    if (!selA || !selB) { toast("กรุณาเลือกรายการทั้ง 2 ช่องเพื่อนำมาจับคู่", true); return; }
    if (cleanBarcodeStr(selA.barcode) === cleanBarcodeStr(selB.barcode)) { toast("เลขบาร์เดี่ยวและเลขบาร์แพ็คต้องไม่ซ้ำกัน", true); return; }
    var oriented = orientUnitAndPack(selA, selB);
    var u = oriented.unit, p = oriented.pack;
    var uCode = cleanBarcodeStr(u.barcode), pCode = cleanBarcodeStr(p.barcode);
    var sim = computeBarcodeNameSimilarity(u, p);
    var defCat = ($("#bcPairDefCat") ? $("#bcPairDefCat").value : "").trim();
    var newPair = {
      id: "pair_manual_" + (PAIR_STATE.nextId++),
      selected: true,
      saved: false,
      similarity: sim || 100,
      unitSourceName: u.name,
      packSourceName: p.name,
      partner: u.partner || p.partner || "",
      cat: defCat || "",
      name: (u.info && u.info.cleanName) || u.name,
      perPack: "",
      packBar: pCode,
      unitBar: uCode,
      unitPrice: resolvePairPrice(uCode, u.price),
      packPrice: resolvePairPrice(pCode, p.price),
      unitQty: resolvePairQty(uCode, u.qty),
      packQty: resolvePairQty(pCode, p.qty)
    };
    newPair.dupInfo = evaluatePairDuplicate(newPair, PAIR_STATE.dbBarMap);
    PAIR_STATE.pairs.unshift(newPair);
    PAIR_STATE.unmatchedUnits = PAIR_STATE.unmatchedUnits.filter(function (x) { return x !== u && x !== p; });
    PAIR_STATE.unmatchedPacks = PAIR_STATE.unmatchedPacks.filter(function (x) { return x !== u && x !== p; });
    savePairDraftTemp(true);
    renderPairTable();
    toast("เพิ่มคู่รายการลงในตารางตรวจสอบด้านบนแล้ว");
  });
}

if (typeof window !== "undefined") {
  Object.assign(window, {
    PAIR_STATE: PAIR_STATE,
    cleanBarcodeStr: cleanBarcodeStr,
    analyzeBarcodeItemName: analyzeBarcodeItemName,
    computeBarcodeNameSimilarity: computeBarcodeNameSimilarity,
    orientUnitAndPack: orientUnitAndPack,
    evaluatePairDuplicate: evaluatePairDuplicate,
    matchBarcodePairsFromSheets: matchBarcodePairsFromSheets,
    savePairDraftTemp: savePairDraftTemp,
    clearPairDraftTemp: clearPairDraftTemp,
    applyLoadedDraftToState: applyLoadedDraftToState,
    buildPairExportData: buildPairExportData,
    exportPairedBarcodesToExcel: exportPairedBarcodesToExcel
  });
}

/* ============================ ประวัติ / แท็บ ============================ */
function switchTab(t) {
  if (S.me && S.me.role !== "admin" && t !== "print") t = "print";
  document.querySelectorAll(".tab").forEach(function (x) { var on=x.dataset.t===t;x.classList.toggle("on",on);x.setAttribute("aria-selected",String(on));x.tabIndex=on?0:-1; });
  ["data", "manage", "pair", "print"].forEach(function (k) { if ($("#v-" + k)) $("#v-" + k).classList.toggle("hidden", k !== t); });
  if ($(".layout")) $(".layout").classList.toggle("pair-mode", t === "pair");
  if (t === "print") renderPrintList();
  if (t === "pair") {
    ensureDbBarMapLoaded().then(function () { renderPairTable(); });
  }
}
document.querySelector(".tabs").addEventListener("click", function (e) {
  var b = e.target.closest(".tab"); if (!b) return;
  switchTab(b.dataset.t);
});


/* ============================ เข้าสู่ระบบ / ออกจากระบบ ============================ */
function showLogin(msg) {
  S.token = ""; S.me = null; S.cur = null; S.data = null; S.cats = []; S.overall = null;
  try { sessionStorage.removeItem("pm_tok"); sessionStorage.removeItem("pm_me"); } catch (e) {}
  document.body.classList.add("locked");
  document.querySelectorAll(".modalwrap,.overlay").forEach(function (dialog) { dialog.classList.add("hidden"); });
  if ($("#login")) $("#login").classList.remove("hidden");
  $("#lgErr").textContent = msg || ""; $("#lgPass").value = "";
  $("#tbody").innerHTML = ""; $("#pList").innerHTML = ""; $("#catSide").innerHTML = "";
  setTimeout(function () { $("#lgUser").focus(); }, 50);
}
function hasPerm(k) { return !!(S.me && (S.me.role === "admin" || (S.me.perms && S.me.perms[k]))); }
function goPortal() {
  location.href = pageUrl("index.html", "https://cmucoop-support.github.io/CMUCOOP-SP/index.html");
}
async function openBarcode() {
  var me = S.me; if (!me || !hasPerm("barcode")) return;
  $("#me").textContent = me.name + " (" + (me.role === "admin" ? "Admin" : "ผู้ใช้งาน") + ")";
  var admin = me.role === "admin";
  document.querySelectorAll(".tab").forEach(function (t) {
    t.classList.toggle("hidden", !admin && (t.dataset.t === "data" || t.dataset.t === "manage" || t.dataset.t === "pair"));
  });
  $(".layout").classList.add("single");
  if ($("#bcCatBarCard")) $("#bcCatBarCard").classList.toggle("hidden", !admin);
  switchTab(admin ? "data" : "print");
  if (admin) {
    bcLoadBk();
    initPairContextAndRestoreDraft();
  }
  try {
    await refreshCats();
    if (admin) await selectCat(allCat().key);          // เปิดมาแสดงรายการทั้งหมดก่อน
  } catch (e) { if (S.me) toast("โหลดข้อมูลไม่สำเร็จ: " + e.message, true); }
}

async function startApp(me) {
  S.me = me;
  if (!hasPerm("barcode")) {
    showLogin("บัญชีนี้ยังไม่ได้รับสิทธิ์การ์ดรายการบาร์เดี่ยว/บาร์แพ็ค — ติดต่อ Admin หรือเข้าสู่ระบบด้วยบัญชีอื่น");
    return;
  }
  document.body.classList.remove("locked");
  if ($("#login")) $("#login").classList.add("hidden");
  try { if (me && me.role) sessionStorage.setItem("pm_me", JSON.stringify(me)); } catch (e) {}
  await openBarcode();
}
async function doLogin() {
  if ($("#lgBtn").disabled) return;
  var u = $("#lgUser").value.trim(), p = $("#lgPass").value;
  if (!u || !p) { $("#lgErr").textContent = "กรุณากรอกรหัสผู้ใช้และรหัสผ่าน"; return; }
  $("#lgBtn").disabled = true; $("#lgErr").textContent = "";
  try {
    var r = await call("login", u, p);
    S.token = r.token;
    try { sessionStorage.setItem("pm_tok", r.token); sessionStorage.setItem("pm_me", JSON.stringify(r)); } catch (e) {}
    $("#lgPass").value = "";
    await startApp(r);
  } catch (e) { $("#lgErr").textContent = e.message; $("#lgPass").value = ""; }
  $("#lgBtn").disabled = false;
}
$("#lgBtn").addEventListener("click", doLogin);
$("#lgForgot").addEventListener("click", function (e) {
  e.preventDefault(); $("#rcBox").classList.toggle("hidden");
  if (!$("#rcBox").classList.contains("hidden")) { $("#rcUser").value = $("#lgUser").value.trim(); $("#rcCode").focus(); }
});
$("#rcBtn").addEventListener("click", async function () {
  this.disabled = true; $("#lgErr").textContent = "";
  try {
    await call("recoverAdmin", $("#rcUser").value.trim(), $("#rcCode").value, $("#rcPass").value);
    $("#lgUser").value = $("#rcUser").value.trim();
    ["#rcCode", "#rcPass"].forEach(function (x) { $(x).value = ""; });
    $("#rcBox").classList.add("hidden");
    $("#lgErr").textContent = "ตั้งรหัสผ่านใหม่แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่";
    $("#lgPass").focus();
  } catch (e) { $("#lgErr").textContent = e.message; }
  this.disabled = false;
});
$("#lgPass").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
$("#lgUser").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#lgPass").focus(); });

document.querySelectorAll("#btnLogout,.js-logout").forEach(function (b) {
  b.addEventListener("click", async function () {
    try { await call("logout"); } catch (e) {}
    showLogin("");
  });
});
$("#btnHome").addEventListener("click", goPortal);

/* ============================ เริ่มต้น ============================ */
$("#btnReload").addEventListener("click", async function () {
  try { await refreshCats(); if (S.cur) await selectCat(S.cur); toast("โหลดข้อมูลล่าสุดแล้ว"); }
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
      var r = await call("loginByLink", q.u, q.k);
      S.token = r.token;
      try { sessionStorage.setItem("pm_tok", r.token); } catch (e) {}
      await startApp(r); return;
    } catch (e) { showLogin(e.message); return; }
  }
  if (S.token) {                                  // กู้เซสชันเดิมทันทีโดยไม่กะพริบหน้าล็อกอิน
    try { var me = await call("whoami"); await startApp(me); return; }
    catch (e) { showLogin(e.message); return; }
  }
  showLogin("");
})();
