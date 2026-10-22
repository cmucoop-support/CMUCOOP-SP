var $ = function (s) { return document.querySelector(s); };
var esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
};
var track = $('#track'), panel = $('#panel');
var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
var timer = null, userPaused = !!reduce, hoverPaused = false, paused = userPaused, moving = false, count = 0, speed = 4, sig = '', perSet = 0, hPct = 80, ar = 0.75, arSet = false, firstId = '';
var ANIM = 600;
var bannerParentTheme = false;
var bannerParentConfig = null, imageFramePadding = 10;
function applyBannerTheme(config) {
  var bg = config && config.bg;
  if (!/^#[0-9a-f]{6}$/i.test(String(bg || ''))) return;
  document.documentElement.style.setProperty('--bg', bg);
  var st=document.documentElement.style;
  function valid(value,fallback){return /^#[0-9a-f]{6}$/i.test(String(value||''))?value:fallback;}
  function amount(value,fallback,max){return value===undefined||value===null||!Number.isFinite(Number(value))?fallback:Math.min(max,Math.max(0,Number(value)));}
  function rgba(color,opacity){var h=color.slice(1);return 'rgba('+parseInt(h.slice(0,2),16)+','+parseInt(h.slice(2,4),16)+','+parseInt(h.slice(4,6),16)+','+(opacity/100)+')';}
  function rgb(color){return [1,3,5].map(function(start){return parseInt(color.slice(start,start+2),16);});}
  function blend(color,alpha,under){return rgb(color).map(function(value,index){return value*alpha/100+under[index]*(1-alpha/100);});}
  function readable(rgb){var c=rgb.map(function(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);}),lum=.2126*c[0]+.7152*c[1]+.0722*c[2];return (lum+.05)/.06>1.05/(lum+.05)?'#1f1530':'#ffffff';}
  var panelColor=config.bannerBgMatch?bg:valid(config.bannerBg,'#ffffff');
  var frameColor=config.bannerFrameMatch?panelColor:valid(config.bannerFrameColor,'#ffffff');
  var panelOpacity=amount(config.bannerBgOpacity,100,100),controlBg=valid(config.controlBg,'#ffffff'),controlOpacity=amount(config.controlOpacity,100,100),panelRgb=blend(panelColor,panelOpacity,rgb(bg));
  st.setProperty('--ink',readable(panelRgb));
  st.setProperty('--banner-panel',rgba(panelColor,panelOpacity));
  st.setProperty('--banner-frame',rgba(frameColor,amount(config.bannerFrameOpacity,100,100)));
  imageFramePadding=amount(config.bannerFramePadding,10,60);
  st.setProperty('--control-bg',rgba(controlBg,controlOpacity));
  st.setProperty('--control-color',valid(config.controlColor,readable(blend(controlBg,controlOpacity,panelRgb))));
  st.setProperty('--control-border',valid(config.controlBorderColor,'#d9c8ff'));
  if(Number.isFinite(Number(config.bannerSpeed))&&Number(config.bannerSpeed)>=1&&Number(config.bannerSpeed)<=60)speed=Number(config.bannerSpeed);
  if(config.bannerPerView!==undefined)perSet=normPer(config.bannerPerView);
  if(config.bannerHeightPct!==undefined)hPct=normH(config.bannerHeightPct);
  layout();updateNav();restart();
}
window.addEventListener('message', function(event) {
  if (window.parent === window || event.source !== window.parent || event.origin !== location.origin || !event.data) return;
  if(event.data.type==='cmucoop:banner-refresh'){load(false);return;}
  if(event.data.type !== 'cmucoop:banner-theme')return;
  if (!/^#[0-9a-f]{6}$/i.test(String(event.data.bg || ''))) return;
  bannerParentTheme = true; bannerParentConfig=event.data;applyBannerTheme(bannerParentConfig);
});
function loadBannerTheme() {
  if (bannerParentTheme) return;
  google.script.run.withSuccessHandler(function(config){if(!bannerParentTheme)applyBannerTheme(config);}).withFailureHandler(function(){}).getTvPublic();
}

function syncPauseState() {
  paused = userPaused || hoverPaused;
  track.setAttribute('aria-live', paused ? 'polite' : 'off');
  var pb = $('#pauseBtn');
  if (pb) {
    pb.setAttribute('aria-pressed', userPaused ? 'true' : 'false');
    pb.setAttribute('aria-label', userPaused ? 'เล่นแบนเนอร์เลื่อนอัตโนมัติ' : 'หยุดเลื่อนแบนเนอร์อัตโนมัติ');
    pb.innerHTML = userPaused ? '&#9654;' : '&#10074;&#10074;';
  }
}

/* วัดขนาดกรอบที่ฝังอยู่จริง แล้วจัดรูปให้เต็มกรอบ: perSet = 0 → เลือกจำนวนรูปที่เต็มกรอบที่สุดเอง, 1-6 → ตามที่ Admin ตั้ง */
var M = 8, PAD = 12, GAP = 18, swPx = 300;
function normH(v) { v = Math.round(Number(v)); return v >= 30 && v <= 100 ? v : 80; }
function normPer(v) { v = Math.round(Number(v)); return v >= 0 && v <= 6 ? v : 0; }
function applyPer() { layout(); }
function layout() {
  var W = window.innerWidth || 800, H = window.innerHeight || 600;
  var availW = Math.max(80, W - 2 * M - 2 * PAD), sh = Math.max(60, (H - 2 * M - 2 * PAD - 12) * hPct / 100);
  function widthFor(k) { return Math.max(40, Math.min((availW - (k - 1) * GAP) / k, sh * ar)); }
  var n = perSet, st = document.documentElement.style;
  if (!n) {
    var best = 0, lim = Math.max(1, Math.min(6, count || 6)); n = 1;
    for (var k = 1; k <= lim; k++) { var c = k * widthFor(k) * widthFor(k); if (c > best + 1) { best = c; n = k; } }
  }
  swPx = Math.floor(widthFor(n));
  st.setProperty('--banner-frame-padding',Math.min(imageFramePadding,swPx/4,swPx/ar/4)+'px');
  st.setProperty('--per', n); st.setProperty('--sw', swPx + 'px'); st.setProperty('--ar', String(ar)); st.setProperty('--gap', GAP + 'px');
  $('#viewport').style.maxWidth = (n * swPx + (n - 1) * GAP) + 'px';
}
function perView() { return Number(getComputedStyle(document.documentElement).getPropertyValue('--per')) || 1; }
function step() { return swPx + GAP; }
function canLoop() { return count > perView(); }

/* หมุนวนไม่รู้จบ: เลื่อนทีละรูป แล้วย้ายรูปแรกไปต่อท้าย (หรือรูปท้ายมาไว้หน้า) */
function go(dir) {
  if (moving || !canLoop()) return;
  var w = step(); if (!w) return;
  moving = true;
  var dur = reduce ? 0 : ANIM;
  function done() {
    track.style.transition = 'none'; track.style.transform = 'none';
    if (dir > 0) track.appendChild(track.firstElementChild);
    moving = false;
  }
  if (dir > 0) {
    if (!dur) return done();
    track.style.transition = 'transform ' + dur + 'ms ease';
    track.style.transform = 'translateX(' + (-w) + 'px)';
    setTimeout(done, dur + 40);
  } else {
    track.insertBefore(track.lastElementChild, track.firstElementChild);
    track.style.transition = 'none'; track.style.transform = 'translateX(' + (-w) + 'px)';
    if (!dur) { track.style.transform = 'none'; moving = false; return; }
    void track.offsetWidth;
    track.style.transition = 'transform ' + dur + 'ms ease';
    track.style.transform = 'translateX(0)';
    setTimeout(function () { track.style.transition = 'none'; moving = false; }, dur + 40);
  }
}
function restart() {
  clearInterval(timer);
  if (!canLoop()) return;
  timer = setInterval(function () { if (!paused && !document.hidden) go(1); }, Math.max(1000, speed * 1000));
}
function updateNav() {
  var on = canLoop();
  $('#prev').hidden = $('#next').hidden = $('#pauseBtn').hidden = !on;
  track.classList.toggle('few', !on);
  syncPauseState();
}
function render(data) {
  var list = (data && data.banners) || [];
  speed = Number(data && data.speed) || 4;
  perSet = normPer(data && data.perView); hPct = normH(data && data.heightPct);
  sig = JSON.stringify([speed, perSet, hPct, list.map(function (b) { return [b.id, b.link]; })]);
  count = list.length; firstId = count ? list[0].id : ''; arSet = false;
  moving = false; track.style.transition = 'none'; track.style.transform = 'none';
  if (!count) { track.innerHTML = '<div class="msg" style="flex:1">ยังไม่มี Banner</div>'; updateNav(); clearInterval(timer); return; }
  track.innerHTML = list.map(function (b, idx) {
    var altTxt = (b.title && String(b.title).trim()) || ('แบนเนอร์ประชาสัมพันธ์ ' + (idx + 1));
    var im = '<img src="' + esc(b.url) + '" alt="' + esc(altTxt) + '" data-id="' + esc(b.id) + '" draggable="false">';
    if (b.link) im = '<a href="' + esc(b.link) + '" target="_blank" rel="noopener">' + im + '</a>';
    return '<div class="slide">' + im + '</div>';
  }).join('');
  if(bannerParentTheme&&bannerParentConfig)applyBannerTheme(bannerParentConfig);else { layout(); updateNav(); restart(); }
  if (window.A11Y && A11Y.run) A11Y.run();
}
/* อ่านสัดส่วนจริงจากรูปแรก แล้วจัดขนาดช่องใหม่ */
track.addEventListener('load', function (e) {
  var im = e.target;
  if (!im || im.tagName !== 'IMG' || arSet || im.dataset.id !== firstId) return;
  if (im.naturalWidth && im.naturalHeight) { ar = im.naturalWidth / im.naturalHeight; arSet = true; layout(); }
}, true);
/* ถ้ารูปจาก Drive ขึ้นไม่ได้ (โดเมนปิดการแชร์สาธารณะ) ให้ขอผ่านสคริปต์แทน */
track.addEventListener('error', function (e) {
  var im = e.target;
  if (!im || im.tagName !== 'IMG' || im.dataset.fb || typeof google === 'undefined') return;
  im.dataset.fb = '1';
  google.script.run.withSuccessHandler(function (d) { im.src = d; }).withFailureHandler(function () {}).getBannerImage(im.dataset.id);
}, true);

$('#prev').addEventListener('click', function () { track.setAttribute('aria-live', 'polite'); go(-1); restart(); });
$('#next').addEventListener('click', function () { track.setAttribute('aria-live', 'polite'); go(1); restart(); });
$('#pauseBtn').addEventListener('click', function () {
  userPaused = !userPaused;
  syncPauseState();
  restart();
});
['mouseenter', 'focusin'].forEach(function (ev) { panel.addEventListener(ev, function () { hoverPaused = true; syncPauseState(); }); });
['mouseleave', 'focusout'].forEach(function (ev) {
  panel.addEventListener(ev, function (e) {
    if (ev === 'focusout' && e.relatedTarget && panel.contains(e.relatedTarget)) return;
    hoverPaused = false;
    syncPauseState();
  });
});

/* ปัดซ้าย/ขวาบนมือถือ */
var tx = null, swiped = false;
$('#viewport').addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; swiped = false; hoverPaused = true; syncPauseState(); }, { passive: true });
$('#viewport').addEventListener('touchend', function (e) {
  hoverPaused = false; syncPauseState();
  if (tx === null) return;
  var dx = e.changedTouches[0].clientX - tx; tx = null;
  if (Math.abs(dx) > 40) { swiped = true; go(dx < 0 ? 1 : -1); restart(); }
}, { passive: true });
$('#viewport').addEventListener('click', function (e) { if (swiped) { e.preventDefault(); e.stopPropagation(); swiped = false; } }, true);

window.addEventListener('resize', function () { applyPer(); updateNav(); restart(); });
applyPer();
syncPauseState();

/* ดึงรายการใหม่ทุก 60 วินาที: เพิ่ม/ลบรูปหรือเปลี่ยนความเร็วแล้วขึ้นเอง ไม่ต้องรีเฟรช */
function load(first) {
  google.script.run
    .withSuccessHandler(function (d) {
      var s2 = JSON.stringify([Number(d && d.speed) || 4, normPer(d && d.perView), normH(d && d.heightPct), ((d && d.banners) || []).map(function (b) { return [b.id, b.link]; })]);
      if (first || s2 !== sig) render(d);
    })
    .withFailureHandler(function () {
      if (first) track.innerHTML = '<div class="msg" style="flex:1">โหลด Banner ไม่สำเร็จ ลองรีเฟรชหน้านี้อีกครั้ง</div>';
    })
    .getPublicBanners();
}
if (typeof google !== 'undefined' && google.script && google.script.run) {
  loadBannerTheme();
  load(true);
  setInterval(function () { if (!document.hidden) { load(false); loadBannerTheme(); } }, 60000);
} else {
  track.innerHTML = '<div class="msg" style="flex:1">เปิดหน้านี้ผ่านลิงก์เว็บแอป (?page=banner)</div>';
}
