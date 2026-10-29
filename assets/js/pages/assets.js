(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const statuses = { normal: 'ปกติ', irreparable: 'ไม่สามารถซ่อมได้', repair: 'ต้องทำการซ่อม', reduced: 'ลด ระหว่างปี' };
  const moneyKeys = ['total', 'opening', 'increase', 'decrease', 'closing', 'net'];
  const fmtMoney = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtInt = new Intl.NumberFormat('th-TH');
  const fmtDate = new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
  const fmtTime = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  let token = '', user = null, data = null, page = 1, loadSeq = 0, searchTimer, imageTimer, toastTimer, formState = null, saving = false, titleRevision;
  let pendingImageData = null, parsedImportItems = null, stickerPool = [], selectedStickerIds = new Set(), qrRefCode = '', qrTargetRow = null, qrAutoOpened = false;

  const amount = value => value == null ? '<span class="muted">–</span>' : fmtMoney.format(value);
  const date = value => value ? fmtDate.format(new Date(value + 'T00:00:00Z')) : '–';

  function formatStickerDate(iso, style = 'slash') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return '–';
    if (style === 'short') return date(iso);
    const y = Number(m[1]) + 543;
    return m[3] + '/' + m[2] + '/' + y;
  }

  function safeUrl(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    if (/^\/file\/[0-9a-f]{32}$/i.test(raw)) {
      try { return new URL(window.API_URL || location.origin).origin + raw; } catch (_) { return raw; }
    }
    try {
      const u = new URL(raw);
      return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : '';
    } catch (_) { return ''; }
  }

  function extractFid(url) {
    const m = /\/file\/([0-9a-f]{32})(?:[?#]|$)/i.exec(String(url || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function assetQrLink(row, baseHref) {
    const base = baseHref || (typeof location !== 'undefined' ? (location.origin + location.pathname) : 'https://cmucoop.test/assets.html');
    const code = String((row && row.code) || '').trim();
    const id = String((row && row.id) || '').trim();
    if (code) return base + '?code=' + encodeURIComponent(code);
    if (id) return base + '?code=' + encodeURIComponent(id);
    return base;
  }

  function buildStickerQrSvg(text) {
    const ZX = typeof ZXing !== 'undefined' ? ZXing : (typeof window !== 'undefined' && window.ZXing);
    if (!ZX || !ZX.QRCodeEncoder) return '<svg viewBox="0 0 33 33" xmlns="http://www.w3.org/2000/svg"></svg>';
    const hints = new Map([[ZX.EncodeHintType.CHARACTER_SET, 'UTF-8'], [ZX.EncodeHintType.MARGIN, 1]]);
    const qr = ZX.QRCodeEncoder.encode(String(text || ''), ZX.QRCodeDecoderErrorCorrectionLevel.M, hints);
    const matrix = qr.getMatrix(), w = matrix.getWidth(), h = matrix.getHeight(), pad = 2, size = w + pad * 2;
    let path = '';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (matrix.get(x, y) === 1) path += 'M' + (x + pad) + ' ' + (y + pad) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges" role="img" aria-label="QR Code ' + esc(text) + '"><rect width="' + size + '" height="' + size + '" fill="#ffffff"/><path d="' + path + '" fill="#000000"/></svg>';
  }

  function toast(message, error = false) {
    if (message === 'SESSION_CHANGED') return;
    const el = $('#toast'); if (!el) return;
    el.textContent = message; el.hidden = false; el.classList.toggle('error-toast', error); el.setAttribute('role', error ? 'alert' : 'status');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, error ? 10000 : 5000);
  }

  function call(fn, ...args) {
    const sentToken = token;
    if (fn !== 'login' && fn !== 'assetsPublicByCode') args.unshift(sentToken);
    return new Promise((resolve, reject) => {
      const run = google.script.run.withSuccessHandler(result => {
        if (fn !== 'login' && fn !== 'assetsPublicByCode' && sentToken !== token) return reject(new Error('SESSION_CHANGED'));
        resolve(result);
      }).withFailureHandler(error => {
        if (fn !== 'login' && fn !== 'assetsPublicByCode' && sentToken !== token) return reject(new Error('SESSION_CHANGED'));
        const message = error && error.message || String(error);
        if (message === 'SESSION_EXPIRED') showLogin('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง');
        reject(new Error(message));
      });
      run[fn](...args);
    });
  }

  /* ==================== QR Code Deep-Link Spotlight ==================== */
  function renderQrSpotlight(row, errorMsg = '') {
    const card = $('#qrAssetCard');
    if (!card) return;
    if (!qrRefCode && !row && !errorMsg) { card.hidden = true; return; }
    card.hidden = false;
    const errEl = $('#qrAssetError'), bodyEl = $('#qrAssetBody');
    if (errorMsg) {
      errEl.textContent = errorMsg; errEl.hidden = false; bodyEl.hidden = true;
      $('#qrAssetOpenBtn').hidden = true; $('#qrAssetStickerBtn').hidden = true;
      return;
    }
    errEl.hidden = true; bodyEl.hidden = false;
    qrTargetRow = row;
    $('#qrAssetHeading').textContent = (row.code ? 'รหัสสินทรัพย์ ' + row.code + ' · ' : '') + row.name;
    $('#qrAssetCode').textContent = row.code || row.id || '–';
    $('#qrAssetDate').textContent = row.received ? formatStickerDate(row.received, 'slash') + ' (' + date(row.received) + ')' : '–';
    $('#qrAssetSeq').textContent = row.seq ? fmtInt.format(row.seq) : '–';
    const stEl = $('#qrAssetStatus');
    stEl.textContent = statuses[row.status] || row.status || '–';
    stEl.className = 'status-pill ' + (row.status || 'normal');
    $('#qrAssetName').textContent = row.name || '–';
    $('#qrAssetLocation').textContent = row.location || '–';
    $('#qrAssetNote').textContent = row.note || '–';
    const url = safeUrl(row.imageUrl);
    $('#qrAssetPhoto').innerHTML = url
      ? '<img src="' + esc(url) + '" alt="' + esc(row.name) + '" referrerpolicy="no-referrer">'
      : '<span class="photo-empty">ไม่มีรูปภาพ</span>';
    $('#qrAssetOpenBtn').hidden = !user;
    $('#qrAssetStickerBtn').hidden = !user;
  }

  async function loadQrReference() {
    if (!qrRefCode) { $('#qrAssetCard').hidden = true; return; }
    try {
      if (token && user) {
        const row = await call('assetsGetByCode', qrRefCode);
        renderQrSpotlight(row);
        if (!qrAutoOpened) { qrAutoOpened = true; openForm(row); }
      } else {
        const res = await call('assetsPublicByCode', qrRefCode);
        if (res && res.row) renderQrSpotlight(res.row);
      }
    } catch (e) {
      renderQrSpotlight(null, 'ไม่พบรายการสินทรัพย์สำหรับรหัสอ้างอิง "' + qrRefCode + '" (' + e.message + ')');
    }
  }

  function showLogin(message = '') {
    token = ''; user = null; data = null; formState = null; loadSeq++;
    try { sessionStorage.removeItem('pm_tok'); sessionStorage.removeItem('pm_me'); } catch (_) {}
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    $('#workspace').hidden = true; $('#loginPanel').hidden = false; $('#logout').hidden = true; $('#me').textContent = '';
    $('#rows').innerHTML = ''; $('#stats').innerHTML = ''; $('#totals').innerHTML = ''; $('#password').value = ''; $('#loginError').textContent = message;
    if (qrRefCode) loadQrReference();
  }

  async function startApp() {
    const me = await call('whoami');
    if (!(me.perms && me.perms.assets)) { showLogin('บัญชีนี้ยังไม่มีสิทธิ์รายการสินทรัพย์ กรุณาให้ Admin เปิดสิทธิ์ในหน้าตั้งค่า'); return; }
    user = me; $('#loginPanel').hidden = true; $('#workspace').hidden = false; $('#logout').hidden = false;
    $('#me').textContent = me.name + (me.role === 'admin' ? ' · Admin' : '');
    try { sessionStorage.setItem('pm_tok', token); sessionStorage.setItem('pm_me', JSON.stringify(me)); } catch (_) {}
    if (qrRefCode && !$('#search').value) $('#search').value = qrRefCode;
    await load();
    if (qrRefCode) await loadQrReference();
  }

  async function load() {
    if (!token || !user) return;
    const seq = ++loadSeq; $('#refresh').disabled = true;
    try {
      const result = await call('assetsList', { page, pageSize: Number($('#pageSize').value), q: $('#search').value.trim(), status: $('#statusFilter').value, location: $('#locationFilter').value });
      if (seq !== loadSeq) return;
      data = result;
      const maxPage = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (page > maxPage) { page = maxPage; return load(); }
      $('#loadError').hidden = true; render();
    } catch (e) {
      if (seq !== loadSeq || e.message === 'SESSION_CHANGED') return;
      $('#loadError').textContent = 'โหลดข้อมูลไม่สำเร็จ: ' + e.message + ' · กดรีเฟรชเพื่อลองใหม่'; $('#loadError').hidden = false;
      toast(e.message, true);
    } finally { if (seq === loadSeq) $('#refresh').disabled = false; }
  }

  function render() {
    $('#registerTitle').textContent = data.title; document.title = data.title + ' · CMUCOOP';
    $('#addAsset').hidden = !data.me.edit; $('#editTitle').hidden = !data.me.edit;
    $('#importExcelBtn').hidden = !data.me.edit;
    const allCount = Object.values(data.counts).reduce((a, b) => a + b, 0);
    const stats = [['', 'สินทรัพย์ทั้งหมด', allCount], ...Object.entries(statuses).map(([key, title]) => [key, title, data.counts[key]])];
    $('#stats').innerHTML = stats.map(([key, title, count]) => '<button type="button" class="stat ' + key + '" data-status="' + key + '" aria-pressed="' + ($('#statusFilter').value === key) + '"><span>' + title + '</span><strong>' + fmtInt.format(count) + '</strong><small>รายการ</small></button>').join('');
    const selected = $('#locationFilter').value;
    const locations = [...new Set([...data.locations, ...(selected ? [selected] : [])])].sort();
    $('#locationFilter').innerHTML = '<option value="">ทุกสถานที่</option>' + locations.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join(''); $('#locationFilter').value = selected;
    $('#locationChoices').innerHTML = data.locations.map(v => '<option value="' + esc(v) + '"></option>').join('');
    $('#resultInfo').textContent = fmtInt.format(data.total) + ' รายการ' + ($('#statusFilter').value ? ' · ' + statuses[$('#statusFilter').value] : ' · ทุกสถานะ');
    $('#netSummary').textContent = 'ราคาสินทรัพย์สุทธิตามตัวกรอง ' + fmtMoney.format(data.summary.net) + ' บาท';
    $('#rows').innerHTML = data.rows.length ? data.rows.map(rowHtml).join('') : '<tr><td colspan="20" class="empty"><strong>' + (allCount ? 'ไม่พบรายการตามตัวกรอง' : 'เริ่มบันทึกรายการสินทรัพย์') + '</strong>' + (allCount ? 'ลองเปลี่ยนคำค้น สถานที่ หรือสถานะ' : 'เพิ่มรายการแรกพร้อมรูปภาพและข้อมูลสินทรัพย์') + (data.me.edit ? '<br><button type="button" class="button primary" data-new>+ เพิ่มสินทรัพย์</button>' : '') + '</td></tr>';
    $('#totals').innerHTML = data.total ? '<tr><td colspan="11">รวมตามตัวกรอง ' + fmtInt.format(data.total) + ' รายการ</td><td class="num">' + amount(data.summary.total) + '</td><td class="num">–</td>' + ['opening', 'increase', 'decrease', 'closing', 'net'].map(k => '<td class="num">' + amount(data.summary[k]) + '</td>').join('') + '<td colspan="2"></td></tr>' : '';
    const maxPage = Math.max(1, Math.ceil(data.total / data.pageSize));
    $('#pageInfo').textContent = 'หน้า ' + page + ' / ' + fmtInt.format(maxPage); $('#prev').disabled = page <= 1; $('#next').disabled = page >= maxPage;
    $('#updated').textContent = 'โหลดล่าสุด ' + fmtTime.format(new Date()) + ' · ข้อมูลตัวเลขตามทะเบียนที่บันทึก';
  }

  function rowHtml(r) {
    const url = safeUrl(r.imageUrl);
    const isHighlight = qrRefCode && (String(r.code || '').toLowerCase() === qrRefCode.toLowerCase() || r.id === qrRefCode);
    const photo = url ? '<button type="button" class="photo-button" data-image="' + esc(r.id) + '" aria-label="ดูภาพ ' + esc(r.name) + '"><img class="thumb" src="' + esc(url) + '" alt="' + esc(r.name) + '" loading="lazy" referrerpolicy="no-referrer"></button>' : '<span class="photo-empty">ไม่มีรูปภาพ</span>';
    return '<tr' + (isHighlight ? ' class="qr-highlight"' : '') + '><td class="seq-cell">' + fmtInt.format(r.seq) + '</td><td>' + photo + '</td><td>' + (url ? '<a class="image-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.imageUrl) + '</a>' : '<span class="muted">–</span>') + '</td>' +
      '<td><span class="asset-name">' + esc(r.name) + '</span></td><td class="asset-code">' + esc(r.code || '–') + '</td><td>' + date(r.received) + '</td><td>' + esc(r.location || '–') + '</td>' +
      Object.entries(statuses).map(([key, label]) => '<td class="status-cell"><input type="checkbox" disabled' + (r.status === key ? ' checked' : '') + ' aria-label="' + esc(label + ': ' + r.name) + '"></td>').join('') +
      '<td class="num">' + amount(r.total) + '</td><td class="num">' + (r.rate == null ? '–' : fmtMoney.format(r.rate) + '%') + '</td>' + ['opening', 'increase', 'decrease', 'closing', 'net'].map(k => '<td class="num">' + amount(r[k]) + '</td>').join('') +
      '<td class="note">' + esc(r.note) + '</td><td class="action-cell"><div class="row-actions"><button type="button" class="action-button" data-edit="' + esc(r.id) + '">' + (data.me.edit ? 'แก้ไข' : 'ดูข้อมูล') + '</button><button type="button" class="action-button sticker-btn" data-sticker="' + esc(r.id) + '">สติกเกอร์</button></div></td></tr>';
  }

  function formValues() {
    const p = { seq: Number($('#seq').value), name: $('#assetName').value.trim(), code: $('#assetCode').value.trim(), received: $('#received').value,
      location: $('#assetLocation').value.trim(), imageUrl: $('#imageUrl').value.trim(), status: $('#assetForm input[name="status"]:checked').value, note: $('#note').value.trim() };
    for (const key of [...moneyKeys, 'rate']) p[key] = $('#' + key).value === '' ? null : Number($('#' + key).value);
    if (pendingImageData) p.imageData = pendingImageData;
    return p;
  }

  function previewImage() {
    if (pendingImageData && pendingImageData.dataUrl) {
      $('#imagePreview').innerHTML = '<img src="' + esc(pendingImageData.dataUrl) + '" alt="ตัวอย่างรูปภาพสินทรัพย์ที่อัปโหลด">';
      return;
    }
    const url = safeUrl($('#imageUrl').value.trim());
    $('#imagePreview').innerHTML = url ? '<img src="' + esc(url) + '" alt="ตัวอย่างรูปภาพสินทรัพย์" referrerpolicy="no-referrer">' : '<span>ตัวอย่างรูปภาพ</span>';
  }

  function openForm(r = null) {
    if (!data || !user) return;
    if (!r && !data.me.edit) return;
    pendingImageData = null;
    if ($('#imageFile')) $('#imageFile').value = '';
    if ($('#uploadStatus')) $('#uploadStatus').textContent = 'วางลิงก์รูปภาพ หรืออัปโหลดไฟล์รูปเพื่อให้ฝังไปกับไฟล์ Excel ได้อัตโนมัติ';
    formState = r ? { id: r.id, version: r.version, requestId: null, row: r } : { id: null, requestId: crypto.randomUUID(), version: null, row: null };
    $('#assetForm').reset(); $('#formError').textContent = '';
    const values = r || { seq: data.nextSeq, status: 'normal' };
    const map = { seq: 'seq', name: 'assetName', code: 'assetCode', received: 'received', location: 'assetLocation', imageUrl: 'imageUrl', note: 'note' };
    Object.entries(map).forEach(([key, id]) => { $('#' + id).value = values[key] == null ? '' : values[key]; });
    for (const key of [...moneyKeys, 'rate']) $('#' + key).value = values[key] == null ? '' : values[key];
    $('#assetForm input[name="status"][value="' + (values.status || 'normal') + '"]').checked = true;
    $('#assetFields').disabled = !data.me.edit; $('#saveAsset').hidden = !data.me.edit; $('#deleteAsset').hidden = !r || !data.me.edit;
    $('#formStickerBtn').hidden = !r;
    $('#formTitle').textContent = r ? (data.me.edit ? 'แก้ไขสินทรัพย์' : 'รายละเอียดสินทรัพย์') : 'เพิ่มสินทรัพย์';
    $('#formMeta').textContent = r ? 'แก้ไขล่าสุด ' + fmtTime.format(new Date(r.updatedTs)) + ' · ' + r.updatedBy : 'ช่องที่เว้นว่างจะแสดงเป็นขีดในตาราง';
    previewImage(); $('#assetDialog').showModal(); $('#assetDialog').scrollTop = 0;
    if (data.me.edit) $('#assetName').focus({ preventScroll: true });
    $('#assetDialog').scrollTop = 0;
  }

  /* ==================== Image File Input in Form ==================== */
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'));
      reader.readAsDataURL(file);
    });
  }

  if ($('#uploadImageBtn') && $('#imageFile')) {
    $('#uploadImageBtn').addEventListener('click', () => $('#imageFile').click());
    $('#imageFile').addEventListener('change', async () => {
      const file = $('#imageFile').files && $('#imageFile').files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { toast('ไฟล์รูปภาพต้องไม่เกิน 8 MB', true); $('#imageFile').value = ''; return; }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/i.exec(dataUrl);
        if (!m) throw new Error('รองรับเฉพาะไฟล์รูปภาพ JPG, PNG, WEBP, GIF');
        pendingImageData = { mime: m[1].toLowerCase(), data: m[2], name: file.name, dataUrl };
        $('#uploadStatus').textContent = 'เลือกรูป "' + file.name + '" แล้ว (จะบันทึกพร้อมรายการสินทรัพย์)';
        previewImage();
      } catch (e) {
        toast(e.message, true);
      }
    });
  }

  /* ==================== XLSX Export with Embedded Images ==================== */
  const XL_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const XL_RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const XL_DNS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
  const XL_ANS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

  function xlEsc(v) {
    return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function xlCol(i) {
    let name = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) name = String.fromCharCode(65 + (i - 1) % 26) + name;
    return name;
  }

  function xlSerial(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    const time = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return new Date(time).toISOString().slice(0, 10) === iso ? time / 86400000 + 25569 : null;
  }

  function b64ToBytes(b64) {
    const clean = String(b64 || '').replace(/\s+/g, '');
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(clean, 'base64'));
    const bin = atob(clean), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64(u8) {
    if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
    let s = '';
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return btoa(s);
  }

  let XL_CRCT = null;
  function xlCrc(u8) {
    if (!XL_CRCT) {
      XL_CRCT = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        XL_CRCT[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) crc = XL_CRCT[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  async function xlDeflate(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter();
      const result = new Response(cs.readable).arrayBuffer();
      await w.write(u8); await w.close();
      return new Uint8Array(await result);
    } catch (_) { return null; }
  }

  async function xlZip(files) {
    const enc = new TextEncoder(), now = new Date();
    const dtime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const ddate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const out = [], cen = [];
    let off = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const raw = f.data instanceof Uint8Array ? f.data : enc.encode(f.data);
      const name = enc.encode(f.name), crc = xlCrc(raw);
      const comp = f.store ? null : await xlDeflate(raw), body = comp || raw, method = comp ? 8 : 0;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
      lh.setUint16(10, dtime, true); lh.setUint16(12, ddate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, method, true); ch.setUint16(12, dtime, true); ch.setUint16(14, ddate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      out.push(new Uint8Array(lh.buffer), name, body);
      cen.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + body.length;
    }
    const csize = cen.reduce((s, p) => s + p.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, off, true);
    const all = out.concat(cen, [new Uint8Array(end.buffer)]), total = all.reduce((s, p) => s + p.length, 0);
    const buf = new Uint8Array(total);
    let pos = 0;
    all.forEach(p => { buf.set(p, pos); pos += p.length; });
    return buf;
  }

  function xlAssetStyles() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="' + XL_NS + '">' +
      '<numFmts count="3">' +
        '<numFmt numFmtId="164" formatCode="#,##0"/>' +
        '<numFmt numFmtId="165" formatCode="#,##0.00;[Red](#,##0.00);0.00"/>' +
        '<numFmt numFmtId="167" formatCode="dd/mm/yyyy"/>' +
      '</numFmts>' +
      '<fonts count="5">' +
        '<font><sz val="10"/><color rgb="FF30253F"/><name val="Sarabun"/></font>' +
        '<font><sz val="15"/><b/><color rgb="FF5A2EA6"/><name val="Sarabun"/></font>' +
        '<font><sz val="9.5"/><color rgb="FF6E627B"/><name val="Sarabun"/></font>' +
        '<font><sz val="10"/><b/><color rgb="FF4B2E78"/><name val="Sarabun"/></font>' +
        '<font><sz val="10"/><b/><color rgb="FF2E1A4D"/><name val="Sarabun"/></font>' +
      '</fonts>' +
      '<fills count="4">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF3EDF9"/><bgColor indexed="64"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF6F1FB"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="3">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left style="thin"><color rgb="FFE2D9EC"/></left><right style="thin"><color rgb="FFE2D9EC"/></right><top style="thin"><color rgb="FFE2D9EC"/></top><bottom style="thin"><color rgb="FFE2D9EC"/></bottom><diagonal/></border>' +
        '<border><left style="thin"><color rgb="FFD4C5E6"/></left><right style="thin"><color rgb="FFD4C5E6"/></right><top style="thin"><color rgb="FF9464D2"/></top><bottom style="double"><color rgb="FF9464D2"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="10">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' + // 0: default
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" horizontal="left"/></xf>' + // 1: title
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" horizontal="left"/></xf>' + // 2: subtitle
        '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>' + // 3: header
        '<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="left" wrapText="1"/></xf>' + // 4: text
        '<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>' + // 5: center text
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="center"/></xf>' + // 6: seq int
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf>' + // 7: money/rate
        '<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="center"/></xf>' + // 8: date
        '<xf numFmtId="165" fontId="4" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf>' + // 9: footer total
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  function mimeToExt(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('jpeg') || m.includes('jpg')) return { ext: 'jpg', mime: 'image/jpeg' };
    if (m.includes('gif')) return { ext: 'gif', mime: 'image/gif' };
    if (m.includes('webp')) return { ext: 'webp', mime: 'image/webp' };
    return { ext: 'png', mime: 'image/png' };
  }

  async function fetchExternalImageAsB64(url) {
    const clean = safeUrl(url);
    if (!clean || typeof fetch !== 'function') return null;
    try {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
      const res = await fetch(clean, { signal: ctl ? ctl.signal : undefined });
      if (timer) clearTimeout(timer);
      if (!res.ok) return null;
      const mime = (res.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase();
      if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(mime)) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (!buf.length || buf.length > 8 * 1024 * 1024) return null;
      return { mime: mime === 'image/jpg' ? 'image/jpeg' : mime, data: bytesToB64(buf) };
    } catch (_) { return null; }
  }

  async function xlsxBuildAssets(payload) {
    payload = payload && typeof payload === 'object' ? payload : {};
    const title = String(payload.title || 'รายการสินทรัพย์ ร้านสหกรณ์มหาวิทยาลัย เชียงใหม่ จำกัด');
    const items = Array.isArray(payload.rows) ? payload.rows : [];
    const imagesMap = (payload.images && typeof payload.images === 'object') ? payload.images : {};

    const sst = Object.create(null), sstList = [];
    let stringCount = 0;
    function strCell(ref, style, value) {
      const text = String(value == null ? '' : value);
      if (!text) return '<c r="' + ref + '" s="' + style + '"/>';
      let key = sst[text];
      if (key === undefined) { key = sstList.length; sst[text] = key; sstList.push(text); }
      stringCount++;
      return '<c r="' + ref + '" s="' + style + '" t="s"><v>' + key + '</v></c>';
    }
    function numCell(ref, style, value) {
      const valid = value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
      return '<c r="' + ref + '" s="' + style + '">' + (valid ? '<v>' + Number(value) + '</v>' : '') + '</c>';
    }
    function fmlCell(ref, style, expr, value) {
      const valid = value !== null && value !== undefined && Number.isFinite(Number(value));
      return '<c r="' + ref + '" s="' + style + '"><f>' + xlEsc(expr) + '</f>' + (valid ? '<v>' + Number(value) + '</v>' : '') + '</c>';
    }

    const rowsXml = [], merges = [];
    function addRow(r, cells, ht) { rowsXml.push('<row r="' + r + '" ht="' + ht + '" customHeight="1">' + cells.join('') + '</row>'); }
    function merged(range, style, text) {
      const parts = range.split(':');
      merges.push(range);
      return strCell(parts[0], style, text);
    }

    addRow(1, [merged('A1:S1', 1, title)], 28);
    addRow(2, [merged('A2:S2', 2, 'จำนวนสินทรัพย์ ' + items.length + ' รายการ · ส่งออกพร้อมรูปภาพฝังในไฟล์ Excel')], 20);

    const h1 = [
      merged('A3:A4', 3, 'ลำดับ'),
      merged('B3:B4', 3, 'รูปภาพ'),
      merged('C3:C4', 3, 'ลิงก์ภาพ'),
      merged('D3:D4', 3, 'รายการ'),
      merged('E3:E4', 3, 'รหัสสินทรัพย์'),
      merged('F3:F4', 3, 'วันที่รับสินทรัพย์'),
      merged('G3:G4', 3, 'สถานที่ตั้งสินทรัพย์'),
      merged('H3:K3', 3, 'สถานะ'),
      merged('L3:L4', 3, 'รวม'),
      merged('M3:M4', 3, 'อัตรา ร้อยละ'),
      merged('N3:N4', 3, 'ยกมา'),
      merged('O3:P3', 3, 'ค่าเสื่อมราคาสะสม'),
      merged('Q3:Q4', 3, 'ยกไป'),
      merged('R3:R4', 3, 'ราคาสินทรัพย์ สุทธิ'),
      merged('S3:S4', 3, 'หมายเหตุ')
    ];
    addRow(3, h1, 24);
    const h2 = [
      strCell('H4', 3, 'ปกติ'),
      strCell('I4', 3, 'ไม่สามารถซ่อมได้'),
      strCell('J4', 3, 'ต้องทำการซ่อม'),
      strCell('K4', 3, 'ลด ระหว่างปี'),
      strCell('O4', 3, 'เพิ่ม ระหว่างปี'),
      strCell('P4', 3, 'ลด ระหว่างปี')
    ];
    addRow(4, h2, 26);

    const mediaFiles = [], drawingRels = [], drawingAnchors = [];
    const mediaByKey = new Map();

    for (let i = 0; i < items.length; i++) {
      const x = items[i], r = i + 5, row0 = i + 4;
      let imgObj = (x.imageData && x.imageData.data) ? x.imageData : null;
      if (!imgObj && x.imageUrl) {
        const fid = extractFid(x.imageUrl);
        if (fid && imagesMap[fid]) imgObj = imagesMap[fid];
        else if (payload.fetchExternal !== false) imgObj = await fetchExternalImageAsB64(x.imageUrl);
      }
      let hasImg = false;
      if (imgObj && imgObj.data) {
        try {
          const bytes = b64ToBytes(imgObj.data);
          if (bytes.length > 0) {
            hasImg = true;
            const info = mimeToExt(imgObj.mime);
            const mKey = info.ext + ':' + imgObj.data.length + ':' + imgObj.data.slice(0, 64) + ':' + imgObj.data.slice(-64);
            let rId = mediaByKey.get(mKey);
            if (!rId) {
              const idx = mediaFiles.length + 1;
              const fileName = 'image' + idx + '.' + info.ext;
              rId = 'rId' + idx;
              mediaByKey.set(mKey, rId);
              mediaFiles.push({ name: 'xl/media/' + fileName, data: bytes, ext: info.ext, mime: info.mime, store: true });
              drawingRels.push('<Relationship Id="' + rId + '" Type="' + XL_RNS + '/image" Target="../media/' + fileName + '"/>');
            }
            const picId = drawingAnchors.length + 1;
            drawingAnchors.push(
              '<xdr:twoCellAnchor editAs="oneCell">' +
                '<xdr:from><xdr:col>1</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>' + row0 + '</xdr:row><xdr:rowOff>38100</xdr:rowOff></xdr:from>' +
                '<xdr:to><xdr:col>2</xdr:col><xdr:colOff>-38100</xdr:colOff><xdr:row>' + (row0 + 1) + '</xdr:row><xdr:rowOff>-38100</xdr:rowOff></xdr:to>' +
                '<xdr:pic>' +
                  '<xdr:nvPicPr><xdr:cNvPr id="' + picId + '" name="Picture ' + picId + '" descr="' + xlEsc(x.name || x.code || '') + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
                  '<xdr:blipFill><a:blip r:embed="' + rId + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
                  '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="647700" cy="571500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
                '</xdr:pic>' +
                '<xdr:clientData/>' +
              '</xdr:twoCellAnchor>'
            );
          }
        } catch (_) {}
      }

      const serial = xlSerial(x.received);
      const cells = [
        numCell('A' + r, 6, x.seq != null ? x.seq : i + 1),
        strCell('B' + r, 5, ''),
        strCell('C' + r, 4, x.imageUrl || ''),
        strCell('D' + r, 4, x.name || ''),
        strCell('E' + r, 5, x.code || ''),
        serial !== null ? numCell('F' + r, 8, serial) : strCell('F' + r, 5, x.received || ''),
        strCell('G' + r, 4, x.location || ''),
        strCell('H' + r, 5, x.status === 'normal' ? '✓' : ''),
        strCell('I' + r, 5, x.status === 'irreparable' ? '✓' : ''),
        strCell('J' + r, 5, x.status === 'repair' ? '✓' : ''),
        strCell('K' + r, 5, x.status === 'reduced' ? '✓' : ''),
        numCell('L' + r, 7, x.total),
        numCell('M' + r, 7, x.rate),
        numCell('N' + r, 7, x.opening),
        numCell('O' + r, 7, x.increase),
        numCell('P' + r, 7, x.decrease),
        numCell('Q' + r, 7, x.closing),
        numCell('R' + r, 7, x.net),
        strCell('S' + r, 4, x.note || '')
      ];
      addRow(r, cells, hasImg ? 58 : 28);
    }

    const lastDataRow = Math.max(5, 4 + items.length);
    if (!items.length) {
      addRow(5, [merged('A5:S5', 5, 'ไม่มีรายการสินทรัพย์')], 28);
    } else {
      const footRow = lastDataRow + 1;
      const sumOf = key => Math.round(items.reduce((acc, it) => acc + (Number(it[key]) || 0), 0) * 100) / 100;
      addRow(footRow, [
        merged('A' + footRow + ':K' + footRow, 3, 'รวมทั้งหมด ' + items.length + ' รายการ'),
        fmlCell('L' + footRow, 9, 'SUM(L5:L' + lastDataRow + ')', sumOf('total')),
        strCell('M' + footRow, 9, ''),
        fmlCell('N' + footRow, 9, 'SUM(N5:N' + lastDataRow + ')', sumOf('opening')),
        fmlCell('O' + footRow, 9, 'SUM(O5:O' + lastDataRow + ')', sumOf('increase')),
        fmlCell('P' + footRow, 9, 'SUM(P5:P' + lastDataRow + ')', sumOf('decrease')),
        fmlCell('Q' + footRow, 9, 'SUM(Q5:Q' + lastDataRow + ')', sumOf('closing')),
        fmlCell('R' + footRow, 9, 'SUM(R5:R' + lastDataRow + ')', sumOf('net')),
        strCell('S' + footRow, 9, '')
      ], 28);
    }

    const widths = [8, 13, 24, 30, 16, 15, 22, 10, 14, 13, 12, 15, 12, 15, 15, 15, 15, 16, 26];
    const hasDrawing = drawingAnchors.length > 0;
    const endRow = items.length ? lastDataRow + 1 : 5;
    const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="' + XL_NS + '" xmlns:r="' + XL_RNS + '">' +
      '<sheetPr><tabColor rgb="FF7040CC"/><pageSetUpPr fitToPage="1"/></sheetPr>' +
      '<dimension ref="A1:S' + endRow + '"/>' +
      '<sheetViews><sheetView workbookViewId="0" showGridLines="1"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="24"/>' +
      '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' +
      '<sheetData>' + rowsXml.join('') + '</sheetData>' +
      '<mergeCells count="' + merges.length + '">' + merges.map(m => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>' +
      '<pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      (hasDrawing ? '<drawing r:id="rId1"/>' : '') +
      '</worksheet>';

    const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const extDefaults = new Set(['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>', '<Default Extension="xml" ContentType="application/xml"/>']);
    mediaFiles.forEach(m => extDefaults.add('<Default Extension="' + m.ext + '" ContentType="' + m.mime + '"/>'));

    const files = [
      { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
      { name: 'xl/styles.xml', data: xlAssetStyles() },
      { name: 'xl/sharedStrings.xml', data: xmlHead + '<sst xmlns="' + XL_NS + '" count="' + stringCount + '" uniqueCount="' + sstList.length + '">' + sstList.map(t => '<si><t xml:space="preserve">' + xlEsc(t) + '</t></si>').join('') + '</sst>' },
      { name: 'xl/workbook.xml', data: xmlHead + '<workbook xmlns="' + XL_NS + '" xmlns:r="' + XL_RNS + '"><bookViews><workbookView/></bookViews><sheets><sheet name="ทะเบียนสินทรัพย์" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: xmlHead + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + XL_RNS + '/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + XL_RNS + '/styles" Target="styles.xml"/><Relationship Id="rId3" Type="' + XL_RNS + '/sharedStrings" Target="sharedStrings.xml"/></Relationships>' },
      { name: '_rels/.rels', data: xmlHead + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + XL_RNS + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      {
        name: '[Content_Types].xml',
        data: xmlHead + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          Array.from(extDefaults).join('') +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
          (hasDrawing ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '') +
          '</Types>'
      }
    ];

    if (hasDrawing) {
      files.push(
        { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: xmlHead + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + XL_RNS + '/drawing" Target="../drawings/drawing1.xml"/></Relationships>' },
        { name: 'xl/drawings/drawing1.xml', data: xmlHead + '<xdr:wsDr xmlns:xdr="' + XL_DNS + '" xmlns:a="' + XL_ANS + '" xmlns:r="' + XL_RNS + '">' + drawingAnchors.join('') + '</xdr:wsDr>' },
        { name: 'xl/drawings/_rels/drawing1.xml.rels', data: xmlHead + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + drawingRels.join('') + '</Relationships>' },
        ...mediaFiles
      );
    }

    return xlZip(files);
  }

  /* ==================== XLSX Import with Embedded Image Extraction ==================== */
  function resolveZipPath(baseFile, target) {
    const t = String(target || '').trim();
    if (!t) return '';
    if (t.startsWith('/')) return t.replace(/^\/+/, '');
    const parts = String(baseFile || '').split('/');
    parts.pop();
    for (const seg of t.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return parts.join('/');
  }

  function detectImageMime(path, u8) {
    if (u8 && u8.length >= 4) {
      if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return 'image/png';
      if (u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) return 'image/jpeg';
      if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38) return 'image/gif';
      if (u8.length >= 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return 'image/webp';
    }
    const ext = (/\.([a-z0-9]+)$/i.exec(String(path || '')) || [])[1] || '';
    if (/^jpe?g$/i.test(ext)) return 'image/jpeg';
    if (/^gif$/i.test(ext)) return 'image/gif';
    if (/^webp$/i.test(ext)) return 'image/webp';
    return 'image/png';
  }

  function zipText(wbFiles, path) {
    const entry = wbFiles && (wbFiles[path] || wbFiles['/' + path]);
    if (!entry || !entry.content) return '';
    const u8 = entry.content instanceof Uint8Array ? entry.content : new Uint8Array(entry.content);
    return new TextDecoder('utf-8').decode(u8);
  }

  function zipBytes(wbFiles, path) {
    const entry = wbFiles && (wbFiles[path] || wbFiles['/' + path]);
    if (!entry || !entry.content) return null;
    return entry.content instanceof Uint8Array ? entry.content : new Uint8Array(entry.content);
  }

  function parseRelsXml(xml, baseFile) {
    const map = Object.create(null);
    for (const m of String(xml || '').matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
      const attrs = m[1];
      const id = (/\bId=["']([^"']+)["']/i.exec(attrs) || [])[1];
      const target = (/\bTarget=["']([^"']+)["']/i.exec(attrs) || [])[1];
      const type = (/\bType=["']([^"']+)["']/i.exec(attrs) || [])[1] || '';
      if (id && target) map[id] = { target: resolveZipPath(baseFile, target), type };
    }
    return map;
  }

  function extractWorkbookImages(wb) {
    const bySheet = Object.create(null);
    const dispImgMap = Object.create(null);
    const wbFiles = wb && wb.files;
    if (!wbFiles) return { bySheet, dispImgMap };

    // 1. Check WPS cellimages.xml if present
    const cellImgXml = zipText(wbFiles, 'xl/cellimages.xml');
    if (cellImgXml) {
      const cellImgRels = parseRelsXml(zipText(wbFiles, 'xl/_rels/cellimages.xml.rels'), 'xl/cellimages.xml');
      for (const m of cellImgXml.matchAll(/<(?:\w+:)?pic\b[\s\S]*?<\/(?:\w+:)?pic>/gi)) {
        const block = m[0];
        const name = (/<(?:\w+:)?cNvPr\b[^>]*\bname=["']([^"']+)["']/i.exec(block) || [])[1];
        const embed = (/<(?:\w+:)?blip\b[^>]*\b(?:\w+:)?embed=["']([^"']+)["']/i.exec(block) || [])[1];
        if (name && embed && cellImgRels[embed]) {
          const u8 = zipBytes(wbFiles, cellImgRels[embed].target);
          if (u8 && u8.length) dispImgMap[name] = { mime: detectImageMime(cellImgRels[embed].target, u8), data: bytesToB64(u8) };
        }
      }
    }

    // 2. Map sheet name -> worksheet XML path
    const wbXml = zipText(wbFiles, 'xl/workbook.xml');
    const wbRels = parseRelsXml(zipText(wbFiles, 'xl/_rels/workbook.xml.rels'), 'xl/workbook.xml');
    const sheetPaths = [];
    for (const m of wbXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/gi)) {
      const attrs = m[1];
      const name = (/\bname=["']([^"']+)["']/i.exec(attrs) || [])[1];
      const rId = (/\b(?:\w+:)?id=["']([^"']+)["']/i.exec(attrs) || [])[1];
      if (name && rId && wbRels[rId]) sheetPaths.push({ name, path: wbRels[rId].target });
    }
    if (!sheetPaths.length && Array.isArray(wb.SheetNames)) {
      wb.SheetNames.forEach((name, idx) => sheetPaths.push({ name, path: 'xl/worksheets/sheet' + (idx + 1) + '.xml' }));
    }

    sheetPaths.forEach(({ name, path }) => {
      const rowMap = Object.create(null);
      bySheet[name] = rowMap;
      const relPath = path.replace(/\/([^/]+)$/, '/_rels/$1.rels');
      const wsRels = parseRelsXml(zipText(wbFiles, relPath), path);
      Object.values(wsRels).forEach(rel => {
        if (!/\/drawing$/i.test(rel.type) && !/drawing/i.test(rel.target)) return;
        const drwPath = rel.target;
        const drwXml = zipText(wbFiles, drwPath);
        if (!drwXml) return;
        const drwRelPath = drwPath.replace(/\/([^/]+)$/, '/_rels/$1.rels');
        const drwRels = parseRelsXml(zipText(wbFiles, drwRelPath), drwPath);
        for (const m of drwXml.matchAll(/<(?:\w+:)?(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/(?:\w+:)?(?:twoCellAnchor|oneCellAnchor)>/gi)) {
          const anchor = m[0];
          const fromBlock = (/<(?:\w+:)?from\b[\s\S]*?<\/(?:\w+:)?from>/i.exec(anchor) || [])[0] || '';
          const rowMatch = /<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/i.exec(fromBlock);
          const embedMatch = /<(?:\w+:)?blip\b[^>]*\b(?:\w+:)?embed=["']([^"']+)["']/i.exec(anchor);
          if (!rowMatch || !embedMatch) continue;
          const row0 = Number(rowMatch[1]);
          const mediaRel = drwRels[embedMatch[1]];
          if (!mediaRel) continue;
          const u8 = zipBytes(wbFiles, mediaRel.target);
          if (!u8 || !u8.length) continue;
          rowMap[row0] = { mime: detectImageMime(mediaRel.target, u8), data: bytesToB64(u8) };
        }
      });
    });

    return { bySheet, dispImgMap };
  }

  const THAI_MONTHS = {
    'ม.ค.': '01', 'มกราคม': '01', 'ก.พ.': '02', 'กุมภาพันธ์': '02', 'มี.ค.': '03', 'มีนาคม': '03',
    'เม.ย.': '04', 'เมษายน': '04', 'พ.ค.': '05', 'พฤษภาคม': '05', 'มิ.ย.': '06', 'มิถุนายน': '06',
    'ก.ค.': '07', 'กรกฎาคม': '07', 'ส.ค.': '08', 'สิงหาคม': '08', 'ก.ย.': '09', 'กันยายน': '09',
    'ต.ค.': '10', 'ตุลาคม': '10', 'พ.ย.': '11', 'พฤศจิกายน': '11', 'ธ.ค.': '12', 'ธันวาคม': '12'
  };

  function parseAssetDateCell(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v) && v > 1000 && v < 200000) {
      const ms = Math.round((v - 25569) * 86400000);
      const d = new Date(ms);
      if (Number.isFinite(d.getTime())) {
        let yr = d.getUTCFullYear();
        if (yr >= 2400) yr -= 543;
        return String(yr).padStart(4, '0') + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
      }
    }
    const s = String(v).trim();
    if (!s || s === '–' || s === '-') return '';
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) {
      let yr = Number(m[1]);
      if (yr >= 2400) yr -= 543;
      return String(yr).padStart(4, '0') + '-' + String(Number(m[2])).padStart(2, '0') + '-' + String(Number(m[3])).padStart(2, '0');
    }
    m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
    if (m) {
      let yr = Number(m[3]);
      if (yr >= 2400) yr -= 543;
      return String(yr).padStart(4, '0') + '-' + String(Number(m[2])).padStart(2, '0') + '-' + String(Number(m[1])).padStart(2, '0');
    }
    for (const [thName, mm] of Object.entries(THAI_MONTHS)) {
      if (s.includes(thName)) {
        const nums = s.match(/\d+/g);
        if (nums && nums.length >= 2) {
          const dd = Number(nums[0]);
          let yr = Number(nums[nums.length - 1]);
          if (yr < 100) yr += 2500;
          if (yr >= 2400) yr -= 543;
          return String(yr).padStart(4, '0') + '-' + mm + '-' + String(dd).padStart(2, '0');
        }
      }
    }
    return '';
  }

  function parseAssetNumCell(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
    const s = String(v).replace(/[,%\s฿บาท]/g, '').trim();
    if (!s || s === '–' || s === '-') return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function isCheckedCell(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '✓' || s === '✔' || s === 'true' || s === '1' || s === 'x' || s === 'yes' || s === 'ใช่' || s === 'ปกติ';
  }

  function parseStatusText(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (/ไม่สามารถซ่อมได้|ซ่อมไม่ได้|irreparable/i.test(s)) return 'irreparable';
    if (/ต้องทำการซ่อม|ต้องซ่อม|ส่งซ่อม|repair/i.test(s)) return 'repair';
    if (/ลด\s*ระหว่างปี|ตัดจำหน่าย|reduced/i.test(s)) return 'reduced';
    if (/ปกติ|normal/i.test(s)) return 'normal';
    return '';
  }

  function parseAssetsWorkbook(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const wb = XLSX.read(u8, { type: 'array', bookFiles: true });
    const { bySheet, dispImgMap } = extractWorkbookImages(wb);
    const items = [];
    let sheetTitle = '';
    let imageCount = 0;

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      const rowImages = bySheet[sheetName] || Object.create(null);
      if (!grid || !grid.length) continue;

      let hRow = -1, cols = null, dataStart = -1;
      for (let r = 0; r < Math.min(grid.length, 15); r++) {
        const row = grid[r] || [];
        const nextRow = grid[r + 1] || [];
        const cMap = {};
        let hasSubRow = false;

        row.forEach((cell, c) => {
          const t = String(cell == null ? '' : cell).replace(/\s+/g, ' ').trim();
          if (!t) return;
          if (cMap.seq === undefined && /^(?:ลำดับ|no\.?)$/i.test(t)) cMap.seq = c;
          else if (cMap.photo === undefined && /^(?:รูปภาพ|รูป|ภาพ|photo|image)$/i.test(t)) cMap.photo = c;
          else if (cMap.imageUrl === undefined && /ลิงก์ภาพ|ลิงก์รูป|image\s*url|url\s*ภาพ/i.test(t)) cMap.imageUrl = c;
          else if (cMap.name === undefined && /^(?:รายการ|ชื่อรายการ|ชื่อสินทรัพย์|สินทรัพย์|asset\s*name)$/i.test(t)) cMap.name = c;
          else if (cMap.code === undefined && /(?:รหัสสินทรัพย์|^รหัส$|asset\s*code|^code$)/i.test(t)) cMap.code = c;
          else if (cMap.received === undefined && /(?:วันที่รับ|วันเดือนปีที่รับ|วันที่ได้มา|received)/i.test(t)) cMap.received = c;
          else if (cMap.location === undefined && /(?:สถานที่ตั้ง|สถานที่|ที่ตั้ง|location)/i.test(t)) cMap.location = c;
          else if (cMap.statusGroup === undefined && /^(?:สถานะ|status)$/i.test(t)) cMap.statusGroup = c;
          else if (cMap.total === undefined && /^(?:รวม|ต้นทุนรวม|ราคาทุน|มูลค่ารวม|total)$/i.test(t)) cMap.total = c;
          else if (cMap.rate === undefined && /(?:อัตรา|ร้อยละ|rate)/i.test(t)) cMap.rate = c;
          else if (cMap.opening === undefined && /^(?:ยกมา|opening)$/i.test(t)) cMap.opening = c;
          else if (cMap.deprGroup === undefined && /ค่าเสื่อมราคาสะสม/i.test(t)) cMap.deprGroup = c;
          else if (cMap.increase === undefined && /เพิ่ม\s*ระหว่างปี/i.test(t)) cMap.increase = c;
          else if (cMap.closing === undefined && /^(?:ยกไป|closing)$/i.test(t)) cMap.closing = c;
          else if (cMap.net === undefined && /(?:ราคาสินทรัพย์\s*สุทธิ|^สุทธิ$|net)/i.test(t)) cMap.net = c;
          else if (cMap.note === undefined && /^(?:หมายเหตุ|บันทึก|note|remark)$/i.test(t)) cMap.note = c;
        });

        if (cMap.name !== undefined && (cMap.code !== undefined || cMap.seq !== undefined || cMap.total !== undefined)) {
          nextRow.forEach((cell, c) => {
            const t = String(cell == null ? '' : cell).replace(/\s+/g, ' ').trim();
            if (!t) return;
            if (/^ปกติ$/i.test(t)) { cMap.stNormal = c; hasSubRow = true; }
            else if (/ไม่สามารถซ่อมได้/i.test(t)) { cMap.stIrreparable = c; hasSubRow = true; }
            else if (/ต้องทำการซ่อม/i.test(t)) { cMap.stRepair = c; hasSubRow = true; }
            else if (/เพิ่ม\s*ระหว่างปี/i.test(t)) { cMap.increase = c; hasSubRow = true; }
            else if (/ลด\s*ระหว่างปี/i.test(t)) {
              hasSubRow = true;
              if (cMap.total !== undefined && c < cMap.total) cMap.stReduced = c;
              else if (cMap.opening !== undefined && c > cMap.opening) cMap.decrease = c;
              else if (cMap.stReduced === undefined) cMap.stReduced = c;
              else cMap.decrease = c;
            }
          });
          hRow = r;
          cols = cMap;
          dataStart = hasSubRow ? r + 2 : r + 1;
          if (r > 0 && !sheetTitle) {
            const topText = String((grid[0] && grid[0][0]) || '').trim();
            if (topText && topText.length <= 200) sheetTitle = topText;
          }
          break;
        }
      }

      if (!cols) continue;

      for (let r = dataStart; r < grid.length; r++) {
        const row = grid[r] || [];
        const name = String(row[cols.name] == null ? '' : row[cols.name]).trim();
        const firstCell = String(row[0] == null ? '' : row[0]).trim();
        if (!name || /^รวม(?:ทั้งหมด|ตามตัวกรอง)/i.test(firstCell) || /^รวม(?:ทั้งหมด|ตามตัวกรอง)/i.test(name)) continue;

        let status = 'normal';
        if (cols.stNormal !== undefined || cols.stIrreparable !== undefined || cols.stRepair !== undefined || cols.stReduced !== undefined) {
          if (cols.stIrreparable !== undefined && isCheckedCell(row[cols.stIrreparable])) status = 'irreparable';
          else if (cols.stRepair !== undefined && isCheckedCell(row[cols.stRepair])) status = 'repair';
          else if (cols.stReduced !== undefined && isCheckedCell(row[cols.stReduced])) status = 'reduced';
          else if (cols.stNormal !== undefined && isCheckedCell(row[cols.stNormal])) status = 'normal';
          else if (cols.statusGroup !== undefined) status = parseStatusText(row[cols.statusGroup]) || 'normal';
        } else if (cols.statusGroup !== undefined) {
          status = parseStatusText(row[cols.statusGroup]) || 'normal';
        }

        let imgData = rowImages[r] || null;
        if (!imgData && cols.photo !== undefined) {
          const photoCell = String(row[cols.photo] || '');
          const dispMatch = /DISPIMG\(\s*["']([^"']+)["']/i.exec(photoCell);
          if (dispMatch && dispImgMap[dispMatch[1]]) imgData = dispImgMap[dispMatch[1]];
        }
        if (imgData) imageCount++;

        const seqNum = cols.seq !== undefined ? parseAssetNumCell(row[cols.seq]) : null;
        const item = {
          seq: seqNum !== null && Number.isInteger(seqNum) && seqNum > 0 ? seqNum : null,
          name,
          code: cols.code !== undefined ? String(row[cols.code] == null ? '' : row[cols.code]).trim() : '',
          received: cols.received !== undefined ? parseAssetDateCell(row[cols.received]) : '',
          location: cols.location !== undefined ? String(row[cols.location] == null ? '' : row[cols.location]).trim() : '',
          status,
          imageUrl: cols.imageUrl !== undefined ? safeUrl(String(row[cols.imageUrl] == null ? '' : row[cols.imageUrl]).trim()) : '',
          total: cols.total !== undefined ? parseAssetNumCell(row[cols.total]) : null,
          rate: cols.rate !== undefined ? parseAssetNumCell(row[cols.rate]) : null,
          opening: cols.opening !== undefined ? parseAssetNumCell(row[cols.opening]) : null,
          increase: cols.increase !== undefined ? parseAssetNumCell(row[cols.increase]) : null,
          decrease: cols.decrease !== undefined ? parseAssetNumCell(row[cols.decrease]) : null,
          closing: cols.closing !== undefined ? parseAssetNumCell(row[cols.closing]) : null,
          net: cols.net !== undefined ? parseAssetNumCell(row[cols.net]) : null,
          note: cols.note !== undefined ? String(row[cols.note] == null ? '' : row[cols.note]).trim() : ''
        };
        if (imgData) item.imageData = imgData;
        items.push(item);
      }
    }

    if (!items.length) throw new Error('ไม่พบรายการสินทรัพย์ในไฟล์ Excel (ตรวจสอบว่ามีหัวตาราง "รายการ" และข้อมูลสินทรัพย์)');
    return { title: sheetTitle, items, imageCount };
  }

  /* ==================== Export & Import UI Handlers ==================== */
  if ($('#exportExcelBtn')) {
    $('#exportExcelBtn').addEventListener('click', async () => {
      if (!token || !user) return;
      const btn = $('#exportExcelBtn');
      btn.disabled = true;
      const origText = btn.textContent;
      btn.textContent = 'กำลังเตรียมไฟล์ Excel…';
      try {
        const expData = await call('assetsExport', { q: $('#search').value.trim(), status: $('#statusFilter').value, location: $('#locationFilter').value });
        const xlsxBytes = await xlsxBuildAssets(expData);
        const blob = new Blob([xlsxBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
        a.href = url;
        a.download = 'ทะเบียนสินทรัพย์-' + today + '.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        toast('ส่งออกไฟล์ Excel พร้อมรูปภาพเรียบร้อย (' + fmtInt.format(expData.rows.length) + ' รายการ)');
      } catch (e) {
        toast('ส่งออก Excel ไม่สำเร็จ: ' + e.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
  }

  if ($('#importExcelBtn')) {
    $('#importExcelBtn').addEventListener('click', () => {
      if (!data || !data.me.edit) return;
      parsedImportItems = null;
      $('#importForm').reset();
      $('#importError').textContent = '';
      $('#importPreviewInfo').textContent = 'กรุณาเลือกไฟล์ Excel ที่ส่งอกจากระบบ หรือไฟล์ทะเบียนสินทรัพย์ที่มีคอลัมน์รายการและรูปภาพฝังในตาราง';
      $('#confirmImportBtn').disabled = true;
      $('#importDialog').showModal();
    });
  }

  if ($('#importFile')) {
    $('#importFile').addEventListener('change', async () => {
      const file = $('#importFile').files && $('#importFile').files[0];
      parsedImportItems = null;
      $('#importError').textContent = '';
      $('#confirmImportBtn').disabled = true;
      if (!file) return;
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const parsed = parseAssetsWorkbook(buf);
        parsedImportItems = parsed;
        $('#importPreviewInfo').textContent = 'อ่านไฟล์ "' + file.name + '" สำเร็จ · พบสินทรัพย์ ' + fmtInt.format(parsed.items.length) + ' รายการ และรูปภาพฝังในไฟล์ ' + fmtInt.format(parsed.imageCount) + ' รูป';
        $('#confirmImportBtn').disabled = false;
      } catch (e) {
        $('#importError').textContent = e.message;
      }
    });
  }

  if ($('#importForm')) {
    $('#importForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (saving || !parsedImportItems || !data || !data.me.edit) return;
      saving = true;
      $('#confirmImportBtn').disabled = true;
      $('#importError').textContent = '';
      try {
        const mode = $('#importMode').value;
        const res = await call('assetsImport', { mode, items: parsedImportItems.items, title: parsedImportItems.title });
        $('#importDialog').close();
        parsedImportItems = null;
        page = 1;
        toast('นำเข้า Excel สำเร็จ ' + fmtInt.format(res.count) + ' รายการ (เพิ่ม ' + fmtInt.format(res.created) + ' · อัปเดต ' + fmtInt.format(res.updated) + ')');
        await load();
      } catch (err) {
        $('#importError').textContent = err.message;
        $('#confirmImportBtn').disabled = false;
      } finally {
        saving = false;
      }
    });
  }

  /* ==================== Sticker Printing ("สติกเกอร์") ==================== */
  function stickerCardHtml(r, opts = {}) {
    const dateFmt = opts.dateFormat || ($('#stickerDateFormat') ? $('#stickerDateFormat').value : 'slash');
    const showName = opts.showName !== undefined ? opts.showName : (!$('#stickerShowName') || $('#stickerShowName').checked);
    const showLoc = opts.showLocation !== undefined ? opts.showLocation : (!$('#stickerShowLocation') || $('#stickerShowLocation').checked);
    const qrLink = assetQrLink(r);
    const qrSvg = buildStickerQrSvg(qrLink);
    const codeText = r.code || ('SEQ-' + r.seq);
    const recText = formatStickerDate(r.received, dateFmt);
    return '<article class="asset-sticker" data-sticker-code="' + esc(codeText) + '">' +
      '<header class="asset-sticker-head">' +
        '<img class="asset-sticker-logo" src="assets/images/logo.png" alt="โลโก้ CMUCOOP">' +
        '<div class="asset-sticker-org"><strong>CMUCOOP · ทะเบียนสินทรัพย์</strong><small>ร้านสหกรณ์มหาวิทยาลัยเชียงใหม่ จำกัด</small></div>' +
      '</header>' +
      '<div class="asset-sticker-body">' +
        '<div class="asset-sticker-meta">' +
          '<div class="asset-sticker-field code-field"><span>รหัสสินทรัพย์</span><strong>' + esc(codeText) + '</strong></div>' +
          '<div class="asset-sticker-field"><span>วันเดือนปีที่รับสินทรัพย์</span><strong>' + esc(recText) + '</strong></div>' +
          (showName ? '<div class="asset-sticker-name">' + esc(r.name || '') + '</div>' : '') +
          (showLoc && r.location ? '<div class="asset-sticker-loc">สถานที่: ' + esc(r.location) + '</div>' : '') +
        '</div>' +
        '<div class="asset-sticker-qr">' + qrSvg + '<small>สแกนดูรายการ</small></div>' +
      '</div>' +
    '</article>';
  }

  function activeStickerItems() {
    const scope = $('#stickerScope') ? $('#stickerScope').value : 'selected';
    if (scope === 'page') return data && Array.isArray(data.rows) ? data.rows : [];
    if (scope === 'all') return stickerPool;
    return stickerPool.filter(r => selectedStickerIds.has(r.id));
  }

  function renderStickerSelector() {
    const listEl = $('#stickerList');
    if (!listEl) return;
    const q = ($('#stickerSearch') ? $('#stickerSearch').value : '').trim().toLowerCase();
    const filtered = stickerPool.filter(r => !q || (String(r.name || '') + ' ' + String(r.code || '') + ' ' + String(r.location || '')).toLowerCase().includes(q));
    listEl.innerHTML = filtered.length
      ? filtered.map(r => '<label class="sticker-check-item"><input type="checkbox" data-sticker-check="' + esc(r.id) + '"' + (selectedStickerIds.has(r.id) ? ' checked' : '') + '><span>' + fmtInt.format(r.seq) + '. ' + esc(r.name) + '</span><small>' + esc(r.code || '–') + '</small></label>').join('')
      : '<p class="helper">ไม่พบรายการที่ค้นหา</p>';
    $('#stickerCountInfo').textContent = 'เลือกไว้ ' + fmtInt.format(selectedStickerIds.size) + ' จาก ' + fmtInt.format(stickerPool.length) + ' รายการ';
  }

  function renderStickerPreview() {
    const previewEl = $('#stickerPreview');
    if (!previewEl) return;
    const scope = $('#stickerScope').value;
    if ($('#stickerSelectorPane')) $('#stickerSelectorPane').style.opacity = scope === 'selected' ? '1' : '0.65';
    const chosen = activeStickerItems();
    const copies = Math.min(20, Math.max(1, Math.floor(Number($('#stickerCopies').value) || 1)));
    const totalStickers = chosen.length * copies;
    $('#stickerSummaryText').textContent = fmtInt.format(chosen.length) + ' รายการ × ' + copies + ' ดวง = รวม ' + fmtInt.format(totalStickers) + ' ดวง';
    $('#stickerError').textContent = '';
    if (!chosen.length) {
      previewEl.innerHTML = '<p class="helper">กรุณาเลือกรายการสินทรัพย์อย่างน้อย 1 รายการเพื่อดูตัวอย่างสติกเกอร์</p>';
      return;
    }
    const sample = chosen.slice(0, 12);
    previewEl.innerHTML = sample.map(r => stickerCardHtml(r)).join('');
  }

  async function openStickerDialog(preselectRows = null) {
    if (!data || !user) return;
    $('#stickerError').textContent = '';
    stickerPool = Array.isArray(data.rows) ? data.rows.slice() : [];
    if (preselectRows && preselectRows.length) {
      preselectRows.forEach(r => { if (r && !stickerPool.some(x => x.id === r.id)) stickerPool.unshift(r); });
      selectedStickerIds = new Set(preselectRows.map(r => r.id));
      $('#stickerScope').value = 'selected';
    } else if (!selectedStickerIds.size) {
      selectedStickerIds = new Set(stickerPool.map(r => r.id));
      $('#stickerScope').value = 'selected';
    }
    renderStickerSelector();
    renderStickerPreview();
    $('#stickerDialog').showModal();
    if (data.total > stickerPool.length) {
      try {
        const full = await call('assetsExport', { q: $('#search').value.trim(), status: $('#statusFilter').value, location: $('#locationFilter').value });
        if (full && Array.isArray(full.rows)) {
          stickerPool = full.rows;
          if (!preselectRows) selectedStickerIds = new Set(stickerPool.map(r => r.id));
          renderStickerSelector();
          renderStickerPreview();
        }
      } catch (_) {}
    }
  }

  function printSelectedStickers() {
    const chosen = activeStickerItems();
    if (!chosen.length) {
      $('#stickerError').textContent = 'กรุณาเลือกรายการสินทรัพย์ที่ต้องการพิมพ์อย่างน้อย 1 รายการ';
      return;
    }
    const copies = Math.min(20, Math.max(1, Math.floor(Number($('#stickerCopies').value) || 1)));
    const layout = $('#stickerLayout').value || 'a4-2x5';
    const cards = [];
    chosen.forEach(r => {
      for (let c = 0; c < copies; c++) cards.push(stickerCardHtml(r));
    });
    const printArea = $('#stickerPrintArea');
    printArea.innerHTML = '<div class="print-sticker-grid layout-' + esc(layout) + '">' + cards.join('') + '</div>';
    window.print();
  }

  if ($('#printStickersBtn')) $('#printStickersBtn').addEventListener('click', () => openStickerDialog());
  if ($('#formStickerBtn')) {
    $('#formStickerBtn').addEventListener('click', () => {
      if (!formState || !formState.row) return;
      $('#assetDialog').close();
      openStickerDialog([formState.row]);
    });
  }
  if ($('#stickerScope')) {
    ['stickerScope', 'stickerLayout', 'stickerCopies', 'stickerDateFormat', 'stickerShowName', 'stickerShowLocation'].forEach(id => {
      const el = $('#' + id);
      if (el) el.addEventListener('change', renderStickerPreview);
    });
  }
  if ($('#stickerSearch')) $('#stickerSearch').addEventListener('input', renderStickerSelector);
  if ($('#stickerSelectAll')) {
    $('#stickerSelectAll').addEventListener('click', () => {
      stickerPool.forEach(r => selectedStickerIds.add(r.id));
      $('#stickerScope').value = 'selected';
      renderStickerSelector();
      renderStickerPreview();
    });
  }
  if ($('#stickerClearAll')) {
    $('#stickerClearAll').addEventListener('click', () => {
      selectedStickerIds.clear();
      $('#stickerScope').value = 'selected';
      renderStickerSelector();
      renderStickerPreview();
    });
  }
  if ($('#stickerList')) {
    $('#stickerList').addEventListener('change', e => {
      const cb = e.target.closest('[data-sticker-check]');
      if (!cb) return;
      if (cb.checked) selectedStickerIds.add(cb.dataset.stickerCheck);
      else selectedStickerIds.delete(cb.dataset.stickerCheck);
      $('#stickerScope').value = 'selected';
      $('#stickerCountInfo').textContent = 'เลือกไว้ ' + fmtInt.format(selectedStickerIds.size) + ' จาก ' + fmtInt.format(stickerPool.length) + ' รายการ';
      renderStickerPreview();
    });
  }
  if ($('#printStickersConfirm')) $('#printStickersConfirm').addEventListener('click', printSelectedStickers);

  /* ==================== QR Spotlight Action Buttons ==================== */
  if ($('#qrAssetOpenBtn')) {
    $('#qrAssetOpenBtn').addEventListener('click', () => { if (qrTargetRow && user) openForm(qrTargetRow); });
  }
  if ($('#qrAssetStickerBtn')) {
    $('#qrAssetStickerBtn').addEventListener('click', () => { if (qrTargetRow && user) openStickerDialog([qrTargetRow]); });
  }
  if ($('#qrAssetClearBtn')) {
    $('#qrAssetClearBtn').addEventListener('click', () => {
      qrRefCode = ''; qrTargetRow = null;
      $('#qrAssetCard').hidden = true;
      try { history.replaceState(null, '', location.pathname); } catch (_) {}
      if (user && $('#search').value) { $('#search').value = ''; page = 1; load(); }
    });
  }

  /* ==================== Existing Form & Table Events ==================== */
  $('#assetForm').addEventListener('submit', async e => {
    e.preventDefault(); if (saving || !formState || !data.me.edit) return;
    saving = true; $('#saveAsset').disabled = true; $('#formError').textContent = '';
    const state = formState;
    try {
      const payload = state.pending || formValues();
      if (state.id) await call('assetsUpdate', state.id, state.version, payload);
      else { payload.requestId = state.requestId; state.pending = payload; await call('assetsCreate', payload); }
      $('#assetDialog').close(); formState = null; pendingImageData = null; toast('บันทึกรายการสินทรัพย์แล้ว'); await load();
      if (qrRefCode) await loadQrReference();
    } catch (error) {
      if (error.message !== 'SESSION_CHANGED' && formState === state) {
        $('#formError').textContent = error.message;
        const uncertain = /เชื่อมต่อ|เกิน 90|JSON|เซิร์ฟเวอร์ตอบกลับผิดปกติ/.test(error.message);
        if (!state.id && state.pending && uncertain) {
          $('#assetFields').disabled = true; $('#formError').textContent += ' · ผลบันทึกอาจสำเร็จแล้ว กดบันทึกข้อมูลอีกครั้งเพื่อตรวจผลคำขอเดิม';
        } else { delete state.pending; $('#assetFields').disabled = !data.me.edit; }
      }
    } finally { saving = false; $('#saveAsset').disabled = false; }
  });
  $('#deleteAsset').addEventListener('click', async () => {
    if (saving || !formState || !formState.id || !data.me.edit) return;
    if (!confirm('ลบรายการสินทรัพย์ "' + $('#assetName').value + '" ?\nการลบรายการนี้ย้อนกลับไม่ได้')) return;
    saving = true; $('#deleteAsset').disabled = true;
    try { await call('assetsDelete', formState.id, formState.version); $('#assetDialog').close(); formState = null; toast('ลบรายการสินทรัพย์แล้ว'); await load(); }
    catch (e) { $('#formError').textContent = e.message; }
    finally { saving = false; $('#deleteAsset').disabled = false; }
  });
  $('#editTitle').addEventListener('click', () => {
    if (!data || !data.me.edit) return;
    titleRevision = data.revision; $('#titleInput').value = data.title; $('#titleError').textContent = ''; $('#titleDialog').showModal(); $('#titleInput').focus();
  });
  $('#titleForm').addEventListener('submit', async e => {
    e.preventDefault(); if (saving || !data.me.edit) return;
    saving = true; $('#saveTitle').disabled = true;
    try { await call('assetsSetTitle', $('#titleInput').value.trim(), titleRevision); $('#titleDialog').close(); toast('บันทึกชื่อตารางแล้ว'); await load(); }
    catch (error) { $('#titleError').textContent = error.message; }
    finally { saving = false; $('#saveTitle').disabled = false; }
  });
  document.addEventListener('click', async e => {
    const close = e.target.closest('[data-close]'); if (close) { if (!saving) $('#' + close.dataset.close).close(); return; }
    const add = e.target.closest('[data-new]'); if (add) { openForm(); return; }
    const stickerBtn = e.target.closest('[data-sticker]');
    if (stickerBtn && data) {
      const row = data.rows.find(r => r.id === stickerBtn.dataset.sticker);
      if (row) openStickerDialog([row]);
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      edit.disabled = true;
      try { const row = await call('assetsGet', edit.dataset.edit); openForm(row); }
      catch (error) { toast(error.message, true); }
      finally { edit.disabled = false; }
    }
    const photo = e.target.closest('[data-image]');
    if (photo && data) {
      const row = data.rows.find(r => r.id === photo.dataset.image); if (!row) return;
      const url = safeUrl(row.imageUrl); if (!url) return;
      $('#imageHeading').textContent = row.name; $('#largeImage').innerHTML = '<img src="' + esc(url) + '" alt="' + esc(row.name) + '" referrerpolicy="no-referrer">'; $('#imageDialog').showModal();
    }
  });
  document.addEventListener('error', e => {
    if (e.target.tagName !== 'IMG' || e.target.closest('.brand') || e.target.closest('.asset-sticker-head') || e.target.closest('.qr-spotlight-brand')) return;
    const text = document.createElement('span'); text.className = 'photo-empty'; text.textContent = 'โหลดภาพไม่ได้'; e.target.replaceWith(text);
  }, true);
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('cancel', e => { if (saving) e.preventDefault(); }));
  $('#imageUrl').addEventListener('input', () => { pendingImageData = null; clearTimeout(imageTimer); imageTimer = setTimeout(previewImage, 400); });
  $('#addAsset').addEventListener('click', () => openForm());
  $('#refresh').addEventListener('click', load);
  $('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 1; load(); }, 250); });
  ['statusFilter', 'locationFilter', 'pageSize'].forEach(id => $('#' + id).addEventListener('change', () => { page = 1; load(); }));
  $('#stats').addEventListener('click', e => { const stat = e.target.closest('[data-status]'); if (stat) { $('#statusFilter').value = stat.dataset.status; page = 1; load(); } });
  $('#clearFilters').addEventListener('click', () => { $('#search').value = ''; $('#statusFilter').value = ''; $('#locationFilter').value = ''; page = 1; load(); });
  $('#prev').addEventListener('click', () => { page--; load(); }); $('#next').addEventListener('click', () => { page++; load(); });
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#loginButton').disabled = true; $('#loginError').textContent = '';
    try { const me = await call('login', $('#username').value.trim(), $('#password').value); token = me.token; await startApp(); }
    catch (error) { $('#loginError').textContent = error.message; }
    finally { $('#password').value = ''; $('#loginButton').disabled = false; }
  });
  $('#logout').addEventListener('click', async () => { try { await call('logout'); } catch (_) {} showLogin(); });

  // Expose helpers for testing & inspection
  if (typeof window !== 'undefined') {
    Object.assign(window, { xlsxBuildAssets, parseAssetsWorkbook, buildStickerQrSvg, stickerCardHtml, formatStickerDate, assetQrLink });
  }

  try {
    const params = new URLSearchParams(location.search);
    qrRefCode = (params.get('code') || params.get('asset') || params.get('id') || '').trim();
    const match = location.hash.match(/(?:^#|&)t=([^&]+)/);
    token = match ? decodeURIComponent(match[1]) : sessionStorage.getItem('pm_tok') || '';
    if (match) history.replaceState(null, '', location.pathname + location.search);
  } catch (_) {}
  if (token) startApp().catch(e => showLogin(e.message));
  else if (qrRefCode) loadQrReference();
})();
