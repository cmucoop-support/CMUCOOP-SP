import { installProductCatalog } from './modules/catalog.js';
import { API } from './core/registry.js';
import { stmt, all, one, jsonBatches, kvGet, now } from './core/database.js';
import { authPerm } from './modules/auth.js';
import { stockLoadRows, stockCodeKey } from './modules/stock.js';
import { marketRead } from './modules/market.js';

export const productCatalog = installProductCatalog({ API, stmt, all, one, authPerm, stockLoadRows, marketRead, stockCodeKey, jsonBatches, kvGet, now });

// Exclude reads and unrelated media saves. A failed projection never changes a
// successful source save into a misleading failure that invites duplicate saves.
export function isProductSave(fn) {
  return /^(?:addItem|editItem|deleteItem|createCategory|importBarcodeData|barcodeRestore|marketSaveState|expiryCreate|expiryUpdate|expirySetStatus)$/.test(fn)
    || (fn.startsWith('stock') && fn !== 'stockGet');
}
