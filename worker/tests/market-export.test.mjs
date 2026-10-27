import {test} from 'node:test';
import assert from 'node:assert/strict';
import XLSX from '../../assets/vendor/xlsx.full.min.js';
import {marketClient,unzip,fixture,report} from './market-fixtures.mjs';

test('market export preserves identifiers, adjustment dates, remarks, categories and report dates on round trip',async()=>{
  const c=await marketClient();
  const first=fixture(c), second=fixture(c,{g:'35',code:'12345678901234567890',name:'น้ำดื่ม',rep:'2026-10-19',editNote:'0007'});
  const sh=report(c,[first,second],{name:'รวมทุกหมวด',title:'สำรวจราคาท้องตลาด รวมหมวดสินค้า (34, 35)',multiGroup:true});
  const bytes=await c.xlsxBuildMarket([sh]),wb=XLSX.read(bytes,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]];
  assert.equal(ws.B7.t,'s');assert.equal(ws.B7.v,first.code);assert.equal(ws.B8.v,second.code);
  assert.equal(ws.F7.t,'n');assert.equal(c.parseDateCell(ws.F7.v),'2026-10-20');assert.equal(ws.S8.v,'0007');
  const parsed=c.parseMarketWorkbook([{name:sh.name,grid:XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''})}],'99','', '2026-10-26');
  assert.equal(parsed.totalRead,2);
  assert.deepEqual(Object.keys(parsed.groups),['34','35']);
  assert.equal(parsed.groups['34'].items[0].chgDate,'2026-10-20');
  assert.equal(parsed.groups['34'].rep,'2026-10-18');assert.equal(parsed.groups['35'].rep,'2026-10-19');
  assert.equal(parsed.names['34'],'ผลิตภัณฑ์ดูแลผ้า');assert.equal(parsed.names['35'],'เครื่องดื่ม');
  assert.equal(parsed.groups['35'].items[0].editNote,'0007');
});

test('market export contains printable projection columns, repeating headings, filters, frozen names and valid styles',async()=>{
  const c=await marketClient(),sh=report(c,[fixture(c)]),files=unzip(await c.xlsxBuildMarket([sh]));
  const xml=files['xl/worksheets/sheet1.xml'],workbook=files['xl/workbook.xml'];
  assert.match(xml,/<autoFilter ref="A6:V7"/);assert.match(xml,/xSplit="3" ySplit="6"/);
  assert.match(xml,/paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/);
  assert.match(workbook,/_xlnm.Print_Titles[^>]*>'34'!\$1:\$6/);
  assert.match(workbook,/_xlnm.Print_Area[^>]*>'34'!\$A\$1:\$V\$19/);
  assert.match(workbook,/fullCalcOnLoad="1"/);assert.match(xml,/min="23" max="25"[^>]*hidden="1"/);
  assert.doesNotMatch(xml,/<mergeCell ref="E7:F7"/);
  assert.match(files['xl/styles.xml'],/name val="Tahoma"/);
  const styles=Number(/<cellXfs count="(\d+)"/.exec(files['xl/styles.xml'])[1]);
  for(const m of xml.matchAll(/<c [^>]*s="(\d+)"/g)) assert.ok(Number(m[1])<styles);
});

test('market projection uses valid recommendations and blanks unavailable costs; summaries reconcile to the same items',async()=>{
  const c=await marketClient(),items=[
    fixture(c),fixture(c,{code:'DOWN',recAct:'ปรับลง',recPrice:120}),
    fixture(c,{code:'CONSIDER',recAct:'ฝากพิจารณา',recPrice:'-'}),
    fixture(c,{code:'NOCHANGE',recAct:'คงที่',recPrice:999}),
    fixture(c,{code:'ZERO',qty:0,recAct:'สินค้าไม่เคลื่อนไหว'}),
    fixture(c,{code:'NOCOST',cost:0,costVat:0,marginEx:0,marginInc:0})
  ];
  const bytes=await c.xlsxBuildMarket([report(c,items)]),wb=XLSX.read(bytes,{type:'array'}),ws=wb.Sheets['34'];
  assert.equal(ws.T7.v,140);assert.equal(ws.T8.v,120);assert.equal(ws.T9.v,130);assert.equal(ws.T10.v,130);
  assert.equal(ws.U12.v,'');assert.equal(ws.V12.v,'');
  const summary=c.summarizePriceProjection(items);
  assert.equal(ws.G18.v,summary.avgBeforeEx);assert.equal(ws.S18.v,summary.avgAfterInc);
  assert.equal(ws.F15.v,6);assert.equal(ws.L15.v,5);assert.equal(ws.R15.v,1);assert.equal(ws.V16.v,1);
  assert.match(ws.T7.f,/ISNUMBER\(R7\)/);assert.match(ws.U12.f,/G12>0/);
});

test('market exports safe unique sheet names, literal formula-like text, XML characters, blank sheets and large files',async()=>{
  const c=await marketClient(),x=fixture(c,{name:'=HYPERLINK("bad") & <สินค้า>',editNote:'=1+1\u0001'});
  const sheets=['Bad:/Name','bad__name',"a".repeat(40),"a".repeat(40),"History","'quoted'"].map(name=>report(c,[x],{name}));
  const bytes=await c.xlsxBuildMarket(sheets),wb=XLSX.read(bytes,{type:'array'}),files=unzip(bytes);
  assert.equal(new Set(wb.SheetNames.map(n=>n.toLowerCase())).size,6);
  for(const name of wb.SheetNames){assert.ok(name.length<=31);assert.doesNotMatch(name,/[\[\]:*?\/\\]/);}
  const ws=wb.Sheets[wb.SheetNames[0]];assert.equal(ws.C7.v,x.name);assert.equal(ws.C7.f,undefined);assert.equal(ws.S7.v,'=1+1');
  assert.doesNotMatch(files['xl/sharedStrings.xml'],/\u0001/);
  const blank=XLSX.read(await c.xlsxBuildMarket([report(c,[])]),{type:'array'});assert.ok(blank.Sheets['34']);
  const many=Array.from({length:2000},(_,i)=>fixture(c,{code:String(i).padStart(13,'0')}));
  const large=XLSX.read(await c.xlsxBuildMarket([report(c,many)]),{type:'array'});
  assert.equal(large.Sheets['34'].B2006.v,'0000000001999');
});

test('legacy four-row market template remains importable',async()=>{
  const c=await marketClient(),grid=[
    ['อัปข้อมูลเข้า วันที่ 18/10/2026',,,,,,'ส่งออกข้อมูล วันที่ 26/10/2026'],
    ['สำรวจราคาท้องตลาดหมวดสินค้า 34 ผลิตภัณฑ์ดูแลผ้า · สาขา หลัก'],
    ['ลำดับ','รหัส','ชื่อสินค้า'],
    [,,,,,,,,,,'ต้นทุน+Vat',,,,'ราคาท้องตลาด',,'รายการแนะนำ'],
    [],[,,,,,,,,,,,,,,'ต่ำสุด','สูงสุด','ปรับ','ราคา'],
    [1,'00123','สินค้า',1,'> ปรับขึ้น เดิม 100 ขึ้น 130','2026-10-20',100,130,,,,,,,129,140,'ปรับขึ้น',140,'หมายเหตุ']
  ];
  const p=c.parseMarketWorkbook([{name:'34',grid}],'','','');
  assert.equal(p.totalRead,1);assert.equal(p.groups['34'].items[0].code,'00123');
  assert.equal(p.names['34'],'ผลิตภัณฑ์ดูแลผ้า');
});

