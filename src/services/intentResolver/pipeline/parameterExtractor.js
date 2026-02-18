/**
 * Pipeline Stage 5: Parameter Extractor
 * Hybrid extraction: deterministic regex first, AI for the rest.
 * 
 * Imports: intentRegistry from config
 * Inline data: NONE
 */

const intentRegistry = require('../config/intentRegistry');

/**
 * Deterministic extraction patterns.
 * Returns what it can extract without AI.
 */
function extractDeterministic(text) {
    const extracted = {};

    // Quantity: must follow an action keyword like "add 3", "buy 2", "get 5", "order 10"
    // Does NOT match model numbers like "iphone 6", "galaxy s23", "note 12"
    const qtyMatch = text.match(/\b(?:add|buy|get|order|want|need|grab|purchase)\s+(\d+)\b/i);
    if (qtyMatch) {
        const qty = parseInt(qtyMatch[1]);
        // Sanity: quantities above 100 are likely not quantities
        if (qty > 0 && qty <= 100) {
            extracted.quantity = qty;
        }
    }

    // Order ID: #12345, order 12345, ORD-12345, order-12345
    const orderMatch = text.match(/(?:#|order\s*[-#]?|ord[-#])\s*(\d{3,})/i);
    if (orderMatch) {
        extracted.order_id = orderMatch[1];
    }

    // Price: $123, $45.67, or "under $50" / "below 100" / "cheap" patterns
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
        extracted.price_max = 200; // configurable threshold
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
async function extractParameters(text, candidates, aiQueryFn) {
    const schema = buildParameterSchema(candidates);
    const deterministic = extractDeterministic(text);

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
            // Fallback: return what we have deterministically
        }
    }

    // Merge: deterministic takes priority over AI
    const merged = { ...aiExtracted, ...deterministic };

    // NOTE: Defaults are NOT applied here — they'd inflate scoring.
    // Defaults are applied later in toolMapper, after winner is picked.

    return merged;
}

module.exports = { extractParameters, extractDeterministic, buildParameterSchema, buildExtractionPrompt };
