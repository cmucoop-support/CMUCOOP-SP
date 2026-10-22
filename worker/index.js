// Stable entry point for deployment and integration tests.
export * from './src/core/config.js';
export * from './src/core/schema.js';
export * from './src/core/response.js';
export * from './src/core/registry.js';
export * from './src/core/database.js';
export * from './src/core/logging.js';
export * from './src/modules/auth.js';
export * from './src/modules/portal.js';
export * from './src/modules/media.js';
export * from './src/modules/music.js';
export * from './src/modules/barcode.js';
export * from './src/modules/tv.js';
export * from './src/modules/stock.js';
export * from './src/modules/market.js';
export * from './src/modules/expiry.js';
import './src/guards.js';
export { default } from './src/core/http.js';
