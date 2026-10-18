import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH || 'playwright');
import { D1 } from './d1.mjs';
const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const previewDir = resolve(root, 'previews');
const source = await readFile(resolve(root, 'worker/index.js'), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport {SCHEMA,SCHEMA_VERSION,API,sha256hex,expiryBounds};').toString('base64'));
const DB = new D1(); await DB.install(mod.SCHEMA);
DB.db.prepare('INSERT INTO kv(k,v) VALUES(?,?)').run('SCHEMA_VERSION', mod.SCHEMA_VERSION);
DB.db.prepare('INSERT INTO users(username,salt,hash,role,name,perms) VALUES(?,?,?,?,?,?)').run('demo', 'salt', await mod.sha256hex('salt|demo1234'), 'admin', 'ผู้ดูแลระบบ (ตัวอย่าง)', '{}');
DB.db.prepare('INSERT INTO sessions(token,username,exp) VALUES(?,?,?)').run('seed', 'demo', Date.now() + 86400000);
DB.db.prepare('INSERT INTO barcode_items(pos,cat,name,packBar,unitBar) VALUES(1,?,?,?,?)').run('ผลิตภัณฑ์นม', 'นมทดสอบใหม่', '', '8850999000001');
const C = { env: { DB } }, bounds = mod.expiryBounds();
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
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ttf':'font/ttf'};
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
  const add = async (quantity=null) => {
    await page.locator('#addLot').click();await page.locator('#barcode').fill('8850999000001');await page.locator('#barcode').press('Enter');
    await page.waitForFunction(()=>document.querySelector('#productName').value==='นมทดสอบใหม่');
    await page.locator('#branch').fill('สาขาทดสอบ');await page.locator('#expires').fill(bounds.month);
    if (quantity!==null){await page.locator('#quantity').fill(String(quantity));await page.locator('#unit').fill('กล่อง');}
    await page.locator('#save').click();await page.locator('#lotDialog').waitFor({state:'hidden'});await wait(()=>!document.querySelector('#refresh').disabled);
  };
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
  await page.locator('#addLot').click();await page.locator('#productName').fill('ทดสอบเน็ตหลุด');await page.locator('#branch').fill('สาขาทดสอบ');await page.locator('#expires').fill(bounds.week);await page.locator('#save').click();
  await page.locator('#pendingNotice').waitFor({state:'visible'});
  assert.equal(lotCount(),before+1);assert.equal(await page.locator('#lotFields').evaluate(el=>el.disabled),true);
  await page.reload(); await page.locator('#addLot').waitFor({state:'visible'}); await wait(()=>!document.querySelector('#refresh').disabled);
  await page.locator('#addLot').click();await page.locator('#pendingNotice').waitFor({state:'visible'});
  await page.locator('#save').click();await page.locator('#lotDialog').waitFor({state:'hidden'});assert.equal(lotCount(),before+1);
  await page.unroute('**/api');console.log('PASS uncertain response retry across reload creates exactly one lot');
  const beforeNext=lotCount();
  await page.locator('#addLot').click();await page.locator('#productName').fill('สินค้าบันทึกต่อเนื่อง');await page.locator('#branch').fill('สาขาทดสอบ');await page.locator('#expires').fill(bounds.m3);await page.locator('#saveNext').click();
  await page.waitForFunction(()=>document.querySelector('#lotDialog').open&&document.querySelector('#productName').value===''&&!document.querySelector('#lotFields').disabled);
  await page.locator('#productName').fill('สินค้าบันทึกต่อเนื่อง');await page.locator('#expires').fill(bounds.m3);await page.locator('#save').click();await page.locator('#lotDialog').waitFor({state:'hidden'});
  assert.equal(lotCount(),beforeNext+2);console.log('PASS save-and-next retains identical prior lots');
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
  await page.locator('#addLot').click();await page.locator('#productName').fill('ล็อตหลังอ่านค้าง');await page.locator('#branch').fill('สาขาทดสอบ');await page.locator('#expires').fill(bounds.today);await page.locator('#save').click();
  await page.waitForFunction(()=>document.querySelector('#rows').innerText.includes('ล็อตหลังอ่านค้าง'));
  releaseRead();await finished;await page.unroute('**/api');console.log('PASS pre-save delayed reads cannot replace post-save data');
  await page.locator('#search').fill('');await wait(()=>!document.querySelector('#refresh').disabled);
  await page.locator('#refresh').click();await wait(()=>!document.querySelector('#refresh').disabled);
  await mkdir(previewDir,{recursive:true});
  await page.evaluate(()=>document.querySelector('#toast').hidden=true);
  await page.screenshot({path:resolve(previewDir, 'expiry-desktop.png'),fullPage:false});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve(previewDir, 'expiry-mobile.png'),fullPage:false});
  await page.locator('#addLot').click();
  assert.equal(await page.evaluate(()=>document.querySelector('#lotDialog').scrollWidth<=document.querySelector('#lotDialog').clientWidth),true);
  assert.equal(await page.locator('#save').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true);
  await page.screenshot({path:resolve(previewDir, 'expiry-form-mobile.png'),fullPage:false});
  await page.locator('#cancelForm').click();
  console.log('PASS desktop/mobile layouts and dialog width');
  assert.equal(DB.db.prepare('SELECT COUNT(*) n FROM stock_grp').get().n,0);
  assert.deepEqual(errors,[]);console.log('PASS no browser JavaScript errors and no stock writes');
  console.log('E2E PASSED');
} finally {await browser.close();}
