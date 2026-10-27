/* Market survey XLSX writer. A:V report, W:Y import metadata. */
var XL_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
var XL_RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
var XL_WIDTHS = [7,18,40,11,24,14,12,12,12,12,12,12,12,14,12,12,20,12,28,12,13,13];
var XL_STYLE = Object.create(null);
function xlEsc(value) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function xlCol(i) {
  var name='';
  for(i++;i>0;i=Math.floor((i-1)/26)) name=String.fromCharCode(65+(i-1)%26)+name;
  return name;
}
function xlSerial(iso) {
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||''));
  if(!m) return null;
  var time=Date.UTC(+m[1],+m[2]-1,+m[3]);
  return new Date(time).toISOString().slice(0,10)===iso ? time/86400000+25569 : null;
}
function xlSheetNames(sheets) {
  var used=Object.create(null);
  return sheets.map(function(sh) {
    var base=String(sh.name||'รายงาน').replace(/[\[\]:*?\/\\\u0000-\u001F]/g,'_').replace(/^'+|'+$/g,'').trim()||'รายงาน';
    if(/^history$/i.test(base)) base+='_';
    var name,suffix='',i=1;
    do { name=base.slice(0,31-suffix.length).replace(/[\uD800-\uDBFF]$/,'')+suffix; suffix=' ('+(++i)+')'; } while(used[name.toLowerCase()]);
    used[name.toLowerCase()]=true;
    return Object.assign({},sh,{name:name});
  });
}
/* Colors match computed screen styles in shared/liquid-glass.css and pages/market.css.
 * The solid XLSX fills retain the website's purple palette and market column/status colors. */
function xlMarketStyles() {
  var xfs=[];
  function style(name,font,fill,border,fmt,align) {
    XL_STYLE[name]=xfs.length;
    xfs.push('<xf numFmtId="'+(fmt||0)+'" fontId="'+font+'" fillId="'+fill+'" borderId="'+border+'" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="'+(align||'left')+'" wrapText="1"/></xf>');
  }
  style('normal',0,0,0); style('title',1,0,0); style('meta',2,0,0);
  style('band',3,2,0,0,'center'); style('header',4,3,1,0,'center'); style('summary',4,3,0);
  style('summaryValue',4,3,0,3,'right'); style('summaryPct',4,3,0,166,'right');
  style('signature',0,0,2,0,'center'); style('role',2,0,0,0,'center');
  ['even','odd'].forEach(function(stripe,i) {
    var fill=i?4:0;
    style('text_'+stripe,0,fill,1,49); style('center_'+stripe,0,fill,1,49,'center');
    style('qty_'+stripe,0,fill,1,164,'right'); style('money_'+stripe,0,fill,1,165,'right');
    style('pct_'+stripe,0,fill,1,166,'right'); style('date_'+stripe,0,fill,1,167,'center');
    style('input_'+stripe,5,5,1,49); style('inputMoney_'+stripe,5,5,1,165,'right');
  });
  style('cost',6,6,1,165,'right'); style('sale',7,7,1,165,'right');
  style('vat',8,8,1,165,'right'); style('price30',6,9,1,165,'right');
  style('marketMoney',9,10,1,165,'right'); style('marketText',9,10,1,49);
  var fonts=[[10,'302744'],[16,'6036AD',true],[9,'665D77'],[10,'FFFFFF',true],[10,'4F3B6D',true],[10,'6036AD'],[10,'2A1F47'],[10,'3B1D8F',true],[10,'14532D'],[10,'6B1D4A']];
  var fills=['none','gray125','7045C6','EEE8F7','FAF8FD','F6EFFF','F0EAFB','E2D6FA','E6F3EC','F4F0FB','FBEAF4'];
  // Excel differential fills must not inherit system background index 64.
  var colors=[['FFF3C4','5C4400'],['FFD5D8','8A1C24'],['D9CCF5','3B1D8F'],['D6F0E0','14532D'],['E8E4F0','5B5275']];
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="'+XL_NS+'">'+
    '<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00;[Red](#,##0.00);0.00"/><numFmt numFmtId="165" formatCode="#,##0.00;[Red](#,##0.00);0.00"/><numFmt numFmtId="166" formatCode="0.00%;[Red](0.00%);0.00%"/><numFmt numFmtId="167" formatCode="dd/mm/yyyy"/></numFmts>'+
    '<fonts count="'+fonts.length+'">'+fonts.map(function(f){return '<font><sz val="'+f[0]+'"/><color rgb="FF'+f[1]+'"/><name val="Tahoma"/>'+(f[2]?'<b/>':'')+'</font>';}).join('')+'</fonts>'+
    '<fills count="'+fills.length+'">'+fills.map(function(f,i){return i<2?'<fill><patternFill patternType="'+f+'"/></fill>':'<fill><patternFill patternType="solid"><fgColor rgb="FF'+f+'"/><bgColor indexed="64"/></patternFill></fill>';}).join('')+'</fills>'+
    '<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="hair"><color rgb="FFE9E3F0"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF665D77"/></bottom><diagonal/></border></borders>'+
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="'+xfs.length+'">'+xfs.join('')+'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'+
    '<dxfs count="5">'+colors.map(function(c){return '<dxf><font><b/><color rgb="FF'+c[1]+'"/></font><fill><patternFill patternType="solid"><fgColor rgb="FF'+c[0]+'"/><bgColor rgb="FF'+c[0]+'"/></patternFill></fill></dxf>';}).join('')+'</dxfs></styleSheet>';
}
var MARKET_STYLES_XML=xlMarketStyles(), XL_MEASURE=null;
function xlLineCount(value,width) {
  var lines=String(value==null?'':value).split(/\r?\n/),pixels=Math.max(12,width*7-12);
  if(!XL_MEASURE && typeof document!=='undefined') { try{XL_MEASURE=document.createElement('canvas').getContext('2d');}catch(_){} }
  if(XL_MEASURE) XL_MEASURE.font='10pt Tahoma';
  return lines.reduce(function(total,line){
    var size=XL_MEASURE?XL_MEASURE.measureText(line).width:Array.from(line).reduce(function(n,ch){return n+(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(ch)?0:/[\u0E00-\u0E7F]/.test(ch)?7.5:7);},0);
    return total+Math.max(1,Math.ceil(size/pixels));
  },0);
}
function projectionSummaryFormula(last,vat) {
  var col=vat?'V':'U';
  return 'IFERROR(AVERAGEIFS('+col+'7:'+col+last+',D7:D'+last+',">0",G7:G'+last+',">0",K7:K'+last+',">0"),"")';
}
function xlMarketEnd(sh) {return 6+Math.max(sh.items.length,1)+12;}
function xlMarketSheet(sh,ctx,idx) {
  var items=sh.items,last=6+Math.max(items.length,1),rows=[],merges=[],S=XL_STYLE;
  if(xlMarketEnd(sh)>1048576) throw new Error('รายการเกินจำนวนแถวที่ Excel รองรับ กรุณาแยกหมวดเป็นหลายชีต');
  function string(ref,style,value) {
    var text=String(value==null?'':value),key=ctx.sst[text];
    if (!text) return '<c r="'+ref+'" s="'+style+'"/>';
    if(key===undefined){key=ctx.sstList.length;ctx.sst[text]=key;ctx.sstList.push(text);}
    ctx.stringCount++;
    return '<c r="'+ref+'" s="'+style+'" t="s"><v>'+key+'</v></c>';
  }
  function number(ref,style,value) {
    return '<c r="'+ref+'" s="'+style+'">'+(value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?'<v>'+Number(value)+'</v>':'')+'</c>';
  }
  function formula(ref,style,expression,value) {
    var valid=value!==null&&value!==undefined&&Number.isFinite(value);
    return '<c r="'+ref+'" s="'+style+'"'+(valid?'':' t="str"')+'><f>'+xlEsc(expression)+'</f><v>'+(valid?value:'')+'</v></c>';
  }
  function row(r,cells,height){rows.push('<row r="'+r+'" ht="'+height+'" customHeight="1">'+cells.join('')+'</row>');}
  function merged(ref,style,value){merges.push(ref);return string(ref.split(':')[0],style,value);}
  row(1,[merged('A1:V1',S.title,sh.title)],Math.max(30,xlLineCount(sh.title,200)*20+8));
  row(2,[merged('A2:F2',S.meta,sh.leftHead),merged('G2:N2',S.meta,sh.rightHead),merged('O2:V2',S.meta,sh.versionLabel||'ข้อมูลปัจจุบัน')],24);
  row(3,[merged('A3:V3',S.meta,'หน่วยราคา: บาท   VAT 7%   กำไร% คิดเทียบต้นทุน   ใช้คอลัมน์ผลสำรวจและข้อเสนอแนะสำหรับกรอกข้อมูล')],20);
  row(4,[],8);
  row(5,[merged('A5:C5',S.band,'ข้อมูลสินค้า'),merged('D5:J5',S.band,'ข้อมูลในระบบ (ไม่รวม VAT)'),merged('K5:N5',S.band,'คำนวณต้นทุนรวม VAT'),merged('O5:S5',S.band,'ผลสำรวจและข้อเสนอแนะ'),merged('T5:V5',S.band,'ผลหลังใช้ราคาแนะนำ')],24);
  var headings=[sh.multiGroup?'ลำดับ /\nหมวด':'ลำดับ','รหัสสินค้า','ชื่อสินค้า','จำนวน\nคงเหลือ','ปรับครั้งล่าสุด','วันที่ปรับ','ต้นทุน','ราคาขาย','กำไร\n(บาท)','กำไร\n(%)','ต้นทุน+VAT','กำไร\n(บาท)','กำไร\n(%)','ราคาเมื่อกำไร\n30%','ราคาท้องตลาด\nต่ำสุด','ราคาท้องตลาด\nสูงสุด','รายการแนะนำ','ราคาแนะนำ','หมายเหตุ\nการแก้ไข','ราคาหลังปรับ','กำไร%\nไม่รวม VAT','กำไร%\nรวม VAT','หมวดสินค้า','วันที่ข้อมูล','ชื่อหมวด'];
  row(6,headings.map(function(h,c){return string(xlCol(c)+'6',S.header,h);}),48);
  items.forEach(function(x,i){
    var r=i+7,stripe=i%2?'odd':'even';
    function st(name){return S[name+'_'+stripe] === undefined ? S[name] : S[name+'_'+stripe];}
    function num(c,name,v){return number(c+r,st(name),v);}
    function txt(c,name,v){return string(c+r,st(name),v);}
    function f(c,name,expression,v){return formula(c+r,st(name),expression.replace(/\$/g,r),v);}
    function input(c,v){var n=marketNumber(v),market=c==='O'||c==='P';return n===null?txt(c,market?'marketText':'input',v):num(c,market?'marketMoney':'inputMoney',n);}
    var update=latestUpdate(x),projected=priceProjection(x),date=xlSerial(parseDateCell(update.date));
    var cells=[sh.multiGroup?txt('A','center',(i+1)+'\n'+x.g):num('A','qty',i+1),txt('B','text',x.code),txt('C','text',x.name),num('D','qty',x.qty),txt('E','text',update.text),date===null?txt('F','center',update.date):num('F','date',date),num('G','cost',x.cost),num('H','sale',x.price),
      f('I','money','ROUND(H$-G$,2)',x.profitEx),f('J','pct','IFERROR(ROUND((H$-G$)/G$,4),0)',x.marginEx),f('K','vat','ROUND(G$*1.07,2)',x.costVat),f('L','money','ROUND(H$-K$,2)',x.profitInc),f('M','pct','IFERROR(ROUND((H$-K$)/K$,4),0)',x.marginInc),f('N','price30','ROUND(G$*1.07*1.3,2)',x.price30),
      input('O',x.mktMin),input('P',x.mktMax),txt('Q','input',x.recAct),input('R',x.recPrice),txt('S','input',x.editNote),
      f('T','sale','IF(AND(OR(Q$="ปรับขึ้น",Q$="ปรับลง",Q$="ฝากพิจารณา"),ISNUMBER(R$),R$>0,IFERROR(ABS(R$-H$),0)>=0.005),R$,H$)',projected.price),
      f('U','pct','IF(AND(G$>0,K$>0),ROUND((T$-G$)/G$,4),"")',x.cost>0&&x.costVat>0?projected.marginEx:null),
      f('V','pct','IF(AND(G$>0,K$>0),ROUND((T$-K$)/K$,4),"")',x.cost>0&&x.costVat>0?projected.marginInc:null),
      txt('W','text',x.g),num('X','date',xlSerial(x.rep||(sh.groupDates&&sh.groupDates[x.g])||sh.rep)),txt('Y','text',sh.groupNames&&sh.groupNames[x.g]||'')];
    var lines=Math.max(xlLineCount(x.name,XL_WIDTHS[2]),xlLineCount(update.text,XL_WIDTHS[4]),xlLineCount(x.recAct,XL_WIDTHS[16]),xlLineCount(x.editNote,XL_WIDTHS[18]),sh.multiGroup?2:1);
    row(r,cells,Math.min(409,Math.max(30,lines*15+10)));
  });
  if(!items.length)row(7,[merged('A7:V7',S.meta,'ไม่มีรายการ')],30);
  var p=summarizePriceProjection(items),actions=['ปรับขึ้น','ปรับลง','ฝากพิจารณา'];
  function count(act){return 'COUNTIF(Q7:Q'+last+',"'+act+'")';}
  var countActions=actions.map(count).join('+'),missing=actions.map(function(a){return count(a)+'-COUNTIFS(Q7:Q'+last+',"'+a+'",R7:R'+last+',">0")';}).join('+');
  row(last+2,[merged('A'+(last+2)+':V'+(last+2),S.band,sh.sumTitle||'สรุปผลการสำรวจ')],26);
  function metric(r,labels,expressions,values){
    var ranges=[['A','E','F'],['G','K','L'],['M','Q','R'],['S','U','V']],cells=[];
    ranges.forEach(function(c,i){cells.push(merged(c[0]+r+':'+c[1]+r,S.summary,labels[i]),formula(c[2]+r,S.summaryValue,expressions[i],values[i]));});row(r,cells,28);
  }
  metric(last+3,['รายการทั้งหมด','มีสินค้าคงเหลือ','ไม่มีสินค้าคงเหลือ','เสนอปรับ/พิจารณา'],['COUNTA(B7:B'+last+')','COUNTIF(D7:D'+last+',">0")','COUNTA(B7:B'+last+')-COUNTIF(D7:D'+last+',">0")',countActions],[items.length,p.activeCount,items.length-p.activeCount,items.filter(function(x){return actions.indexOf(x.recAct)>=0;}).length]);
  metric(last+4,['ปรับขึ้น','ปรับลง','ฝากพิจารณา','ยังไม่มีราคาแนะนำ'],[count('ปรับขึ้น'),count('ปรับลง'),count('ฝากพิจารณา'),missing],[items.filter(function(x){return x.recAct===actions[0];}).length,items.filter(function(x){return x.recAct===actions[1];}).length,items.filter(function(x){return x.recAct===actions[2];}).length,p.missingPriceCount]);
  var blocks=[['A','F','กำไรเทียบต้นทุนเฉลี่ย'],['G','J','เดิม ไม่รวม VAT'],['K','N','เดิม รวม VAT'],['O','R','หลังปรับ ไม่รวม VAT'],['S','V','หลังปรับ รวม VAT']];
  row(last+5,blocks.map(function(b){return merged(b[0]+(last+5)+':'+b[1]+(last+5),S.header,b[2]);}),26);
  var avg=[p.avgBeforeEx,p.avgBeforeInc,p.avgAfterEx,p.avgAfterInc];
  var expressions=['IFERROR(AVERAGEIFS(J7:J'+last+',D7:D'+last+',">0",G7:G'+last+',">0",K7:K'+last+',">0"),"")','IFERROR(AVERAGEIFS(M7:M'+last+',D7:D'+last+',">0",G7:G'+last+',">0",K7:K'+last+',">0"),"")',projectionSummaryFormula(last,false),projectionSummaryFormula(last,true)];
  var avgCells=[merged('A'+(last+6)+':F'+(last+6),S.meta,'เฉพาะสินค้าคงเหลือและต้นทุนมากกว่า 0')];
  blocks.slice(1).forEach(function(b,i){var range=b[0]+(last+6)+':'+b[1]+(last+6);merges.push(range);avgCells.push(formula(range.split(':')[0],S.summaryPct,expressions[i],avg[i]));});
  row(last+6,avgCells,28);
  row(last+7,[merged('A'+(last+7)+':V'+(last+7),S.meta,'กำไร% = (ราคาขาย − ต้นทุน) ÷ ต้นทุน เฉลี่ยรายสินค้า ไม่ถ่วงน้ำหนักด้วยจำนวนคงเหลือ ใช้ราคาแนะนำเฉพาะรายการปรับ/พิจารณาที่มีราคามากกว่า 0')],24);
  row(last+8,[merged('A'+(last+8)+':V'+(last+8),S.meta,'คงที่: เหลือง   ปรับขึ้น: แดงอ่อน   ปรับลง: ม่วงอ่อน   ฝากพิจารณา: เขียวอ่อน   สินค้าไม่เคลื่อนไหว: ม่วงเทา')],20);
  row(last+9,[],18);
  var sigs=[['A','G',sh.surveyor,'ผู้สำรวจราคาตลาด'],['H','O',sh.checker,'ผู้ตรวจสอบความถูกต้อง'],['P','V',sh.approver,'ผู้ปรับแก้ไขราคาสินค้า']];
  row(last+10,sigs.map(function(b){return merged(b[0]+(last+10)+':'+b[1]+(last+10),S.signature,b[2]||'ลงชื่อ ................................................');}),30);
  row(last+11,sigs.map(function(b){return merged(b[0]+(last+11)+':'+b[1]+(last+11),S.role,b[3]);}),22);
  row(last+12,sigs.map(function(b){return merged(b[0]+(last+12)+':'+b[1]+(last+12),S.role,'วันที่ ........ / ........ / ........');}),22);
  var cf=['คงที่','ปรับขึ้น','ปรับลง','ฝากพิจารณา','สินค้าไม่เคลื่อนไหว'].map(function(a,i){return '<cfRule type="expression" dxfId="'+i+'" priority="'+(i+1)+'"><formula>$Q7="'+a+'"</formula></cfRule>';}).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="'+XL_NS+'" xmlns:r="'+XL_RNS+'">'+
    '<sheetPr><tabColor rgb="FF7045C6"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:Y'+(last+12)+'"/>'+
    '<sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="85"'+(idx===0?' tabSelected="1"':'')+'><pane xSplit="3" ySplit="6" topLeftCell="D7" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="D7" sqref="D7"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/>'+
    '<cols>'+XL_WIDTHS.map(function(w,i){return '<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>';}).join('')+'<col min="23" max="25" width="14" hidden="1" customWidth="1"/></cols>'+
    '<sheetData>'+rows.join('')+'</sheetData><autoFilter ref="A6:V'+last+'"/><mergeCells count="'+merges.length+'">'+merges.map(function(m){return '<mergeCell ref="'+m+'"/>';}).join('')+'</mergeCells>'+
    '<conditionalFormatting sqref="Q7:R'+last+'">'+cf+'</conditionalFormatting><dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="stop" errorTitle="รายการแนะนำไม่ถูกต้อง" error="กรุณาเลือกจากรายการ" sqref="Q7:Q'+last+'"><formula1>"คงที่,ปรับขึ้น,ปรับลง,ฝากพิจารณา,สินค้าไม่เคลื่อนไหว"</formula1></dataValidation></dataValidations>'+
    '<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'+
    '<headerFooter><oddFooter>'+xlEsc('&Lสำรวจราคาตลาด&C&A&Rหน้า &P / &N')+'</oddFooter></headerFooter>'+
    (items.length>14?'<rowBreaks count="1" manualBreakCount="1"><brk id="'+(last+1)+'" max="16383" man="1"/></rowBreaks>':'')+'</worksheet>';
}


var XL_CRCT = null;
function xlCrc(u8) {
  if (!XL_CRCT) {
    XL_CRCT = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      XL_CRCT[n] = c >>> 0;
    }
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < u8.length; i++) crc = XL_CRCT[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
async function xlDeflate(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    var cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter();
    var result = new Response(cs.readable).arrayBuffer();
    await w.write(u8); await w.close();
    return new Uint8Array(await result);
  } catch (e) { return null; }
}
async function xlZip(files) {
  var enc = new TextEncoder(), now = new Date();
  var dtime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  var ddate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  var out = [], cen = [], off = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i], raw = enc.encode(f.data), name = enc.encode(f.name), crc = xlCrc(raw);
    var comp = await xlDeflate(raw), body = comp || raw, method = comp ? 8 : 0;
    var lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, dtime, true); lh.setUint16(12, ddate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    var ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true); ch.setUint16(12, dtime, true); ch.setUint16(14, ddate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    out.push(new Uint8Array(lh.buffer), name, body);
    cen.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + body.length;
  }
  var csize = cen.reduce(function (s, p) { return s + p.length; }, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, off, true);
  var all = out.concat(cen, [new Uint8Array(end.buffer)]), total = all.reduce(function (s, p) { return s + p.length; }, 0);
  var buf = new Uint8Array(total), pos = 0;
  all.forEach(function (p) { buf.set(p, pos); pos += p.length; });
  return buf;
}



async function xlsxBuildMarket(sheets) {
  if(!sheets||!sheets.length)throw new Error('ไม่มีชีตให้ส่งออก');
  sheets=xlSheetNames(sheets);
  var ctx={sst:Object.create(null),sstList:[],stringCount:0},files=[],types='',tabs='',relations='',names='';
  sheets.forEach(function(sh,i){
    files.push({name:'xl/worksheets/sheet'+(i+1)+'.xml',data:xlMarketSheet(sh,ctx,i)});
    types+='<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    tabs+='<sheet name="'+xlEsc(sh.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>';
    relations+='<Relationship Id="rId'+(i+1)+'" Type="'+XL_RNS+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>';
    var quoted="'"+sh.name.replace(/'/g,"''")+"'!";
    names+='<definedName name="_xlnm.Print_Area" localSheetId="'+i+'">'+xlEsc(quoted+'$A$1:$V$'+xlMarketEnd(sh))+'</definedName><definedName name="_xlnm.Print_Titles" localSheetId="'+i+'">'+xlEsc(quoted+'$1:$6')+'</definedName>';
  });
  relations+='<Relationship Id="rId'+(sheets.length+1)+'" Type="'+XL_RNS+'/styles" Target="styles.xml"/><Relationship Id="rId'+(sheets.length+2)+'" Type="'+XL_RNS+'/sharedStrings" Target="sharedStrings.xml"/>';
  var xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  files.push(
    {name:'[Content_Types].xml',data:xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+types+'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'},
    {name:'_rels/.rels',data:xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+XL_RNS+'/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name:'xl/workbook.xml',data:xml+'<workbook xmlns="'+XL_NS+'" xmlns:r="'+XL_RNS+'"><bookViews><workbookView/></bookViews><sheets>'+tabs+'</sheets><definedNames>'+names+'</definedNames><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>'},
    {name:'xl/_rels/workbook.xml.rels',data:xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+relations+'</Relationships>'},
    {name:'xl/styles.xml',data:MARKET_STYLES_XML},
    {name:'xl/sharedStrings.xml',data:xml+'<sst xmlns="'+XL_NS+'" count="'+ctx.stringCount+'" uniqueCount="'+ctx.sstList.length+'">'+ctx.sstList.map(function(t){return '<si><t xml:space="preserve">'+xlEsc(t)+'</t></si>';}).join('')+'</sst>'}
  );
  return xlZip(files);
}

