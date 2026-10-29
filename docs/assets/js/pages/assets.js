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
  const rowSaveTimers = new Map();
  let lastNormalClick = { key: '', ts: 0, from: '' };

  const amount = value => value == null ? '<span class="muted">–</span>' : fmtMoney.format(value);
  const date = value => value ? fmtDate.format(new Date(value + 'T00:00:00Z')) : '–';

  function getNormalMark(r) {
    if (!r) return 'check';
    if (r.normalMark === 'check' || r.normalMark === 'cross' || r.normalMark === 'none') return r.normalMark;
    return r.status === 'normal' ? 'check' : 'none';
  }

  function nextNormalMark(clickKey, curMark) {
    const now = Date.now();
    const cur = (curMark === 'check' || curMark === 'cross' || curMark === 'none') ? curMark : 'none';
    const sameTarget = lastNormalClick.key === clickKey;
    const elapsed = sameTarget ? (now - lastNormalClick.ts) : Infinity;

    let next;
    if (cur === 'none') {
      next = 'check';
    } else if (cur === 'check') {
      next = 'cross';
    } else {
      // If user double-clicked on a cell that was already 'check', 1st click set 'cross' < 350ms ago; keep 'cross' on 2nd click
      if (elapsed < 350 && lastNormalClick.from === 'check') {
        next = 'cross';
        lastNormalClick = { key: clickKey, ts: now, from: 'cross' };
        return next;
      }
      next = 'none';
    }
    lastNormalClick = { key: clickKey, ts: now, from: cur };
    return next;
  }

  function updateFormNormalUI(mark) {
    const m = (mark === 'check' || mark === 'cross' || mark === 'none') ? mark : 'check';
    const inp = $('#normalMarkInput');
    if (inp) inp.value = m;
    const btn = $('#formNormalBtn'), box = $('#formNormalBox'), txt = $('#formNormalText');
    if (btn) {
      btn.dataset.mark = m;
      btn.className = 'normal-state-btn state-' + m;
    }
    if (box) {
      box.className = 'status-box state-' + m;
      box.textContent = m === 'check' ? '✓' : m === 'cross' ? '✕' : '';
    }
    if (txt) {
      txt.textContent = m === 'check' ? 'ปกติ (✓ ติ๊กถูก)' : m === 'cross' ? 'ปกติ (✕ กากบาท)' : 'ปกติ (ว่าง)';
    }
  }

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
    const nMark = getNormalMark(row);
    if (row.status === 'normal' && nMark === 'cross') {
      stEl.textContent = 'ปกติ: ✕ กากบาท';
      stEl.className = 'status-pill cross';
    } else {
      stEl.textContent = statuses[row.status] || row.status || '–';
      stEl.className = 'status-pill ' + (row.status || 'normal');
    }
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
    const nMark = getNormalMark(r);
    const nSym = nMark === 'check' ? '✓' : nMark === 'cross' ? '✕' : '';
    const canEdit = !!(data && data.me && data.me.edit);
    const normalCell = '<td class="status-cell"><button type="button" class="status-box normal-toggle state-' + nMark + '" data-normal-toggle="' + esc(r.id) + '"' + (canEdit ? '' : ' disabled') + ' aria-label="ปกติ: ' + esc(r.name) + '" title="ช่องปกติ: กด 1 ครั้ง = ✓ ติ๊กถูก · กด 2 ครั้ง = ✕ กากบาท">' + nSym + '</button></td>';
    const otherStatusCells = ['irreparable', 'repair', 'reduced'].map(key => {
      const label = statuses[key];
      const checked = r.status === key;
      return '<td class="status-cell"><button type="button" class="status-box substatus-toggle ' + (checked ? 'state-check' : 'state-none') + '" data-status-toggle="' + esc(r.id) + '" data-status-key="' + key + '"' + (canEdit ? '' : ' disabled') + ' aria-label="' + esc(label + ': ' + r.name) + '" title="คลิกเพื่อตั้งค่า ' + esc(label) + '">' + (checked ? '✓' : '') + '</button></td>';
    }).join('');
    return '<tr data-row-id="' + esc(r.id) + '"' + (isHighlight ? ' class="qr-highlight"' : '') + '><td class="seq-cell">' + fmtInt.format(r.seq) + '</td><td>' + photo + '</td><td>' + (url ? '<a class="image-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.imageUrl) + '</a>' : '<span class="muted">–</span>') + '</td>' +
      '<td><span class="asset-name">' + esc(r.name) + '</span></td><td class="asset-code">' + esc(r.code || '–') + '</td><td>' + date(r.received) + '</td><td>' + esc(r.location || '–') + '</td>' +
      normalCell + otherStatusCells +
      '<td class="num">' + amount(r.total) + '</td><td class="num">' + (r.rate == null ? '–' : fmtMoney.format(r.rate) + '%') + '</td>' + ['opening', 'increase', 'decrease', 'closing', 'net'].map(k => '<td class="num">' + amount(r[k]) + '</td>').join('') +
      '<td class="note">' + esc(r.note) + '</td><td class="action-cell"><div class="row-actions"><button type="button" class="action-button" data-edit="' + esc(r.id) + '">' + (canEdit ? 'แก้ไข' : 'ดูข้อมูล') + '</button><button type="button" class="action-button sticker-btn" data-sticker="' + esc(r.id) + '">สติกเกอร์</button></div></td></tr>';
  }

  function syncRowStatusDom(r) {
    const nMark = getNormalMark(r);
    const nSym = nMark === 'check' ? '✓' : nMark === 'cross' ? '✕' : '';
    document.querySelectorAll('[data-normal-toggle="' + r.id + '"]').forEach(btn => {
      btn.className = 'status-box normal-toggle state-' + nMark;
      btn.textContent = nSym;
    });
    document.querySelectorAll('[data-status-toggle="' + r.id + '"]').forEach(btn => {
      const k = btn.dataset.statusKey;
      const checked = r.status === k;
      btn.className = 'status-box substatus-toggle ' + (checked ? 'state-check' : 'state-none');
      btn.textContent = checked ? '✓' : '';
    });
  }

  function rowToUpdatePayload(r) {
    const p = {
      seq: r.seq,
      name: r.name,
      code: r.code || '',
      received: r.received || '',
      location: r.location || '',
      imageUrl: r.imageUrl || '',
      status: r.status || 'normal',
      normalMark: getNormalMark(r),
      note: r.note || ''
    };
    for (const key of [...moneyKeys, 'rate']) p[key] = r[key] == null ? null : Number(r[key]);
    return p;
  }

  function queueRowStatusSave(r) {
    if (!r || !r.id) return;
    if (rowSaveTimers.has(r.id)) clearTimeout(rowSaveTimers.get(r.id));
    const timer = setTimeout(async () => {
      rowSaveTimers.delete(r.id);
      try {
        const res = await call('assetsUpdate', r.id, r.version, rowToUpdatePayload(r));
        if (res && res.row) {
          r.version = res.row.version;
          r.updatedTs = res.row.updatedTs;
          r.updatedBy = res.row.updatedBy;
        }
      } catch (e) {
        toast('อัปเดตสถานะไม่สำเร็จ: ' + e.message, true);
        await load();
      }
    }, 350);
    rowSaveTimers.set(r.id, timer);
  }

  function formValues() {
    const checkedRadio = $('#assetForm input[name="status"]:checked');
    const st = checkedRadio ? checkedRadio.value : 'normal';
    const nMark = ($('#normalMarkInput') && $('#normalMarkInput').value) || (st === 'normal' ? 'check' : 'none');
    const p = { seq: Number($('#seq').value), name: $('#assetName').value.trim(), code: $('#assetCode').value.trim(), received: $('#received').value,
      location: $('#assetLocation').value.trim(), imageUrl: $('#imageUrl').value.trim(), status: st, normalMark: nMark, note: $('#note').value.trim() };
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
    const values = r || { seq: data.nextSeq, status: 'normal', normalMark: 'check' };
    const map = { seq: 'seq', name: 'assetName', code: 'assetCode', received: 'received', location: 'assetLocation', imageUrl: 'imageUrl', note: 'note' };
    Object.entries(map).forEach(([key, id]) => { $('#' + id).value = values[key] == null ? '' : values[key]; });
    for (const key of [...moneyKeys, 'rate']) $('#' + key).value = values[key] == null ? '' : values[key];
    const radio = $('#assetForm input[name="status"][value="' + (values.status || 'normal') + '"]');
    if (radio) radio.checked = true;
    updateFormNormalUI(getNormalMark(values));
    if ($('#formNormalBtn')) $('#formNormalBtn').disabled = !data.me.edit;
    $('#assetFields').disabled = !data.me.edit; $('#saveAsset').hidden = !data.me.edit; $('#deleteAsset').hidden = !r || !data.me.edit;
    $('#formStickerBtn').hidden = !r;
    $('#formTitle').textContent = r ? (data.me.edit ? 'แก้ไขสินทรัพย์' : 'รายละเอียดสินทรัพย์') : 'เพิ่มสินทรัพย์';
    $('#formMeta').textContent = r ? 'แก้ไขล่าสุด ' + fmtTime.format(new Date(r.updatedTs)) + ' · ' + r.updatedBy : 'ช่องที่เว้นว่างจะแสดงเป็นขีดในตาราง';
    previewImage(); $('#assetDialog').showModal(); $('#assetDialog').scrollTop = 0;
    if (data.me.edit) $('#assetName').focus({ preventScroll: true });
    $('#assetDialog').scrollTop = 0;
  }

  if ($('#formNormalBtn')) {
    $('#formNormalBtn').addEventListener('click', () => {
      if (!data || !data.me.edit) return;
      const cur = ($('#normalMarkInput') && $('#normalMarkInput').value) || 'check';
      const next = nextNormalMark('__form__', cur);
      updateFormNormalUI(next);
      if (next === 'check') {
        const normalRadio = $('#assetForm input[name="status"][value="normal"]');
        if (normalRadio) normalRadio.checked = true;
      }
    });
  }

  document.querySelectorAll('#assetForm input[name="status"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value !== 'normal' && radio.checked) {
        const cur = ($('#normalMarkInput') && $('#normalMarkInput').value) || 'check';
        if (cur === 'check') updateFormNormalUI('none');
      }
    });
  });

  /* ==================== Image File Input & Fast Parallel Compression ==================== */
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'));
      reader.readAsDataURL(file);
    });
  }

  async function compressImageObj(imgObj, maxDim = 480, thresholdChars = 42000) {
    if (!imgObj || (!imgObj.data && !imgObj.u8)) return null;
    const rawMime = String(imgObj.mime || 'image/png').toLowerCase();
    const isWebMime = /^image\/(jpeg|png|webp|gif)$/.test(rawMime);
    const cleanB64 = imgObj.data ? String(imgObj.data).replace(/\s+/g, '') : bytesToB64(imgObj.u8);

    if (isWebMime && cleanB64.length <= thresholdChars) {
      return { mime: rawMime, data: cleanB64 };
    }
    if (typeof document === 'undefined') {
      return isWebMime ? { mime: rawMime, data: cleanB64 } : null;
    }

    if (typeof createImageBitmap === 'function' && typeof Blob !== 'undefined') {
      try {
        const bytes = imgObj.u8 || b64ToBytes(cleanB64);
        const bmp = await createImageBitmap(new Blob([bytes], { type: rawMime }));
        let w = bmp.width || 400, h = bmp.height || 400;
        if (w > maxDim || h > maxDim) {
          if (w >= h) { h = Math.max(1, Math.round(h * maxDim / w)); w = maxDim; }
          else { w = Math.max(1, Math.round(w * maxDim / h)); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bmp, 0, 0, w, h);
        if (typeof bmp.close === 'function') bmp.close();
        const outUrl = canvas.toDataURL('image/jpeg', 0.78);
        const m = /^data:(image\/jpeg);base64,(.+)$/i.exec(outUrl);
        if (m && (!isWebMime || m[2].length < cleanB64.length)) {
          return { mime: 'image/jpeg', data: m[2] };
        }
        return isWebMime ? { mime: rawMime, data: cleanB64 } : null;
      } catch (_) {}
    }

    if (typeof Image === 'undefined') {
      return isWebMime ? { mime: rawMime, data: cleanB64 } : null;
    }

    return new Promise(resolve => {
      const img = new Image();
      const timer = setTimeout(() => resolve(isWebMime ? { mime: rawMime, data: cleanB64 } : null), 2500);
      img.onload = () => {
        clearTimeout(timer);
        try {
          let w = img.naturalWidth || img.width || 400;
          let h = img.naturalHeight || img.height || 400;
          if (w > maxDim || h > maxDim) {
            if (w >= h) { h = Math.max(1, Math.round(h * maxDim / w)); w = maxDim; }
            else { w = Math.max(1, Math.round(w * maxDim / h)); h = maxDim; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const outUrl = canvas.toDataURL('image/jpeg', 0.78);
          const m = /^data:(image\/jpeg);base64,(.+)$/i.exec(outUrl);
          if (m && (!isWebMime || m[2].length < cleanB64.length)) {
            resolve({ mime: 'image/jpeg', data: m[2] });
          } else {
            resolve(isWebMime ? { mime: rawMime, data: cleanB64 } : null);
          }
        } catch (_) {
          resolve(isWebMime ? { mime: rawMime, data: cleanB64 } : null);
        }
      };
      img.onerror = () => { clearTimeout(timer); resolve(isWebMime ? { mime: rawMime, data: cleanB64 } : null); };
      img.src = 'data:' + rawMime + ';base64,' + cleanB64;
    });
  }

  async function computeImageFid(mime, b64) {
    const input = String(mime || 'image/png').toLowerCase() + ':' + String(b64 || '').replace(/\s+/g, '');
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    }
    let h1 = 0xdeadbeef ^ input.length, h2 = 0x41c6ce57 ^ input.length, h3 = 0x9e3779b9 ^ input.length, h4 = 0x85ebca6b ^ input.length;
    for (let i = 0; i < input.length; i++) {
      const ch = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
      h3 = Math.imul(h3 ^ ch, 2246822507);
      h4 = Math.imul(h4 ^ ch, 3266489909);
    }
    return [h1, h2, h3, h4].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
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
        const compressed = await compressImageObj({ mime: m[1].toLowerCase(), data: m[2] }, 720, 75000);
        if (!compressed) throw new Error('ไม่สามารถประมวลผลรูปภาพนี้ได้');
        pendingImageData = { mime: compressed.mime, data: compressed.data, name: file.name, dataUrl: 'data:' + compressed.mime + ';base64,' + compressed.data };
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
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" horizontal="left"/></xf>' +
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" horizontal="left"/></xf>' +
        '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>' +
        '<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="left" wrapText="1"/></xf>' +
        '<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf>' +
        '<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="165" fontId="4" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf>' +
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
      const timer = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
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
      merged('N3:Q3', 3, 'ค่าเสื่อมราคาสะสม'),
      merged('R3:R4', 3, 'ราคาสินทรัพย์ สุทธิ'),
      merged('S3:S4', 3, 'หมายเหตุ')
    ];
    addRow(3, h1, 24);
    const h2 = [
      strCell('H4', 3, 'ปกติ'),
      strCell('I4', 3, 'ไม่สามารถซ่อมได้'),
      strCell('J4', 3, 'ต้องทำการซ่อม'),
      strCell('K4', 3, 'ลด ระหว่างปี'),
      strCell('N4', 3, 'ยกมา'),
      strCell('O4', 3, 'เพิ่ม ระหว่างปี'),
      strCell('P4', 3, 'ลด ระหว่างปี'),
      strCell('Q4', 3, 'ยกไป')
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
          const info = mimeToExt(imgObj.mime);
          const mKey = info.ext + ':' + imgObj.data.length + ':' + imgObj.data.slice(0, 64) + ':' + imgObj.data.slice(-64);
          let rId = mediaByKey.get(mKey);
          if (!rId) {
            const bytes = b64ToBytes(imgObj.data);
            if (bytes.length > 0) {
              const idx = mediaFiles.length + 1;
              const fileName = 'image' + idx + '.' + info.ext;
              rId = 'rId' + idx;
              mediaByKey.set(mKey, rId);
              mediaFiles.push({ name: 'xl/media/' + fileName, data: bytes, ext: info.ext, mime: info.mime, store: true });
              drawingRels.push('<Relationship Id="' + rId + '" Type="' + XL_RNS + '/image" Target="../media/' + fileName + '"/>');
            }
          }
          if (rId) {
            hasImg = true;
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
      const nMark = getNormalMark(x);
      const cells = [
        numCell('A' + r, 6, x.seq != null ? x.seq : i + 1),
        strCell('B' + r, 5, ''),
        strCell('C' + r, 4, x.imageUrl || ''),
        strCell('D' + r, 4, x.name || ''),
        strCell('E' + r, 5, x.code || ''),
        serial !== null ? numCell('F' + r, 8, serial) : strCell('F' + r, 5, x.received || ''),
        strCell('G' + r, 4, x.location || ''),
        strCell('H' + r, 5, nMark === 'check' ? '✓' : nMark === 'cross' ? '✗' : ''),
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
      if (u8[0] === 0x42 && u8[1] === 0x4D) return 'image/bmp';
    }
    const ext = (/\.([a-z0-9]+)$/i.exec(String(path || '')) || [])[1] || '';
    if (/^(?:jpe?g|jfif)$/i.test(ext)) return 'image/jpeg';
    if (/^gif$/i.test(ext)) return 'image/gif';
    if (/^webp$/i.test(ext)) return 'image/webp';
    if (/^bmp$/i.test(ext)) return 'image/bmp';
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
    const sheetXmlBySheet = Object.create(null);
    const dispImgMap = Object.create(null);
    const mediaCache = Object.create(null);
    const wbFiles = wb && wb.files;
    if (!wbFiles) return { bySheet, dispImgMap, sheetXmlBySheet };

    function getMediaObj(targetPath) {
      if (!targetPath) return null;
      if (mediaCache[targetPath] !== undefined) return mediaCache[targetPath];
      const u8 = zipBytes(wbFiles, targetPath);
      if (!u8 || !u8.length) { mediaCache[targetPath] = null; return null; }
      const mime = detectImageMime(targetPath, u8);
      const obj = {
        mime,
        u8,
        path: targetPath,
        get data() {
          if (!this._b64) this._b64 = bytesToB64(this.u8);
          return this._b64;
        }
      };
      mediaCache[targetPath] = obj;
      return obj;
    }

    const cellImgXml = zipText(wbFiles, 'xl/cellimages.xml');
    if (cellImgXml) {
      const cellImgRels = parseRelsXml(zipText(wbFiles, 'xl/_rels/cellimages.xml.rels'), 'xl/cellimages.xml');
      for (const m of cellImgXml.matchAll(/<(?:\w+:)?pic\b[\s\S]*?<\/(?:\w+:)?pic>/gi)) {
        const block = m[0];
        const name = (/<(?:\w+:)?cNvPr\b[^>]*\bname=["']([^"']+)["']/i.exec(block) || [])[1];
        const embed = (/<(?:\w+:)?blip\b[^>]*\b(?:\w+:)?embed=["']([^"']+)["']/i.exec(block) || [])[1];
        if (name && embed && cellImgRels[embed]) {
          const obj = getMediaObj(cellImgRels[embed].target);
          if (obj) dispImgMap[name] = obj;
        }
      }
    }

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
      sheetXmlBySheet[name] = zipText(wbFiles, path);
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
          const obj = getMediaObj(mediaRel.target);
          if (obj) rowMap[row0] = obj;
        }
      });
    });

    return { bySheet, dispImgMap, sheetXmlBySheet };
  }

  const THAI_MONTHS = {
    'ม.ค.': '01', 'มกราคม': '01', 'ก.พ.': '02', 'กุมภาพันธ์': '02', 'มี.ค.': '03', 'มีนาคม': '03',
    'เม.ย.': '04', 'เมษายน': '04', 'พ.ค.': '05', 'พฤษภาคม': '05', 'มิ.ย.': '06', 'มิถุนายน': '06',
    'ก.ค.': '07', 'กรกฎาคม': '07', 'ส.ค.': '08', 'สิงหาคม': '08', 'ก.ย.': '09', 'กันยายน': '09',
    'ต.ค.': '10', 'ตุลาคม': '10', 'พ.ย.': '11', 'พฤศจิกายน': '11', 'ธ.ค.': '12', 'ธันวาคม': '12'
  };

  function validIsoDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    const yr = Number(iso.slice(0, 4));
    if (yr < 1900 || yr > 2200) return '';
    const d = new Date(iso + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : '';
  }

  function parseAssetDateCell(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date && Number.isFinite(v.getTime())) {
      let yr = v.getUTCFullYear();
      if (yr >= 2400) yr -= 543;
      return validIsoDate(String(yr).padStart(4, '0') + '-' + String(v.getUTCMonth() + 1).padStart(2, '0') + '-' + String(v.getUTCDate()).padStart(2, '0'));
    }
    if (typeof v === 'number' && Number.isFinite(v) && v > 1000 && v < 200000) {
      const ms = Math.round((v - 25569) * 86400000);
      const d = new Date(ms);
      if (Number.isFinite(d.getTime())) {
        let yr = d.getUTCFullYear();
        if (yr >= 2400) yr -= 543;
        return validIsoDate(String(yr).padStart(4, '0') + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'));
      }
    }
    const s = String(v).trim();
    if (!s || s === '–' || s === '-') return '';
    let m = /^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/.exec(s);
    if (m) {
      let yr = Number(m[1]);
      if (yr >= 2400) yr -= 543;
      return validIsoDate(String(yr).padStart(4, '0') + '-' + String(Number(m[2])).padStart(2, '0') + '-' + String(Number(m[3])).padStart(2, '0'));
    }
    m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s);
    if (m) {
      let yr = Number(m[3]);
      if (yr < 100) yr += yr >= 40 ? 2500 : 2000;
      if (yr >= 2400) yr -= 543;
      return validIsoDate(String(yr).padStart(4, '0') + '-' + String(Number(m[2])).padStart(2, '0') + '-' + String(Number(m[1])).padStart(2, '0'));
    }
    for (const [thName, mm] of Object.entries(THAI_MONTHS)) {
      if (s.includes(thName)) {
        const nums = s.match(/\d+/g);
        if (nums && nums.length >= 2) {
          const dd = Number(nums[0]);
          let yr = Number(nums[nums.length - 1]);
          if (yr < 100) yr += 2500;
          if (yr >= 2400) yr -= 543;
          return validIsoDate(String(yr).padStart(4, '0') + '-' + mm + '-' + String(dd).padStart(2, '0'));
        }
      }
    }
    return '';
  }

  function normalizeAssetNum(n, isRate = false) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    n = Math.round(n * 100) / 100;
    if (n < 0) n = Math.abs(n) < 0.01 ? 0 : Math.abs(n);
    if (isRate && n > 100) n = 100;
    if (!isRate && n > 1000000000000) n = 1000000000000;
    return n;
  }

  function parseAssetNumCell(v, isRate = false) {
    if (v === null || v === undefined || v === '') return null;
    let n;
    if (typeof v === 'number') {
      n = v;
    } else {
      let raw = String(v).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      if (!raw || /^[-–—]+$/.test(raw) || raw.startsWith('#')) return null;
      const parenMatch = /^\(\s*([0-9,]+(?:\.[0-9]+)?)\s*\)$/.exec(raw);
      if (parenMatch) {
        n = Number(parenMatch[1].replace(/,/g, ''));
      } else {
        const s = raw.replace(/[,%\s฿บาท]/g, '').trim();
        if (!s || /^[-–—]+$/.test(s)) return null;
        n = Number(s);
      }
    }
    return normalizeAssetNum(n, isRate);
  }

  function getWsCell(ws, r, c) {
    if (!ws || r < 0 || c < 0) return null;
    if (Array.isArray(ws['!data'])) return ws['!data'][r] ? ws['!data'][r][c] : null;
    return ws[XLSX.utils.encode_cell({ r, c })] || null;
  }

  function offsetFormulaRefs(expr, dr, dc) {
    return String(expr || '').replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?!\s*\()/gi, (m, cAbs, colStr, rAbs, rowStr) => {
      const decoded = XLSX.utils.decode_cell(colStr.toUpperCase() + rowStr);
      const nc = cAbs ? decoded.c : Math.max(0, decoded.c + dc);
      const nr = rAbs ? decoded.r : Math.max(0, decoded.r + dr);
      return cAbs + XLSX.utils.encode_col(nc) + rAbs + (nr + 1);
    });
  }

  function expandSharedFormulas(ws, sheetXml) {
    if (!ws || !sheetXml || !/t=["']shared["']/i.test(sheetXml)) return;
    const masters = Object.create(null);
    const unesc = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    for (const m of sheetXml.matchAll(/<c\b[^>]*\br=["']([A-Z]+\d+)["'][^>]*>[\s\S]*?<f\b([^>]*)>([\s\S]*?)<\/f>[\s\S]*?<\/c>/gi)) {
      const addr = m[1], fAttrs = m[2], fBody = unesc(m[3]).trim();
      if (!/\bt=["']shared["']/i.test(fAttrs) || !fBody) continue;
      const si = (/\bsi=["'](\d+)["']/i.exec(fAttrs) || [])[1];
      if (si !== undefined) {
        masters[si] = { pos: XLSX.utils.decode_cell(addr), expr: fBody };
        if (!ws[addr]) ws[addr] = { t: 'n', f: fBody };
        else if (!ws[addr].f) ws[addr].f = fBody;
      }
    }
    for (const m of sheetXml.matchAll(/<c\b[^>]*\br=["']([A-Z]+\d+)["'][^>]*>[\s\S]*?<f\b([^>]*)\/>[\s\S]*?<\/c>/gi)) {
      const addr = m[1], fAttrs = m[2];
      if (!/\bt=["']shared["']/i.test(fAttrs)) continue;
      const si = (/\bsi=["'](\d+)["']/i.exec(fAttrs) || [])[1];
      const master = si !== undefined ? masters[si] : null;
      if (!master) continue;
      const pos = XLSX.utils.decode_cell(addr);
      const translated = offsetFormulaRefs(master.expr, pos.r - master.pos.r, pos.c - master.pos.c);
      if (!ws[addr]) ws[addr] = { t: 'n', f: translated };
      else if (!ws[addr].f) ws[addr].f = translated;
    }
  }

  function splitFormulaArgs(argStr) {
    const out = [];
    let cur = '', depth = 0;
    for (let i = 0; i < argStr.length; i++) {
      const ch = argStr[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function evalSimpleArith(str) {
    const clean = String(str || '').replace(/\s+/g, '');
    if (!clean || !/^[0-9.+\-*/()eE]+$/.test(clean)) return null;
    try {
      const tokens = [];
      let i = 0;
      while (i < clean.length) {
        const ch = clean[i];
        if (ch === '(' || ch === ')' || ch === '*' || ch === '/') { tokens.push(ch); i++; continue; }
        if ((ch === '+' || ch === '-') && (tokens.length === 0 || tokens[tokens.length - 1] === '(' || typeof tokens[tokens.length - 1] === 'string' && /^[+\-*/]$/.test(tokens[tokens.length - 1]))) {
          let numStr = ch; i++;
          while (i < clean.length && /[0-9.eE]/.test(clean[i])) { numStr += clean[i++]; }
          const v = Number(numStr);
          if (!Number.isFinite(v)) return null;
          tokens.push(v);
          continue;
        }
        if (ch === '+' || ch === '-') { tokens.push(ch); i++; continue; }
        if (/[0-9.]/.test(ch)) {
          let numStr = '';
          while (i < clean.length && /[0-9.eE]/.test(clean[i])) { numStr += clean[i++]; }
          const v = Number(numStr);
          if (!Number.isFinite(v)) return null;
          tokens.push(v);
          continue;
        }
        return null;
      }
      let pos = 0;
      function parseExpr() {
        let left = parseTerm();
        while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
          const op = tokens[pos++];
          const right = parseTerm();
          left = op === '+' ? left + right : left - right;
        }
        return left;
      }
      function parseTerm() {
        let left = parseFactor();
        while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/')) {
          const op = tokens[pos++];
          const right = parseFactor();
          left = op === '*' ? left * right : (right === 0 ? 0 : left / right);
        }
        return left;
      }
      function parseFactor() {
        if (tokens[pos] === '(') {
          pos++;
          const val = parseExpr();
          if (tokens[pos] === ')') pos++;
          return val;
        }
        const v = tokens[pos++];
        return typeof v === 'number' ? v : NaN;
      }
      const res = parseExpr();
      return pos === tokens.length && Number.isFinite(res) ? res : null;
    } catch (_) { return null; }
  }

  function evalExcelFormula(expr, ws, grid, r, depth = 0) {
    if (!expr || depth > 6) return null;
    let s = String(expr).trim().replace(/^=/, '').trim();
    if (!s || /!/.test(s)) return null;

    const topFn = /^([A-Z]+)\s*\(([\s\S]*)\)$/i.exec(s);
    if (topFn) {
      const fnName = topFn[1].toUpperCase();
      const inner = topFn[2];
      let pDepth = 0, balanced = true;
      for (let i = 0; i < inner.length; i++) {
        if (inner[i] === '(') pDepth++;
        else if (inner[i] === ')') { pDepth--; if (pDepth < 0) { balanced = false; break; } }
      }
      if (balanced && pDepth === 0) {
        const args = splitFormulaArgs(inner);
        if (fnName === 'IFERROR' && args.length >= 2) {
          const v1 = evalExcelFormula(args[0], ws, grid, r, depth + 1);
          return v1 !== null ? v1 : evalExcelFormula(args[1], ws, grid, r, depth + 1);
        }
        if (fnName === 'IF' && args.length >= 2) {
          const condMatch = /^(.+?)(<=|>=|<>|<|>|=)(.+)$/.exec(args[0]);
          if (condMatch) {
            const lhs = evalExcelFormula(condMatch[1], ws, grid, r, depth + 1) ?? 0;
            const rhs = evalExcelFormula(condMatch[3], ws, grid, r, depth + 1) ?? 0;
            const op = condMatch[2];
            const ok = op === '<=' ? lhs <= rhs : op === '>=' ? lhs >= rhs : op === '<>' ? lhs !== rhs : op === '<' ? lhs < rhs : op === '>' ? lhs > rhs : lhs === rhs;
            return evalExcelFormula(ok ? args[1] : (args[2] || '0'), ws, grid, r, depth + 1);
          }
        }
      }
    }

    let guard = 0;
    while (/\b(?:SUM|AVERAGE|MIN|MAX|ROUND|ROUNDUP|ROUNDDOWN|ABS)\s*\([^()]*\)/i.test(s) && guard++ < 20) {
      s = s.replace(/\b(SUM|AVERAGE|MIN|MAX|ROUND|ROUNDUP|ROUNDDOWN|ABS)\s*\(([^()]*)\)/gi, (_, fnRaw, argStr) => {
        const fn = fnRaw.toUpperCase();
        const parts = splitFormulaArgs(argStr);
        const vals = [];
        parts.forEach(part => {
          const rngMatch = /^\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)$/i.exec(part);
          if (rngMatch) {
            const c1 = XLSX.utils.decode_cell(rngMatch[1].toUpperCase() + rngMatch[2]);
            const c2 = XLSX.utils.decode_cell(rngMatch[3].toUpperCase() + rngMatch[4]);
            for (let rr = Math.min(c1.r, c2.r); rr <= Math.max(c1.r, c2.r); rr++) {
              for (let cc = Math.min(c1.c, c2.c); cc <= Math.max(c1.c, c2.c); cc++) {
                const v = readSheetNumCell(ws, grid, rr, cc, false, depth + 1);
                vals.push(v !== null ? v : 0);
              }
            }
          } else {
            const v = evalExcelFormula(part, ws, grid, r, depth + 1);
            vals.push(v !== null ? v : 0);
          }
        });
        if (!vals.length) return '0';
        if (fn === 'SUM') return String(vals.reduce((a, b) => a + b, 0));
        if (fn === 'AVERAGE') return String(vals.reduce((a, b) => a + b, 0) / vals.length);
        if (fn === 'MIN') return String(Math.min(...vals));
        if (fn === 'MAX') return String(Math.max(...vals));
        if (fn === 'ABS') return String(Math.abs(vals[0]));
        const factor = Math.pow(10, Math.round(vals[1] || 0));
        if (fn === 'ROUNDUP') return String((vals[0] >= 0 ? Math.ceil(vals[0] * factor) : Math.floor(vals[0] * factor)) / factor);
        if (fn === 'ROUNDDOWN') return String((vals[0] >= 0 ? Math.floor(vals[0] * factor) : Math.ceil(vals[0] * factor)) / factor);
        return String(Math.round(vals[0] * factor) / factor);
      });
    }

    s = s.replace(/\$?([A-Z]{1,3})\$?(\d+)(\s*%?)/gi, (_, colStr, rowStr, pct) => {
      const pos = XLSX.utils.decode_cell(colStr.toUpperCase() + rowStr);
      const v = readSheetNumCell(ws, grid, pos.r, pos.c, false, depth + 1);
      const num = v !== null ? v : 0;
      return pct && pct.includes('%') ? '(' + (num * 0.01) + ')' : '(' + num + ')';
    });
    s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1*0.01)');

    return evalSimpleArith(s);
  }

  function readSheetNumCell(ws, grid, r, c, isRate = false, depth = 0) {
    if (c === undefined || c === null || c < 0 || depth > 6) return null;
    const cell = getWsCell(ws, r, c);
    const gVal = grid && grid[r] ? grid[r][c] : '';

    if (cell) {
      if (cell.t === 'n' && typeof cell.v === 'number' && Number.isFinite(cell.v)) {
        let v = cell.v;
        if (cell.f && v === 0) {
          const fv = evalExcelFormula(cell.f, ws, grid, r, depth + 1);
          if (fv !== null && fv !== 0) v = fv;
        }
        if (isRate && v > 0 && v <= 1 && ((cell.w && String(cell.w).includes('%')) || (cell.z && String(cell.z).includes('%')))) {
          v = v * 100;
        }
        return normalizeAssetNum(v, isRate);
      }
      if (cell.f) {
        const fv = evalExcelFormula(cell.f, ws, grid, r, depth + 1);
        if (fv !== null) return normalizeAssetNum(fv, isRate);
      }
      if (cell.t !== 'e' && cell.v !== undefined && cell.v !== '') {
        const parsed = parseAssetNumCell(cell.v, isRate);
        if (parsed !== null) return parsed;
      }
      if (cell.t !== 'e' && cell.w !== undefined && cell.w !== '') {
        const parsed = parseAssetNumCell(cell.w, isRate);
        if (parsed !== null) return parsed;
      }
    }

    return parseAssetNumCell(gVal, isRate);
  }

  function isCrossCell(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '✗' || s === '✘' || s === '✕' || s === '×' || s === 'x' || s === 'กากบาท' || s === 'ไม่ปกติ';
  }

  function isCheckedCell(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return s === '✓' || s === '✔' || s === 'true' || s === '1' || s === 'yes' || s === 'ใช่' || s === 'ปกติ' || s === 'p' || s === 'a';
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

  function normHdrText(v) {
    return String(v == null ? '' : v).replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  }

  function isSubHeaderRow(row) {
    if (!Array.isArray(row)) return false;
    return row.some(cell => {
      const t = normHdrText(cell);
      return t && /^(?:ปกติ|ไม่สามารถ\s*ซ่อมได้|ไม่สามารถ|ซ่อมได้|ซ่อมไม่ได้|ต้อง\s*ทำการ\s*ซ่อม|ต้องทำการ|ต้องซ่อม|ลด\s*ระหว่างปี|เพิ่ม\s*ระหว่างปี|ระหว่างปี|ยกมา|ยกไป|เพิ่ม|ลด|สุทธิ|ร้อยละ|\(บาท\))$/i.test(t);
    });
  }

  function detectAssetColumns(ws, grid) {
    const merges = (ws && Array.isArray(ws['!merges'])) ? ws['!merges'] : [];
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const row = grid[r] || [];
      const headerRows = [r];
      if (r + 1 < grid.length && isSubHeaderRow(grid[r + 1])) {
        headerRows.push(r + 1);
        if (r + 2 < grid.length && isSubHeaderRow(grid[r + 2])) {
          headerRows.push(r + 2);
        }
      }
      const headerEnd = headerRows[headerRows.length - 1];
      let maxCol = 0;
      headerRows.forEach(hr => { if (grid[hr] && grid[hr].length > maxCol) maxCol = grid[hr].length; });
      if (maxCol < 3) continue;

      const groupByCol = Object.create(null);
      const isHorizMergeStart = Object.create(null);

      merges.forEach(m => {
        if (!m || !m.s || !m.e) return;
        if (m.s.r >= r && m.s.r <= headerEnd && m.e.c > m.s.c) {
          const gTxt = normHdrText(grid[m.s.r] && grid[m.s.r][m.s.c]);
          if (gTxt) {
            isHorizMergeStart[m.s.r + ':' + m.s.c] = true;
            for (let cc = m.s.c; cc <= m.e.c; cc++) {
              groupByCol[cc] = groupByCol[cc] ? (groupByCol[cc] + ' ' + gTxt) : gTxt;
            }
          }
        }
      });

      for (let cc = 0; cc < maxCol; cc++) {
        const topTxt = normHdrText(row[cc]);
        if (!topTxt || groupByCol[cc]) continue;
        if (/^(?:สถานะ|สภาพ|status)$/i.test(topTxt) || /ค่าเสื่อม/i.test(topTxt)) {
          isHorizMergeStart[r + ':' + cc] = true;
          groupByCol[cc] = topTxt;
          for (let k = 1; k <= 3 && cc + k < maxCol; k++) {
            if (!normHdrText(row[cc + k])) groupByCol[cc + k] = topTxt;
            else break;
          }
        }
      }

      const cMap = {};
      for (let c = 0; c < maxCol; c++) {
        const grp = groupByCol[c] || '';
        const ownParts = [];
        headerRows.forEach(hr => {
          const txt = normHdrText(grid[hr] && grid[hr][c]);
          if (!txt) return;
          if (isHorizMergeStart[hr + ':' + c] && headerRows.length > 1) return;
          if (ownParts[ownParts.length - 1] !== txt) ownParts.push(txt);
        });
        const own = ownParts.join(' ').trim();
        const full = (grp ? grp + ' ' + own : own).trim();

        const inStatusGrp = /สถานะ|สภาพ|status/i.test(grp);
        const inDeprGrp = /ค่าเสื่อม/i.test(grp);

        if (inStatusGrp && cMap.statusGroup === undefined) cMap.statusGroup = c;
        if ((inDeprGrp || /ค่าเสื่อม/i.test(own)) && cMap.deprGroup === undefined) cMap.deprGroup = c;

        if (!own && !grp) continue;

        if (cMap.stNormal === undefined && /^(?:ปกติ|normal)$/i.test(own)) { cMap.stNormal = c; continue; }
        if (cMap.stIrreparable === undefined && /ไม่สามารถ\s*ซ่อมได้|ซ่อมไม่ได้|ชำรุด|irreparable/i.test(own)) { cMap.stIrreparable = c; continue; }
        if (cMap.stRepair === undefined && /ต้อง\s*ทำการ\s*ซ่อม|ต้องซ่อม|ส่งซ่อม|รอซ่อม|repair/i.test(own)) { cMap.stRepair = c; continue; }
        if (cMap.stReduced === undefined && /ลด\s*ระหว่างปี|^ลด$|ตัดจำหน่าย|จำหน่าย|reduced/i.test(own) && (inStatusGrp || (!inDeprGrp && cMap.total === undefined && cMap.deprGroup === undefined))) {
          cMap.stReduced = c;
          continue;
        }

        if (cMap.opening === undefined && /(?:^ยกมา$|ค่าเสื่อม.*ยกมา|สะสมยกมา|ต้นงวด|^opening$|brought\s*forward)/i.test(own)) {
          cMap.opening = c;
          continue;
        }
        if (cMap.increase === undefined && /(?:เพิ่ม\s*ระหว่างปี|เพิ่มระหว่างปี|^เพิ่ม$|ระหว่างปี\s*เพิ่ม|ค่าเสื่อม.*ปีนี้|ค่าเสื่อม.*ประจำปี|^increase$)/i.test(own)) {
          cMap.increase = c;
          continue;
        }
        if (cMap.decrease === undefined && /(?:ลด\s*ระหว่างปี|ลดระหว่างปี|^ลด$|ระหว่างปี\s*ลด|^decrease$)/i.test(own) && (inDeprGrp || (cMap.opening !== undefined && c > cMap.opening) || (cMap.increase !== undefined && c > cMap.increase) || (cMap.total !== undefined && c > cMap.total))) {
          cMap.decrease = c;
          continue;
        }
        if (cMap.closing === undefined && /(?:^ยกไป$|ค่าเสื่อม.*ยกไป|สะสมยกไป|ปลายงวด|รวมค่าเสื่อม|^closing$|carried\s*forward)/i.test(own)) {
          cMap.closing = c;
          continue;
        }

        if (cMap.seq === undefined && /^(?:ลำดับ|ลำดับที่|ที่|no\.?|item)$/i.test(own)) cMap.seq = c;
        else if (cMap.photo === undefined && /^(?:รูปภาพ|รูป|ภาพ|รูปสินทรัพย์|photo|image|picture)$/i.test(own)) cMap.photo = c;
        else if (cMap.imageUrl === undefined && /ลิงก์ภาพ|ลิงก์รูป|image\s*url|url\s*ภาพ/i.test(own)) cMap.imageUrl = c;
        else if (cMap.name === undefined && /^(?:รายการ|ชื่อรายการ|ชื่อสินทรัพย์|รายการสินทรัพย์|รายการทรัพย์สิน|ชื่อทรัพย์สิน|สินทรัพย์|ทรัพย์สิน|asset\s*name|description)$/i.test(own)) cMap.name = c;
        else if (cMap.code === undefined && /(?:รหัสสินทรัพย์|รหัสทรัพย์สิน|รหัสครุภัณฑ์|เลขครุภัณฑ์|เลขทะเบียน|^รหัส$|asset\s*code|^code$)/i.test(own)) cMap.code = c;
        else if (cMap.received === undefined && /(?:วันที่รับ|วันเดือนปีที่รับ|วันที่ได้มา|วันเดือนปี|received|date)/i.test(own)) cMap.received = c;
        else if (cMap.location === undefined && /(?:สถานที่ตั้ง|สถานที่|ที่ตั้ง|ประจำอยู่ที่|หน่วยงาน|location)/i.test(own)) cMap.location = c;
        else if (cMap.statusGroup === undefined && /^(?:สถานะ|สภาพ|status)$/i.test(full)) cMap.statusGroup = c;
        else if (cMap.total === undefined && !inDeprGrp && !inStatusGrp && /^(?:รวม|รวมเงิน|รวมทั้งสิ้น|ราคาทุน|ต้นทุนรวม|มูลค่ารวม|ราคาซื้อ|มูลค่าได้มา|total|cost)(?:\s*\(บาท\))?$/i.test(own)) cMap.total = c;
        else if (cMap.rate === undefined && !inDeprGrp && !inStatusGrp && /(?:อัตรา|ร้อยละ|rate|%)/i.test(own)) cMap.rate = c;
        else if (cMap.net === undefined && !inDeprGrp && !inStatusGrp && (/(?:ราคาสินทรัพย์\s*สุทธิ|ราคาทรัพย์สิน\s*สุทธิ|ราคาทรัพสิน\s*สุทธิ|สินทรัพย์\s*สุทธิ|ทรัพย์สิน\s*สุทธิ|มูลค่าสินทรัพย์\s*สุทธิ|มูลค่า\s*สุทธิ|ราคา\s*สุทธิ|ราคาตามบัญชี|มูลค่าตามบัญชี|คงเหลือ\s*สุทธิ|^สุทธิ$|net\s*book|net\s*value|^net$)/i.test(own) || (cMap.total !== undefined && c > cMap.total && /^(?:ราคาสินทรัพย์|ราคาทรัพย์สิน|ราคาทรัพสิน|มูลค่าสินทรัพย์|สุทธิ)$/i.test(own)))) cMap.net = c;
        else if (cMap.note === undefined && /(?:^หมายเหตุ$|^บันทึก$|คำอธิบาย|^note$|^remark)/i.test(own)) cMap.note = c;
      }

      if (cMap.name !== undefined && (cMap.code !== undefined || cMap.seq !== undefined || cMap.total !== undefined || cMap.deprGroup !== undefined)) {
        if (cMap.statusGroup !== undefined) {
          const s0 = cMap.statusGroup;
          if (cMap.stNormal === undefined) cMap.stNormal = s0;
          if (cMap.stIrreparable === undefined) cMap.stIrreparable = s0 + 1;
          if (cMap.stRepair === undefined) cMap.stRepair = s0 + 2;
          if (cMap.stReduced === undefined) cMap.stReduced = s0 + 3;
        }
        if (cMap.deprGroup !== undefined) {
          const d0 = cMap.deprGroup;
          if (cMap.opening !== undefined && cMap.opening === d0 - 1) {
            if (cMap.increase === undefined) cMap.increase = d0;
            if (cMap.decrease === undefined) cMap.decrease = d0 + 1;
            if (cMap.closing === undefined) cMap.closing = d0 + 2;
            if (cMap.net === undefined) cMap.net = d0 + 3;
          } else {
            if (cMap.opening === undefined) cMap.opening = d0;
            if (cMap.increase === undefined) cMap.increase = d0 + 1;
            if (cMap.decrease === undefined) cMap.decrease = d0 + 2;
            if (cMap.closing === undefined) cMap.closing = d0 + 3;
            if (cMap.net === undefined) cMap.net = d0 + 4;
          }
        } else if (cMap.rate !== undefined || cMap.total !== undefined) {
          const dStart = cMap.opening !== undefined ? cMap.opening : (cMap.rate !== undefined ? cMap.rate + 1 : cMap.total + 2);
          if (cMap.opening === undefined) cMap.opening = dStart;
          if (cMap.increase === undefined) cMap.increase = dStart + 1;
          if (cMap.decrease === undefined) cMap.decrease = dStart + 2;
          if (cMap.closing === undefined) cMap.closing = dStart + 3;
          if (cMap.net === undefined) cMap.net = dStart + 4;
        }
        if (cMap.net === undefined && cMap.closing !== undefined) {
          cMap.net = cMap.closing + 1;
        }
        if (cMap.note === undefined && cMap.net !== undefined && maxCol > cMap.net + 1) {
          cMap.note = cMap.net + 1;
        }

        let sheetTitle = '';
        if (r > 0) {
          const topText = normHdrText(grid[0] && grid[0][0]);
          if (topText && topText.length <= 200) sheetTitle = topText;
        }
        return { cols: cMap, dataStart: headerEnd + 1, sheetTitle };
      }
    }
    return null;
  }

  function parseAssetsWorkbook(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const wb = XLSX.read(u8, { type: 'array', bookFiles: true, cellFormula: true, cellNF: true });
    const { bySheet, dispImgMap, sheetXmlBySheet } = extractWorkbookImages(wb);
    const items = [];
    let sheetTitle = '';
    let imageCount = 0;

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      expandSharedFormulas(ws, sheetXmlBySheet[sheetName] || '');
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      const rowImages = bySheet[sheetName] || Object.create(null);
      if (!grid || !grid.length) continue;

      const detected = detectAssetColumns(ws, grid);
      if (!detected) continue;
      const { cols, dataStart } = detected;
      if (detected.sheetTitle && !sheetTitle) sheetTitle = detected.sheetTitle;

      for (let r = dataStart; r < grid.length; r++) {
        const row = grid[r] || [];
        const name = String(row[cols.name] == null ? '' : row[cols.name]).trim().slice(0, 250);
        const firstCell = String(row[0] == null ? '' : row[0]).trim();
        if (!name || /^รวม(?:ทั้งหมด|ตามตัวกรอง|ทั้งสิ้น)/i.test(firstCell) || /^รวม(?:ทั้งหมด|ตามตัวกรอง|ทั้งสิ้น)/i.test(name)) continue;

        let status = 'normal';
        let normalMark = 'check';
        if (cols.stNormal !== undefined || cols.stIrreparable !== undefined || cols.stRepair !== undefined || cols.stReduced !== undefined) {
          const rawNormal = cols.stNormal !== undefined ? row[cols.stNormal] : '';
          const subIrrep = cols.stIrreparable !== undefined && (isCheckedCell(row[cols.stIrreparable]) || isCrossCell(row[cols.stIrreparable]));
          const subRepair = cols.stRepair !== undefined && (isCheckedCell(row[cols.stRepair]) || isCrossCell(row[cols.stRepair]));
          const subReduced = cols.stReduced !== undefined && (isCheckedCell(row[cols.stReduced]) || isCrossCell(row[cols.stReduced]));

          if (subIrrep) status = 'irreparable';
          else if (subRepair) status = 'repair';
          else if (subReduced) status = 'reduced';
          else if (cols.statusGroup !== undefined && cols.stNormal === undefined) {
            status = parseStatusText(row[cols.statusGroup]) || 'normal';
          }

          if (isCrossCell(rawNormal)) {
            normalMark = 'cross';
          } else if (isCheckedCell(rawNormal)) {
            normalMark = 'check';
          } else if (status !== 'normal') {
            normalMark = 'none';
          } else {
            normalMark = 'check';
          }
        } else if (cols.statusGroup !== undefined) {
          status = parseStatusText(row[cols.statusGroup]) || 'normal';
          normalMark = status === 'normal' ? 'check' : 'none';
        }

        let imgData = rowImages[r] || null;
        if (!imgData && cols.photo !== undefined) {
          const photoCell = String(row[cols.photo] || '');
          const dispMatch = /DISPIMG\(\s*["']([^"']+)["']/i.exec(photoCell);
          if (dispMatch && dispImgMap[dispMatch[1]]) imgData = dispImgMap[dispMatch[1]];
        }
        if (imgData) imageCount++;

        const seqNum = cols.seq !== undefined ? readSheetNumCell(ws, grid, r, cols.seq, false) : null;
        const total = cols.total !== undefined ? readSheetNumCell(ws, grid, r, cols.total, false) : null;
        const rate = cols.rate !== undefined ? readSheetNumCell(ws, grid, r, cols.rate, true) : null;
        const opening = cols.opening !== undefined ? readSheetNumCell(ws, grid, r, cols.opening, false) : null;
        const increase = cols.increase !== undefined ? readSheetNumCell(ws, grid, r, cols.increase, false) : null;
        const decrease = cols.decrease !== undefined ? readSheetNumCell(ws, grid, r, cols.decrease, false) : null;
        let closing = cols.closing !== undefined ? readSheetNumCell(ws, grid, r, cols.closing, false) : null;
        let net = cols.net !== undefined ? readSheetNumCell(ws, grid, r, cols.net, false) : null;

        const hasDepr = opening !== null || increase !== null || decrease !== null;
        const calcClosing = hasDepr
          ? Math.max(0, Math.round(((opening || 0) + (increase || 0) - (decrease || 0)) * 100) / 100)
          : null;
        if (closing === null && calcClosing !== null) {
          closing = calcClosing;
        } else if (closing === 0 && calcClosing !== null && calcClosing > 0) {
          const cCell = cols.closing !== undefined ? getWsCell(ws, r, cols.closing) : null;
          if (!cCell || cCell.f !== undefined || cCell.t === 'e') closing = calcClosing;
        }

        const calcNet = (total !== null && closing !== null)
          ? Math.max(0, Math.round((total - closing) * 100) / 100)
          : null;
        if (net === null && calcNet !== null) {
          net = calcNet;
        } else if (net === 0 && calcNet !== null && calcNet > 0 && total > closing) {
          const nCell = cols.net !== undefined ? getWsCell(ws, r, cols.net) : null;
          if (!nCell || nCell.f !== undefined || nCell.t === 'e') net = calcNet;
        }

        const rawDateVal = cols.received !== undefined ? (getWsCell(ws, r, cols.received)?.v ?? row[cols.received]) : '';
        const item = {
          seq: seqNum !== null && Number.isInteger(seqNum) && seqNum >= 1 && seqNum <= 1000000000 ? seqNum : null,
          name,
          code: cols.code !== undefined ? String(row[cols.code] == null ? '' : row[cols.code]).trim().slice(0, 80) : '',
          received: cols.received !== undefined ? parseAssetDateCell(rawDateVal) : '',
          location: cols.location !== undefined ? String(row[cols.location] == null ? '' : row[cols.location]).trim().slice(0, 200) : '',
          status,
          normalMark,
          imageUrl: cols.imageUrl !== undefined ? safeUrl(String(row[cols.imageUrl] == null ? '' : row[cols.imageUrl]).trim().slice(0, 2000)) : '',
          total,
          rate,
          opening,
          increase,
          decrease,
          closing,
          net,
          note: cols.note !== undefined ? String(row[cols.note] == null ? '' : row[cols.note]).trim().slice(0, 2000) : ''
        };
        if (imgData) item.imageData = imgData;
        items.push(item);
      }
    }

    if (!items.length) throw new Error('ไม่พบรายการสินทรัพย์ในไฟล์ Excel (ตรวจสอบว่ามีหัวตาราง "รายการ" และข้อมูลสินทรัพย์)');
    const summary = {};
    for (const k of moneyKeys) {
      summary[k] = Math.round(items.reduce((acc, it) => acc + (Number(it[k]) || 0), 0) * 100) / 100;
    }
    return { title: sheetTitle, items, imageCount, summary };
  }

  /* ==================== Export & Import UI Handlers (with Batched Progress) ==================== */
  function setImportProgress(pct, text) {
    const wrap = $('#importProgressWrap'), fill = $('#importProgressFill'), label = $('#importProgressText');
    if (!wrap) return;
    if (pct === null) { wrap.hidden = true; return; }
    wrap.hidden = false;
    if (fill) fill.style.width = Math.max(0, Math.min(100, Math.round(pct))) + '%';
    if (label) label.textContent = text || '';
  }

  if ($('#exportExcelBtn')) {
    $('#exportExcelBtn').addEventListener('click', async () => {
      if (!token || !user) return;
      const btn = $('#exportExcelBtn');
      btn.disabled = true;
      const origText = btn.textContent;
      btn.textContent = 'กำลังดึงข้อมูลสินทรัพย์…';
      try {
        const expData = await call('assetsExport', { q: $('#search').value.trim(), status: $('#statusFilter').value, location: $('#locationFilter').value, metaOnly: true });
        const images = Object.assign({}, expData.images || {});
        const fids = Array.isArray(expData.fids) ? expData.fids.filter(f => !images[f]) : [];
        const BATCH_SIZE = 30;
        for (let i = 0; i < fids.length; i += BATCH_SIZE) {
          btn.textContent = 'กำลังดึงรูปภาพ ' + Math.min(i + BATCH_SIZE, fids.length) + ' / ' + fids.length + '…';
          const res = await call('assetsExportImages', fids.slice(i, i + BATCH_SIZE));
          if (res && res.images) Object.assign(images, res.images);
        }
        btn.textContent = 'กำลังสร้างไฟล์ Excel…';
        const xlsxBytes = await xlsxBuildAssets({ title: expData.title, rows: expData.rows, images });
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
      setImportProgress(null);
      $('#importPreviewInfo').textContent = 'กรุณาเลือกไฟล์ Excel ที่ส่งอกจากระบบ หรือไฟล์ทะเบียนสินทรัพย์ที่มีคอลัมน์รายการและรูปภาพฝังในตาราง';
      $('#confirmImportBtn').disabled = true;
      $('#confirmImportBtn').textContent = 'นำเข้าข้อมูล';
      $('#importDialog').showModal();
    });
  }

  if ($('#importFile')) {
    $('#importFile').addEventListener('change', async () => {
      const file = $('#importFile').files && $('#importFile').files[0];
      parsedImportItems = null;
      $('#importError').textContent = '';
      setImportProgress(null);
      $('#confirmImportBtn').disabled = true;
      $('#confirmImportBtn').textContent = 'นำเข้าข้อมูล';
      if (!file) return;
      $('#importPreviewInfo').textContent = 'กำลังอ่านไฟล์ "' + file.name + '"…';
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const parsed = parseAssetsWorkbook(buf);
        parsedImportItems = parsed;
        const s = parsed.summary || {};
        $('#importPreviewInfo').textContent =
          'อ่านไฟล์ "' + file.name + '" สำเร็จ · พบสินทรัพย์ ' + fmtInt.format(parsed.items.length) +
          ' รายการ · รูปภาพ ' + fmtInt.format(parsed.imageCount) + ' รูป · ' +
          'รวม ' + fmtMoney.format(s.total || 0) + ' บาท · ' +
          'ค่าเสื่อมราคาสะสม (ยกมา ' + fmtMoney.format(s.opening || 0) +
          ' / เพิ่ม ' + fmtMoney.format(s.increase || 0) +
          ' / ลด ' + fmtMoney.format(s.decrease || 0) +
          ' / ยกไป ' + fmtMoney.format(s.closing || 0) + ') · ' +
          'ราคาสินทรัพย์สุทธิ ' + fmtMoney.format(s.net || 0) + ' บาท';
        $('#confirmImportBtn').disabled = false;
      } catch (e) {
        $('#importError').textContent = e.message;
        $('#importPreviewInfo').textContent = 'ไม่สามารถอ่านข้อมูลจากไฟล์ที่เลือกได้';
      }
    });
  }

  if ($('#importForm')) {
    $('#importForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (saving || !parsedImportItems || !data || !data.me.edit) return;
      saving = true;
      const btn = $('#confirmImportBtn');
      btn.disabled = true;
      $('#importError').textContent = '';

      try {
        const mode = $('#importMode').value;
        const rawItems = parsedImportItems.items;

        const uniqueImages = new Map();
        const preparedMap = new Map();
        rawItems.forEach((it, idx) => {
          if (it.imageData) {
            const key = it.imageData.path || ('row_' + idx);
            if (!uniqueImages.has(key)) uniqueImages.set(key, it.imageData);
          }
        });

        const uniqueKeys = Array.from(uniqueImages.keys());
        let doneImages = 0;
        const COMPRESS_CONCURRENCY = 8;
        if (uniqueKeys.length > 0) {
          setImportProgress(2, 'ขั้นตอนที่ 1/3: กำลังเตรียมและย่อขนาดรูปภาพ 0 / ' + fmtInt.format(uniqueKeys.length) + ' รูป…');
          for (let i = 0; i < uniqueKeys.length; i += COMPRESS_CONCURRENCY) {
            const slice = uniqueKeys.slice(i, i + COMPRESS_CONCURRENCY);
            await Promise.all(slice.map(async key => {
              const comp = await compressImageObj(uniqueImages.get(key), 480, 42000);
              if (comp && comp.data) {
                const fid = await computeImageFid(comp.mime, comp.data);
                preparedMap.set(key, { fid, mime: comp.mime, data: comp.data });
              }
              doneImages++;
            }));
            const pct = Math.round((doneImages / uniqueKeys.length) * 30);
            btn.textContent = 'กำลังนำเข้า ' + pct + '%';
            setImportProgress(pct, 'ขั้นตอนที่ 1/3: ย่อขนาดรูปภาพแล้ว ' + fmtInt.format(doneImages) + ' / ' + fmtInt.format(uniqueKeys.length) + ' รูป');
          }
        }

        const imagesByFid = new Map();
        const metadataItems = rawItems.map((it, idx) => {
          const copy = Object.assign({}, it);
          if (copy.imageData) {
            const key = copy.imageData.path || ('row_' + idx);
            const prep = preparedMap.get(key);
            delete copy.imageData;
            if (prep) {
              copy.imageFid = prep.fid;
              imagesByFid.set(prep.fid, prep);
            }
          }
          return copy;
        });

        btn.textContent = 'กำลังนำเข้า 35%';
        setImportProgress(35, 'ขั้นตอนที่ 2/3: กำลังบันทึกรายการสินทรัพย์ ' + fmtInt.format(metadataItems.length) + ' รายการ…');
        let res;
        try {
          res = await call('assetsImport', { mode, items: metadataItems, title: parsedImportItems.title });
        } catch (err) {
          if (/ไม่รู้จักคำสั่ง/.test(err.message)) {
            throw new Error('กรุณาอัปเดตโค้ด Cloudflare Worker (worker-copy.txt) รุ่นล่าสุดในหน้า Cloudflare Dashboard แล้วกด Deploy ก่อนนำเข้าไฟล์ Excel');
          }
          throw err;
        }

        const missingFids = Array.isArray(res.missingFids)
          ? res.missingFids.filter(fid => imagesByFid.has(fid))
          : Array.from(imagesByFid.keys());

        if (missingFids.length > 0) {
          const batches = [];
          let curBatch = [], curBytes = 0;
          for (const fid of missingFids) {
            const img = imagesByFid.get(fid);
            const size = img.data.length;
            if (curBatch.length > 0 && (curBatch.length >= 15 || curBytes + size > 450000)) {
              batches.push(curBatch);
              curBatch = [];
              curBytes = 0;
            }
            curBatch.push(img);
            curBytes += size;
          }
          if (curBatch.length) batches.push(curBatch);

          let uploadedCount = 0;
          const UPLOAD_CONCURRENCY = 3;
          for (let b = 0; b < batches.length; b += UPLOAD_CONCURRENCY) {
            const group = batches.slice(b, b + UPLOAD_CONCURRENCY);
            await Promise.all(group.map(async batchList => {
              try {
                await call('assetsUploadImagesBatch', batchList);
              } catch (_) {
                await new Promise(r => setTimeout(r, 400));
                await call('assetsUploadImagesBatch', batchList);
              }
              uploadedCount += batchList.length;
              const pct = 35 + Math.round((uploadedCount / missingFids.length) * 65);
              btn.textContent = 'กำลังนำเข้า ' + pct + '%';
              setImportProgress(pct, 'ขั้นตอนที่ 3/3: อัปโหลดรูปภาพแล้ว ' + fmtInt.format(uploadedCount) + ' / ' + fmtInt.format(missingFids.length) + ' รูป');
            }));
          }
        }

        setImportProgress(100, 'นำเข้าข้อมูลและรูปภาพครบถ้วน');
        $('#importDialog').close();
        setImportProgress(null);
        parsedImportItems = null;
        page = 1;
        toast('นำเข้า Excel สำเร็จ ' + fmtInt.format(res.count) + ' รายการ พร้อมรูปภาพ ' + fmtInt.format(preparedMap.size) + ' รูป');
        await load();
      } catch (err) {
        $('#importError').textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'นำเข้าข้อมูลอีกครั้ง';
      } finally {
        saving = false;
        if (!parsedImportItems) btn.textContent = 'นำเข้าข้อมูล';
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
        const full = await call('assetsExport', { q: $('#search').value.trim(), status: $('#statusFilter').value, location: $('#locationFilter').value, metaOnly: true });
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
    const normalToggle = e.target.closest('[data-normal-toggle]');
    if (normalToggle && data && data.me && data.me.edit) {
      const row = data.rows.find(r => r.id === normalToggle.dataset.normalToggle);
      if (row) {
        const nextMark = nextNormalMark(row.id, getNormalMark(row));
        row.normalMark = nextMark;
        if (nextMark === 'check') row.status = 'normal';
        syncRowStatusDom(row);
        queueRowStatusSave(row);
      }
      return;
    }
    const statusToggle = e.target.closest('[data-status-toggle]');
    if (statusToggle && data && data.me && data.me.edit) {
      const row = data.rows.find(r => r.id === statusToggle.dataset.statusToggle);
      const key = statusToggle.dataset.statusKey;
      if (row && key) {
        if (row.status === key) {
          row.status = 'normal';
        } else {
          row.status = key;
          if (getNormalMark(row) === 'check') row.normalMark = 'none';
        }
        syncRowStatusDom(row);
        queueRowStatusSave(row);
      }
      return;
    }
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
    Object.assign(window, { xlsxBuildAssets, parseAssetsWorkbook, buildStickerQrSvg, stickerCardHtml, formatStickerDate, assetQrLink, computeImageFid, getNormalMark, nextNormalMark });
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
