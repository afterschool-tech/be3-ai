/**
 * Pipeline Stage 5: Parameter Extractor
 * Hybrid extraction: deterministic regex first, AI for the rest.
 * 
 * Imports: intentRegistry from config
 * Inline data: NONE
 */

const intentRegistry = require('../config/intentRegistry');
const { normalizeCategory } = require('../../../utils/normalization');
const { CLAUSES } = require('../../../context/clauses');
const structuralMatcher = require('../semanticLab/structural/utils/StructuralMatcher');

// ── Build a flat lookup of all clause trigger words (deterministic, no AI) ──
const clauseWordSet = new Set();
const clauseWordToId = new Map();
for (const [clauseId, clause] of Object.entries(CLAUSES)) {
    // Add the clause label words (e.g., "affordable" → "affordable")
    const labelWords = clause.label.toLowerCase().split(/\s+/);
    labelWords.forEach(w => { clauseWordSet.add(w); clauseWordToId.set(w, clauseId); });
    // Add the matches keywords (e.g., "budget", "midrange")
    (clause.matches || []).forEach(m => {
        const mLower = m.toLowerCase();
        clauseWordSet.add(mLower);
        clauseWordToId.set(mLower, clauseId);
    });
    // Add display prefix/suffix words (e.g., "cheap", "expensive")
    const displayWords = `${clause.display?.prefix || ''} ${clause.display?.suffix || ''}`.toLowerCase().split(/\s+/).filter(Boolean);
    displayWords.forEach(w => { clauseWordSet.add(w); clauseWordToId.set(w, clauseId); });
}
// Remove overly generic words that would cause false positives
['by', 'for', 'the', 'a', 'and', 'of', 'in', 'men', 'ladies', 'gaming', 'high', 'small', 'color'].forEach(w => {
    clauseWordSet.delete(w);
    clauseWordToId.delete(w);
});

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
    // NOTE: clause-like words (cheap, expensive, premium, budget, affordable) are intentionally
    // excluded from this set — they are handled by clause-aware stripping in Section 5.
    const excludeSet = new Set(['show', 'me', 'i', 'need', 'want', 'under', 'for', 'the', 'a', 'an', 'any', 'some', 'compare', 'difference', 'between', 'versus', 'vs', 'v/s', 'and', 'with', 'what', 'is', 'it', 'tell', 'about', 'by', 'those', 'these', 'this', 'that', 'yes', 'no', 'ok', 'okay', 'cool', 'thanks', 'thank', 'please', 'hi', 'hello', 'hey', 'ya', 'yeah', 'yup', 'nope', "i'm", 'to', 'its', 'my', 'your']);

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
        const { productName, clauses } = performClauseStripping(productWords);

        if (productName) {
            extracted.product_name = productName;
        }

        if (clauses.length > 0) {
            extracted.clause_words = clauses;
        }
    }

    return extracted;
}

/**
 * Helper to identify and strip clauses from a list of words.
 */
function performClauseStripping(words) {
    const detectedClauses = [];
    const cleanWords = [];

    for (const word of words) {
        const clauseId = clauseWordToId.get(word.toLowerCase());
        if (clauseId) {
            detectedClauses.push({ word, clauseId });
        } else {
            cleanWords.push(word);
        }
    }

    return {
        productName: cleanWords.length > 0 ? cleanWords.join(' ') : undefined,
        clauses: detectedClauses
    };
}

/**
 * ── Stage 5a: Structural Alignment ──
 * Uses positional templates and structural index to extract clean parameters.
 * Implements "Entity Consolidation": if a word in a [clause] slot is not a 
 * valid clause, it is merged into the adjacent [product] slot.
 */
function extractStructural(text, candidates = []) {
    const structuralResult = {};
    const candidateNames = candidates.map(c => c.intentName);
    const matches = structuralMatcher.findMatches(text, candidateNames);

    if (matches.length === 0) return structuralResult;

    // Pick the best match (already sorted by confidence)
    const best = matches[0];
    if (best.confidence < 0.15) return structuralResult; // Slightly more permissive but still anchored

    const fillers = ['the', 'a', 'an', 'some', 'my', 'your', 'those', 'these', 'this', 'that', 'with', 'to', 'for', 'in', 'at'];
    const cleanGroups = {};

    // 1. Initial cleanup of all groups
    for (const [key, value] of Object.entries(best.groups)) {
        if (!value) continue;
        let clean = value.trim();
        const words = clean.split(/\s+/);
        while (words.length > 0 && fillers.includes(words[0].toLowerCase())) words.shift();
        while (words.length > 0 && fillers.includes(words[words.length - 1].toLowerCase())) words.pop();
        clean = words.join(' ');
        if (clean) cleanGroups[key] = clean;
    }

    // 2. Entity Consolidation & Validation
    // We handle indices 1 to 5 (e.g. product_name, product_name_2, etc.)
    const consolidatedProducts = [];
    const validDetectedClauses = [];

    for (let i = 1; i <= 5; i++) {
        const suffix = i === 1 ? '' : `_${i}`;
        const prodKey = `product_name${suffix}`;
        const clauseKey = `clause_words${suffix}`;

        let productValue = cleanGroups[prodKey];
        const clauseValue = cleanGroups[clauseKey];

        if (clauseValue) {
            const cWords = clauseValue.toLowerCase().split(/\s+/);
            const foundClauses = [];
            let invalidWordFound = false;

            for (const w of cWords) {
                const clauseId = clauseWordToId.get(w);
                if (clauseId) {
                    foundClauses.push({ word: w, clauseId });
                } else {
                    invalidWordFound = true;
                }
            }

            if (foundClauses.length > 0 && !invalidWordFound) {
                // It's a genuine clause slot
                validDetectedClauses.push(...foundClauses);
            } else if (productValue) {
                // Invalid or partial clause - consolidate into product name
                productValue = `${clauseValue} ${productValue}`;
            } else if (!productValue) {
                // No product name to merge into? Use original if it's not a filler
                productValue = clauseValue;
            }
        }

        if (productValue) {
            consolidatedProducts.push(productValue);
            if (i === 1) structuralResult.product_name = productValue;
        }
    }

    if (consolidatedProducts.length > 0) {
        structuralResult.products = consolidatedProducts;
    }
    if (validDetectedClauses.length > 0) {
        structuralResult.clause_words = validDetectedClauses;
    }

    // 3. Other fields (quantity, vendor, etc.)
    if (cleanGroups.quantity) {
        const qty = parseInt(cleanGroups.quantity);
        if (!isNaN(qty)) structuralResult.quantity = qty;
    }
    if (cleanGroups.vendor) structuralResult.vendor = cleanGroups.vendor;
    if (cleanGroups.category) structuralResult.category = cleanGroups.category;
    if (cleanGroups.price_max) structuralResult.price_max = parseFloat(cleanGroups.price_max);

    structuralResult._structuralTemplate = best.template;
    structuralResult._structuralConfidence = best.confidence;

    // 4. Final Polish: Run clause stripping on consolidated products 
    // to handle mis-aligned structural matches (e.g. "blue headset" as product)
    if (structuralResult.products) {
        const secondaryClauses = [];
        const polishedProducts = structuralResult.products.map(p => {
            const words = p.split(/\s+/);
            const { productName, clauses } = performClauseStripping(words);
            if (clauses.length > 0) secondaryClauses.push(...clauses);
            return productName;
        }).filter(Boolean);

        if (polishedProducts.length > 0) {
            structuralResult.products = polishedProducts;
            structuralResult.product_name = polishedProducts[0];
        }

        if (secondaryClauses.length > 0) {
            if (!structuralResult.clause_words) structuralResult.clause_words = [];
            structuralResult.clause_words.push(...secondaryClauses);
            // Deduplicate clauses by ID
            const seen = new Set();
            structuralResult.clause_words = structuralResult.clause_words.filter(c => {
                if (seen.has(c.clauseId)) return false;
                seen.add(c.clauseId);
                return true;
            });
        }
    }

    return structuralResult;
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

    // 1. Run Structural Extraction first (Positional Intuition)
    const structural = extractStructural(text, candidates);

    // 2. Run Deterministic Fallback (Keyword/Category Stripping)
    const deterministic = extractDeterministic(text, candidates, storeContext, resolutions);

    // Merge base results (structural + deterministic) with array awareness
    const combinedBase = { ...deterministic, ...structural };

    // Concatenate arrays instead of clobbering
    if (deterministic.clause_words || structural.clause_words) {
        combinedBase.clause_words = [...(deterministic.clause_words || []), ...(structural.clause_words || [])];
    }
    if (deterministic.products || structural.products) {
        combinedBase.products = Array.from(new Set([...(deterministic.products || []), ...(structural.products || [])]));
    }

    // Check which params still need AI
    const missingParams = {};
    const excludeWordsSet = new Set();
    // ... rest of logic stays same ...
    for (const [name, def] of Object.entries(schema)) {
        if (combinedBase[name] === undefined) {
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

    // Merge: base (deterministic + structural) takes priority over AI
    const merged = { ...aiExtracted, ...combinedBase };

    return merged;
}

module.exports = { extractParameters, extractDeterministic, buildParameterSchema, buildExtractionPrompt };
