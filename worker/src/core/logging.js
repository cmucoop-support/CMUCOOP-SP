import { batch, kvGet, kvSetStmt, now, run, stmt, str } from './database.js';
import { ACT_GROUPS, LOG_DAYS } from './config.js';

const maintenanceChecks = new WeakMap();

async function appendLog(C, who, sheet, cat, action, detail) {
  try {
    await run(C, 'INSERT INTO log(ts,who,sheet,cat,action,detail) VALUES(?,?,?,?,?,?)', now(), str(who), sheet, cat || '', action, detail || '');
    if ((maintenanceChecks.get(C.env.DB) || 0) > now()) return;
    maintenanceChecks.set(C.env.DB, now() + 60000);
    const bucket = String(Math.floor(now() / 600000));
    if (await kvGet(C, 'LOG_PRUNE_BUCKET', '') === bucket) return;
    const due = 'NOT EXISTS (SELECT 1 FROM kv WHERE k=? AND v=?)';
    await batch(C, [
      stmt(C, 'DELETE FROM log WHERE id IN (SELECT id FROM log WHERE ts<? LIMIT 10000) AND ' + due, now() - LOG_DAYS * 86400000, 'LOG_PRUNE_BUCKET', bucket),
      stmt(C, 'DELETE FROM fails WHERE k IN (SELECT k FROM fails WHERE until<? LIMIT 10000) AND ' + due, now(), 'LOG_PRUNE_BUCKET', bucket),
      kvSetStmt(C, 'LOG_PRUNE_BUCKET', bucket)
    ]);
  } catch (e) { console.error('บันทึกประวัติไม่สำเร็จ', e); } // ห้ามรายงานว่าบันทึกหลักล้มเหลวทั้งที่บันทึกสำเร็จแล้ว
}

async function sysLogTo(C, who, sheet, action, detail) { try { await appendLog(C, who, sheet, '', action, detail); } catch (e) { /* ไม่ให้บันทึกประวัติทำงานหลักล้ม */ } }

const sysLog = (C, who, action, detail) => sysLogTo(C, who, 'ระบบ', action, detail);

const actGroupOf = sheet => ACT_GROUPS.filter(g => g.sheets.indexOf(sheet) >= 0)[0] || { key: 'other', label: 'อื่น ๆ' };

export { maintenanceChecks, appendLog, sysLogTo, sysLog, actGroupOf };
