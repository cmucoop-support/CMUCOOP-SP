/* assets/js/shared/gas-shim.js — ให้หน้าเว็บ (GitHub Pages) เรียกฟังก์ชันฝั่งหลังบ้าน (Cloudflare Worker) ได้ด้วยรูปแบบเดิม google.script.run.xxx()
 * แก้ API_URL เป็นลิงก์ของ Worker (https://ชื่อworker.ชื่อบัญชี.workers.dev) เท่านั้น */
window.API_URL = window.API_URL || 'https://cmucoop-api.cmucoopcashier.workers.dev';

(function () {
  var readOnly = new Set(['whoami', 'listUsers', 'getCardOrder', 'getCustomCards', 'getCardTitles', 'getCardSize', 'getHiddenCards', 'getCardNewTabs',
    'getActivity', 'getPublicBanners', 'getBannerImage', 'adminBannerImage', 'listBanners', 'getSoundConfig',
    'getSoundPublic', 'getSoundAudio', 'listSounds', 'adminSoundAudio', 'musicList', 'getInit', 'getCategoryData',
    'findBarcode', 'getLog', 'barcodeBackupList', 'barcodeBackupData', 'stockGet', 'stockNotesGet', 'marketGet', 'getTvPublic', 'getTvConfig', 'expiryList', 'expirySummary', 'expiryCatalog', 'expiryLookup', 'expiryHistory']);
  var active = 0, pending = [], inFlight = new Map();
  function enqueue(job) {
    if (pending.length >= 32) return Promise.reject(new Error('มีคำขอค้างจำนวนมาก กรุณารอให้รายการก่อนหน้าเสร็จ'));
    return new Promise(function (resolve, reject) { pending.push({ job: job, resolve: resolve, reject: reject }); pump(); });
  }
  function pump() {
    while (active < 4 && pending.length) {
      var task = pending.shift(); active++;
      (function (item) {
        Promise.resolve().then(item.job).then(item.resolve, item.reject).finally(function () { active--; pump(); });
      })(task);
    }
  }
  function post(fn, args) {
    var read = readOnly.has(fn), key = read ? JSON.stringify([fn, args]) : null;
    if (key && inFlight.has(key)) return inFlight.get(key);
    var request = enqueue(async function () {
      try { return await transport(fn, args, false); }
      catch (e) {
        // Retry only reads. A lost response to a write is an uncertain commit.
        if (!read || !e.transient) throw e;
        await new Promise(function (resolve) { setTimeout(resolve, 400 + Math.random() * 400); });
        return transport(fn, args, false);
      }
    });
    if (key) {
      request = request.then(function (value) { inFlight.delete(key); return value; }, function (e) { inFlight.delete(key); throw e; });
      inFlight.set(key, request);
    }
    return request;
  }
  function transport(fn, args, initialized) {
    // ทุกคำสั่งต้องอ่านผลใหม่จากเซิร์ฟเวอร์ (ไม่ใช้ response เก่าจาก cache)
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 90000) : null;
    return fetch(window.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args }),
      cache: 'no-store',
      redirect: 'follow',
      signal: controller ? controller.signal : undefined
    }).then(async function (r) {
      var payload;
      try { payload = await r.json(); }
      catch (_) {
        var parseError = new Error('เซิร์ฟเวอร์ส่งข้อมูลกลับไม่ใช่ JSON (' + r.status + ')');
        parseError.transient = [429, 502, 503, 504].includes(r.status); throw parseError;
      }
      if (payload && payload.code === 'SCHEMA_INITIALIZED' && !initialized) return transport(fn, args, true);
      // error ของ API อาจกลับมาเป็น 200 จึงต้องตรวจทั้งสองเงื่อนไข
      if (!r.ok) {
        var httpError = new Error((payload && payload.error) || 'เซิร์ฟเวอร์ตอบกลับผิดปกติ (' + r.status + ')');
        httpError.transient = [429, 502, 503, 504].includes(r.status); throw httpError;
      }
      if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || 'ไม่สามารถดึงข้อมูลได้');
      return payload.data;
    }).catch(function (e) {
      if (e && (e.name === 'AbortError' || e instanceof TypeError)) {
        var networkError = new Error(e.name === 'AbortError'
          ? 'เชื่อมต่อเซิร์ฟเวอร์เกิน 90 วินาที กรุณาตรวจสอบข้อมูลล่าสุดก่อนกดบันทึกซ้ำ'
          : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตหรือการตั้งค่าของ Worker');
        networkError.transient = true; throw networkError;
      }
      throw e;
    }).finally(function () { if (timer) clearTimeout(timer); });
  }
  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, name) {
        // A runner is a callback builder, not a Promise. Avoid an accidental RPC
        // named "then" when it is inspected by Promise.resolve or browser tools.
        if (name === 'then') return undefined;
        if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
        if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
        if (typeof name !== 'string') return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          return post(name, args).then(function (d) { if (typeof ok === 'function') ok(d); }, function (e) {
            if (typeof fail === 'function') fail({ message: e.message });
            else console.error(e);
          }).catch(function (e) { console.error('เกิดข้อผิดพลาดระหว่างแสดงผลข้อมูล', e); });
        };
      }
    });
  }
  window.google = {
    script: {
      run: runner(null, null),
      url: { getLocation: function (cb) { var p = {}; new URLSearchParams(location.search).forEach(function (v, k) { p[k] = v; }); cb({ parameter: p, hash: location.hash.slice(1) }); } }
    }
  };
})();
