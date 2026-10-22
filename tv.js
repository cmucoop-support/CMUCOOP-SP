import { batch, kvJson, kvSetStmt, str } from '../core/database.js';
import { BC_FONTS } from './barcode.js';
import { bannerSettings } from './media.js';
import { API } from '../core/registry.js';
import { auth } from './auth.js';
import { appendLog } from '../core/logging.js';

const TV_DEF = { shop: 'ร้านสหกรณ์ มช. (CMU CO-OP)', helloMain: 'ยินดีต้อนรับ', helloSub: '"ขอให้วันนี้เป็นวันที่สดใสสำหรับคุณ"', caption: 'ร้านสหกรณ์ มช. ยินดีให้บริการ',
  bg: '#a07ab8', textColor: '', clockColor: '', shopColor: '', welcomeColor: '', subColor: '', captionColor: '', footColor: '', width: 760, bannerH: 230, receiverH: 430, fontClock: 22, fontShop: 22, fontHello: 22, fontCaption: 22, capSpeed: 80, gap: 14, padTop: 14, logoSize: 84, headGap: 18, gapBanner: null, gapCaption: null, gapReceiver: null, gapFoot: null, bannerW: 0, receiverW: 0, font: 'Sarabun', headLayout: 'side', showClock: true, showLogo: true, showBanner: true,
  controlBg: '', controlColor: '', controlBorderColor: '', controlOpacity: 100,
  bannerBg: '#ffffff', bannerBgMatch: false, bannerBgOpacity: 100,
  bannerFrameColor: '#ffffff', bannerFrameMatch: false, bannerFrameOpacity: 100, bannerFramePadding: 10,
  bannerSpeed: 4, bannerPerView: 0, bannerHeightPct: 80 };

const TV_COLOR = ['textColor', 'clockColor', 'shopColor', 'welcomeColor', 'subColor', 'captionColor', 'footColor', 'controlBg', 'controlColor', 'controlBorderColor'];

const TV_REQUIRED_COLOR = ['bannerBg', 'bannerFrameColor'];

const TV_TXT = { shop: 80, helloMain: 60, helloSub: 100, caption: 120 };

const TV_NUM = { width: [480, 3840, 'ความกว้างหน้า'], bannerH: [60, 2000, 'ความสูงแบนเนอร์'], receiverH: [150, 2000, 'ความสูงกรอบตัวรับเสียง'],
  gap: [0, 200, 'ระยะห่างระหว่างส่วน'], logoSize: [20, 600, 'ขนาดโลโก้'], padTop: [0, 600, 'ระยะห่างขอบด้านบนสุด'], headGap: [0, 200, 'ระยะห่างโลโก้กับข้อความ'], bannerW: [0, 3840, 'ความกว้างแบนเนอร์ (0 = เต็มหน้า)'], receiverW: [0, 3840, 'ความกว้างกรอบตัวรับเสียง (0 = เต็มหน้า)'],
  fontClock: [10, 200, 'ขนาดตัวอักษรนาฬิกา'], fontShop: [10, 200, 'ขนาดตัวอักษรชื่อร้าน'], fontHello: [10, 200, 'ขนาดตัวอักษรข้อความต้อนรับ'],
  fontCaption: [10, 200, 'ขนาดตัวอักษรข้อความใต้แบนเนอร์'], capSpeed: [10, 400, 'ความเร็วข้อความไหล'],
  controlOpacity: [0, 100, 'ความทึบพื้นปุ่ม'], bannerBgOpacity: [0, 100, 'ความทึบกรอบรวม Banner'], bannerFrameOpacity: [0, 100, 'ความทึบกรอบรอบรูป'], bannerFramePadding: [0, 60, 'ความหนากรอบรอบรูป'],
  bannerSpeed: [1, 60, 'เวลาแสดงแต่ละรูป'], bannerPerView: [0, 6, 'จำนวนรูปต่อหน้า'], bannerHeightPct: [30, 100, 'ความสูงรูปในกรอบ'] };

const TV_OPT = { gapBanner: 'ระยะห่างเหนือแบนเนอร์', gapCaption: 'ระยะห่างเหนือข้อความไหล', gapReceiver: 'ระยะห่างเหนือกรอบตัวรับเสียง', gapFoot: 'ระยะห่างเหนือท้ายหน้า' };

const TV_LAYOUTS = ['side', 'stack', 'row', 'topRow'];

const TV_BOOL = ['showClock', 'showLogo', 'showBanner', 'bannerBgMatch', 'bannerFrameMatch'];

function tvNorm(o, strict) {
  o = o && typeof o === 'object' ? o : {}; const out = {};
  Object.keys(TV_TXT).forEach(k => {
    if (o[k] === undefined || o[k] === null) { out[k] = TV_DEF[k]; return; }
    const v = str(o[k]); if (v.length > TV_TXT[k]) { if (strict) throw new Error('ข้อความยาวเกิน ' + TV_TXT[k] + ' ตัวอักษร'); out[k] = v.slice(0, TV_TXT[k]); } else out[k] = v;
  });
  Object.keys(TV_NUM).forEach(k => {
    const [mn, mx, nm] = TV_NUM[k]; let v = Number(o[k]);
    if (o[k] === undefined || o[k] === null || o[k] === '' || !isFinite(v)) { if (strict && o[k] !== undefined) throw new Error(nm + 'ต้องเป็นตัวเลข'); out[k] = TV_DEF[k]; return; }
    if (k !== 'bannerSpeed') v = Math.round(v);
    if (v < mn || v > mx) { if (strict) throw new Error(nm + 'ต้องอยู่ระหว่าง ' + mn + '–' + mx); v = Math.min(mx, Math.max(mn, v)); }
    out[k] = v;
  });
  Object.keys(TV_OPT).forEach(k => {
    if (o[k] === undefined || o[k] === null || o[k] === '') { out[k] = null; return; }
    let v = Number(o[k]);
    if (!isFinite(v)) { if (strict) throw new Error(TV_OPT[k] + 'ต้องเป็นตัวเลข'); out[k] = null; return; }
    v = Math.round(v); if (v < 0 || v > 200) { if (strict) throw new Error(TV_OPT[k] + 'ต้องอยู่ระหว่าง 0–200 px'); v = Math.min(200, Math.max(0, v)); }
    out[k] = v;
  });
  out.font = BC_FONTS.includes(str(o.font)) ? str(o.font) : TV_DEF.font;
  out.headLayout = TV_LAYOUTS.includes(str(o.headLayout)) ? str(o.headLayout) : TV_DEF.headLayout;
  out.bg = /^#[0-9a-f]{6}$/i.test(str(o.bg)) ? str(o.bg).toLowerCase() : TV_DEF.bg;
  TV_REQUIRED_COLOR.forEach(k => {
    const value = str(o[k]);
    if (strict && o[k] !== undefined && !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('สีต้องอยู่ในรูปแบบ #RRGGBB');
    out[k] = /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : TV_DEF[k];
  });
  TV_COLOR.forEach(k => { out[k] = /^#[0-9a-f]{6}$/i.test(str(o[k])) ? str(o[k]).toLowerCase() : ''; });
  TV_BOOL.forEach(k => { out[k] = o[k] === undefined || o[k] === null ? TV_DEF[k] : !(o[k] === false || o[k] === 'false'); });
  return out;
}

const tvCfg = async C => {
  const [raw, banner] = await Promise.all([kvJson(C, 'TV_CFG', {}), bannerSettings(C)]);
  return tvNorm(Object.assign({}, raw, { bannerSpeed: banner.speed, bannerPerView: banner.perView, bannerHeightPct: banner.heightPct }), false);
};

API.getTvPublic = C => tvCfg(C);

API.getTvConfig = async (C, token) => { await auth(C, token, true); return { cfg: await tvCfg(C), def: TV_DEF }; };

API.setTvConfig = async (C, token, o) => {
  const me = await auth(C, token, true);
  const current = await tvCfg(C);
  const cfg = tvNorm(Object.assign({}, current, o && typeof o === 'object' && !Array.isArray(o) ? o : {}), true);
  if (JSON.stringify(current) === JSON.stringify(cfg)) return { ok: true, cfg };
  // Keep the existing Banner keys authoritative so older Banner APIs remain compatible.
  const stored = Object.assign({}, cfg);
  delete stored.bannerSpeed; delete stored.bannerPerView; delete stored.bannerHeightPct;
  await batch(C, [
    kvSetStmt(C, 'TV_CFG', JSON.stringify(stored)),
    kvSetStmt(C, 'BANNER_SPEED', String(cfg.bannerSpeed)),
    kvSetStmt(C, 'BANNER_PER_VIEW', String(cfg.bannerPerView)),
    kvSetStmt(C, 'BANNER_HEIGHT_PCT', String(cfg.bannerHeightPct))
  ]);
  await appendLog(C, me.name, 'TV', '', 'ตั้งค่าหน้าแสดงผล โฆษณา', cfg.shop + ' · แบนเนอร์สูง ' + cfg.bannerH + ' · ตัวรับเสียงสูง ' + cfg.receiverH);
  return { ok: true, cfg };
};

export { TV_DEF, TV_COLOR, TV_REQUIRED_COLOR, TV_TXT, TV_NUM, TV_OPT, TV_LAYOUTS, TV_BOOL, tvNorm, tvCfg };
