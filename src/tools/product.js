/**
 * Product Tools Engine
 * 
 * This file has been refactored. The monolithic codebase was split into:
 * - src/tools/product/tools/*          (Individual tool endpoints)
 * - src/tools/product/services/*       (Core orchestration & integration logic)
 * - src/tools/product/presentation/*   (Formatting & WA UX logic)
 * - src/tools/product/state/*          (Session & context state logic)
 */

module.exports = require('./product/index');
