/* Presentation/navigation only. Existing page controllers keep data and permissions. */
(function () {
  'use strict';
  var page = document.body.dataset.dashboard;
  if (!page) return;
  var inIframe = false;
  try { inIframe = window.self !== window.top; } catch (_) { inIframe = true; }
  var isMediaPage = ['tv','banner','receiver'].includes(page);
  if (inIframe && isMediaPage) return;

  var $ = function (s) { return document.querySelector(s); };
  var icons = {
    home:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    barcode:'<path d="M3 5v14m3-14v14M10 5v14m4-14v14m3-14v14m4-14v14"/>',
    stock:'<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10M7.5 5l9 4"/>',
    market:'<path d="M4 20V10m6 10V4m6 16v-7m5 7H2M16 6l3-3 3 3m-3-3v7"/>',
    expiry:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-9 3v3m0 2h.01"/>',
    assets:'<path d="M4 21V5l8-3 8 3v16M8 8h1m6 0h1m-8 4h1m6 0h1M9 21v-5h6v5M2 21h20"/>',
    sound:'<path d="m3 10 5-1 8-5v16l-8-5-5-1v-4Zm5 5 2 6h3m6-13a6 6 0 0 1 0 8"/>',
    music:'<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
    settings:'<path d="m10 3-1 3-3 1-3 3 2 2-2 2 3 3 3 1 1 3h4l1-3 3-1 3-3-2-2 2-2-3-3-3-1-1-3h-4Z"/><circle cx="12" cy="12" r="3"/>',
    tv:'<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    receiver:'<circle cx="12" cy="12" r="3"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4m8.4-8.4a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2m14.2-14.2a10 10 0 0 1 0 14.2"/>',
    banner:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    link:'<path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(2 1)"/>',
    note:'<path d="M14 3H5v18h14V8l-5-5Zm0 0v6h5M8 13h8m-8 4h5"/>'
  };
  function icon(key) { return '<svg class="v16-icon" viewBox="0 0 24 24" aria-hidden="true">' + (icons[key] || icons.link) + '</svg>'; }
  var modules = [
    {key:'index',label:'ภาพรวม',group:'workspace',icon:'home'},
    {key:'barcode',label:'บาร์โค้ดสินค้า',group:'products'},
    {key:'stock',label:'สินค้าค้างสต็อก',group:'products'},
    {key:'expiry',label:'วันหมดอายุ',group:'products'},
    {key:'market',label:'สำรวจราคาตลาด',group:'products'},
    {key:'assets',label:'ทะเบียนสินทรัพย์',group:'products'},
    {key:'sound',label:'เสียงประกาศ',group:'media'},
    {key:'music',label:'เพลงและคิวเพลง',group:'media'},
    {key:'tv',label:'หน้าจอ TV',group:'media',icon:'tv',publicPage:true},
    {key:'receiver',label:'ตัวรับเสียงประกาศ',group:'media',icon:'receiver',publicPage:true},
    {key:'banner',label:'แบนเนอร์โฆษณา',group:'media',icon:'banner',publicPage:true},
    {key:'settings',label:'ตั้งค่าระบบ',group:'admin'}
  ];
  var sidebar = document.createElement('aside');
  sidebar.id = 'v16Sidebar'; sidebar.className = 'v16-sidebar'; sidebar.setAttribute('aria-label','เมนูระบบ CMUCOOP');
  sidebar.innerHTML = '<button class="v16-sidebar-close" type="button" aria-label="ซ่อนแถบด้านข้าง" title="ซ่อนแถบด้านข้าง">' + icon('menu') + '</button><a class="v16-brand" target="_self" href="index.html"><img src="assets/images/logo.png" alt=""><span><strong>CMUCOOP</strong><small>SUPPORT WORKSPACE</small></span></a><nav class="v16-nav" aria-label="ระบบงาน"></nav><div class="v16-profile"><span class="v16-avatar" aria-hidden="true">C</span><div><strong id="v16UserName"></strong><small id="v16UserRole"></small></div></div>';
  document.body.prepend(sidebar);
  var backdrop = document.createElement('button'); backdrop.className='v16-nav-backdrop'; backdrop.tabIndex=-1; backdrop.setAttribute('aria-label','ปิดเมนู'); document.body.append(backdrop);
  var header = isMediaPage ? null : $('.top,.phead,.topbar');
  var toggle = document.createElement('button'); toggle.type='button'; toggle.className='v16-menu-toggle'; toggle.id='v16MenuToggle'; toggle.innerHTML=icon('menu'); toggle.setAttribute('aria-label','เปิด/ปิดแถบด้านข้าง'); toggle.title='เปิด/ปิดแถบด้านข้าง'; toggle.setAttribute('aria-controls',sidebar.id); toggle.setAttribute('aria-expanded','true');
  document.body.append(toggle);
  var mobile = document.createElement('nav'); mobile.className='v16-mobilebar'; mobile.setAttribute('aria-label','แถบนำทางมือถือ');
  mobile.innerHTML='<a href="index.html" target="_self"'+(page==='index'?' aria-current="page"':'')+'>'+icon('home')+'ภาพรวม</a><button type="button" id="v16Top"'+(page!=='index'?' aria-current="page"':'')+'>'+icon(page==='index'?'search':page)+(page==='index'?'ค้นหาระบบ':'หน้านี้')+'</button><button type="button" id="v16MobileMenu" aria-controls="v16Sidebar" aria-expanded="false">'+icon('menu')+'เมนูระบบ</button>';
  if (!isMediaPage) document.body.append(mobile);

  var previousFocus = null;
  var desktopCollapsed = false;
  try {
    var savedCollapsed = localStorage.getItem('cmucoop_v16_sidebar_collapsed');
    if (savedCollapsed === '1') desktopCollapsed = true;
    else if (savedCollapsed === '0') desktopCollapsed = false;
    else if (isMediaPage) desktopCollapsed = true;
  } catch (_) {
    if (isMediaPage) desktopCollapsed = true;
  }

  function isNarrow() {
    return typeof matchMedia === 'function' && matchMedia('(max-width:960px)').matches;
  }

  function isSidebarOpen() {
    return isNarrow() ? document.body.classList.contains('v16-nav-open') : !desktopCollapsed;
  }

  function syncSidebarAttrs() {
    var narrow = isNarrow();
    document.body.classList.toggle('v16-sidebar-collapsed', !narrow && desktopCollapsed);
    var open = isSidebarOpen();
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'ซ่อนแถบด้านข้าง' : 'แสดงแถบด้านข้าง');
    toggle.title = open ? 'ซ่อนแถบด้านข้าง' : 'แสดงแถบด้านข้าง';
    var mobBtn = $('#v16MobileMenu');
    if (mobBtn) mobBtn.setAttribute('aria-expanded', String(narrow && open));
    sidebar.inert = !open;
  }

  function setMenu(open) {
    var narrow = isNarrow();
    if (narrow) {
      if (open) previousFocus = document.activeElement;
      document.body.classList.toggle('v16-nav-open', open);
      syncSidebarAttrs();
      if (open) {
        sidebar.setAttribute('role','dialog');
        sidebar.setAttribute('aria-modal','true');
        sidebar.querySelector('button').focus();
      } else {
        sidebar.removeAttribute('role');
        sidebar.removeAttribute('aria-modal');
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
      }
    } else {
      desktopCollapsed = !open;
      try { localStorage.setItem('cmucoop_v16_sidebar_collapsed', desktopCollapsed ? '1' : '0'); } catch (_) {}
      document.body.classList.remove('v16-nav-open');
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
      syncSidebarAttrs();
    }
  }

  function toggleMenu() {
    setMenu(!isSidebarOpen());
  }

  function syncBreakpoint() {
    var narrow = isNarrow();
    if (!narrow) {
      document.body.classList.remove('v16-nav-open');
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
    }
    syncSidebarAttrs();
  }

  toggle.addEventListener('click', toggleMenu);
  if ($('#v16MobileMenu')) $('#v16MobileMenu').addEventListener('click', toggleMenu);
  sidebar.querySelector('.v16-sidebar-close').addEventListener('click', function(){ setMenu(false); });
  backdrop.addEventListener('click', function(){ setMenu(false); });
  if ($('#v16Top')) $('#v16Top').addEventListener('click',function(){if(page==='index'&&$('#v16PortalSearch')){$('#v16PortalSearch').focus();return;}window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});});
  sidebar.addEventListener('click',function(e){if(isNarrow()&&e.target.closest('a,.v16-side-header button'))setMenu(false);});
  if (typeof matchMedia === 'function') matchMedia('(max-width:960px)').addEventListener('change',syncBreakpoint);
  syncBreakpoint();

  document.addEventListener('keydown',function(e){
    if(e.key==='Escape') { if(document.body.classList.contains('v16-nav-open'))setMenu(false); document.querySelectorAll('.v16-more[open]').forEach(function(d){d.open=false;d.querySelector('summary').focus();}); }
    if(e.key==='Tab'&&document.body.classList.contains('v16-nav-open')) {
      var items=Array.from(sidebar.querySelectorAll('button,a[href]')).filter(function(el){return el.getClientRects().length;}),first=items[0],last=items[items.length-1];
      if(e.shiftKey&&(document.activeElement===first||!sidebar.contains(document.activeElement))){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||!sidebar.contains(document.activeElement))){e.preventDefault();first.focus();}
    }
  });
  // Move existing controls, preserving their IDs, listeners and permission state.
  function moreMenu(host, nodes, label) {
    nodes=nodes.filter(Boolean); if(!host||!nodes.length)return;
    var details=document.createElement('details');details.className='v16-more';
    var summary=document.createElement('summary');summary.innerHTML=icon('more');summary.setAttribute('aria-label',label||'คำสั่งเพิ่มเติม');summary.title=label||'คำสั่งเพิ่มเติม';
    var panel=document.createElement('div');panel.className='v16-more-panel';details.append(summary,panel);host.append(details);nodes.forEach(function(n){panel.append(n);});
    panel.addEventListener('click',function(e){if(e.target.closest('button,a'))details.open=false;});
    function update(){details.hidden=!nodes.some(function(n){return !n.hidden&&!n.classList.contains('hidden');});} update();
    nodes.forEach(function(n){new MutationObserver(update).observe(n,{attributes:true,attributeFilter:['class','hidden']});});
  }
  document.addEventListener('click',function(e){document.querySelectorAll('.v16-more[open]').forEach(function(d){if(!d.contains(e.target)||e.target.closest('.v16-more-panel button,.v16-more-panel a'))d.open=false;});});
  var homes=['bHome','btnHome','muHome','sHome','stHome'];homes.forEach(function(id){var el=document.getElementById(id);if(el)el.classList.add('v16-home-control');});
  document.querySelectorAll('.topbar a[href="index.html"]:not(.brand)').forEach(function(el){el.classList.add('v16-home-control');});
  moreMenu(header && (header.querySelector('.acts')||header.querySelector('.account')||header.querySelector('nav')||header),
    [$('#bNames'),$('#bReload'),$('#btnReload'),$('#btnLogout'),$('#sGoCfg'),$('#logout'),$('.js-pw'),$('.js-logout'),$('#portalSize')]);
  if(header){
    // Reparent the original header so every existing controller keeps its nodes and handlers.
    header.classList.add('v16-side-header');
    header.setAttribute('role','group');header.setAttribute('aria-label','คำสั่งของหน้านี้');
    sidebar.insertBefore(header,sidebar.querySelector('.v16-nav'));
    header.querySelectorAll('.v16-more summary').forEach(function(summary){
      var label=document.createElement('span');label.textContent=summary.getAttribute('aria-label')||'คำสั่งเพิ่มเติม';summary.append(label);
    });
    document.body.classList.add('v16-sidebar-layout');
  } else {
    document.body.classList.add('v16-sidebar-layout');
  }
  if(page==='assets')moreMenu($('.intro-actions'),[$('#printStickersBtn'),$('#exportExcelBtn'),$('#importExcelBtn')],'นำเข้า ส่งออก และพิมพ์');
  var primary={assets:'addAsset',expiry:'addLot',stock:'bUpload',market:'bUpload'}[page];
  if(primary && document.getElementById(primary))document.getElementById(primary).classList.add('v16-primary-action');
  ['assetDialog','lotDialog','historyDialog','importDialog','titleDialog'].forEach(function(id){var d=document.getElementById(id);if(d)d.classList.add('v16-sheet');});
  ['editModal','sizeModal','upDlg','nmDlg','sndModal','schModal'].forEach(function(id){var d=document.getElementById(id);if(d)d.classList.add('v16-sheet-wrap');});
  var me=window.CMUCOOP_SESSION||null, hiddenCards=null, navToken='', pending=false;
  if(!me){try{var storedMe=sessionStorage.getItem('pm_me');if(storedMe)me=JSON.parse(storedMe);}catch(_){}}
  function token(){if(window.CMUCOOP_SESSION_TOKEN)return window.CMUCOOP_SESSION_TOKEN;try{return sessionStorage.getItem('pm_tok')||'';}catch(_){return '';}}
  function anonymous(){var login=$('#loginPanel,#login');return document.body.classList.contains('locked')||!!(login&&!login.hidden&&!login.classList.contains('hidden'));}
  function renderNav(){
    var nav=sidebar.querySelector('.v16-nav');nav.textContent='';var last='';
    modules.forEach(function(m){
      var allowed = m.key==='index' || m.key===page || (isMediaPage && m.publicPage) || (me && (m.key==='settings' ? me.role==='admin' : (me.role==='admin' || !!(me.perms && me.perms[m.key]))));
      if(!allowed) return;
      if(!m.publicPage && m.key!=='index' && m.key!==page && (hiddenCards===null || hiddenCards.includes(m.key))) return;
      if(m.publicPage && m.key!==page && !isMediaPage && !(me && me.role==='admin')) return;
      if(m.group!==last){last=m.group;var title=document.createElement('p');title.className='v16-nav-heading';title.textContent={workspace:'พื้นที่ทำงาน',products:'สินค้าและสินทรัพย์',media:'สื่อและการสื่อสาร',admin:'การจัดการ'}[m.group];nav.append(title);}
      var a=document.createElement('a');a.href=m.key+'.html'+(token()?'#t='+encodeURIComponent(token()):'');a.target='_self';a.innerHTML=icon(m.icon||m.key);var text=document.createElement('span');text.textContent=m.label;a.append(text);if(m.key===page)a.setAttribute('aria-current','page');nav.append(a);
    });
    $('#v16UserName').textContent=me?(me.name||me.user||'ผู้ใช้งาน'):(isMediaPage?'โหมดหน้าจอแสดงผล':'');
    $('#v16UserRole').textContent=me?(me.role==='admin'?'ผู้ดูแลระบบ':'ผู้ใช้งาน'):(isMediaPage?'CMUCOOP DISPLAY':'');
    sidebar.querySelector('.v16-avatar').textContent=me?Array.from(me.name||me.user||'C')[0]:'C';
    var home='index.html'+(token()?'#t='+encodeURIComponent(token()):'');sidebar.querySelector('.v16-brand').href=home;
    var mobHome = mobile.querySelector('a');
    if (mobHome) mobHome.href=home;
  }
  function syncSession(){
    pending=false;
    var signed = isMediaPage ? true : (!!me&&!!token()&&!anonymous());
    document.body.classList.toggle('v16-authenticated',signed);
    if(!signed){if(document.body.classList.contains('v16-nav-open'))setMenu(false);return;}
    if(token() && navToken!==token()){
      navToken=token();hiddenCards=null;renderNav();var requestedToken=navToken;
      if(window.google&&google.script)google.script.run.withSuccessHandler(function(list){if(requestedToken!==token())return;hiddenCards=Array.isArray(list)?list:[];renderNav();}).withFailureHandler(function(){hiddenCards=null;renderNav();}).getHiddenCards(navToken);
    }
  }
  function scheduleSession(){if(!pending){pending=true;requestAnimationFrame(syncSession);}}
  // This event is emitted by the shared API adapter after a verified auth response.
  window.addEventListener('cmucoop:session',function(e){me=e.detail&&e.detail.me||null;scheduleSession();renderNav();});
  window.addEventListener('cmucoop:cards',function(e){if(Array.isArray(e.detail)) {hiddenCards=e.detail;renderNav();}});
  new MutationObserver(scheduleSession).observe(document.body,{attributes:true,attributeFilter:['class']});
  var login=$('#loginPanel,#login');if(login)new MutationObserver(scheduleSession).observe(login,{attributes:true,attributeFilter:['hidden','class']});
  renderNav(); scheduleSession();
  // Existing tabs receive consistent keyboard semantics without replacing their handlers.
  ['#stNav','#sTabs','.mu-tabs'].forEach(function(selector){
    var bar=$(selector);if(!bar)return;bar.setAttribute('role','tablist');bar.setAttribute('aria-label',selector==='#stNav'?'หมวดการตั้งค่า':selector==='#sTabs'?'ประเภทการประกาศ':'คิวเพลงและประวัติ');
    function update(){bar.querySelectorAll('button').forEach(function(b){b.setAttribute('role','tab');b.setAttribute('aria-selected',String(b.classList.contains('on')));b.tabIndex=b.classList.contains('on')?0:-1;var pane=b.dataset.sp?'st-'+b.dataset.sp:b.dataset.st?'s-'+b.dataset.st:'muBody';if(document.getElementById(pane))b.setAttribute('aria-controls',pane);});}
    bar.addEventListener('keydown',function(e){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();var buttons=Array.from(bar.querySelectorAll('button')),i=buttons.indexOf(document.activeElement),n=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[n].click();buttons[n].focus();});
    new MutationObserver(update).observe(bar,{subtree:true,attributes:true,attributeFilter:['class']});update();
  });
  if(page==='stock'){
    var notes=$('#stockNotesCard');if(notes){var details=document.createElement('details');details.className='v16-notes';var summary=document.createElement('summary');summary.innerHTML=icon('note')+'บันทึกและข้อความของทีม';notes.parentNode.insertBefore(details,notes);details.append(summary,notes);}
  }
  if(page==='sound')$('#s-send').classList.add('v16-sound-grid');
  if(page==='settings'||page==='sound'){
    var intro=document.createElement('div');intro.className='v16-page-intro';var title=page==='settings'?'ตั้งค่าพื้นที่ทำงาน':'สื่อสารกับทีมและหน้าร้าน';var copy=page==='settings'?'จัดการเมนู ผู้ใช้งาน เสียงประกาศ และจอประชาสัมพันธ์ในที่เดียว':'เลือกประเภทการประกาศ แล้วส่งสัญญาณไปยังหน้าจอ TV';intro.innerHTML='<div class="workspace-eyebrow">CMUCOOP WORKSPACE</div><h2>'+title+'</h2><p>'+copy+'</p>';$('.pwrap').prepend(intro);
  }
  if(page==='index'){
    var wrap=$('#portal .pwrap'),tools=document.createElement('div');tools.className='v16-portal-toolbar';tools.innerHTML='<div><h3>ระบบงานของคุณ</h3><p>เลือกเครื่องมือที่ต้องการเริ่มทำงาน</p></div><input class="v16-portal-search" id="v16PortalSearch" type="search" aria-label="ค้นหาระบบงาน" placeholder="ค้นหาระบบงาน…">';wrap.prepend(tools);
    var filters=document.createElement('div');filters.className='v16-filterbar';filters.setAttribute('role','group');filters.setAttribute('aria-label','หมวดระบบงาน');
    [['all','ทั้งหมด'],['products','สินค้าและสินทรัพย์'],['media','สื่อและการสื่อสาร'],['admin','การจัดการ'],['links','ลิงก์อื่น ๆ']].forEach(function(pair){var b=document.createElement('button');b.type='button';b.dataset.v16Filter=pair[0];b.setAttribute('aria-pressed',String(pair[0]==='all'));b.textContent=pair[1];filters.append(b);});tools.after(filters);
    var noResults=document.createElement('p');noResults.className='v16-no-results';noResults.setAttribute('role','status');noResults.hidden=true;noResults.textContent='ไม่พบระบบงานที่ตรงกับคำค้นหรือหมวดที่เลือก';$('#portal .menu').after(noResults);
    var group='all',cardsPending=false;
    function decorate(){
      cardsPending=false;var q=$('#v16PortalSearch').value.trim().toLocaleLowerCase('th');var visible=0;
      document.querySelectorAll('#portal .mcard').forEach(function(card){
        var key=card.dataset.ck||card.id.replace(/^m/,'').toLowerCase(),m=modules.find(function(x){return x.key===key;}),category=m?m.group:'links';card.dataset.v16Group=category;
        if(!card.querySelector('.v16-card-icon')){var badge=document.createElement('span');badge.className='v16-card-icon';badge.innerHTML=icon(key);card.prepend(badge);}
        card.hidden=(group!=='all'&&category!==group)||(q&&!card.textContent.toLocaleLowerCase('th').includes(q));if(!card.hidden&&!card.classList.contains('hidden'))visible++;
      });
      var loading=$('#portal .menu').getAttribute('aria-busy')==='true';noResults.hidden=loading||!!visible;
    }
    $('#v16PortalSearch').addEventListener('input',decorate);
    filters.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;group=b.dataset.v16Filter;filters.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});decorate();});
    new MutationObserver(function(changes){if(cardsPending||!changes.some(function(c){return c.type==='childList'||c.attributeName==='class'||c.attributeName==='aria-busy';}))return;cardsPending=true;requestAnimationFrame(decorate);}).observe($('#portal .menu'),{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-busy']});decorate();
  }
})();
