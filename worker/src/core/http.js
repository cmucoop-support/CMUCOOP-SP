import { cors, jsonOut } from './response.js';
import { ensureSchema } from './schema.js';
import { bannerJson, serveFile } from '../modules/media.js';
import { NOT_YET, PENDING } from './config.js';
import { API } from './registry.js';
import { productCatalog, isProductSave } from '../catalog-sync.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const C = { env, ctx, request, base: url.origin };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    try {
      const initialized = await ensureSchema(env.DB);
      // No business operation has run: the client may safely repeat this request.
      if (initialized && request.method === 'POST') return jsonOut({ ok: false, code: 'SCHEMA_INITIALIZED', error: 'ปรับโครงสร้างฐานข้อมูลเรียบร้อย กรุณาส่งคำขออีกครั้ง' });
      if (request.method === 'POST') return await rpc(C);
      if (request.method === 'GET') {
        if (url.pathname.startsWith('/file/')) return await serveFile(C, url.pathname.slice(6));
        if (url.searchParams.get('page') === 'banner-json') return await bannerJson(C, url);
        return new Response('CMUCOOP API OK', { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...cors() } });
      }
      return new Response('Method Not Allowed', { status: 405, headers: cors() });
    } catch (e) {
      return jsonOut({ ok: false, error: String((e && e.message) || e) });
    }
  }
};

async function rpc(C) {
  let out;
  try {
    const declared = Number(C.request.headers.get('Content-Length'));
    if (declared > 32 * 1024 * 1024) throw new Error('ข้อมูลคำขอใหญ่เกิน 32 MB กรุณาแบ่งชุด');
    const reader = C.request.body && C.request.body.getReader();
    const decoder = new TextDecoder(); let body = '', bytes = 0;
    if (reader) {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 32 * 1024 * 1024) { await reader.cancel(); throw new Error('ข้อมูลคำขอใหญ่เกิน 32 MB กรุณาแบ่งชุด'); }
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
    }
    const req = JSON.parse(body || '{}'), fn = String(req.fn || '');
    if (PENDING.indexOf(fn) >= 0) throw new Error(NOT_YET);
    if (!Object.prototype.hasOwnProperty.call(API, fn)) throw new Error('ไม่รู้จักคำสั่ง: ' + fn);
    const data = await API[fn](C, ...(Array.isArray(req.args) ? req.args : []));
    out = { ok: true, data };
    if (isProductSave(fn)) {
      try { await productCatalog.sync(C); }
      catch (error) {
        console.error('Product catalog pending; source save committed', error);
        out.catalogSync = { status: 'pending', message: 'บันทึกข้อมูลต้นทางแล้ว ทะเบียนสินค้ารออัปเดต กรุณาเปิดทะเบียนสินค้าเพื่อลองอัปเดตอีกครั้ง' };
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          data.catalogSync = out.catalogSync;
        }
      }
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return jsonOut(out);
}

export { rpc };
