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
const { normalizeCategory } = require('../../../utils/normalization');
const { levenshtein } = require('../utils/levenshtein');

// ── Pre-build brand lookup from clauses ──
const BRAND_LOOKUP = new Map();
for (const [clauseId, clause] of Object.entries(CLAUSES)) {
    if (clause.attribute === 'brand') {
        const label = clause.label.toLowerCase();
        BRAND_LOOKUP.set(label, { clauseId, label: clause.label });
        (clause.matches || []).forEach(m => {
            BRAND_LOOKUP.set(m.toLowerCase(), { clauseId, label: clause.label });
        });
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
    'email': 'contact', 'phone': 'contact', 'call': 'contact',
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
    'not', 'no', 'nor', 'so', 'if', 'or', 'and',
    'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
    'some', 'any', 'many', 'much', 'more', 'most', 'other',
    'just', 'also', 'very', 'really', 'please', 'pls', 'plz',
    'ok', 'okay', 'hi', 'hello', 'hey', 'yo', 'sup',
    'yeah', 'yes', 'yep', 'yup', 'nope', 'nah',
    'thanks', 'thank', 'thx', 'ty', 'cool', 'great', 'sure',
    "i'm", "i'd", "i'll", "i've", "let's", "don't", "doesn't",
    "can't", "won't", "shouldn't", "wouldn't", "couldn't"
]);

/**
 * Extract all recognizable entities from text.
 * 
 * @param {string} text - Cleaned, lowercased text (after fuzzy + context resolution)
 * @param {Object} storeContext - Store context with VENDORS, CATEGORIES, ATTRIBUTES
 * @param {Object} idfMap - IDF weights for keywords (from intentRegistry.buildIdfMap())
 * @returns {Object} { entities: Array, residualWords: Array }
 */
function extractEntities(text, storeContext = {}, idfMap = {}) {
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
        for (let size = 3; size >= 1; size--) {
            for (let i = 0; i <= words.length - size; i++) {
                if (consumed.has(i)) continue;
                const phrase = words.slice(i, i + size).join(' ');
                const catId = normalizeCategory(phrase, storeContext.CATEGORIES);
                if (catId) {
                    entities.push({
                        type: 'category',
                        value: phrase,
                        id: catId,
                        source: 'storeContext.CATEGORIES',
                        wordIndices: Array.from({ length: size }, (_, j) => i + j)
                    });
                    for (let j = i; j < i + size; j++) consumed.add(j);
                    break; // Only one category per statement
                }
            }
            if (entities.some(e => e.type === 'category')) break;
        }
    }

    // ── 3. Brand Detection (from CLAUSES) ──
    for (let size = 2; size >= 1; size--) {
        for (let i = 0; i <= words.length - size; i++) {
            if (consumed.has(i)) continue;
            const phrase = words.slice(i, i + size).join(' ');
            const brandMatch = BRAND_LOOKUP.get(phrase);
            if (brandMatch) {
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
    for (let i = 0; i < words.length; i++) {
        if (!consumed.has(i) && !FILLERS.has(words[i]) && words[i].length > 1) {
            residualWords.push(words[i]);
        }
    }

    return { entities, residualWords };
}

module.exports = { extractEntities, ACTION_VERBS, BRAND_LOOKUP };
