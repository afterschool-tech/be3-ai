/**
 * Tag Slots - Automatically tags entities in bench variations to create templates
 * 
 * Logic:
 * 1. Tag actual entities from store context (Vendors, Categories).
 * 2. Tag semantic clauses from CLAUSES context.
 * 3. Tag generic placeholders (e.g. "the vendor", "the item") to generalize templates.
 */
const fs = require('fs');
const path = require('path');
const { CLAUSES } = require('../../../../../context/clauses');
const { VENDORS, CATEGORIES } = require('../../../../../context/storeContext');

const BENCH_FILE = path.join(__dirname, '../data/slot_bench.json');
const LOG_FILE = path.join(__dirname, '../logs/tagging.log');

const log = (msg) => {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
    console.log(msg);
};

// --- DATA PREP ---
const clauseWords = new Set();
if (CLAUSES) {
    for (const clause of Object.values(CLAUSES)) {
        if (!clause) continue;
        [clause.label, ...(clause.matches || []), clause.display?.prefix, clause.display?.suffix]
            .filter(Boolean)
            .forEach(w => clauseWords.add(w.toLowerCase()));
    }
}
// Remove false positives from clause words
['by', 'for', 'the', 'a', 'and', 'of', 'in', 'men', 'ladies', 'gaming', 'high', 'small', 'color'].forEach(w => clauseWords.delete(w));

const vendorWords = new Set();
if (VENDORS) {
    for (const v of Object.values(VENDORS)) {
        if (v.business_name) vendorWords.add(v.business_name.toLowerCase());
        if (v.tag) vendorWords.add(v.tag.toLowerCase());
    }
}

const categoryWords = new Set();
if (CATEGORIES) {
    for (const c of Object.values(CATEGORIES)) {
        if (c.label) categoryWords.add(c.label.toLowerCase());
        if (c.slug) categoryWords.add(c.slug.replace(/-/g, ' ').toLowerCase());
    }
}

// --- GENERIC PLACEHOLDERS ---
const GENERIC_PRODUCT = ['product', 'item', 'stuff', 'thing', 'items', 'products', 'goods'];
const GENERIC_VENDOR = ['vendor', 'seller', 'shop', 'store', 'merchants', 'business', 'business name'];
const GENERIC_CATEGORY = ['category', 'department', 'section', 'collection'];

// --- TAGGING LOGIC ---
function tagVariation(text) {
    let tagged = text.toLowerCase();

    // 1. Tag Clauses
    for (const word of clauseWords) {
        const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
        tagged = tagged.replace(regex, '[clause]');
    }

    // 2. Tag Contextual Vendors (Actual Names)
    // Sort by length descending to match longest phrases first
    const sortedVendors = Array.from(vendorWords).sort((a, b) => b.length - a.length);
    for (const vendor of sortedVendors) {
        if (vendor.length < 3) continue; // Skip too short
        const regex = new RegExp(`\\b${escapeRegex(vendor)}\\b`, 'gi');
        tagged = tagged.replace(regex, '[vendor]');
    }

    // 3. Tag Contextual Categories (Actual Names)
    const sortedCategories = Array.from(categoryWords).sort((a, b) => b.length - a.length);
    for (const category of sortedCategories) {
        if (category.length < 3) continue;
        const regex = new RegExp(`\\b${escapeRegex(category)}\\b`, 'gi');
        tagged = tagged.replace(regex, '[category]');
    }

    // 4. Tag Generic Placeholders (Aggressive Mode)
    // Convert "the vendor", "this seller" -> "[vendor]"
    GENERIC_VENDOR.forEach(v => {
        const regex = new RegExp(`\\b(the|this|that|your|my|a|an)?\\s*${v}\\b`, 'gi');
        tagged = tagged.replace(regex, '[vendor]');
    });

    GENERIC_PRODUCT.forEach(p => {
        // Tag "item", "product" unless it's already part of a slot
        const regex = new RegExp(`\\b(the|this|that|these|those|some|any)?\\s*${p}\\b`, 'gi');
        tagged = tagged.replace(regex, (match) => {
            if (match.includes('[') || match.includes(']')) return match;
            return '[product]';
        });
    });

    GENERIC_CATEGORY.forEach(c => {
        const regex = new RegExp(`\\b(the|this|that|this|all|every)?\\s*${c}\\b`, 'gi');
        tagged = tagged.replace(regex, '[category]');
    });

    // 5. Tag Quantities
    tagged = tagged.replace(/\b\d+\b/g, '[quantity]');
    tagged = tagged.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, '[quantity]');

    // 6. Tag Order IDs
    tagged = tagged.replace(/\b[A-Z0-9]{6,12}\b/g, (match) => {
        if (/^\d+$/.test(match) && match.length < 5) return match;
        return '[order_id]';
    });

    // 7. Cleanup & Consolidation
    // "the [vendor]" -> "[vendor]" (already handled in regex, but being safe)
    tagged = tagged.replace(/\[clause\]\s+\[clause\]/g, '[clause]');
    tagged = tagged.replace(/\[product\]\s+\[product\]/g, '[product]');
    tagged = tagged.replace(/\[vendor\]\s+\[vendor\]/g, '[vendor]');

    // Resolve "the [product]" artifacts
    tagged = tagged.replace(/\b(the|this|that|a|an)\s+\[/gi, '[');

    return tagged;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function process() {
    log('Starting enhanced structural slot tagging...');

    if (!fs.existsSync(BENCH_FILE)) {
        log(`Error: Slot bench not found at ${BENCH_FILE}`);
        return;
    }

    const data = JSON.parse(fs.readFileSync(BENCH_FILE, 'utf8'));
    let totalTagged = 0;

    for (const [intentName, entry] of Object.entries(data)) {
        const templates = new Set(entry.slot_templates || []);
        const originalCount = templates.size;

        for (const variation of entry.variations) {
            const tagged = tagVariation(variation);
            // Only add if it contains at least one slot tag
            if (tagged.includes('[') && tagged.includes(']')) {
                templates.add(tagged);
            } else {
                // If it's a clause intent and untagged, it should probably be [clause]
                if (intentName.startsWith('clause_')) {
                    templates.add('[clause]');
                }
            }
        }

        entry.slot_templates = Array.from(templates);
        const added = entry.slot_templates.length - originalCount;
        totalTagged += added;
        log(`Intent ${intentName}: Added ${added} new templates (Total: ${entry.slot_templates.length})`);
    }

    fs.writeFileSync(BENCH_FILE, JSON.stringify(data, null, 2));
    log(`Tagging complete. Total new templates added: ${totalTagged}`);
}

process();
