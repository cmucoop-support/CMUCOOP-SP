(function () {
  'use strict';
  try { if (window.self!==window.top) return; } catch (_) { return; }
  if (document.getElementById('appBack')) return;
  var button=document.createElement('button');button.type='button';button.id='appBack';button.className='app-back-control';
  button.setAttribute('aria-label','ย้อนกลับ');button.title='ย้อนกลับ';
  button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h14"/></svg>';
  var home=new URL('index.html',document.baseURI),internal=false;
  try { internal=!!document.referrer && new URL(document.referrer).origin===location.origin && history.length>1; } catch (_) {}
  var atHome=location.pathname.replace(/index\.html$/,'')===home.pathname.replace(/index\.html$/,'');
  if (!internal && atHome) { button.disabled=true;button.title='ไม่มีหน้าก่อนหน้า'; }
  button.addEventListener('click',function () { if(internal) history.back();else location.assign(home.href); });
  document.body.classList.add('has-app-back');document.body.prepend(button);
}());
