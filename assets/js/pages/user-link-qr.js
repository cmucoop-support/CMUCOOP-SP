(function () {
  'use strict';
  var loading;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function library() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (!loading) loading = new Promise(function(resolve,reject) {
      var script=document.createElement('script');script.src='assets/vendor/zxing-library-0.23.0.min.js';
      script.onload=function() { if(window.ZXing) resolve(window.ZXing);else reject(new Error('ไม่พบตัวสร้าง QR')); };
      script.onerror=function() { script.remove();reject(new Error('โหลดตัวสร้าง QR ไม่สำเร็จ กรุณาลองใหม่')); };
      document.head.appendChild(script);
    }).catch(function(error) { loading=null;throw error; });
    return loading;
  }
  function svg(Z,url) {
    var parsed=new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('ลิงก์เข้าใช้งานไม่ถูกต้อง');
    var hints=new Map();hints.set(Z.EncodeHintType.MARGIN,4);hints.set(Z.EncodeHintType.ERROR_CORRECTION,'M');hints.set(Z.EncodeHintType.CHARACTER_SET,'UTF-8');
    var matrix=new Z.QRCodeWriter().encode(url,Z.BarcodeFormat.QR_CODE,0,0,hints),size=matrix.getWidth(),path='';
    for(var y=0;y<size;y++) for(var x=0;x<size;x++) {
      if(!matrix.get(x,y)) continue;
      var start=x;while(x+1<size && matrix.get(x+1,y)) x++;
      path+='M'+start+' '+y+'h'+(x-start+1)+'v1H'+start+'z';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" width="256" height="256" role="img" aria-label="QR เข้าสู่ระบบ" shape-rendering="crispEdges"><rect width="'+size+'" height="'+size+'" fill="#fff"/><path d="'+path+'" fill="#000"/></svg>';
  }
  function count(value) { var n=Number(value);return Number.isInteger(n) && n>=1 && n<=100 ? n:0; }
  function printDocument(data) {
    var quantity=count(data.quantity);if(!quantity) throw new Error('เลือกจำนวน QR เป็นจำนวนเต็ม 1–100');
    var sheets='';
    for(var first=0;first<quantity;first+=4) {
      var cards='';
      for(var i=first;i<Math.min(first+4,quantity);i++) cards+='<article class="qr-card"><p class="brand">CMUCOOP SUPPORT</p><h1>'+esc(data.name || 'บัญชีผู้ใช้งาน')+'</h1><p class="account">บัญชี: '+esc(data.username)+'</p><div class="qr-code">'+data.svg+'</div><p class="instruction">สแกน QR เพื่อเข้าสู่ระบบ</p></article>';
      sheets+='<section class="qr-sheet" aria-label="แผ่นที่ '+(Math.floor(first/4)+1)+'">'+cards+'</section>';
    }
    return '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>QR บัญชี '+esc(data.username)+'</title><link rel="stylesheet" href="'+esc(data.fontUrl)+'"><style>'+ 
      '*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Sarabun,Tahoma,sans-serif;color:#111;background:#eee;font-size:16px}.print-toolbar{position:sticky;top:0;z-index:2;background:#fff;padding:12px 16px;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.print-toolbar p{margin:0;flex:1;font-size:14px}.print-toolbar button{font:inherit;border:0;border-radius:8px;padding:10px 20px;background:#7040cc;color:#fff;cursor:pointer}.print-toolbar button:disabled{opacity:.5}.print-preview{overflow:auto}.qr-sheet{display:grid;grid-template-columns:repeat(2,105mm);grid-template-rows:repeat(2,148.5mm);width:210mm;height:297mm;margin:12px auto;background:#fff;box-shadow:0 2px 8px #0002;overflow:hidden}.qr-card{width:105mm;height:148.5mm;padding:9mm 7mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.5mm;text-align:center;border-right:.2mm dashed #bbb;border-bottom:.2mm dashed #bbb;break-inside:avoid;overflow:hidden}.qr-card:nth-child(even){border-right:0}.qr-card:nth-child(n+3){border-bottom:0}.qr-card p,.qr-card h1{margin:0;max-width:100%;overflow-wrap:anywhere}.brand{font-size:10pt;letter-spacing:.4pt;font-weight:700}.qr-card h1{font-size:18pt;line-height:1.3;max-height:24mm;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.account{font-size:12pt;line-height:1.4}.qr-code{width:62mm;height:62mm;flex:0 0 62mm}.qr-code svg{display:block;width:100%;height:100%}.instruction{font-size:11pt;line-height:1.4}@page{size:A4 portrait;margin:0}@media print{html,body{width:210mm;background:#fff}.print-toolbar{display:none!important}.print-preview{overflow:visible}.qr-sheet{margin:0;box-shadow:none;break-after:page;page-break-after:always}.qr-sheet:last-child{break-after:auto;page-break-after:auto}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}'+
      '</style></head><body><header class="print-toolbar"><button type="button" id="backQr" aria-label="ย้อนกลับ">←</button><p>'+quantity+' QR · '+Math.ceil(quantity/4)+' แผ่น A4 · ขนาด ¼ A4 ต่อใบ<br>เลือก A4 แนวตั้ง ขนาดจริง 100% และปิดส่วนหัว/ท้ายกระดาษ</p><button type="button" id="printQr" disabled>พิมพ์</button></header><main class="print-preview">'+sheets+'</main></body></html>';
  }
  window.CMUUserQR={library:library,svg:svg,count:count,printDocument:printDocument};
}());
