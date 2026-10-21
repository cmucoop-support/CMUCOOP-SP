(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const number = new Intl.NumberFormat('th-TH');
  const timeFormatter = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  const sourceLabels = { barcode: 'บาร์เดี่ยว / บาร์แพ็ค', stock: 'สินค้าค้างสต็อก', market: 'เช็คราคาตลาด', expiry: 'แจ้งเตือนสินค้าหมดอายุ' };
  const fieldLabels = { name: 'ชื่อสินค้า', names: 'ชื่อสินค้า', code: 'รหัสสินค้า', codes: 'รหัสสินค้า', category: 'หมวดสินค้า', categories: 'หมวดสินค้า', unitBarcode: 'บาร์เดี่ยว', packBarcode: 'บาร์แพ็ค', perPack: 'จำนวนต่อแพ็ค' };
  const recordFields = { code: 'รหัสสินค้า', name: 'ชื่อสินค้า', branch: 'สาขา', category: 'หมวดสินค้า', unitBarcode: 'บาร์เดี่ยว', packBarcode: 'บาร์แพ็ค', perPack: 'จำนวนต่อแพ็ค', quantity: 'จำนวนที่ต้นทางบันทึก', reportedAt: 'วันที่ต้นทางรายงาน', expires: 'วันหมดอายุ', status: 'สถานะต้นทาง', location: 'จุดวางสินค้า' };
  let token = '', user = null, data = null, summary = null, loadSequence = 0, detailSequence = 0;
  let cursors = [''], pageIndex = 0, searchTimer, syncTimer, detailKey = '', detailCursor = null, detailRecords = 0, detailRevision = null, busy = false, reloadPending = false;

  // All source data is rendered as text. Product names, codes and branch names
  // must never be treated as HTML or interpolated into a selector.
  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = String(text);
    if (className) el.className = className;
    return el;
  }
  function time(value) {
    if (value === null || value === undefined || value === '') return 'ไม่ระบุ';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'ไม่ระบุ' : timeFormatter.format(date);
  }
  function branchName(branchCode, name) {
    if (branchCode === '__global__') return 'ข้อมูลกลาง (บาร์สินค้า · ไม่ระบุสาขา)';
    if (branchCode === '__unknown__') return 'ไม่ระบุสาขา';
    return name || 'ไม่ระบุสาขา';
  }
  function call(fn, ...args) {
    const requestToken = token;
    if (fn !== 'login') args.unshift(requestToken);
    return new Promise((resolve, reject) => {
      const runner = google.script.run.withSuccessHandler(result => {
        if (fn !== 'login' && requestToken !== token) { reject(new Error('SESSION_CHANGED')); return; }
        resolve(result);
      }).withFailureHandler(error => {
        if (fn !== 'login' && requestToken !== token) { reject(new Error('SESSION_CHANGED')); return; }
        const message = error && error.message || String(error);
        if (/SESSION_EXPIRED/.test(message)) showLogin('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง');
        reject(new Error(message));
      });
      runner[fn](...args);
    });
  }
  function showLogin(message = '') {
    token = ''; user = null; data = null; summary = null; loadSequence++; detailSequence++;
    clearTimeout(searchTimer); clearTimeout(syncTimer); busy = false; reloadPending = false;
    try { sessionStorage.removeItem('pm_tok'); sessionStorage.removeItem('pm_me'); } catch (_) {}
    $('#workspace').hidden = true; $('#loginPanel').hidden = false; $('#logout').hidden = true;
    $('#me').textContent = ''; $('#rows').replaceChildren(); $('#detailContent').replaceChildren();
    $('#loginError').textContent = message; $('#password').value = ''; $('#detailDialog').close();
    $('#search').value = ''; $('#conflictsOnly').checked = false;
    for (const id of ['totalCount', 'branchCount', 'conflictCount', 'sourceCount']) $('#' + id).textContent = '—';
    const allBranches = element('option', 'ทุกสาขาและข้อมูลกลาง'); allBranches.value = '';
    const allSources = element('option', 'ทุกระบบ'); allSources.value = '';
    $('#branchFilter').replaceChildren(allBranches); $('#branchFilter').value = '';
    $('#sourceFilter').replaceChildren(allSources); $('#sourceFilter').value = '';
    $('#prev').disabled = true; $('#next').disabled = true; $('#refresh').disabled = false;
  }
  async function startApp() {
    const me = await call('whoami');
    if (me.role !== 'admin' && !(me.perms && me.perms.product_catalog)) {
      showLogin('บัญชีนี้ยังไม่มีสิทธิ์ดูข้อมูลสินค้าตามสาขา กรุณาให้ Admin เปิดสิทธิ์ในหน้าตั้งค่า'); return;
    }
    user = me; cursors = ['']; pageIndex = 0;
    try { sessionStorage.setItem('pm_tok', token); sessionStorage.setItem('pm_me', JSON.stringify(me)); } catch (_) {}
    $('#loginPanel').hidden = true; $('#workspace').hidden = false; $('#logout').hidden = false;
    $('#me').textContent = me.name + (me.role === 'admin' ? ' · Admin' : '');
    await load(true);
  }
  function requestOptions() {
    return { branchCode: $('#branchFilter').value, search: $('#search').value.trim(), source: $('#sourceFilter').value, conflictsOnly: $('#conflictsOnly').checked, limit: 50, cursor: cursors[pageIndex] || '' };
  }
  function updatePagination() {
    $('#prev').disabled = busy || !data || pageIndex === 0;
    $('#next').disabled = busy || !data || !data.nextCursor;
  }
  async function load(withSummary = false, quiet = false) {
    if (!token || !user) return;
    const sequence = ++loadSequence, requestToken = token;
    const options = requestOptions();
    busy = true; updatePagination(); $('#refresh').disabled = true; $('#tableRegion').setAttribute('aria-busy', 'true');
    if (!quiet) $('#resultInfo').textContent = 'กำลังโหลดรายการ…';
    try {
      let [result, overview] = await Promise.all([call('productCatalogList', options), withSummary ? call('productCatalogSummary') : Promise.resolve(null)]);
      // Filters can run before a debounced save notification. Match the summary
      // to the list revision so source counts never describe an older dataset.
      for (let attempt = 0; (overview || summary)?.revision !== result.revision && attempt < 3; attempt++) {
        overview = await call('productCatalogSummary');
        if (overview.revision !== result.revision) result = await call('productCatalogList', options);
      }
      if ((overview || summary)?.revision !== result.revision) throw new Error('ข้อมูลกำลังเปลี่ยนแปลง กรุณาโหลดใหม่');
      if (sequence !== loadSequence || requestToken !== token) return;
      data = result;
      if (overview) { summary = overview; renderSummary(); }
      $('#loadError').hidden = true; renderRows();
    } catch (error) {
      if (sequence !== loadSequence || requestToken !== token) return;
      $('#loadError').textContent = 'โหลดข้อมูลไม่สำเร็จ: ' + error.message + ' · กรุณาโหลดข้อมูลล่าสุดอีกครั้ง';
      $('#loadError').hidden = false;
      $('#resultInfo').textContent = data ? 'แสดงผลจากการโหลดครั้งก่อน ข้อมูลอาจยังไม่ใช่ข้อมูลล่าสุด' : 'ยังโหลดทะเบียนสินค้าไม่สำเร็จ';
    } finally {
      if (sequence === loadSequence && requestToken === token) {
        busy = false; updatePagination(); $('#refresh').disabled = false; $('#tableRegion').setAttribute('aria-busy', 'false');
        if (reloadPending) { reloadPending = false; scheduleReload(); }
      }
    }
  }
  function replaceOptions(select, initial, rows) {
    const selected = select.value, selectedText = select.selectedOptions && select.selectedOptions[0] && select.selectedOptions[0].textContent;
    const first = element('option', initial); first.value = '';
    // A branch may disappear during a refresh. Keep the active filter explicit
    // instead of silently presenting filtered rows under an "all branches" label.
    if (selected && !rows.some(row => row.value === selected)) rows.push({ value: selected, label: selectedText || selected });
    const options = rows.map(row => { const option = element('option', row.label); option.value = row.value; return option; });
    select.replaceChildren(first, ...options);
    if (rows.some(row => row.value === selected)) select.value = selected;
  }
  function renderSummary() {
    $('#totalCount').textContent = number.format(summary.total || 0);
    $('#conflictCount').textContent = number.format(summary.conflictCount || 0);
    $('#branchCount').textContent = number.format(summary.branches.filter(branch => !['__global__', '__unknown__'].includes(branch.branchCode)).length);
    $('#sourceCount').textContent = number.format(summary.sources.filter(source => source.count > 0).length);
    $('#syncTime').textContent = 'ปรับปรุงข้อมูล ' + time(summary.syncedAt);
    replaceOptions($('#branchFilter'), 'ทุกสาขาและข้อมูลกลาง', summary.branches.map(branch => ({ value: branch.branchCode, label: branchName(branch.branchCode, branch.name) + ' (' + number.format(branch.total) + ')' })));
    replaceOptions($('#sourceFilter'), 'ทุกระบบ', summary.sources.map(source => ({ value: source.id, label: (sourceLabels[source.id] || source.label || source.id) + ' (' + number.format(source.count) + ')' })));
  }
  function addCell(row, label, ...children) {
    const cell = element('td'); cell.dataset.label = label; cell.append(...children); row.append(cell); return cell;
  }
  function sourceBadges(sources) {
    return sources.map(source => element('span', sourceLabels[source] || source, 'badge'));
  }
  function renderRows() {
    const rows = data.rows.map(product => {
      const row = element('tr');
      const name = element('div', product.name || 'ไม่มีชื่อสินค้า', 'product-name');
      const code = element('small', product.code || 'ไม่ระบุรหัส', 'code');
      const productCell = addCell(row, 'สินค้า / รหัส', name, code);
      if (product.codes && product.codes.length > 1) productCell.append(element('small', 'รหัสที่เกี่ยวข้อง: ' + product.codes.join(' · '), 'code'));
      if (product.categories && product.categories.length) productCell.append(element('small', 'หมวด: ' + product.categories.join(' · ')));
      const branch = element('span', branchName(product.branchCode, product.branch), product.branchCode === '__global__' ? 'badge global' : '');
      addCell(row, 'สาขา', branch);
      addCell(row, 'ระบบต้นทาง', ...sourceBadges(product.sources || []));
      const conflicts = product.conflictCount || 0;
      addCell(row, 'ผลการเปรียบเทียบ', element('span', conflicts ? 'ข้อมูลไม่ตรงกัน ' + number.format(conflicts) + ' จุด' : 'ไม่พบข้อมูลขัดแย้ง', 'badge ' + (conflicts ? 'warning' : 'calm')));
      addCell(row, 'อัปเดตจากต้นทาง', element('span', time(product.updatedAt)));
      const button = element('button', 'ดูรายละเอียด', 'button secondary detail-button'); button.type = 'button'; button.dataset.key = product.productKey;
      addCell(row, 'รายละเอียด', button);
      return row;
    });
    if (!rows.length) {
      const row = element('tr'), cell = element('td', null, 'empty'); cell.colSpan = 6;
      cell.append(element('strong', 'ไม่พบรายการสินค้า'), element('span', 'ลองเปลี่ยนสาขา ระบบต้นทาง หรือคำค้นหา')); row.append(cell); rows.push(row);
    }
    $('#rows').replaceChildren(...rows);
    $('#resultInfo').textContent = 'พบ ' + number.format(data.total || 0) + ' รายการ · แสดง ' + number.format(data.rows.length) + ' รายการในหน้านี้';
    $('#pageInfo').textContent = 'หน้า ' + number.format(pageIndex + 1);
    $('#updated').textContent = 'ทะเบียนปรับปรุง ' + time(data.syncedAt) + ' · ตรวจสอบหน้าจอล่าสุด ' + time(Date.now()) + ' · เวลาไทย';
  }
  function definition(list, label, value) {
    const item = element('div'); item.append(element('dt', label), element('dd', value === null || value === undefined || value === '' ? 'ไม่ระบุ' : value)); list.append(item);
  }
  function renderDetail(result) {
    const meta = element('dl', null, 'detail-meta');
    definition(meta, 'สาขา', branchName(result.branchCode, result.branch)); definition(meta, 'รหัสที่เกี่ยวข้อง', (result.codes || []).join(' · ') || result.code);
    definition(meta, 'ชื่อที่พบ', (result.names || []).join(' · ') || result.name); definition(meta, 'หมวดสินค้าที่พบ', (result.categories || []).join(' · '));
    definition(meta, 'ระบบต้นทาง', (result.sources || []).map(source => sourceLabels[source] || source).join(' · ')); definition(meta, 'อัปเดตจากต้นทาง', time(result.updatedAt));
    $('#detailContent').replaceChildren(meta);
    if (result.conflicts && result.conflicts.length) {
      const box = element('div', null, 'conflict-box'); box.append(element('h3', 'ข้อมูลที่ไม่ตรงกัน'));
      for (const conflict of result.conflicts) box.append(element('p', (fieldLabels[conflict.field] || conflict.field) + ': ' + conflict.values.join(' / ')));
      box.append(element('p', 'ตรวจสอบและแก้ไขที่ระบบต้นทาง แล้วทะเบียนนี้จะปรับปรุงตามการบันทึก')); $('#detailContent').append(box);
    }
    $('#detailContent').append(element('h3', 'ข้อมูลต้นทางแต่ละรายการ'), element('p', 'จำนวนที่แสดงเป็นข้อมูลจากระบบต้นทาง ไม่ใช่ผลรวมยอดคงเหลือ', 'helper'));
    const records = element('div'); records.id = 'sourceRecords'; $('#detailContent').append(records);
  }
  function appendRecords(records) {
    for (const record of records) {
      const article = element('article', null, 'source-record'), heading = element('div', null, 'record-heading');
      heading.append(element('strong', sourceLabels[record.system] || record.system), element('small', 'อ้างอิง ' + (record.ref || 'ไม่ระบุ'), 'muted')); article.append(heading);
      const list = element('dl');
      for (const [key, label] of Object.entries(recordFields)) {
        if (record[key] === undefined || record[key] === null || record[key] === '') continue;
        const value = key === 'branch' && record.system === 'barcode' && !record.branch ? 'ข้อมูลกลาง (ไม่ระบุสาขา)' : record[key];
        definition(list, label, value);
      }
      if (record.system === 'barcode' && !record.branch) definition(list, 'สาขา', 'ข้อมูลกลาง (ไม่ระบุสาขา)');
      article.append(list); $('#sourceRecords').append(article);
    }
    detailRecords += records.length;
  }
  async function loadDetail(append = false) {
    const sequence = ++detailSequence, key = detailKey, requestToken = token;
    $('#moreRecords').disabled = true; $('#detailError').hidden = true;
    try {
      const result = await call('productCatalogDetail', { productKey: key, limit: 30, cursor: append ? detailCursor : '' });
      if (sequence !== detailSequence || requestToken !== token || !$('#detailDialog').open) return;
      if (append && detailRevision !== result.revision) { detailCursor = null; detailRecords = 0; await loadDetail(); return; }
      if (!append) { $('#detailTitle').textContent = result.name || 'รายละเอียดสินค้า'; detailRecords = 0; detailRevision = result.revision; renderDetail(result); }
      appendRecords(result.records || []); detailCursor = result.nextCursor || null;
      $('#moreRecords').textContent = 'โหลดข้อมูลต้นทางเพิ่มเติม (' + number.format(detailRecords) + ' / ' + number.format(result.recordsTotal || detailRecords) + ')';
      $('#moreRecords').hidden = !detailCursor;
    } catch (error) {
      if (sequence !== detailSequence || requestToken !== token || !$('#detailDialog').open) return;
      $('#detailError').textContent = 'โหลดรายละเอียดไม่สำเร็จ: ' + error.message;
      $('#detailError').hidden = false;
      // Retry the same page after a failure without losing the records already shown.
      $('#moreRecords').hidden = false; $('#moreRecords').textContent = 'ลองโหลดรายละเอียดอีกครั้ง';
    } finally { if (sequence === detailSequence) $('#moreRecords').disabled = false; }
  }
  function resetPage() {
    cursors = ['']; pageIndex = 0;
    loadSequence++; busy = true; updatePagination(); $('#resultInfo').textContent = 'กำลังค้นหารายการ…';
  }
  function changeFilters() { clearTimeout(searchTimer); resetPage(); load(); }
  function scheduleReload() {
    if (!token || document.hidden) return;
    if (busy) { reloadPending = true; return; }
    clearTimeout(syncTimer); syncTimer = setTimeout(() => load(true, true), 500);
  }
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault(); $('#loginButton').disabled = true; $('#loginError').textContent = '';
    try { const result = await call('login', $('#username').value.trim(), $('#password').value); token = result.token; await startApp(); }
    catch (error) { if (error.message !== 'SESSION_CHANGED') showLogin(error.message); }
    finally { $('#password').value = ''; $('#loginButton').disabled = false; }
  });
  $('#logout').addEventListener('click', async () => { const request = call('logout'); showLogin(); try { await request; } catch (_) {} });
  $('#refresh').addEventListener('click', () => { clearTimeout(searchTimer); load(true); });
  $('#search').addEventListener('input', () => { clearTimeout(searchTimer); resetPage(); searchTimer = setTimeout(() => load(), 350); });
  $('#search').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); changeFilters(); } });
  for (const id of ['branchFilter', 'sourceFilter', 'conflictsOnly']) $('#' + id).addEventListener('change', changeFilters);
  $('#clearFilters').addEventListener('click', () => { $('#search').value = ''; $('#branchFilter').value = ''; $('#sourceFilter').value = ''; $('#conflictsOnly').checked = false; changeFilters(); });
  $('#prev').addEventListener('click', () => { if (busy || pageIndex === 0) return; pageIndex--; load(); });
  $('#next').addEventListener('click', () => { if (busy || !data || !data.nextCursor) return; cursors[++pageIndex] = data.nextCursor; load(); });
  $('#rows').addEventListener('click', event => {
    const button = event.target.closest('button[data-key]'); if (!button || busy || !data) return;
    const product = data.rows.find(row => row.productKey === button.dataset.key); if (!product) return;
    detailKey = product.productKey; detailCursor = null; detailRecords = 0; detailRevision = null;
    $('#detailTitle').textContent = product.name || 'รายละเอียดสินค้า'; $('#detailContent').textContent = 'กำลังโหลดรายละเอียด…'; $('#moreRecords').hidden = true;
    $('#detailDialog').showModal(); loadDetail();
  });
  $('#moreRecords').addEventListener('click', () => loadDetail(detailRecords > 0));
  $('#closeDetail').addEventListener('click', () => $('#detailDialog').close());
  $('#detailDialog').addEventListener('close', () => { detailSequence++; detailKey = ''; detailCursor = null; });
  document.addEventListener('visibilitychange', scheduleReload);
  window.addEventListener('storage', event => { if (event.key === 'cmucoop_catalog_changed') scheduleReload(); });
  window.addEventListener('cmucoop:catalog-changed', scheduleReload);
  (async function init() {
    const hash = new URLSearchParams(location.hash.slice(1));
    try { token = hash.get('t') || sessionStorage.getItem('pm_tok') || ''; } catch (_) { token = hash.get('t') || ''; }
    if (hash.has('t')) history.replaceState(null, '', location.pathname + location.search);
    if (!token) { $('#username').focus(); return; }
    try { await startApp(); } catch (error) { showLogin(error.message === 'SESSION_EXPIRED' ? 'กรุณาเข้าสู่ระบบอีกครั้ง' : error.message); }
  })();
})();
