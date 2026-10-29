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
var S = { token: '', me: null, initSp: '' };
(function initToken() {
  var h = location.hash || '';
  var m = h.match(/[#&]t=([^&]+)/), sp = h.match(/[#&]sp=([^&]+)/);
  if (sp) { try { S.initSp = decodeURIComponent(sp[1]); } catch (e) {} }
  if (m) {
    try { S.token = decodeURIComponent(m[1]); sessionStorage.setItem('pm_tok', S.token); } catch (e) {}
  } else {
    try { S.token = sessionStorage.getItem('pm_tok') || ''; } catch (e) {}
  }
  if (m || sp) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  }
  if (S.token) {
    try { var cm = sessionStorage.getItem('pm_me'); if (cm) S.me = JSON.parse(cm); } catch (e) {}
  }
})();

/* ============================ ผู้ใช้งาน (Admin) ============================ */
var ROLE_TH = { admin: 'Admin', viewer: 'ผู้ใช้งาน (ปริ้น/ดูประวัติ)' };
var editingUser = '';
async function loadUsers() {
  $('#userBody').innerHTML = '<tr><td colspan="5" class="muted">กำลังโหลด…</td></tr>';
  try {
    var rows = await call('listUsers');
    $('#userBody').innerHTML = rows.map(function (u) {
      return '<tr><td>' + esc(u.username) + '</td><td>' + esc(u.name) + '</td><td>' + esc(ROLE_TH[u.role] || u.role) + (u.link ? ' (มีลิงก์เข้าใช้)' : '') + '</td><td>' + esc(permText(u)) + '</td><td class="act"><div class="actw">' +
        '<button class="btn ghost small" data-a="link" data-u="' + esc(u.username) + '">' + (u.link ? 'ลิงก์ใหม่' : 'สร้างลิงก์') + '</button> ' +
        '<button class="btn ghost small" data-a="edit" data-u="' + esc(u.username) + '" data-n="' + esc(u.name) + '" data-r="' + esc(u.role) + '" data-p="' + esc(JSON.stringify(u.perms || {})) + '">แก้ไข</button> ' +
        (S.me && u.username === S.me.user ? '' : '<button class="btn ghost small" data-a="del" data-u="' + esc(u.username) + '">ลบ</button>') +
        '</div></td></tr>';
    }).join('');
  } catch (e) { toast(e.message, true); }
}
function resetUserForm() {
  editingUser = '';
  ['#uName', '#uDisp', '#uPass'].forEach(function (s) { $(s).value = ''; });
  $('#uRole').value = 'viewer'; setPermBox(PERM_DEFAULT); syncPerms();
  $('#uLink').checked = true; $('#uPass').disabled = true; $('#uLinkRow').classList.remove('hidden');
  $('#uFormTitle').textContent = 'เพิ่มผู้ใช้'; $('#uSave').textContent = 'เพิ่มผู้ใช้';
  $('#uCancel').classList.add('hidden'); $('#uHint').textContent = '';
}
function showLink(url, name) {
  var m = String(url || '').match(/[?&](u=[^&#]+&k=[^&#]+)/);
  if (m) url = pageUrl('?' + m[1], url);
  $('#lkTitle').textContent = 'ลิงก์เข้าใช้งานของ ' + name;
  $('#lkUrl').value = url;
  $('#linkModal').classList.remove('hidden');
}
/* ----- รหัสกู้คืน Admin ----- */
async function loadRecovery() {
  try {
    var r = await call('recoveryInfo');
    $('#recInfo').textContent = r.custom ? 'ใช้รหัสกู้คืนที่ออกใหม่เมื่อ ' + fmt(r.ts) + (r.by ? ' โดย ' + r.by : '') : 'ยังใช้รหัสกู้คืนเดิมที่ตั้งไว้ในโค้ด';
  } catch (e) { $('#recInfo').textContent = ''; }
}
$('#recIssue').addEventListener('click', function () {
  if (!confirm('ออกรหัสกู้คืนใหม่?\n\nรหัสกู้คืนเดิมจะใช้ไม่ได้ทันที')) return;
  busy(this, async function () {
    var r = await call('issueRecoveryCode');
    $('#recCode').value = r.code; $('#recModal').classList.remove('hidden');
    loadRecovery();
  });
});
$('#recCopy').addEventListener('click', function () { copyField('#recCode', 'คัดลอกรหัสแล้ว'); });
$('#recClose').addEventListener('click', function () { $('#recModal').classList.add('hidden'); $('#recCode').value = ''; });
$('#lkCopy').addEventListener('click', function () { copyField('#lkUrl', 'คัดลอกลิงก์แล้ว'); });
$('#lkClose').addEventListener('click', function () { $('#linkModal').classList.add('hidden'); $('#lkUrl').value = ''; });
$('#uLink').addEventListener('change', function () {
  $('#uPass').disabled = this.checked; if (this.checked) $('#uPass').value = '';
});
$('#userBody').addEventListener('click', async function (e) {
  var b = e.target.closest('button'); if (!b) return;
  if (b.dataset.a === 'edit') {
    editingUser = b.dataset.u;
    $('#uName').value = b.dataset.u; $('#uDisp').value = b.dataset.n; $('#uPass').value = ''; $('#uPass').disabled = false;
    $('#uRole').value = b.dataset.r; setPermBox(JSON.parse(b.dataset.p || '{}')); syncPerms();
    $('#uLink').checked = false; $('#uLinkRow').classList.add('hidden');
    $('#uFormTitle').textContent = 'แก้ไขผู้ใช้: ' + b.dataset.u; $('#uSave').textContent = 'บันทึกการแก้ไข';
    $('#uCancel').classList.remove('hidden'); $('#uHint').textContent = 'เว้นรหัสผ่านว่างไว้ถ้าไม่ต้องการเปลี่ยน';
    $('#uName').focus();
  } else if (b.dataset.a === 'link') {
    if (!confirm('ออกลิงก์ใหม่ให้ ' + b.dataset.u + ' ?\nลิงก์เดิมจะใช้ไม่ได้ทันที')) return;
    try { var lr = await call('regenUserLink', b.dataset.u); loadUsers(); showLink(lr.link, b.dataset.u); }
    catch (err) { toast(err.message, true); }
  } else if (b.dataset.a === 'del') {
    if (!confirm('ลบผู้ใช้ ' + b.dataset.u + ' ?')) return;
    try { await call('deleteUser', b.dataset.u); toast('ลบผู้ใช้แล้ว'); loadUsers(); }
    catch (err) { toast(err.message, true); }
  }
});
/* สิทธิ์การ์ดรายคน (ติ๊กเลือก) : การ์ดมาตรฐาน + การ์ดลิงก์ที่ Admin สร้างเอง */
var PERM_LABELS = {
  barcode: 'รายการบาร์เดี่ยว/บาร์แพ็ค',
  sound: 'ระบบเสียงประกาศ',
  music: 'ขอเพลง / คิวเพลง',
  stock: 'สินค้าค้างสต็อก (ดู)',
  stock_edit: 'สินค้าค้างสต็อก: แก้ไขได้ (ไม่ติ๊ก = ดูอย่างเดียว)',
  market: 'เช็คราคาตลาด (ดู)',
  market_edit: 'เช็คราคาตลาด: แก้ไขได้ (ไม่ติ๊ก = ดูอย่างเดียว)',
  expiry: 'แจ้งเตือนสินค้าหมดอายุ (ดู)',
  expiry_edit: 'แจ้งเตือนสินค้าหมดอายุ: เพิ่ม/แก้ไข/รับทราบ/ปิดล็อต',
  assets: 'รายการสินทรัพย์ (ดู)',
  assets_edit: 'รายการสินทรัพย์: เพิ่ม/แก้ไข/ลบ และแก้ชื่อตาราง'
};
var PERM_KEYS = Object.keys(PERM_LABELS);
var PERM_DEFAULT = { barcode: true, sound: true, music: true, stock: false, stock_edit: false, market: false, market_edit: false, expiry: false, expiry_edit: false, assets: false, assets_edit: false };
function permKeys() { return PERM_KEYS.concat(CUSTOM.map(function (c) { return c.k; })); }
function permLabel(k) { var c = customOf(k); return c ? c.t : PERM_LABELS[k]; }
function permDef(k) { return PERM_DEFAULT[k] === undefined ? true : !!PERM_DEFAULT[k]; }
function renderPermBox() {
  $('#uPermBox').innerHTML = permKeys().map(function (k) {
    return '<label><input type="checkbox" data-pk="' + esc(k) + '"> ' + esc(permLabel(k)) + '</label>';
  }).join('');
}
function setPermBox(p) {
  document.querySelectorAll('#uPermBox input').forEach(function (i) { i.checked = p[i.dataset.pk] === undefined ? permDef(i.dataset.pk) : !!p[i.dataset.pk]; });
}
function getPermBox() {
  var p = {}; document.querySelectorAll('#uPermBox input').forEach(function (i) { p[i.dataset.pk] = i.checked; }); return p;
}
function syncPerms() {                                      // Admin ใช้ได้ทุกการ์ดเสมอ
  var a = $('#uRole').value === 'admin';
  document.querySelectorAll('#uPermBox input').forEach(function (i) { if (a) i.checked = true; i.disabled = a; });
  syncStockEdit();
}
function syncStockEdit() {                                  // แก้ไขสินค้าค้างสต็อก/เช็คราคาตลาดได้ ต้องมีสิทธิ์ดูก่อน
  if ($('#uRole').value === 'admin') return;
  [['stock', 'stock_edit'], ['market', 'market_edit'], ['expiry', 'expiry_edit'], ['assets', 'assets_edit']].forEach(function (pair) {
    var s = document.querySelector('#uPermBox input[data-pk="' + pair[0] + '"]'),
        e = document.querySelector('#uPermBox input[data-pk="' + pair[1] + '"]');
    if (!s || !e) return;
    if (!s.checked) e.checked = false;
    e.disabled = !s.checked;
  });
}
$('#uPermBox').addEventListener('change', syncStockEdit);
function permText(u) {
  if (u.role === 'admin') return 'ทุกการ์ด';
  var on = function (k) { return u.perms && u.perms[k] !== undefined ? !!u.perms[k] : permDef(k); };
  var t = permKeys().filter(function (k) { return k !== 'stock_edit' && k !== 'market_edit' && k !== 'expiry_edit' && k !== 'assets_edit' && on(k); }).map(function (k) {
    if (k === 'stock') return 'สินค้าค้างสต็อก (' + (on('stock_edit') ? 'แก้ไขได้' : 'ดูอย่างเดียว') + ')';
    if (k === 'market') return 'เช็คราคาตลาด (' + (on('market_edit') ? 'แก้ไขได้' : 'ดูอย่างเดียว') + ')';
    if (k === 'expiry') return 'แจ้งเตือนสินค้าหมดอายุ (' + (on('expiry_edit') ? 'แก้ไขได้' : 'ดูอย่างเดียว') + ')';
    if (k === 'assets') return 'รายการสินทรัพย์ (' + (on('assets_edit') ? 'แก้ไขได้' : 'ดูอย่างเดียว') + ')';
    return permLabel(k);
  });
  return t.length ? t.join(' · ') : 'ไม่มี';
}
$('#uRole').addEventListener('change', syncPerms);
$('#uCancel').addEventListener('click', resetUserForm);
$('#uSave').addEventListener('click', function () {
  var p = { original: editingUser, username: $('#uName').value.trim(), name: $('#uDisp').value.trim(),
            password: $('#uPass').value, role: $('#uRole').value, perms: getPermBox(),
            linkMode: !editingUser && $('#uLink').checked };
  busy(this, async function () {
    var r = await call('saveUser', p);
    if (r.relogin) { showLogin('เปลี่ยนรหัสผู้ใช้ของคุณแล้ว กรุณาเข้าสู่ระบบใหม่'); }
    else {
      toast('บันทึกผู้ใช้แล้ว');
      var nm = p.username;
      resetUserForm(); loadUsers();
      if (r.link) showLink(r.link, nm);
    }
  });
});


/* ============================ เข้าสู่ระบบ / ออกจากระบบ ============================ */
function setNav(n) { document.body.dataset.nav = 'settings'; }
function showLogin(msg) {
  tvResetSession();
  S.token = ''; S.me = null;
  try { sessionStorage.removeItem('pm_tok'); sessionStorage.removeItem('pm_me'); } catch (e) {}
  document.body.classList.add('locked');
  document.querySelectorAll('.modalwrap,.overlay').forEach(function (dialog) { dialog.classList.add('hidden'); });
  if ($('#login')) $('#login').classList.remove('hidden');
  $('#lgErr').textContent = msg || ''; $('#lgPass').value = '';
  setTimeout(function () { $('#lgUser').focus(); }, 50);
}
function hasPerm(k) { if (!S.me) return false; if (S.me.role === 'admin') return true; if (!S.me.perms) return false; return !!S.me.perms[k]; }
function goPortal() { location.href = pageUrl('index.html', 'https://cmucoop-support.github.io/CMUCOOP-SP/index.html'); }
async function startApp(me) {
  S.me = me;
  if (me.role !== 'admin') {                           // หน้านี้สำหรับ Admin เท่านั้น
    showLogin('บัญชีนี้ไม่ใช่ Admin เข้าหน้าตั้งค่าไม่ได้ — กลับไปที่เมนูหลักหรือเข้าสู่ระบบด้วยบัญชี Admin');
    return;
  }
  document.body.classList.remove('locked');
  if ($('#login')) $('#login').classList.add('hidden');
  try { if (me && me.role) sessionStorage.setItem('pm_me', JSON.stringify(me)); } catch (e) {}
  await loadCardOrder();
  var sp = S.initSp; S.initSp = '';
  openSettings(ST_PANELS.indexOf(sp) >= 0 ? sp : 'cards');
}

/* ----- ลำดับการ์ดเมนูหลัก (Admin จัดได้) ----- */
var CARD_DEF = [
  { k: 'barcode', id: 'mBarcode', t: 'รายการบาร์เดี่ยว/บาร์แพ็ค' }, { k: 'sound', id: 'mSound', t: 'ระบบเสียงประกาศ' },
  { k: 'music', id: 'mMusic', t: 'ขอเพลง / คิวเพลง' }, { k: 'stock', id: 'mStock', t: 'สินค้าค้างสต็อก' }, { k: 'market', id: 'mMarket', t: 'เช็คราคาตลาด' },
  { k: 'expiry', id: 'mExpiry', t: 'แจ้งเตือนสินค้าหมดอายุ' },
  { k: 'assets', id: 'mAssets', t: 'รายการสินทรัพย์' },
  { k: 'settings', id: 'mSettings', t: 'ตั้งค่า' }
];
var CARD_ORDER = CARD_DEF.map(function (c) { return c.k; }), CARD_WORK = [];
var CARD_TITLES = {}, CARD_WORK_T = {};      // ชื่อที่ Admin แก้เอง (เฉพาะที่เปลี่ยน) / ค่าที่กำลังแก้ในหน้าตั้งค่า
var CUSTOM = [], CUSTOM_WORK = {};                                               // การ์ดลิงก์ที่ Admin สร้างเอง [{k,t,u}] / ค่าที่กำลังแก้
var CARD_HIDDEN = [], CARD_WORK_HIDDEN = {}, CARD_VISIBILITY_READY = false;
var CARD_NEW_TABS = [], CARD_WORK_NEW_TABS = {}, CARD_TAB_READY = false;
function isCustom(k) { return /^c_[0-9a-f]{8}$/.test(k); }
function customOf(k) { return CUSTOM.filter(function (c) { return c.k === k; })[0]; }
function cardDef(k) { return CARD_DEF.filter(function (c) { return c.k === k; })[0]; }
function cardEl(k) { var d = cardDef(k); return d ? document.getElementById(d.id) : document.querySelector('#portal .mcard[data-ck="' + k + '"]'); }
function cardTitle(k) { var c = customOf(k); return c ? c.t : (CARD_TITLES[k] || cardDef(k).t); }
function refreshCards() {}                                              // หน้าตั้งค่าไม่มีเมนูหลัก ไม่ต้องวาดการ์ดใหม่
function loadCardOrder() {
  CARD_VISIBILITY_READY = false;
  CARD_TAB_READY = false;
  function ok(fn, def) { return call(fn).catch(function () { return def; }); }
  var visibility = call('getHiddenCards').then(function (list) {
    if (!Array.isArray(list)) throw new Error('ค่าการแสดงการ์ดไม่ถูกต้อง');
    return { list: list, ready: true };
  }).catch(function (e) { return { list: [], ready: false, error: e.message }; });
  var tabs = call('getCardNewTabs').then(function (list) {
    if (!Array.isArray(list)) throw new Error('ค่าการเปิดแท็บไม่ถูกต้อง');
    return { list: list, ready: true };
  }).catch(function (e) { return { list: [], ready: false, error: e.message }; });
  return Promise.all([ok('getCardOrder', CARD_ORDER), ok('getCardTitles', {}), ok('getCustomCards', []), visibility, tabs]).then(function (r) {
    CARD_ORDER = Array.isArray(r[0]) ? r[0].slice() : CARD_DEF.map(function (c) { return c.k; }); CARD_DEF.forEach(function (c) { if (CARD_ORDER.indexOf(c.k) < 0) { var si = CARD_ORDER.indexOf('settings'); if (si >= 0) CARD_ORDER.splice(si, 0, c.k); else CARD_ORDER.push(c.k); } }); CARD_TITLES = r[1] || {}; CUSTOM = r[2] || [];
    CARD_VISIBILITY_READY = r[3].ready; CARD_HIDDEN = r[3].list;
    var notice = $('#cardVisibilityNotice');
    notice.hidden = CARD_VISIBILITY_READY;
    notice.textContent = CARD_VISIBILITY_READY ? '' : 'ยังโหลดค่าซ่อนการ์ดไม่ได้ กรุณารีเฟรชหน้าเว็บ หากเพิ่งอัปเดตไฟล์เว็บ ให้ deploy Cloudflare Worker รุ่นใหม่ก่อน: ' + r[3].error;
    CARD_TAB_READY = r[4].ready; CARD_NEW_TABS = r[4].list;
    var tabNotice = $('#cardTabNotice');
    tabNotice.hidden = CARD_TAB_READY;
    tabNotice.textContent = CARD_TAB_READY ? '' : 'ยังโหลดค่าการเปิดแท็บไม่ได้ กรุณา deploy Cloudflare Worker รุ่นใหม่แล้วรีเฟรช: ' + r[4].error;
    refreshCards();
  });
}
/* ----- ตั้งค่า > การ์ดเมนูหลัก : จัดลำดับ + แก้ชื่อ/ลิงก์ + สร้าง/ลบการ์ดลิงก์ ----- */
function stCardsLoad() {
  CARD_WORK = CARD_ORDER.slice(); CARD_WORK_T = {}; CUSTOM_WORK = {}; CARD_WORK_HIDDEN = {}; CARD_WORK_NEW_TABS = {};
  CARD_HIDDEN.forEach(function (k) { if (k !== 'settings') CARD_WORK_HIDDEN[k] = true; });
  CARD_NEW_TABS.forEach(function (k) { CARD_WORK_NEW_TABS[k] = true; });
  CUSTOM.forEach(function (c) { CUSTOM_WORK[c.k] = { t: c.t, u: c.u }; });
  renderSortList();
}
function renderSortList() {
  var last = CARD_WORK.length - 1;
  $('#sortList').innerHTML = CARD_WORK.map(function (k, i) {
    var cu = isCustom(k), d = cu ? null : cardDef(k), title, link, ph, del = '';
    if (cu) {
      var w = CUSTOM_WORK[k]; if (!w) return '';
      title = '<input type="text" data-ck="' + esc(k) + '" value="' + esc(w.t) + '" maxlength="40" placeholder="ชื่อการ์ด" style="flex:1;min-width:0">';
      link = '<div class="muted" style="margin-top:6px">ลิงก์</div><input type="text" data-cu="' + esc(k) + '" value="' + esc(w.u) + '" maxlength="500" placeholder="https://..." autocomplete="off" style="width:100%;font-size:13px">';
      del = ' <button class="btn danger small" data-del="' + esc(k) + '">ลบ</button>';
    } else {
      if (!d) return '';
      var cur = CARD_WORK_T[k] !== undefined ? CARD_WORK_T[k] : cardTitle(k);
      title = '<input type="text" data-k="' + esc(k) + '" value="' + esc(cur) + '" maxlength="40" placeholder="' + esc(d.t) + '" style="flex:1;min-width:0">';
      link = '';
    }
    var hidden = k !== 'settings' && !!CARD_WORK_HIDDEN[k];
    var visibility = '<label class="card-visibility"><input type="checkbox" data-card-hidden="' + esc(k) + '" aria-label="ซ่อนการ์ด ' + esc(cu ? w.t : cur) + '"' + (hidden ? ' checked' : '') + (k === 'settings' || !CARD_VISIBILITY_READY ? ' disabled' : '') + '> <span>' + (k === 'settings' ? 'การ์ดตั้งค่าแสดงเสมอ' : 'ซ่อนการ์ดนี้') + '</span></label>';
    var tabMode = '<label class="card-open-mode"><span>เมื่อกดการ์ด</span><select data-card-target="' + esc(k) + '" aria-label="การเปิดแท็บของ ' + esc(cu ? w.t : cur) + '"' + (CARD_TAB_READY ? '' : ' disabled') + '><option value="_self"' + (!CARD_WORK_NEW_TABS[k] ? ' selected' : '') + '>เปิดแท็บเดิม</option><option value="_blank"' + (CARD_WORK_NEW_TABS[k] ? ' selected' : '') + '>เปิดแท็บใหม่</option></select></label>';
    return '<div class="pitem' + (hidden ? ' is-card-hidden' : '') + '" style="display:block"><div style="display:flex;align-items:center;justify-content:space-between;gap:6px">' +
      '<span style="display:flex;gap:6px;align-items:center;flex:1;min-width:0"><b>' + (i + 1) + '.</b> ' + title + '</span><span style="white-space:nowrap">' +
      '<button class="btn ghost small" data-m="-1" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>▲</button> ' +
      '<button class="btn ghost small" data-m="1" data-i="' + i + '"' + (i === last ? ' disabled' : '') + '>▼</button>' + del + '</span></div>' + visibility + link + tabMode + '</div>';
  }).join('');
}
$('#sortList').addEventListener('input', function (e) {
  var inp = e.target.closest('input'); if (!inp) return;
  if (inp.dataset.k) CARD_WORK_T[inp.dataset.k] = inp.value;
  else if (inp.dataset.ck && CUSTOM_WORK[inp.dataset.ck]) CUSTOM_WORK[inp.dataset.ck].t = inp.value;
  else if (inp.dataset.cu && CUSTOM_WORK[inp.dataset.cu]) CUSTOM_WORK[inp.dataset.cu].u = inp.value;
});
$('#sortList').addEventListener('change', function (e) {
  var select = e.target.closest('select[data-card-target]');
  if (select) {
    if (!select.disabled && CARD_TAB_READY) CARD_WORK_NEW_TABS[select.dataset.cardTarget] = select.value === '_blank';
    return;
  }
  var input = e.target.closest('input[data-card-hidden]');
  if (!input || input.disabled || !CARD_VISIBILITY_READY || input.dataset.cardHidden === 'settings') return;
  CARD_WORK_HIDDEN[input.dataset.cardHidden] = input.checked;
  input.closest('.pitem').classList.toggle('is-card-hidden', input.checked);
});
$('#sortList').addEventListener('click', function (e) {
  var del = e.target.closest('button[data-del]');
  if (del) {
    var w = CUSTOM_WORK[del.dataset.del];
    if (!confirm('ลบการ์ด "' + (w ? w.t : '') + '" ?\n\n(มีผลเมื่อกด "บันทึก")')) return;
    CARD_WORK = CARD_WORK.filter(function (k) { return k !== del.dataset.del; }); delete CUSTOM_WORK[del.dataset.del]; delete CARD_WORK_HIDDEN[del.dataset.del]; delete CARD_WORK_NEW_TABS[del.dataset.del]; renderSortList(); return;
  }
  var b = e.target.closest('button[data-m]'); if (!b || b.disabled) return;
  var i = Number(b.dataset.i), j = i + Number(b.dataset.m), t = CARD_WORK[i];
  CARD_WORK[i] = CARD_WORK[j]; CARD_WORK[j] = t; renderSortList();
});
$('#sortReset').addEventListener('click', function () {
  CARD_WORK = CARD_DEF.map(function (c) { return c.k; }).concat(CARD_WORK.filter(isCustom));
  CARD_WORK_T = {};
  if (CARD_VISIBILITY_READY) CARD_WORK_HIDDEN = {};
  if (CARD_TAB_READY) CARD_WORK_NEW_TABS = {};
  CARD_DEF.forEach(function (c) { CARD_WORK_T[c.k] = c.t; });      // คืนชื่อเริ่มต้น
  renderSortList();
});
$('#sortSave').addEventListener('click', function () {
  var titles = {}, bad = '', cl = [];                     // ส่งเฉพาะที่ต่างจากค่าเริ่มต้น
  CARD_WORK.forEach(function (k) {
    if (isCustom(k)) {
      var w = CUSTOM_WORK[k]; if (!w) return;
      var t = String(w.t).replace(/\s+/g, ' ').trim(), u = String(w.u).trim();
      if (!t) bad = bad || 'การ์ดลิงก์ที่ยังไม่ได้ตั้งชื่อ';
      else if (!/^https?:\/\/\S+$/i.test(u)) bad = bad || t;
      cl.push({ k: k, t: t, u: u });
      return;
    }
    var d = cardDef(k); if (!d) return;
    var tt = (CARD_WORK_T[k] !== undefined ? CARD_WORK_T[k] : cardTitle(k)).replace(/\s+/g, ' ').trim();
    if (tt && tt !== d.t) titles[k] = tt;
  });
  if (bad) { toast('ข้อมูลของการ์ด "' + bad + '" ไม่ถูกต้อง (ต้องมีชื่อ และลิงก์ขึ้นต้นด้วย http:// หรือ https:// ไม่มีช่องว่าง)', true); return; }
  busy(this, async function () {
    if (JSON.stringify(CUSTOM) !== JSON.stringify(cl)) CUSTOM = await call('setCustomCards', cl);
    if (JSON.stringify(CARD_ORDER) !== JSON.stringify(CARD_WORK)) CARD_ORDER = await call('setCardOrder', CARD_WORK);
    if (JSON.stringify(CARD_TITLES) !== JSON.stringify(titles)) CARD_TITLES = await call('setCardTitles', titles);
    if (CARD_VISIBILITY_READY) {
      var hidden = CARD_WORK.filter(function (k) { return k !== 'settings' && CARD_WORK_HIDDEN[k]; });
      if (JSON.stringify(CARD_HIDDEN.slice().sort()) !== JSON.stringify(hidden.slice().sort())) CARD_HIDDEN = await call('setHiddenCards', hidden);
    }
    if (CARD_TAB_READY) {
      var newTabs = CARD_WORK.filter(function (k) { return CARD_WORK_NEW_TABS[k]; });
      if (JSON.stringify(CARD_NEW_TABS.slice().sort()) !== JSON.stringify(newTabs.slice().sort())) CARD_NEW_TABS = await call('setCardNewTabs', newTabs);
    }
    refreshCards(); stCardsLoad(); toast('บันทึกการตั้งค่าการ์ดแล้ว');
  });
});
$('#ncAdd').addEventListener('click', function () {
  var t = $('#ncTitle').value.replace(/\s+/g, ' ').trim(), u = $('#ncLink').value.trim();
  if (!t) { toast('กรุณากรอกชื่อการ์ด', true); return; }
  if (!/^https?:\/\/\S+$/i.test(u)) { toast('ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https:// และไม่มีช่องว่าง', true); return; }
  busy(this, async function () {
    CUSTOM = await call('setCustomCards', CUSTOM.map(function (c) { return { k: c.k, t: c.t, u: c.u }; }).concat([{ t: t, u: u }]));
    CARD_ORDER = await call('getCardOrder');
    $('#ncTitle').value = ''; $('#ncLink').value = '';
    refreshCards(); stCardsLoad(); toast('สร้างการ์ดแล้ว: ' + t);
  });
});
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
function closePw() { $('#pwModal').classList.add('hidden'); ['#pwOld', '#pwNew', '#pwNew2'].forEach(function (x) { $(x).value = ''; }); $('#pwErr').textContent = ''; }
document.querySelectorAll('#btnPw,.js-pw').forEach(function (b) {
  b.addEventListener('click', function () { $('#pwModal').classList.remove('hidden'); $('#pwOld').focus(); });
});
$('#pwCancel').addEventListener('click', closePw);
async function savePw() {
  var o = $('#pwOld').value, n = $('#pwNew').value;
  if (!o) { $('#pwErr').textContent = 'กรุณากรอกรหัสผ่านเดิม'; return; }
  if (n.length < 4) { $('#pwErr').textContent = 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร'; return; }
  if (n !== $('#pwNew2').value) { $('#pwErr').textContent = 'ยืนยันรหัสผ่านไม่ตรงกัน'; return; }
  $('#pwSave').disabled = true; $('#pwErr').textContent = '';
  try { await call('changePassword', o, n); closePw(); toast('เปลี่ยนรหัสผ่านแล้ว'); }
  catch (e) { $('#pwErr').textContent = e.message; }
  $('#pwSave').disabled = false;
}
$('#pwSave').addEventListener('click', savePw);
$('#pwModal').addEventListener('keydown', function (e) { if (e.key === 'Enter') savePw(); });
document.querySelectorAll('#btnLogout,.js-logout').forEach(function (b) {
  b.addEventListener('click', async function () {
    try { await call('logout'); } catch (e) {}
    showLogin('');
  });
});


/* ----- ตั้งค่า (Admin) : การ์ดเมนูหลัก / Banner / ผู้ใช้งาน / เสียงประกาศ ----- */
var ST_PANELS = ['cards', 'users', 'sound', 'tv', 'history'];
function openSettings(p) {
  if (!S.me || S.me.role !== 'admin') return;
  setNav('settings');
  $('#stMe').textContent = S.me.name + ' (Admin)';
  stPanel(p || 'cards');
}
function stPanel(p) {
  if (p === 'banner') { p = 'tv'; TVC.pendingTab = 'ads'; }
  $('.pwrap').classList.toggle('tv-editor-open', p === 'tv');
  document.querySelectorAll('#stNav button').forEach(function (b) { b.classList.toggle('on', b.dataset.sp === p); });
  ST_PANELS.forEach(function (k) { $('#st-' + k).classList.toggle('hidden', k !== p); });
  if (p === 'cards') stCardsLoad();
  else if (p === 'users') { renderPermBox(); resetUserForm(); loadUsers(); loadRecovery(); }
  else if (p === 'sound') sndLoadAdmin();
  else if (p === 'tv') tvLoad();
  else if (p === 'history') openHistory();
}
$('#stNav').addEventListener('click', function (e) { var b = e.target.closest('button[data-sp]'); if (b) stPanel(b.dataset.sp); });

var B = { list: [], busy: false, loaded: false, loadId: 0 };
var BANNER_HINT = 'รองรับ JPG, PNG, WEBP, GIF · ระบบย่อรูปให้ด้านยาวไม่เกิน 1600 px ก่อนอัปโหลด (GIF ไม่ย่อ) · เลือกได้หลายไฟล์พร้อมกัน';

async function loadBanners() {
  var id = ++B.loadId, token = S.token;
  $('#bUpHint').textContent = BANNER_HINT;
  try {
    var r = await call('listBanners');
    if (token !== S.token || id !== B.loadId || !S.me) return;
    B.loaded = true;
    B.list = r.banners || [];
    r.displayUrl = pageUrl('banner.html', r.displayUrl);
    $('#bUrl').value = r.displayUrl;
    $('#bOpen').href = r.displayUrl;
    $('#bEmbed').value = '<iframe src="' + r.displayUrl + '" style="width:100%;height:640px;border:0" loading="lazy"></iframe>';
    renderBanners();
    tvRefreshBanners();
  } catch (e) { if (token !== S.token || id !== B.loadId) return; $('#bGrid').innerHTML = '<div class="err">' + esc(e.message) + '</div>'; }
}
function renderBanners() {
  var shown = B.list.filter(function (b) { return b.show; }).length;
  $('#bCount').textContent = B.list.length ? B.list.length + ' รูป (แสดงอยู่ ' + shown + ')' : '';
  if (!B.list.length) { $('#bGrid').innerHTML = '<div class="muted">ยังไม่มี Banner กดเลือกไฟล์รูปด้านบนแล้วกด "อัปโหลด"</div>'; return; }
  $('#bGrid').innerHTML = B.list.map(function (b, i) {
    var last = i === B.list.length - 1;
    return '<div class="bitem' + (b.show ? '' : ' off') + '" data-id="' + esc(b.id) + '">' +
      '<div class="bthumb"><img loading="lazy" src="' + esc(b.url) + '" alt="' + esc(b.title) + '"></div>' +
      '<div class="bmeta"><b>' + (i + 1) + '. ' + esc(b.title || '(ไม่มีชื่อ)') + '</b> ' + (b.show ? '' : '<span class="tag">ซ่อนอยู่</span>') +
      (b.link ? '<div class="muted bl" title="' + esc(b.link) + '">ลิงก์: ' + esc(b.link) + '</div>' : '') + '</div>' +
      '<div class="bact">' +
        '<button class="btn ghost small" data-a="left" title="เลื่อนไปก่อน (ซ้าย)"' + (i === 0 ? ' disabled' : '') + '>เลื่อนก่อน</button>' +
        '<button class="btn ghost small" data-a="right" title="เลื่อนไปหลัง (ขวา)"' + (last ? ' disabled' : '') + '>เลื่อนหลัง</button>' +
        '<button class="btn ghost small" data-a="toggle">' + (b.show ? 'ซ่อน' : 'แสดง') + '</button>' +
        '<button class="btn ghost small" data-a="edit">แก้ไข</button>' +
        '<button class="btn danger small" data-a="del">ลบ</button>' +
      '</div></div>';
  }).join('');
}
function bannerById(id) { return B.list.filter(function (b) { return b.id === id; })[0]; }
async function bannerDo(promise, okMsg) {
  try { await promise; if (okMsg) toast(okMsg); } catch (e) { toast(e.message, true); }
  await loadBanners();
}
$('#bGrid').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-a]'); if (!btn || btn.disabled) return;
  var id = btn.closest('.bitem').dataset.id, b = bannerById(id), a = btn.dataset.a;
  if (!b) return;
  if (a === 'left') bannerDo(call('moveBanner', id, -1));
  else if (a === 'right') bannerDo(call('moveBanner', id, 1));
  else if (a === 'toggle') bannerDo(call('updateBanner', id, { show: !b.show }), b.show ? 'ซ่อนแล้ว' : 'แสดงแล้ว');
  else if (a === 'edit') {
    var t = prompt('ชื่อ Banner', b.title); if (t === null) return;
    var l = prompt('ลิงก์เมื่อกดที่รูป (เว้นว่าง = ไม่มีลิงก์)', b.link); if (l === null) return;
    bannerDo(call('updateBanner', id, { title: t.trim(), link: l.trim() }), 'บันทึกแล้ว');
  } else if (a === 'del') {
    if (!confirm('ลบ Banner นี้?\n\n' + (b.title || id) + '\n\n(ไฟล์รูปจะถูกลบถาวร)')) return;
    bannerDo(call('deleteBanner', id), 'ลบแล้ว');
  }
});
/* รูปที่โหลดจาก Drive ไม่ขึ้น (โดเมนปิดการแชร์สาธารณะ) → ขอผ่านสคริปต์แทน */
$('#bGrid').addEventListener('error', function (e) {
  var im = e.target; if (!im || im.tagName !== 'IMG' || im.dataset.fb) return;
  im.dataset.fb = '1';
  call('adminBannerImage', im.closest('.bitem').dataset.id).then(function (d) { im.src = d; }).catch(function () {});
}, true);

$('#bFiles').addEventListener('change', function () {
  var n = this.files.length;
  $('#bUpload').disabled = !n || B.busy;
  $('#bUpHint').textContent = n ? 'เลือกแล้ว ' + n + ' ไฟล์ — กด "อัปโหลด" เพื่อเพิ่มเข้า Banner' : BANNER_HINT;
});
function prepImage(file) {
  return new Promise(function (res, rej) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return rej(new Error('ชนิดไฟล์ไม่รองรับ'));
    var fr = new FileReader();
    fr.onerror = function () { rej(new Error('อ่านไฟล์ไม่ได้')); };
    fr.onload = function () {
      var url = fr.result;
      if (file.type === 'image/gif') {
        if (file.size > 6 * 1024 * 1024) return rej(new Error('GIF ใหญ่เกิน 6 MB'));
        return res({ mime: file.type, data: url.split(',')[1] });
      }
      var im = new Image();
      im.onerror = function () { rej(new Error('เปิดรูปไม่ได้')); };
      im.onload = function () {
        var k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);   // PNG โปร่งใส → พื้นขาว
        g.drawImage(im, 0, 0, c.width, c.height);
        res({ mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.9).split(',')[1] });
      };
      im.src = url;
    };
    fr.readAsDataURL(file);
  });
}
$('#bUpload').addEventListener('click', async function () {
  var files = Array.prototype.slice.call($('#bFiles').files), link = $('#bLink').value.trim();
  if (!files.length || B.busy) return;
  if (link && !/^https?:\/\/\S+$/i.test(link)) { toast('ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://', true); return; }
  B.busy = true; this.disabled = true;
  var ok = 0, fail = [];
  for (var i = 0; i < files.length; i++) {
    if (!S.token) break;                                   // หมดเวลาการใช้งานระหว่างอัปโหลด
    $('#bUpHint').textContent = 'กำลังอัปโหลด ' + (i + 1) + '/' + files.length + ' : ' + files[i].name;
    try {
      var img = await prepImage(files[i]);
      await call('addBanner', { name: files[i].name, mime: img.mime, data: img.data, link: link });
      ok++;
    } catch (e) { fail.push(files[i].name + ' (' + e.message + ')'); }
  }
  B.busy = false;
  $('#bFiles').value = ''; $('#bUpload').disabled = true; $('#bUpHint').textContent = BANNER_HINT;
  if (ok) { $('#bLink').value = ''; }
  if (fail.length) toast('อัปโหลดสำเร็จ ' + ok + ' ไม่สำเร็จ ' + fail.length + ': ' + fail.join(', '), true);
  else if (ok) toast('เพิ่ม Banner แล้ว ' + ok + ' รูป');
  if (S.token) loadBanners();
});
$('#bCopyUrl').addEventListener('click', function () { copyField('#bUrl', 'คัดลอกลิงก์แล้ว'); });
$('#bCopyEmbed').addEventListener('click', function () { copyField('#bEmbed', 'คัดลอกโค้ดแล้ว'); });


/* ============================ ตั้งค่าเสียงประกาศ (Admin) ============================ */
var SND = { client: null, all: [], edit: null, editSch: null };
var MU = { avol: 100, avDrag: false, MQ: 'cmucoop/audio/control/music_v1' };
var SND_TYPES = ['ปุ่ม', 'เสียงตามเวลา', 'ระบบ', 'พนักงาน', 'สถานที่', 'แคชเชียร์', 'ประเภทงดรับ', 'เวลา', 'ตั้งค่า'];
var SND_HINT = {
  'ปุ่ม': 'ปุ่มเสียงในหน้าส่งสัญญาณ · รหัสเช่น 1, 2, 1_1 (ไม่ซ้ำกัน)',
  'เสียงตามเวลา': 'เสียงที่เล่นพร้อมเสียงเปิด-ปิด ใช้ในตารางเวลาและปุ่มเสียงพิเศษ',
  'ระบบ': 'รหัส intro = เสียงเปิด · outro = เสียงปิด',
  'พนักงาน': 'รหัส = รหัสพนักงาน · ชื่อที่แสดง = ชื่อ · ไฟล์ = เสียงอ่านรหัสนั้น',
  'สถานที่': 'รหัส = ชื่อสถานที่ · ไฟล์ = เสียงอ่านชื่อสถานที่',
  'แคชเชียร์': 'รหัส = ชื่อช่อง เช่น แคชเชียร์ 1 · ไฟล์ = เสียงอ่านชื่อช่อง',
  'ประเภทงดรับ': 'รหัส = ประเภท เช่น งดรับเงินสด · ไฟล์ = เสียงประกาศประเภทนั้น',
  'เวลา': 'ตารางเวลาอัตโนมัติบน TV · รหัส = เวลา HH:MM · ค่าเพิ่มเติม = รหัสเสียงที่จะเล่น (เช่น 1930)',
  'ตั้งค่า': 'รหัส daytime = ประกาศรหัส 3 ช่วง 09:00-19:00 · ค่าเพิ่มเติม = ทุกกี่นาที (เช่น 30) · สถานะ ปิด = ไม่ประกาศ'
};
function sndNeedFile(t) { return t !== 'เวลา' && t !== 'ตั้งค่า'; }

function sndEnsureMqtt() {
  if (SND.client || typeof mqtt === 'undefined') return;
  try { SND.client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt'); } catch (e) {}
}
function muNotify() {
  try { if (SND.client && SND.client.connected) SND.client.publish(MU.MQ, JSON.stringify({ mode: 'refresh' })); } catch (e) {}
}
/* ----- ตั้งค่าเสียง (Admin) ----- */
var SND_OTHER = ['ระบบ', 'พนักงาน', 'สถานที่', 'แคชเชียร์', 'ประเภทงดรับ'];
$('#sFilter').innerHTML = '<option value="">ทุกประเภท</option>' + SND_OTHER.map(function (t) { return '<option>' + t + '</option>'; }).join('');
$('#sdType').innerHTML = SND_TYPES.map(function (t) { return '<option>' + t + '</option>'; }).join('');
async function sndLoadAdmin() {
  $('#sBody').innerHTML = '<tr><td colspan="7" class="muted">กำลังโหลด…</td></tr>';
  sndEnsureMqtt();
  call('musicList').then(function (r) {                  // ความดังเสียงประกาศ
    if (!MU.avDrag) { MU.avol = r.avol; $('#muAVol').value = r.avol; $('#muAVolTxt').textContent = r.avol + '%'; }
  }).catch(function () {});
  try {
    var r = await call('listSounds');
    r.receiverUrl = pageUrl('receiver.html', r.receiverUrl);
    SND.all = r.rows; $('#sRecv').value = r.receiverUrl; $('#sRecvOpen').href = r.receiverUrl;
    sndRenderAdmin();
  } catch (e) { toast(e.message, true); }
}
function sndFile(x) { return x.id ? '<button class="btn ghost small" data-a="play" data-i="' + esc(x.id) + '"> ฟัง</button> ' + esc(x.file) : '<span class="tag">ยังไม่มีไฟล์</span>'; }
function sndSt(x) { return '<td>' + (x.on ? 'ใช้งาน' : 'ปิด') + '</td>'; }
function sndActs(x) { return '<td class="act"><div class="actw"><button class="btn ghost small" data-a="edit" data-r="' + x.row + '">แก้ไข</button><button class="btn danger small" data-a="del" data-r="' + x.row + '">ลบ</button></div></td>'; }
function sndFill(sel, list, fn, cols, empty) { $(sel).innerHTML = list.map(fn).join('') || '<tr><td colspan="' + cols + '" class="muted">' + empty + '</td></tr>'; }
function sndSoundByKey(k) { return SND.all.filter(function (x) { return (x.type === 'ปุ่ม' || x.type === 'เสียงตามเวลา') && x.code === k; })[0]; }
function sndTypeOpts(t) {
  return SND.all.filter(function (y) { return y.type === t; }).map(function (y) {
    return '<option value="' + esc(y.code) + '">' + esc(y.code) + ' · ' + esc(y.label) + (y.file ? ' — ' + esc(y.file) : '') + '</option>'; }).join('');
}
function sndKeyOptions(cur) {
  var h = '<optgroup label="ปุ่มประกาศ">' + sndTypeOpts('ปุ่ม') + '</optgroup><optgroup label="เสียงตามเวลา">' + sndTypeOpts('เสียงตามเวลา') + '</optgroup>';
  if (cur && !sndSoundByKey(cur)) h = '<option value="' + esc(cur) + '">' + esc(cur) + ' (ไม่พบเสียง)</option>' + h;
  return h;
}
function sndRenderAdmin() {
  var A = SND.all, by = function (t) { return A.filter(function (x) { return x.type === t; }); };
  sndFill('#sBodyBtn', by('ปุ่ม'), function (x) {
    return '<tr><td><b>' + esc(x.code) + '</b></td><td>' + esc(x.label) + '</td><td>' + sndFile(x) + '</td>' + sndSt(x) + sndActs(x) + '</tr>';
  }, 5, 'ยังไม่มีปุ่ม');
  var sch = by('เวลา').sort(function (a, b) { return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; });
  sndFill('#sBodySch', sch, function (x) {
    var s = sndSoundByKey(x.value);
    return '<tr><td><b>' + esc(x.code) + ' น.</b></td><td><b>' + esc(x.value) + '</b>' + (s ? ' · ' + esc(s.label) : ' <span class="tag">ไม่พบเสียงรหัสนี้</span>') +
      '</td><td>' + (s ? sndFile(s) : '-') + '</td>' + sndSt(x) + sndActs(x) + '</tr>';
  }, 5, 'ยังไม่มีเวลาที่ตั้งไว้');
  sndFill('#sBodyTimed', by('เสียงตามเวลา'), function (x) {
    return '<tr><td><b>' + esc(x.code) + '</b></td><td>' + esc(x.label) + '</td><td>' + sndFile(x) + '</td>' + sndSt(x) + sndActs(x) + '</tr>';
  }, 5, 'ยังไม่มีไฟล์เสียง');
  var f = $('#sFilter').value, oth = A.filter(function (x) { return SND_OTHER.indexOf(x.type) >= 0 && (!f || x.type === f); });
  sndFill('#sBody', oth, function (x) {
    return '<tr><td>' + esc(x.type) + '</td><td>' + esc(x.code) + '</td><td>' + esc(x.label) + '</td><td>' + esc(x.value) + '</td><td>' + sndFile(x) + '</td>' + sndSt(x) + sndActs(x) + '</tr>';
  }, 7, 'ไม่มีรายการ');
  var d = A.filter(function (x) { return x.type === 'ตั้งค่า' && x.code === 'daytime'; })[0];
  $('#dtOn').value = d && !d.on ? 'ปิด' : (d ? 'ใช้งาน' : 'ปิด'); $('#dtInt').value = d ? d.value : '30';
  var dk = A.filter(function (x) { return x.type === 'ตั้งค่า' && x.code === 'daytimeKey'; })[0], kv = dk && dk.value ? dk.value : '3';
  $('#dtKey').innerHTML = sndKeyOptions(kv); $('#dtKey').value = kv;
}
function sndCfgPanel(p) {
  document.querySelectorAll('#cfgNav button').forEach(function (b) { b.classList.toggle('on', b.dataset.cp === p); });
  ['btn', 'sch', 'timed', 'other'].forEach(function (k) { $('#cp-' + k).classList.toggle('hidden', k !== p); });
}
$('#cfgNav').addEventListener('click', function (e) { var b = e.target.closest('button[data-cp]'); if (b) sndCfgPanel(b.dataset.cp); });

async function sndReload() { await sndLoadAdmin(); }
$('#dtSave').addEventListener('click', function () {
  var d = SND.all.filter(function (x) { return x.type === 'ตั้งค่า' && x.code === 'daytime'; })[0];
  busy(this, async function () {
    await call('saveSound', { row: d ? d.row : 0, type: 'ตั้งค่า', code: 'daytime', label: d ? d.label : 'ประกาศช่วง 09:00-19:00 (เล่นเสียงรหัส 3) ค่าเพิ่มเติม = ทุกกี่นาที',
                              value: $('#dtInt').value.trim(), status: $('#dtOn').value });
    var dk = SND.all.filter(function (x) { return x.type === 'ตั้งค่า' && x.code === 'daytimeKey'; })[0];
    await call('saveSound', { row: dk ? dk.row : 0, type: 'ตั้งค่า', code: 'daytimeKey', label: 'เสียงที่เล่นในช่วงประกาศซ้ำกลางวัน (ค่าเพิ่มเติม = รหัสเสียง)', value: $('#dtKey').value, status: 'ใช้งาน' });
    toast('บันทึกแล้ว'); await sndReload();
  });
});
/* ----- แก้ไขตารางเวลา ----- */
function sndOpenSch(x) {
  SND.editSch = x || null;
  $('#schTitle').textContent = x ? 'แก้ไขเวลาประกาศ ' + x.code : 'เพิ่มเวลาประกาศ';
  var sel = '<optgroup label="เสียงตามเวลา">' + sndTypeOpts('เสียงตามเวลา') + '</optgroup><optgroup label="ปุ่มประกาศ">' + sndTypeOpts('ปุ่ม') + '</optgroup>';
  if (x && !sndSoundByKey(x.value)) sel = '<option value="' + esc(x.value) + '">' + esc(x.value) + ' (ไม่พบเสียง)</option>' + sel;
  $('#schKey').innerHTML = sel;
  $('#schTime').value = x ? x.code : ''; $('#schKey').value = x ? x.value : $('#schKey').options[0] ? $('#schKey').options[0].value : '';
  $('#schStatus').value = x && !x.on ? 'ปิด' : 'ใช้งาน';
  $('#schModal').classList.remove('hidden');
}
$('#sAddSch').addEventListener('click', function () { sndOpenSch(null); });
$('#schCancel').addEventListener('click', function () { $('#schModal').classList.add('hidden'); });
$('#schSave').addEventListener('click', function () {
  var key = $('#schKey').value, e0 = SND.editSch;
  busy(this, async function () {
    await call('saveSound', { row: e0 ? e0.row : 0, type: 'เวลา', code: $('#schTime').value, label: 'เล่นเสียงรหัส ' + key, value: key, status: $('#schStatus').value });
    $('#schModal').classList.add('hidden'); toast('บันทึกแล้ว');
    await sndReload();
  });
});
$('#sAddBtn').addEventListener('click', function () { sndOpenEdit(null, 'ปุ่ม'); });
$('#sAddTimed').addEventListener('click', function () { sndOpenEdit(null, 'เสียงตามเวลา'); });
$('#sFilter').addEventListener('change', sndRenderAdmin);
$('#sRecvCopy').addEventListener('click', function () { copyField('#sRecv', 'คัดลอกลิงก์แล้ว'); });
/* ----- ตัวออกแบบหน้าจอ TV และพรีวิว ----- */
initTvDesigner();
function sndRow(r) { return SND.all.filter(function (x) { return x.row === Number(r); })[0]; }

$('#st-sound').addEventListener('click', async function (e) {
  var b = e.target.closest('button[data-a]'); if (!b) return;
  if (b.dataset.a === 'play') {
    b.disabled = true;
    try { var d = await call('adminSoundAudio', b.dataset.i); new Audio(d).play(); } catch (err) { toast(err.message, true); }
    b.disabled = false;
  } else if (b.dataset.a === 'edit') { var rx = sndRow(b.dataset.r); if (rx && rx.type === 'เวลา') sndOpenSch(rx); else sndOpenEdit(rx); }
  else if (b.dataset.a === 'del') {
    var x = sndRow(b.dataset.r); if (!x) return;
    if (!confirm('ลบรายการนี้?\n\n' + x.type + ' · ' + x.code + (x.label ? ' (' + x.label + ')' : '') + '\n\n(ไฟล์เสียงจะถูกลบถาวร)')) return;
    try { await call('deleteSound', x.row, x.code); toast('ลบแล้ว'); await sndReload(); }
    catch (err) { toast(err.message, true); }
  }
});
function sndTypeUi() {
  var t = $('#sdType').value;
  $('#sdHint').textContent = SND_HINT[t] || '';
  $('#sdFileRow').classList.toggle('hidden', !sndNeedFile(t));
}
$('#sdType').addEventListener('change', sndTypeUi);
function sndOpenEdit(x, preset) {
  SND.edit = x || null;
  $('#sdTitle').textContent = x ? 'แก้ไข: ' + x.type + ' ' + x.code : 'เพิ่มรายการ';
  $('#sdType').value = x ? x.type : (preset || $('#sFilter').value || 'ปุ่ม');
  $('#sdCode').value = x ? x.code : ''; $('#sdLabel').value = x ? x.label : '';
  $('#sdValue').value = x ? x.value : ''; $('#sdStatus').value = x && !x.on ? 'ปิด' : 'ใช้งาน';
  $('#sdFile').value = '';
  $('#sdCur').textContent = x && x.id ? 'ไฟล์ปัจจุบัน: ' + x.file + ' (เลือกไฟล์ใหม่เพื่อเปลี่ยน)' : '';
  sndTypeUi();
  $('#sndModal').classList.remove('hidden');
  $('#sdCode').focus();
}
$('#sAdd').addEventListener('click', function () { sndOpenEdit(null); });
$('#sdCancel').addEventListener('click', function () { $('#sndModal').classList.add('hidden'); });
function sndReadFile(f) {
  return new Promise(function (res, rej) {
    var fr = new FileReader();
    fr.onerror = function () { rej(new Error('อ่านไฟล์ไม่ได้')); };
    fr.onload = function () { res({ name: f.name, mime: f.type || 'audio/mpeg', data: String(fr.result).split(',')[1] }); };
    fr.readAsDataURL(f);
  });
}
$('#sdSave').addEventListener('click', function () {
  var p = { row: SND.edit ? SND.edit.row : 0, type: $('#sdType').value, code: $('#sdCode').value.trim(), label: $('#sdLabel').value.trim(),
            value: $('#sdValue').value.trim(), status: $('#sdStatus').value };
  var f = sndNeedFile(p.type) ? $('#sdFile').files[0] : null;
  busy(this, async function () {
    if (f) { if (f.size > 8 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 8 MB'); p.file = await sndReadFile(f); }
    await call('saveSound', p);
    $('#sndModal').classList.add('hidden'); toast('บันทึกแล้ว');
    await sndReload();
  });
});
$('#sImport').addEventListener('click', async function () {
  if (!confirm('นำเข้าไฟล์เสียงเดิมจากเว็บ GitHub เข้าระบบ?\n(เฉพาะรายการที่ยังไม่มีไฟล์ ใช้เวลาหลายนาที กรุณาอย่าปิดหน้านี้)')) return;
  this.disabled = true; var done = 0, miss = [], r;
  try {
    do {
      $('#sImpMsg').textContent = 'กำลังนำเข้า… สำเร็จแล้ว ' + done + ' ไฟล์';
      r = await call('soundImportLegacy'); done += r.done; miss = r.missing;
    } while (r.remaining > 0);
    $('#sImpMsg').textContent = 'นำเข้าเสร็จ: สำเร็จ ' + done + ' ไฟล์' + (miss.length ? ' · ไม่พบไฟล์ ' + miss.length + ' รายการ (' + miss.join(', ') + ') ให้อัปโหลดเอง' : '');
    await sndReload();
  } catch (e) { toast(e.message, true); $('#sImpMsg').textContent = ''; }
  this.disabled = false;
});


$('#muAVol').addEventListener('input', function () { MU.avDrag = true; $('#muAVolTxt').textContent = this.value + '%'; });
$('#muAVol').addEventListener('change', async function () {
  var v = Number(this.value);
  try { var r = await call('musicSetAnnounceVolume', v); MU.avol = r.avol; toast('ตั้งความดังเสียงประกาศ ' + r.avol + '%'); muNotify(); }
  catch (e) { toast(e.message, true); }
  MU.avDrag = false;
});

/* ============================ ประวัติการใช้งาน ============================ */
var HI = { cat: 'all', cats: [], rows: [] };
function openHistory() { HI.cat = 'all'; $('#hiQ').value = ''; loadHistory(); }
async function loadHistory() {
  $('#hiBody').innerHTML = '<tr><td colspan="5" class="muted">กำลังโหลด…</td></tr>';
  try {
    var r = await call('getActivity', HI.cat, 300);
    HI.cats = r.cats; HI.rows = r.rows; renderHistory();
  } catch (e) { $('#hiBody').innerHTML = '<tr><td colspan="5" class="muted">' + esc(e.message) + '</td></tr>'; toast(e.message, true); }
}
function renderHistory() {
  $('#hiNav').innerHTML = HI.cats.map(function (c) {
    return '<button class="' + (c.key === HI.cat ? 'on' : '') + '" data-hc="' + esc(c.key) + '">' + esc(c.label) + ' (' + c.count + ')</button>';
  }).join('');
  var q = $('#hiQ').value.trim().toLowerCase();
  var rows = HI.rows.filter(function (r) { return !q || [r.who, r.g, r.cat, r.action, r.detail].join(' ').toLowerCase().indexOf(q) >= 0; });
  $('#hiCount').textContent = 'แสดง ' + rows.length + (q ? ' / ' + HI.rows.length : '') + ' รายการ';
  $('#hiBody').innerHTML = rows.map(function (r) {
    return '<tr><td class="hirow-time">' + (r.ts ? fmt(r.ts) : '') + '</td><td>' + esc(r.who) + '</td><td>' + esc(r.g) + (r.cat ? ' / ' + esc(r.cat) : '') +
      '</td><td>' + esc(r.action) + '</td><td>' + esc(r.detail) + '</td></tr>';
  }).join('') || '<tr><td colspan="5" class="muted">ยังไม่มีประวัติ</td></tr>';
}
$('#hiNav').addEventListener('click', function (e) { var b = e.target.closest('button[data-hc]'); if (b) { HI.cat = b.dataset.hc; loadHistory(); } });
$('#hiQ').addEventListener('input', renderHistory);
$('#hiReload').addEventListener('click', loadHistory);
$('#hiClear').addEventListener('click', async function () {
  if (!S.me || S.me.role !== 'admin') return;
  var c = HI.cats.filter(function (x) { return x.key === HI.cat; })[0], label = c ? c.label : 'ทั้งหมด';
  var all = HI.cat === 'all';
  if (!confirm('ล้างประวัติการใช้งาน' + (all ? 'ทั้งหมด' : 'หมวด "' + label + '"') + ' ?\n\n(ลบแล้วกู้คืนไม่ได้)')) return;
  var btn = $('#hiClear'); btn.disabled = true;
  try {
    var r = await call('clearActivity', HI.cat);
    toast('ล้างประวัติแล้ว ' + r.removed + ' รายการ');
    await loadHistory();
  } catch (e) { toast(e.message, true); }
  btn.disabled = false;
});


/* ============================ เริ่มต้น ============================ */
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
