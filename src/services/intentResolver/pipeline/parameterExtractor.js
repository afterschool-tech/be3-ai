/**
 * Pipeline Stage 5: Parameter Extractor
 * Hybrid extraction: deterministic regex first, AI for the rest.
 * 
 * Imports: intentRegistry from config
 * Inline data: NONE
 */

const intentRegistry = require('../config/intentRegistry');
const { CLAUSES } = require('../../../context/clauses');
// NOTE: StructuralMatcher (compiled_index.json) and Clause Discovery (performClauseStripping) have been deprecated.
// Clause/brand extraction is now handled EXCLUSIVELY by the Global Pre-pass (Stage 3).
// Stage 5 now acts as a secondary validator and primitive extractor.

/**
 * Deterministic extraction patterns.
 * Returns what it can extract without AI.
 */
function extractDeterministic(text, candidates = [], storeContext = {}, resolutions = [], categoryId = null, entities = []) {
    const extracted = {};

    // Identify supported attributes for scoping
    const supportedAttributes = new Set();
    if (categoryId && storeContext.CATEGORIES) {
        const catObj = Object.values(storeContext.CATEGORIES).find(c => c.id === categoryId);
        if (catObj) {
            (catObj.attributes || []).forEach(a => supportedAttributes.add(a));
        }
    }

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
    const excludeSet = new Set([
        'show', 'me', 'i', 'need', 'want', 'give', 'list', 'lists', 'under', 'below', 'for', 'the', 'a', 'an', 'any', 'some',
        'compare', 'comparison', 'difference', 'between', 'versus', 'vs', 'v/s',
        'and', 'with', 'by', 'at', 'on', 'of', 'in',
        'but', 'still', 'like', 'also', 'just', 'very', 'really',
        'what', 'is', 'it', 'tell', 'about', 'those', 'these', 'this', 'that', 'its',
        'yes', 'no', 'ok', 'okay', 'cool', 'thanks', 'thank', 'please', 'hi', 'hello', 'hey', 'ya', 'yeah', 'yup', 'nope', "i'm",
        'to', 'my', 'your', 'get', 'based', 'own', 'which', 'one', 'two',
        'can', 'you', 'could', 'would', 'will', 'shall', 'should', 'may', 'might',
        'so', "i'll", 'ill', 'do', 'does', 'did', 'doing',
        'have', 'has', 'had', 'having',
        'advice', 'advise', 'recommend', 'recommendation', 'suggest', 'suggestion', 'guidance', 'help',
        'product', 'products', 'item', 'items', 'gadget', 'gadgets',
        // Action verbs that should never be product names
        'looking', 'look', 'find', 'search', 'browse', 'explore', 'discover', 'view', 'see', 'seek',
        'buy', 'purchase', 'order', 'grab', 'add', 'remove', 'delete', 'update', 'change', 'modify'
    ]);

    // Add deterministic parameter values to excludeSet to prevent them leaking into product_name
    if (extracted.quantity) excludeSet.add(extracted.quantity.toString());
    if (extracted.order_id) excludeSet.add(extracted.order_id.toString());
    if (extracted.price_max) excludeSet.add(extracted.price_max.toString());
    if (extracted.price_min) excludeSet.add(extracted.price_min.toString());

    if (entities && entities.length > 0) {
        entities.forEach(ent => {
            if (['clause', 'brand', 'category', 'resolved_product'].includes(ent.type) && ent.value) {
                const entWords = String(ent.value).toLowerCase().split(/\s+/);
                entWords.forEach(w => excludeSet.add(w));
            }
        });
    }

    candidates.forEach(c => {
        const intent = intentRegistry.get(c.intentName);
        if (intent) {
            (intent.keywords || []).forEach(k => excludeSet.add(k.toLowerCase()));
            (intent.synonyms || []).forEach(s => excludeSet.add(s.toLowerCase()));
        }
    });

    // 4. Comparison Logic (New!)
    // Only run this if product_compare is the WINNING intent (Top Candidate).
    // This prevents "greedy" splitting from contaminating other intents.
    const isCompare = candidates.length > 0 && candidates[0].intentName === 'product_compare';
    if (isCompare) {
        const products = [];
        let textForRaw = text.toLowerCase();

        // A. Start with any resolved IDs from contextResolver
        if (resolutions.length > 0) {
            resolutions.forEach(res => {
                if (res.productId) {
                    // ContextResolver can emit a comma-separated list for plural references
                    // e.g. "them" → "id1,id2,id3". Split so compare gets a real array.
                    const pid = String(res.productId).trim();
                    if (pid.includes(',')) {
                        pid.split(',')
                            .map(x => x.trim())
                            .filter(Boolean)
                            .forEach(x => products.push(x));
                    } else {
                        products.push(pid);
                    }

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
            .replace(/[;,:.?!]/g, ' | ')
            .replace(/\b(?:compare|comparison|difference between|difference|between|vs|v\/s|versus|with|and|but|to)\b/gi, '|')
            .split('|')
            .map(p => p.trim())
            .filter(p => p.length > 0);

        cleanMessage.forEach(segment => {
            // Extract words, filter out exclusions (don't skip numbers like '12')
            const words = segment.split(/\s+/).filter(w => !excludeSet.has(w) && w.length > 0);
            if (words.length > 0) {
                const rawName = words.join(' ');
                if (rawName.length < 3) return;
                if (excludeSet.has(rawName)) return;
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
    // Only run this if product_search is the WINNING intent (Top Candidate).
    const isSearch = candidates.length > 0 && candidates[0].intentName === 'product_search';
    if (isSearch && storeContext.CATEGORIES) {
        const words = text
            .toLowerCase()
            .split(/\s+/)
            // Trim leading/trailing punctuation so tokens like "$2000" become "2000"
            .map(w => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
            .filter(w => w.length > 0);

        // NOTE: N-Gram Category Scanning has been removed here. We strictly rely on 
        // the protected 'categoryId' passed from Stage 4a (Entity Extractor) which respects consumed words.
        // Pre-detected category words are already added to excludeSet.

        // Product Name Discovery is now strictly a word-exclusion process.
        // We no longer re-strip clauses here as they are already in the excludeSet from Stage 3.
        const productWords = words.filter(w => !excludeSet.has(w) && w.length > 0);
        const productName = productWords.length > 0 ? productWords.join(' ') : undefined;

        if (productName) {
            extracted.product_name = productName;
        }
    }

    return extracted;
}

/**
 * ── Stage 5a: Structural Alignment [DEPRECATED] ──
 * Retired in favor of simpler deterministic and Stage 3 pipeline.
 */

/**
 * ── Stage 5a: Structural Alignment ──
 * Uses positional templates and structural index to extract clean parameters.
 * Implements "Entity Consolidation": if a word in a [clause] slot is not a 
 * valid clause, it is merged into the adjacent [product] slot.
 */
function extractStructural(text, candidates = [], categoryId = null, storeContext = {}) {
    const structuralResult = {};

    // Identify supported attributes for scoping
    const supportedAttributes = new Set();
    if (categoryId && storeContext.CATEGORIES) {
        const catObj = Object.values(storeContext.CATEGORIES).find(c => c.id === categoryId);
        if (catObj) {
            (catObj.attributes || []).forEach(a => supportedAttributes.add(a));
        }
    }

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
                const match = clauseWordToId.get(w);
                if (match && match.clauseId) {
                    foundClauses.push({ word: w, clauseId: match.clauseId });
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
            const { productName, clauses } = performClauseStripping(words, categoryId, supportedAttributes);
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
async function extractParameters(text, candidates, aiQueryFn, storeContext = {}, resolutions = [], entities = []) {
    const schema = buildParameterSchema(candidates);

    // 0. Fill primitive parameters from pre-detected entities (Stage 4a)
    const baseFromEntities = {};
    if (entities && entities.length > 0) {
        entities.forEach(ent => {
            if (ent.type === 'category' && !baseFromEntities.category) baseFromEntities.category = ent.id;
            if (ent.type === 'vendor' && !baseFromEntities.vendor) baseFromEntities.vendor = ent.value;
            if (ent.type === 'brand' && !baseFromEntities.brand) baseFromEntities.brand = ent.value;
            if (ent.type === 'order_id' && !baseFromEntities.order_id) baseFromEntities.order_id = ent.value;
            if (ent.type === 'quantity' && !baseFromEntities.quantity) baseFromEntities.quantity = ent.value;
            if (ent.type === 'price_max' && !baseFromEntities.price_max) baseFromEntities.price_max = ent.value;
            if (ent.type === 'price_min' && !baseFromEntities.price_min) baseFromEntities.price_min = ent.value;

            // Context-resolved products: use the original (un-collapsed) name
            if (ent.type === 'resolved_product' && !baseFromEntities.product_name) {
                baseFromEntities.product_name = ent.value;  // ent.value = original human name
                baseFromEntities._resolved_product_id = ent.productId;
            }

            if (ent.type === 'clause') {
                if (!baseFromEntities.clause_words) baseFromEntities.clause_words = [];
                baseFromEntities.clause_words.push({ word: ent.value, clauseId: ent.clauseId });
            }

            // Shield these pre-detected semantic words from becoming part of the product name fallback
            if (['clause', 'brand', 'category'].includes(ent.type) && ent.value) {
                const entWords = String(ent.value).toLowerCase().split(/\s+/);
                // Note: we can't easily add to excludeSet here because extractDeterministic
                // defines its own internal excludeSet. But we can add them to a global exclusion array
                // if we refactor. For now wait... We just need them stripped in deterministic!
            }
        });
    }

    // 1. Run Deterministic Fallback (Keyword/Category Stripping)
    const categoryId = baseFromEntities.category;
    const deterministic = extractDeterministic(text, candidates, storeContext, resolutions, categoryId, entities);

    // Merge base results (entities + deterministic) with array awareness
    // NOTE: extractStructural has been deprecated (StructuralMatcher retired).
    // ── INTEL SHIELD ──
    // If we have a resolved product (Intel), we prepend any deterministic residuals (e.g. "best") to it.
    // Since we now shield resolved_product words in deterministic extraction, 
    // this correctly builds context-refined names like "best iPhone 16".
    const combinedBase = { ...deterministic, ...baseFromEntities };
    if (baseFromEntities.product_name && deterministic.product_name && baseFromEntities.product_name !== deterministic.product_name) {
        combinedBase.product_name = `${deterministic.product_name} ${baseFromEntities.product_name}`;
    }

    // Identify supported attributes for scoping (used by clause stripping)
    const supportedAttributes = new Set();
    if (categoryId && storeContext.CATEGORIES) {
        const catObj = Object.values(storeContext.CATEGORIES).find(c => c.id === categoryId);
        if (catObj) {
            (catObj.attributes || []).forEach(a => supportedAttributes.add(a));
        }
    }

    // Concatenate arrays instead of clobbering
    if (baseFromEntities.clause_words || deterministic.clause_words) {
        combinedBase.clause_words = [
            ...(baseFromEntities.clause_words || []),
            ...(deterministic.clause_words || [])
        ];
        // Deduplicate clauses by ID
        const seen = new Set();
        combinedBase.clause_words = combinedBase.clause_words.filter(c => {
            if (seen.has(c.clauseId)) return false;
            seen.add(c.clauseId);
            return true;
        });
    }
    if (deterministic.products) {
        combinedBase.products = Array.from(new Set([...(deterministic.products || [])]));
    }

    // NOTE: Multi-pass clause stripping has been removed for better performance and deterministic consistency.
    // Stage 3 (Global Pre-pass) is the source of truth for all semantic clauses.
    if (combinedBase.products && Array.isArray(combinedBase.products) && combinedBase.products.length > 0) {
        combinedBase.product_name = combinedBase.products[0];
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

    // Merge: base (deterministic) takes priority over AI
    const merged = { ...aiExtracted, ...combinedBase };

    // ── SCOPING GUARD ──
    // Cross-reference all extracted clauses/attributes against the category's supported list.
    // Drops any attribute that doesn't belong to this category (Zero-AI consistency).
    if (categoryId && storeContext.CATEGORIES) {
        const catObj = Object.values(storeContext.CATEGORIES).find(c => c.id === categoryId);
        if (catObj) {
            const supported = new Set(catObj.attributes || []);

            // 1. Validate top-level attribute params
            const ATTRIBUTE_PARAMS = ['brand', 'color', 'material', 'storage', 'size', 'price_tier'];
            for (const attrName of ATTRIBUTE_PARAMS) {
                if (merged[attrName] && !supported.has(attrName)) {
                    delete merged[attrName];
                }
            }

            // 2. Validate clause_words
            if (Array.isArray(merged.clause_words)) {
                merged.clause_words = merged.clause_words.filter(cw => {
                    const clause = CLAUSES[cw.clauseId];
                    if (!clause || !clause.attribute) return true; // keep unknown or malformed for tool handling
                    return supported.has(clause.attribute);
                });
            }
        }
    }

    return merged;
}

module.exports = { extractParameters, extractDeterministic, buildParameterSchema, buildExtractionPrompt };
