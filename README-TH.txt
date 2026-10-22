ชุดอัปเดตหน้าเว็บ: เพิ่มตัวเลือกซ่อนการ์ด

สาเหตุที่ยังไม่เห็นตัวเลือก
ตรวจหน้า settings.html ที่เผยแพร่จริงเมื่อ 22 ตุลาคม 2026 พบว่ายังเรียก
assets/js/pages/settings.js?v=d1-opt-1 และยังไม่มีส่วนซ่อนการ์ด
การ Deploy Cloudflare Worker เพียงอย่างเดียวไม่ได้อัปเดตหน้าเว็บบน GitHub Pages

วิธีอัปเดต
1. แตก ZIP นี้ แล้วนำไฟล์หน้าเว็บทั้ง 6 ไฟล์ไปแทนตำแหน่งเดิมใน repository
   CMUCOOP-SP บน GitHub โดยคงโฟลเดอร์ assets/js/... และ assets/css/... ให้ตรงเดิม
   ให้ index.html และ settings.html อยู่ระดับเดียวกับไฟล์เดิม ไม่ซ้อนโฟลเดอร์ใหม่
2. Commit ไฟล์ให้ครบ แล้วรอ GitHub Actions / Pages deploy สำเร็จ
3. เปิด settings.html แล้วกด Ctrl+F5 เข้าสู่ระบบด้วย Admin
   ไปที่ จัดการการ์ดเมนูหลัก จะมีช่อง ซ่อนการ์ดนี้ ใต้ชื่อแต่ละการ์ด
   ติ๊กการ์ดที่ต้องการแล้วกด บันทึก ด้านล่างรายการ

ใช้ Cloudflare Worker รุ่นไฟล์เดียวที่ส่งให้ล่าสุดต่อได้
หาก Deploy รุ่นนั้นแล้ว ไม่ต้องแก้ Worker อีกรอบ และไม่ต้องเปลี่ยนฐานข้อมูล
หากหน้าเว็บขึ้นข้อความว่ายังโหลดค่าซ่อนการ์ดไม่ได้ ให้ Deploy Worker รุ่นใหม่ก่อน
จากไฟล์ CMUCOOP-Cloudflare-Worker-Copy.txt ที่ส่งให้ก่อนหน้านี้

ไฟล์หน้าเว็บในชุดนี้
index.html
settings.html
assets/js/pages/index.js
assets/js/pages/settings.js
assets/js/shared/gas-shim.js
assets/css/shared/liquid-glass.css

รุ่นที่ถูกต้อง
หน้า index/settings ต้องเรียกสคริปต์ด้วย ?v=card-visibility-1
และเรียก liquid-glass.css?v=liquid-3

การซ่อนมีผลกับเมนูหลักของทุกบัญชีเมื่อเปิดหรือโหลดหน้าใหม่
การ์ดตั้งค่าแสดงเสมอสำหรับ Admin เพื่อให้เปิดการ์ดอื่นกลับได้
คงการนำกรอบต้อนรับและไอคอนหน้าฟีเจอร์ออกตามที่ขอไว้แล้ว
ไม่ต้องใช้ API key หรือรหัสผ่านเพิ่มเติมสำหรับการอัปเดตชุดนี้
