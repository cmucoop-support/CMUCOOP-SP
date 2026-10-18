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
var S = { token: '', me: null };
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

function setNav(n) {
  document.body.dataset.nav = n || 'sound';
}
function showLogin(msg) {
  if (SND && SND.client) { SND.client.end(true); SND.client = null; }
  if (SND) { SND.cfg = null; SND.hist = []; }
  S.token = ''; S.me = null;
  try { sessionStorage.removeItem('pm_tok'); sessionStorage.removeItem('pm_me'); } catch (e) {}
  document.body.classList.add('locked');
  document.querySelectorAll('.modalwrap,.overlay').forEach(function (dialog) { dialog.classList.add('hidden'); });
  if ($('#login')) $('#login').classList.remove('hidden');
  $('#lgErr').textContent = msg || ''; $('#lgPass').value = '';
  setTimeout(function () { $('#lgUser').focus(); }, 50);
}
function hasPerm(k) { return !!(S.me && S.me.perms && S.me.perms[k]); }
function goPortal() {
  location.href = pageUrl('index.html', 'https://cmucoop-support.github.io/CMUCOOP-SP/index.html');
}

/* ============================ ระบบเสียงประกาศ ============================ */
var SND = { cfg: null, client: null, hist: [], all: [], edit: null,
            TF: 'cmucoop/audio/control/signal_key_v1', TS: 'cmucoop/audio/control/staff_speech_v1' };
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
function sndStatus(t, ok) { var el = $('#sStatus'); el.textContent = t; el.className = 'sbox' + (ok ? ' ok' : ''); }
function sndConnect() {
  if (SND.client) { sndStatus(SND.client.connected ? 'ออนไลน์ พร้อมส่งสัญญาณ' : 'กำลังเชื่อมต่อระบบส่งสัญญาณ…', SND.client.connected); return; }
  if (typeof mqtt === 'undefined') { sndStatus(' โหลดระบบส่งสัญญาณไม่สำเร็จ ลองรีเฟรชหน้านี้', false); return; }
  SND.client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');
  SND.client.on('connect', function () { sndStatus('ออนไลน์ พร้อมส่งสัญญาณ', true); });
  SND.client.on('offline', function () { sndStatus(' ขาดการเชื่อมต่อ กำลังเชื่อมต่อใหม่…', false); });
}
function sndRenderHist() {
  $('#sHist').innerHTML = SND.hist.map(function (x) {
    return '<div><span> <b>' + esc(x.t) + '</b></span><span class="muted">' + new Date(x.ts).toLocaleTimeString('th-TH') + '</span></div>';
  }).join('') || '<div class="muted">ยังไม่มีประวัติการส่ง</div>';
}
function sndPublish(topic, payload, label) {
  if (!SND.client || !SND.client.connected) { toast('ยังเชื่อมต่อระบบส่งสัญญาณไม่ได้ กรุณารอสักครู่', true); return; }
  SND.client.publish(topic, JSON.stringify(payload));
  sndStatus(' ส่งสัญญาณ [' + label + '] สำเร็จ', true);
  setTimeout(function () { sndStatus('ออนไลน์ พร้อมส่งสัญญาณ', true); }, 1500);
  SND.hist.unshift({ t: label, ts: Date.now() }); SND.hist = SND.hist.slice(0, 30); sndRenderHist();
  call('soundLog', 'ส่งสัญญาณ', label).catch(function () {});
}
function sndOpts(list) { return list.map(function (x) { return '<option value="' + esc(x.code) + '">' + esc(x.label) + '</option>'; }).join(''); }
function sndRange(a, b, f) { var o = ''; for (var i = a; i <= b; i++) o += '<option value="' + i + '">' + f(i) + '</option>'; return o; }
function sndRender() {
  var c = SND.cfg; if (!c) return;
  $('#sKeys').innerHTML = c.buttons.map(function (b) {
    return '<div class="kb"><span class="kl">' + esc(b.label) + '</span><button class="kbtn" data-k="' + esc(b.code) + '" data-l="' + esc(b.label) + '">' + esc(b.code.replace('_', '.')) + '</button></div>';
  }).join('') || '<div class="muted">ยังไม่มีเสียง — ให้ Admin นำเข้าหรืออัปโหลดไฟล์เสียงในแท็บ "ตั้งค่าเสียง"</div>';
  $('#sTimed').innerHTML = c.timed.map(function (b) {
    return '<button class="btn ghost" data-k="' + esc(b.code) + '" data-l="' + esc(b.label) + '" data-io="1"> ' + esc(b.label) + '</button>';
  }).join('') || '<div class="muted">ยังไม่มีเสียงพิเศษ</div>';
  $('#sCashier').innerHTML = sndOpts(c.cashiers);
  $('#sNotice').innerHTML = sndOpts(c.notices);
  $('#sRepKey').innerHTML = sndOpts(c.buttons.concat(c.timed));
  $('#sRepCount').innerHTML = sndRange(1, 10, function (i) { return i + ' รอบ'; });
  $('#sRepInt').innerHTML = '<option value="0">ทันที (เล่นต่อเนื่อง)</option>' + sndRange(1, 10, function (i) { return 'ทุกๆ ' + i + ' นาที'; });
  $('#sStaff').innerHTML = '<option value="">-- กรุณาเลือกพนักงาน --</option>' +
    c.staff.map(function (x) { return '<option value="' + esc(x.code) + '" data-n="' + esc(x.label) + '">รหัส ' + esc(x.code) + ' - ' + esc(x.label) + '</option>'; }).join('');
  $('#sLoc').innerHTML = sndOpts(c.locations);
}
async function openSound() {
  if (!hasPerm('sound')) return;
  var token = S.token;
  setNav('sound');
  var admin = S.me.role === 'admin';
  $('#sMe').textContent = S.me.name;
  $('#sGoCfg').classList.toggle('hidden', !admin);
  sndTab('send'); sndConnect(); sndRenderHist();
  try {
    var config = await call('getSoundConfig');
    if (token !== S.token || !S.me) return;
    SND.cfg = config; sndRender();
  } catch (e) { if (token === S.token) toast(e.message, true); }
}
function sndTab(t) {
  document.querySelectorAll('#sTabs .stab').forEach(function (x) { x.classList.toggle('on', x.dataset.st === t); });
  ['send', 'timed', 'staff'].forEach(function (k) { $('#s-' + k).style.display = k === t ? 'grid' : 'none'; });
}
$('#sTabs').addEventListener('click', function (e) { var b = e.target.closest('.stab'); if (b) sndTab(b.dataset.st); });
$('#s-send').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-k]'); if (!b) return;
  sndPublish(SND.TF, { mode: 'file', key: b.dataset.k, withIntroOutro: !!b.dataset.io }, b.dataset.io ? b.dataset.l + ' (เปิด-ปิด)' : b.dataset.l);
});
$('#s-timed').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-k]'); if (!b) return;
  sndPublish(SND.TF, { mode: 'file', key: b.dataset.k, withIntroOutro: !!b.dataset.io }, b.dataset.io ? b.dataset.l + ' (เปิด-ปิด)' : b.dataset.l);
});
$('#sCashierSend').addEventListener('click', function () {
  var c = $('#sCashier').value, n = $('#sNotice').value;
  if (!c || !n) { toast('ยังไม่มีข้อมูลแคชเชียร์/ประเภทการงดรับ', true); return; }
  sndPublish(SND.TF, { mode: 'cashierNotice', cashier: c, noticeType: n, withIntroOutro: true }, c + ' ' + n + ' ชั่วคราว');
});
$('#sRepSend').addEventListener('click', function () {
  var k = $('#sRepKey').value, cnt = Number($('#sRepCount').value), iv = Number($('#sRepInt').value);
  if (!k) { toast('ยังไม่มีเสียงให้เลือก', true); return; }
  var l = $('#sRepKey').options[$('#sRepKey').selectedIndex].text;
  sndPublish(SND.TF, { mode: 'file', key: k, repeatCount: cnt, intervalMinutes: iv, withIntroOutro: true },
             'เล่นซ้ำ ' + l + ' ' + cnt + ' รอบ (เปิด-ปิด, ' + (iv ? 'ทุกๆ ' + iv + ' นาที' : 'ทันที') + ')');
});
$('#sStaffSend').addEventListener('click', function () {
  var s = $('#sStaff'), code = s.value;
  if (!code) { toast('กรุณาเลือกพนักงานก่อน', true); return; }
  var name = s.options[s.selectedIndex].dataset.n, loc = $('#sLoc').value;
  if (!loc) { toast('ยังไม่มีข้อมูลสถานที่', true); return; }
  sndPublish(SND.TS, { mode: 'speech', empCode: code, empName: name, location: loc }, 'เรียก: ' + code + ' (' + name + ') ➔ ' + loc);
});
$('#sHome').addEventListener('click', goPortal);

$('#sGoCfg').addEventListener('click', function () {
  var u = pageUrl('settings.html', 'https://cmucoop-support.github.io/CMUCOOP-SP/settings.html');
  location.href = u + '#sp=sound&t=' + encodeURIComponent(S.token);
});

async function startApp(me) {
  S.me = me;
  if (!hasPerm('sound')) {
    showLogin('บัญชีนี้ยังไม่ได้รับสิทธิ์การ์ดระบบเสียงประกาศ — ติดต่อ Admin หรือเข้าสู่ระบบด้วยบัญชีอื่น');
    return;
  }
  document.body.classList.remove('locked');
  if ($('#login')) $('#login').classList.add('hidden');
  try { if (me && me.role) sessionStorage.setItem('pm_me', JSON.stringify(me)); } catch (e) {}
  await openSound();
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
