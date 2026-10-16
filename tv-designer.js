/* The editor sends drafts only to a same-origin, silent tv.html preview.
   setTvConfig is called exclusively by the Save button. */
var TVC = {def:null,saved:null,dirty:false,loading:false,saving:false,loadId:0,previewSeq:0,ready:false,timer:null,pendingTab:null};
var TV_COLOR_FIELDS = [['textColor','Text'],['clockColor','Clock'],['shopColor','Shop'],['welcomeColor','Welcome'],['subColor','Sub'],['captionColor','Caption'],['footColor','Foot']];
var TV_FIELDS = [
  ['shop','tvShop','text'],['helloMain','tvHelloMain','text'],['helloSub','tvHelloSub','text'],['caption','tvCaption','text'],
  ['bg','tvBg','color'],['font','tvFont','text'],['headLayout','tvHeadLayout','text'],
  ['width','tvWidth','number',480,3840],['bannerH','tvBannerH','number',60,2000],['receiverH','tvReceiverH','number',150,2000],
  ['bannerW','tvBannerW','number',0,3840],['receiverW','tvReceiverW','number',0,3840],['gap','tvGap','number',0,200],
  ['padTop','tvPadTop','number',0,600],['logoSize','tvLogoSize','number',20,600],['headGap','tvHeadGap','number',0,200],
  ['gapBanner','tvGapBanner','optional',0,200],['gapCaption','tvGapCaption','optional',0,200],['gapReceiver','tvGapReceiver','optional',0,200],['gapFoot','tvGapFoot','optional',0,200],
  ['fontClock','tvFontClock','number',10,200],['fontShop','tvFontShop','number',10,200],['fontHello','tvFontHello','number',10,200],['fontCaption','tvFontCaption','number',10,200],['capSpeed','tvCapSpeed','number',10,400],
  ['showLogo','tvShowLogo','bool'],['showClock','tvShowClock','bool'],['showBanner','tvShowBanner','bool']
];
var TV_PRESETS = {
  balanced:{width:1280,bannerH:380,receiverH:300,fontClock:28,fontShop:34,fontHello:34,fontCaption:28,gap:18,padTop:24,logoSize:100,headGap:20,headLayout:'side'},
  banner:{width:1800,bannerH:600,receiverH:180,fontClock:26,fontShop:32,fontHello:28,fontCaption:28,gap:14,padTop:18,logoSize:84,headGap:18,headLayout:'side'},
  portrait:{width:1000,bannerH:760,receiverH:320,fontClock:28,fontShop:36,fontHello:34,fontCaption:30,gap:22,padTop:32,logoSize:120,headGap:14,headLayout:'stack'}
};
function tvAutoTextColor(bg) {
  var h=/^#[0-9a-f]{6}$/i.test(bg)?bg.slice(1):'a07ab8';
  function lum(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);}
  function light(s){return .2126*lum(parseInt(s.slice(0,2),16))+.7152*lum(parseInt(s.slice(2,4),16))+.0722*lum(parseInt(s.slice(4,6),16));}
  var b=light(h),d=light('1f1530'),w=1.05/(b+.05),r=(Math.max(b,d)+.05)/(Math.min(b,d)+.05);
  return r>w&&w<4.5?'#1f1530':'#ffffff';
}
function tvReadColors(){var out={};TV_COLOR_FIELDS.forEach(function(p){out[p[0]]=$('#tv'+p[1]+'ColorAuto').checked?'':$('#tv'+p[1]+'Color').value;});return out;}
function tvReadForm(strict){
  var out={},defaults=TVC.def||{},saved=TVC.saved||{};
  TV_FIELDS.forEach(function(f){
    var el=$('#'+f[1]),raw=el.value,v=raw;
    if(f[2]==='bool')v=el.checked;
    else if(f[2]==='number'||f[2]==='optional'){
      if(f[2]==='optional'&&raw==='')v=null;
      else{
        v=Number(raw);
        if(raw===''||!Number.isFinite(v)||v<f[3]||v>f[4]){
          if(strict){var e=new Error('กรุณาระบุ '+(el.dataset.label||f[0])+' ระหว่าง '+f[3]+'–'+f[4]);e.field=el;throw e;}
          v=saved[f[0]]===undefined?defaults[f[0]]:saved[f[0]];
          if(v===undefined||v===null)v=f[3];
        }
        v=Math.round(v);
      }
    }else if(strict&&el.maxLength>0&&raw.length>el.maxLength){var e2=new Error('ข้อความยาวเกิน '+el.maxLength+' ตัวอักษร');e2.field=el;throw e2;}
    out[f[0]]=v;
  });
  return Object.assign(out,tvReadColors());
}
function tvComparable(c){
  var out={};TV_FIELDS.forEach(function(f){var v=c[f[0]];out[f[0]]=f[2]==='optional'&&(v===null||v===undefined||v==='')?null:f[2]==='number'||f[2]==='optional'?Number(v):f[2]==='bool'?!!v:String(v==null?'':v);});
  TV_COLOR_FIELDS.forEach(function(p){out[p[0]]=String(c[p[0]]||'').toLowerCase();});return JSON.stringify(out);
}
function tvSyncControls(){
  var colors=tvReadColors(),fg=colors.textColor||tvAutoTextColor($('#tvBg').value);
  $('#tvBgValue').textContent=$('#tvBg').value.toUpperCase();
  TV_COLOR_FIELDS.forEach(function(p){var id='#tv'+p[1]+'Color',el=$(id),auto=$(id+'Auto').checked;el.disabled=auto;$(id+'Value').textContent=auto?(p[0]==='textColor'?'อัตโนมัติ':'ใช้สีรวม'):el.value.toUpperCase();if(auto)el.value=fg;});
  document.querySelectorAll('#st-tv input[data-range-for]').forEach(function(range){var target=$('#'+range.dataset.rangeFor);range.value=target.value||range.min;});
}
function tvSetStatus(){
  var state=$('#tvSaveState'),hint=$('#tvSaveHint');
  $('#tvSave').disabled=TVC.loading||TVC.saving||!TVC.saved||!TVC.dirty;
  $('#tvRevert').disabled=TVC.loading||TVC.saving||!TVC.saved||!TVC.dirty;
  $('#tvEditorFields').disabled=TVC.loading||!TVC.saved;
  $('#tvReload').disabled=TVC.loading||TVC.saving;
  $('#tvReset').disabled=TVC.loading||TVC.saving||!TVC.def;
  $('#tvSave').textContent=TVC.saving?'กำลังบันทึก…':'บันทึกและใช้จริง';
  state.textContent=TVC.loading?'กำลังโหลดการตั้งค่า':TVC.saving?'กำลังส่งค่าไปยังเซิร์ฟเวอร์':!TVC.saved?'ยังโหลดการตั้งค่าไม่สำเร็จ':TVC.dirty?'มีการเปลี่ยนแปลงที่ยังไม่บันทึก':'ใช้ค่าที่บันทึกไว้';
  hint.textContent=TVC.dirty?'พรีวิวเปลี่ยนแล้ว · จอจริงจะเปลี่ยนหลังบันทึก':'ค่าที่บันทึกแล้วจะอัปเดตบนจอ TV ภายใน 1 นาที';
}
function tvQueuePreview(){
  clearTimeout(TVC.timer);TVC.timer=setTimeout(tvSendPreview,70);
}
function tvOnChange(event){
  if(TVC.loading||!TVC.saved)return;
  if(event&&event.target.dataset.rangeFor){$('#'+event.target.dataset.rangeFor).value=event.target.value;}
  tvSyncControls();TVC.dirty=tvComparable(tvReadForm(false))!==tvComparable(TVC.saved)||TV_FIELDS.some(function(f){if(f[2]!=='number'&&f[2]!=='optional')return false;var v=$('#'+f[1]).value;if(f[2]==='optional'&&v==='')return false;return v===''||!Number.isFinite(Number(v))||Number(v)<f[3]||Number(v)>f[4];});tvSetStatus();tvQueuePreview();
  document.querySelectorAll('[data-tv-preset]').forEach(function(b){b.classList.remove('on');});
}
function tvFill(c){
  TV_FIELDS.forEach(function(f){var el=$('#'+f[1]),v=c[f[0]];if(f[2]==='bool')el.checked=!!v;else el.value=v===null||v===undefined?'':v;});
  TV_COLOR_FIELDS.forEach(function(p){var value=String(c[p[0]]||''),custom=/^#[0-9a-f]{6}$/i.test(value),id='#tv'+p[1]+'Color';$(id+'Auto').checked=!custom;$(id).value=custom?value:'#ffffff';});
  tvSyncControls();tvSetStatus();tvQueuePreview();
}
function tvTab(name,focus){
  document.querySelectorAll('[data-tv-tab]').forEach(function(b){var on=b.dataset.tvTab===name;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
  document.querySelectorAll('[data-tv-pane]').forEach(function(p){p.hidden=p.dataset.tvPane!==name;});
  if(focus)document.querySelector('[data-tv-tab="'+name+'"]').focus();
}
function tvEnsurePreview(){
  var frame=$('#tvLivePreview');
  if(!frame.getAttribute('src'))frame.src=pageUrl('tv.html','https://cmucoop-support.github.io/CMUCOOP-SP/tv.html')+'?preview=1';
  requestAnimationFrame(tvFitPreview);
}
function tvFitPreview(){
  var host=$('#tvPreviewHost'),shell=$('#tvPreviewShell'),frame=$('#tvLivePreview');if(!host.clientWidth)return;
  var size=$('#tvPreviewSize').value.split('x').map(Number),w=size[0],h=size[1];
  var full=document.fullscreenElement===$('#tvPreviewPanel'),available=Math.max(100,host.clientWidth-42),height=full?Math.max(200,innerHeight-160):Math.min(620,Math.max(230,innerHeight-285));
  if(innerWidth<=800&&!full)height=Math.min(height,320);
  var scale=Math.min(available/w,height/h);
  shell.style.width=(w*scale)+'px';shell.style.height=(h*scale)+'px';frame.style.width=w+'px';frame.style.height=h+'px';frame.style.transform='scale('+scale+')';
  $('#tvPreviewScale').textContent=w+' × '+h+' · ย่อ '+Math.round(scale*100)+'%';
}
function tvSendPreview(){
  if(!TVC.saved)return;
  var frame=$('#tvLivePreview');if(!frame.contentWindow||!frame.getAttribute('src'))return;
  frame.contentWindow.postMessage({type:'cmucoop:tv-preview',config:tvReadForm(false),seq:++TVC.previewSeq},location.origin);
}
function tvShowError(message,field){
  var box=$('#tvEditorError');box.textContent=message||'';box.hidden=!message;
  if(field){var pane=field.closest('[data-tv-pane]');if(pane)tvTab(pane.dataset.tvPane);var details=field.closest('details');if(details)details.open=true;field.focus();field.scrollIntoView({block:'center',behavior:'smooth'});}
}
async function tvLoad(force){
  $('.pwrap').classList.add('tv-editor-open');
  var url=pageUrl('tv.html','https://cmucoop-support.github.io/CMUCOOP-SP/tv.html');$('#sTv').value=url;$('#sTvOpen').href=url;
  if(TVC.saved&&!force){tvEnsurePreview();tvSetStatus();if(TVC.pendingTab){tvTab(TVC.pendingTab);TVC.pendingTab=null;}return;}
  if(TVC.loading)return;
  var id=++TVC.loadId,token=S.token;TVC.loading=true;tvShowError('');tvSetStatus();
  try{
    var r=await call('getTvConfig');if(id!==TVC.loadId||token!==S.token||!S.me)return;
    if(!r||!r.cfg||!r.def)throw new Error('ข้อมูลตั้งค่าหน้าจอ TV ไม่ครบ กรุณาลองโหลดอีกครั้ง');
    TVC.def=r.def;TVC.saved=Object.assign({},r.def,r.cfg);TVC.dirty=false;TVC.loading=false;tvFill(TVC.saved);tvEnsurePreview();
    if(TVC.pendingTab){tvTab(TVC.pendingTab);TVC.pendingTab=null;}
  }catch(e){if(token===S.token)tvShowError('โหลดการตั้งค่าไม่สำเร็จ: '+e.message);}
  finally{if(id===TVC.loadId){TVC.loading=false;tvSetStatus();}}
}
function tvResetSession(){
  TVC.loadId++;TVC.saved=null;TVC.def=null;TVC.dirty=false;TVC.loading=false;TVC.saving=false;TVC.ready=false;TVC.pendingTab=null;clearTimeout(TVC.timer);
  var frame=$('#tvLivePreview');if(frame)frame.removeAttribute('src');
}
function initTvDesigner(){
  $('#tvEditorFields').addEventListener('input',tvOnChange);$('#tvEditorFields').addEventListener('change',tvOnChange);
  document.querySelectorAll('[data-tv-tab]').forEach(function(b){
    b.addEventListener('click',function(){tvTab(b.dataset.tvTab);});
    b.addEventListener('keydown',function(e){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();var buttons=Array.from(document.querySelectorAll('[data-tv-tab]')),index=buttons.indexOf(b),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;tvTab(buttons[next].dataset.tvTab,true);});
  });
  document.querySelectorAll('[data-tv-preset]').forEach(function(b){b.addEventListener('click',function(){var c=Object.assign(tvReadForm(false),TV_PRESETS[b.dataset.tvPreset],{bannerW:0,receiverW:0,gapBanner:null,gapCaption:null,gapReceiver:null,gapFoot:null});tvFill(c);tvOnChange();b.classList.add('on');if(b.dataset.tvPreset==='portrait')$('#tvPreviewSize').value='1080x1920';else $('#tvPreviewSize').value='1920x1080';tvFitPreview();});});
  $('#tvLivePreview').addEventListener('load',function(){tvFitPreview();tvSendPreview();});
  window.addEventListener('message',function(e){
    if(e.origin!==location.origin||e.source!==$('#tvLivePreview').contentWindow||!e.data)return;
    if(e.data.type==='cmucoop:tv-preview-ready'){TVC.ready=true;tvSendPreview();}
    if(e.data.type==='cmucoop:tv-preview-applied'&&e.data.seq===TVC.previewSeq){$('#tvPreviewState').textContent='อัปเดตพรีวิวแล้ว · ไม่เล่นเสียง';$('#tvOverflowHint').hidden=!e.data.overflow;}
  });
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(tvFitPreview).observe($('#tvPreviewHost'));
  window.addEventListener('resize',tvFitPreview);document.addEventListener('fullscreenchange',function(){$('#tvPreviewExpand').textContent=document.fullscreenElement?'ออกจากเต็มจอ':'เต็มจอ';tvFitPreview();});
  $('#tvPreviewSize').addEventListener('change',tvFitPreview);
  $('#tvPreviewExpand').addEventListener('click',async function(){try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#tvPreviewPanel').requestFullscreen();}catch(e){tvShowError('เบราว์เซอร์นี้เปิดพรีวิวเต็มจอไม่ได้ สามารถเลือกขนาดจอด้านบนเพื่อเปรียบเทียบได้');}});
  $('#tvMobilePreview').addEventListener('click',function(){var collapsed=$('.tv-designer-layout').classList.toggle('preview-collapsed');this.textContent=collapsed?'แสดงพรีวิว':'พับพรีวิว';this.setAttribute('aria-expanded',String(!collapsed));tvFitPreview();});
  $('#tvJumpPreview').addEventListener('click',function(){$('.tv-designer-layout').classList.remove('preview-collapsed');$('#tvMobilePreview').textContent='พับพรีวิว';$('#tvMobilePreview').setAttribute('aria-expanded','true');$('#tvPreviewPanel').scrollIntoView({block:'start',behavior:'smooth'});tvFitPreview();});
  $('#tvRevert').addEventListener('click',function(){if(TVC.saved){TVC.dirty=false;tvFill(TVC.saved);tvShowError('');}});
  $('#tvReset').addEventListener('click',function(){if(TVC.def){tvFill(TVC.def);tvOnChange();tvShowError('');}});
  $('#tvReload').addEventListener('click',function(){if(TVC.saved&&TVC.dirty){tvShowError('มีค่าที่ยังไม่บันทึก กด “ยกเลิกที่แก้” ก่อนโหลดค่าจากเซิร์ฟเวอร์');return;}tvLoad(true);});
  $('#tvSave').addEventListener('click',async function(){
    if(TVC.saving||TVC.loading||!TVC.saved||!TVC.dirty)return;
    var draft;try{draft=tvReadForm(true);}catch(e){tvShowError(e.message,e.field);return;}
    var token=S.token;TVC.saving=true;tvShowError('');tvSetStatus();
    try{
      var result=await call('setTvConfig',draft);if(token!==S.token||!S.me)return;
      TVC.saved=Object.assign({},draft,result&&result.cfg?result.cfg:{});TVC.dirty=tvComparable(tvReadForm(false))!==tvComparable(TVC.saved);
      if(!TVC.dirty)tvFill(TVC.saved);toast('บันทึกแล้ว หน้าจอ TV จะอัปเดตภายใน 1 นาที');
    }catch(e){if(token===S.token)tvShowError('บันทึกไม่สำเร็จ ค่าที่แก้ยังอยู่ในพรีวิว: '+e.message);}
    finally{if(token===S.token){TVC.saving=false;tvSetStatus();}}
  });
  $('#sTvCopy').addEventListener('click',function(){if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText($('#sTv').value).then(function(){toast('คัดลอกลิงก์ TV แล้ว');},function(){copyField('#sTv','คัดลอกลิงก์ TV แล้ว');});else copyField('#sTv','คัดลอกลิงก์ TV แล้ว');});
  $('#bTextColors').addEventListener('click',function(){TVC.pendingTab='style';stPanel('tv');tvTab('style');$('#st-tv').scrollIntoView({block:'start'});});
  tvTab('content');tvSetStatus();
}
