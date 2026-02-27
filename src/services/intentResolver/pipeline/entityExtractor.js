/**
 * Pipeline Stage 4a: Entity Extractor
 * Scans text against known store data to extract typed entities
 * BEFORE intent matching. This is the "what is the user talking about?" layer.
 * 
 * Entity Types:
 *   - vendor:    matched against storeContext.VENDORS
 *   - category:  matched against storeContext.CATEGORIES 
 *   - brand:     matched against CLAUSES (attribute === 'brand')
 *   - action:    matched against IDF-weighted keyword index
 *   - order_id:  regex #\d{3,}
 *   - quantity:  regex after action verbs
 *   - price:     regex under/over $X
 * 
 * Imports: CLAUSES, normalizeCategory, intentRegistry
 * Returns: { entities: [...], cleanedText: string }
 */

const { CLAUSES } = require('../../../context/clauses');
const { normalizeCategory, isOrdinalOrReferencePhrase } = require('../../../utils/normalization');
const { levenshtein } = require('../utils/levenshtein');

// ── Pre-build brand lookup from clauses ──
const BRAND_LOOKUP = new Map();
// ── Pre-build clause lookup for non-brand clauses (affordable, premium, etc.) ──
const CLAUSE_LOOKUP = new Map();
// Generic words that appear in clause labels/matches but shouldn't trigger clause detection
const CLAUSE_EXCLUDE = new Set(['by', 'for', 'the', 'a', 'and', 'of', 'in', 'men', 'ladies',
    'high', 'small', 'color', 'all', 'yes', 'no', 'ok', 'new']);

for (const [clauseId, clause] of Object.entries(CLAUSES)) {
    if (clause.attribute === 'brand') {
        // Brand clauses go into BRAND_LOOKUP
        const label = clause.label.toLowerCase();
        BRAND_LOOKUP.set(label, { clauseId, label: clause.label, attribute: 'brand' });
        (clause.matches || []).forEach(m => {
            BRAND_LOOKUP.set(m.toLowerCase(), { clauseId, label: clause.label, attribute: 'brand' });
        });
    } else {
        // Non-brand clauses go into CLAUSE_LOOKUP
        const allWords = [clause.label, ...(clause.matches || [])];
        // Also include display prefix/suffix words (e.g., "cheap", "expensive")
        if (clause.display?.prefix) allWords.push(clause.display.prefix);
        if (clause.display?.suffix) allWords.push(clause.display.suffix);

        for (const word of allWords) {
            const w = word.toLowerCase().trim();
            if (w.length > 1 && !CLAUSE_EXCLUDE.has(w)) {
                CLAUSE_LOOKUP.set(w, {
                    clauseId,
                    label: clause.label,
                    attribute: clause.attribute,
                    word: w
                });
            }
        }
    }
}

// ── Action verb patterns (not intent-specific — these are universal action signals) ──
// Each verb maps to a SPECIFIC action category that feeds into ACTION_TO_INTENTS.
// Precision > recall: ambiguous words are excluded to prevent false routing.
const ACTION_VERBS = {
    // Purchase signals (user wants to acquire something)
    'buy': 'purchase', 'purchase': 'purchase', 'grab': 'purchase', 'cop': 'purchase',
    // Cart ADD specifically
    'add': 'cart_add',
    // Cart VIEW specifically
    'cart': 'cart_view', 'basket': 'cart_view', 'bag': 'cart_view',
    // Cart REMOVE specifically
    'remove': 'cart_remove', 'delete': 'cart_remove',
    // Cart UPDATE specifically
    'update': 'cart_update', 'change': 'cart_update', 'bump': 'cart_update',
    'modify': 'cart_update', 'adjust': 'cart_update', 'set': 'cart_update',
    // Discovery actions
    'show': 'discovery', 'find': 'discovery', 'search': 'discovery', 'browse': 'discovery',
    'explore': 'discovery', 'discover': 'discovery', 'look': 'discovery', 'view': 'discovery',
    'products': 'discovery',
    // Contact/communication actions
    'contact': 'contact', 'message': 'contact', 'reach': 'contact', 'talk': 'contact', 'whatsapp': 'contact',
    'email': 'contact', 'call': 'contact',
    // Tracking actions
    'track': 'tracking', 'tracking': 'tracking', 'status': 'tracking',
    // Checkout
    'checkout': 'checkout', 'pay': 'checkout', 'payment': 'checkout',
    // Information
    'about': 'info', 'details': 'info', 'info': 'info', 'information': 'info',
    // Help
    'help': 'help', 'assist': 'help', 'support': 'help', 'guide': 'help',
    // Conversation
    'bye': 'end', 'goodbye': 'end', 'done': 'end',
    // Comparison
    'compare': 'compare', 'versus': 'compare', 'vs': 'compare', 'difference': 'compare',
    // Feedback
    'feedback': 'feedback', 'complaint': 'feedback', 'review': 'feedback', 'rate': 'feedback',
    // Advice
    'recommend': 'advice', 'suggest': 'advice', 'advice': 'advice',
    // Listing
    'list': 'list',
    // Availability
    'available': 'availability', 'stock': 'availability',
    // Confirmation
    'confirm': 'confirm', 'proceed': 'confirm',
    // Cancellation
    'cancel': 'cancel',
    // Delivery
    'delivery': 'delivery', 'shipping': 'delivery', 'deliver': 'delivery'
    // NOTE: "order", "all", "yes", "thanks" intentionally EXCLUDED — too ambiguous
};

// ── Filler words to skip during entity scanning ──
const FILLERS = new Set([
    'i', 'me', 'my', 'we', 'us', 'you', 'your', 'the', 'a', 'an',
    'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
    'to', 'of', 'in', 'for', 'on', 'at', 'by', 'with', 'from',
    'this', 'that', 'these', 'those', 'it', 'its',
    'do', 'does', 'did', 'doing',
    'have', 'has', 'had', 'having',
    'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could',
    'not', 'no', 'nor', 'so', 'if', 'or', 'and', 'also',
    'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
    'some', 'any', 'many', 'much', 'more', 'most', 'other',
    'just', 'also', 'very', 'really', 'please', 'pls', 'plz',
    'ok', 'okay', 'hi', 'hello', 'hey', 'yo', 'sup',
    'yeah', 'yes', 'yep', 'yup', 'nope', 'nah',
    'thanks', 'thank', 'thx', 'ty', 'cool', 'great', 'sure',
    'need', 'want', 'show', 'find', 'get', 'give', 'tell', 'look', 'looking', 'about',
    "i'm", "i'd", "i'll", "i've", "let's", "don't", "doesn't",
    "can't", "won't", "shouldn't", "wouldn't", "couldn't"
]);

/**
 * Extract all recognizable entities from text.
 * 
 * @param {string} text - Cleaned, lowercased text (after fuzzy + context resolution)
 * @param {Object} storeContext - Store context with VENDORS, CATEGORIES, ATTRIBUTES
 * @param {Object} idfMap - IDF weights for keywords (from intentRegistry.buildIdfMap())
 * @param {Object} [positionTracker] - Optional. If provided, populated with { words, entities, residuals } for [TEST] analysis.
 * @returns {Object} { entities: Array, residualWords: Array }
 */
function extractEntities(text, storeContext = {}, idfMap = {}, positionTracker = null) {
    const entities = [];
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const consumed = new Set(); // Track consumed word indices

    // ── 1. Vendor Detection (N-gram, longest match first) ──
    if (storeContext.VENDORS) {
        const vendorNames = [];
        for (const v of Object.values(storeContext.VENDORS)) {
            vendorNames.push({
                name: v.business_name.toLowerCase(),
                id: v.id,
                tag: v.tag,
                original: v.business_name
            });
        }

        // Try 4-gram down to 1-gram
        for (let size = 4; size >= 1; size--) {
            for (let i = 0; i <= words.length - size; i++) {
                if (consumed.has(i)) continue;
                const phrase = words.slice(i, i + size).join(' ');

                // Exact match
                let match = vendorNames.find(v => v.name === phrase || v.tag?.toLowerCase() === phrase);

                // Fuzzy match (Levenshtein distance ≤ 2 for names > 4 chars)
                if (!match && phrase.length > 4) {
                    match = vendorNames.find(v => {
                        const dist = levenshtein(phrase, v.name);
                        return dist <= 2 && dist < phrase.length * 0.4;
                    });
                }

                if (match) {
                    entities.push({
                        type: 'vendor',
                        value: match.original,
                        id: match.id,
                        source: 'storeContext.VENDORS',
                        wordIndices: Array.from({ length: size }, (_, j) => i + j)
                    });
                    for (let j = i; j < i + size; j++) consumed.add(j);
                    break; // Only one vendor per query
                }
            }
            if (entities.some(e => e.type === 'vendor')) break;
        }
    }

    // ── 2. Category Detection (N-gram, reuses normalizeCategory) ──
    if (storeContext.CATEGORIES) {
        const textLower = text.toLowerCase();
        // Build word position map for accurate context detection
        let currentPos = 0;
        const wordPositions = words.map(w => {
            const pos = textLower.indexOf(w, currentPos);
            currentPos = pos >= 0 ? pos + w.length : currentPos;
            return pos;
        });
        
        for (let size = 3; size >= 1; size--) {
            for (let i = 0; i <= words.length - size; i++) {
                if (consumed.has(i)) continue;
                const phrase = words.slice(i, i + size).join(' ');
                const phraseStartIndex = wordPositions[i] >= 0 ? wordPositions[i] : -1;
                if (isOrdinalOrReferencePhrase(phrase, textLower, phraseStartIndex)) continue;
                const catId = normalizeCategory(phrase, storeContext.CATEGORIES, false, { debug: true, topK: 5 });
                if (catId) {
                    entities.push({
                        type: 'category',
                        value: phrase,
                        id: catId,
                        source: 'storeContext.CATEGORIES',
                        wordIndices: Array.from({ length: size }, (_, j) => i + j)
                    });

                    // Consume all category words
                    for (let j = i; j < i + size; j++) consumed.add(j);
                    break; // Only one category per statement
                }
            }
            if (entities.some(e => e.type === 'category')) break;
        }

        // ── 2b. Vendor-Category Prioritization ──
        // If vendor detected AND vendor has a categories list, bias toward those categories
        const detectedVendor = entities.find(e => e.type === 'vendor');
        if (detectedVendor && storeContext.VENDORS) {
            const vendorObj = Object.values(storeContext.VENDORS).find(v => v.id === detectedVendor.id);
            const vendorCats = vendorObj?.categories || [];
            if (vendorCats.length > 0) {
                const detectedCat = entities.find(e => e.type === 'category');
                if (!detectedCat) {
                    // No category detected yet — try to infer from vendor's categories
                    const firstCat = Object.values(storeContext.CATEGORIES).find(c => vendorCats.includes(c.id));
                    if (firstCat) {
                        logDebug('ENTITY:VENDOR_CAT_INFER', {
                            _desc: 'Entity vendor-category inference — infer category from vendor',
                            _example: 'Dareymi vendor → inferred category from vendor list',
                            vendor: vendorObj.business_name,
                            inferred: firstCat.label,
                            reason: 'No category detected, using vendor category list'
                        });
                        // Don't auto-inject — just log for now. The vendor's presence is enough context.
                    }
                }
            }
        }
    }

    // ── 3. Brand Detection (with Category Scoping) ──
    // Identify supported attributes for the detected category (if any)
    const detectedCategory = entities.find(e => e.type === 'category');
    const categoryId = detectedCategory?.id;
    const supportedAttributes = new Set();
    if (categoryId && storeContext.CATEGORIES) {
        // Find category object by ID (it's keyed by slug/label)
        const catObj = Object.values(storeContext.CATEGORIES).find(c => c.id === categoryId);
        if (catObj) {
            (catObj.attributes || []).forEach(a => supportedAttributes.add(a));
        }
    }

    for (let size = 2; size >= 1; size--) {
        for (let i = 0; i <= words.length - size; i++) {
            if (consumed.has(i)) continue;
            const phrase = words.slice(i, i + size).join(' ');
            const brandMatch = BRAND_LOOKUP.get(phrase);

            if (brandMatch) {
                // Scoping Rule: If category is known, only allow supported attributes
                if (categoryId && !supportedAttributes.has(brandMatch.attribute)) {
                    continue;
                }

                entities.push({
                    type: 'brand',
                    value: brandMatch.label,
                    clauseId: brandMatch.clauseId,
                    source: 'CLAUSES',
                    wordIndices: Array.from({ length: size }, (_, j) => i + j)
                });
                for (let j = i; j < i + size; j++) consumed.add(j);
            }
        }
    }

    // ── 3b. Clause Detection (non-brand: with Category Scoping) ──
    // Resolves diverse user words ("cheap", "budget", "inexpensive") to their
    // generic clause type ("affordable"), enabling [clause] slot matching.
    for (let i = 0; i < words.length; i++) {
        if (consumed.has(i)) continue;
        const clauseMatch = CLAUSE_LOOKUP.get(words[i]);
        if (clauseMatch) {
            // Scoping Rule: If category is known, only allow supported attributes
            if (categoryId && !supportedAttributes.has(clauseMatch.attribute)) {
                continue;
            }

            entities.push({
                type: 'clause',
                value: clauseMatch.word,
                clauseId: clauseMatch.clauseId,
                clauseLabel: clauseMatch.label,
                attribute: clauseMatch.attribute,
                source: 'CLAUSES',
                wordIndices: [i]
            });
            consumed.add(i);
        }
    }

    // ── 4. Order ID Detection (regex) ──
    const orderMatch = text.match(/(?:#|order\s*[-#]?|ord[-#])\s*(\d{3,})/i);
    if (orderMatch) {
        entities.push({
            type: 'order_id',
            value: orderMatch[1],
            source: 'regex',
            wordIndices: []
        });
    }

    // ── 5. Price Detection (regex) ──
    const priceMaxMatch = text.match(/(?:under|below|less than|max|cheaper than|budget)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
    if (priceMaxMatch) {
        entities.push({
            type: 'price_max',
            value: parseFloat(priceMaxMatch[1]),
            source: 'regex',
            wordIndices: []
        });
    }
    const priceMinMatch = text.match(/(?:over|above|more than|min|at least)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
    if (priceMinMatch) {
        entities.push({
            type: 'price_min',
            value: parseFloat(priceMinMatch[1]),
            source: 'regex',
            wordIndices: []
        });
    }

    // ── 6. Quantity Detection (regex) ──
    const qtyMatch = text.match(/\b(?:add|buy|get|order|want|need|grab|purchase)\s+(\d+)\b/i);
    if (qtyMatch) {
        const qty = parseInt(qtyMatch[1]);
        if (qty > 0 && qty <= 100) {
            entities.push({
                type: 'quantity',
                value: qty,
                source: 'regex',
                wordIndices: []
            });
        }
    }

    // ── 7. Action Verb Detection (with IDF weights) ──
    for (let i = 0; i < words.length; i++) {
        if (consumed.has(i)) continue;
        const word = words[i];
        if (FILLERS.has(word)) continue;

        const actionCategory = ACTION_VERBS[word];
        if (actionCategory) {
            entities.push({
                type: 'action',
                verb: word,
                category: actionCategory,
                idf: idfMap[word] || 1.0,
                source: 'ACTION_VERBS',
                wordIndices: [i]
            });
            consumed.add(i);
        }
    }

    // ── 8. Residual Words (unconsumed, non-filler = potential product names) ──
    const residualWords = [];
    const residualWithIndices = [];
    for (let i = 0; i < words.length; i++) {
        if (!consumed.has(i) && !FILLERS.has(words[i]) && words[i].length > 1) {
            residualWords.push(words[i]);
            residualWithIndices.push({ word: words[i], wordIndex: i });
        }
    }

    if (positionTracker && typeof positionTracker === 'object') {
        positionTracker.words = [...words];
        positionTracker.entities = entities.map(e => ({
            type: e.type,
            value: e.value || e.verb,
            wordIndices: e.wordIndices || []
        }));
        positionTracker.residuals = [...residualWithIndices];
    }

    return { entities, residualWords };
}

module.exports = { extractEntities, ACTION_VERBS, BRAND_LOOKUP };
