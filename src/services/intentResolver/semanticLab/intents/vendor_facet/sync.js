/**
 * VENDOR FACET SYNC SCRIPT
 * Dedicated sync for vendor_facet intent to ensure high-quality variations 
 * of users asking for list of vendors selling a product/category.
 * 
 * Usage: node src/services/intentResolver/semanticLab/intents/vendor_facet/sync.js [runs_to_add]
 */
const fs = require('fs');
const path = require('path');
const SemanticDataService = require('../../utils/SemanticDataService');
const vendorFacetConfig = require('../../../config/intents/vendor_facet');

const INTENT_NAME = 'vendor_facet';
const INTENT_DIR = __dirname;
const BENCH_FILE = path.join(INTENT_DIR, 'bench.json');
const PROMPT_FILE = path.join(INTENT_DIR, 'prompt.txt');

async function syncVendorFacet() {
    const runsToAdd = parseInt(process.argv[2]) || 1;
    const service = new SemanticDataService(BENCH_FILE);

    console.log(`🚀 [VendorFacet] Starting Dedicated Semantic Sync...`);

    const config = {
        type: 'Intent',
        description: vendorFacetConfig.description || 'Listing vendors/stores/sellers that carry a specific product or belong to a category.',
        keywords: [
            ...(vendorFacetConfig.keywords || []),
            ...(vendorFacetConfig.synonyms || [])
        ]
    };

    // Load custom prompt if exists
    if (fs.existsSync(PROMPT_FILE)) {
        config.customPrompt = fs.readFileSync(PROMPT_FILE, 'utf8');
        console.log(`📝 Using custom prompt from prompt.txt`);
    }

    console.log(`📦 Adding ${runsToAdd} runs to vendor_facet...`);
    for (let r = 0; r < runsToAdd; r++) {
        console.log(`  🔄 Run ${r + 1}/${runsToAdd}...`);
        await service.generateVariations(INTENT_NAME, config);

        // Manual run count increment (Social parity with joint_sync)
        if (service.benchData && service.benchData[INTENT_NAME]) {
            if (!service.benchData[INTENT_NAME].metadata) service.benchData[INTENT_NAME].metadata = {};
            service.benchData[INTENT_NAME].metadata.runs = (service.benchData[INTENT_NAME].metadata.runs || 0) + 1;
            service.benchData[INTENT_NAME].metadata.last_updated = new Date().toISOString();
        }

        // Small delay to prevent rate limits
        if (r < runsToAdd - 1) await new Promise(res => setTimeout(res, 2000));
    }

    const stats = service.getStats ? service.getStats(INTENT_NAME) : { count: 'unknown' };
    console.log(`\n✨ Vendor Facet Sync Complete! Total Variations: ${stats.count || 'updated'}`);
}

syncVendorFacet().catch(console.error);
