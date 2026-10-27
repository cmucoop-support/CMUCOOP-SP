var $ = function (s) { return document.querySelector(s); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var stripOldNote = function () { return ''; };   /* ตัดหมายเหตุช่วงสำรวจออกจากหัวตาราง/ไฟล์ส่งออก */
var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
var nf0 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
var nf2 = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
var money = function (n) { return (n === null || n === undefined || n === '' || !isFinite(Number(n))) ? '–' : nf2.format(Number(n)); };
var pctF = function (n) { return (n === null || n === undefined || !isFinite(Number(n))) ? '–' : nf2.format(Number(n) * 100) + '%'; };


/* ---------- เซสชัน & การเรียกหลังบ้าน ---------- */
var TOKEN = '';
function initToken() {
  var m = (location.hash || '').match(/[#&]t=([^&]+)/);
  if (m) {
    try { TOKEN = decodeURIComponent(m[1]); sessionStorage.setItem('pm_tok', TOKEN); } catch (e) {}
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  } else {
    try { TOKEN = sessionStorage.getItem('pm_tok') || ''; } catch (e) {}
  }
}
function call(fn) {
  var args = Array.prototype.slice.call(arguments, 1);
  if (fn !== 'login' && fn !== 'recoverAdmin' && fn !== 'loginByLink') args.unshift(TOKEN);
  return new Promise(function (res, rej) {
    var r = google.script.run.withSuccessHandler(res).withFailureHandler(function (e) {
      var m = (e && e.message) || String(e);
      if (/SESSION_EXPIRED/.test(m)) { showLogin('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง'); m = 'SESSION_EXPIRED'; }
      rej(new Error(m));
    });
    r[fn].apply(r, args);
  });
}
var toastT = null;
function toast(msg, isErr) {
  var t = $('#toast'); if (t) t.remove();
  t = document.createElement('div'); t.id = 'toast'; t.className = 'toast' + (isErr ? ' err2' : '');
  t.setAttribute('role', isErr ? 'alert' : 'status');
  t.setAttribute('aria-live', isErr ? 'assertive' : 'polite');
  t.setAttribute('aria-atomic', 'true');
  t.textContent = msg; document.body.appendChild(t);
  clearTimeout(toastT); toastT = setTimeout(function () { t.remove(); }, isErr ? 10000 : 6000);
}
async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { if (e.message !== 'SESSION_EXPIRED') toast(e.message, true); }
  btn.disabled = false;
}
function showLogin(msg) {
  TOKEN = ''; try { sessionStorage.removeItem('pm_tok'); sessionStorage.removeItem('pm_me'); } catch (e) {}
  $('#login').classList.remove('hidden');
  $('#lgMsg').textContent = msg || 'เข้าสู่ระบบด้วยบัญชีเดียวกับระบบหลัก';
  $('#lgErr').textContent = ''; $('#lgPass').value = '';
  setTimeout(function () { $('#lgUser').focus(); }, 50);
}
$('#lgBtn').addEventListener('click', function () {
  var u = $('#lgUser').value.trim(), p = $('#lgPass').value;
  if (!u || !p) { $('#lgErr').textContent = 'กรุณากรอกรหัสผู้ใช้และรหัสผ่าน'; return; }
  var b = this; b.disabled = true; $('#lgErr').textContent = '';
  call('login', u, p).then(function (r) {
    TOKEN = r.token; try { sessionStorage.setItem('pm_tok', TOKEN); sessionStorage.setItem('pm_me', JSON.stringify(r)); } catch (e) {}
    $('#login').classList.add('hidden'); load();
  }, function (e) { $('#lgErr').textContent = e.message; $('#lgPass').value = ''; }).then(function () { b.disabled = false; });
});
['#lgUser', '#lgPass'].forEach(function (s) { $(s).addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#lgBtn').click(); }); });

/* ---------- สถานะของหน้าเว็บ ---------- */
var STORAGE_KEY = 'cmucoop_market_state_v1';
var DEFAULT_BR = 'สาขาหลัก';
var BR_KEY = 'cmucoop_market_br';
var D = {
  me: null,
  store: Object.create(null),       // { 'ชื่อสาขา': { groups:{...}, names:{...} } }
  br: '',          // สาขาที่เลือกอยู่ (D.groups / D.names ชี้ไปที่ข้อมูลของสาขานี้)
  ver: 'cur',
  groups: Object.create(null),      // { '34': { cur: { ts, who, file, rep, surveyNote, rows:[...] }, prev: {...} } }
  names: Object.create(null),
  surveyor: '',
  checker: '',
  approver: '',
  surveyNote: '',
  items: [],
  allGroups: []
};
// The server revision prevents one browser from silently overwriting another's edits.
D.revision = '';
var F = { g: '', move: '', rec: '', q: '', page: 0 };
var PAGE = 100;
var DIRTY = false;

var REC_OPTS = ['คงที่', 'ปรับขึ้น', 'ปรับลง', 'ฝากพิจารณา', 'สินค้าไม่เคลื่อนไหว'];
var REC_META = [
  { k: '', t: 'ทั้งหมด', c: '#7a4be0', s: '●' },
  { k: 'ปรับขึ้น', t: 'ปรับขึ้น', c: '#b42318', s: '▲' },
  { k: 'ปรับลง', t: 'ปรับลง', c: '#5b2fc7', s: '▼' },
  { k: 'ฝากพิจารณา', t: 'ฝากพิจารณา', c: '#176b3f', s: '◆' },
  { k: 'คงที่', t: 'คงที่', c: '#946200', s: '■' },
  { k: 'สินค้าไม่เคลื่อนไหว', t: 'สินค้าไม่เคลื่อนไหว', c: '#5a6573', s: '○' }
];

function brKey(s) { return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, '').toLowerCase(); }
function codeKey(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
function marketNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  var s = String(v == null ? '' : v).trim().replace(/,/g, '');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : null;
}
function marketCell(v) {
  if (v === null || v === undefined || String(v).trim() === '') return '';
  var n = marketNumber(v);
  return n === null ? String(v).trim() : n;
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
function todayIso() { return thaiDayIso(); }
function fmtDateSlash(isoOrTs, useBe) {
  if (!isoOrTs) return '';
  var y, m, d;
  if (typeof isoOrTs === 'number') {
    var dt = new Date(isoOrTs + 7 * 3600000);
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else {
    var mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoOrTs));
    if (!mt) return String(isoOrTs);
    y = +mt[1]; m = +mt[2]; d = +mt[3];
  }
  if (useBe && y < 2400) y += 543;
  if (!useBe && y > 2400) y -= 543;
  return pad2(d) + '/' + pad2(m) + '/' + y;
}
function fmtTsTh(ts) {
  if (!ts) return '–';
  return new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', calendar: 'buddhist' });
}
function grpLabel(g) {
  var n = D.names && D.names[g];
  return n ? g + ' · ' + n : g;
}

/* ---------- คำนวณค่าของแต่ละแถวตามสูตรในไฟล์ 34ผลิตภัณฑ์ดูแลผ้า.xlsx ----------
 * r = [0:g, 1:code, 2:name, 3:qty, 4:chgTxt, 5:chgDate, 6:cost, 7:price, 8:mktMin, 9:mktMax, 10:recAct, 11:recPrice, 12:editNote, 13:repDate] */
function calcItem(r, idx) {
  var qty = marketNumber(r[3]) || 0;
  var cost = marketNumber(r[6]) || 0;
  var price = marketNumber(r[7]) || 0;
  var profitEx = Math.round((price - cost) * 100) / 100;
  var marginEx = cost > 0 ? Math.round(((price - cost) / cost) * 10000) / 10000 : 0;
  var costVat = Math.round(cost * 1.07 * 100) / 100;
  var profitInc = Math.round((price - costVat) * 100) / 100;
  var marginInc = costVat > 0 ? Math.round(((price - costVat) / costVat) * 10000) / 10000 : 0;
  var price30 = Math.round(cost * 1.07 * 1.3 * 100) / 100;
  var recAct = String(r[10] || '').trim() || (qty <= 0 ? 'สินค้าไม่เคลื่อนไหว' : 'คงที่');
  return {
    raw: r,
    i: idx,
    g: String(r[0] || ''),
    code: String(r[1] || ''),
    name: String(r[2] || ''),
    qty: qty,
    chgTxt: String(r[4] == null || r[4] === '' ? '-' : r[4]),
    chgDate: String(r[5] == null || r[5] === '' ? '-' : r[5]),
    cost: cost,
    price: price,
    profitEx: profitEx,
    marginEx: marginEx,
    costVat: costVat,
    profitInc: profitInc,
    marginInc: marginInc,
    price30: price30,
    mktMin: marketCell(r[8]),
    mktMax: marketCell(r[9]),
    recAct: recAct,
    recPrice: marketCell(r[11]),
    editNote: String(r[12] || ''),
    rep: String(r[13] || ''),
    hay: [r[1], r[2], r[4], r[10], r[12]].join(' ').toLowerCase()
  };
}

function dateFromFileName(n) {
  var m = /(?:^|[^\d])(\d{2})(\d{2})(\d{2})(?:[^\d]|$)/.exec(String(n || '')); if (!m) return '';
  var y = 2500 + Number(m[1]) - 543, mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function latestUpdate(x) {          /* ปรับครั้งล่าสุด: ข้อความการปรับ + วันที่ปรับ · ไม่มีข้อมูล หรือราคาในข้อความไม่ตรงราคาขายปัจจุบัน → เว้นว่าง */
  var t = x.chgTxt == null ? '' : String(x.chgTxt).replace(/\u00a0/g, ' ').trim();
  if (!t || t === '-') return { text: '', date: '' };
  var np = chgNewPrice(t);
  if (np !== null && isFinite(np) && Math.abs(np - (Number(x.price) || 0)) >= 0.005) return { text: '', date: '' };
  var d = x.chgDate && x.chgDate !== '-' ? fmtDateSlash(x.chgDate, false) : '';
  return { text: t, date: d };
}

/* กำไรคิดเทียบต้นทุนตามสูตรเดิม; ใช้ราคาแนะนำเฉพาะรายการที่ระบุให้ปรับ/พิจารณา */
function priceProjection(x) {
  var actionable = ['ปรับขึ้น', 'ปรับลง', 'ฝากพิจารณา'].indexOf(x.recAct) >= 0;
  var proposed = marketNumber(x.recPrice);
  var valid = proposed !== null && proposed > 0;
  var hasChange = actionable && valid && Math.abs(proposed - x.price) >= 0.005;
  var price = hasChange ? proposed : x.price;
  return {
    hasChange: hasChange, needsPrice: actionable && !valid, price: price,
    profitEx: Math.round((price - x.cost) * 100) / 100,
    marginEx: x.cost > 0 ? Math.round((price - x.cost) / x.cost * 10000) / 10000 : null,
    profitInc: Math.round((price - x.costVat) * 100) / 100,
    marginInc: x.costVat > 0 ? Math.round((price - x.costVat) / x.costVat * 10000) / 10000 : null
  };
}

function summarizePriceProjection(items) {
  var result = { changedCount: 0, changedActiveCount: 0, missingPriceCount: 0, excludedCostCount: 0, activeCount: 0, eligibleCount: 0,
    avgBeforeEx: null, avgBeforeInc: null, avgAfterEx: null, avgAfterInc: null };
  var beforeEx = 0, beforeInc = 0, afterEx = 0, afterInc = 0;
  (items || []).forEach(function (x) {
    var projected = priceProjection(x);
    if (projected.hasChange) result.changedCount++;
    if (projected.needsPrice) result.missingPriceCount++;
    if (x.qty <= 0) return;
    result.activeCount++;
    if (projected.hasChange) result.changedActiveCount++;
    if (x.cost <= 0 || x.costVat <= 0) { result.excludedCostCount++; return; }
    result.eligibleCount++;
    beforeEx += x.marginEx; beforeInc += x.marginInc;
    afterEx += projected.marginEx; afterInc += projected.marginInc;
  });
  if (result.eligibleCount) {
    result.avgBeforeEx = beforeEx / result.eligibleCount; result.avgBeforeInc = beforeInc / result.eligibleCount;
    result.avgAfterEx = afterEx / result.eligibleCount; result.avgAfterInc = afterInc / result.eligibleCount;
  }
  return result;
}

function projectionPercent(value) { return value === null || value === undefined ? 'คำนวณไม่ได้' : pctF(value); }

function projectionNote(x) {
  var p = priceProjection(x);
  if (p.needsPrice) return '<small class="muted" style="display:block">กรอกราคาแนะนำเพื่อคำนวณกำไรหลังปรับ</small>';
  if (!p.hasChange) return '';
  return '<small style="display:block">กำไรหลังปรับ (รวม Vat): ' + projectionPercent(p.marginInc) + '</small>';
}

/* ---------- ตรวจสอบ "การปรับ" ให้ตรงกับคอลัมน์ราคาขาย ----------
 * ข้อความการปรับ เช่น "> ปรับขึ้น\nเดิม 129 ขึ้น 135" → ราคาใหม่ในข้อความ (135) ต้องเท่ากับราคาขายปัจจุบัน
 * ถ้าไม่ตรง → ลบทั้ง "การปรับ" และ "วันที่" (ตั้งเป็น "-") */
function chgNewPrice(t) {
  var m = /(?:ข[ึ้]{2}น|ลง)\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*$/.exec(String(t == null ? '' : t).trim());
  return m ? Number(m[1].replace(/,/g, '')) : null;
}
function sanitizeChg(r) {
  var t = r[4];
  if (t === null || t === undefined || t === '' || t === '-') return false;
  var np = chgNewPrice(t);
  if (np === null || !isFinite(np)) return false;      // อ่านราคาไม่ออก (ข้อความอิสระ) → ไม่แตะ
  var price = Number(r[7]); if (!isFinite(price)) price = 0;
  if (Math.abs(np - price) < 0.005) return false;
  r[4] = '-'; r[5] = '-';
  return true;
}
function fixChgAll() {
  var n = 0;
  Object.keys(D.store).forEach(function (b) {
    var gs = D.store[b].groups;
    Object.keys(gs).forEach(function (g) {
      ['cur', 'prev'].forEach(function (v) {
        var side = gs[g] && gs[g][v];
        if (side && Array.isArray(side.rows)) side.rows.forEach(function (r) { if (sanitizeChg(r)) n++; });
      });
    });
  });
  return n;
}

/* ---------- สาขา ---------- */
function stateObj() {
  return { branches: D.store, surveyor: D.surveyor, checker: D.checker, approver: D.approver, surveyNote: D.surveyNote, revision: D.revision };
}
function applyState(o) {
  if (!o || typeof o !== 'object') return false;
  var st = null;
  if (o.branches && typeof o.branches === 'object') {
    st = Object.create(null);
    Object.keys(o.branches).forEach(function (b) {
      var v = o.branches[b] || {};
      st[b] = { groups: Object.assign(Object.create(null), v.groups && typeof v.groups === 'object' ? v.groups : {}), names: Object.assign(Object.create(null), v.names && typeof v.names === 'object' ? v.names : {}) };
    });
  } else if (o.groups && typeof o.groups === 'object') {   // ข้อมูลเก่าก่อนมีสาขา → ย้ายเข้า "สาขาหลัก"
    st = Object.create(null);
    var nm = Object.assign(Object.create(null), o.names && typeof o.names === 'object' ? o.names : {});
    if (Object.keys(o.groups).length || Object.keys(nm).length) st[DEFAULT_BR] = { groups: Object.assign(Object.create(null), o.groups), names: nm };
  }
  if (!st) return false;
  D.store = st;
  if (o.surveyor !== undefined) D.surveyor = String(o.surveyor || '');
  if (o.checker !== undefined) D.checker = o.checker;
  if (o.approver !== undefined) D.approver = o.approver;
  if (o.surveyNote !== undefined) D.surveyNote = o.surveyNote;
  D.revision = typeof o.revision === 'string' ? o.revision : '';
  return true;
}
function ensureBranch(name) {
  if (!D.store[name]) D.store[name] = { groups: Object.create(null), names: Object.create(null) };
  return D.store[name];
}
function findBranch(name) {
  var k = brKey(name), hit = '';
  Object.keys(D.store).forEach(function (b) { if (brKey(b) === k) hit = b; });
  return hit;
}
function setBranch(b) {
  if (!b || !D.store[b]) {
    var keys = Object.keys(D.store).sort();
    b = (D.br && D.store[D.br]) ? D.br : (keys[0] || '');
  }
  D.br = b;
  D.groups = b ? D.store[b].groups : Object.create(null);
  D.names = b ? D.store[b].names : Object.create(null);
  try { localStorage.setItem(BR_KEY, b); } catch (e) {}
}

/* ---------- บันทึก/โหลดสถานะ (รองรับทั้ง Cloud Worker API + LocalStorage Fallback) ---------- */
// Coalesce edits before serializing a large draft; flush before a request or
// page exit so an uncertain network result can still be recovered locally.
var LOCAL_SAVE_TIMER = null, LOCAL_SAVE_USER = '';
function flushLocalState() {
  if (LOCAL_SAVE_TIMER !== null) clearTimeout(LOCAL_SAVE_TIMER);
  LOCAL_SAVE_TIMER = null;
  var user = LOCAL_SAVE_USER; LOCAL_SAVE_USER = '';
  if (!user || !D.me || D.me.user !== user) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: user, pending: DIRTY, state: stateObj() })); } catch (e) {}
}
function saveLocalState() {
  if (!D.me || !D.me.user) return;
  LOCAL_SAVE_USER = D.me.user;
  if (LOCAL_SAVE_TIMER === null) LOCAL_SAVE_TIMER = setTimeout(flushLocalState, 250);
}
function loadLocalState() {
  try {
    var cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    // Never show a previous account's cached branch data when the network is unavailable.
    if (cached && D.me && cached.user === D.me.user && applyState(cached.state)) {
      DIRTY = !!cached.pending && !!D.me.edit;
      return true;
    }
  } catch (e) {}
  return false;
}

/* บันทึกขึ้นเซิร์ฟเวอร์ · คืนค่า true = สำเร็จ · false = ไม่สำเร็จ (แสดงข้อความแจ้งเตือน ยกเว้น quiet) */
var SAVE_CHAIN = Promise.resolve();
function stateContent(state) {
  var copy = Object.assign({}, state); delete copy.revision;
  return JSON.stringify(copy);
}
function syncToServer(quiet) {
  if (!D.me || !D.me.edit) return Promise.resolve(false);
  var saveUser = D.me.user, saveToken = TOKEN;
  DIRTY = true;
  $('#bSaveEdits').classList.remove('hidden');
  saveLocalState();
  SAVE_CHAIN = SAVE_CHAIN.then(async function () {
    try {
      if (!D.me || D.me.user !== saveUser || TOKEN !== saveToken) return false;
      if (!DIRTY) return true;
      flushLocalState();
      // Capture at execution time: queued clicks share the newest draft and do
      // not retain multiple complete copies of a large market dataset.
      var content = stateContent(stateObj());
      var snapshot = JSON.parse(content);
      snapshot.revision = D.revision;
      var saved = await call('marketSaveState', snapshot);
      if (!D.me || D.me.user !== saveUser || TOKEN !== saveToken) return false;
      if (saved && typeof saved.revision === 'string') D.revision = saved.revision;
      if (content === stateContent(stateObj())) DIRTY = false;
      $('#bSaveEdits').classList.toggle('hidden', !DIRTY);
      saveLocalState();
      return true;
    } catch (e) {
      if (e.message !== 'SESSION_EXPIRED' && !quiet) toast('บันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ: ' + e.message + ' — การแก้ไขยังอยู่ในหน้านี้ กรุณาบันทึกอีกครั้ง', true);
      syncToServer.lastErr = e.message;
      return false;
    }
  });
  return SAVE_CHAIN;
}
function syncThen(okMsg) {
  return syncToServer(true).then(function (ok) {
    if (ok) toast(okMsg);
    else if (syncToServer.lastErr !== 'SESSION_EXPIRED') toast('ยังบันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ (' + syncToServer.lastErr + ') — การแก้ไขยังอยู่ในหน้านี้ กรุณาบันทึกอีกครั้ง', true);
    return ok;
  });
}

function rebuildItems() {
  D.allGroups = Object.keys(D.groups).filter(function (g) {
    return D.groups[g] && (D.ver === 'prev' ? D.groups[g].prev : D.groups[g].cur);
  }).sort();
  if (F.g && D.allGroups.indexOf(F.g) < 0) {
    F.g = '';
  }
  var allRows = [];
  D.allGroups.forEach(function (g) {
    var side = D.ver === 'prev' ? D.groups[g].prev : D.groups[g].cur;
    if (side && Array.isArray(side.rows)) {
      side.rows.forEach(function (r) { allRows.push(r); });
    }
  });
  D.items = allRows.map(calcItem);
}

async function load() {
  flushLocalState();
  if (!TOKEN) { showLogin(''); return false; }
  var prefBr = ''; try { prefBr = localStorage.getItem(BR_KEY) || ''; } catch (e0) {}
  try {
    var me = await call('whoami');
    try { sessionStorage.setItem('pm_me', JSON.stringify(me)); } catch (e) {}
    var canView = me.role === 'admin' || (me.perms && me.perms.market);
    if (!canView) {
      showLogin('บัญชีนี้ยังไม่ได้รับสิทธิ์การ์ดเช็คราคาตลาด — ติดต่อ Admin หรือเข้าสู่ระบบด้วยบัญชีอื่น');
      return false;
    }
    var canEdit = me.role === 'admin' || !!(me.perms && me.perms.market && me.perms.market_edit);
    D.me = { user: me.user, name: me.name, role: me.role, edit: canEdit };
    D.store = Object.create(null); D.groups = Object.create(null); D.names = Object.create(null); D.revision = ''; DIRTY = false;
    D.surveyor = ''; D.checker = ''; D.approver = ''; D.surveyNote = '';
    var hasCache = loadLocalState(), fromServer = false;
    try {
      var srv = await call('marketGet');
      if (hasCache && DIRTY) {
        toast('มีการแก้ไขที่ยังไม่ได้บันทึกในเครื่องนี้ กรุณากดบันทึกการแก้ไข หรือรีเฟรชเพื่อละทิ้งการแก้ไข', true);
      } else {
        if (!applyState(srv)) throw new Error('รูปแบบข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง');
        fromServer = true;
        DIRTY = false;
        saveLocalState();
      }
    } catch (e2) {
      if (e2.message === 'SESSION_EXPIRED') return false;
      toast('ดึงข้อมูลล่าสุดจากเซิร์ฟเวอร์ไม่สำเร็จ: ' + e2.message + (hasCache ? ' (กำลังแสดงข้อมูลที่บันทึกไว้ในเครื่อง)' : ' (ยังไม่มีข้อมูลสำรองของบัญชีนี้)'), true);
    }
    setBranch(prefBr);
    rebuildItems();
    renderAll();
    return fromServer;
  } catch (e) {
    if (e.message !== 'SESSION_EXPIRED') showLogin(e.message);
    return false;
  }
}

/* ---------- ฟังก์ชันตรวจสอบรอบ 15 วัน ---------- */
function cycleStatus(ts) {
  if (!ts) return { days: 0, left: 15, cls: 'warn', txt: 'ยังไม่มีประวัติวันที่อัปโหลด' };
  var days = Math.max(0, Math.floor((Date.now() - ts) / 86400000));
  var left = 15 - days;
  if (days >= 15) {
    return { days: days, left: left, cls: 'bad', txt: 'อัปโหลดมาแล้ว ' + days + ' วัน (ครบรอบ/เกินกำหนด 15 วัน — ควรอัปข้อมูลใหม่เข้าระบบ)' };
  }
  if (days >= 11) {
    return { days: days, left: left, cls: 'warn', txt: 'อัปโหลดเมื่อ ' + days + ' วันที่แล้ว · เหลืออีก ' + left + ' วันครบรอบอัปข้อมูล 15 วัน' };
  }
  return { days: days, left: left, cls: 'ok', txt: 'อัปโหลดเมื่อ ' + (days === 0 ? 'วันนี้' : days + ' วันที่แล้ว') + ' · เหลืออีก ' + left + ' วันครบรอบอัปข้อมูล 15 วัน' };
}

function curGroupMeta(g) {
  var key = g || F.g;
  if (key) {
    var grp = D.groups[key];
    return grp ? (D.ver === 'prev' ? grp.prev : grp.cur) : null;
  }
  return D.allGroups.reduce(function (latest, group) {
    var side = D.ver === 'prev' ? D.groups[group].prev : D.groups[group].cur;
    return side && (!latest || Number(side.ts) > Number(latest.ts)) ? side : latest;
  }, null);
}

function filteredItems() {
  var q = (F.q || '').trim().toLowerCase();
  return D.items.filter(function (x) {
    if (F.g && x.g !== F.g) return false;
    if (F.move === 'active' && !(x.qty > 0)) return false;
    if (F.move === 'inactive' && x.qty > 0) return false;
    if (F.move === 'changed' && !latestUpdate(x).text) return false;
    if (F.rec && x.recAct !== F.rec) {
      return false;
    }
    if (q && x.hay.indexOf(q) < 0) return false;
    return true;
  });
}

/* ---------- วาดหน้าจอทั้งหมด ---------- */
function renderAll() {
  var edit = !!(D.me && D.me.edit);
  $('#bUpload').classList.toggle('hidden', !edit);
  $('#bNames').classList.toggle('hidden', !edit);
  $('#bAutoRec').classList.toggle('hidden', !edit);
  $('#bDelGrp').classList.toggle('hidden', !edit || !F.g || D.ver !== 'cur');
  $('#bSaveEdits').classList.toggle('hidden', !edit || !DIRTY);
  $('#bAutoRec').disabled = D.ver !== 'cur';
  $('#bXlsx').disabled = !D.items.length;
  $('#bEmptyUpload').classList.toggle('hidden', !edit);
  ['#sigSurveyor', '#sigChecker', '#sigApprover'].forEach(function (sel) { $(sel).readOnly = !edit || D.ver !== 'cur'; });

  var brKeys = Object.keys(D.store).sort();
  $('#brSel').innerHTML = brKeys.length ? brKeys.map(function (b) {
    var n = Object.keys(D.store[b].groups).length;
    return '<option value="' + esc(b) + '"' + (D.br === b ? ' selected' : '') + '>สาขา ' + esc(b) + ' (' + n + ' หมวด)</option>';
  }).join('') : '<option value="">ยังไม่มีสาขา</option>';
  $('#brSel').disabled = !brKeys.length;

  var hasData = Object.keys(D.groups).length > 0;
  $('#empty').classList.toggle('hidden', hasData);
  $('#main').hidden = !hasData;
  if (!hasData) {
    $('#info').textContent = D.me ? 'ผู้ใช้: ' + D.me.name : '';
    $('#emptyMsg').textContent = edit ? (D.br ? 'สาขา ' + D.br + ' ยังไม่มีข้อมูล · ' : '') + 'กดปุ่มด้านล่างเพื่ออัปโหลดไฟล์ Excel สำรวจราคาตลาดไฟล์ใหม่ (เลือกสาขาในหน้าต่างอัปโหลด)' : (D.br ? 'สาขา ' + D.br + ' ' : '') + 'ยังไม่มีข้อมูลในระบบ กรุณาให้ Admin อัปโหลดข้อมูล';
    return;
  }

  /* แถบข้อมูลด้านบน + รอบ 15 วัน */
  var m = curGroupMeta(F.g);
  var cyc = cycleStatus(m && m.ts);
  var nextDueTs = m && m.ts ? (m.ts + 15 * 86400000) : 0;
  $('#info').innerHTML = (D.ver === 'prev' ? '<b style="color:#ffffff;text-decoration:underline">[ฉบับก่อนหน้า]</b> · ' : '') +
    (D.br ? 'สาขา <b>' + esc(D.br) + '</b> · ' : '') + (m ? (F.g ? 'หมวด <b>' + esc(grpLabel(F.g)) + '</b>' : 'รวมทุกหมวด · อัปโหลดล่าสุด') + ' · อัปข้อมูลเข้าเมื่อ <b>' + esc(fmtTsTh(m.ts)) + '</b> โดย ' + esc(m.who || '–') +
      (m.file ? ' (' + esc(m.file) + ')' : '') : 'รวมทุกหมวด') +
    (D.me && !D.me.edit ? ' · <b style="color:#ffffff;text-decoration:underline">สิทธิ์: ดูอย่างเดียว</b>' : '');

  /* แท็บฉบับปัจจุบัน / ฉบับก่อนหน้า */
  var nCur = Object.keys(D.groups).filter(function (g) { return D.groups[g] && D.groups[g].cur; }).length;
  var nPrev = Object.keys(D.groups).filter(function (g) { return D.groups[g] && D.groups[g].prev; }).length;
  $('#verTabs').innerHTML =
    '<button type="button" class="tab' + (D.ver === 'cur' ? ' on' : '') + '" data-v="cur" role="tab" aria-selected="' + (D.ver === 'cur' ? 'true' : 'false') + '">ฉบับปัจจุบัน (' + nCur + ' หมวด)</button>' +
    '<button type="button" class="tab' + (D.ver === 'prev' ? ' on' : '') + '" data-v="prev" role="tab" aria-selected="' + (D.ver === 'prev' ? 'true' : 'false') + '"' + (nPrev ? '' : ' disabled title="จะมีเมื่อมีการอัปโหลดข้อมูลรอบใหม่ทับหมวดเดิม"') + '>ฉบับก่อนหน้า (' + nPrev + ' หมวด)</button>';

  $('#cycleBadgeBox').innerHTML = '<span class="cycle-badge ' + cyc.cls + '">' + esc(cyc.txt) + '</span>';
  $('#cycleBar').innerHTML =
    '<div><b>วันที่อัปข้อมูลเข้าระบบ:</b> ' + (m && (m.rep || m.ts) ? '<b>' + esc(fmtDateSlash(m.rep || m.ts, false)) + '</b> (' + esc(fmtTsTh(m.ts)) + ')' : '–') +
    (nextDueTs ? ' &nbsp;·&nbsp; <b>กำหนดอัปเดตรอบถัดไป (ทุก 15 วัน):</b> ' + esc(fmtDateSlash(nextDueTs, false)) : '') + '</div>' +
    '<div><b>วันที่ส่งออกข้อมูล (วันนี้):</b> <b>' + esc(fmtDateSlash(Date.now(), false)) + '</b></div>';

  /* ตัวเลือกหมวดสินค้า */
  $('#fGrp').innerHTML = '<option value="">ทุกหมวด (' + D.allGroups.length + ' หมวด)</option>' +
    D.allGroups.map(function (g) {
      var gm = D.ver === 'prev' ? D.groups[g].prev : D.groups[g].cur;
      var cnt = gm && gm.rows ? gm.rows.length : 0;
      return '<option value="' + esc(g) + '"' + (F.g === g ? ' selected' : '') + '>' + esc(grpLabel(g)) + ' (' + nf0.format(cnt) + ' รายการ)</option>';
    }).join('');

  /* ชิปกรองตามรายการแนะนำ */
  var baseForChips = D.items.filter(function (x) { return !F.g || x.g === F.g; });
  var recCounts = { '': baseForChips.length };
  REC_OPTS.forEach(function (k) { recCounts[k] = 0; });
  baseForChips.forEach(function (x) {
    recCounts[x.recAct] = (recCounts[x.recAct] || 0) + 1;
  });
  $('#chips').innerHTML = REC_META.map(function (c) {
    var on = F.rec === c.k;
    return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-rec="' + esc(c.k) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<i style="background:' + c.c + '" aria-hidden="true"></i><span>' + esc(c.t) + '</span><b>' + nf0.format(recCounts[c.k] || 0) + '</b></button>';
  }).join('');

  /* คำนวณ KPI ของหมวดที่เลือก */
  var grpItems = baseForChips;
  var activeItems = grpItems.filter(function (x) { return x.qty > 0; });
  var inactiveCnt = grpItems.length - activeItems.length;
  var upCnt = grpItems.filter(function (x) { return x.recAct === 'ปรับขึ้น'; }).length;
  var downCnt = grpItems.filter(function (x) { return x.recAct === 'ปรับลง'; }).length;
  var consCnt = grpItems.filter(function (x) { return x.recAct === 'ฝากพิจารณา'; }).length;
  var constCnt = grpItems.filter(function (x) { return x.recAct === 'คงที่'; }).length;
  var adjTotal = upCnt + downCnt + consCnt;

  var projection = summarizePriceProjection(grpItems);
  var avgEx = projection.avgBeforeEx, avgInc = projection.avgBeforeInc;

  $('#kpis').innerHTML =
    '<div class="kpi"><div class="l">สินค้าในหมวดนี้ทั้งหมด</div><div class="v">' + nf0.format(grpItems.length) + '<small>รายการ</small></div><div class="s">เคลื่อนไหว ' + nf0.format(activeItems.length) + ' · ไม่เคลื่อนไหว ' + nf0.format(inactiveCnt) + '</div></div>' +
    '<div class="kpi"><div class="l">รายการที่ต้องปรับ/พิจารณา</div><div class="v" style="color:var(--bad)">' + nf0.format(adjTotal) + '<small>รายการ</small></div><div class="s">ปรับขึ้น ' + upCnt + ' · ปรับลง ' + downCnt + ' · ฝากพิจารณา ' + consCnt + ' · คงที่ ' + constCnt + '</div></div>' +
    '<div class="kpi"><div class="l">กำไรเฉลี่ยหักเดิม (ไม่รวม Vat)</div><div class="v">' + projectionPercent(avgEx) + '</div><div class="s">เฉพาะสินค้าที่มีสต็อกและต้นทุนคำนวณได้ (' + nf0.format(projection.eligibleCount) + ' รายการ)</div></div>' +
    '<div class="kpi"><div class="l">กำไรเฉลี่ยหัก Vat แล้ว (รวม Vat)</div><div class="v" style="color:var(--accent-text)">' + projectionPercent(avgInc) + '</div></div>' +
    '<div class="kpi"><div class="l">กำไรเฉลี่ยหลังใช้ราคาแนะนำ (รวม Vat)</div><div class="v">' + projectionPercent(projection.avgAfterInc) + '</div><div class="s">ราคาเปลี่ยน ' + projection.changedCount + ' รายการ · รอกรอกราคา ' + projection.missingPriceCount + ' รายการ</div></div>' +
    '<div class="kpi"><div class="l">รอบอัปเดตข้อมูล (ทุก 15 วัน)</div><div class="v" style="color:' + (cyc.cls === 'bad' ? 'var(--bad)' : cyc.cls === 'warn' ? 'var(--warn)' : 'var(--ok)') + '">' + (m && m.ts ? cyc.days + '<small>วันที่ผ่านมา</small>' : '–') + '</div><div class="s">' + (m && m.ts ? 'อัปเข้า ' + fmtDateSlash(m.rep || m.ts, false) + ' · ส่งออก ' + fmtDateSlash(Date.now(), false) : 'ยังไม่มีข้อมูล') + '</div></div>';

  /* แถบบนสุดของตาราง (แสดงวันที่อัปข้อมูลเข้า กับ วันที่ส่งออกข้อมูล) */
  var upDateStr = m ? fmtDateSlash(m.rep || m.ts, false) : fmtDateSlash(Date.now(), false);
  var exDateStr = fmtDateSlash(Date.now(), false);
  var sNote = stripOldNote((m && m.surveyNote) || D.surveyNote || '');
  $('#topUploadDate').textContent = 'อัปข้อมูลเข้า วันที่ ' + upDateStr;
  $('#topExportDate').textContent = 'ส่งออกข้อมูล วันที่ ' + exDateStr + (sNote ? ' · ' + sNote : '');
  var gCode = F.g;
  var gName = (D.names && D.names[gCode]) || '';
  $('#topSheetTitle').textContent = 'สำรวจราคาท้องตลาดหมวดสินค้า ' + (gCode ? gCode + (gName ? ' ' + gName : '') : 'ทุกหมวด') + (D.br ? ' · สาขา ' + D.br : '');

  /* ตารางรายการ */
  renderTable();

  /* กล่องสรุปท้ายรายงาน */
  $('#smActive').textContent = nf0.format(activeItems.length);
  $('#smAvgEx').textContent = projectionPercent(avgEx);
  $('#smAvgInc').textContent = projectionPercent(avgInc);
  $('#smAfterEx').textContent = projectionPercent(projection.avgAfterEx);
  $('#smAfterInc').textContent = projectionPercent(projection.avgAfterInc);
  $('#smTitle').textContent = 'สรุปการสำรวจ หมวด ' + (gCode ? gCode + (gName ? ' ' + gName : '') : 'ทั้งหมด');
  $('#smText').textContent = buildSummaryText(gCode, gName, grpItems.length, inactiveCnt, activeItems.length, adjTotal, upCnt, downCnt, consCnt, avgEx, avgInc, projection);
  $('#sigSurveyor').value = D.surveyor || '';
  $('#sigChecker').value = D.checker || '';
  $('#sigApprover').value = D.approver || '';
}

function buildSummaryText(gCode, gName, total, inactive, active, adjTotal, upCnt, downCnt, consCnt, avgEx, avgInc, projection) {
  var title = 'หมวด ' + (gCode ? gCode + (gName ? ' ' + gName : '') : 'สินค้า');
  var exPct = projectionPercent(avgEx), incPct = projectionPercent(avgInc);
  var text = '1) ภาพรวมสินค้า: ' + title + ' มีสินค้าในระบบ ' + total + ' รายการ แบ่งเป็นสินค้าเคลื่อนไหว ' + active +
    ' รายการ และสินค้าไม่เคลื่อนไหว ' + inactive + ' รายการ';
  text += '\n2) ผลการสำรวจ: มีข้อเสนอปรับ/พิจารณารวม ' + adjTotal + ' รายการ ประกอบด้วย ปรับขึ้น ' + upCnt +
    ' รายการ ปรับลง ' + downCnt + ' รายการ และฝากพิจารณา ' + consCnt + ' รายการ';
  text += '\n3) กำไรเฉลี่ยของสินค้าที่มีอยู่ (คงเหลือ > 0) ก่อนปรับราคา: กำไรเฉลี่ยที่ยังไม่หักภาษีมูลค่าเพิ่ม ' + exPct + ' และกำไรเฉลี่ยที่หักภาษีมูลค่าเพิ่มแล้ว ' + incPct;
  if (projection) {
    text += '\n4) หากใช้ราคาแนะนำ: มีสินค้าที่ราคาต่างจากปัจจุบัน ' + projection.changedCount + ' รายการ (มีสต็อก ' + projection.changedActiveCount +
      ' รายการ) กำไรเฉลี่ยที่ยังไม่หักภาษีมูลค่าเพิ่มเปลี่ยนจาก ' + projectionPercent(projection.avgBeforeEx) + ' เป็น ' + projectionPercent(projection.avgAfterEx) +
      ' และกำไรเฉลี่ยที่หักภาษีมูลค่าเพิ่มแล้วเปลี่ยนจาก ' + projectionPercent(projection.avgBeforeInc) + ' เป็น ' + projectionPercent(projection.avgAfterInc) + '.';
  }
  return text;
}

function recClass(recAct) {
  if (recAct === 'คงที่') return 'rec-const';
  if (recAct === 'ปรับขึ้น') return 'rec-up';
  if (recAct === 'ปรับลง') return 'rec-down';
  if (recAct === 'ฝากพิจารณา') return 'rec-cons';
  if (recAct === 'สินค้าไม่เคลื่อนไหว') return 'rec-inact';
  return '';
}

function fixHead() {
  var rows = $('#mt thead').rows, t = 0;
  for (var i = 0; i < rows.length; i++) {
    for (var j = 0; j < rows[i].cells.length; j++) rows[i].cells[j].style.top = t + 'px';
    t += rows[i].getBoundingClientRect().height;
  }
}
window.addEventListener('resize', fixHead);
window.addEventListener('load', fixHead);

function gLink(x) {
  var q = encodeURIComponent((String(x.code || '').trim() + ' ' + String(x.name || '').trim()).trim());
  return '<td><a class="gbtn" href="https://www.google.com/search?q=' + q + '" target="_blank" rel="noopener noreferrer" title="ค้นหา ' + esc(x.code) + ' ' + esc(x.name) + ' ใน Google"><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>Google</span></a></td>';
}

function renderTable() {
  var list = filteredItems();
  var edit = !!(D.me && D.me.edit) && D.ver === 'cur';
  var maxPage = Math.max(0, Math.ceil(list.length / PAGE) - 1);
  if (F.page > maxPage) F.page = maxPage;
  var start = F.page * PAGE;
  var slice = list.slice(start, start + PAGE);

  $('#dtNote').textContent = 'แสดง ' + nf0.format(slice.length) + ' จาก ' + nf0.format(list.length) + ' รายการ';
  $('#pgInfo').textContent = list.length ? 'หน้า ' + (F.page + 1) + ' / ' + (maxPage + 1) + ' (' + (start + 1) + '–' + (start + slice.length) + ')' : '0 รายการ';
  $('#pgPrev').disabled = F.page <= 0;
  $('#pgNext').disabled = F.page >= maxPage;

  if (!slice.length) {
    $('#mtBody').innerHTML = '<tr><td colspan="19" class="muted" style="padding:28px;text-align:center">ไม่พบรายการตามตัวกรองที่เลือก</td></tr>';
    if (window.WorkspaceUI) WorkspaceUI.marketRows();
    fixHead();
    return;
  }

  $('#mtBody').innerHTML = slice.map(function (x, idx) {
    var no = start + idx + 1;
    var rCls = recClass(x.recAct);
    var inact = x.recAct === 'สินค้าไม่เคลื่อนไหว';
    var oDash = inact || x.mktMin === '-';
    var pDash = inact || x.mktMax === '-';
    var update = latestUpdate(x);
    var chgColor = /^>/.test(x.chgTxt) ? 'color:var(--bad);font-weight:600' : (/^</.test(x.chgTxt) ? 'color:var(--ok);font-weight:600' : '');

    if (!edit) {
      return '<tr>' +
        '<td><b>' + no + '</b></td>' +
        '<td class="code">' + esc(x.code) + '</td>' +
        '<td class="nm">' + esc(x.name) + '</td>' +
        '<td>' + nf0.format(x.qty) + '</td>' +
        '<td class="chg" style="' + chgColor + '">' + esc(update.text) + '</td>' +
        '<td class="c-cost">' + money(x.cost) + '</td>' +
        '<td class="c-price">' + money(x.price) + '</td>' +
        '<td>' + money(x.profitEx) + '</td>' +
        '<td>' + pctF(x.marginEx) + '</td>' +
        '<td class="c-vat">' + money(x.costVat) + '</td>' +
        '<td>' + money(x.profitInc) + '</td>' +
        '<td>' + pctF(x.marginInc) + '</td>' +
        '<td class="c-p30">' + money(x.price30) + '</td>' +
        '<td class="c-mkt' + (oDash ? ' mkt-dash' : '') + '">' + (x.mktMin === '' ? '' : (typeof x.mktMin === 'number' ? money(x.mktMin) : esc(x.mktMin))) + '</td>' +
        '<td class="c-mkt' + (pDash ? ' mkt-dash' : '') + '">' + (x.mktMax === '' ? '' : (typeof x.mktMax === 'number' ? money(x.mktMax) : esc(x.mktMax))) + '</td>' +
        '<td class="' + rCls + '">' + esc(x.recAct) + '</td>' +
        '<td class="' + rCls + '">' + (x.recPrice === '' ? '' : money(x.recPrice)) + projectionNote(x) + '</td>' +
        '<td>' + esc(x.editNote) + '</td>' +
        gLink(x) +
      '</tr>';
    }

    var opts = (REC_OPTS.indexOf(x.recAct) < 0 ? [x.recAct].concat(REC_OPTS) : REC_OPTS).map(function (o) {
      return '<option value="' + esc(o) + '"' + (x.recAct === o ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('');

    return '<tr data-idx="' + x.i + '">' +
      '<td><b>' + no + '</b></td>' +
      '<td class="code">' + esc(x.code) + '</td>' +
      '<td class="nm">' + esc(x.name) + '</td>' +
      '<td>' + nf0.format(x.qty) + '</td>' +
      '<td class="chg" style="' + chgColor + '">' + esc(update.text) + '</td>' +
      '<td class="c-cost">' + money(x.cost) + '</td>' +
      '<td class="c-price">' + money(x.price) + '</td>' +
      '<td>' + money(x.profitEx) + '</td>' +
      '<td>' + pctF(x.marginEx) + '</td>' +
      '<td class="c-vat">' + money(x.costVat) + '</td>' +
      '<td>' + money(x.profitInc) + '</td>' +
      '<td>' + pctF(x.marginInc) + '</td>' +
      '<td class="c-p30">' + money(x.price30) + '</td>' +
      '<td class="c-mkt' + (oDash ? ' mkt-dash' : '') + '"><input type="text" class="in-cell" data-f="8" aria-label="ราคาท้องตลาดต่ำสุด ' + esc(x.name) + '" value="' + esc(x.mktMin) + '" placeholder="-"></td>' +
      '<td class="c-mkt' + (pDash ? ' mkt-dash' : '') + '"><input type="text" class="in-cell" data-f="9" aria-label="ราคาท้องตลาดสูงสุด ' + esc(x.name) + '" value="' + esc(x.mktMax) + '" placeholder="-"></td>' +
      '<td class="' + rCls + '"><select class="in-cell" data-f="10" aria-label="รายการแนะนำ ' + esc(x.name) + '">' + opts + '</select></td>' +
      '<td class="' + rCls + '"><input type="text" class="in-cell" data-f="11" aria-label="ราคาแนะนำ ' + esc(x.name) + '" value="' + esc(x.recPrice) + '" placeholder="ราคา">' + projectionNote(x) + '</td>' +
      '<td><input type="text" class="in-cell left" data-f="12" aria-label="หมายเหตุการแก้ไข ' + esc(x.name) + '" value="' + esc(x.editNote) + '" placeholder="หมายเหตุ"></td>' +
      gLink(x) +
    '</tr>';
  }).join('');
  if (window.WorkspaceUI) WorkspaceUI.marketRows();
  fixHead();
}

/* ---------- แก้ไขค่าในตารางโดยตรง ---------- */
$('#mtBody').addEventListener('change', function (e) {
  if (!D.me || !D.me.edit || D.ver !== 'cur') return;
  var el = e.target.closest('[data-f]'); if (!el) return;
  var tr = el.closest('tr[data-idx]'); if (!tr) return;
  var idx = Number(tr.dataset.idx), item = D.items[idx]; if (!item) return;
  var f = Number(el.dataset.f), v = el.value.trim(), keepFocus = document.activeElement === el;
  if (f === 8 || f === 9 || f === 11) {
    if (v !== '' && v !== '-') {
      var parsed = marketNumber(v);
      if (parsed === null || parsed < 0) {
        toast('กรุณากรอกราคาเป็นตัวเลขตั้งแต่ 0 ขึ้นไป หรือเว้นว่าง', true);
        el.value = item.raw[f] == null ? '' : item.raw[f];
        el.focus(); return;
      }
      v = parsed;
    }
    var min = f === 8 ? marketNumber(v) : marketNumber(item.raw[8]);
    var max = f === 9 ? marketNumber(v) : marketNumber(item.raw[9]);
    if ((f === 8 || f === 9) && min !== null && max !== null && min > max) {
      toast('ราคาต่ำสุดต้องไม่มากกว่าราคาสูงสุด', true);
      el.value = item.raw[f] == null ? '' : item.raw[f];
      el.focus(); return;
    }
  }
  item.raw[f] = v;
  D.items[idx] = calcItem(item.raw, idx);
  DIRTY = true;
  $('#bSaveEdits').classList.remove('hidden');
  saveLocalState();
  renderAll();
  if(keepFocus){var replacement=document.querySelector('#mtBody tr[data-idx="'+idx+'"] [data-f="'+f+'"]');if(replacement)replacement.focus({preventScroll:true});}
});

$('#bSaveEdits').addEventListener('click', function () {
  busy(this, async function () {
    var ok = await syncThen('บันทึกข้อมูลการสำรวจราคาตลาดแล้ว');
    if (ok) { $('#bSaveEdits').classList.toggle('hidden', !DIRTY); if(!DIRTY)$('#fQ').focus({preventScroll:true}); }
  });
});

['#sigSurveyor', '#sigChecker', '#sigApprover'].forEach(function (sel) {
  $(sel).addEventListener('change', function () {
    if (!D.me || !D.me.edit || D.ver !== 'cur') return;
    D.surveyor = $('#sigSurveyor').value.trim();
    D.checker = $('#sigChecker').value.trim();
    D.approver = $('#sigApprover').value.trim();
    syncToServer();
  });
});

/* ---------- คำนวณรายการแนะนำอัตโนมัติ ---------- */
$('#bAutoRec').addEventListener('click', function () {
  if (!D.me || !D.me.edit || D.ver !== 'cur') return;
  var list = filteredItems();
  if (!list.length) return;
  var cnt = 0, skipped = 0;
  list.forEach(function (x) {
    var r = x.raw;
    if (x.qty <= 0) {
      if (r[10] !== 'สินค้าไม่เคลื่อนไหว') { r[10] = 'สินค้าไม่เคลื่อนไหว'; r[11] = ''; cnt++; }
      return;
    }
    var mn = (typeof x.mktMin === 'number' && isFinite(x.mktMin)) ? x.mktMin : null;
    var mx = (typeof x.mktMax === 'number' && isFinite(x.mktMax)) ? x.mktMax : null;
    if ((mn === null && mx === null) || (mn !== null && mx !== null && mn > mx)) { skipped++; return; }
    var nextAct = 'คงที่', nextP = '';
    if (mx !== null && x.price > mx) {
      if (mx >= x.costVat) { nextAct = 'ปรับลง'; nextP = mx; }
      else { nextAct = 'ฝากพิจารณา'; nextP = ''; }
    } else if (mn !== null && x.price < mn) {
      nextAct = 'ปรับขึ้น'; nextP = mn;
    }
    if (r[10] !== nextAct || String(r[11] || '') !== String(nextP)) {
      r[10] = nextAct; r[11] = nextP; cnt++;
    }
  });
  rebuildItems();
  renderAll();
  if (cnt) syncThen('คำนวณรายการแนะนำอัตโนมัติแล้ว · เปลี่ยนแปลง ' + nf0.format(cnt) + ' รายการ' + (skipped ? ' · ข้ามรายการที่ราคาตลาดไม่ครบหรือไม่ถูกต้อง ' + nf0.format(skipped) + ' รายการ' : ''));
  else toast('ไม่มีรายการแนะนำที่เปลี่ยนแปลง' + (skipped ? ' · ข้ามรายการที่ยังไม่มีราคาตลาดที่ใช้คำนวณได้ ' + nf0.format(skipped) + ' รายการ' : ''));
});

/* ---------- ตัวกรองและเปลี่ยนหน้า ---------- */
$('#verTabs').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-v]'); if (!b || b.disabled) return;
  D.ver = b.dataset.v; F.page = 0;
  rebuildItems(); renderAll();
});
$('#brSel').addEventListener('change', function () {
  setBranch(this.value); F.g = ''; F.page = 0; F.rec = '';
  rebuildItems(); renderAll();
});
$('#fGrp').addEventListener('change', function () { F.g = this.value; F.page = 0; renderAll(); });
$('#fMove').addEventListener('change', function () { F.move = this.value; F.page = 0; renderAll(); });
$('#fQ').addEventListener('input', function () { F.q = this.value; F.page = 0; renderTable(); });
$('#chips').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-rec]'); if (!b) return;
  F.rec = b.dataset.rec; F.page = 0; renderAll();
});
$('#pgPrev').addEventListener('click', function () { if (F.page > 0) { F.page--; renderTable(); } });
$('#pgNext').addEventListener('click', function () { F.page++; renderTable(); });
$('#bReload').addEventListener('click', function () {
  if (DIRTY && !confirm('ยังมีการแก้ไขที่ไม่ได้บันทึก ต้องการโหลดข้อมูลจากเซิร์ฟเวอร์และละทิ้งการแก้ไขหรือไม่?')) return;
  DIRTY = false; saveLocalState();
  busy(this, async function () { await SAVE_CHAIN; if (await load()) toast('รีเฟรชข้อมูลล่าสุดแล้ว'); });
});
window.addEventListener('beforeunload', function (e) {
  flushLocalState();
  if (!DIRTY) return;
  e.preventDefault(); e.returnValue = '';
});
window.addEventListener('pagehide', flushLocalState);
document.addEventListener('visibilitychange', function () { if (document.hidden) flushLocalState(); });
$('#bEmptyUpload').addEventListener('click', function () { $('#bUpload').click(); });

/* ---------- อ่านไฟล์ Excel ที่อัปโหลด (รองรับทั้งไฟล์สำรวจราคาตลาด และไฟล์รายงานวิเคราะห์การขาย POS) ---------- */
function normH(s) { return String(s == null ? '' : s).replace(/[\s\u00a0]+/g, '').toLowerCase(); }
function parseDateCell(v) {
  if (v === null || v === undefined || v === '' || v === '-') return '-';
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    var y = +m[3]; if (y > 2400) y -= 543;
    return y + '-' + pad2(+m[2]) + '-' + pad2(+m[1]);
  }
  return s;
}

function parseMarketWorkbook(sheets, defGrp, defName, upDateIso) {
  var groups = Object.create(null), names = Object.create(null), surveyNote = '', totalRead = 0;
  (sheets || []).forEach(function (sh) {
    var grid = sh.grid || [], shName = String(sh.name || '').trim();
    if (!grid.length) return;

    var grpCode = '', grpName = '', repDate = upDateIso || todayIso(), sNote = '';
    for (var r = 0; r < Math.min(grid.length, 6); r++) {
      var rowStr = (grid[r] || []).map(function (x) { return String(x == null ? '' : x); }).join(' ');
      var m1 = rowStr.match(/วันที่\s*(\d{1,2}\/\d{1,2}\/\d{4})/);
      if (m1) repDate = parseDateCell(m1[1]);
      var mSurv = rowStr.match(/(สุ่มสำรวจ[^,\r\n]*)/);
      if (mSurv) sNote = mSurv[1].trim();
      var mCat = rowStr.match(/หมวด(?:สินค้า)?\s*([A-Za-z0-9_-]+)\s+([^,\r\n]+)/);
      if (mCat) { grpCode = mCat[1].trim().toUpperCase(); grpName = mCat[2].split(" · สาขา ")[0].trim(); }
    }
    if (!grpCode) {
      if (/^[A-Za-z0-9_-]{1,12}$/.test(shName)) grpCode = shName.toUpperCase();
      else {
        var mSh = shName.match(/^(\d+|[A-Za-z]+\d+)\s*(.*)$/);
        if (mSh) { grpCode = mSh[1].toUpperCase(); if (mSh[2] && !grpName) grpName = mSh[2].trim(); }
      }
    }
    if (!grpCode) grpCode = (defGrp || '34').toUpperCase();
    if (!grpName && defName) grpName = defName;
    if (grpName) names[grpCode] = grpName;
    if (sNote) surveyNote = sNote;

    /* ตรวจว่าเป็นไฟล์สำรวจราคาตลาด (แบบ 34ผลิตภัณฑ์ดูแลผ้า.xlsx) หรือไฟล์รายงานสต็อก POS */
    var nativeHeader = grid.slice(0, 12).findIndex(function (r) { return r && normH(r[22]) === normH("หมวดสินค้า") && normH(r[1]) === normH("รหัสสินค้า"); });
    var nativeMarket = nativeHeader >= 0, isMarketFmt = nativeMarket, dataStartRow = nativeMarket ? nativeHeader + 1 : -1;
    for (var i = 0; !isMarketFmt && i < Math.min(grid.length, 12); i++) {
      var r0 = grid[i] || [];
      var joined = r0.map(normH).join('|');
      if (joined.indexOf('ราคาท้องตลาด') >= 0 || joined.indexOf('รายการแนะนำ') >= 0 || joined.indexOf('ต้นทุน+vat') >= 0) {
        isMarketFmt = true;
        nativeMarket = normH(r0[22]) === normH("หมวดสินค้า");
        dataStartRow = nativeMarket ? i + 1 : i + 3;
        break;
      }
    }
    if (isMarketFmt) {
      if (nativeMarket) delete names[grpCode];
      while (dataStartRow < grid.length) {
        var rr = grid[dataStartRow] || [];
        var c0 = normH(rr[0]), c4 = normH(rr[4]), c14 = normH(rr[14]);
        if (c4 === 'การปรับ' || c14 === 'ต่ำสุด' || (!rr[1] && !rr[2])) { dataStartRow++; continue; }
        break;
      }
      for (var r2 = dataStartRow; r2 < grid.length; r2++) {
        var row = grid[r2] || [];
        var code = String(row[1] == null ? '' : row[1]).trim();
        var name = String(row[2] == null ? '' : row[2]).trim();
        if (!code || !name || /กำไรเฉลี่ย|สรุปการสำรวจ|ลงชื่อ/.test(name)) continue;
        var qty = Number(String(row[3] == null ? '0' : row[3]).replace(/,/g, ''));
        if (!isFinite(qty)) qty = 0;
        var chgTxt = String(row[4] == null || row[4] === '' ? '-' : row[4]).trim();
        var chgDate = parseDateCell(row[5]);
        if (chgTxt === 'นำเข้าข้อมูล') { chgTxt = '-'; chgDate = '-'; }
        if (chgTxt === 'อัปเดตจากไฟล์') chgTxt = '-';
        var cost = Number(String(row[6] == null ? '0' : row[6]).replace(/,/g, '')) || 0;
        var price = Number(String(row[7] == null ? '0' : row[7]).replace(/,/g, '')) || 0;
        var mktMin = marketCell(row[14]);
        var mktMax = marketCell(row[15]);
        var recAct = String(row[16] == null || row[16] === '' ? (qty <= 0 ? 'สินค้าไม่เคลื่อนไหว' : 'คงที่') : row[16]).trim();
        var recPrice = marketCell(row[17]);
        var editNote = String(row[18] == null ? '' : row[18]).trim();
        var rowGroup = nativeMarket ? String(row[22] || grpCode).trim().toUpperCase() : grpCode;
        var rowRep = nativeMarket && row[23] != null ? parseDateCell(row[23]) : repDate;
        if (!rowRep || rowRep === "-") rowRep = repDate;
        if (nativeMarket && row[24] != null && String(row[24]).trim()) names[rowGroup] = String(row[24]).trim();
        (groups[rowGroup] || (groups[rowGroup] = { g: rowGroup, rep: rowRep, surveyNote: sNote, items: [] })).items.push({
          g: rowGroup, code: code, name: name, qty: qty, chgTxt: chgTxt, chgDate: chgDate,
          cost: cost, price: price, mktMin: mktMin, mktMax: mktMax, recAct: recAct, recPrice: recPrice, editNote: editNote, rep: rowRep, hasMarketCols: true
        });
        totalRead++;
      }
      return;
    }

    /* ไฟล์ Allproduct: ทุกสาขาอยู่ในชีตเดียว แต่ละสาขามีคอลัมน์ "<รหัสสาขา>ปรับ" ตามด้วย "ขาย" ของสาขานั้น
       คอลัมน์ "อัพเดท" = วันที่อัปเดตล่าสุดของสินค้า · แตกเป็นรายการต่อสาขา แล้วให้เลือกสาขาที่ตรงตอนอัปโหลด */
    var apHdr = -1, apC = {}, apBr = [];
    for (var ah = 0; ah < Math.min(grid.length, 15) && apHdr < 0; ah++) {
      var ahr = grid[ah] || [], am = Object.create(null), brs = [];
      ahr.forEach(function (cell, j) {
        var raw = String(cell == null ? '' : cell).replace(/[\s\u00a0]+/g, ''), k = raw.toLowerCase();
        if (k && am[k] === undefined) am[k] = j;
        var mb = /^([A-Za-z0-9]{1,8})ปรับ$/.exec(raw);
        if (mb) {
          var pc = -1;
          for (var j2 = j + 1; j2 < ahr.length; j2++) { if (normH(ahr[j2]) === 'ขาย') { pc = j2; break; } }
          if (pc >= 0) brs.push({ name: mb[1].toUpperCase(), chg: j, price: pc });
        }
      });
      if (brs.length && am['ชื่อสินค้า'] !== undefined && (am['รหัส'] !== undefined || am['barcode'] !== undefined) && am['ต้นทุน'] !== undefined) {
        apHdr = ah; apBr = brs;
        apC = { g: am['กลุ่ม'], code: am['รหัส'], bar: am['barcode'], name: am['ชื่อสินค้า'], qty: am['จำนวน'], cost: am['ต้นทุน'], upd: am['อัพเดท'] !== undefined ? am['อัพเดท'] : am['อัปเดต'] };
      }
    }
    if (apHdr >= 0) {
      var cellStr = function (row, j) { return j === undefined || row[j] == null ? '' : String(row[j]).replace(/\u00a0/g, ' ').trim(); };
      for (var ar = apHdr + 1; ar < grid.length; ar++) {
        var arow = grid[ar] || [];
        var aname = cellStr(arow, apC.name), acode = cellStr(arow, apC.code) || cellStr(arow, apC.bar);
        if (!aname || !acode) continue;
        var ag = (cellStr(arow, apC.g) || grpCode).toUpperCase();
        var aqty = Number(cellStr(arow, apC.qty).replace(/,/g, '')) || 0;
        var acost = Number(cellStr(arow, apC.cost).replace(/,/g, '')) || 0;
        var adate = apC.upd !== undefined ? parseDateCell(arow[apC.upd]) : '-';
        apBr.forEach(function (b) {
          var aprice = Number(cellStr(arow, b.price).replace(/,/g, '')) || 0;
          var achg = cellStr(arow, b.chg).replace(/^([<>])\s*(ปรับ(?:ลง|ขึ้น))\s*เดิม\s*([\d.,]+)\s*(ลง|ขึ้น)\s*([\d.,]+)/, '$1 $2\nเดิม $3 $4 $5') || '-';
          (groups[ag] || (groups[ag] = { g: ag, rep: repDate, surveyNote: sNote, items: [] })).items.push({
            g: ag, code: acode, name: aname, sourceBranch: b.name, qty: aqty, chgTxt: achg, chgDate: adate,
            cost: acost, price: aprice, mktMin: '', mktMax: '', recAct: aqty <= 0 ? 'สินค้าไม่เคลื่อนไหว' : 'คงที่', recPrice: '', editNote: '', rep: repDate, hasMarketCols: false
          });
          totalRead++;
        });
      }
      return;
    }

    /* กรณีเป็นไฟล์รายงานวิเคราะห์การขาย / สต็อกสินค้าจาก POS */
    var hdrRow = -1, idx = {};
    var aliases = {
      g: ['กลุ่ม', 'หมวด'], code: ['รหัส', 'บาร์โค้ด', 'เลขบาร์'], name: ['ชื่อสินค้า', 'ชื่อรายการ'],
      branch: ['สาขา', 'ชื่อสาขา', 'branch'],
      chgTxt: ['การปรับ', 'การปรับราคา', 'อัปเดตล่าสุด', 'อัพเดตล่าสุด'],
      chgDate: ['วันที่ปรับราคา', 'วันที่อัปเดต', 'วันที่อัพเดต', 'วันที่ปรับปรุง', 'วันที่'],
      oldPrice: ['ราคาขายเดิม', 'ราคาเดิม'],
      qty: ['คงเหลือ', 'จำนวนคงเหลือสินค้า', 'จำนวน'], cost: ['ต้นทุนล่าสุด', 'ต้นทุน', 'ทุน'], price: ['ราคาขาย', 'ราคา']
    };
    for (var h = 0; h < Math.min(grid.length, 15); h++) {
      var hr = grid[h] || [], hmap = Object.create(null), candidate = {};
      hr.forEach(function (cell, j) { var k = normH(cell); if (k && hmap[k] === undefined) hmap[k] = j; });
      Object.keys(aliases).forEach(function (key) {
        aliases[key].forEach(function (al) {
          var j = hmap[normH(al)];
          if (j !== undefined && candidate[key] === undefined) candidate[key] = j;
        });
      });
      if (candidate.code !== undefined && candidate.name !== undefined && candidate.cost !== undefined && candidate.price !== undefined) { idx = candidate; hdrRow = h; break; }
    }
    if (hdrRow < 0) return;
    for (var pr = hdrRow + 1; pr < grid.length; pr++) {
      var prow = grid[pr] || [];
      var pname = String(prow[idx.name] == null ? '' : prow[idx.name]).trim();
      if (!pname) continue;
      var pg = (idx.g !== undefined && prow[idx.g] != null ? String(prow[idx.g]).trim().toUpperCase() : '') || grpCode;
      var pcode = idx.code !== undefined && prow[idx.code] != null ? String(prow[idx.code]).trim() : '';
      if (!pcode) continue;
      var pbranch = idx.branch !== undefined && prow[idx.branch] != null ? String(prow[idx.branch]).replace(/\s+/g, ' ').trim() : '';
      var pqty = idx.qty !== undefined ? (Number(String(prow[idx.qty] || '0').replace(/,/g, '')) || 0) : 0;
      var pcost = idx.cost !== undefined ? (Number(String(prow[idx.cost] || '0').replace(/,/g, '')) || 0) : 0;
      var pprice = idx.price !== undefined ? (Number(String(prow[idx.price] || '0').replace(/,/g, '')) || 0) : 0;
      var pchg = idx.chgTxt !== undefined ? String(prow[idx.chgTxt] || '-').trim() : '-';
      var pdate = idx.chgDate !== undefined ? parseDateCell(prow[idx.chgDate]) : '-';
      var pold = idx.oldPrice !== undefined ? marketNumber(prow[idx.oldPrice]) : null;
      if (pchg === '-' && pold !== null && Math.abs(pold - pprice) >= 0.005) {
        pchg = (pprice > pold ? '> ปรับขึ้น\nเดิม ' + pold + ' ขึ้น ' + pprice : '< ปรับลง\nเดิม ' + pold + ' ลง ' + pprice);
      }
      (groups[pg] || (groups[pg] = { g: pg, rep: repDate, surveyNote: sNote, items: [] })).items.push({
        g: pg, code: pcode, name: pname, sourceBranch: pbranch, qty: pqty, chgTxt: pchg, chgDate: pdate,
        cost: pcost, price: pprice, mktMin: '', mktMax: '', recAct: pqty <= 0 ? 'สินค้าไม่เคลื่อนไหว' : 'คงที่', recPrice: '', editNote: '', rep: repDate, hasMarketCols: false
      });
      totalRead++;
    }
  });
  return { groups: groups, names: names, surveyNote: surveyNote, totalRead: totalRead };
}

/* รวมข้อมูลที่อัปโหลดเข้ากับหมวดเดิม + ตรวจจับการปรับราคาขายอัตโนมัติ (เดิม X ขึ้น/ลง Y) */
function mergeUploadedGroup(g, newItems, fileName, repDate, ts, sNote) {
  var oldCur = D.groups[g] && D.groups[g].cur ? D.groups[g].cur : null;
  var oldMap = Object.create(null);
  if (oldCur && Array.isArray(oldCur.rows)) {
    oldCur.rows.forEach(function (r) {
      var k = codeKey(r[1] || r[2]);
      if (k) oldMap[k] = r;
    });
  }
  var mergedRows = [], priceChangedCnt = 0;
  newItems.forEach(function (it) {
    var k = codeKey(it.code || it.name);
    var old = oldMap[k];
    var chgTxt = it.chgTxt || '-';
    var chgDate = it.chgDate || '-';
    var mktMin = it.mktMin !== undefined ? it.mktMin : '';
    var mktMax = it.mktMax !== undefined ? it.mktMax : '';
    var recAct = it.recAct || (it.qty <= 0 ? 'สินค้าไม่เคลื่อนไหว' : 'คงที่');
    var recPrice = it.recPrice !== undefined ? it.recPrice : '';
    var editNote = it.editNote || '';

    if (old) {
      var oldPrice = Number(old[7]) || 0;
      var newPrice = Number(it.price) || 0;
      if (newPrice !== oldPrice && chgTxt === '-') {
        chgTxt = (newPrice > oldPrice ? '> ปรับขึ้น\nเดิม ' + oldPrice + ' ขึ้น ' + newPrice : '< ปรับลง\nเดิม ' + oldPrice + ' ลง ' + newPrice);
        chgDate = repDate || todayIso();
        priceChangedCnt++;
      } else if (chgTxt === '-' && chgDate === '-' && old[4] && old[4] !== '-') {
        chgTxt = old[4];
        chgDate = old[5] || '-';
      }
      if (!it.hasMarketCols) {
        if (mktMin === '' && old[8] !== '') mktMin = old[8];
        if (mktMax === '' && old[9] !== '') mktMax = old[9];
        if (old[10]) {
          if (it.qty <= 0) recAct = 'สินค้าไม่เคลื่อนไหว';
          else if (old[10] === 'สินค้าไม่เคลื่อนไหว') recAct = 'คงที่';
          else recAct = old[10];
        }
        if (recPrice === '' && old[11] !== '' && it.qty > 0) recPrice = old[11];
        if (!editNote && old[12]) editNote = old[12];
      }
    }

    var newRow = [
      g, it.code, it.name, it.qty, chgTxt, chgDate,
      Math.round((Number(it.cost) || 0) * 10000) / 10000,
      Math.round((Number(it.price) || 0) * 100) / 100,
      mktMin, mktMax, recAct, recPrice, editNote, repDate || todayIso()
    ];
    sanitizeChg(newRow);      // การปรับไม่ตรงกับราคาขาย → ลบการปรับ+วันที่
    mergedRows.push(newRow);
  });

  D.groups[g] = {
    cur: {
      ts: ts,
      who: (D.me && D.me.name) || 'Admin',
      file: fileName,
      rep: repDate || todayIso(),
      surveyNote: sNote || (oldCur && oldCur.surveyNote) || D.surveyNote || '',
      count: mergedRows.length,
      rows: mergedRows
    },
    prev: oldCur
  };
  return priceChangedCnt;
}

/* ---------- หน้าต่างอัปโหลดไฟล์ Excel ---------- */
var UP = null;
var UP_READ_ID = 0;

function uploadSourceBranches(groups) {
  var sources = Object.create(null);
  Object.keys(groups).forEach(function (g) {
    groups[g].items.forEach(function (it) {
      var name = String(it.sourceBranch || '').trim(), key = brKey(name);
      if (!sources[key]) sources[key] = { key: key, name: name, count: 0 };
      sources[key].count++;
    });
  });
  return Object.keys(sources).sort().map(function (key) { return sources[key]; });
}

function filterUploadGroups(groups, sourceKey) {
  var selected = Object.create(null), totalRows = 0;
  Object.keys(groups).forEach(function (g) {
    var grp = groups[g], items = grp.items.filter(function (it) { return brKey(it.sourceBranch) === sourceKey; });
    if (!items.length) return;
    selected[g] = { g: grp.g, rep: grp.rep, surveyNote: grp.surveyNote, items: items };
    totalRows += items.length;
  });
  return { groups: selected, totalRows: totalRows };
}

function uploadDestinationName() {
  return $('#upBr').value === '__new__' ? $('#upBrNew').value.replace(/\s+/g, ' ').trim() : $('#upBr').value;
}

function selectUploadDestination() {
  if (!UP) return;
  var source = UP.sources.filter(function (s) { return s.key === $('#upSourceBr').value; })[0];
  if (!source || !source.name) return;
  var existing = findBranch(source.name);
  $('#upBr').value = existing || '__new__';
  $('#upBrNew').value = existing ? '' : source.name;
  $('#upBrNewW').classList.toggle('hidden', !!existing);
}

function matchUploadSource() {
  if (!UP) return;
  if (UP.sources.length === 1 && !UP.sources[0].name) return;
  var key = brKey(uploadDestinationName());
  var matching = UP.sources.filter(function (s) { return s.name && s.key === key; })[0];
  $('#upSourceBr').value = matching ? matching.key : '__choose__';
}

function renderUploadPreview() {
  if (!UP) return;
  var sourceKey = $('#upSourceBr').value;
  var selection = filterUploadGroups(UP.allGroups, sourceKey);
  UP.groups = selection.groups;
  UP.sourceKey = sourceKey;
  UP.totalRows = selection.totalRows;
  var gKeys = Object.keys(UP.groups).sort();
  var source = UP.sources.filter(function (s) { return s.key === sourceKey; })[0];
  var target = uploadDestinationName();
  var matches = !source || !source.name || brKey(source.name) === brKey(target);
  var targetNames = D.store[findBranch(target) || target];
  $('#pv').innerHTML =
    '<div><b>ข้อมูลจากสาขา: ' + esc(source ? (source.name || 'ไม่ระบุสาขาในไฟล์') : 'กรุณาเลือกสาขาที่ตรงกัน') + '</b> → <b>บันทึกที่สาขา: ' + esc(target || 'กรุณาระบุสาขาปลายทาง') + '</b></div>' +
    (!matches ? '<div class="err">สาขาปลายทางต้องตรงกับสาขาที่เลือกจากไฟล์</div>' : '') +
    '<div class="pvk">' +
      '<div><b>' + gKeys.length + '</b><span>หมวดสินค้าที่เลือก</span></div>' +
      '<div><b>' + nf0.format(UP.totalRows) + '</b><span>รายการของสาขาที่เลือก</span></div>' +
      '<div><b>' + esc(fmtDateSlash($('#upDate').value || UP.repDate, false)) + '</b><span>วันที่อัปข้อมูลเข้า</span></div>' +
    '</div>' +
    '<div class="muted">อ่านจากไฟล์ทั้งหมด ' + nf0.format(UP.totalRead) + ' รายการ · นำเข้าเฉพาะสาขาที่เลือก ' + nf0.format(UP.totalRows) + ' รายการ</div>' +
    '<div class="muted">หมวดที่จะอัปเดต: ' + gKeys.map(function (g) {
      var nm = UP.names[g] || (targetNames && targetNames.names[g]) || '';
      return '<b>' + esc(g + (nm ? ' · ' + nm : '')) + '</b> (' + nf0.format(UP.groups[g].items.length) + ' รายการ)';
    }).join(', ') + '</div>';
  $('#pv').classList.remove('hidden');
  $('#upSave').classList.toggle('hidden', !gKeys.length);
  $('#upSave').disabled = !gKeys.length || !target || !matches;
}

$('#bUpload').addEventListener('click', function () {
  UP_READ_ID++;
  UP = null;
  var bks = Object.keys(D.store).sort();
  $('#upBr').innerHTML = bks.map(function (b) { return '<option value="' + esc(b) + '"' + (D.br === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') +
    '<option value="__new__"' + (bks.length ? '' : ' selected') + '>+ เพิ่มสาขาใหม่…</option>';
  $('#upBrNew').value = '';
  $('#upBrNewW').classList.toggle('hidden', $('#upBr').value !== '__new__');
  $('#upDate').value = todayIso();
  $('#upDefGrp').value = F.g || '';
  $('#upDefName').value = (F.g && D.names[F.g]) || '';
  $('#upErr').textContent = '';
  $('#upSourceBr').innerHTML = '';
  $('#upSourceBrW').classList.add('hidden');
  $('#pv').classList.add('hidden');
  $('#upSave').classList.add('hidden');
  $('#upFile').value = '';
  $('#upDlg').classList.remove('hidden');
});
$('#upBr').addEventListener('change', function () {
  $('#upBrNewW').classList.toggle('hidden', this.value !== '__new__');
  matchUploadSource();
  renderUploadPreview();
});
$('#upSourceBr').addEventListener('change', function () { selectUploadDestination(); renderUploadPreview(); });
$('#upBrNew').addEventListener('input', function () { matchUploadSource(); renderUploadPreview(); });
$('#upDate').addEventListener('change', renderUploadPreview);
$('#upCancel').addEventListener('click', function () { UP_READ_ID++; UP = null; $('#upDlg').classList.add('hidden'); });
$('#drop').addEventListener('click', function () { $('#upFile').click(); });
['dragenter', 'dragover'].forEach(function (ev) { $('#drop').addEventListener(ev, function (e) { e.preventDefault(); this.classList.add('over'); }); });
['dragleave', 'drop'].forEach(function (ev) { $('#drop').addEventListener(ev, function (e) { e.preventDefault(); this.classList.remove('over'); }); });
$('#drop').addEventListener('drop', function (e) { var fs = e.dataTransfer && e.dataTransfer.files; if (fs && fs.length) handleUploadFiles(fs); });
$('#upFile').addEventListener('change', function () { if (this.files.length) handleUploadFiles(this.files); });

async function handleUploadFiles(fileList) {
  var readId = ++UP_READ_ID;
  UP = null;
  var files = Array.prototype.slice.call(fileList);
  $('#upErr').textContent = ''; $('#pv').classList.add('hidden'); $('#upSave').classList.add('hidden');
  $('#upSourceBrW').classList.add('hidden');
  try {
    var allGroups = Object.create(null), allNames = Object.create(null), fileNames = [], sNote = '', totalRows = 0;
    if (files.some(function (f) { return f.size > 100 * 1024 * 1024; })) throw new Error('ไฟล์ใหญ่เกิน 100 MB กรุณาแบ่งไฟล์ก่อนนำเข้า');
    if (typeof XLSX === 'undefined') throw new Error('ยังโหลดตัวอ่านไฟล์ Excel ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อและลองใหม่');
    var upDateIso = $('#upDate').value || todayIso();
    /* วันที่ข้อมูลล่าสุด: อ่านจากชื่อไฟล์ เช่น PStkall_691017.xls -> 17/10/2569 (ปีปี เดือน วัน แบบ พ.ศ.) */
    var fnIso = ''; for (var fi = 0; fi < files.length && !fnIso; fi++) fnIso = dateFromFileName(files[fi].name);
    if (fnIso) { upDateIso = fnIso; $('#upDate').value = fnIso; }
    var defG = $('#upDefGrp').value.trim() || '34';
    var defN = $('#upDefName').value.trim();

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      fileNames.push(f.name);
      var buf = await f.arrayBuffer();
      if (readId !== UP_READ_ID) return;
      var wb = XLSX.read(buf, { type: 'array', dense: true, cellStyles: false, cellFormula: false, cellHTML: false });
      buf = null;
      var sheets = wb.SheetNames.map(function (n) {
        var g = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
        delete wb.Sheets[n];
        return { name: n, grid: g };
      });
      var parsed = parseMarketWorkbook(sheets, defG, defN, upDateIso);
      Object.assign(allNames, parsed.names);
      if (parsed.surveyNote) sNote = parsed.surveyNote;
      totalRows += parsed.totalRead;
      Object.keys(parsed.groups).forEach(function (g) {
        if (allGroups[g]) allGroups[g].items = allGroups[g].items.concat(parsed.groups[g].items);
        else allGroups[g] = parsed.groups[g];
      });
    }
    var gKeys = Object.keys(allGroups).sort();
    if (!gKeys.length) throw new Error('ไม่พบตารางสินค้าในไฟล์ — ตรวจสอบว่าไฟล์มีคอลัมน์ รหัส, ชื่อสินค้า, ต้นทุน, ราคาขาย');

    var sources = uploadSourceBranches(allGroups);
    UP = { allGroups: allGroups, groups: Object.create(null), sources: sources, names: allNames, files: fileNames, surveyNote: sNote, repDate: upDateIso, totalRows: 0, totalRead: totalRows };
    $('#upSourceBr').innerHTML = '<option value="__choose__">เลือกสาขาที่ตรงกับปลายทาง…</option>' + sources.map(function (s) {
      return '<option value="' + esc(s.key) + '">' + esc(s.name || 'ไม่ระบุสาขาในไฟล์') + ' (' + nf0.format(s.count) + ' รายการ)</option>';
    }).join('');
    var matchingSource = sources.filter(function (s) { return s.key === brKey(uploadDestinationName()); })[0];
    $('#upSourceBr').value = matchingSource ? matchingSource.key : (sources.length === 1 ? sources[0].key : '__choose__');
    $('#upSourceBrW').classList.toggle('hidden', sources.length === 1 && !sources[0].name);
    selectUploadDestination();
    renderUploadPreview();
  } catch (e) {
    if (readId !== UP_READ_ID) return;
    $('#upErr').textContent = e.message;
  }
}

$('#upSave').addEventListener('click', function () {
  if (!UP) return;
  renderUploadPreview();
  var upload = Object.assign({}, UP), brName = uploadDestinationName();
  if (!Object.keys(upload.groups).length) { toast('ไม่พบข้อมูลของสาขาที่เลือก', true); return; }
  var source = upload.sources.filter(function (s) { return s.key === upload.sourceKey; })[0];
  if (source && source.name && brKey(source.name) !== brKey(brName)) { toast('กรุณาเลือกสาขาปลายทางให้ตรงกับสาขาในไฟล์', true); return; }
  busy(this, async function () {
    if (!brName) { toast('กรุณาเลือกสาขา หรือกรอกชื่อสาขาใหม่', true); return; }
    brName = findBranch(brName) || brName;
    ensureBranch(brName);
    setBranch(brName);
    Object.keys(upload.groups).forEach(function (g) { if (upload.names[g]) D.names[g] = upload.names[g]; });
    if (upload.surveyNote) D.surveyNote = upload.surveyNote;
    var ts = Date.now(), gKeys = Object.keys(upload.groups).sort(), chgSum = 0;
    gKeys.forEach(function (g) {
      var grp = upload.groups[g];
      chgSum += mergeUploadedGroup(g, grp.items, upload.files.join(', '), $('#upDate').value || grp.rep, ts, grp.surveyNote);
    });
    F.g = gKeys[0];
    D.ver = 'cur';
    $('#upDlg').classList.add('hidden');
    rebuildItems();
    renderAll();
    var upOk = await syncToServer();
    if (!upOk) return;
    toast('อัปโหลดข้อมูลเรียบร้อย · สาขา ' + brName + ' · ' + gKeys.length + ' หมวด (' + nf0.format(upload.totalRows) + ' รายการ)' + (chgSum ? ' · ตรวจพบการปรับราคาขาย ' + chgSum + ' รายการ' : ''));
  });
});

/* ---------- ตั้งค่าหมวดสินค้า ---------- */
function nmKeepEdits() {
  document.querySelectorAll('#nmGrid input[data-nmk]').forEach(function (inp) {
    D.names[inp.dataset.nmk] = inp.value.trim();
  });
}
function renderNmGrid() {
  $('#nmBrCur').textContent = D.br || '(ยังไม่มีสาขา)';
  $('#nmDelBrBtn').disabled = !D.br;
  var seen = Object.create(null);
  Object.keys(D.names).concat(Object.keys(D.groups)).forEach(function (k) { seen[k] = 1; });
  var ks = Object.keys(seen).sort();
  if (!ks.length) { $('#nmGrid').innerHTML = '<div class="muted">ยังไม่มีหมวดสินค้า</div>'; return; }
  $('#nmGrid').innerHTML = ks.map(function (k) {
    var g = D.groups[k], n = g && g.cur && g.cur.rows ? g.cur.rows.length : 0;
    return '<div style="display:flex;gap:6px;align-items:center;background:#faf7ff;border:1px solid var(--line);border-radius:10px;padding:6px 10px">' +
      '<b style="min-width:42px">' + esc(k) + '</b>' +
      '<input type="text" data-nmk="' + esc(k) + '" value="' + esc(D.names[k] || '') + '" style="flex:1;min-width:0">' +
      '<button type="button" class="btn ghost small" data-delg="' + esc(k) + '" style="color:var(--bad);border-color:var(--bad);flex:none" title="ลบหมวดนี้ (' + n + ' รายการ)">ลบ</button>' +
    '</div>';
  }).join('');
}
function deleteGroup(g) {
  var cnt = D.groups[g] && D.groups[g].cur && D.groups[g].cur.rows ? D.groups[g].cur.rows.length : 0;
  var label = g + (D.names[g] ? ' ' + D.names[g] : '');
  if (!confirm('ลบหมวด ' + label + (cnt ? ' (' + nf0.format(cnt) + ' รายการ ทั้งฉบับปัจจุบันและฉบับก่อนหน้า)' : '') + ' ?\nลบแล้วกู้คืนไม่ได้')) return false;
  delete D.groups[g];
  delete D.names[g];
  if (F.g === g) F.g = '';
  DIRTY = false;
  rebuildItems();
  renderAll();
  syncThen('ลบหมวด ' + label + ' แล้ว');
  return true;
}
$('#nmGrid').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-delg]'); if (!b) return;
  nmKeepEdits();
  if (deleteGroup(b.dataset.delg)) renderNmGrid();
});
$('#bDelGrp').addEventListener('click', function () { if (F.g) deleteGroup(F.g); });
$('#bNames').addEventListener('click', function () {
  renderNmGrid();
  $('#nmDlg').classList.remove('hidden');
});
$('#nmCancel').addEventListener('click', function () { $('#nmDlg').classList.add('hidden'); });
$('#nmAddBtn').addEventListener('click', function () {
  var c = $('#nmNewCode').value.trim().toUpperCase(), n = $('#nmNewName').value.trim();
  if (!D.br) { toast('กรุณาเพิ่มสาขาก่อน', true); return; }
  if (!c) { toast('กรุณากรอกรหัสหมวด', true); return; }
  nmKeepEdits();
  D.names[c] = n || c;
  $('#nmNewCode').value = ''; $('#nmNewName').value = '';
  renderNmGrid();
});
$('#nmAddBrBtn').addEventListener('click', function () {
  var n = $('#nmNewBr').value.replace(/\s+/g, ' ').trim();
  if (!n) { toast('กรุณากรอกชื่อสาขา', true); return; }
  if (findBranch(n)) { toast('มีสาขา ' + findBranch(n) + ' อยู่แล้ว', true); return; }
  nmKeepEdits();
  ensureBranch(n); setBranch(n);
  $('#nmNewBr').value = ''; F.g = ''; F.page = 0;
  rebuildItems(); renderAll(); renderNmGrid();
  syncThen('เพิ่มสาขา ' + n + ' แล้ว');
});
$('#nmDelBrBtn').addEventListener('click', function () {
  if (!D.br) return;
  var b = D.br, n = Object.keys(D.groups).length;
  if (!confirm('ลบสาขา ' + b + (n ? ' พร้อมข้อมูล ' + n + ' หมวด' : '') + ' ?\n(สาขาอื่นไม่ถูกแตะ) ลบแล้วกู้คืนไม่ได้')) return;
  delete D.store[b];
  D.br = ''; setBranch('');
  F.g = ''; F.page = 0; DIRTY = false;
  rebuildItems(); renderAll(); renderNmGrid();
  syncThen('ลบสาขา ' + b + ' แล้ว');
});
$('#nmSave').addEventListener('click', function () {
  document.querySelectorAll('#nmGrid input[data-nmk]').forEach(function (inp) {
    D.names[inp.dataset.nmk] = inp.value.trim();
  });
  $('#nmDlg').classList.add('hidden');
  renderAll();
  syncThen('บันทึกตั้งค่าหมวดแล้ว');
});
$('#bClearAll').addEventListener('click', function () {
  var n = Object.keys(D.groups).length;
  if (!D.br) { toast('ยังไม่มีสาขา', true); return; }
  if (!confirm('ลบข้อมูลเช็คราคาตลาดทุกหมวดของสาขา ' + D.br + (n ? ' (' + n + ' หมวด)' : '') + ' ออกจากระบบ ?\n(สาขาอื่นไม่ถูกแตะ) ลบแล้วกู้คืนไม่ได้')) return;
  Object.keys(D.groups).forEach(function (k) { delete D.groups[k]; });
  Object.keys(D.names).forEach(function (k) { delete D.names[k]; });
  F.g = '';
  DIRTY = false;
  $('#nmDlg').classList.add('hidden');
  rebuildItems();
  renderAll();
  syncThen('ลบข้อมูลทุกหมวดของสาขา ' + D.br + ' แล้ว');
});

/* ---------- เปิดหน้าต่างส่งออก Excel ---------- */
var EX_MKT_DEFAULT_LEFT = "";
function refreshExHeaders() {
  var useBe = $('#exYearMode').value === 'be';
  var m = curGroupMeta(F.g);
  var upDate = fmtDateSlash((m && (m.rep || m.ts)) || Date.now(), useBe);
  var exDate = fmtDateSlash(Date.now(), useBe);
  var sNote = stripOldNote((m && m.surveyNote) || D.surveyNote || '');
  EX_MKT_DEFAULT_LEFT = 'อัปข้อมูลเข้า วันที่ ' + upDate;
  $('#exLeftHead').value = EX_MKT_DEFAULT_LEFT;
  $('#exRightHead').value = 'ส่งออกข้อมูล วันที่ ' + exDate + (sNote ? ' · ' + sNote : '');
}

var EX_MKT_GRP_MODE = {};
function renderExMktSheetCustom() {
  var box = $('#exSheetCustomBox'), listEl = $('#exSheetCustomList');
  if (!box || !listEl) return;
  var sm = document.querySelector('input[name=exSheetMode]:checked');
  var isCustom = !!(sm && sm.value === 'custom');
  box.classList.toggle('hidden', !isCustom);
  if (!isCustom) return;
  var selMode = document.querySelector('input[name=exMode]:checked'), mode = selMode ? selMode.value : 'filter';
  var list = mode === 'all' ? D.items : filteredItems();
  var byG = Object.create(null);
  list.forEach(function (x) { (byG[x.g] || (byG[x.g] = [])).push(x); });
  var gs = Object.keys(byG).sort();
  listEl.innerHTML = gs.length ? gs.map(function (g) {
    var cur = EX_MKT_GRP_MODE[g] || 'split';
    var nm = (D.names && D.names[g]) || '';
    var label = g + (nm ? ' · ' + nm : '');
    return '<label style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 8px;background:#fff;border:1px solid var(--line);border-radius:8px;font-size:13px">' +
      '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(label) + '"><b>' + esc(label) + '</b> <span class="muted">(' + nf0.format(byG[g].length) + ')</span></span>' +
      '<select data-exgrp="' + esc(g) + '" style="width:auto;padding:2px 6px;font-size:12.5px">' +
        '<option value="split"' + (cur === 'split' ? ' selected' : '') + '>แยกชีต</option>' +
        '<option value="merge"' + (cur === 'merge' ? ' selected' : '') + '>รวมชีต</option>' +
        '<option value="skip"' + (cur === 'skip' ? ' selected' : '') + '>ไม่ส่งออก</option>' +
      '</select>' +
    '</label>';
  }).join('') : '<div class="muted">ไม่มีหมวดในขอบเขตที่เลือก</div>';
}
$('#bXlsx').addEventListener('click', function () {
  if (!D.items.length) { toast('ไม่มีรายการให้ส่งออก', true); return; }
  refreshExHeaders();
  var flt = filteredItems();
  var gSet = Object.create(null); flt.forEach(function (x) { gSet[x.g] = 1; });
  $('#exN1').textContent = nf0.format(flt.length) + ' รายการ · ' + Object.keys(gSet).length + ' หมวด';
  $('#exN2').textContent = nf0.format(D.items.length) + ' รายการ · ' + D.allGroups.length + ' หมวด';
  EX_MKT_GRP_MODE = {};
  var fsm = document.querySelector('input[name=exSheetMode][value=split]'); if (fsm) fsm.checked = true;
  renderExMktSheetCustom();
  $('#exErr').textContent = '';
  $('#exDlg').classList.remove('hidden');
});
$('#exYearMode').addEventListener('change', refreshExHeaders);
document.querySelectorAll('input[name=exMode]').forEach(function (r) {
  r.addEventListener('change', function () { $('#exErr').textContent = ''; renderExMktSheetCustom(); });
});
document.querySelectorAll('input[name=exSheetMode]').forEach(function (r) {
  r.addEventListener('change', function () { $('#exErr').textContent = ''; renderExMktSheetCustom(); });
});
if ($('#exSheetCustomList')) {
  $('#exSheetCustomList').addEventListener('change', function (e) {
    var sel = e.target.closest('[data-exgrp]');
    if (sel) { EX_MKT_GRP_MODE[sel.dataset.exgrp] = sel.value; $('#exErr').textContent = ''; }
  });
}
if ($('#exGrpAllSplit')) {
  $('#exGrpAllSplit').addEventListener('click', function () {
    document.querySelectorAll('#exSheetCustomList [data-exgrp]').forEach(function (sel) { sel.value = 'split'; EX_MKT_GRP_MODE[sel.dataset.exgrp] = 'split'; });
    $('#exErr').textContent = '';
  });
}
if ($('#exGrpAllMerge')) {
  $('#exGrpAllMerge').addEventListener('click', function () {
    document.querySelectorAll('#exSheetCustomList [data-exgrp]').forEach(function (sel) { sel.value = 'merge'; EX_MKT_GRP_MODE[sel.dataset.exgrp] = 'merge'; });
    $('#exErr').textContent = '';
  });
}
$('#exCancel').addEventListener('click', function () { $('#exDlg').classList.add('hidden'); });

function buildMarketSheetObj(gKeys, byG, useBe, customLeft, customRight, totalGroupsCount, sheetName) {
  var isSingleGroup = gKeys.length === 1;
  var g = isSingleGroup ? gKeys[0] : (sheetName || 'รวมหมวด');
  var gItems = [];
  var latestRep = '';
  var latestTs = 0;
  var groupDates = Object.create(null), groupNames = Object.create(null);
  gKeys.forEach(function (k) {
    (byG[k] || []).forEach(function (x) { gItems.push(x); });
    var gm = curGroupMeta(k);
    groupDates[k] = gm && (gm.rep || thaiDayIso(gm.ts)) || todayIso();
    groupNames[k] = D.names && D.names[k] || "";
    if (gm && gm.rep && gm.rep > latestRep) latestRep = gm.rep;
    if (gm && gm.ts && gm.ts > latestTs) latestTs = gm.ts;
  });
  var gName = isSingleGroup ? ((D.names && D.names[gKeys[0]]) || '') : ('รวม ' + gKeys.length + ' หมวด');
  var upDate = fmtDateSlash(latestRep || latestTs || Date.now(), useBe);
  var leftH = customLeft || ('อัปข้อมูลเข้า วันที่ ' + upDate);
  var rightH = customRight || ('ส่งออกข้อมูล วันที่ ' + fmtDateSlash(Date.now(), useBe));

  var act = gItems.filter(function (x) { return x.qty > 0; });
  var inactCnt = gItems.length - act.length;
  var upCnt = gItems.filter(function (x) { return x.recAct === 'ปรับขึ้น'; }).length;
  var downCnt = gItems.filter(function (x) { return x.recAct === 'ปรับลง'; }).length;
  var consCnt = gItems.filter(function (x) { return x.recAct === 'ฝากพิจารณา'; }).length;
  var adjTot = upCnt + downCnt + consCnt;
  var projection = summarizePriceProjection(gItems);
  var avgEx = projection.avgBeforeEx, avgInc = projection.avgBeforeInc;
  var gListLabel = gKeys.length <= 5 ? gKeys.join(', ') : (gKeys.slice(0, 5).join(', ') + ' ฯลฯ รวม ' + gKeys.length + ' หมวด');

  return {
    name: g,
    multiGroup: !isSingleGroup,
    groupDates: groupDates,
    groupNames: groupNames,
    versionLabel: D.ver === "prev" ? "ข้อมูลฉบับก่อนหน้า" : "ข้อมูลปัจจุบัน",
    leftHead: leftH,
    rightHead: rightH,
    title: isSingleGroup
      ? ('สำรวจราคาท้องตลาดหมวดสินค้า ' + gKeys[0] + (gName ? ' ' + gName : '') + (D.br ? ' · สาขา ' + D.br : ''))
      : ('สำรวจราคาท้องตลาด รวมหมวดสินค้า (' + gListLabel + ')' + (D.br ? ' · สาขา ' + D.br : '')),
    sumTitle: isSingleGroup ? ('สรุปการสำรวจ หมวด ' + gKeys[0] + (gName ? ' ' + gName : '')) : ('สรุปการสำรวจ รวม ' + gKeys.length + ' หมวด'),
    sumText: buildSummaryText(isSingleGroup ? gKeys[0] : ('รวม ' + gKeys.length + ' หมวด'), isSingleGroup ? gName : '', gItems.length, inactCnt, act.length, adjTot, upCnt, downCnt, consCnt, avgEx, avgInc, projection),
    surveyor: D.surveyor || '',
    checker: D.checker || '',
    approver: D.approver || '',
    items: gItems
  };
}

$('#exGo').addEventListener('click', function () {
  var selMode = document.querySelector('input[name=exMode]:checked'), mode = selMode ? selMode.value : 'filter';
  var list = mode === 'all' ? D.items : filteredItems();
  if (!list.length) { $('#exErr').textContent = 'ไม่มีรายการให้ส่งออก'; return; }
  busy(this, async function () {
    var byG = Object.create(null);
    list.forEach(function (x) { (byG[x.g] || (byG[x.g] = [])).push(x); });
    var useBe = $('#exYearMode').value === 'be';
    var customLeft = $('#exLeftHead').value.trim();
    if (customLeft === EX_MKT_DEFAULT_LEFT) customLeft = '';
    var customRight = $('#exRightHead').value.trim();
    var smEl = document.querySelector('input[name=exSheetMode]:checked'), sheetMode = smEl ? smEl.value : 'split';
    var allGs = Object.keys(byG).sort(), sheets = [];

    if (sheetMode === 'single') {
      if (allGs.length) sheets.push(buildMarketSheetObj(allGs, byG, useBe, customLeft, customRight, allGs.length, allGs.length === 1 ? allGs[0] : 'รวมทุกหมวด'));
    } else if (sheetMode === 'custom') {
      var splitGs = [], mergeGs = [];
      allGs.forEach(function (g) {
        var md = EX_MKT_GRP_MODE[g] || 'split';
        if (md === 'split') splitGs.push(g);
        else if (md === 'merge') mergeGs.push(g);
      });
      splitGs.forEach(function (g) { sheets.push(buildMarketSheetObj([g], byG, useBe, customLeft, customRight, allGs.length, g)); });
      if (mergeGs.length) sheets.push(buildMarketSheetObj(mergeGs, byG, useBe, customLeft, customRight, allGs.length, mergeGs.length === 1 ? mergeGs[0] : 'รวมหมวด'));
    } else {
      sheets = allGs.map(function (g) { return buildMarketSheetObj([g], byG, useBe, customLeft, customRight, allGs.length, g); });
    }
    if (!sheets.length) { $('#exErr').textContent = 'ไม่มีหมวดที่เลือกส่งออก'; return; }

    var u8 = await xlsxBuildMarket(sheets);
    var firstG = sheets[0].name, firstName = (D.names && D.names[firstG]) || '';
    var brPre = D.br ? D.br.replace(/[\\/:*?"<>|]/g, '') + '_' : '';
    var fn = sheets.length === 1
      ? (brPre + firstG + (firstName ? firstName : '_สำรวจราคาตลาด') + '.xlsx')
      : (brPre + 'สำรวจราคาตลาด_' + todayIso() + '.xlsx');
    fn = fn.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_');
    var a = document.createElement('a'), url = URL.createObjectURL(new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    $('#exDlg').classList.add('hidden');
    toast('ดาวน์โหลดไฟล์ ' + fn + ' เรียบร้อยแล้ว');
  });
});

initToken();
load();
