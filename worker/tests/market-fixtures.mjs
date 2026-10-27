import fs from 'node:fs/promises';
import vm from 'node:vm';
import { inflateRawSync } from 'node:zlib';
export async function marketClient() {
  const elements=new Map();
  const element=()=>({value:'',textContent:'',innerHTML:'',disabled:false,addEventListener(){},classList:{add(){},remove(){},toggle(){}},style:{},focus(){},querySelectorAll(){return[];}});
  const document={querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},querySelectorAll(){return[];},addEventListener(){},createElement(){return element();}};
  const c=vm.createContext({console,document,window:{addEventListener(){}},location:{hash:'',pathname:'/market.html',search:''},history:{replaceState(){}},sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},localStorage:{getItem(){return null;},setItem(){}},URL,Blob,Response,CompressionStream,TextEncoder,Uint8Array,Uint32Array,DataView,ArrayBuffer,setTimeout,clearTimeout,setInterval,clearInterval});
  const market=await fs.readFile(new URL('../../assets/js/pages/market.js',import.meta.url),'utf8');
  vm.runInContext(market.replace(/\ninitToken\(\);\s*load\(\);\s*$/,''),c);
  vm.runInContext(await fs.readFile(new URL('../../assets/js/pages/market-export.js',import.meta.url),'utf8'),c);
  return c;
}
export function unzip(bytes) {
  const b=Buffer.from(bytes),files={};let p=0;
  while(b.readUInt32LE(p)===0x04034b50) {
    const method=b.readUInt16LE(p+8),size=b.readUInt32LE(p+18),nameLen=b.readUInt16LE(p+26),extra=b.readUInt16LE(p+28);
    const name=b.subarray(p+30,p+30+nameLen).toString(),start=p+30+nameLen+extra,data=b.subarray(start,start+size);
    files[name]=(method===8?inflateRawSync(data):data).toString('utf8');p=start+size;
  }
  return files;
}
export function fixture(c,overrides={}) {
  const raw=['34','0012345678901','ผลิตภัณฑ์ดูแลผ้าสูตรเข้มข้น กลิ่นดอกไม้ 1,500 มล.',12.5,'> ปรับขึ้น\nเดิม 120 ขึ้น 130','2026-10-20',100,130,129,140,'ปรับขึ้น',140,'เปรียบเทียบสินค้าขนาดและโปรโมชั่นเดียวกัน','2026-10-18'];
  return Object.assign(c.calcItem(raw,0),overrides);
}
export function report(c,items,overrides={}) {
  return Object.assign({name:'34',title:'สำรวจราคาท้องตลาดหมวดสินค้า 34 ผลิตภัณฑ์ดูแลผ้า · สาขาหลัก',leftHead:'อัปข้อมูลเข้า วันที่ 18/10/2026',rightHead:'ส่งออกข้อมูล วันที่ 26/10/2026',sumTitle:'สรุปการสำรวจ หมวด 34',surveyor:'พนักงานตัวอย่าง',checker:'',approver:'',groupNames:{34:'ผลิตภัณฑ์ดูแลผ้า',35:'เครื่องดื่ม'},groupDates:{34:'2026-10-18',35:'2026-10-19'},items},overrides);
}

