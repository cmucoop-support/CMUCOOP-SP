(function () {
  'use strict';
  const months = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
  function iso(day, month, year) {
    let y = Number(year); const m = Number(month), d = Number(day);
    if (String(year).length === 2) y += y >= 40 ? 2500 : 2000;
    if (y >= 2400) y -= 543;
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return '';
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.toISOString().slice(0,10) : '';
  }
  function parse(text) {
    const rows = String(text).toUpperCase().replace(/[๐-๙]/g, n => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(n)))
      .replace(/\s+(?=\b(?:EXP(?:IRY|IRES|IRATION)?|BBE|BEST\s*BEFORE|USE\s*BY|MFG|MFD|MANUFACTURED|PRODUCTION)\b)/g,'\n').split(/\r?\n/), found = new Map();
    let nextPriority = 0, nextManufactured = false;
    for (const row of rows) {
      if (!row.trim() || /\bDD\s*[/.-]?\s*MM\s*[/.-]?\s*YYYY\b/.test(row)) continue;
      const expiry = /\b(?:EXP(?:IRY|IRES|IRATION)?|BBE|BB|BEST\s*(?:BEFORE|BY)|USE\s*BY)\b|หมดอายุ|ควรบริโภคก่อน/.test(row);
      const manufactured = /\b(?:MFG|MFD|MANUFACTURED|PROD(?:UCTION)?)\b|วันที่ผลิต/.test(row);
      const priority = expiry ? 2 : nextPriority;
      const skip = manufactured && !expiry || !expiry && nextManufactured;
      let matches = 0;
      const add = (day, month, year) => {
        matches++; const value = iso(day,month,year);
        if (!value || skip) return;
        const old = found.get(value);
        if (!old || priority > old.priority) found.set(value, { value, priority, label: value.slice(8)+'/'+value.slice(5,7)+'/'+value.slice(0,4), source: row.trim().slice(0,160) });
      };
      for (const m of row.matchAll(/(?<!\d)(\d{4})[\s./-]+(\d{1,2})[\s./-]+(\d{1,2})(?!\d)/g)) add(m[3],m[2],m[1]);
      for (const m of row.matchAll(/(?<![\d./-])(\d{1,2})[\s./-]+(\d{1,2})[\s./-]+(\d{4}|\d{2})(?!\d)/g)) add(m[1],m[2],m[3]);
      for (const m of row.matchAll(/(?<!\d)(\d{1,2})[\s./-]*([A-Z]{3})[A-Z]*[\s./-]*(\d{4}|\d{2})(?!\d)/g)) if (months[m[2]]) add(m[1],months[m[2]],m[3]);
      for (const m of row.matchAll(/(?<!\d)(\d{2})(\d{2})(\d{4}|\d{2})(?!\d)/g)) add(m[1],m[2],m[3]);
      nextPriority = expiry && !matches ? 2 : 0;
      nextManufactured = manufactured && !matches;
    }
    const list = [...found.values()].sort((a,b) => b.priority-a.priority || a.value.localeCompare(b.value));
    return list.some(d => d.priority === 2) ? list.filter(d => d.priority === 2) : list;
  }
  let loading;
  function library() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!loading) loading = new Promise((resolve,reject) => {
      const s = document.createElement('script'); s.src = 'assets/vendor/ocr/tesseract.min.js';
      s.onload = () => resolve(window.Tesseract); s.onerror = () => { s.remove(); reject(new Error('โหลดตัวอ่านวันที่ไม่สำเร็จ กรุณาลองอีกครั้ง หรือเลือกวันที่เอง')); };
      document.head.appendChild(s);
    }).catch(error => { loading = null; throw error; });
    return loading;
  }
  async function recognize(canvas, progress, active) {
    const T = await library(); if (!active()) return '';
    const base = new URL('assets/vendor/ocr/', location.href).href;
    let worker;
    try {
      worker = await T.createWorker('eng',1,{workerPath:base+'worker.min.js',corePath:base,langPath:base.replace(/\/$/,''),workerBlobURL:false,
        logger: m => { if (active()) progress(m.status === 'recognizing text' ? 'กำลังอ่านวันที่ '+Math.round(m.progress*100)+'%' : 'กำลังเตรียมตัวอ่านวันที่…'); }
      });
      if (!active()) return '';
      await worker.setParameters({tessedit_pageseg_mode:T.PSM.SPARSE_TEXT});
      const result = await worker.recognize(canvas); return result.data.text;
    } finally { if (worker) await worker.terminate(); }
  }
  window.CMUExpiryDate = { iso, parse, recognize };
}());
