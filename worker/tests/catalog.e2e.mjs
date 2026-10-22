import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { D1 } from './d1.mjs';
import * as mod from '../index.js';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH || 'playwright');
const root = resolve(fileURLToPath(new URL('../../',import.meta.url)));
const previews = resolve(root,'previews');
const DB = new D1(); await DB.install(mod.SCHEMA);
DB.db.prepare('INSERT INTO kv(k,v) VALUES(?,?)').run('SCHEMA_VERSION',mod.SCHEMA_VERSION);
DB.db.prepare('INSERT INTO users(username,salt,hash,role,name,perms) VALUES(?,?,?,?,?,?)').run('demo','salt',await mod.sha256hex('salt|demo1234'),'admin','ผู้ทดสอบทะเบียนสินค้า','{}');
for (const [username,perms] of [['catalog-viewer',{product_catalog:true}],['restricted',{}]]) {
  DB.db.prepare('INSERT INTO users(username,role,name,perms) VALUES(?,?,?,?)').run(username,'viewer',username,JSON.stringify(perms));
  DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run(username,username,Date.now()+86400000);
}
const base='https://cmucoop-catalog.test', errors=[];
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf'};
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROME_PATH?{executablePath:process.env.PLAYWRIGHT_CHROME_PATH}:{})});
async function contextFor(token='') {
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'th-TH',timezoneId:'Asia/Bangkok'});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  if(token) await context.addInitScript(value=>{try{sessionStorage.setItem('pm_tok',value);}catch{}},token);
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/api') {
      const response=await mod.default.fetch(new Request(req.url(),{method:req.method(),headers:req.headers(),body:req.method()==='POST'?req.postDataBuffer():undefined}),{DB},{});
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});return;
    }
    const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/catalog.html':url.pathname));
    if(!file.startsWith(root+sep)){await route.fulfill({status:403,body:'Forbidden'});return;}
    try {
      let bytes=await readFile(file);
      if(extname(file)==='.html') bytes=Buffer.from(bytes.toString().replace('<head>','<head><script>window.API_URL=location.origin+"/api";</script>'));
      await route.fulfill({status:200,contentType:mime[extname(file)]||'application/octet-stream',body:bytes});
    } catch { await route.fulfill({status:404,body:'Not found'}); }
  });
  return context;
}
async function rpc(page,fn,args=[],token) {
  return page.evaluate(({fn,args,token})=>new Promise((resolve,reject)=>{
    const authToken=token===undefined?sessionStorage.getItem('pm_tok'):token;
    window.google.script.run.withSuccessHandler(resolve).withFailureHandler(error=>reject(new Error(error.message)))[fn](authToken,...args);
  }),{fn,args,token});
}
function synced() {
  const state=DB.db.prepare('SELECT source_revision,synced_revision FROM product_catalog_state WHERE id=1').get();
  assert.equal(state.synced_revision,state.source_revision,'successful RPC saves synchronize the durable catalog before responding');
}
const row=(code,name,branch)=>['AA',code,name,branch,10,1,1,'','',20,'T2',999,1200,'','2026-10-18'];
const code='8850999000001',main='สาขาหลัก',north='สาขาเหนือ';
const context=await contextFor(),page=await context.newPage();page.setDefaultTimeout(15000);
try {
  await page.goto(base+'/catalog.html');
  await page.locator('#username').fill('demo');await page.locator('#password').fill('demo1234');await page.locator('#loginButton').click();
  await page.locator('#workspace').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  await page.goto(base+'/index.html');await page.locator('#mCatalog').waitFor({state:'visible'});await page.locator('#mCatalog').click();
  await page.waitForURL('**/catalog.html');await page.locator('#workspace').waitFor({state:'visible'});
  console.log('PASS catalog login, portal card and shared-session navigation');

  const adminToken=await page.evaluate(()=>sessionStorage.getItem('pm_tok'));
  const source=await context.newPage();await source.addInitScript(value=>{try{sessionStorage.setItem('pm_tok',value);}catch{}},adminToken);
  await source.goto(base+'/index.html');await source.locator('#mCatalog').waitFor({state:'visible'});await page.bringToFront();
  await rpc(source,'stockSave',[{branch:main,groups:[{g:'AA',rows:[row(code,'นมสต็อกทดสอบ',main)]}]}]);synced();
  await page.waitForFunction(()=>document.querySelector('#rows').textContent.includes('นมสต็อกทดสอบ')&&!document.querySelector('#refresh').disabled);
  await rpc(source,'stockSave',[{branch:north,groups:[{g:'AA',rows:[row(code,'นมสต็อกสาขาเหนือ',north)]}]}]);synced();
  await page.waitForFunction(()=>document.querySelector('#rows').textContent.includes('สาขาเหนือ')&&!document.querySelector('#refresh').disabled);
  await rpc(source,'addItem',['','AA',{cat:'AA',name:'<img src=x onerror="window.__catalogXss=1"> นมข้อมูลกลาง',unitBar:code,packBar:'18850999000018',perPack:'12'}]);synced();
  await page.waitForFunction(()=>document.querySelector('#rows').textContent.includes('ข้อมูลกลาง')&&!document.querySelector('#refresh').disabled);
  await rpc(source,'marketSaveState',[{branches:{[main]:{groups:{AA:{cur:{rows:[['AA',code,'นมชื่อตลาด',5]],rep:'2026-10-18'}}},names:{AA:'ผลิตภัณฑ์นม'}}},revision:''}]);synced();
  await rpc(source,'expiryCreate',[{requestId:crypto.randomUUID().replace(/-/g,''),barcode:code,name:'นมล็อตหมดอายุ',branch:main,expires:'2027-01-01',quantity:7,unit:'กล่อง',location:'ตู้แช่ 01',note:''}]);synced();
  await page.waitForFunction(()=>document.querySelector('#sourceFilter').textContent.includes('แจ้งเตือนสินค้าหมดอายุ')&&!document.querySelector('#refresh').disabled);
  console.log('PASS stock, barcode, market and expiry RPC saves update the catalog across tabs');

  await page.locator('#branchFilter').selectOption('b:'+main);await page.locator('#search').fill(code);await page.locator('#search').press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('#rows button[data-key]').length===1&&!document.querySelector('#refresh').disabled);
  await page.locator('#sourceFilter').selectOption('expiry');await page.locator('#conflictsOnly').check();
  await page.waitForFunction(()=>document.querySelectorAll('#rows button[data-key]').length===1&&!document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('#rows tr').count(),1);
  assert.match(await page.locator('#rows').textContent(),/ข้อมูลไม่ตรงกัน/);
  await page.locator('#rows button[data-key]').click();await page.locator('#sourceRecords article').nth(3).waitFor();
  assert.equal(await page.locator('#sourceRecords article').count(),4);
  const detail=await page.locator('#detailContent').textContent();
  for(const name of ['นมสต็อกทดสอบ','นมชื่อตลาด','นมล็อตหมดอายุ','นมข้อมูลกลาง'])assert.ok(detail.includes(name));
  assert.equal(await page.locator('#sourceRecords img').count(),0);assert.equal(await page.evaluate(()=>window.__catalogXss),undefined);
  const key=await page.locator('#rows button[data-key]').getAttribute('data-key');
  const record=await rpc(source,'productCatalogDetail',[{productKey:key}]);
  assert.deepEqual(record.sources.sort(),['barcode','expiry','market','stock']);
  assert.equal(record.records.some(row=>Object.keys(row).some(key=>/cost|price|profit|margin/i.test(key))),false,'catalog does not expose source costs');
  console.log('PASS branch/code/source/conflict filters and source-level detail safely show all four sources');

  await mkdir(previews,{recursive:true});await page.locator('#closeDetail').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve(previews,'catalog-desktop.png'),fullPage:false});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve(previews,'catalog-mobile.png'),fullPage:false});
  await page.locator('#rows button[data-key]').click();await page.locator('#sourceRecords article').nth(3).waitFor();
  assert.equal(await page.locator('#detailDialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.screenshot({path:resolve(previews,'catalog-detail-mobile.png'),fullPage:false});await page.locator('#closeDetail').click();
  console.log('PASS desktop/mobile catalog and detail fit without horizontal page overflow');

  const viewerContext=await contextFor('catalog-viewer'),viewer=await viewerContext.newPage();
  await viewer.goto(base+'/catalog.html');await viewer.locator('#workspace').waitFor({state:'visible'});await viewer.locator('#rows button[data-key]').first().waitFor();
  await assert.rejects(rpc(viewer,'stockGet'),/ไม่มีสิทธิ์/);
  assert.equal((await rpc(viewer,'productCatalogDetail',[{productKey:key}])).records.length,4);
  const restrictedContext=await contextFor('restricted'),restricted=await restrictedContext.newPage();
  await restricted.goto(base+'/catalog.html');await restricted.locator('#loginError').filter({hasText:'ไม่มีสิทธิ์'}).waitFor();
  assert.equal(await restricted.locator('#workspace').isHidden(),true);
  await assert.rejects(rpc(restricted,'productCatalogList',[{}],'restricted'),/ไม่มีสิทธิ์/);
  await restricted.goto(base+'/index.html');await restricted.locator('#mBarcode').waitFor({state:'visible'});
  assert.equal(await restricted.locator('#mCatalog').isHidden(),true);
  console.log('PASS catalog-only viewer access and unpermitted user restrictions');
  for (const name of ['barcode','stock','market','settings','music','sound','banner','tv','receiver']) {
    await source.goto(base+'/'+name+'.html');
    await source.waitForLoadState('load');
    await source.waitForTimeout(200);
  }
  console.log('PASS all existing application pages load after assets and modules were reorganized');
  assert.deepEqual(errors,[]);console.log('PASS no browser JavaScript errors');
  console.log('CATALOG E2E PASSED');
} catch(error) {
  console.error('Catalog browser diagnostic',await page.evaluate(()=>({url:location.href,login:document.querySelector('#loginError')?.textContent,error:document.querySelector('#loadError')?.textContent,rows:document.querySelector('#rows')?.textContent})).catch(()=>null));
  throw error;
} finally {await browser.close();}
