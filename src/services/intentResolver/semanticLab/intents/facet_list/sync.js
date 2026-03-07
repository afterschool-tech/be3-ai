/**
 * FACET LIST SYNC SCRIPT
 * Dedicated sync for facet_list intent to ensure high-quality, attribute-specific variations.
 * 
 * Usage: node src/services/intentResolver/semanticLab/intents/facet_list/sync.js [runs_to_add]
 */
const fs = require('fs');
const path = require('path');
const SemanticDataService = require('../../utils/SemanticDataService');
const facetListConfig = require('../../../config/intents/facet_list');

const INTENT_NAME = 'facet_list';
const INTENT_DIR = __dirname;
const BENCH_FILE = path.join(INTENT_DIR, 'bench.json');
const PROMPT_FILE = path.join(INTENT_DIR, 'prompt.txt');

async function syncFacetList() {
    const runsToAdd = parseInt(process.argv[2]) || 1;
    const service = new SemanticDataService(BENCH_FILE);

    console.log(`🚀 [FacetList] Starting Dedicated Semantic Sync...`);

    const config = {
        type: 'Intent',
        description: facetListConfig.description || 'Discovery of product attributes and available options.',
        keywords: [
            ...(facetListConfig.keywords || []),
            ...(facetListConfig.synonyms || [])
        ]
    };

    // Load custom prompt if exists
    if (fs.existsSync(PROMPT_FILE)) {
        config.customPrompt = fs.readFileSync(PROMPT_FILE, 'utf8');
        console.log(`📝 Using custom prompt from prompt.txt`);
    }

    console.log(`📦 Adding ${runsToAdd} runs to facet_list...`);
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
    console.log(`\n✨ Facet List Sync Complete! Total Variations: ${stats.count || 'updated'}`);
}

syncFacetList().catch(console.error);
