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
  const amount = value => value == null ? '<span class="muted">–</span>' : fmtMoney.format(value);
  const date = value => value ? fmtDate.format(new Date(value + 'T00:00:00Z')) : '–';
  function safeUrl(value) { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; } }
  function toast(message, error = false) {
    if (message === 'SESSION_CHANGED') return;
    const el = $('#toast'); el.textContent = message; el.hidden = false; el.classList.toggle('error-toast', error); el.setAttribute('role', error ? 'alert' : 'status');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, error ? 10000 : 5000);
  }
  function call(fn, ...args) {
    const sentToken = token;
    if (fn !== 'login') args.unshift(sentToken);
    return new Promise((resolve, reject) => {
      const run = google.script.run.withSuccessHandler(result => {
        if (fn !== 'login' && sentToken !== token) return reject(new Error('SESSION_CHANGED'));
        resolve(result);
      }).withFailureHandler(error => {
        if (fn !== 'login' && sentToken !== token) return reject(new Error('SESSION_CHANGED'));
        const message = error && error.message || String(error);
        if (message === 'SESSION_EXPIRED') showLogin('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง');
        reject(new Error(message));
      });
      run[fn](...args);
    });
  }
  function showLogin(message = '') {
    token = ''; user = null; data = null; formState = null; loadSeq++;
    try { sessionStorage.removeItem('pm_tok'); sessionStorage.removeItem('pm_me'); } catch (_) {}
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    $('#workspace').hidden = true; $('#loginPanel').hidden = false; $('#logout').hidden = true; $('#me').textContent = '';
    $('#rows').innerHTML = ''; $('#stats').innerHTML = ''; $('#totals').innerHTML = ''; $('#password').value = ''; $('#loginError').textContent = message;
  }
  async function startApp() {
    const me = await call('whoami');
    if (!(me.perms && me.perms.assets)) { showLogin('บัญชีนี้ยังไม่มีสิทธิ์รายการสินทรัพย์ กรุณาให้ Admin เปิดสิทธิ์ในหน้าตั้งค่า'); return; }
    user = me; $('#loginPanel').hidden = true; $('#workspace').hidden = false; $('#logout').hidden = false;
    $('#me').textContent = me.name + (me.role === 'admin' ? ' · Admin' : '');
    try { sessionStorage.setItem('pm_tok', token); sessionStorage.setItem('pm_me', JSON.stringify(me)); } catch (_) {}
    await load();
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
    const photo = url ? '<button type="button" class="photo-button" data-image="' + esc(r.id) + '" aria-label="ดูภาพ ' + esc(r.name) + '"><img class="thumb" src="' + esc(url) + '" alt="' + esc(r.name) + '" loading="lazy" referrerpolicy="no-referrer"></button>' : '<span class="photo-empty">ไม่มีรูปภาพ</span>';
    return '<tr><td class="seq-cell">' + fmtInt.format(r.seq) + '</td><td>' + photo + '</td><td>' + (url ? '<a class="image-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.imageUrl) + '</a>' : '<span class="muted">–</span>') + '</td>' +
      '<td><span class="asset-name">' + esc(r.name) + '</span></td><td class="asset-code">' + esc(r.code || '–') + '</td><td>' + date(r.received) + '</td><td>' + esc(r.location || '–') + '</td>' +
      Object.entries(statuses).map(([key, label]) => '<td class="status-cell"><input type="checkbox" disabled' + (r.status === key ? ' checked' : '') + ' aria-label="' + esc(label + ': ' + r.name) + '"></td>').join('') +
      '<td class="num">' + amount(r.total) + '</td><td class="num">' + (r.rate == null ? '–' : fmtMoney.format(r.rate) + '%') + '</td>' + ['opening', 'increase', 'decrease', 'closing', 'net'].map(k => '<td class="num">' + amount(r[k]) + '</td>').join('') +
      '<td class="note">' + esc(r.note) + '</td><td class="action-cell"><button type="button" class="action-button" data-edit="' + esc(r.id) + '">' + (data.me.edit ? 'แก้ไข' : 'ดูข้อมูล') + '</button></td></tr>';
  }
  function formValues() {
    const p = { seq: Number($('#seq').value), name: $('#assetName').value.trim(), code: $('#assetCode').value.trim(), received: $('#received').value,
      location: $('#assetLocation').value.trim(), imageUrl: $('#imageUrl').value.trim(), status: $('#assetForm input[name="status"]:checked').value, note: $('#note').value.trim() };
    for (const key of [...moneyKeys, 'rate']) p[key] = $('#' + key).value === '' ? null : Number($('#' + key).value);
    return p;
  }
  function previewImage() {
    const url = safeUrl($('#imageUrl').value.trim());
    $('#imagePreview').innerHTML = url ? '<img src="' + esc(url) + '" alt="ตัวอย่างรูปภาพสินทรัพย์" referrerpolicy="no-referrer">' : '<span>ตัวอย่างรูปภาพ</span>';
  }
  function openForm(r = null) {
    if (!data || !user) return;
    if (!r && !data.me.edit) return;
    formState = r ? { id: r.id, version: r.version, requestId: null } : { id: null, requestId: crypto.randomUUID(), version: null };
    $('#assetForm').reset(); $('#formError').textContent = '';
    const values = r || { seq: data.nextSeq, status: 'normal' };
    const map = { seq: 'seq', name: 'assetName', code: 'assetCode', received: 'received', location: 'assetLocation', imageUrl: 'imageUrl', note: 'note' };
    Object.entries(map).forEach(([key, id]) => { $('#' + id).value = values[key] == null ? '' : values[key]; });
    for (const key of [...moneyKeys, 'rate']) $('#' + key).value = values[key] == null ? '' : values[key];
    $('#assetForm input[name="status"][value="' + values.status + '"]').checked = true;
    $('#assetFields').disabled = !data.me.edit; $('#saveAsset').hidden = !data.me.edit; $('#deleteAsset').hidden = !r || !data.me.edit;
    $('#formTitle').textContent = r ? (data.me.edit ? 'แก้ไขสินทรัพย์' : 'รายละเอียดสินทรัพย์') : 'เพิ่มสินทรัพย์';
    $('#formMeta').textContent = r ? 'แก้ไขล่าสุด ' + fmtTime.format(new Date(r.updatedTs)) + ' · ' + r.updatedBy : 'ช่องที่เว้นว่างจะแสดงเป็นขีดในตาราง';
    previewImage(); $('#assetDialog').showModal(); $('#assetDialog').scrollTop = 0;
    if (data.me.edit) $('#assetName').focus({ preventScroll: true });
    $('#assetDialog').scrollTop = 0;
  }
  $('#assetForm').addEventListener('submit', async e => {
    e.preventDefault(); if (saving || !formState || !data.me.edit) return;
    saving = true; $('#saveAsset').disabled = true; $('#formError').textContent = '';
    const state = formState;
    try {
      const payload = state.pending || formValues();
      if (state.id) await call('assetsUpdate', state.id, state.version, payload);
      else { payload.requestId = state.requestId; state.pending = payload; await call('assetsCreate', payload); }
      $('#assetDialog').close(); formState = null; toast('บันทึกรายการสินทรัพย์แล้ว'); await load();
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
    if (e.target.tagName !== 'IMG' || e.target.closest('.brand')) return;
    const text = document.createElement('span'); text.className = 'photo-empty'; text.textContent = 'โหลดภาพไม่ได้'; e.target.replaceWith(text);
  }, true);
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('cancel', e => { if (saving) e.preventDefault(); }));
  $('#imageUrl').addEventListener('input', () => { clearTimeout(imageTimer); imageTimer = setTimeout(previewImage, 400); });
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
  try {
    const match = location.hash.match(/(?:^#|&)t=([^&]+)/);
    token = match ? decodeURIComponent(match[1]) : sessionStorage.getItem('pm_tok') || '';
    if (match) history.replaceState(null, '', location.pathname + location.search);
  } catch (_) {}
  if (token) startApp().catch(e => showLogin(e.message));
})();
