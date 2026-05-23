/**
 * Product Tools Module Index
 * Re-exports the refactored, modularized product tools to matching the legacy product.js signature.
 */

const searchTools = require('./tools/searchTool');
const detailsTools = require('./tools/detailsTool');
const compareTools = require('./tools/compareTool');
const facetsTools = require('./tools/facetsTool');
const mediaTools = require('./tools/mediaTool');
const semanticSearchTools = require('./tools/semanticSearchTool');

const productTools = {
    ...searchTools,
    ...detailsTools,
    ...compareTools,
    ...facetsTools,
    ...mediaTools,
    ...semanticSearchTools
};

module.exports = productTools;
