/**
 * Pipeline Stage 5: Parameter Extractor
 * Hybrid extraction: deterministic regex first, AI for the rest.
 * 
 * Imports: intentRegistry from config
 * Inline data: NONE
 */

const intentRegistry = require('../config/intentRegistry');
const { CLAUSES } = require('../../../context/clauses');
const stateManager = require('../../../state/stateManager');
const { extractProductIntel } = require('../utils/productIntelExtractor');
const { logDebug } = require('../../../utils/debugLogger');
const CATEGORY_ALIASES = require('../../../context/categoryAliases');

// ── Facet Name Rejection Set ──
// Load facet bench to detect when the transformer returns an attribute NAME
// (e.g. "material") as a value instead of a real attribute VALUE (e.g. "gold").
const FACET_BENCH = (() => {
    try { return require('../semanticLab/facets/facet_bench.json'); }
    catch { return {}; }
})();
const FACET_NAME_SET = new Set();
for (const [key, entry] of Object.entries(FACET_BENCH)) {
    FACET_NAME_SET.add(key.toLowerCase());
    if (Array.isArray(entry.variations)) {
        entry.variations.forEach(v => FACET_NAME_SET.add(v.toLowerCase()));
    }
}

/**
 * Deterministic extraction patterns.
 * Returns what it can extract without AI.
 */
function extractDeterministic(text, candidates = [], storeContext = {}, resolutions = [], categoryId = null, entities = [], rawText = null) {
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
        'something', 'similar', 'guess', 'good', 'best',
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

    // 4. Comparison Logic (New!) — POWERED BY PIE
    const isCompare = candidates.length > 0 && candidates[0].intentName === 'product_compare';
    if (isCompare) {
        // Use PIE for intelligent, intel-aware multi-product extraction.
        // IMPORTANT: PIE uses rawText (pre-cleanText, comma-preserved) so it can
        // segment comma-separated product lists (e.g. "iphone 12, iphone 15").
        // The pipeline continues to use the cleaned text — this is intentional.
        const pieResults = extractProductIntel({
            text: rawText || text,
            entities,
            resolutions,
            intentName: 'product_compare',
            excludeSet,
            categoryId
        });

        if (pieResults.length > 0) {
            extracted.product_segments = pieResults.map(p => {
                const seg = {
                    query: p.intel.resolvedId || p.name,
                    category: p.intel.category ? p.intel.category.id : null,
                    attributes: {}
                };

                if (p.intel.clauses && p.intel.clauses.length > 0) {
                    seg.clause_words = p.intel.clauses.map(c => ({ word: c.value, clauseId: c.clauseId }));
                }

                if (p.intel.brand) {
                    seg.attributes.brand = p.intel.brand.value;
                }
                if (p.isResolved) {
                    const rid = p.intel.resolvedId;
                    seg._resolved_product_id = (rid && typeof rid === 'object') ? (rid.resolvedId || rid.id || rid.value) : rid;
                }
                return seg;
            });
            // Legacy fallback for tool mapping compatibility until refactored
            extracted.products = pieResults.map(p => {
                const rid = p.intel.resolvedId;
                return ((rid && typeof rid === 'object') ? (rid.resolvedId || rid.id || rid.value) : rid) || p.name;
            });
        }
    }

    // 5. Product Name Discovery (Product Search) — POWERED BY PIE
    const isSearch = candidates.length > 0 && candidates[0].intentName === 'product_search';
    if (isSearch) {
        const pieResults = extractProductIntel({
            text,
            entities,
            resolutions,
            intentName: 'product_search',
            excludeSet,
            categoryId
        });

        if (pieResults.length > 0 && pieResults[0].name) {
            // ── BARE CATEGORY GUARD ──────────────────────────────────────────────
            // When IntelliSense extracts a product name that is strictly and exactly
            // a known category label or slug (e.g. "laptop", "iphones", "smartphones"),
            // we must NOT use it as product_name / query — doing so runs a keyword
            // search that gives worse coverage than a proper category browse.
            //
            // The category is already set upstream by the entity extractor (STAGE4A),
            // so we simply drop the product_name here and let the category do its job.
            //
            // Rule: exact match only. "laptop" drops. "gaming laptop" keeps.
            // "iphone" drops (it IS the category slug). "iphone 15" keeps.
            const candidateName = pieResults[0].name.toLowerCase().trim();
            const isBareCategory = storeContext?.CATEGORIES && Object.values(storeContext.CATEGORIES).some(cat => {
                const label = (cat.label || '').toLowerCase().trim();
                const slug = (cat.slug || '').toLowerCase().trim();
                const metadataAliases = Array.isArray(cat.aliases) ? cat.aliases.map(a => a.toLowerCase().trim()) : [];
                
                // Also check the global CATEGORY_ALIASES file
                const globalAliases = (CATEGORY_ALIASES && (CATEGORY_ALIASES[cat.id] || CATEGORY_ALIASES[cat.slug] || CATEGORY_ALIASES[cat.label])) || [];
                const allAliases = [...metadataAliases, ...globalAliases.map(a => a.toLowerCase().trim())];
                
                return label === candidateName || slug === candidateName || allAliases.includes(candidateName);
            });

            if (isBareCategory) {
                extracted._blocked_bare_category = true;
                // Category already captured upstream — product_name left unset so the
                // missing_query microstate or category browse takes over naturally.
                logDebug('PARAM:PIE_BARE_CATEGORY_DROPPED', {
                    name: pieResults[0].name,
                    reason: 'Exact category match — using category browse instead of keyword search'
                });
            } else {
                extracted.product_name = pieResults[0].name;
                if (pieResults[0].intel.resolvedId) {
                    const rid = pieResults[0].intel.resolvedId;
                    extracted._resolved_product_id = (rid && typeof rid === 'object') ? (rid.resolvedId || rid.id || rid.value) : rid;
                }
            }
        }
    }

    // 6. Similarity Search (Product Similar) — POWERED BY PIE
    const isSimilar = candidates.length > 0 && candidates[0].intentName === 'product_similar';
    if (isSimilar) {
        const pieResults = extractProductIntel({
            text,
            entities,
            resolutions,
            intentName: 'product_similar',
            excludeSet,
            categoryId
        });

        if (pieResults.length > 0 && pieResults[0].name) {
            extracted.product_name = pieResults[0].name;
            if (pieResults[0].intel.resolvedId) {
                const rid = pieResults[0].intel.resolvedId;
                extracted._resolved_product_id = (rid && typeof rid === 'object') ? (rid.resolvedId || rid.id || rid.value) : rid;
            }
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
async function extractParameters(text, candidates, aiQueryFn, storeContext = {}, resolutions = [], entities = [], rawText = null) {
    const schema = buildParameterSchema(candidates);

    // 0. Fill primitive parameters from pre-detected entities (Stage 4a)
    const baseFromEntities = {};

    // 0a. Ingest resolutions from context layer
    if (resolutions && resolutions.length > 0) {
        resolutions.forEach(res => {
            if (res.productId) {
                if (!baseFromEntities.products) baseFromEntities.products = [];
                baseFromEntities.products.push(res.productId);

                if (!baseFromEntities.product_name) {
                    baseFromEntities.product_name = res.resolved;
                    baseFromEntities._resolved_product_id = res.productId;
                }
            }
        });
    }

    if (entities && entities.length > 0) {
        entities.forEach(ent => {
            if (ent.type === 'category' && !baseFromEntities.category) baseFromEntities.category = ent.id || ent.categoryId || ent.value;
            if (ent.type === 'vendor' && !baseFromEntities.vendor) baseFromEntities.vendor = ent.value;
            if (ent.type === 'brand' && !baseFromEntities.brand) baseFromEntities.brand = ent.value;
            if (ent.type === 'order_id' && !baseFromEntities.order_id) baseFromEntities.order_id = ent.value;
            if (ent.type === 'quantity' && !baseFromEntities.quantity) baseFromEntities.quantity = ent.value;
            if (ent.type === 'price_max' && !baseFromEntities.price_max) baseFromEntities.price_max = ent.value;
            if (ent.type === 'price_min' && !baseFromEntities.price_min) baseFromEntities.price_min = ent.value;

            // Context-resolved products: support multiple for comparison/cart
            if (ent.type === 'resolved_product') {
                if (!baseFromEntities.products) baseFromEntities.products = [];
                if (!baseFromEntities.product_ids) baseFromEntities.product_ids = [];
                
                if (ent.value) baseFromEntities.products.push(ent.value);
                if (ent.productId) baseFromEntities.product_ids.push(ent.productId);

                if (!baseFromEntities.product_name) {
                    baseFromEntities.product_name = ent.value;
                    baseFromEntities._resolved_product_id = ent.productId;
                }
            }

            if (ent.type === 'clause') {
                if (!baseFromEntities.clause_words) baseFromEntities.clause_words = [];
                baseFromEntities.clause_words.push({ word: ent.value, clauseId: ent.clauseId });
            }

            if (ent.type === 'facet_target') {
                baseFromEntities.facet_target = ent.value; // e.g., "storage"
                baseFromEntities.target_facet = ent.attribute; // e.g., "storage" attribute code
            }

            // ── Transformer Attribute Hint Ingestion (Intent-Gated) ──
            // Only ingest transformer attribute hints when the winning intent is NOT
            // a facet intent. For facet intents, the attribute name IS the query target,
            // not a filtering signal.
            if (ent.type === 'transformer_attribute_hint' && ent.subType && ent.value) {
                const isFacetIntent = candidates?.[0]?.intentName === 'facet_list' ||
                                     candidates?.[0]?.intentName === 'vendor_facet';
                const hasFacetTarget = entities.some(e => e.type === 'facet_target' && e.attribute === ent.subType);

                // ── Facet Name Echo Guard ──
                // The transformer's facet detection returns attribute NAMES (e.g. "material")
                // as values when it sees a facet bench keyword in the text. These are NOT
                // real attribute values — they're echoes of the facet name itself.
                // Reject: attribute.material = "material"  (name echo)
                // Accept: attribute.storage  = "256gb"     (real value)
                const valueLower = String(ent.value).toLowerCase().trim();
                const isFacetNameEcho = FACET_NAME_SET.has(valueLower);

                if (!isFacetIntent && !hasFacetTarget && !isFacetNameEcho) {
                    if (!baseFromEntities.attributes) baseFromEntities.attributes = {};
                    const key = ent.subType;
                    if (baseFromEntities.attributes[key] === undefined) {
                        baseFromEntities.attributes[key] = ent.value;
                    }
                } else if (isFacetNameEcho) {
                    logDebug('PARAM:FACET_NAME_ECHO_REJECTED', {
                        _desc: 'Transformer attribute hint rejected — value is a facet name/synonym, not a real attribute value',
                        attribute: ent.subType,
                        rejectedValue: ent.value,
                        reason: 'Value matches facet_bench key or variation'
                    });
                }
            }

            // Shield these pre-detected semantic words from becoming part of the product name fallback
            if (['clause', 'brand', 'category', 'facet_target'].includes(ent.type) && ent.value) {
                const entWords = String(ent.value).toLowerCase().split(/\s+/);
                // Note: we can't easily add to excludeSet here because extractDeterministic
                // defines its own internal excludeSet. But we can add them to a global exclusion array
                // if we refactor. For now wait... We just need them stripped in deterministic!
            }
        });
    }

    // 1. Run Deterministic Fallback (Keyword/Category Stripping)
    const categoryId = baseFromEntities.category;
    const deterministic = extractDeterministic(text, candidates, storeContext, resolutions, categoryId, entities, rawText);

    // Communicate PIE drops to base entities so they don't resurrect dropped names
    if (deterministic._blocked_bare_category) {
        baseFromEntities.product_name = null;
        baseFromEntities._resolved_product_id = null;
        baseFromEntities.products = [];
        delete deterministic._blocked_bare_category;
    }

    // Merge base results (entities + deterministic) with array awareness
    // NOTE: extractStructural has been deprecated (StructuralMatcher retired).
    // Merge base results (entities + deterministic) with array awareness
    const combinedBase = { ...deterministic, ...baseFromEntities };

    // ── INTEL SHIELD ──
    const isCompare = candidates?.[0]?.intentName === 'product_compare';
    if (!isCompare && baseFromEntities.product_name && deterministic.product_name) {
        const resolvedName = baseFromEntities.product_name.toLowerCase();
        const pieWords = deterministic.product_name.split(/\s+/);

        // Deduplicate: Only keep words from PIE that don't already exist in the resolved name
        // This prevents "iphone13 iPhone 13" or "iphone12pro iPhone 12 Pro"
        const cleanPieWords = pieWords.filter(word => {
            const w = word.toLowerCase();
            if (resolvedName.includes(w)) return false;
            // Also check for collapsed overlap (e.g. "iphone12pro" vs "iphone 12 pro")
            const collapsedResolved = resolvedName.replace(/\s+/g, '');
            if (collapsedResolved.includes(w)) return false;
            return true;
        });

        if (cleanPieWords.length > 0) {
            combinedBase.product_name = `${cleanPieWords.join(' ')} ${baseFromEntities.product_name}`;
        } else {
            combinedBase.product_name = baseFromEntities.product_name;
        }
    }

    // ... rest of logic

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

    // Add product segments for comparisons
    if (deterministic.product_segments) {
        combinedBase.product_segments = deterministic.product_segments;
    }

    // NOTE: Multi-pass clause stripping has been removed for better performance and deterministic consistency.
    // Stage 3 (Global Pre-pass) is the source of truth for all semantic clauses.
    if (combinedBase.products && Array.isArray(combinedBase.products) && combinedBase.products.length > 0) {
        combinedBase.product_name = combinedBase.products[0];
    }

    // ── ATTRIBUTE KEY CANONICALIZATION (human → backend code) ──
    // Transformer-injected attributes often come in "human" facet keys (e.g. "storage")
    // but the backend/API expects attribute code keys (e.g. storage.code === "j").
    // We canonicalize params.attributes keys here so downstream tool calls match backend.
    const mapAttrKeyToBackend = (attrKey) => {
        if (!attrKey) return attrKey;
        if (typeof attrKey !== 'string') return attrKey;

        // Composite keys already in backend form (e.g. "p:p") should pass through.
        if (attrKey.includes(':')) return attrKey;

        const attrsCtx = storeContext?.ATTRIBUTES;
        if (!attrsCtx) return attrKey;

        // If already a code key, keep it.
        const isAlreadyCode = Object.values(attrsCtx).some(a => a?.code && a.code === attrKey);
        if (isAlreadyCode) return attrKey;

        // Direct lookup by key (e.g. "storage")
        if (attrsCtx[attrKey]?.code) return attrsCtx[attrKey].code;

        // Normalize spacing to snake_case and try again
        const snakeKey = attrKey.replace(/\s+/g, '_');
        if (attrsCtx[snakeKey]?.code) return attrsCtx[snakeKey].code;

        // Last resort: label match (e.g. "price tier" matches attribute label)
        const labelLower = attrKey.toLowerCase().trim();
        const byLabel = Object.values(attrsCtx).find(a => (a?.label || '').toLowerCase().trim() === labelLower);
        return byLabel?.code || attrKey;
    };

    if (combinedBase.attributes && typeof combinedBase.attributes === 'object' && !Array.isArray(combinedBase.attributes)) {
        const mapped = {};
        for (const [k, v] of Object.entries(combinedBase.attributes)) {
            const backendKey = mapAttrKeyToBackend(k);
            if (mapped[backendKey] === undefined) mapped[backendKey] = v;
        }
        combinedBase.attributes = mapped;
    }

    // ── STRIP DETECTED ATTRIBUTE VALUES FROM PRODUCT NAME ──
    // If IntelliSense/context collapsed a resolved_product like "256gb smartphone",
    // we now also extract "storage=256gb". UX expectation: product_name should
    // be the "base product" without the spec token when an attribute value was found.
    // GATED: Only runs for non-facet intents (facet queries need the words intact).
    const isFacetIntent = candidates?.[0]?.intentName === 'facet_list' ||
                          candidates?.[0]?.intentName === 'vendor_facet';

    const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stripTokenFromText = (text, tokenLower) => {
        if (!text || !tokenLower) return text;
        const escaped = escapeRegex(tokenLower);
        const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'gi');
        return String(text)
            .replace(re, (_m, g1, g2) => `${g1}${g2}`)
            .replace(/\s+/g, ' ')
            .trim();
    };

    if (!isFacetIntent && combinedBase.attributes && typeof combinedBase.attributes === 'object' && combinedBase.product_name) {
        const values = new Set(Object.values(combinedBase.attributes).map(v => String(v || '').toLowerCase().trim()).filter(Boolean));
        const safeTokens = Array.from(values).filter(t => !t.includes(',') && !t.includes(' '));

        if (safeTokens.length > 0) {
            combinedBase.product_name = safeTokens.reduce(
                (acc, t) => stripTokenFromText(acc, t),
                combinedBase.product_name
            );

            if (Array.isArray(combinedBase.products)) {
                combinedBase.products = combinedBase.products.map(p => {
                    if (!p) return p;
                    return safeTokens.reduce((acc, t) => stripTokenFromText(acc, t), p);
                }).filter(Boolean);
            }
        }
    }

    // ── SECOND BARE CATEGORY GUARD (post-strip) ──
    // PIE drops "category label as product" *before* we strip attribute tokens out
    // of product_name/products. For cases like "256gb smartphone", stripping may
    // turn the reconstructed product back into the bare category token (e.g. "smartphone"),
    // so we must re-check AFTER stripping.
    if (!isFacetIntent) {
        const findCategoryMetaById = (catId) => {
            if (!catId || !storeContext?.CATEGORIES) return null;
            return Object.values(storeContext.CATEGORIES).find(c => c?.id && String(c.id) === String(catId)) || null;
        };

        const catMeta = findCategoryMetaById(combinedBase.category);
        if (catMeta && storeContext?.CATEGORIES) {
            const labelLower = String(catMeta.label || '').toLowerCase().trim();
            const slugLower = String(catMeta.slug || '').toLowerCase().trim();

            const isBareCategoryToken = (s) => {
                const t = String(s || '').toLowerCase().trim();
                if (!t) return false;
                if (t === labelLower || t === slugLower) return true;
                // Singular/plural tolerance
                if (labelLower.endsWith('s') && t === labelLower.slice(0, -1)) return true;
                if (slugLower.endsWith('s') && t === slugLower.slice(0, -1)) return true;
                return false;
            };

            const productNameBare = combinedBase.product_name && isBareCategoryToken(combinedBase.product_name);
            const anyProductsBare = Array.isArray(combinedBase.products) && combinedBase.products.some(p => isBareCategoryToken(p));

            if (productNameBare || anyProductsBare) {
                combinedBase.product_name = null;
                combinedBase._resolved_product_id = null;
                combinedBase.products = [];
                logDebug('PARAM:POST_STRIP_BARE_CATEGORY', {
                    _desc: 'Post-strip bare category guard — product_name was just the category after attribute stripping',
                    droppedName: productNameBare ? combinedBase.product_name : null,
                    category: catMeta.label
                });
            }
        }
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
            const response = await aiQueryFn(prompt, 500, 0.1, 2, 'json_object');
            aiExtracted = JSON.parse(response);
        } catch (error) {
            console.error('[ParameterExtractor] AI extraction failed:', error.message);
        }
    }

    // Merge: base (deterministic) takes priority over AI
    const merged = { ...aiExtracted, ...combinedBase };

    // ── SIMILARITY SUPPRESSION GUARD ──
    // If 'similar_to' is present, we MUST NOT have 'product_name'.
    // This ensures product.search tool runs in VECTOR/SIMILAR mode and doesn't
    // fall back to a normal keyword match.
    if (merged.similar_to) {
        delete merged.product_name;
        delete merged._resolved_product_id;
    }

    logDebug('PARAM:EXTRACT_FINAL', {
        products: merged.products,
        product_name: merged.product_name,
        clause_words: merged.clause_words,
        aiExtracted
    });

    // ── SCOPING GUARD (DISABLED) ──
    // We intentionally disable explicit attribute dropping here.
    // The previous logic dropped any attribute (like "color" -> "white") 
    // that wasn't statically declared in the category's supported list.
    // This broke discovery-based filtering (e.g. "show me a white smartphone")
    // since 'color' might not be in the immediate state tree.
    // The backend search module gracefully ignores non-matching params anyway.

    // (applyGuard logic removed)

    return merged;
}

module.exports = { extractParameters, extractDeterministic, buildParameterSchema, buildExtractionPrompt };
