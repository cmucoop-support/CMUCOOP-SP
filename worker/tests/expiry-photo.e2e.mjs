import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export async function photoChecks(page,DB) {
  await page.locator('#addLot').click();
  await page.locator('#branch').selectOption('สาขาทดสอบ');
  await page.locator('#productSearch').fill('สินค้าบันทึกต่อเนื่อง'); await page.locator('#productSearch').press('Enter');
  await page.waitForFunction(()=>document.querySelector('#productName').value==='สินค้าบันทึกต่อเนื่อง');
  const makePhoto = async text => Buffer.from(await page.evaluate(text=>{
    const c=document.createElement('canvas');c.width=1000;c.height=260;const x=c.getContext('2d');
    x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='bold 52px Arial';
    text.split('\n').forEach((s,i)=>x.fillText(s,35,90+i*85));return c.toDataURL('image/png').split(',')[1];
  },text),'base64');
  let ocrRequests=0;
  page.on('request',r=>{if(r.url().includes('/vendor/ocr/'))ocrRequests++;});
  await page.locator('#datePhotoInput').setInputFiles({name:'expiry.png',mimeType:'image/png',buffer:await makePhoto('EXP 31/12/2027')});
  await page.waitForFunction(()=>document.querySelector('#expires').value==='2027-12-31',null,{timeout:90000});
  assert.ok(ocrRequests>2); assert.equal(await page.locator('#datePhotoDialog').evaluate(e=>e.open),false);
  assert.match(await page.locator('#dateInfo').innerText(),/ตรวจและแก้/);
  await page.locator('#expiryDay').selectOption('30'); assert.equal(await page.locator('#expires').inputValue(),'2027-12-30');
  console.log('PASS real bundled OCR fills numeric date selectors and leaves the date editable');
  await page.locator('#datePhotoInput').setInputFiles({name:'two-dates.png',mimeType:'image/png',buffer:await makePhoto('01/01/2027\n31/12/2027')});
  await page.locator('#dateCandidates button').nth(1).waitFor({state:'visible',timeout:90000});
  assert.equal(await page.locator('#expires').inputValue(),'2027-12-30');
  await page.locator('#dateCandidates button').filter({hasText:'31/12/2027'}).click();
  assert.equal(await page.locator('#expires').inputValue(),'2027-12-31');
  console.log('PASS multiple dates require selection before changing the form');
  if(process.env.EXPIRY_REFERENCE_PHOTO) {
    await page.locator('#datePhotoInput').setInputFiles({name:'reference.jpg',mimeType:'image/jpeg',buffer:await readFile(process.env.EXPIRY_REFERENCE_PHOTO)});
    await page.waitForFunction(()=>!document.querySelector('#datePhotoDialog').open || document.querySelector('#readDateAgain').disabled===false && !document.querySelector('#datePhotoStatus').textContent.includes('กำลัง'),null,{timeout:90000});
    let value=await page.locator('#expires').inputValue();
    if(value!=='2027-06-27') {
      // Match a user's crop of the printed expiry label in the supplied photograph.
      const c=page.locator('#datePhotoCanvas'),box=await c.boundingBox();
      await page.mouse.move(box.x+box.width*.3334,box.y+box.height*.5125);await page.mouse.down();
      await page.mouse.move(box.x+box.width*.5167,box.y+box.height*.54375,{steps:10});await page.mouse.up();
      await page.locator('#readDateAgain').click();
      await page.waitForFunction(()=>document.querySelector('#expires').value==='2027-06-27',null,{timeout:90000});
    }
    console.log('PASS supplied photo reads 27/06/2027 (full photo or selected label crop)');
  }
  await page.locator('#expiryDay').selectOption('31');await page.locator('#expiryMonth').selectOption('02');await page.locator('#expiryYear').selectOption('2027');
  assert.equal(await page.locator('#expires').inputValue(),''); assert.equal(await page.locator('#expiryDay').evaluate(e=>e.validity.valid),false);
  await page.locator('#expiryDay').selectOption('28');await page.locator('#save').click();await page.locator('#lotDialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  const newest=DB.db.prepare('SELECT * FROM expiry_records ORDER BY id DESC LIMIT 1').get();
  await page.locator('#search').fill('สินค้าบันทึกต่อเนื่อง');
  await page.waitForFunction(()=>document.querySelectorAll('#rows button[data-action="delete"]').length===3);
  page.once('dialog',d=>d.accept());await page.locator('#rows button[data-action="delete"][data-id="'+newest.id+'"]').click();
  await page.waitForFunction(id=>!document.querySelector('#rows button[data-action="delete"][data-id="'+id+'"]'),newest.id);
  assert.equal(DB.db.prepare('SELECT deleted FROM expiry_records WHERE id=?').get(newest.id).deleted,1);
  assert.equal(await page.locator('#rows button[data-action="delete"]').count(),2);
  await page.locator('#search').fill('');await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  console.log('PASS impossible numeric dates are blocked and deleting one row retains its siblings');
}
