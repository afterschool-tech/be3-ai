/**
 * PRODUCT DETAILS SYNC SCRIPT
 * Dedicated sync for get_product_details intent.
 * 
 * Usage: node src/services/intentResolver/semanticLab/intents/get_product_details/sync.js [runs_to_add]
 */
const fs = require('fs');
const path = require('path');
const SemanticDataService = require('../../utils/SemanticDataService');
const intentConfig = require('../../../config/intents/get_product_details');

const INTENT_NAME = 'get_product_details';
const INTENT_DIR = __dirname;
const BENCH_FILE = path.join(INTENT_DIR, 'bench.json');
const PROMPT_FILE = path.join(INTENT_DIR, 'prompt.txt');

async function syncProductDetails() {
    const runsToAdd = parseInt(process.argv[2]) || 1;
    const service = new SemanticDataService(BENCH_FILE);

    console.log(`🚀 [ProductDetails] Starting Dedicated Semantic Sync...`);

    const config = {
        type: 'Intent',
        description: intentConfig.description || 'Requesting specific details, specs, or more information about a product.',
        keywords: [
            ...(intentConfig.keywords || []),
            ...(intentConfig.synonyms || [])
        ]
    };

    // Load custom prompt if exists
    if (fs.existsSync(PROMPT_FILE)) {
        config.customPrompt = fs.readFileSync(PROMPT_FILE, 'utf8');
        console.log(`📝 Using custom prompt from prompt.txt`);
    }

    console.log(`📦 Adding ${runsToAdd} runs to get_product_details...`);
    for (let r = 0; r < runsToAdd; r++) {
        console.log(`  🔄 Run ${r + 1}/${runsToAdd}...`);
        await service.generateVariations(INTENT_NAME, config);

        if (service.benchData && service.benchData[INTENT_NAME]) {
            if (!service.benchData[INTENT_NAME].metadata) service.benchData[INTENT_NAME].metadata = {};
            service.benchData[INTENT_NAME].metadata.runs = (service.benchData[INTENT_NAME].metadata.runs || 0) + 1;
            service.benchData[INTENT_NAME].metadata.last_updated = new Date().toISOString();
        }

        if (r < runsToAdd - 1) await new Promise(res => setTimeout(res, 2000));
    }

    console.log(`\n✨ Product Details Sync Complete!`);
}

syncProductDetails().catch(console.error);
