import { API } from './core/registry.js';
import { guardedApi } from './core/database.js';

for (const name of Object.keys(API).filter(k => k.startsWith('stock'))) {
  const fn = API[name], wrapped = guardedApi(fn, 'stock', name === 'stockGet' || name === 'stockNotesGet', name === 'stockGet' || name === 'stockSave');
  API[name] = (C, ...args) => C.guard && C.guard.scope === 'stock' ? fn(C, ...args) : wrapped(C, ...args);
}

for (const name of ['addItem','editItem','deleteItem','createCategory','importBarcodeData','barcodeRestore','confirmBarcodePairs']) API[name] = guardedApi(API[name], 'barcode');

for (const name of ['getInit','getCategoryData']) API[name] = guardedApi(API[name], 'barcode', true);

for (const name of ['addBanner','updateBanner','moveBanner','deleteBanner','saveSound','deleteSound']) API[name] = guardedApi(API[name], 'media');
