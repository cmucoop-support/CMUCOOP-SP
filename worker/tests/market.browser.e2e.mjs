import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {D1} from './d1.mjs';
import * as mod from '../index.js';
import XLSX from '../../assets/vendor/xlsx.full.min.js';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
const root=resolve(fileURLToPath(new URL('../../',import.meta.url))), DB=new D1();
await DB.install(mod.SCHEMA);
DB.db.prepare('INSERT INTO kv(k,v) VALUES(?,?)').run('SCHEMA_VERSION',mod.SCHEMA_VERSION);
DB.db.prepare('INSERT INTO users(username,salt,hash,role,name,perms) VALUES(?,?,?,?,?,?)').run('demo','salt',await mod.sha256hex('salt|demo1234'),'admin','ผู้ดูแลตัวอย่าง','{}');
DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run('seed','demo',Date.now()+86400000);
const C={env:{DB}};
await mod.API.marketSaveState(C,'seed',{branches:{'สาขาทดสอบ':{groups:{
 '34':{cur:{ts:Date.now(),rep:'2026-10-18',rows:[['34','0012345678901','ผลิตภัณฑ์ซักผ้าสูตรเข้มข้น 1,500 มล.',12,'> ปรับขึ้น\nเดิม 120 ขึ้น 130','2026-10-20',100,130,129,140,'ปรับขึ้น',140,'หมายเหตุ','2026-10-18'],['34','LONG0002','สินค้าที่ไม่มีต้นทุน',3,'-','-',0,20,'','','คงที่','','','2026-10-18']]}},
 '35':{cur:{ts:Date.now(),rep:'2026-10-19',rows:[['35','0000088500001','น้ำดื่ม',24,'-','-',45,60,55,59,'ปรับลง',59,'','2026-10-19']]}}
 },names:{34:'ผลิตภัณฑ์ดูแลผ้า',35:'เครื่องดื่ม'}}},revision:''});
await fs.mkdir(resolve(root, 'previews/downloads'),{recursive:true});
const browser=await chromium.launch({headless:true,downloadsPath:resolve(root, 'previews/downloads'),...(process.env.PLAYWRIGHT_CHROME_PATH?{executablePath:process.env.PLAYWRIGHT_CHROME_PATH}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'th-TH',timezoneId:'Asia/Bangkok',acceptDownloads:true});
await context.addInitScript(()=>{
 sessionStorage.setItem('pm_tok','seed');
 const original=URL.createObjectURL;URL.createObjectURL=function(blob){window.__exportBlob=blob;return original.call(this,blob);};
 const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){window.__exportName=this.download;return;}return click.call(this);};
});
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.pathname==='/api'){
  const r=await mod.default.fetch(new Request(req.url(),{method:req.method(),headers:req.headers(),body:req.method()==='POST'?req.postDataBuffer():undefined}),{DB},{});
  return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});
 }
 const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/market.html':url.pathname));
 if(url.hostname!=='cmucoop.test'||!file.startsWith(root+sep))return route.fulfill({status:404,body:''});
 try {
  let bytes=await fs.readFile(file);
  if(extname(file)==='.html')bytes=Buffer.from(bytes.toString().replace('<head>','<head><script>window.API_URL=location.origin+"/api";</script>'));
  return route.fulfill({status:200,contentType:({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.png':'image/png','.ttf':'font/ttf'})[extname(file)]||'application/octet-stream',body:bytes});
 }catch(e){return route.fulfill({status:404,body:e.message});}
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
page.setDefaultTimeout(15000);
async function download() {
 await page.evaluate(()=>{window.__exportBlob=null;window.__exportName=null;});
 await page.locator('#exGo').click();
 await page.waitForFunction(()=>!!window.__exportName);
 const file=await page.evaluate(async()=>({name:window.__exportName,bytes:Array.from(new Uint8Array(await window.__exportBlob.arrayBuffer()))}));
 return {name:file.name,wb:XLSX.read(new Uint8Array(file.bytes),{type:'array'})};
}
try{
 await page.goto('https://cmucoop.test/market.html');await page.waitForFunction(()=>D.items.length===3);
 await page.locator('#bXlsx').click();await page.locator('input[name=exMode][value=all]').check();
 const split=await download();assert.equal(split.wb.SheetNames.length,2);
 assert.equal(split.wb.Sheets['34'].B7.v,'0012345678901');assert.equal(split.wb.Sheets['35'].B7.v,'0000088500001');
 console.log('PASS browser prepares split workbook and download link with intact identifiers');
 await page.locator('#fGrp').selectOption('34');
 await page.locator('#bXlsx').click();await page.locator('input[name=exMode][value=all]').check();await page.locator('input[name=exSheetMode][value=single]').check();
 const merged=await download();assert.equal(merged.wb.SheetNames.length,1);
 const combined=merged.wb.Sheets[merged.wb.SheetNames[0]];
 assert.match(combined.A2.v,/19\/10\/2026/);assert.equal(combined.W9.v,'35');
 const result=await page.evaluate(grid=>parseMarketWorkbook([{name:'รวมทุกหมวด',grid}],'','',''),XLSX.utils.sheet_to_json(combined,{header:1,raw:true,defval:''}));
 assert.equal(result.totalRead,3);assert.equal(result.groups['35'].items.length,1);
 console.log('PASS all-groups export ignores current group filter, chooses correct date and round trips categories');
 await page.locator('#bXlsx').click();await page.locator('input[name=exMode][value=filter]').check();await page.locator('input[name=exSheetMode][value=split]').check();
 const filtered=await download();assert.deepEqual(filtered.wb.SheetNames,['34']);assert.equal(filtered.wb.Sheets['34'].B8.v,'LONG0002');
 console.log('PASS filtered export includes every filtered item');
 await page.locator('#fGrp').selectOption('');
 await page.locator('#bXlsx').click();await page.locator('input[name=exMode][value=all]').check();await page.locator('input[name=exSheetMode][value=custom]').check();
 await page.locator('[data-exgrp="34"]').selectOption('merge');await page.locator('[data-exgrp="35"]').selectOption('skip');
 const custom=await download();assert.equal(custom.wb.SheetNames.length,1);assert.equal(custom.wb.Sheets[custom.wb.SheetNames[0]].B8.v,'LONG0002');
 console.log('PASS custom split/merge/skip selection');
 assert.deepEqual(errors,[]);
 console.log('PASS no market JavaScript errors');
 for(const app of ['index','barcode','stock','expiry','music','sound','settings','banner','receiver','tv']) {
  await page.goto('https://cmucoop.test/'+app+'.html');await page.waitForTimeout(500);
 }
 assert.deepEqual(errors,[]);console.log('PASS portal and nine other application pages load without JavaScript errors');
}finally{await browser.close();}

