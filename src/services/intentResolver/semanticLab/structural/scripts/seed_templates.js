/**
 * Seed critical slot templates for manual calibration
 */
const fs = require('fs');
const path = require('path');

const BENCH_FILE = path.join(__dirname, '../data/slot_bench.json');
const LOG_FILE = path.join(__dirname, '../logs/seed.log');

const log = (msg) => {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
    console.log(msg);
};

const SEEDS = {
    "add_to_cart": [
        "add [product] to cart",
        "put [product] in my cart",
        "throw [product] in the basket",
        "add [quantity] [product] to cart",
        "put [quantity] [product] in my bag",
        "add [quantity] [clause] [product] to cart",
        "gimme [quantity] [product] from [vendor]",
        "add [product] from [vendor] to cart",
        "throw [clause] [product] in my cart"
    ],
    "product_search": [
        "show me [product]",
        "find [product]",
        "looking for [product]",
        "show me [clause] [product]",
        "find me some [clause] [product]",
        "show items in [category]",
        "find [product] under [price]",
        "search for [product] from [vendor]",
        "show [clause] [product] in [category]",
        "looking for [product] by [vendor] under [price]"
    ],
    "vendor_products": [
        "products from [vendor]",
        "show items by [vendor]",
        "what does [vendor] sell",
        "browse [vendor] catalog",
        "items from [vendor]",
        "show me [product] by [vendor]",
        "find [product] from [vendor]",
        "items by [vendor] store"
    ],
    "vendor_contact": [
        "how do i contact [vendor]",
        "contact info for [vendor]",
        "reach out to [vendor]",
        "phone number for [vendor]",
        "whatsapp for [vendor]",
        "talk to [vendor]",
        "contact [vendor] about [product]",
        "i want to speak with [vendor]"
    ],
    "vendor_info": [
        "tell me about [vendor]",
        "who is [vendor]",
        "is [vendor] reliable",
        "where is [vendor] located",
        "info on [vendor]",
        "about [vendor] store"
    ],
    "list_vendors": [
        "show all vendors",
        "who sells [product]",
        "list of sellers for [product]",
        "vendors that carry [product]",
        "show me stores with [product]"
    ],
    "product_compare": [
        "compare [product] and [product]",
        "difference between [product] and [product]",
        "[product] vs [product]",
        "how does [product] stack up against [product]",
        "which is better, [product] or [product]",
        "better between [product] and [product]",
        "compare [clause] [product] with [clause] [product]"
    ],
    "check_availability": [
        "is [product] available",
        "do you have [product] in stock",
        "check availability for [product]",
        "is [clause] [product] in stock",
        "have you got any [product] left",
        "can i get [product] from [vendor]"
    ],
    "order_status": [
        "where is my order [order_id]",
        "status of order [order_id]",
        "track [order_id]",
        "is my order [order_id] shipped"
    ],
    "cancel_order": [
        "cancel my order [order_id]",
        "i want to cancel [order_id]",
        "stop shipment [order_id]"
    ]
};

function seed() {
    log('Starting manual seeding...');

    if (!fs.existsSync(BENCH_FILE)) {
        log(`Error: Slot bench not found at ${BENCH_FILE}. Run sync_from_benches.js first.`);
        return;
    }

    const data = JSON.parse(fs.readFileSync(BENCH_FILE, 'utf8'));

    for (const [intentName, templates] of Object.entries(SEEDS)) {
        if (data[intentName]) {
            data[intentName].slot_templates = templates;
            log(`Seeded ${templates.length} templates for ${intentName}`);
        } else {
            // Create the intent if it doesn't exist in the bench? 
            // Better to warn as sync should have created it.
            log(`Warning: Intent ${intentName} not found in bench data`);
        }
    }

    // Special handling for clause intents: each clause should have at least the template "[clause]"
    for (const k in data) {
        if (k.startsWith('clause_')) {
            data[k].slot_templates = ["[clause]"];
            log(`Seeded base template for clause intent: ${k}`);
        }
    }

    fs.writeFileSync(BENCH_FILE, JSON.stringify(data, null, 2));
    log('Seeding complete.');
}

seed();
