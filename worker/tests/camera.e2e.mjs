import assert from 'node:assert/strict';
// Real generated barcode frames are decoded by the bundled library. Only device
// access is simulated; this does not replace a physical iPhone/Android check.
export async function cameraChecks(page, base) {
  const stopped = async () => {
    await page.waitForFunction(()=>window.__testStream.getTracks().every(track=>track.readyState==='ended'));
    assert.equal(await page.locator('#cameraVideo').evaluate(video=>video.srcObject),null);
  };
  async function streamMock(fixture='') {
    await page.evaluate(async ({base,fixture})=>{
      window.BarcodeDetector=undefined;
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1280,720);
      window.__paintBarcode=async name=>{
        ctx.fillStyle='#fff';ctx.fillRect(0,0,1280,720);
        if(!name)return;
        const img=new Image();img.src=base+'/worker/tests/fixtures/'+name+'.svg';await img.decode();
        ctx.drawImage(img,(1280-img.naturalWidth)/2,(720-img.naturalHeight)/2);
      };
      await window.__paintBarcode(fixture);
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async options=>{
        window.__cameraOptions=options;window.__testStream=canvas.captureStream(12);window.__cameraCanvas=canvas;
        const stream=window.__testStream;
        const tick=()=>{if(stream.getTracks().some(t=>t.readyState==='live')){ctx.drawImage(canvas,0,0);setTimeout(tick,80);}};
        setTimeout(tick,0);
        return window.__testStream;
      }});
    },{base,fixture});
  }
  await page.locator('#addLot').click();await page.locator('#branch').selectOption('สาขาทดสอบ');
  await streamMock();await page.locator('#openCamera').click();
  await page.waitForFunction(()=>document.querySelector('#cameraStatus').textContent.startsWith('เล็ง'));
  await page.waitForTimeout(750);
  assert.equal(await page.locator('#cameraDialog').evaluate(el=>el.open),true);
  assert.equal(await page.locator('#cameraStatus').evaluate(el=>el.classList.contains('error')),false);
  assert.equal(await page.evaluate(()=>window.__cameraOptions.audio),false);
  assert.equal(await page.evaluate(()=>window.__cameraOptions.video.facingMode.ideal),'environment');
  await page.evaluate(()=>window.__paintBarcode('ean13'));
  await page.waitForFunction(()=>document.querySelector('#productName').value==='สินค้าจากกล้อง');
  assert.equal(await page.locator('#productSearch').inputValue(),'8850123456787');
  assert.equal(await page.locator('#cameraDialog').evaluate(el=>el.open),false);await stopped();
  console.log('PASS bundled decoder reads real EAN-13 video frames, blank frames keep scanning, success releases camera');
  await streamMock('code128');await page.locator('#openCamera').click();
  await page.waitForFunction(()=>document.querySelector('#productName').value==='สินค้าบันทึกต่อเนื่อง');await stopped();
  console.log('PASS bundled decoder reads real Code 128 video frames');

  await page.evaluate(()=>{Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{throw new DOMException('denied','NotAllowedError');}});});
  await page.locator('#openCamera').click();await page.waitForFunction(()=>document.querySelector('#cameraStatus').textContent.includes('ยังไม่ได้รับอนุญาต'));
  await page.locator('#cancelCamera').click();assert.equal(await page.locator('#lotDialog').evaluate(el=>el.open),true);
  console.log('PASS denied camera permission explains recovery and preserves the form');

  await page.evaluate(()=>{window.__secureDescriptor=Object.getOwnPropertyDescriptor(window,'isSecureContext');Object.defineProperty(window,'isSecureContext',{configurable:true,value:false});});
  await page.locator('#openCamera').click();await page.waitForFunction(()=>document.querySelector('#cameraStatus').textContent.includes('HTTPS'));
  await page.locator('#cancelCamera').click();await page.evaluate(()=>Object.defineProperty(window,'isSecureContext',window.__secureDescriptor));
  await page.evaluate(()=>{Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:undefined});});
  await page.locator('#openCamera').click();await page.waitForFunction(()=>document.querySelector('#cameraStatus').textContent.includes('เบราว์เซอร์นี้เปิดกล้องไม่ได้'));
  await page.locator('#cancelCamera').click();await page.evaluate(()=>{delete navigator.mediaDevices;});
  console.log('PASS HTTP and browsers without camera access offer a clear manual lookup path');

  await streamMock();
  await page.evaluate(()=>{
    window.__nativeCalls=0;
    window.BarcodeDetector=class {
      static async getSupportedFormats(){return ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf'];}
      async detect(){window.__nativeCalls++;return window.__nativeCalls===1?[{rawValue:'NOISE'}]:window.__nativeCalls===2?[]:[{rawValue:'8850123456787'}];}
    };
  });
  await page.locator('#openCamera').click();await page.waitForFunction(()=>!document.querySelector('#cameraDialog').open);
  await page.waitForFunction(()=>document.querySelector('#productName').value==='สินค้าจากกล้อง');
  assert.ok(await page.evaluate(()=>window.__nativeCalls>=4));await stopped();
  console.log('PASS native detector requires repeat confirmation and looks up the stock product');

  await streamMock('ean13');await page.evaluate(()=>{
    window.BarcodeDetector=class {
      static async getSupportedFormats(){return ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf'];}
      async detect(){throw new DOMException('native unavailable','NotSupportedError');}
    };
  });
  await page.locator('#openCamera').click();await page.waitForFunction(()=>!document.querySelector('#cameraDialog').open);await stopped();
  console.log('PASS native detector failures switch to the bundled decoder');

  await streamMock();await page.evaluate(()=>{
    const acquire=navigator.mediaDevices.getUserMedia;
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:()=>new Promise(resolve=>{window.__grantLate=async()=>resolve(await acquire({}));})});
  });
  await page.locator('#openCamera').click();await page.waitForFunction(()=>!!window.__grantLate);
  await page.locator('#closeCamera').click();await page.evaluate(()=>window.__grantLate());await stopped();
  console.log('PASS a late permission grant after closing cannot leave the camera running');

  await streamMock();await page.locator('#openCamera').click();await page.waitForFunction(()=>document.querySelector('#cameraStatus').textContent.startsWith('เล็ง'));
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
  await page.waitForFunction(()=>!document.querySelector('#cameraDialog').open);await stopped();
  await page.locator('#cancelForm').click();
  console.log('PASS hiding the page stops all camera tracks');
}
