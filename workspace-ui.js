/* Workspace navigation changes presentation only; page controllers own data. */
(function(){
  'use strict';
  var kind=document.body.dataset.workspace;
  var marketFullHead='',marketView='focus';
  var marketLabels=['ลำดับ','รหัสบาร์','สินค้า','คงเหลือ','การปรับล่าสุด','วันที่ปรับ','ต้นทุน','ราคาขาย','กำไรก่อน VAT','อัตรากำไรก่อน VAT','ต้นทุนรวม VAT','กำไรรวม VAT','อัตรากำไรรวม VAT','ราคากำไร 30%','ราคาตลาดต่ำสุด','ราคาตลาดสูงสุด','คำแนะนำ','ราคาแนะนำ','หมายเหตุ','ค้นหา'];
  function byId(id){return document.getElementById(id);}
  function resizeCharts(){requestAnimationFrame(function(){document.querySelectorAll('canvas').forEach(function(canvas){if(window.Chart&&canvas.getClientRects().length){var chart=Chart.getChart(canvas);if(chart)chart.resize();}});if(typeof window.fixHead==='function')window.fixHead();});}
  function workTab(key,focus){
    document.querySelectorAll('[data-work-tab]').forEach(function(b){var on=b.dataset.workTab===key;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;if(on&&focus)b.focus();});
    document.querySelectorAll('[data-work-pane]').forEach(function(p){p.hidden=p.dataset.workPane!==key;});resizeCharts();
  }
  function keyboardTabs(event,selector,select){
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();var buttons=Array.from(document.querySelectorAll(selector)),index=buttons.indexOf(event.currentTarget),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;select(buttons[next]);buttons[next].focus();
  }
  function marketRows(){
    var table=byId('mt');if(!table)return;
    table.querySelectorAll('tbody tr').forEach(function(row){if(row.cells.length!==20)return;Array.from(row.cells).forEach(function(cell,index){cell.dataset.label=marketLabels[index];});});
  }
  function marketSelect(view){
    marketView=view;
    document.body.classList.toggle('market-focus',view==='focus');
    byId('marketTableCard').hidden=view==='summary';byId('sumCard').hidden=view!=='summary';
    document.querySelectorAll('[data-market-view]').forEach(function(b){var on=b.dataset.marketView===view;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;if(on&&view!=='summary')byId('marketTableCard').setAttribute('aria-labelledby',b.id);});
    byId('marketViewHelp').textContent=view==='focus'?'กรอกราคาตลาดและข้อเสนอปรับราคาได้โดยตรง · ช่องกรอกกรอบสีม่วงแก้ไขได้':view==='full'?'ข้อมูลต้นทุน กำไร VAT และประวัติปรับราคาแบบครบทุกคอลัมน์':'ตรวจสรุปและชื่อผู้ลงนามก่อนส่งออกรายงาน Excel';
    byId('mt').querySelector('thead').innerHTML=view==='focus'?'<tr>'+[1,2,3,7,14,15,16,17,18,19].map(function(i){return '<th scope="col">'+marketLabels[i]+'</th>';}).join('')+'</tr>':marketFullHead;
    marketRows();resizeCharts();
  }
  function barcodeStats(){
    if(kind!=='barcode'||typeof window.S==='undefined')return;
    var data=window.S,cats=data.cats||[],total=cats.reduce(function(sum,c){return sum+(Number(c.items)||0);},0);
    var box=byId('barcodeStats');if(box){box.textContent='';[[cats.length,'หมวดสินค้า'],[total.toLocaleString('th-TH'),'รายการทั้งหมด'],[data.data?(data.data.rows||[]).length.toLocaleString('th-TH'):'–','รายการในหมวดที่เลือก']].forEach(function(pair){var cell=document.createElement('div'),value=document.createElement('strong'),label=document.createElement('span');cell.className='workspace-stat';value.textContent=pair[0];label.textContent=pair[1];cell.append(value,label);box.appendChild(cell);});}
    categorySearch();
  }
  function categorySearch(){
    var input=byId('bcCategorySearch');if(!input)return;
    var q=input.value.trim().toLowerCase(),hits=0;
    document.querySelectorAll('#catSide ul').forEach(function(group){var found=0;group.querySelectorAll('li').forEach(function(li){var match=li.textContent.toLowerCase().includes(q);li.hidden=!match;if(match){found++;hits++;}});group.hidden=!found;if(group.previousElementSibling&&group.previousElementSibling.classList.contains('gh'))group.previousElementSibling.hidden=!found;});
    byId('bcNoCats').hidden=!q||!!hits;
  }
  window.WorkspaceUI={marketRows:marketRows,barcodeStats:barcodeStats,workTab:workTab};
  document.querySelectorAll('[data-work-tab]').forEach(function(b){b.addEventListener('click',function(){workTab(b.dataset.workTab);});b.addEventListener('keydown',function(e){keyboardTabs(e,'[data-work-tab]',function(next){workTab(next.dataset.workTab);});});});
  document.querySelectorAll('[data-clear-search]').forEach(function(b){b.addEventListener('click',function(){var input=byId('fQ');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();});});
  if(kind==='stock'){byId('fQ').addEventListener('input',function(){workTab('items');});workTab('items');}
  if(kind==='market'){
    marketFullHead=byId('mt').querySelector('thead').innerHTML;
    document.querySelectorAll('[data-market-view]').forEach(function(b){b.addEventListener('click',function(){marketSelect(b.dataset.marketView);});b.addEventListener('keydown',function(e){keyboardTabs(e,'[data-market-view]',function(next){marketSelect(next.dataset.marketView);});});});
    byId('fQ').addEventListener('input',function(){if(marketView==='summary')marketSelect('focus');});marketSelect('focus');
  }
  if(kind==='barcode'){
    byId('bcCategorySearch').addEventListener('input',categorySearch);
    byId('bcAllCategories').addEventListener('click',function(){if(window.S&&S.me&&S.me.role==='admin'){selectCat(allCat().key);switchTab('data');}});
    document.querySelectorAll('.tab[data-t]').forEach(function(tab){tab.setAttribute('role','tab');tab.setAttribute('aria-controls','v-'+tab.dataset.t);tab.addEventListener('keydown',function(e){keyboardTabs(e,'.tab[data-t]:not(.hidden)',function(next){switchTab(next.dataset.t);});});});
    barcodeStats();
  }
  if(kind==='music'){
    byId('muSearch').addEventListener('input',function(){MU.query=this.value;muRender();});
    byId('muScope').addEventListener('change',function(){MU.scope=this.value;muRender();});
    byId('muRefresh').addEventListener('click',async function(){this.disabled=true;try{await muLoad();}finally{this.disabled=false;}});
  }
})();
