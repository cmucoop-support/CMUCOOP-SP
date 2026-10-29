const SESSION_TTL = 21600;

const MAX_FAIL = 5, LOCK_SEC = 300, LOG_DAYS = 30;

const CHUNK = 900000;

const MAX_BANNER_BYTES = 8 * 1024 * 1024, MAX_SOUND_BYTES = 8 * 1024 * 1024;

const ROLES = { admin: 'Admin', viewer: 'ผู้ใช้งาน' };

const PERM_KEYS = ['barcode', 'sound', 'music', 'stock', 'stock_edit', 'market', 'market_edit', 'expiry', 'expiry_edit', 'assets', 'assets_edit'];

const PERM_DEFAULT = { barcode: true, sound: true, music: true, stock: false, stock_edit: false, market: false, market_edit: false, expiry: false, expiry_edit: false, assets: false, assets_edit: false };

const CARD_KEYS = ['barcode', 'sound', 'music', 'stock', 'market', 'expiry', 'assets', 'settings'];

const CUSTOM_KEY = /^c_[0-9a-f]{8}$/, MAX_CUSTOM_CARDS = 30;

const CARD_TITLE_MAX = 40;

const LEGACY_LINKS = [
  { old: 'label', k: 'c_00000001', t: 'ทำป้ายราคา', u: 'http://172.16.21.103/COOPSHOP/CoopAdmin/productall.php', def: true },
  { old: 'price', k: 'c_00000002', t: 'ตรวจสอบราคาสินค้า', u: 'https://cmu-coops.com/product/countpd.php', def: true },
  { old: 'offline', k: 'c_00000003', t: 'ระบบ CMUCOOP Offline', u: 'http://172.16.21.103/COOPSHOP/CoopAdmin/productall.php', def: false },
  { old: 'online', k: 'c_00000004', t: 'ระบบ CMUCOOP Online', u: 'https://cmu-coops.com/adEntry.php', def: false },
  { old: 'assets', k: 'c_00000005', t: 'รายการสินทรัพย์', u: '', def: true }
];

const LEGACY_ORDER = ['barcode', 'sound', 'music', 'label', 'price', 'offline', 'online', 'assets', 'history', 'settings'];

const ACT_GROUPS = [
  { key: 'barcode', label: 'รายการบาร์', sheets: ['บาร์สินค้า'] },
  { key: 'sound', label: 'ระบบเสียงประกาศ', sheets: ['Sound'] },
  { key: 'music', label: 'ขอเพลง/คิวเพลง', sheets: ['Music'] },
  { key: 'assets', label: 'รายการสินทรัพย์', sheets: ['รายการสินทรัพย์'] },
  { key: 'stock', label: 'สินค้าค้างสต็อก', sheets: ['สินค้าค้างสต็อก'] },
  { key: 'market', label: 'เช็คราคาตลาด', sheets: ['เช็คราคาตลาด'] },
  { key: 'expiry', label: 'แจ้งเตือนสินค้าหมดอายุ', sheets: ['วันหมดอายุ'] },
  { key: 'banner', label: 'Banner', sheets: ['Banner'] },
  { key: 'system', label: 'ผู้ใช้งาน/ระบบ', sheets: ['ระบบ'] }
];

const USE_AREAS = { barcode: 'บาร์สินค้า', sound: 'Sound', music: 'Music', assets: 'รายการสินทรัพย์', banner: 'Banner', stock: 'สินค้าค้างสต็อก', market: 'เช็คราคาตลาด', expiry: 'วันหมดอายุ' };

const BANNER_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const BANNER_DEF = { speed: 4, per: 0, perMax: 6, h: 80 };

const SOUND_TYPES = ['ปุ่ม', 'เสียงตามเวลา', 'ระบบ', 'พนักงาน', 'สถานที่', 'แคชเชียร์', 'ประเภทงดรับ', 'เวลา', 'ตั้งค่า'];

const SOUND_NOFILE = { 'เวลา': 1, 'ตั้งค่า': 1 };

const SOUND_EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/webm': 'webm' };

const SOUND_MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', webm: 'audio/webm' };

const SOUND_LEGACY = 'https://ratthaphontha-wq.github.io/--audio/';

const NOT_YET = 'ระบบนี้ยังไม่ได้ย้ายมาใช้หลังบ้านใหม่ (อยู่ระหว่างพัฒนา)';

const PENDING = ['makePdf'];

export { SESSION_TTL, MAX_FAIL, LOCK_SEC, LOG_DAYS, CHUNK, MAX_BANNER_BYTES, MAX_SOUND_BYTES, ROLES, PERM_KEYS, PERM_DEFAULT, CARD_KEYS, CUSTOM_KEY, MAX_CUSTOM_CARDS, CARD_TITLE_MAX, LEGACY_LINKS, LEGACY_ORDER, ACT_GROUPS, USE_AREAS, BANNER_EXT, BANNER_DEF, SOUND_TYPES, SOUND_NOFILE, SOUND_EXT, SOUND_MIME, SOUND_LEGACY, NOT_YET, PENDING };
