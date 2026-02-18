/**
 * Pipeline Stage 5: Parameter Extractor
 * Hybrid extraction: deterministic regex first, AI for the rest.
 * 
 * Imports: intentRegistry from config
 * Inline data: NONE
 */

const intentRegistry = require('../config/intentRegistry');
const { normalizeCategory } = require('../../../utils/normalization');

/**
 * Deterministic extraction patterns.
 * Returns what it can extract without AI.
 */
function extractDeterministic(text, candidates = [], storeContext = {}, resolutions = []) {
    const extracted = {};

    // 1. Quantity detection
    const qtyMatch = text.match(/\b(?:add|buy|get|order|want|need|grab|purchase)\s+(\d+)\b/i);
    if (qtyMatch) {
        const qty = parseInt(qtyMatch[1]);
        if (qty > 0 && qty <= 100) {
            extracted.quantity = qty;
        }
    }

    // 2. Order ID detection
    const orderMatch = text.match(/(?:#|order\s*[-#]?|ord[-#])\s*(\d{3,})/i);
    if (orderMatch) {
        extracted.order_id = orderMatch[1];
    }

    // 3. Price detection
    const priceMaxMatch = text.match(/(?:under|below|less than|max|cheaper than|budget)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
    if (priceMaxMatch) {
        extracted.price_max = parseFloat(priceMaxMatch[1]);
    }

    const priceMinMatch = text.match(/(?:over|above|more than|min|at least)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
    if (priceMinMatch) {
        extracted.price_min = parseFloat(priceMinMatch[1]);
    }

    // "cheap" / "budget" → price_max heuristic
    if (/\b(cheap|budget|affordable|inexpensive)\b/i.test(text) && !extracted.price_max) {
        extracted.price_max = 200;
    }

    // --- SHARED EXCLUDE SET FOR CLEANING ---
    const excludeSet = new Set(['show', 'me', 'i', 'need', 'want', 'cheap', 'expensive', 'premium', 'under', 'for', 'the', 'a', 'any', 'some', 'compare', 'difference', 'between', 'versus', 'vs', 'v/s', 'and', 'with', 'what', 'is', 'it', 'tell', 'about', 'of', 'those', 'these', 'yes', 'no', 'ok', 'okay', 'cool', 'thanks', 'thank', 'please', 'hi', 'hello', 'hey', 'ya', 'yeah', 'yup', 'nope', "i'm", 'to']);

    // Add deterministic parameter values to excludeSet to prevent them leaking into product_name
    if (extracted.quantity) excludeSet.add(extracted.quantity.toString());
    if (extracted.order_id) excludeSet.add(extracted.order_id.toString());
    if (extracted.price_max) excludeSet.add(extracted.price_max.toString());
    if (extracted.price_min) excludeSet.add(extracted.price_min.toString());

    candidates.forEach(c => {
        const intent = intentRegistry.get(c.intentName);
        if (intent) {
            (intent.keywords || []).forEach(k => excludeSet.add(k.toLowerCase()));
            (intent.synonyms || []).forEach(s => excludeSet.add(s.toLowerCase()));
        }
    });

    // 4. Comparison Logic (New!)
    const isCompare = candidates.some(c => c.intentName === 'product_compare');
    if (isCompare) {
        const products = [];
        let textForRaw = text.toLowerCase();

        // A. Start with any resolved IDs from contextResolver
        if (resolutions.length > 0) {
            resolutions.forEach(res => {
                if (res.productId) {
                    products.push(res.productId);

                    // Remove ORIGINAL resolved phrase (e.g., "it")
                    const escapedOriginal = (res.original || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    if (escapedOriginal) textForRaw = textForRaw.replace(new RegExp(`\\b${escapedOriginal}\\b`, 'gi'), ' ');

                    // Remove RESOLVED name (e.g., "iphone 17 pro") to prevent double-extraction as raw
                    const escapedResolved = (res.resolved || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    if (escapedResolved) textForRaw = textForRaw.replace(new RegExp(`\\b${escapedResolved}\\b`, 'gi'), ' ');
                }
            });
        }

        // B. Split text by comparison tokens to find raw names
        const cleanMessage = textForRaw
            .replace(/\b(?:compare|difference between|difference|between|vs|v\/s|versus|with|and)\b/gi, '|')
            .split('|')
            .map(p => p.trim())
            .filter(p => p.length > 0);

        cleanMessage.forEach(segment => {
            // Extract words, filter out exclusions (don't skip numbers like '12')
            const words = segment.split(/\s+/).filter(w => !excludeSet.has(w) && w.length > 0);
            if (words.length > 0) {
                const rawName = words.join(' ');
                // Avoid adding duplicates (by name or ID)
                if (!products.includes(rawName)) {
                    products.push(rawName);
                }
            }
        });

        if (products.length > 0) {
            extracted.products = products;
        }
    }

    // 5. Zero-AI Category & Product Name Discovery (Product Search)
    const isSearch = candidates.some(c => c.intentName === 'product_search');
    if (isSearch && storeContext.CATEGORIES) {
        const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        let foundCategoryUUID = null;
        let categoryWords = [];

        // N-Gram Scanning: Try Bigrams (2 words) then Monograms (1 word)
        for (let size = 2; size >= 1; size--) {
            if (foundCategoryUUID) break;
            for (let i = 0; i <= words.length - size; i++) {
                const phrase = words.slice(i, i + size).join(' ');
                const catId = normalizeCategory(phrase, storeContext.CATEGORIES);
                if (catId) {
                    foundCategoryUUID = catId;
                    categoryWords = words.slice(i, i + size);
                    extracted.category = catId;
                    break;
                }
            }
        }

        // Add category words to the exclusion set for product name guessing
        categoryWords.forEach(w => excludeSet.add(w));

        const productWords = words.filter(w => !excludeSet.has(w) && w.length > 0);
        if (productWords.length > 0) {
            extracted.product_name = productWords.join(' ');
        }
    }

    return extracted;
}

/**
 * Build the combined parameter schema for all candidate intents.
 * Used to ask AI: "which of these params have values?"
 */
function buildParameterSchema(candidates) {
    const schema = {};

    for (const candidate of candidates) {
        const intent = intentRegistry.get(candidate.intentName);
        if (!intent) continue;

        for (const [paramName, paramDef] of Object.entries(intent.parameters)) {
            if (!schema[paramName]) {
                schema[paramName] = {
                    ...paramDef,
                    usedBy: [candidate.intentName]
                };
            } else {
                if (!schema[paramName].usedBy.includes(candidate.intentName)) {
                    schema[paramName].usedBy.push(candidate.intentName);
                }
            }
        }
    }

    return schema;
}

/**
 * Build the AI prompt for parameter extraction.
 */
function buildExtractionPrompt(text, schema, excludeWords = []) {
    const paramDescriptions = Object.entries(schema)
        .map(([name, def]) => `- ${name} (${def.type}): ${def.description || 'no description'}`)
        .join('\n');

    const excludeBlock = excludeWords.length > 0
        ? `\nCRITICAL: DO NOT include these phrases in the extracted values (these are intent triggers): ${excludeWords.join(', ')}.`
        : '';

    return [
        {
            role: 'system',
            content: `You are a parameter extraction engine. Given a user message and a list of parameters, extract the values. 
IMPORTANT: Return ONLY the specific entity values (e.g., product names like "iphone", quantities like 2). 
Do NOT return full user sentences or filler text as parameter values unless explicitly requested by the parameter description.${excludeBlock}
Return a JSON object with parameter names as keys. Use null for parameters that have no value. For list types, return arrays. Be precise.`
        },
        {
            role: 'user',
            content: `Extract parameters from this message:\n"${text}"\n\nParameters to extract:\n${paramDescriptions}\n\nReturn JSON only, no explanation.`
        }
    ];
}

/**
 * Main extraction function.
 * Runs deterministic extraction first, then AI for remaining gaps.
 */
async function extractParameters(text, candidates, aiQueryFn, storeContext = {}, resolutions = []) {
    const schema = buildParameterSchema(candidates);
    const deterministic = extractDeterministic(text, candidates, storeContext, resolutions);

    // Check which params still need AI
    const missingParams = {};
    const excludeWordsSet = new Set();

    for (const [name, def] of Object.entries(schema)) {
        if (deterministic[name] === undefined) {
            missingParams[name] = def;
        }
    }

    // Collect trigger words from candidates for the prompt
    for (const candidate of candidates) {
        const intent = intentRegistry.get(candidate.intentName);
        if (intent) {
            (intent.keywords || []).forEach(w => excludeWordsSet.add(w.toLowerCase()));
            (intent.synonyms || []).forEach(w => excludeWordsSet.add(w.toLowerCase()));
        }
    }

    let aiExtracted = {};

    // Only call AI if there are missing parameters
    if (Object.keys(missingParams).length > 0 && aiQueryFn) {
        try {
            const prompt = buildExtractionPrompt(text, missingParams, Array.from(excludeWordsSet));
            const response = await aiQueryFn(prompt, 500, 0.1, 0.9, 'json_object');
            aiExtracted = JSON.parse(response);
        } catch (error) {
            console.error('[ParameterExtractor] AI extraction failed:', error.message);
        }
    }

    // Merge: deterministic takes priority over AI
    const merged = { ...aiExtracted, ...deterministic };

    return merged;
}

module.exports = { extractParameters, extractDeterministic, buildParameterSchema, buildExtractionPrompt };
