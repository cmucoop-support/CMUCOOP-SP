/* gas-shim.js — ให้หน้าเว็บ (GitHub Pages) เรียกฟังก์ชันฝั่งหลังบ้าน (Cloudflare Worker) ได้ด้วยรูปแบบเดิม google.script.run.xxx()
 * แก้ API_URL เป็นลิงก์ของ Worker (https://ชื่อworker.ชื่อบัญชี.workers.dev) เท่านั้น */
window.API_URL = window.API_URL || 'https://cmucoop-api.cmucoopcashier.workers.dev';

(function () {
  function post(fn, args) {
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
      catch (_) { throw new Error('เซิร์ฟเวอร์ส่งข้อมูลกลับไม่ใช่ JSON (' + r.status + ')'); }
      // error ของ API อาจกลับมาเป็น 200 จึงต้องตรวจทั้งสองเงื่อนไข
      if (!r.ok) throw new Error((payload && payload.error) || 'เซิร์ฟเวอร์ตอบกลับผิดปกติ (' + r.status + ')');
      if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || 'ไม่สามารถดึงข้อมูลได้');
      return payload.data;
    }).catch(function (e) {
      if (e && e.name === 'AbortError') throw new Error('เชื่อมต่อเซิร์ฟเวอร์เกิน 90 วินาที กรุณาลองใหม่ (ตรวจสอบข้อมูลก่อนกดบันทึกซ้ำ)');
      if (e instanceof TypeError) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตหรือการตั้งค่าของ Worker');
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
