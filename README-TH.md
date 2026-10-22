# CMUCOOP SUPPORT — Liquid Glass และตั้งค่าการ์ด

เว็บเข้าใช้งานผ่าน `index.html`, `barcode.html`, `stock.html`, `market.html`, `expiry.html`, `music.html`, `sound.html`, `settings.html`, `tv.html`, `banner.html` และ `receiver.html` ตาม URL เดิม

รุ่นล่าสุดปรับธีมกระจก นำกรอบต้อนรับและไอคอนหน้าฟีเจอร์ออก เพิ่มช่อง **ซ่อนการ์ดนี้** และตัวเลือก **เปิดแท็บเดิม / เปิดแท็บใหม่** ในหน้า Admin ตั้งค่า อ่านรายละเอียดใน [UI-UPDATE-TH.md](UI-UPDATE-TH.md), [CARD-VISIBILITY-TH.md](CARD-VISIBILITY-TH.md) และ [CARD-TABS-TH.md](CARD-TABS-TH.md) ชุดรวมมี Worker แบบไฟล์เดียวใน `Cloudflare-Worker/worker-copy.txt` สำหรับคัดลอกลง Dashboard

## สิ่งที่ปรับปรุงในฉบับนี้

- **ระบบทะเบียนสินค้าไม่ได้เปิดใช้งานในต้นฉบับนี้**: ไม่มีหน้า `catalog.html`, entry point ไม่โหลดโมดูลทะเบียนสินค้า และไม่มีสิทธิ์ `product_catalog` แต่ยังมีสคริปต์ สไตล์ และชุดทดสอบเดิมค้างอยู่ ทำให้ audit รายงาน API 5 จุดและชุดทดสอบเดิมล้มเหลว 17 ข้อ โค้ด schema เดิมมีการลบ Trigger (`catalog_dirty_*`) และตาราง `product_catalog`, `product_catalog_records`, `product_catalog_state`, `expiry_products` เมื่อจำเป็นต้องอัปเดต schema
- **ตัดการเขียนตารางอนุพันธ์ 30,000 แถวในระบบวันหมดอายุ (`expiry_products`)**: เปลี่ยนมาสร้างดัชนีค้นหารหัส/ชื่อสินค้าจากสต็อกในหน่วยความจำของ Worker (0 Row Writes ลง D1)
- **ปรับการนำเข้าและสำรองข้อมูลบาร์โค้ด (`barcode.js`)**:
  - ตัดการเขียนลงตารางพัก `barcode_stage` (ลดการเขียนซ้ำ 2 รอบต่อการนำเข้า)
  - เปลี่ยนการทำสำเนา (`bcSnapshot`) จากการคัดลอกทีละแถวลง `barcode_backup_items` มาเป็นการเก็บก้อน JSON (Chunks) พร้อมตรวจแฮชเพื่อไม่สร้างสำเนาซ้ำหากข้อมูลไม่เปลี่ยน (ลดการเขียนจาก 40,000 แถว เหลือประมาณ 10 แถว)
  - เปลี่ยนโหมดนำเข้าแทนที่ (`replace`) เป็นการเทียบความต่าง (Diff) เขียนเฉพาะแถวที่เปลี่ยนหรือเพิ่มใหม่ แถวที่เหมือนเดิมไม่ถูกเขียนซ้ำ
  - ปรับการเพิ่มรายการเดี่ยว (`addItem`) ให้เลื่อนลำดับ `pos` เฉพาะภายในหมวดเดียวกันเมื่อแทรกต่อจากคู่ค้า ไม่เลื่อนแถวของหมวดอื่นทั้งตาราง
- **ลดการเขียนข้อมูลซ้ำของระบบคิวเพลงและ TV (`music.js`)**:
  - `musicTvTick` บันทึกตำแหน่งเพลง (`MUSIC_PROG`) เฉพาะเมื่อเปลี่ยนเพลง เปลี่ยนสถานะเล่น/หยุด เปลี่ยนแทร็กในเพลย์ลิสต์ หรือตำแหน่งคลาดเคลื่อนเกิน 4 วินาที แทนการเขียนลง D1 ทุก 5 วินาที
  - บันทึกสถานะออนไลน์ของ TV (`MUSIC_TV_SEEN`) ห่างกันอย่างน้อย 45 วินาทีโดยตรวจค่าล่าสุดในฐานข้อมูล
- **ปรับการบันทึกข้อมูล KV, ตลาด และสต็อก**:
  - คำสั่ง `kvSet` และ `kv_chunks` ใช้เงื่อนไข `WHERE ... <> excluded....` เพื่อไม่เขียนแถวซ้ำเมื่อข้อมูลในก้อนนั้นไม่เปลี่ยนแปลง และขยายขนาดก้อนข้อมูลเป็น 240 KB
  - หน้า `stock.html` รวมกลุ่มหมวดต่อคำขอบันทึกได้สูงสุด 25 หมวด (8,000 แถวต่อรอบ) ลดจำนวนรอบการเขียน `STOCK_GROUPS`, `STOCK_HISTORY` และ `log`
  - ตัดการบันทึกประวัติ (`logUse`) จากการคลิกเปลี่ยนแท็บ เลือกหมวด หรือกดเปิดการ์ดหน้าแรก และปรับรอบการล้างประวัติเก่าอัตโนมัติจากทุก 10 นาที เป็นวันละ 1 ครั้ง
- **ระบบสำรองการเข้าสู่ระบบเมื่อโควตาการเขียน D1 เต็ม**: หากบัญชี Cloudflare D1 ติดขีดจำกัดการเขียนรายวัน (`exceeded D1's free tier daily row write limit`) ระบบยังอนุญาตให้เข้าสู่ระบบและอ่านข้อมูลทุกหน้าได้ตามปกติผ่านโทเค็นลงลายมือชื่อ (Stateless Signed Session Token)

## โครงสร้าง

```text
*.html                       หน้าเว็บหลักและแต่ละระบบย่อย
assets/
  js/shared/                 API shim, navigation, scanner, accessibility
  js/pages/                  โค้ดแยกตามหน้า
  css/shared/                สไตล์และฟอนต์ส่วนกลาง
  css/pages/                 สไตล์แยกตามหน้า
  images/ fonts/ vendor/     รูปภาพ ฟอนต์ ไลบรารีและใบอนุญาตเดิม
worker/
  index.js                   entry point สำหรับ deploy
  src/core/                  HTTP, database, schema, registry, log, config
  src/modules/               auth, portal, barcode, stock, market, expiry ฯลฯ
  src/guards.js              ป้องกันการเขียนทับจากคำขอพร้อมกัน
  migrations/                SQL โครงสร้างฐานข้อมูล
  scripts/ tests/            ตรวจ syntax, assets, API และทดสอบพฤติกรรม
docs/                        คู่มือและรายละเอียดสถาปัตยกรรม
```

## ติดตั้งหรืออัปเดตระบบจริง

1. สำรองข้อมูล D1 เดิมก่อน deploy เนื่องจากโค้ด schema เดิมมีการลบตารางทะเบียนสินค้าที่เลิกใช้ หากรุ่น schema ในฐานข้อมูลยังไม่ตรง `expiry-stock-2`
2. สำหรับ Cloudflare Dashboard ให้ใช้ `Cloudflare-Worker/worker-copy.txt` จากชุดรวม คัดลอกทั้งไฟล์แทนโค้ดเดิมแล้ว Deploy โดยคง Worker และ D1 binding `DB` เดิม
3. อัปโหลดไฟล์ `.html` ทุกหน้าและโฟลเดอร์ `assets/` ทั้งชุดจากโฟลเดอร์นี้ทับตำแหน่งเดิมใน GitHub repository ไม่ซ้อนโฟลเดอร์ใหม่
4. รอ GitHub Pages deploy สำเร็จ แล้วกด Ctrl+F5 เข้า **ตั้งค่า → จัดการการ์ดเมนูหลัก** ติ๊ก **ซ่อนการ์ดนี้** และกดบันทึก

สำหรับผู้พัฒนาที่ใช้ Wrangler ให้ตรวจ `worker/wrangler.toml` แล้ว deploy ซอร์สทั้งโฟลเดอร์ `worker/` ด้วยวิธีเดิม ไม่วางเฉพาะ `worker/index.js` ใน Dashboard

## ตรวจสอบในเครื่อง

```sh
node worker/scripts/check.mjs
node worker/scripts/audit.mjs
node --test worker/tests/*.test.mjs
```

อ่านเพิ่ม: [สถาปัตยกรรมและการจัดเก็บ](docs/ARCHITECTURE-TH.md), [คู่มือระบบวันหมดอายุ](docs/EXPIRY-GUIDE-TH.md), [ผลตรวจฉบับนี้](docs/VALIDATION-TH.md)
