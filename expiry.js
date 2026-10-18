(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
  const timeFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  const numFmt = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 });
  const date = iso => dateFmt.format(new Date(iso + 'T00:00:00Z'));
  const time = ts => timeFmt.format(new Date(ts));
  const ranges = [
    ['all', 'ล็อตที่เปิดแจ้งเตือน', 'ทุกช่วงเวลา'], ['expired', 'หมดอายุแล้ว', 'เลยวันหมดอายุ'],
    ['week', 'ภายใน 7 วัน', 'รวมวันนี้'], ['month', 'ภายใน 1 เดือน', 'เกิน 7 วัน'],
    ['m3', '1–3 เดือน', 'เกิน 1 ถึง 3 เดือน'], ['m6', '3–6 เดือน', 'เกิน 3 ถึง 6 เดือน'], ['m12', '6–12 เดือน', 'เกิน 6 ถึง 12 เดือน']
  ];
  const labels = Object.fromEntries(ranges.map(([key, title]) => [key, title])); labels.later = 'เกิน 12 เดือน';
  const statusLabels = { active: 'ยังไม่รับทราบ', acknowledged: 'รับทราบแล้ว', closed: 'ปิดแจ้งเตือนแล้ว' };
  let token = '', user = null, data = null, bucket = 'all', page = 1, loadSeq = 0, lookupSeq = 0, historySeq = 0, timer, searchTimer, toastTimer, formState = null, saving = false;
  let formLocked = false, catalog = null, catalogError = '', matches = [], productSelection = null, manualMode = false, lookupTimer;
  const fields = ['barcode', 'productName', 'branch', 'location', 'expires', 'quantity', 'unit', 'note'];
  function toast(message, error = false) {
    if (message === 'SESSION_CHANGED') return;
    const el = $('#toast'); el.textContent = message; el.classList.toggle('error-toast', error); el.setAttribute('role', error ? 'alert' : 'status'); el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, error ? 10000 : 5000);
  }
  function call(fn, ...args) {
    const requestToken = token;
    if (fn !== 'login') args.unshift(requestToken);
    return new Promise((resolve, reject) => {
      const r = google.script.run.withSuccessHandler(result => {
        if (fn !== 'login' && requestToken !== token) { reject(new Error('SESSION_CHANGED')); return; }
        resolve(result);
      }).withFailureHandler(error => {
        const message = error && error.message || String(error);
        if (fn !== 'login' && requestToken !== token) { reject(new Error('SESSION_CHANGED')); return; }
        if (message === 'SESSION_EXPIRED') showLogin('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง');
        reject(new Error(message));
      });
      r[fn](...args);
    });
  }
  function storageGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function storageSet(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  const draftPrefix = () => 'cmucoop_expiry_pending:' + encodeURIComponent(user.user) + ':';
  const draftKey = requestId => draftPrefix() + requestId;
  function pendingDraft() {
    try {
      const prefix = draftPrefix();
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i); if (!key.startsWith(prefix)) continue;
        try { const p = JSON.parse(localStorage.getItem(key)); if (p && p.requestId && p.name && p.expires) return p; } catch (_) {}
      }
    } catch (_) {}
    return null;
  }
  function clearDraft(requestId) { try { localStorage.removeItem(draftKey(requestId)); } catch (_) {} }
  function showLogin(message = '') {
    closeCamera(); catalog = null; catalogError = ''; productSelection = null; matches = [];
    token = ''; user = null; data = null; formState = null; loadSeq++; lookupSeq++; historySeq++; clearInterval(timer);
    try { sessionStorage.removeItem('pm_tok'); sessionStorage.removeItem('pm_me'); } catch (_) {}
    $('#workspace').hidden = true; $('#loginPanel').hidden = false; $('#logout').hidden = true; $('#me').textContent = '';
    $('#productResults').innerHTML = ''; $('#branch').innerHTML = '<option value="">เลือกสาขา</option>'; $('#productSearch').value = '';
    $('#rows').innerHTML = ''; $('#stats').innerHTML = ''; $('#historyContent').innerHTML = ''; $('#lotForm').reset(); $('#password').value = '';
    $('#lotDialog').close(); $('#historyDialog').close(); $('#loginError').textContent = message;
  }
  async function startApp() {
    const me = await call('whoami');
    if (me.role !== 'admin' && !(me.perms && me.perms.expiry)) { showLogin('บัญชีนี้ยังไม่มีสิทธิ์ระบบแจ้งเตือนสินค้าหมดอายุ กรุณาให้ Admin เปิดสิทธิ์ในหน้าตั้งค่า'); return; }
    user = me;
    try { sessionStorage.setItem('pm_tok', token); } catch (_) {}
    $('#loginPanel').hidden = true; $('#workspace').hidden = false; $('#logout').hidden = false; $('#me').textContent = me.name + (me.role === 'admin' ? ' · Admin' : '');
    $('#addLot').hidden = !(me.role === 'admin' || me.perms.expiry_edit);
    await load(); clearInterval(timer);
    timer = setInterval(() => { if (token && !document.hidden) load(true); }, 60000);
  }
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('#loginButton'); button.disabled = true; $('#loginError').textContent = '';
    try {
      const me = await call('login', $('#username').value.trim(), $('#password').value);
      token = me.token; await startApp();
    } catch (e) { $('#loginError').textContent = e.message; }
    finally { $('#password').value = ''; button.disabled = false; }
  });
  $('#logout').addEventListener('click', async () => { try { await call('logout'); } catch (_) {} showLogin(); });
  function options() { return { page, bucket, q: $('#search').value.trim(), branch: $('#branchFilter').value, state: $('#stateFilter').value }; }
  async function load(quiet = false) {
    if (!token || !user) return;
    const seq = ++loadSeq, requestToken = token, request = { ...options(), refreshId: seq };
    if (!quiet) { $('#refresh').disabled = true; $('#resultInfo').textContent = 'กำลังโหลดรายการ…'; }
    try {
      const [result, source] = await Promise.all([
        call('expiryList', request),
        call('expiryCatalog').then(value => ({ value }), error => ({ error: error.message }))
      ]);
      if (seq !== loadSeq || requestToken !== token) return;
      data = result; catalog = source.value || null; catalogError = source.error || '';
      $('#catalogNotice').textContent = catalog ? 'เชื่อมข้อมูลสินค้าและสาขาจากระบบสินค้าค้างสต็อกแล้ว · ค้นหาด้วยรหัส ชื่อ หรือกล้องสแกนบาร์โค้ด' : 'โหลดสินค้า / สาขาไม่สำเร็จ: ' + catalogError + ' · ล็อตเดิมยังเปิดดูได้ กรุณาโหลดข้อมูลล่าสุดก่อนเพิ่มล็อต';
      const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (page > pages) { page = pages; return load(quiet); }
      $('#loadError').hidden = true; render();
    } catch (e) {
      if (seq !== loadSeq || requestToken !== token) return;
      $('#loadError').textContent = 'โหลดข้อมูลไม่สำเร็จ: ' + e.message + ' · ข้อมูลที่เห็นอาจยังไม่ใช่ข้อมูลล่าสุด'; $('#loadError').hidden = false;
      if (!quiet) toast(e.message, true);
    } finally { if (seq === loadSeq) $('#refresh').disabled = false; }
  }
  function render() {
    const counts = data.counts, urgent = counts.expired + counts.week;
    $('#urgent').textContent = urgent ? 'มี ' + numFmt.format(urgent) + ' ล็อตที่หมดอายุแล้วหรือจะหมดอายุภายใน 7 วัน กรุณาตรวจสอบรายการ' : 'ยังไม่มีล็อตที่หมดอายุแล้วหรือจะหมดอายุภายใน 7 วัน';
    $('#urgent').classList.toggle('calm', !urgent);
    $('#stats').innerHTML = ranges.map(([key, title, desc]) => '<button type="button" class="stat ' + key + '" data-bucket="' + key + '" aria-pressed="' + (bucket === key) + '"><span>' + title + '</span><strong>' + numFmt.format(key === 'all' ? counts.total : counts[key]) + '</strong><small>ล็อต · ' + desc + '</small></button>').join('');
    const selected = $('#branchFilter').value, branches = [...new Set([...data.branches, ...(catalog ? catalog.branches : [])])].sort();
    if (selected && !branches.includes(selected)) branches.push(selected);
    $('#branchFilter').innerHTML = '<option value="">ทุกสาขา</option>' + branches.map(b => '<option value="' + esc(b) + '">' + esc(b) + '</option>').join(''); $('#branchFilter').value = selected;
    $('#rows').innerHTML = data.rows.length ? data.rows.map(rowHtml).join('') : '<tr><td colspan="7" class="empty"><strong>' + (data.counts.total === 0 && $('#stateFilter').value === 'open' && !$('#search').value ? 'ยังไม่มีล็อตที่เปิดแจ้งเตือน' : 'ไม่พบรายการตามตัวกรอง') + '</strong>เพิ่มล็อตใหม่ หรือเปลี่ยนช่วงเวลา สาขา และคำค้นหา</td></tr>';
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    $('#pageInfo').textContent = 'หน้า ' + page + ' / ' + numFmt.format(pages); $('#prev').disabled = page <= 1; $('#next').disabled = page >= pages;
    $('#resultInfo').textContent = numFmt.format(data.total) + ' ล็อต · ' + labels[bucket] + ' · ' + ($('#stateFilter').selectedOptions[0].textContent);
    $('#listTitle').textContent = bucket === 'all' ? 'รายการล็อต' : labels[bucket];
    $('#later').hidden = !counts.later; $('#later').textContent = 'ดูล็อตที่เหลือเกิน 12 เดือน (' + numFmt.format(counts.later) + ' ล็อต)';
    $('#updated').textContent = 'โหลดล่าสุด ' + time(Date.now()); $('#addLot').hidden = !data.me.edit;
  }
  function rowHtml(r) {
    const dayText = r.days < 0 ? 'เลยกำหนด ' + numFmt.format(-r.days) + ' วัน' : r.days === 0 ? 'หมดอายุวันนี้' : 'อีก ' + numFmt.format(r.days) + ' วัน';
    const quantity = r.quantity === null ? '<span class="muted">ไม่ระบุ</span>' : numFmt.format(r.quantity) + ' ' + esc(r.unit);
    const action = (label, name, extra = '') => '<button type="button" class="action ' + extra + '" data-action="' + name + '" data-id="' + r.id + '">' + label + '</button>';
    let actions = action('ประวัติ', 'history');
    if (data.me.edit) {
      actions = action('แก้ไข', 'edit') + actions;
      if (r.status === 'active') actions += action('รับทราบ', 'acknowledged');
      actions += r.status === 'closed' ? action('เปิดอีกครั้ง', 'active') : action('ปิดแจ้งเตือน', 'closed', 'close');
    }
    return '<tr><td data-label="ล็อต"><span class="lot-number">' + esc(r.lot) + '</span><small>' + time(r.createdTs) + '</small><small>' + esc(r.createdBy) + '</small></td>' +
      '<td data-label="สินค้า"><div class="product">' + esc(r.name) + '</div><small class="barcode">' + esc(r.barcode || 'ไม่ได้ระบุบาร์โค้ด') + '</small>' + (r.note ? '<small>' + esc(r.note.slice(0, 70)) + '</small>' : '') + '</td>' +
      '<td data-label="สาขา / จุดวาง">' + esc(r.branch) + '<small>' + esc(r.location || 'ไม่ระบุจุดวาง') + '</small></td>' +
      '<td data-label="วันหมดอายุ">' + date(r.expires) + '<small><span class="badge ' + r.bucket + '">' + dayText + '</span></small></td>' +
      '<td data-label="จำนวน">' + quantity + '</td><td data-label="สถานะ"><span class="badge ' + r.status + '">' + statusLabels[r.status] + '</span></td>' +
      '<td data-label="จัดการ"><div class="actions">' + actions + '</div></td></tr>';
  }
  function selectBucket(key) { bucket = key; page = 1; $('#stateFilter').value = 'open'; load(); }
  $('#stats').addEventListener('click', e => { const b = e.target.closest('[data-bucket]'); if (b) selectBucket(b.dataset.bucket); });
  $('#later').addEventListener('click', () => selectBucket('later'));
  $('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 1; load(); }, 250); });
  $('#branchFilter').addEventListener('change', () => { page = 1; load(); });
  $('#stateFilter').addEventListener('change', () => { page = 1; bucket = 'all'; load(); });
  $('#refresh').addEventListener('click', () => load()); $('#prev').addEventListener('click', () => { page--; load(); }); $('#next').addEventListener('click', () => { page++; load(); });
  function currentFields() {
    return { barcode: $('#barcode').value.trim(), name: $('#productName').value.trim(), branch: $('#branch').value.trim(), location: $('#location').value.trim(), expires: $('#expires').value,
      quantity: $('#quantity').value === '' ? null : Number($('#quantity').value), unit: $('#unit').value.trim(), note: $('#note').value.trim(), stockSource: !manualMode, manualEntry: manualMode };
  }
  function fillForm(r) {
    setManualMode(r.manualEntry === true);
    populateBranches(r.branch || '', !!(r.branch && (formState && formState.id || r.requestId)));
    $('#barcode').value = r.barcode || ''; $('#productName').value = r.name || ''; $('#branch').value = r.branch || ''; $('#location').value = r.location || '';
    $('#expires').value = r.expires || ''; $('#quantity').value = r.quantity == null ? '' : r.quantity; $('#unit').value = r.unit || ''; $('#note').value = r.note || '';
  }
  function lockForm(locked) { formLocked = locked; $('#lotFields').disabled = locked; $('#pendingNotice').hidden = !locked; }
  function populateBranches(selected = '', keepOld = false) {
    const list = catalog ? catalog.branches.slice() : [];
    let legacy = '';
    if (selected && !list.includes(selected)) { if (keepOld) { list.push(selected); legacy = selected; } else selected = ''; }
    $('#branch').innerHTML = '<option value="">เลือกสาขา</option>' + list.map(value => '<option value="' + esc(value) + '">' + esc(value) + (value === legacy ? ' (ข้อมูลเดิม)' : '') + '</option>').join('');
    $('#branch').value = selected || (list.length === 1 && !keepOld ? list[0] : '');
  }
  function setManualMode(enabled) {
    manualMode = enabled; $('#barcode').readOnly = !enabled; $('#productName').readOnly = !enabled;
    $('#barcode').required = !enabled; $('#selectedProduct').classList.toggle('manual-mode', enabled);
    $('#barcodeLabel').textContent = enabled ? 'รหัสสินค้า / บาร์โค้ด (ถ้ามี)' : 'รหัสสินค้าจากระบบ';
    $('#barcode').placeholder = enabled ? 'กรอกรหัส หรือเว้นว่างได้' : 'เติมเมื่อเลือกสินค้า';
    $('#productName').placeholder = enabled ? 'กรอกชื่อสินค้า' : 'เติมเมื่อเลือกสินค้า';
  }
  function clearResults() { matches = []; $('#productResults').innerHTML = ''; $('#productResults').hidden = true; $('#manualEntry').hidden = true; }
  function resetProduct() { setManualMode(false); productSelection = null; $('#barcode').value = ''; $('#productName').value = ''; }
  function prepareLookup() {
    lookupSeq++; clearTimeout(lookupTimer); clearResults(); closeCamera();
    $('#productSearch').value = ''; $('#lookup').disabled = false;
    $('#lookupInfo').textContent = catalogError || 'เลือกสาขา แล้วค้นหาชื่อ / รหัสสินค้า หรือกดเปิดกล้องสแกน';
  }
  function openNew() {
    if (!user || !data || !data.me.edit) return;
    const pending = pendingDraft();
    if (!pending && (!catalog || !catalog.branches.length)) { toast(catalogError || 'ยังไม่มีสาขาในระบบสินค้าค้างสต็อก กรุณาเพิ่มสาขาหรือนำเข้าข้อมูลที่หน้าสินค้าค้างสต็อกก่อน', true); return; }
    $('#lotForm').reset(); $('#formError').textContent = ''; prepareLookup(); resetProduct();
    $('#formTitle').textContent = 'เพิ่มรายการแจ้งเตือน'; $('#formEyebrow').textContent = 'สร้างล็อตใหม่ · เลขล็อตอัตโนมัติ'; $('#saveNext').hidden = false; $('#save').textContent = 'บันทึกล็อต';
    formState = { id: null, requestId: crypto.randomUUID().replace(/-/g, ''), payload: null };
    if (pending && pending.requestId && pending.name && pending.expires) { formState.requestId = pending.requestId; formState.payload = pending; fillForm(pending); $('#barcode').required = false; lockForm(true); }
    else { fillForm({ branch: $('#branchFilter').value || storageGet('cmucoop_expiry_branch:' + user.user) || '' }); lockForm(false); }
    if (!$('#lotDialog').open) $('#lotDialog').showModal();
    $('#lotScroll').scrollTop = 0;
    if (!formLocked) ($('#branch').value ? $('#productSearch') : $('#branch')).focus(); else $('#save').focus();
  }
  function openEdit(row) {
    formState = { id: row.id, version: row.version, payload: null };
    $('#lotForm').reset(); prepareLookup(); fillForm(row); lockForm(false); $('#barcode').required = false; $('#formError').textContent = '';
    productSelection = { code: row.barcode, name: row.name, branch: row.branch };
    $('#lookupInfo').textContent = 'เก็บชื่อและรหัสตามล็อตเดิม หากต้องการเปลี่ยนสินค้าให้ค้นหาแล้วเลือกรายการใหม่';
    $('#formTitle').textContent = 'แก้ไข ' + row.lot; $('#formEyebrow').textContent = 'แก้ไขเฉพาะล็อตนี้'; $('#saveNext').hidden = true; $('#save').textContent = 'บันทึกการแก้ไข';
    $('#lotDialog').showModal(); $('#expires').focus();
  }
  $('#addLot').addEventListener('click', openNew);
  function closeForm() { if (!saving) { closeCamera(); $('#lotDialog').close(); lookupSeq++; clearTimeout(lookupTimer); } }
  $('#closeForm').addEventListener('click', closeForm); $('#cancelForm').addEventListener('click', closeForm);
  $('#lotDialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  $('#lotDialog').addEventListener('close', () => { lookupSeq++; clearTimeout(lookupTimer); closeCamera(); });
  function chooseProduct(row) {
    setManualMode(false); productSelection = row; $('#barcode').value = row.code; $('#productName').value = row.name; $('#branch').value = row.branch;
    $('#barcode').required = true; clearResults();
    $('#lookupInfo').textContent = 'เลือกแล้ว: ' + row.code + ' · ' + row.name + ' · ' + row.branch;
  }
  async function lookup() {
    clearTimeout(lookupTimer);
    const query = $('#productSearch').value.trim(), branch = $('#branch').value;
    if (formLocked || saving) return;
    const seq = ++lookupSeq, activeForm = formState; clearResults();
    if (query.length < 2) { $('#lookup').disabled = false; $('#lookupInfo').textContent = 'พิมพ์รหัสหรือชื่อสินค้าอย่างน้อย 2 ตัวอักษร'; return; }
    $('#lookup').disabled = true; $('#lookupInfo').textContent = 'กำลังค้นหาในระบบสินค้าค้างสต็อก…';
    try {
      const result = await call('expiryLookup', query, branch);
      if (seq !== lookupSeq || activeForm !== formState || !$('#lotDialog').open || query !== $('#productSearch').value.trim() || branch !== $('#branch').value) return;
      matches = result.rows;
      if (matches.length === 1) { chooseProduct(matches[0]); return; }
      $('#productResults').innerHTML = matches.map((r, i) => '<button type="button" class="product-choice" data-product="' + i + '"><strong>' + esc(r.name) + '</strong><span>' + esc(r.code) + ' · ' + esc(r.branch) + ' · หมวด ' + esc(r.category) + '</span></button>').join('');
      $('#productResults').hidden = !matches.length;
      $('#manualEntry').hidden = !!matches.length;
      $('#lookupInfo').textContent = matches.length ? (result.more ? 'พบมากกว่า 30 รายการ แสดง 30 รายการแรก พิมพ์เพิ่มเพื่อค้นหาให้แคบลง' : 'พบ ' + matches.length + ' รายการ กรุณาเลือกสินค้าที่ต้องการ') : 'ไม่พบสินค้าในสาขาที่เลือก กด “กรอกสินค้าเอง” เพื่อระบุชื่อและรหัสสินค้าได้';
    } catch (e) { if (seq === lookupSeq) $('#lookupInfo').textContent = e.message; }
    finally { if (seq === lookupSeq) $('#lookup').disabled = false; }
  }
  $('#productResults').addEventListener('click', event => { const button = event.target.closest('[data-product]'); if (button && matches[Number(button.dataset.product)]) { chooseProduct(matches[Number(button.dataset.product)]); $('#expires').focus(); } });
  $('#manualEntry').addEventListener('click', () => {
    if (formLocked || saving || !$('#lotDialog').open) return;
    if (!$('#branch').value) { $('#lookupInfo').textContent = 'เลือกสาขาก่อน แล้วกด “กรอกสินค้าเอง”'; $('#branch').focus(); return; }
    const query = $('#productSearch').value.trim();
    clearResults(); productSelection = null; setManualMode(true);
    const isCode = /^[pP]?\d{4,64}$/.test(query);
    $('#barcode').value = isCode ? query : ''; $('#productName').value = isCode ? '' : query.slice(0, 200);
    $('#lookupInfo').textContent = 'กรอกสินค้าเอง · ระบุชื่อสินค้า รหัสเว้นว่างได้ · บันทึกเป็นล็อตตามปกติ';
    $('#productName').focus();
  });
  $('#lookup').addEventListener('click', lookup);
  $('#productSearch').addEventListener('input', () => { resetProduct(); lookupSeq++; clearTimeout(lookupTimer); clearResults(); $('#lookup').disabled = false; lookupTimer = setTimeout(lookup, 450); });
  $('#productSearch').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); lookup().then(() => { if ($('#lotDialog').open && !formLocked && productSelection) $('#expires').focus(); }); } });
  $('#branch').addEventListener('change', () => { resetProduct(); lookupSeq++; clearResults(); if ($('#productSearch').value.trim()) lookup(); });
  const scanner = new window.CMUBarcodeScanner($('#cameraVideo'), (message, error = false) => { $('#cameraStatus').textContent = message; $('#cameraStatus').classList.toggle('error', error); }, code => {
    closeCamera(); if (!$('#lotDialog').open || formLocked || saving) return;
    resetProduct(); $('#productSearch').value = code; lookup().then(() => { if ($('#lotDialog').open && productSelection) $('#expires').focus(); });
  });
  function closeCamera() { if (typeof scanner !== 'undefined') scanner.stop(); if ($('#cameraDialog').open) $('#cameraDialog').close(); }
  $('#openCamera').addEventListener('click', () => { if (formLocked || saving || !$('#lotDialog').open) return; $('#cameraDialog').showModal(); scanner.start(); });
  $('#retryCamera').addEventListener('click', () => scanner.start());
  $('#closeCamera').addEventListener('click', closeCamera); $('#cancelCamera').addEventListener('click', () => { closeCamera(); $('#productSearch').focus(); });
  $('#cameraDialog').addEventListener('close', () => scanner.stop());
  document.addEventListener('visibilitychange', () => { if (document.hidden) closeCamera(); });
  window.addEventListener('pagehide', closeCamera);
  $('#lotForm').addEventListener('submit', async event => {
    event.preventDefault(); if (saving || !formState || !user) return;
    const next = event.submitter && event.submitter.dataset.next === 'yes', state = formState, owner = user.user;
    if (!state.payload && !$('#lotForm').reportValidity()) return;
    if (!state.payload && !manualMode && (!productSelection || productSelection.code !== $('#barcode').value || productSelection.name !== $('#productName').value || productSelection.branch !== $('#branch').value)) { $('#formError').textContent = 'กรุณาค้นหาและเลือกสินค้า หรือกดกรอกสินค้าเองเมื่อค้นหาไม่พบ'; return; }
    const payload = state.payload || currentFields();
    if (!state.id) { payload.requestId = state.requestId; state.payload = payload; storageSet(draftKey(state.requestId), JSON.stringify(payload)); }
    saving = true; $('#formError').textContent = ''; $('#save').disabled = true; $('#saveNext').disabled = true; $('#closeForm').disabled = true; $('#cancelForm').disabled = true; $('#lotFields').disabled = true;
    try {
      const result = state.id ? await call('expiryUpdate', state.id, state.version, payload) : await call('expiryCreate', payload);
      if (!user || user.user !== owner || state !== formState) return;
      if (!state.id) clearDraft(state.requestId); storageSet('cmucoop_expiry_branch:' + owner, payload.branch);
      $('#lotDialog').close(); toast((result.replayed ? 'รายการเดิมบันทึกแล้ว: ' : state.id ? 'แก้ไขแล้ว: ' : 'เพิ่มล็อตใหม่แล้ว: ') + result.lot.lot);
      page = 1;
      if (!state.id) { bucket = 'all'; $('#stateFilter').value = 'open'; $('#search').value = ''; $('#branchFilter').value = ''; }
      await load();
      if (next && !state.id) openNew();
    } catch (e) {
      if (!user || user.user !== owner) return;
      $('#formError').textContent = e.message;
      if (!state.id) {
        if (/^(กรุณา|จำนวนต้อง|วันหมดอายุไม่ถูกต้อง|รหัสคำขอไม่ถูกต้อง)/.test(e.message)) { state.payload = null; clearDraft(state.requestId); lockForm(false); }
        else lockForm(true);
      } else { await load(true); }
    } finally {
      saving = false; $('#save').disabled = false; $('#saveNext').disabled = false; $('#closeForm').disabled = false; $('#cancelForm').disabled = false; $('#lotFields').disabled = formLocked;
    }
  });
  $('#rows').addEventListener('click', async event => {
    const button = event.target.closest('[data-action]'); if (!button || !data) return;
    const row = data.rows.find(r => r.id === Number(button.dataset.id)); if (!row) return;
    const action = button.dataset.action;
    if (action === 'edit') { openEdit(row); return; }
    if (action === 'history') { await showHistory(row); return; }
    if (action === 'closed' && !confirm('ปิดแจ้งเตือน ' + row.lot + ' (' + row.name + ')?\nล็อตอื่นยังแจ้งเตือนตามเดิม และล็อตนี้ยังดูประวัติหรือเปิดอีกครั้งได้')) return;
    button.disabled = true;
    try { await call('expirySetStatus', row.id, row.version, action); toast(action === 'closed' ? 'ปิดแจ้งเตือนเฉพาะ ' + row.lot + ' แล้ว' : action === 'acknowledged' ? 'รับทราบแล้ว ล็อตนี้ยังแจ้งเตือนต่อจนกว่าจะปิด' : 'เปิดแจ้งเตือนอีกครั้งแล้ว'); await load(); }
    catch (e) { toast(e.message, true); await load(true); }
    finally { button.disabled = false; }
  });
  async function showHistory(row) {
    const seq = ++historySeq;
    $('#historyTitle').textContent = 'ประวัติ ' + row.lot; $('#historyContent').textContent = 'กำลังโหลด…'; $('#historyDialog').showModal();
    try {
      const result = await call('expiryHistory', row.id); if (seq !== historySeq || !$('#historyDialog').open) return;
      const r = result.lot;
      $('#historyContent').innerHTML = '<div class="history-meta"><div><strong>' + esc(r.name) + '</strong><br>' + esc(r.barcode || 'ไม่มีบาร์โค้ด') + '</div><div>' + esc(r.branch) + ' · ' + esc(r.location || 'ไม่ระบุจุดวาง') + '</div><div>หมดอายุ ' + date(r.expires) + '</div><div>จำนวน: ' + (r.quantity == null ? 'ไม่ระบุ' : numFmt.format(r.quantity) + ' ' + esc(r.unit)) + '</div><div>สถานะ: ' + statusLabels[r.status] + '</div><div>หมายเหตุ: ' + esc(r.note || '—') + '</div></div><p class="helper">แสดงประวัติล่าสุดไม่เกิน 100 รายการ</p>' +
        result.events.map(e => '<div class="history-event"><strong>' + esc(e.action) + '</strong><small>' + time(e.ts) + ' · ' + esc(e.who) + ' · รุ่น ' + e.version + '</small><details><summary>รายละเอียดการบันทึก</summary><pre>' + esc(historyDetail(e.detail)) + '</pre></details></div>').join('');
    } catch (e) { if (seq === historySeq) $('#historyContent').textContent = e.message; }
  }
  function historyDetail(raw) {
    try {
      const d = JSON.parse(raw), names = { barcode: 'บาร์โค้ด', name: 'สินค้า', branch: 'สาขา', location: 'จุดวาง', expires: 'วันหมดอายุ', quantity: 'จำนวน', unit: 'หน่วย', note: 'หมายเหตุ', status: 'สถานะ' };
      const show = value => value == null || value === '' ? 'ไม่ระบุ' : String(value);
      if (d.from) return statusLabels[d.from] + ' → ' + statusLabels[d.to];
      const after = d.after || d, before = d.before;
      return Object.keys(names).filter(k => Object.hasOwn(after, k) && (!before || before[k] !== after[k])).map(k => names[k] + ': ' + (before ? show(before[k]) + ' → ' : '') + show(after[k])).join('\n');
    } catch (_) { return String(raw); }
  }
  $('#closeHistory').addEventListener('click', () => { historySeq++; $('#historyDialog').close(); });
  $('#historyDialog').addEventListener('close', () => { historySeq++; });
  (async function init() {
    const hash = new URLSearchParams(location.hash.slice(1));
    try { token = hash.get('t') || sessionStorage.getItem('pm_tok') || ''; } catch (_) { token = hash.get('t') || ''; }
    if (hash.has('t')) history.replaceState(null, '', location.pathname + location.search);
    if (!token) { $('#username').focus(); return; }
    try { await startApp(); } catch (e) { showLogin(e.message === 'SESSION_EXPIRED' ? 'กรุณาเข้าสู่ระบบอีกครั้ง' : e.message); }
  })();
})();
