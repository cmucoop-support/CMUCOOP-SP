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
    for (let row of rows) {
      if (!row.trim() || /\bDD\s*[/.-]?\s*MM\s*[/.-]?\s*YYYY\b/.test(row)) continue;
      // Correct common OCR substitutions only inside a date-shaped token.
      row=row.replace(/[0-9OQILZSB]+(?:\s*[/.,\\-]\s*[0-9OQILZSB]+){2}/g, token => /\d/.test(token) ? token.replace(/[OQ]/g,'0').replace(/[IL]/g,'1').replace(/Z/g,'2').replace(/S/g,'5').replace(/B/g,'8').replace(/[,\\]/g,'/') : token)
        .replace(/(\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*)(\d{2})\s+(\d{2})(?!\d)/g,'$1$2$3');
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
      for (const m of row.matchAll(/(?<!\d)((?:19|20|21|25|26)\d{2})(\d{2})(\d{2})(?!\d)/g)) add(m[3],m[2],m[1]);
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
  let currentJob;
  function cancel() {
    const job=currentJob; currentJob=null;
    if(job) { job.cancelled=true; if(job.abort) job.abort(new Error('OCR_CANCELLED')); if(job.worker) job.worker.terminate().catch(()=>{}); }
  }
  async function read(source,progress,active) {
    cancel();
    const job={cancelled:false,worker:null,abort:null};currentJob=job;
    const alive=()=>!job.cancelled && currentJob===job && active();
    let timeout,allText=[],passes=0;
    const found=new Map(),manufactured=new Set();
    const execute=async()=>{
      const T=await library(); if(!alive()) return;
      const base=new URL('assets/vendor/ocr/',location.href).href;
      const worker=await T.createWorker('eng',1,{workerPath:base+'worker.min.js',corePath:base,langPath:base.replace(/\/$/,''),workerBlobURL:false,
        logger:m=>{if(alive() && passes===0) progress(m.status==='recognizing text'?'กำลังอ่านฉลาก…':'กำลังเตรียมตัวอ่านวันที่…');},
        errorHandler:error=>{if(job.abort) job.abort(new Error('เปิดตัวอ่านวันที่ไม่สำเร็จ กรุณารีโหลดหน้าแล้วลองใหม่'));}
      });
      job.worker=worker;if(!alive()) { await worker.terminate();return; }
      const scan=async(image,psm)=>{
        if(!alive()) return;
        passes++;progress('กำลังอ่านวันที่ · ตรวจภาพรูปแบบที่ '+passes);
        await worker.setParameters({tessedit_pageseg_mode:String(psm),user_defined_dpi:'300',preserve_interword_spaces:'1'});
        const {data}=await worker.recognize(image,{}, {text:true,tsv:true});
        if(!alive()) return;
        allText.push(data.text);
        const labelPattern=/\b(?:MFG|MFD|MANUFACTURED|PRODUCTION|EXP(?:IRY|IRES|IRATION)?|BBE|BEST\s*BEFORE|USE\s*BY)\b/gi;
        const labels=[...data.text.matchAll(labelPattern)];
        labels.forEach((label,i)=>{
          if(/^(MFG|MFD|MANUFACTURED|PRODUCTION)$/i.test(label[0])) {
            const section=data.text.slice(label.index+label[0].length,labels[i+1]?labels[i+1].index:data.text.length);
            parse(section).forEach(d=>manufactured.add(d.value));
          }
        });
        const words=String(data.tsv||'').split('\n').slice(1).map(line=>{const a=line.split('\t');return {confidence:Number(a[10]),text:a.slice(11).join('\t')};}).filter(w=>w.confidence>=0 && w.text);
        const dates=parse(data.text);
        for(const candidate of dates) {
          const matches=words.filter(w=>parse(w.text).some(d=>d.value===candidate.value));
          const confidence=matches.length?Math.max(...matches.map(w=>w.confidence)):Number(data.confidence)||0;
          if(confidence<35) continue;
          const previous=found.get(candidate.value);
          if(previous) { previous.votes++;previous.confidence=Math.max(previous.confidence,confidence);previous.priority=Math.max(previous.priority,candidate.priority); }
          else found.set(candidate.value,{...candidate,confidence,votes:1});
        }
      };
      const results=()=>{
        let candidates=[...found.values()].filter(c=>!manufactured.has(c.value) || c.priority===2);
        if(candidates.some(c=>c.priority===2 && c.confidence>=55)) candidates=candidates.filter(c=>c.priority===2);
        candidates.forEach(c=>{c.score=c.confidence+Math.min(3,c.votes-1)*6+c.priority*4;});
        candidates.sort((a,b)=>b.score-a.score);
        const best=candidates[0],second=candidates[1];
        const auto=!!best && (best.confidence>=75 || best.votes>=2 && best.confidence>=60) && (!second || best.score-second.score>=18 && second.confidence<65);
        return {candidates:candidates.slice(0,6),auto,text:allText.join('\n').slice(0,16000)};
      };
      await scan(window.CMUExpiryImage.prepare(source),T.PSM.SPARSE_TEXT);
      let result=results();
      // Clear labels already contain enough information; retain all dates when several exist.
      if(result.candidates.length && result.candidates.every(c=>c.confidence>=75)) return result;
      for(const rotation of [0,90,270,180]) {
        if(!alive()) return;
        const oriented=rotation?window.CMUExpiryImage.prepare(source,null,'original',rotation):source;
        const regions=window.CMUExpiryImage.regions(oriented).slice(0,12);
        if(rotation) await scan(window.CMUExpiryImage.prepare(oriented),T.PSM.SPARSE_TEXT);
        for(const rect of regions) {
          if(!alive()) return;
          const psm=rect.w/rect.h>4?T.PSM.SINGLE_LINE:T.PSM.SINGLE_BLOCK;
          await scan(window.CMUExpiryImage.prepare(oriented,rect,'original'),psm);
          await scan(window.CMUExpiryImage.prepare(oriented,rect,'contrast'),psm);
          if(passes>=38) break;
        }
        result=results();
        if(result.candidates.some(c=>c.confidence>=60) || passes>=38) return result;
        // Close-up date rows sometimes have too few components to locate. Retry a cleaned image.
        if(regions.length<3) { await scan(window.CMUExpiryImage.prepare(oriented,null,'contrast'),T.PSM.SINGLE_BLOCK);await scan(window.CMUExpiryImage.prepare(oriented,null,'binary'),T.PSM.SINGLE_BLOCK); }
        result=results();if(result.candidates.some(c=>c.confidence>=60)) return result;
      }
      return results();
    };
    try {
      const aborted=new Promise((resolve,reject)=>{job.abort=reject;timeout=setTimeout(()=>reject(new Error('อ่านรูปนี้ยังไม่สำเร็จ กรุณาครอบเฉพาะบรรทัดวันที่แล้วอ่านอีกครั้ง')),45000);});
      return await Promise.race([execute(),aborted]);
    } finally {
      clearTimeout(timeout);job.cancelled=true;
      if(currentJob===job) currentJob=null;
      if(job.worker) await job.worker.terminate().catch(()=>{});
    }
  }
  async function recognize(canvas,progress,active) { const result=await read(canvas,progress,active);return result?result.text:''; }
  window.CMUExpiryDate = { iso, parse, recognize, read, cancel };
}());
