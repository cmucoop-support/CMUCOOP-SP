import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH || 'playwright');
import { D1 } from './d1.mjs';
import { cameraChecks } from './camera.e2e.mjs';
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const previewDir = resolve(root, 'previews');
const mod = await import('../index.js');
const DB = new D1(); await DB.install(mod.SCHEMA);
DB.db.prepare('INSERT INTO kv(k,v) VALUES(?,?)').run('SCHEMA_VERSION', mod.SCHEMA_VERSION);
DB.db.prepare('INSERT INTO users(username,salt,hash,role,name,perms) VALUES(?,?,?,?,?,?)').run('demo', 'salt', await mod.sha256hex('salt|demo1234'), 'admin', 'ผู้ดูแลระบบ (ตัวอย่าง)', '{}');
DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run('seed', 'demo', Date.now() + 86400000);
DB.db.prepare('INSERT INTO barcode_items(pos,cat,name,packBar,unitBar) VALUES(1,?,?,?,?)').run('ผลิตภัณฑ์นม', 'นมทดสอบใหม่', '', '8850999000001');
const C = { env: { DB } }, bounds = mod.expiryBounds();
const stockRow=(code,name,branch='สาขาทดสอบ')=>['AA',code,name,branch,10,1,1,'','',20,'T2',99,120,'','2026-10-18'];
const testProducts=[['8850999000001','นมทดสอบใหม่'],['CONNECTION','ทดสอบเน็ตหลุด'],['NEXT','สินค้าบันทึกต่อเนื่อง'],['AFTER','ล็อตหลังอ่านค้าง'],['8850123456787','สินค้าจากกล้อง'],['WATER_A','น้ำดื่ม แบบ A'],['WATER_B','น้ำดื่ม แบบ B']];
await mod.API.stockSave(C,'seed',{branch:'สาขาทดสอบ',groups:[{g:'AA',rows:testProducts.map(p=>stockRow(...p))}]});
await mod.API.stockSave(C,'seed',{branch:'สาขาหลัก',groups:[{g:'AA',rows:[stockRow('MAIN','สินค้าในสาขาหลัก','สาขาหลัก')]}]});
const stockSnapshot=DB.db.prepare('SELECT * FROM stock_grp ORDER BY g,ver,n').all();

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0,10);
const seed = [
  ['นมสดพาสเจอร์ไรส์ รสจืด', addDays(bounds.today,-2), null, 'ตู้แช่ 01'],
  ['โยเกิร์ตรสธรรมชาติ', addDays(bounds.today,3), 12, 'ตู้แช่ 02'],
  ['ขนมปังโฮลวีต', bounds.week, null, 'ชั้น A1'],
  ['น้ำส้มแท้ 100%', bounds.month, 6, 'ชั้น B2'],
  ['นมถั่วเหลือง สูตรไม่เติมน้ำตาล', bounds.m3, null, 'ชั้น B1'],
  ['บิสกิตธัญพืช', bounds.m6, 20, 'ชั้น C2'],
  ['ข้าวหอมมะลิ 5 กก.', bounds.m12, null, 'ชั้น D1']
];
for (let i=0; i<seed.length; i++) await mod.API.expiryCreate(C,'seed',{requestId:crypto.randomUUID().replace(/-/g,''),barcode:'885000000000'+i,name:seed[i][0],expires:seed[i][1],quantity:seed[i][2],unit:'ชิ้น',branch:'สาขาหลัก',location:seed[i][3],note:i===0?'ตรวจสอบหน้าชั้นและดำเนินการตามขั้นตอน':''});
const mime = {'.svg':'image/svg+xml','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ttf':'font/ttf'};
const base='https://cmucoop.test';
async function dispatch(request) {
  return mod.default.fetch(new Request(request.url(),{method:request.method(),headers:request.headers(),body:request.method()==='POST'?request.postDataBuffer():undefined}),{DB},{});
}
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROME_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROME_PATH} : {})});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'th-TH',timezoneId:'Asia/Bangkok'});
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api') {
    const response=await dispatch(request);
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});return;
  }
  const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/expiry.html':url.pathname));
  if(!file.startsWith(root+sep)){await route.fulfill({status:403,body:'Forbidden'});return;}
  try {
    let bytes=await readFile(file);
    if(extname(file)==='.html') bytes=Buffer.from(bytes.toString().replace('<head>','<head><script>window.API_URL=location.origin+"/api";</script>'));
    await route.fulfill({status:200,contentType:mime[extname(file)]||'application/octet-stream',body:bytes});
  } catch(e){await route.fulfill({status:404,body:String(e.message)});}
});
const page=await context.newPage(), errors=[];
page.setDefaultTimeout(15000);
page.on('pageerror', e=>errors.push(e.message));
const wait=async condition=>{await page.waitForFunction(condition);};
const lotCount=()=>DB.db.prepare('SELECT COUNT(*) n FROM expiry_lots').get().n;
try {
  await page.goto(base+'/expiry.html');
  await page.locator('#username').fill('demo');await page.locator('#password').fill('demo1234');await page.locator('#loginButton').click();
  await page.locator('#workspace').waitFor({state:'visible'});await page.locator('#rows tr').first().waitFor();
  assert.equal(await page.locator('#stats button').count(),7);
  await page.goto(base+'/index.html');await page.locator('#mExpiry').waitFor({state:'visible'});
  await page.locator('#mExpiry').click();await page.waitForURL('**/expiry.html');await page.locator('#rows tr').first().waitFor();
  console.log('PASS separate URL, shared login and portal card');
  const selectProduct = async (query, name=query) => {
    await page.locator('#branch').selectOption('สาขาทดสอบ');
    await page.locator('#productSearch').fill(query);await page.locator('#productSearch').press('Enter');
    await page.waitForFunction(name=>document.querySelector('#productName').value===name,name);
  };
  const selectDate = async value => { const [y,m,d]=value.split('-'); await page.locator('#expiryDay').selectOption(d); await page.locator('#expiryMonth').selectOption(m); await page.locator('#expiryYear').selectOption(y); };
  const add = async (quantity=null) => {
    await page.locator('#addLot').click();await selectProduct('8850999000001','นมทดสอบใหม่');await selectDate(bounds.month);
    if (quantity!==null){await page.locator('#quantity').fill(String(quantity));await page.locator('#unit').fill('กล่อง');}
    await page.locator('#save').click();await page.locator('#lotDialog').waitFor({state:'hidden'});await wait(()=>!document.querySelector('#refresh').disabled);
  };
  await page.locator('#addLot').click();await page.locator('#branch').selectOption('สาขาทดสอบ');
  await page.locator('#productSearch').fill('น้ำดื่ม');await page.locator('#productSearch').press('Enter');await page.locator('#productResults button').nth(1).waitFor();
  await page.locator('#productResults button').filter({hasText:'น้ำดื่ม แบบ A'}).click();
  assert.equal(await page.locator('#barcode').inputValue(),'WATER_A');assert.equal(await page.locator('#productName').evaluate(el=>el.readOnly),true);
  await page.locator('#branch').selectOption('สาขาหลัก');assert.equal(await page.locator('#barcode').inputValue(),'');
  await page.locator('#productSearch').fill('สินค้าในสาขาหลัก');await page.locator('#productSearch').press('Enter');await page.waitForFunction(()=>document.querySelector('#barcode').value==='MAIN');
  await page.locator('#cancelForm').click();console.log('PASS multiple stock matches can be selected; branch changes clear the previous product');
  await add();await add(12);
  await page.locator('#search').fill('8850999000001');await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===2);
  assert.match(await page.locator('#rows').innerText(),/ไม่ระบุ/);assert.match(await page.locator('#rows').innerText(),/12 กล่อง/);
  console.log('PASS barcode lookup, optional quantities and duplicate lots');
  await page.locator('#rows button[data-action="acknowledged"]').first().click();
  await page.waitForFunction(()=>document.querySelector('#rows').innerText.includes('รับทราบแล้ว'));
  page.once('dialog',dialog=>dialog.accept());await page.locator('#rows button[data-action="closed"]').first().click();
  await page.waitForFunction(()=>document.querySelectorAll('#rows tr').length===1);
  await page.locator('#stateFilter').selectOption('closed');await page.waitForFunction(()=>document.querySelector('#rows').innerText.includes('ปิดแจ้งเตือนแล้ว'));
  await page.locator('#rows button[data-action="history"]').click();await page.waitForFunction(()=>document.querySelectorAll('.history-event').length===3);
  await page.locator('#closeHistory').click();
  console.log('PASS acknowledgement, close-one-lot and retained history');
  await page.locator('#stateFilter').selectOption('open');await page.waitForFunction(()=>document.querySelector('#rows').innerText.includes('12 กล่อง'));
  await page.locator('#rows button[data-action="edit"]').click();await page.locator('#quantity').fill('');await page.locator('#save').click();
  await page.locator('#lotDialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#rows').innerText.includes('ไม่ระบุ'));
  console.log('PASS editing optional quantity to blank');
  const before=lotCount();let aborted=false;
  await page.route('**/api',async route=>{
    const p=route.request().postDataJSON();
    if(p.fn==='expiryCreate'&&!aborted){aborted=true;await dispatch(route.request());await route.abort('failed');}else await route.fallback();
  });
  await page.locator('#addLot').click();await selectProduct('ทดสอบเน็ตหลุด');await selectDate(bounds.week);await page.locator('#save').click();
  await page.locator('#pendingNotice').waitFor({state:'visible'});
  assert.equal(lotCount(),before+1);assert.equal(await page.locator('#lotFields').evaluate(el=>el.disabled),true);
  await page.reload(); await page.locator('#addLot').waitFor({state:'visible'}); await wait(()=>!document.querySelector('#refresh').disabled);
  await page.locator('#addLot').click();await page.locator('#pendingNotice').waitFor({state:'visible'});
  await page.locator('#save').click();await page.locator('#lotDialog').waitFor({state:'hidden'});assert.equal(lotCount(),before+1);
  await page.unroute('**/api');console.log('PASS uncertain response retry across reload creates exactly one lot');
  const beforeNext=lotCount();
  await page.locator('#addLot').click();await selectProduct('สินค้าบันทึกต่อเนื่อง');await selectDate(bounds.m3);await page.locator('#saveNext').click();
  await page.waitForFunction(()=>document.querySelector('#lotDialog').open&&document.querySelector('#productName').value===''&&!document.querySelector('#lotFields').disabled);
  await selectProduct('สินค้าบันทึกต่อเนื่อง');await selectDate(bounds.m3);await page.locator('#save').click();await page.locator('#lotDialog').waitFor({state:'hidden'});
  assert.equal(lotCount(),beforeNext+2);
  const grouped=DB.db.prepare('SELECT * FROM expiry_records ORDER BY id DESC LIMIT 2').all();
  assert.equal(grouped[0].group_id,grouped[1].group_id); assert.deepEqual(grouped.map(r=>r.item_no),[2,1]);
  console.log('PASS save-and-next shares the lot and increments item numbers');
  await wait(()=>!document.querySelector('#refresh').disabled);
  let releaseRead, markReadStarted, markReadDone, delayed=false;
  const started=new Promise(r=>{markReadStarted=r;});
  const finished=new Promise(r=>{markReadDone=r;});
  await page.route('**/api',async route=>{
    const p=route.request().postDataJSON();
    if(p.fn==='expiryList'&&!delayed){
      delayed=true;const response=await dispatch(route.request());const body=Buffer.from(await response.arrayBuffer());
      markReadStarted();await new Promise(r=>{releaseRead=r;});await route.fulfill({status:200,contentType:'application/json',body});markReadDone();
    }else await route.fallback();
  });
  await page.locator('#refresh').click();await started;
  await page.locator('#addLot').click();await selectProduct('ล็อตหลังอ่านค้าง');await selectDate(bounds.today);await page.locator('#save').click();
  await page.waitForFunction(()=>document.querySelector('#rows').innerText.includes('ล็อตหลังอ่านค้าง'));
  releaseRead();await finished;await page.unroute('**/api');console.log('PASS pre-save delayed reads cannot replace post-save data');
  await page.locator('#search').fill('');await wait(()=>!document.querySelector('#refresh').disabled);
  await page.locator('#refresh').click();await wait(()=>!document.querySelector('#refresh').disabled);
  const beforeCamera=lotCount();await cameraChecks(page,base);assert.equal(lotCount(),beforeCamera);
  await (await import('./expiry-photo.e2e.mjs')).photoChecks(page,DB);
  await mkdir(previewDir,{recursive:true});
  await page.evaluate(()=>document.querySelector('#toast').hidden=true);
  await page.screenshot({path:resolve(previewDir, 'expiry-desktop.png'),fullPage:false});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth && document.querySelector('#v16Sidebar').getBoundingClientRect().right<=1 && parseFloat(getComputedStyle(document.body).paddingLeft)<1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve(previewDir, 'expiry-mobile.png'),fullPage:false});
  await page.locator('#addLot').click();await page.locator('#branch').selectOption('สาขาทดสอบ');
  await page.locator('#productSearch').fill('นม');await page.locator('#productSearch').press('Enter');await page.waitForFunction(()=>document.querySelector('#productName').value==='นมทดสอบใหม่');
  assert.equal(await page.evaluate(()=>document.querySelector('#lotDialog').scrollWidth<=document.querySelector('#lotDialog').clientWidth),true);
  assert.equal(await page.locator('#save').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true);
  assert.equal(await page.evaluate(()=>document.querySelector('#lotScroll').getBoundingClientRect().bottom<=document.querySelector('#lotForm .dialog-actions').getBoundingClientRect().top),true);
  await page.locator('#note').fill('เข้าถึงช่องท้ายฟอร์มได้โดยเลื่อนภายในฟอร์ม');
  assert.equal(await page.locator('#save').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true);
  await page.evaluate(()=>document.querySelector('#lotScroll').scrollTop=0);
  await page.screenshot({path:resolve(previewDir, 'expiry-form-mobile.png'),fullPage:false});
  await page.locator('#expiryDay').focus();
  await page.screenshot({path:resolve(previewDir, 'expiry-date-mobile.png'),fullPage:false});
  await page.locator('#openCamera').click();await page.waitForFunction(()=>document.querySelector('#cameraStatus').textContent.startsWith('เล็ง'));
  await page.screenshot({path:resolve(previewDir,'expiry-camera-mobile.png'),fullPage:false});await page.locator('#closeCamera').click();
  await page.locator('#cancelForm').click();
  console.log('PASS desktop/mobile layouts and dialog width');
  assert.deepEqual(DB.db.prepare('SELECT * FROM stock_grp ORDER BY g,ver,n').all(),stockSnapshot);
  assert.deepEqual(errors,[]);console.log('PASS no browser JavaScript errors and no stock writes');
  console.log('E2E PASSED');
} catch (error) {
  console.error('Date diagnostic',await page.evaluate(()=>({value:document.querySelector('#expires').value,status:document.querySelector('#datePhotoStatus').textContent,candidates:document.querySelector('#dateCandidates').textContent,photoOpen:document.querySelector('#datePhotoDialog').open})).catch(()=>null));
  console.error('Browser diagnostic',await page.evaluate(()=>({cameraStatus:document.querySelector('#cameraStatus')?.textContent,ready:document.querySelector('video')?.readyState,videoWidth:document.querySelector('video')?.videoWidth,decoder:!!window.ZXing,stream:window.__testStream?.getTracks().map(t=>t.readyState),product:document.querySelector('#productName')?.value})).catch(()=>null));
  throw error;
} finally {await browser.close();}
