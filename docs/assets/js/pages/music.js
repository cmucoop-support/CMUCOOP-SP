/* ============================ ตัวช่วย ============================ */
var $ = function (s) { return document.querySelector(s); };
var esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
};
function call(fn) {
  var args = Array.prototype.slice.call(arguments, 1);
  var callToken = S.token;
  if (fn !== 'login' && fn !== 'recoverAdmin' && fn !== 'loginByLink') args.unshift(S.token);
  return new Promise(function (res, rej) {
    var r = google.script.run.withSuccessHandler(res).withFailureHandler(function (e) {
      var msg = (e && e.message) || String(e);
      if (/SESSION_EXPIRED/.test(msg)) {
        msg = 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง';
        if(callToken===S.token)showLogin(msg);
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
  document.body.dataset.nav = n || 'music';
}
function showLogin(msg) {
  if (MU) { clearInterval(MU.timer); clearInterval(MU.timer2); MU.rows = []; MU.prog = null; MU.requesting=false;MU.actionPending={};MU.query='';MU.scope='all'; }
  $('#muUrl').value='';$('#muSearch').value='';$('#muScope').value='all';
  $('#muNow').textContent = ''; $('#muBody').textContent = ''; $('#muCount').textContent = '';
  if (SND && SND.client) { SND.client.end(true); SND.client = null; }
  S.token = ''; S.me = null;
  try { sessionStorage.removeItem('pm_tok'); sessionStorage.removeItem('pm_me'); } catch (e) {}
  clearInterval(MU.timer);
  clearInterval(MU.timer2);
  document.body.classList.add('locked');
  document.querySelectorAll('.modalwrap,.overlay').forEach(function (dialog) { dialog.classList.add('hidden'); });
  if ($('#login')) $('#login').classList.remove('hidden');
  $('#lgErr').textContent = msg || ''; $('#lgPass').value = '';
  setTimeout(function () { $('#lgUser').focus(); }, 50);
}
function hasPerm(k) { return !!(S.me && (S.me.role === 'admin' || (S.me.perms && S.me.perms[k]))); }
function goPortal() {
  location.href = pageUrl('index.html', 'https://cmucoop-support.github.io/CMUCOOP-SP/index.html');
}

var SND = { client: null };
function sndConnect() {
  if (SND.client || typeof mqtt === 'undefined') return;
  try { SND.client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt'); } catch (e) {}
}

/* ============================ ขอเพลง / คิวเพลง ============================ */
var MU = { auto: false, vol: 70, volDrag: false, avol: 100, avDrag: false, rows: [], timer: null, MQ: 'cmucoop/audio/control/music_v1', tab: 'q', tv: null, maxUser: 3, fails: 0, query: '', scope: 'all', requesting: false, actionPending: {} };
var MU_LIVE = { 'รออนุมัติ': 1, 'รอคิว': 1, 'กำลังเล่น': 1 };
function muNotify() {                              // สะกิดให้ TV เช็กคิวทันที
  try { if (SND.client && SND.client.connected) SND.client.publish(MU.MQ, JSON.stringify({ mode: 'refresh' })); } catch (e) {}
}
function muTime(ts) { if (!ts) return ''; var d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function openMusic() {
  if (!hasPerm('music')) return;
  setNav('music');
  var admin = S.me.role === 'admin';
  $('#muMe').textContent = S.me.name + ' (' + (admin ? 'Admin' : 'ผู้ใช้งาน') + ')';
  $('#muAdminCard').classList.toggle('hidden', !admin);
  if (!$('#muMaxUser').options.length) $('#muMaxUser').innerHTML = [1, 2, 3, 4, 5, 6, 8, 10].map(function (n) { return '<option>' + n + '</option>'; }).join('');
  MU.tab = 'q'; MU.fails = 0;
  MU.query = ''; MU.scope = 'all'; MU.actionPending = {}; $('#muSearch').value = ''; $('#muScope').value = 'all'; muPreview();
  sndConnect(); muLoad();
  clearInterval(MU.timer);
  MU.timer = setInterval(function () {
    if (document.body.dataset.nav !== 'music') { clearInterval(MU.timer); return; }
    if (!document.hidden) muLoad();
  }, 5000);
  clearInterval(MU.timer2);
  MU.timer2 = setInterval(function () {                    // ขยับแถบความคืบหน้าทุกวินาที (ระหว่างรอข้อมูลรอบใหม่จาก TV)
    if (document.body.dataset.nav !== 'music') { clearInterval(MU.timer2); return; }
    muBar();
  }, 1000);
}
function muFmt(s) {
  s = Math.max(0, Math.floor(s)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return (h ? h + ':' + pad2(m) : m) + ':' + pad2(s % 60);
}
function muBar() {                                         // คำนวณตำแหน่งเพลงตอนนี้จากที่ TV รายงานล่าสุด + เวลาที่ผ่านไป
  var fill = $('#muBarFill'); if (!fill) return;
  var p = MU.prog, bar = fill.parentNode, pos = $('#muPosT'), dur = $('#muDurT');
  bar.classList.toggle('paused', !!MU.paused);
  if (!p) { bar.classList.add('unk'); pos.textContent = '--:--'; dur.textContent = ''; return; }
  bar.classList.remove('unk');
  var age = Math.max(0, Math.min(Date.now() + (MU.skew || 0) - p.ts, 300000));
  var cur = (p.pos || 0) + (p.mv && !MU.paused ? age / 1000 : 0);
  if (p.dur > 0) cur = Math.min(cur, p.dur);
  pos.textContent = muFmt(cur);
  var trk = p.n ? 'เพลงที่ ' + p.idx + '/' + p.n : '';
  dur.textContent = p.dur > 0 ? muFmt(p.dur) + (trk ? ' · ' + trk : '') : trk;
  fill.style.width = p.dur > 0 ? (cur / p.dur * 100).toFixed(1) + '%' : '0%';
}
async function muLoad() {
  if (!S.token || MU.loadingToken === S.token) return;
  var token = S.token;
  MU.loadingToken = token;
  try {
    var r = await call('musicList');
    if (token !== S.token || !S.me) return;
    MU.rows = r.rows; MU.auto = r.auto; MU.tv = r.tv; MU.maxUser = r.maxUser; MU.fails = 0;
    MU.paused = !!r.paused; MU.prog = r.prog || null; MU.skew = (r.now || Date.now()) - Date.now();   // skew = นาฬิกาเซิร์ฟเวอร์ − นาฬิกาเครื่องนี้
    if (!MU.volDrag) MU.vol = r.vol; if (!MU.avDrag) MU.avol = r.avol;
    muRender();
  } catch (e) { if (token === S.token && ++MU.fails >= 2) $('#muCount').textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กำลังลองใหม่…'; }
  finally { if (MU.loadingToken === token) MU.loadingToken = ''; }
}

/* ---------- ตรวจลิงก์ที่วาง (ฝั่งหน้าเว็บ ใช้แสดงตัวอย่างทันที ฝั่งเซิร์ฟเวอร์ตรวจซ้ำอีกครั้ง) ---------- */
function muParse(raw) {
  var s = (raw || '').trim(); if (!s) return null;
  var u; try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch (e) { return { bad: true, label: 'ลิงก์ไม่ถูกต้อง' }; }
  var h = u.hostname.toLowerCase().replace(/^(www|m|music)\./, ''), id = '', list = u.searchParams.get('list'), v = u.searchParams.get('v'),
      seg = u.pathname.split('/').filter(Boolean), ID = /^[A-Za-z0-9_-]{11}$/;
  var mix = { bad: true, label: 'YouTube Mix (เล่นอัตโนมัติ) ไม่รองรับ — ใช้ลิงก์วิดีโอหรือเพลย์ลิสต์ปกติ' };
  if (h === 'youtu.be') id = seg[0] || '';
  else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
    if (u.pathname === '/playlist' && list) return /^RD/.test(list) ? mix : { kind: 'ytlist', label: 'เพลย์ลิสต์ YouTube' };
    id = v || (['shorts', 'embed', 'live', 'v'].indexOf(seg[0]) >= 0 ? seg[1] : '') || '';
    if (!ID.test(id) && list) return /^RD/.test(list) ? mix : { kind: 'ytlist', label: 'เพลย์ลิสต์ YouTube' };
  } else if (/\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|flac)$/i.test(u.pathname)) {
    var n = u.pathname.split('/').pop(); try { n = decodeURIComponent(n); } catch (e) {}
    return { kind: 'audio', label: 'ไฟล์เสียง: ' + n };
  }
  if (ID.test(id)) return { kind: 'yt', thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg', label: 'วิดีโอ YouTube' };
  return { bad: true, label: 'รองรับเฉพาะลิงก์ YouTube หรือไฟล์เสียง (.mp3 .m4a .wav .ogg)' };
}
function muArt(x) {
  return '<div class="mu-art"' + (x.thumb ? ' style="background-image:url(\'' + esc(x.thumb) + '\')"' : '') + '>' + (x.thumb ? '' : '<svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg>') + '</div>';
}
function muPreview() {
  var p = muParse($('#muUrl').value), box = $('#muPrev');
  $('#muSend').disabled = !!MU.requesting || !p || !!p.bad;
  box.classList.toggle('hidden', !p); box.classList.toggle('bad', !!(p && p.bad));
  if (!p) { box.innerHTML = ''; return; }
  box.innerHTML = p.bad ? ' ' + esc(p.label) : muArt(p) + '<div><b>' + esc(p.label) + '</b><div class="mu-sub">กด "ส่งคำขอ" แล้วระบบจะดึงชื่อเพลงให้อัตโนมัติ</div></div>';
}

/* ---------- แสดงผล ---------- */
function muChip(st) {
  var c = { 'กำลังเล่น': 'ok', 'รอคิว': 'wait', 'รออนุมัติ': 'warn', 'ปฏิเสธ': 'bad', 'ผิดพลาด': 'bad' }[st] || '';
  return '<span class="mu-chip ' + c + '"><i></i>' + esc(st) + '</span>';
}
function muBtn(a, label, id, cls) { return '<button type="button" class="btn ' + (cls || 'ghost') + ' small" data-a="' + a + '" data-i="' + esc(id) + '"' + (MU.actionPending[a+'|'+id] ? ' disabled aria-busy="true"' : '') + '>' + label + '</button>'; }
function muRender() {
  var focused=document.activeElement,focusedAction=focused&&focused.dataset.a,focusedId=focused&&focused.dataset.i;
  var admin = S.me && S.me.role === 'admin';
  var live = MU.rows.filter(function (x) { return MU_LIVE[x.status]; }), hist = MU.rows.filter(function (x) { return !MU_LIVE[x.status]; });
  var playing = live.filter(function (x) { return x.status === 'กำลังเล่น'; })[0];
  var queue = live.filter(function (x) { return x.status !== 'กำลังเล่น'; });
  var waiting = queue.filter(function (x) { return x.status === 'รอคิว'; }), pending = queue.filter(function (x) { return x.status === 'รออนุมัติ'; });

  /* สถานะ TV */
  var tv = MU.tv || {}, chip = $('#muTv');
  chip.className = 'mu-chip ' + (tv.online ? 'ok' : (tv.seen ? 'bad' : 'warn'));
  chip.lastChild.textContent = tv.online ? 'TV ออนไลน์' : (tv.seen ? 'TV ไม่ตอบสนอง · ล่าสุด ' + muTime(tv.seen) : 'ยังไม่พบ TV');

  /* กำลังเล่น */
  if (playing) {
    $('#muNow').innerHTML = muArt(playing) + '<div class="mu-nowinfo"><div class="mu-title"><span class="mu-eq"><b></b><b></b><b></b></span>' + esc(playing.title) + '</div>' +
      '<div class="mu-sub">ขอโดย ' + esc(playing.by) + (playing.start ? ' · เริ่มเล่น ' + muTime(playing.start) : '') + (MU.paused ? ' <span class="mu-chip warn"><i></i>หยุดอยู่</span>' : '') + '</div>' +
      '<div class="mu-prog"><div class="mu-bar"><i id="muBarFill"></i></div><div class="mu-ptime"><span id="muPosT">--:--</span><span id="muDurT"></span></div></div></div>' +
      '<div class="mu-act">' + (admin ? (MU.paused ? muBtn('resume', 'เล่นต่อ', playing.id, 'solid') : muBtn('pause', 'พักเพลง', playing.id)) : '') + (playing.kind === 'ytlist' ? muBtn('nexttrack', 'เพลงถัดไปในเพลย์ลิสต์', playing.id) : '') + muBtn('skip', playing.kind === 'ytlist' ? 'จบเพลย์ลิสต์นี้' : 'ข้ามเพลง', playing.id) + '</div>';
    muBar();
  } else {
    var hint = waiting.length ? (tv.online ? 'เพลงถัดไปกำลังจะเริ่มที่ TV ภายในไม่กี่วินาที' : 'มีเพลงรอคิว แต่หน้าจอ TV ยังออฟไลน์ กรุณาเปิดหน้าแสดงผลบนเครื่อง TV')
      : pending.length ? 'มีเพลงรออนุมัติ ' + pending.length + ' เพลง' : 'เพิ่มเพลงได้จากช่องขอเพลง';
    $('#muNow').innerHTML = '<div class="mu-art"><svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg></div><div class="mu-nowinfo"><div class="mu-title">ตอนนี้ไม่มีเพลงที่กำลังเล่น</div><div class="mu-sub">' + hint + '</div></div>';
  }

  /* ช่องขอเพลง + โควตา */
  var mine = live.filter(function (x) { return x.mine; }).length;
  $('#musicStats').innerHTML=[[waiting.length,'เพลงรอเล่น'],[pending.length,'เพลงรออนุมัติ'],[mine,'เพลงของคุณในคิว']].map(function(pair){return '<div class="workspace-stat"><strong>'+pair[0]+'</strong><span>'+pair[1]+'</span></div>';}).join('');
  $('#muQuota').textContent = admin ? 'Admin: เข้าคิวทันที ไม่จำกัดจำนวน' : 'คุณมีเพลงในคิว ' + mine + '/' + MU.maxUser;
  $('#muNote').textContent = MU.auto ? 'เปิดอนุมัติอัตโนมัติอยู่ — เพลงที่ขอจะเข้าคิวทันที' : (admin ? 'ผู้ใช้ทั่วไปต้องรอ Admin อนุมัติก่อนจึงเข้าคิว (เพลงที่ Admin ขอเข้าคิวทันที)' : 'เพลงที่ขอต้องรอ Admin อนุมัติก่อนจึงเข้าคิว');

  /* ส่วน Admin */
  $('#muAuto').checked = !!MU.auto;
  if (document.activeElement !== $('#muMaxUser')) $('#muMaxUser').value = String(MU.maxUser);
  var pb = $('#muPendBadge'); pb.classList.toggle('hidden', !pending.length); if (pending.length) pb.lastChild.textContent = 'รออนุมัติ ' + pending.length + ' เพลง';
  $('#muApproveAll').disabled = !pending.length;

  /* ความดัง */
  if (!MU.volDrag) { $('#muVol').value = MU.vol; $('#muVolTxt').textContent = MU.vol + '%'; }

  /* แท็บ + รายการ */
  $('#muTabQ').textContent = 'คิว' + (queue.length ? ' (' + queue.length + ')' : ''); $('#muTabH').textContent = 'ประวัติ' + (hist.length ? ' (' + hist.length + ')' : '');
  $('#muTabQ').classList.toggle('on', MU.tab === 'q'); $('#muTabH').classList.toggle('on', MU.tab === 'h');
  $('#muTabQ').setAttribute('aria-pressed',String(MU.tab==='q'));$('#muTabH').setAttribute('aria-pressed',String(MU.tab==='h'));
  $('#muCount').textContent = live.length ? 'ในคิว ' + live.length + ' เพลง' : '';
  function matches(x){return (MU.scope!=='mine'||x.mine)&&(MU.scope!=='pending'||x.status==='รออนุมัติ')&&(!MU.query||(String(x.title||'')+' '+String(x.by||'')).toLowerCase().includes(MU.query.toLowerCase().trim()));}
  var queueVisible=queue.filter(matches),histVisible=hist.filter(matches);
  $('#muCount').textContent='แสดง '+(MU.tab==='q'?queueVisible.length:histVisible.length)+' เพลง';
  var n = 0, html;
  if (MU.tab === 'q') {
    html = queueVisible.map(function (x) {
      var b = '';
      if (admin) {
        if (x.status === 'รออนุมัติ') b = muBtn('approve', 'อนุมัติ', x.id, '') + muBtn('reject', 'ปฏิเสธ', x.id, 'danger');
        else b = (waiting[0] && waiting[0].id !== x.id ? muBtn('next', '▲ เล่นถัดไป', x.id) : '') + muBtn('remove', 'ลบ', x.id, 'danger');
      } else if (x.mine) b = muBtn('cancel', 'ยกเลิก', x.id);
      return '<div class="mu-item">' + '<div class="mu-num">' + (x.status === 'รอคิว' ? ++n : '–') + '</div>' + muArt(x) +
        '<div><div class="mu-title"><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a></div><div class="mu-sub">ขอโดย ' + esc(x.by) + (x.mine ? ' (คุณ)' : '') + ' · ' + muTime(x.ts) + ' ' + muChip(x.status) + '</div></div>' +
        '<div class="mu-act">' + b + '</div></div>';
    }).join('') || '<div class="muted mu-empty">'+(MU.query||MU.scope!=='all'?'ไม่พบเพลงตามคำค้นหาหรือตัวกรอง':'ยังไม่มีเพลงรอคิว เพิ่มเพลงใหม่ได้จากช่องขอเพลง')+'</div>';
  } else {
    html = histVisible.map(function (x) {
      return '<div class="mu-item dim"><div class="mu-num"></div>' + muArt(x) +
        '<div><div class="mu-title"><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a></div><div class="mu-sub">ขอโดย ' + esc(x.by) + ' · ' + muTime(x.end || x.ts) + ' ' + muChip(x.status) + '</div></div>' +
        '<div class="mu-act"><button class="btn ghost small" data-a="again" data-u="' + esc(x.url) + '">ขออีกครั้ง</button></div></div>';
    }).join('') || '<div class="muted mu-empty">'+(MU.query||MU.scope!=='all'?'ไม่พบประวัติตามคำค้นหาหรือตัวกรอง':'ยังไม่มีประวัติการเล่นเพลง')+'</div>';
  }
  $('#muBody').innerHTML = html;
  if(focusedAction&&focusedId){var target=Array.from(document.querySelectorAll('#musicPage [data-a]')).find(function(b){return b.dataset.a===focusedAction&&b.dataset.i===focusedId;});if(target&&!target.disabled)target.focus({preventScroll:true});}
}

/* ---------- การกระทำ ---------- */
$('#muUrl').addEventListener('input', muPreview);
$('#muSend').addEventListener('click', async function () {
  var u = $('#muUrl').value.trim();
  if (!u) { toast('วางลิงก์เพลงก่อน', true); return; }
  var parsed=muParse(u);if(!parsed||parsed.bad){toast(parsed&&parsed.label||'ลิงก์เพลงไม่ถูกต้อง',true);return;}
  if(MU.requesting)return;MU.requesting=true;this.disabled=true;var requestToken=S.token;
    try{var r = await call('musicRequest', u);if(requestToken!==S.token)return;
      $('#muUrl').value = ''; MU.tab = 'q';MU.query='';MU.scope='all';$('#muSearch').value='';$('#muScope').value='all';
      toast(r.status === 'รอคิว' ? 'เข้าคิวแล้ว: ' + r.title : 'ส่งคำขอแล้ว รอ Admin อนุมัติ: ' + r.title);
      muNotify(); await muLoad();
    }catch(error){if(requestToken===S.token)toast(error.message,true);}
    finally{if(requestToken===S.token){MU.requesting=false;muPreview();}}
});
$('#muUrl').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#muSend').click(); });
$('#musicPage').addEventListener('click', async function (e) {
  var t = e.target.closest('.mu-tab');
  if (t) { MU.tab = t.dataset.t; muRender(); return; }
  var b = e.target.closest('button[data-a]'); if (!b) return;
  var a = b.dataset.a;
  if (a === 'again') { $('#muUrl').value = b.dataset.u; muPreview(); $('#muUrl').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#muUrl').focus(); return; }
  if (a === 'skip' && !confirm('ต้องการ'+b.textContent.trim()+'ที่กำลังเล่นอยู่หรือไม่?')) return;
  var actionKey=a+'|'+b.dataset.i,pending=MU.actionPending,actionToken=S.token;if(pending[actionKey])return;pending[actionKey]=true;
  b.disabled = true;
  try {
    if (a === 'cancel') await call('musicCancel', b.dataset.i);
    else if (a === 'nexttrack') { await call('musicNextTrack', b.dataset.i); toast('สั่งข้ามไปเพลงถัดไปในเพลย์ลิสต์แล้ว'); }
    else if (a === 'pause' || a === 'resume') { await call('musicPause', b.dataset.i, a === 'pause'); toast(a === 'pause' ? 'สั่งหยุดเพลงแล้ว' : 'สั่งเล่นเพลงต่อแล้ว'); }
    else await call('musicDecide', b.dataset.i, a);
    delete pending[actionKey];if(actionToken!==S.token)return;muNotify(); await muLoad();
  } catch (err) { if(actionToken===S.token){toast(err.message, true);muLoad();} }
  finally{delete pending[actionKey];if(b.isConnected)b.disabled=false;}
});
$('#muAuto').addEventListener('change', async function () {
  var on = this.checked;
  try { await call('musicSetAuto', on); MU.auto = on; muRender(); toast(on ? 'เปิดอนุมัติอัตโนมัติแล้ว' : 'ปิดอนุมัติอัตโนมัติแล้ว'); }
  catch (e) { toast(e.message, true); this.checked = !on; }
});
$('#muApproveAll').addEventListener('click', async function () {
  try { var r = await call('musicApproveAll'); toast(r.count ? 'อนุมัติแล้ว ' + r.count + ' เพลง' : 'ไม่มีเพลงที่รออนุมัติ'); muNotify(); await muLoad(); }
  catch (e) { toast(e.message, true); }
});
$('#muMaxUser').addEventListener('change', async function () {
  try { var r = await call('musicSetMaxUser', this.value); MU.maxUser = r.maxUser; muRender(); toast('ผู้ใช้ทั่วไปขอเพลงค้างในคิวได้ ' + r.maxUser + ' เพลง'); }
  catch (e) { toast(e.message, true); this.value = String(MU.maxUser); }
});
$('#muClear').addEventListener('click', async function () {
  if (!confirm('ล้างประวัติเพลงทั้งหมด? (ไม่กระทบเพลงที่อยู่ในคิว)')) return;
  try { var r = await call('musicClearHistory'); toast('ล้างประวัติแล้ว ' + r.count + ' รายการ'); await muLoad(); }
  catch (e) { toast(e.message, true); }
});
$('#muVol').addEventListener('input', function () { MU.volDrag = true; $('#muVolTxt').textContent = this.value + '%'; });
$('#muVol').addEventListener('change', async function () {
  var v = Number(this.value);
  try { var r = await call('musicSetVolume', v); MU.vol = r.vol; toast('ตั้งความดังเพลง ' + r.vol + '%'); muNotify(); }
  catch (e) { toast(e.message, true); }
  MU.volDrag = false;
});

$('#muHome').addEventListener('click', goPortal);

async function startApp(me) {
  S.me = me;
  if (!hasPerm('music')) {
    showLogin('บัญชีนี้ยังไม่ได้รับสิทธิ์การ์ดขอเพลง / คิวเพลง — ติดต่อ Admin หรือเข้าสู่ระบบด้วยบัญชีอื่น');
    return;
  }
  document.body.classList.remove('locked');
  if ($('#login')) $('#login').classList.add('hidden');
  try { if (me && me.role) sessionStorage.setItem('pm_me', JSON.stringify(me)); } catch (e) {}
  openMusic();
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
      try { sessionStorage.setItem('pm_tok', r.token); sessionStorage.setItem('pm_me', JSON.stringify(r)); } catch (e) {}
      await startApp(r); return;
    } catch (e) { showLogin(e.message); return; }
  }
  if (S.token) {                                  // กู้เซสชันเดิมทันทีโดยไม่กะพริบหน้าล็อกอิน
    try { var me = await call('whoami'); await startApp(me); return; }
    catch (e) { showLogin(e.message); return; }
  }
  showLogin('');
})();
