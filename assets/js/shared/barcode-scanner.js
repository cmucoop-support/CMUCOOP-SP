(function () {
  'use strict';
  let libraryPromise;
  function library() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (!libraryPromise) {
      libraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'assets/vendor/zxing-library-0.23.0.min.js';
        script.onload = () => window.ZXing ? resolve(window.ZXing) : reject(new Error('ไม่พบตัวอ่านบาร์โค้ด'));
        script.onerror = () => { script.remove(); reject(new Error('โหลดตัวอ่านบาร์โค้ดไม่สำเร็จ กรุณาลองอีกครั้ง หรือค้นหาด้วยรหัสสินค้า')); };
        document.head.appendChild(script);
      }).catch(error => { libraryPromise = null; throw error; });
    }
    return libraryPromise;
  }
  function cameraError(error) {
    if (['NotAllowedError', 'PermissionDeniedError'].includes(error.name)) return 'ยังไม่ได้รับอนุญาตกล้อง กรุณาเปิดสิทธิ์กล้องให้เว็บไซต์นี้ในการตั้งค่าเบราว์เซอร์ แล้วกดลองอีกครั้ง';
    if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(error.name)) return 'ไม่พบกล้องที่ใช้งานได้ กรุณาตรวจสอบกล้อง หรือพิมพ์รหัส / ชื่อสินค้าแทน';
    if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(error.name)) return 'กล้องอาจถูกใช้งานอยู่ กรุณาปิดแอปอื่นที่ใช้กล้องแล้วลองอีกครั้ง';
    return error.message || 'เปิดกล้องไม่สำเร็จ กรุณาลองอีกครั้ง หรือพิมพ์รหัส / ชื่อสินค้าแทน';
  }
  class Scanner {
    constructor(video, status, found) { this.video = video; this.status = status; this.found = found; this.session = 0; }
    stop() {
      this.session++; clearTimeout(this.timer); this.timer = null;
      if (this.controls) {
        this.controls.zoomContainer.hidden = true; this.controls.torch.hidden = true;
        this.controls.torch.setAttribute('aria-pressed', 'false'); this.controls.torch.textContent = 'เปิดไฟฉาย';
      }
      if (this.stream) this.stream.getTracks().forEach(track => track.stop());
      this.stream = null; this.video.pause(); this.video.srcObject = null; this.reader = null; this.native = null;
    }
    async configureControls(session) {
      if (!this.controls || !this.stream) return;
      const track = this.stream.getVideoTracks()[0], caps = track.getCapabilities ? track.getCapabilities() : {};
      this.softwareZoom = 1; this.frame = 0;
      const { zoom, zoomContainer, torch } = this.controls;
      zoom.min = caps.zoom ? caps.zoom.min : 1; zoom.max = caps.zoom ? Math.min(6,caps.zoom.max) : 4;
      zoom.step = caps.zoom ? caps.zoom.step || .1 : .1;
      zoom.value = track.getSettings && track.getSettings().zoom || zoom.min;
      zoomContainer.hidden = Number(zoom.max) <= Number(zoom.min);
      zoom.oninput = async () => {
        if (session !== this.session) return;
        if (caps.zoom) { try { await track.applyConstraints({advanced:[{zoom:Number(zoom.value)}]}); } catch (_) { this.status('กล้องปรับซูมไม่ได้ ลองขยับเข้าใกล้บาร์โค้ด'); } }
        else { this.softwareZoom = Number(zoom.value); this.video.style.transform = 'scale('+this.softwareZoom+')'; }
      };
      torch.hidden = !caps.torch;
      torch.onclick = async () => {
        if (session !== this.session) return;
        const on = torch.getAttribute('aria-pressed') !== 'true';
        try { await track.applyConstraints({advanced:[{torch:on}]}); if (session !== this.session) return; torch.setAttribute('aria-pressed',String(on)); torch.textContent = on ? 'ปิดไฟฉาย' : 'เปิดไฟฉาย'; }
        catch (_) { this.status('กล้องนี้เปิดไฟฉายไม่ได้ กรุณาเพิ่มแสงรอบสินค้า'); }
      };
      const focus = async () => {
        if (session !== this.session || !caps.focusMode || !caps.focusMode.includes('continuous')) return;
        try { await track.applyConstraints({advanced:[{focusMode:'continuous'}]}); } catch (_) { /* Optional camera capability. */ }
      };
      this.video.onclick = focus; await focus();
    }
    scanFrame() {
      // Match the part of the sensor actually visible in the cover preview.
      const v = this.video, vw = v.videoWidth, vh = v.videoHeight;
      const ratio = v.clientWidth / v.clientHeight;
      let w = vw, h = vh;
      if (vw/vh > ratio) w = vh*ratio; else h = vw/ratio;
      const z = this.softwareZoom || 1; w /= z; h /= z;
      const mode = this.frame++ % 3;
      if (mode === 1) { w *= .88; h *= .5; }
      const scale = Math.min(2,1280/Math.max(w,h)), cw = Math.round(w*scale), ch = Math.round(h*scale);
      const canvas = this.canvas || (this.canvas = document.createElement('canvas'));
      canvas.width = mode === 2 ? ch : cw; canvas.height = mode === 2 ? cw : ch;
      const ctx = canvas.getContext('2d', {willReadFrequently:true});
      if (mode === 2) { ctx.translate(ch,0); ctx.rotate(Math.PI/2); }
      ctx.drawImage(v,(vw-w)/2,(vh-h)/2,w,h,0,0,cw,ch);
      return canvas;
    }
    async fallback(session) {
      const Z = await library(); if (session !== this.session) return;
      const hints = new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'ITF'].map(key => Z.BarcodeFormat[key]));
      hints.set(Z.DecodeHintType.TRY_HARDER, true);
      this.reader = new Z.BrowserMultiFormatReader(hints); this.native = null;
    }
    async start() {
      this.stop(); const session = this.session;
      if (!window.isSecureContext) { this.status('ต้องเปิดเว็บไซต์ผ่าน HTTPS จึงจะใช้กล้องได้ สามารถพิมพ์รหัส / ชื่อสินค้าแทนได้', true); return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.status('เบราว์เซอร์นี้เปิดกล้องไม่ได้ กรุณาเปิดด้วย Safari หรือ Chrome หรือพิมพ์รหัส / ชื่อสินค้าแทน', true); return; }
      this.status('กำลังขออนุญาตเปิดกล้อง…');
      try {
        let stream;
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: this.controls ? 1920 : 1280 }, height: { ideal: this.controls ? 1080 : 720 } } }); }
        catch (error) {
          if (session !== this.session) return;
          if (!['OverconstrainedError', 'NotFoundError'].includes(error.name)) throw error;
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        }
        // A permission prompt can resolve after the user closes the dialog.
        if (session !== this.session) { stream.getTracks().forEach(track => track.stop()); return; }
        this.stream = stream; this.video.srcObject = stream;
        this.video.style.transform = '';
        await this.video.play(); if (session !== this.session) return;
        await this.configureControls(session); if (session !== this.session) return;
        if (window.BarcodeDetector) {
          try {
            const supported = await window.BarcodeDetector.getSupportedFormats();
            if (session !== this.session) return;
            const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
            // Use the complete fallback if the native decoder misses retail formats.
            if (wanted.every(format => supported.includes(format))) this.native = new window.BarcodeDetector({ formats: wanted });
          } catch (_) { /* Load the bundled decoder below. */ }
        }
        if (!this.native) await this.fallback(session);
        if (session !== this.session) return;
        this.status('เล็งบาร์โค้ดให้อยู่กลางภาพ ขยับเข้าออกเล็กน้อย และให้มีแสงเพียงพอ');
        this.lastCode = ''; this.hits = 0; this.scan(session);
      } catch (error) {
        if (session !== this.session) return;
        this.stop(); this.status(cameraError(error), true);
      }
    }
    async scan(session) {
      if (session !== this.session) return;
      try {
        if (this.video.readyState >= 2) {
          let code = '';
          const frame = this.controls ? this.scanFrame() : this.video;
          if (this.native) {
            try { const rows = await this.native.detect(frame); code = rows[0] && rows[0].rawValue || ''; }
            catch (_) { await this.fallback(session); }
          } else if (this.reader) {
            try {
              if (this.controls) {
                const Z = window.ZXing;
                code = this.reader.decodeBitmap(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(frame)))).getText();
              } else code = this.reader.decode(this.video).getText();
            }
            catch (error) {
              const Z = window.ZXing;
              if (!(error instanceof Z.NotFoundException || error instanceof Z.ChecksumException || error instanceof Z.FormatException)) throw error;
            }
          }
          if (session !== this.session) return;
          code = String(code).trim();
          if (code && code.length <= 64 && !/[\x00-\x1f]/.test(code)) {
            this.hits = code === this.lastCode ? this.hits + 1 : 1; this.lastCode = code;
            if (this.hits >= 2) {
              this.stop(); if (navigator.vibrate) navigator.vibrate(70); this.found(code); return;
            }
          } else if (!this.controls) { this.lastCode = ''; this.hits = 0; }
          // Cropped/rotated frames can miss between matching reads. Expire an old candidate.
          if (this.controls && code) this.lastRead = Date.now();
          if (this.controls && !code && Date.now() - (this.lastRead || 0) > 1800) { this.lastCode = ''; this.hits = 0; }
        }
      } catch (error) {
        if (session !== this.session) return;
        this.stop(); this.status(cameraError(error), true); return;
      }
      if (session === this.session) this.timer = setTimeout(() => this.scan(session), this.native ? 150 : 230);
    }
  }
  window.CMUBarcodeScanner = Scanner;
}());
