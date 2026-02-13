const { CATEGORIES, VENDORS, ATTRIBUTES, COLLECTIONS } = require('../context/storeContext');

/**
 * Evaluate if the local store context is sufficient to answer the user query
 * without making a backend API call.
 * 
 * @param {string} intent - Pre-classified intent (from Stage 1)
 * @param {Object} params - Extracted intent parameters
 * @param {string} userMessage - Raw user query
 * @returns {Object} { decision: 'sufficient'|'research_needed'|'clarify_needed', data: any, reason: string }
 */

/**
 * Normalize a string to match category keys:
 * - lowercase
 * - replace spaces and special characters with hyphens
 * - remove extra non-alphanumeric chars
 */

async function evaluateContextSufficiency(intent, params, userMessage) {
    const query = userMessage.toLowerCase();
    console.log(`[Eval Debug] Starting evaluation. Intent: ${intent}, Params: ${JSON.stringify(params)}`);

    // 🔹 UNIVERSAL CATEGORY RESOLUTION
    // Covers all known Stage 1 param names
    const identifier =
        params.category ||
        params.product_id ||
        params.product ||
        params.product_name ||
        params.item ||
        null;

    const normalizedIdentifier = normalizeCategoryString(identifier);
    const catKey = normalizedIdentifier ? findCategoryKey(normalizedIdentifier) : null;
    const category = catKey ? CATEGORIES[catKey] : null;

    // Debug helper: show which Stage 1 param resolved the category AND its value
    let resolvedParamName = null;
    let resolvedParamValue = null;

    if (params.category) { resolvedParamName = 'category'; resolvedParamValue = params.category; }
    else if (params.product_id) { resolvedParamName = 'product_id'; resolvedParamValue = params.product_id; }
    else if (params.product) { resolvedParamName = 'product'; resolvedParamValue = params.product; }
    else if (params.product_name) { resolvedParamName = 'product_name'; resolvedParamValue = params.product_name; }
    else if (params.item) { resolvedParamName = 'item'; resolvedParamValue = params.item; }

    console.log(`[Eval Debug] Category resolved via param: ${resolvedParamName} = "${resolvedParamValue}"`);
    console.log(`[Eval Debug] Normalized identifier: "${normalizedIdentifier}", Resolved Key: ${catKey}`);


    console.log("RAW PARAM CATEGORY:", params.category);
    console.log(`[Eval Debug] Identifier: ${identifier}`);
    console.log(`[Eval Debug] Resolved Category Key: ${catKey}`);

    const result = {
        decision: 'research_needed',
        data: null,
        reason: 'Defaulting to API research'
    };

    // 1. RULE: Empty Category Short-circuit (The "Nintendo Switch" Rule)
    if (category) {
        console.log(`[Eval Debug] Category found! Total products for ${catKey}: ${category.total_count}`);
        if ((category.total_count ?? 0) === 0) {
            return {
                decision: 'sufficient',
                data: {
                    type: 'empty_category',
                    category_label: category.label,
                    count: 0,
                    exists: false,
                    suggested_alternatives: (category.children || []).map(c => CATEGORIES[c]?.label).filter(Boolean)
                },
                reason: `Category "${category.label}" is known to be empty in context.`
            };
        }
    }

    // 2. RULE: Existence/Presence/Count Query Short-circuit
    const isCountOrExistence = /do you (have|sell|carry)|is there|got any|any.*available|how many|what'?s the count|quantity/i.test(query);
    if (isCountOrExistence && category) {
        console.log(`[Eval Debug] Triggering existence check for: ${category.label} (Count: ${category.total_count})`);
        return {
            decision: 'sufficient',
            data: {
                type: 'existence_check',
                exists: (category.total_count ?? 0) > 0,
                count: category.total_count ?? 0,
                category_label: category.label,
                subcategories: (category.children || []).map(c => CATEGORIES[c]?.label).filter(Boolean)
            },
            reason: `Count/existence check for "${category.label}" answered from context.`
        };
    }

    // 3. RULE: Hierarchy/Subcategory lookup
    const isHierarchyQuery = /subcategories|children|inside|under|sections|within/i.test(query);
    if (isHierarchyQuery && category) {
        console.log(`[Eval Debug] Triggering hierarchy info for: ${category.label}`);
        return {
            decision: 'sufficient',
            data: {
                type: 'hierarchy_info',
                category_label: category.label,
                subcategories: (category.children || []).map(c => CATEGORIES[c]?.label).filter(Boolean),
                count: category.total_count ?? 0
            },
            reason: `Hierarchy information for "${category.label}" retrieved from context.`
        };
    }

    // 4. RULE: Vendor Info Short-circuit
    if (intent === 'help' && (params.vendor || params.vendor_name || params.product_vendor)) {
        const vName = (params.vendor || params.vendor_name || params.product_vendor).toLowerCase();
        const vendorKey = Object.keys(VENDORS).find(k =>
            VENDORS[k].business_name.toLowerCase().includes(vName) ||
            VENDORS[k].tag.toLowerCase() === vName
        );

        console.log(`[Eval Debug] Vendor lookup for "${vName}" -> Key: ${vendorKey}`);

        if (vendorKey) {
            return {
                decision: 'sufficient',
                data: {
                    type: 'vendor_info',
                    vendor: VENDORS[vendorKey]
                },
                reason: `Vendor "${VENDORS[vendorKey].business_name}" info available in context.`
            };
        }
    }

    // 5. RULE: Metadata Listing
    if (query.includes('what categories') || query.includes('list categories')) {
        return {
            decision: 'sufficient',
            data: {
                type: 'category_list',
                categories: Object.values(CATEGORIES)
                    .filter(c => !c.parent_id)
                    .map(c => c.label)
            },
            reason: 'Top-level category list available in context.'
        };
    }

    console.log(`[Eval Debug] No optimization rules matched. Proceeding to API.`);
    return result;
}

/**
 * Helper to find category key by slug, label, or key
 */

function normalizeCategoryString(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .trim()
        .replace(/&/g, 'and')          // replace & with 'and'
        .replace(/[\s_]+/g, '-')       // spaces/underscores → hyphen
        .replace(/[^a-z0-9-]/g, '');   // remove other special chars
}


function findCategoryKey(identifier) {
    if (!identifier) return null;
    const normalizedId = normalizeCategoryString(identifier);

    // 1. Direct key match
    if (CATEGORIES[normalizedId]) return normalizedId;

    // 2. Fuzzy match with normalized category slugs & labels
    return Object.keys(CATEGORIES).find(k => {
        const cat = CATEGORIES[k];
        if (!cat) return false;
        const keyNorm = normalizeCategoryString(k);
        const slugNorm = normalizeCategoryString(cat.slug);
        const labelNorm = normalizeCategoryString(cat.label);
        return normalizedId === keyNorm || normalizedId === slugNorm || normalizedId === labelNorm;
    }) || null;
}

module.exports = { evaluateContextSufficiency };
