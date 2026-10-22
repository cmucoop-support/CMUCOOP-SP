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


/* ============================ เข้าสู่ระบบ / ออกจากระบบ ============================ */
function setNav(n) { document.body.dataset.nav = 'portal'; }
function showLogin(msg) {
  S.token = ''; S.me = null;
  try { sessionStorage.removeItem('pm_tok'); sessionStorage.removeItem('pm_me'); } catch (e) {}
  document.body.classList.add('locked');
  document.querySelectorAll('.modalwrap,.overlay').forEach(function (dialog) { dialog.classList.add('hidden'); });
  if ($('#login')) $('#login').classList.remove('hidden');
  setNav('portal');
  $('#lgErr').textContent = msg || ''; $('#lgPass').value = '';
  setTimeout(function () { $('#lgUser').focus(); }, 50);
}
function hasPerm(k) { if (!S.me) return false; if (S.me.role === 'admin') return true; if (!S.me.perms) return false; return !!S.me.perms[k]; }
function goPortal() {
  var admin = S.me && S.me.role === 'admin';
  setNav('portal');
  $('#pMe').textContent = S.me.name + ' (' + (admin ? 'Admin' : 'ผู้ใช้งาน') + ')';
  $('#mSettings').classList.toggle('hidden', !admin);
  document.querySelector('#portal .menu').setAttribute('aria-busy', 'true');
  loadCardSize();
  ['barcode:mBarcode', 'sound:mSound', 'music:mMusic', 'stock:mStock', 'market:mMarket', 'expiry:mExpiry'].forEach(function (x) {
    var a = x.split(':'); $('#' + a[1]).classList.toggle('hidden', !hasPerm(a[0]));      // การ์ดที่ Admin ติ๊กให้ผู้ใช้คนนี้
  });
}
async function startApp(me) {
  S.me = me;
  document.body.classList.remove('locked');
  if ($('#login')) $('#login').classList.add('hidden');
  try { if (me && me.role) sessionStorage.setItem('pm_me', JSON.stringify(me)); } catch (e) {}
  goPortal();
  loadCardOrder();
  if (S.initSp && me.role === 'admin') {               // ลิงก์เก่า index.html#sp=... → ส่งต่อไปหน้าตั้งค่าใหม่
    var sp = S.initSp; S.initSp = '';
    location.href = pageUrl('settings.html', 'https://cmucoop-support.github.io/CMUCOOP-SP/settings.html') + '#sp=' + encodeURIComponent(sp) + '&t=' + encodeURIComponent(S.token);
  }
}

/* ----- ลำดับการ์ดเมนูหลัก (Admin จัดได้) ----- */
var CARD_DEF = [
  { k: 'barcode', id: 'mBarcode', t: 'รายการบาร์เดี่ยว/บาร์แพ็ค' }, { k: 'sound', id: 'mSound', t: 'ระบบเสียงประกาศ' },
  { k: 'music', id: 'mMusic', t: 'ขอเพลง / คิวเพลง' }, { k: 'stock', id: 'mStock', t: 'สินค้าค้างสต็อก' }, { k: 'market', id: 'mMarket', t: 'เช็คราคาตลาด' },
  { k: 'expiry', id: 'mExpiry', t: 'แจ้งเตือนสินค้าหมดอายุ' },
  { k: 'settings', id: 'mSettings', t: 'ตั้งค่า' }
];
var CARD_ORDER = CARD_DEF.map(function (c) { return c.k; }), CARD_WORK = [];
var CARD_TITLES = {}, CARD_WORK_T = {};      // ชื่อที่ Admin แก้เอง (เฉพาะที่เปลี่ยน) / ค่าที่กำลังแก้ในหน้าตั้งค่า
var CUSTOM = [], CUSTOM_WORK = {};                                               // การ์ดลิงก์ที่ Admin สร้างเอง [{k,t,u}] / ค่าที่กำลังแก้
var CARD_HIDDEN = [], CARD_NEW_TABS = [];
function isCustom(k) { return /^c_[0-9a-f]{8}$/.test(k); }
function customOf(k) { return CUSTOM.filter(function (c) { return c.k === k; })[0]; }
function cardDef(k) { return CARD_DEF.filter(function (c) { return c.k === k; })[0]; }
function cardEl(k) { var d = cardDef(k); return d ? document.getElementById(d.id) : document.querySelector('#portal .mcard[data-ck="' + k + '"]'); }
function applyCardOrder(order) {
  var menu = document.querySelector('#portal .menu');
  order.forEach(function (k) { var el = cardEl(k); if (el) menu.appendChild(el); });
}
function cardTitle(k) { var c = customOf(k); return c ? c.t : (CARD_TITLES[k] || cardDef(k).t); }
function applyCardTitles() {
  CARD_DEF.forEach(function (d) {
    var el = document.getElementById(d.id), b = el && el.querySelector('b');
    if (b) b.textContent = cardTitle(d.k);
  });
}
function renderCustomCards() {                                                   // วาดการ์ดลิงก์ที่ Admin สร้างเองลงเมนูหลัก
  var menu = document.querySelector('#portal .menu');
  menu.querySelectorAll('.mcard[data-ck]').forEach(function (x) { x.remove(); });
  CUSTOM.forEach(function (c) {
    var a = document.createElement('a'), b = document.createElement('b');
    a.className = 'mcard'; a.dataset.ck = c.k; a.href = c.u;
    a.style.cssText = 'text-decoration:none;color:inherit';
    b.textContent = c.t; a.appendChild(b); menu.appendChild(a);
  });
}
function applyCardTargets() {
  CARD_DEF.concat(CUSTOM).forEach(function (c) {
    var el = cardEl(c.k); if (!el) return;
    var newTab = CARD_NEW_TABS.indexOf(c.k) >= 0;
    var file = c.k + '.html';
    el.href = isCustom(c.k) ? c.u : pageUrl(file, 'https://cmucoop-support.github.io/CMUCOOP-SP/' + file) + '#t=' + encodeURIComponent(S.token);
    el.setAttribute('target', newTab ? '_blank' : '_self');
    el.setAttribute('rel', newTab ? 'noopener noreferrer' : '');
  });
}
function applyCardVisibility() {
  var shown = 0, admin = S.me && S.me.role === 'admin';
  CARD_DEF.forEach(function (c) {
    var el = cardEl(c.k);
    if (!el) return;
    var allowed = c.k === 'settings' ? admin : hasPerm(c.k);
    var hidden = !allowed || (c.k !== 'settings' && CARD_HIDDEN.indexOf(c.k) >= 0);
    el.classList.toggle('hidden', hidden);
    if (!hidden) shown++;
  });
  CUSTOM.forEach(function (c) {
    var el = cardEl(c.k);
    if (!el) return;
    var allowed = admin || !!(S.me && S.me.perms && S.me.perms[c.k] !== false);
    var hidden = !allowed || CARD_HIDDEN.indexOf(c.k) >= 0;
    el.classList.toggle('hidden', hidden);
    if (!hidden) shown++;
  });
  return shown;
}
function refreshCards() { renderCustomCards(); applyCardOrder(CARD_ORDER); applyCardTitles(); applyCardTargets(); return applyCardVisibility(); }
function portalCardsStatus(message, retry) {
  var status = $('#portalCardsStatus');
  status.textContent = message || ''; status.hidden = !message;
  status.parentElement.hidden = !message;
  $('#portalReloadCards').hidden = !retry;
}
async function loadCardOrder() {
  var token = S.token, menu = document.querySelector('#portal .menu');
  menu.setAttribute('aria-busy', 'true');
  portalCardsStatus('กำลังโหลดเมนู…', false);
  function ok(fn, def) { return call(fn).catch(function () { return def; }); }
  try {
    var r = await Promise.all([ok('getCardOrder', CARD_ORDER), ok('getCardTitles', {}), ok('getCustomCards', []), call('getHiddenCards'), call('getCardNewTabs')]);
    if (token !== S.token || !S.me) return;
    if (!Array.isArray(r[3])) throw new Error('ค่าการแสดงการ์ดจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    if (!Array.isArray(r[4])) throw new Error('ค่าการเปิดแท็บจากเซิร์ฟเวอร์ไม่ถูกต้อง');
    CARD_ORDER = Array.isArray(r[0]) ? r[0].slice() : CARD_DEF.map(function (c) { return c.k; }); CARD_DEF.forEach(function (c) { if (CARD_ORDER.indexOf(c.k) < 0) { var si = CARD_ORDER.indexOf('settings'); if (si >= 0) CARD_ORDER.splice(si, 0, c.k); else CARD_ORDER.push(c.k); } }); CARD_TITLES = r[1] || {}; CUSTOM = r[2] || [];
    CARD_HIDDEN = r[3]; CARD_NEW_TABS = r[4];
    var shown = refreshCards();
    menu.setAttribute('aria-busy', 'false');
    portalCardsStatus(shown ? '' : 'ยังไม่มีการ์ดที่เปิดให้ใช้งาน กรุณาติดต่อผู้ดูแลระบบ', false);
    if (CARD_HIDDEN.indexOf('expiry') < 0) loadExpiryCardCount();
  } catch (e) {
    if (token !== S.token || !S.me) return;
    // Do not briefly reveal hidden cards after a failed read. Keep the admin's
    // settings card reachable and let the user retry the menu request.
    document.querySelectorAll('#portal .mcard').forEach(function (el) {
      el.classList.toggle('hidden', el.id !== 'mSettings' || S.me.role !== 'admin');
    });
    menu.setAttribute('aria-busy', 'false');
    portalCardsStatus(/ไม่รู้จักคำสั่ง/.test(e.message)
      ? 'กรุณาอัปเดต Cloudflare Worker รุ่นที่รองรับการซ่อนการ์ดและตั้งค่าการเปิดแท็บ แล้วลองโหลดเมนูใหม่'
      : 'โหลดเมนูไม่สำเร็จ กรุณาลองใหม่: ' + e.message, true);
  }
}

/* ----- ปรับขนาดการ์ดเมนูหลัก (ผูกกับบัญชีบนเซิร์ฟเวอร์ ตามไปทุกเครื่อง; เก็บสำเนาในเครื่องไว้ให้ขึ้นเร็ว) ----- */
var SZ_NAMES = ['เล็ก', 'ปกติ', 'กลาง', 'ใหญ่', 'ใหญ่มาก', 'ใหญ่มากๆ'];
var SZ_CARD = [{ w: 190, h: 72 }, { w: 240, h: 96 }, { w: 290, h: 118 }, { w: 340, h: 140 }, { w: 400, h: 170 },
  { w: '100%', h: 'max(180px, calc((100vh - 250px) / 2))', pw: '960px' }];     // ใหญ่มากๆ = คอลัมน์เดียว สูงครึ่งจอ เห็นพร้อมกันแค่ 2 การ์ด
var SZ_FONT = [14, 18, 22, 26, 30, 36];
var SZ = { c: 1, f: 1, n: 0 };                      // ลำดับระดับ (1 = ปกติ) ; n = จำนวนการ์ดต่อแถว (0 = อัตโนมัติ)
function szKey() { return 'pm_cardsz2_' + ((S.me && (S.me.user || S.me.name)) || ''); }
function szApply() {
  var st = $('#portal').style, c = SZ_CARD[SZ.c];
  st.setProperty('--card-w', typeof c.w === 'number' ? c.w + 'px' : c.w);
  st.setProperty('--card-h', typeof c.h === 'number' ? c.h + 'px' : c.h);
  st.setProperty('--card-fs', SZ_FONT[SZ.f] + 'px');
  var menu = $('#portal .menu'), base = typeof c.w === 'number' ? c.w : 240;
  if (SZ.n > 0) {
    menu.classList.add('fixcols');
    st.setProperty('--card-cols', SZ.n); st.setProperty('--card-cols-m', Math.min(SZ.n, 2));
    st.setProperty('--portal-w', Math.max(c.pw ? parseInt(c.pw, 10) : 720, SZ.n * base + (SZ.n - 1) * 14 + 40) + 'px');
  } else {
    menu.classList.remove('fixcols');
    st.setProperty('--portal-w', c.pw || Math.max(1040, c.w * 3 + 64) + 'px');   // ความกว้างอัตโนมัติสำหรับ 3 คอลัมน์; โหมดกำหนดจำนวนคอลัมน์ใช้ค่าเดิม
  }
}
function szRender() {
  function btns(g, names) {
    return names.map(function (n, i) {
      return '<button class="btn small' + (SZ[g] === i ? '' : ' ghost') + '" data-g="' + g + '" data-i="' + i + '">' + n + '</button>';
    }).join('');
  }
  $('#szCardBtns').innerHTML = btns('c', SZ_NAMES); $('#szFontBtns').innerHTML = btns('f', SZ_NAMES);
  $('#szColBtns').innerHTML = btns('n', ['อัตโนมัติ', '1', '2', '3', '4']);
}
function loadCardSize() {
  SZ = { c: 1, f: 1, n: 0 };
  var hadLocal = false;
  try {
    var o = JSON.parse(localStorage.getItem(szKey()) || 'null');
    if (o && o.c >= 0 && o.c < SZ_NAMES.length && o.f >= 0 && o.f < SZ_NAMES.length) {
      SZ = { c: Number(o.c), f: Number(o.f), n: o.n >= 0 && o.n <= 4 ? Number(o.n) : 0 };
      hadLocal = SZ.c !== 1 || SZ.f !== 1 || SZ.n !== 0;
    }
  } catch (e) {}
  szApply();
  call('getCardSize').then(function (v) {                 // ค่าของบัญชีบนเซิร์ฟเวอร์เป็นหลัก
    if (v) {
      SZ = { c: v.c, f: v.f, n: v.n }; szApply();
      try { localStorage.setItem(szKey(), JSON.stringify(SZ)); } catch (e) {}
      if (!$('#sizeModal').classList.contains('hidden')) szRender();
    } else if (hadLocal) call('setCardSize', SZ).catch(function () {});     // ค่าเก่าที่เคยตั้งไว้ในเครื่อง → ผูกเข้าบัญชี
  }).catch(function () {});
}
var szTimer = null;
function szSave() {
  try { localStorage.setItem(szKey(), JSON.stringify(SZ)); } catch (e) {}
  clearTimeout(szTimer);
  szTimer = setTimeout(function () { call('setCardSize', SZ).catch(function () {}); }, 600);   // รอให้เลือกเสร็จก่อนค่อยบันทึกขึ้นบัญชี
}
$('#portalSize').addEventListener('click', function () { szRender(); $('#sizeModal').classList.remove('hidden'); });
$('#sizeModal').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-g]'); if (!b) return;
  SZ[b.dataset.g] = Number(b.dataset.i); szApply(); szRender(); szSave();
});
$('#sizeReset').addEventListener('click', function () { SZ = { c: 1, f: 1, n: 0 }; szApply(); szRender(); szSave(); });
$('#sizeClose').addEventListener('click', function () { $('#sizeModal').classList.add('hidden'); });

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


/* ============================ เมนูหลัก: ลิงก์เปิดตามค่าการเปิดแท็บของแต่ละการ์ด ============================ */
async function loadExpiryCardCount() {
  var el = $('#expiryCardCount'), token = S.token;
  if (!hasPerm('expiry')) { el.textContent = ''; return; }
  el.textContent = 'กำลังตรวจรายการแจ้งเตือน…';
  try {
    var data = await call('expirySummary');
    if (token !== S.token) return;
    el.textContent = data.counts.total + ' ล็อตที่เปิดแจ้งเตือน · ภายใน 1 เดือน/เลยกำหนด ' + (data.counts.expired + data.counts.week + data.counts.month) + ' ล็อต';
  } catch (e) { if (token === S.token) el.textContent = 'เปิดเพื่อตรวจรายการล่าสุด'; }
}

$('#portalReloadCards').addEventListener('click', function () { busy(this, loadCardOrder); });
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
