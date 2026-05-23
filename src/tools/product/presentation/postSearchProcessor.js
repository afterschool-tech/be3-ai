const { processProductList } = require('../../../utils/productUtility');
const { recordSearchContext } = require('../state/productContextManager');
const {
    buildProductCards,
    buildFacetRefinerButtons,
    deriveClauseNameFromAttributes,
    pickVendorSeeMoreTitle
} = require('../../../utils/storefrontWhatsAppUx');
const { logDebug } = require('../../../utils/debugLogger');

/**
 * Normalizes raw backend search results into a clean, structured object
 * containing both raw and stripped products, totals, and facets.
 */
async function normalizeSearchResult(rawResult) {
    const rawProducts = Array.isArray(rawResult.products) ? rawResult.products : [];
    const totalCount = rawResult.total ?? rawResult.pagination?.total ?? rawProducts.length;
    const facets = rawResult.facets || {};

    // Strip products for AI consumption
    const products = await processProductList(rawProducts);

    return {
        rawProducts,
        products,
        totalCount,
        facets,
        pagination: rawResult.pagination || null
    };
}

/**
 * Extracts an attributes lookup map (pid -> { colors, specs }) from raw backend products.
 * Essential for facets and comparisons.
 */
function extractProductAttributesMap(rawProducts) {
    const productAttrsMap = {};
    rawProducts.slice(0, 10).forEach(p => {
        const pid = p.id || p.handle || p.product_id;
        if (!pid) return;
        const attrs = { ...(p.attributes || p.metadata?.attributes || {}) };

        // Extract common attributes even if they aren't in metadata.attributes
        const commonAttrs = ['color', 'brand', 'size', 'storage', 'material'];
        commonAttrs.forEach(k => { if (p[k] && !attrs[k]) attrs[k] = p[k]; });

        if (Object.keys(attrs).length > 0) productAttrsMap[pid] = attrs;
    });

    logDebug('TOOL:PRODUCT_ATTRIBUTES_MAP_BUILD [product.search]', {
        _desc: 'Product attributes map build — extract attributes from raw products before stripping',
        productCount: Object.keys(productAttrsMap).length
    });

    return productAttrsMap;
}

/**
 * Builds the WhatsApp UI components (Cards trigger, Pagination, Refiners)
 */
function buildSearchUx(normalizedData, params, snapshotId, cat, isSuggestion = false) {
    const { products, totalCount, facets, pagination } = normalizedData;
    const { limit = 5, page = 1 } = params;

    // Pagination check
    const currentPage = Number(pagination?.page || page);
    const totalPages = Number(pagination?.totalPages || (limit > 0 ? Math.ceil(totalCount / limit) : 1));
    const hasNextPage = currentPage < totalPages;

    const snapshotIdForFilters = Date.now().toString(36);
    let facetButtons = [];
    try {
        if (typeof buildFacetRefinerButtons === 'function') {
            const attributes = params.attributes || {};
            const refiners = buildFacetRefinerButtons({ facets, attributes, snapshotId: snapshotIdForFilters });
            facetButtons = [...(refiners.clauseButtons || []), ...(refiners.valueButtons || [])];
        } else {
            const facetsAttrs = Array.isArray(facets.attributes) ? facets.attributes : [];
            facetsAttrs.slice(0, 2).forEach(attr => {
                (attr.clauses || []).slice(0, 1).forEach(c => {
                    if (c.count > 0) facetButtons.push({ id: `__filter:clause:${snapshotId}:${attr.code}:${encodeURIComponent(c.name)}__`, title: c.label || c.name, priority: 10 });
                });
                (attr.options || []).slice(0, 1).forEach(o => {
                    if (o.count > 0) facetButtons.push({ id: `__filter:value:${snapshotId}:${attr.code}:${encodeURIComponent(String(o.value))}__`, title: String(o.value), priority: 10 });
                });
            });
        }
    } catch (_) { }

    const globalButtons = [];
    if (hasNextPage) {
        let seeMoreTitle = 'See more products';

        function truncateButtonTitle(title, maxLen = 20) {
            const t = String(title || '');
            if (t.length <= maxLen) return t;
            return t.slice(0, Math.max(0, maxLen - 1)) + '…';
        }

        const tagFilter = params.vendorName_for_ui || params.tag || params.attributes?.vendor || null;
        if (tagFilter && typeof pickVendorSeeMoreTitle === 'function') {
            seeMoreTitle = truncateButtonTitle(pickVendorSeeMoreTitle(tagFilter));
        } else {
            const catName = cat?.label || '';
            const clauseWords = params.clause_words || [];
            let userClause = null;
            let systemClause = null;

            if (Array.isArray(clauseWords) && clauseWords.length > 0) {
                userClause = clauseWords[0].word;
                systemClause = clauseWords[0].clauseId;
            } else {
                const attributes = params.attributes || {};
                systemClause = typeof deriveClauseNameFromAttributes === 'function' ? deriveClauseNameFromAttributes(attributes) : null;
                if (systemClause && systemClause.length <= 1) systemClause = null;
            }

            if (isSuggestion) {
                if (userClause && catName) seeMoreTitle = `See more ${userClause} ${catName} suggestions`;
                if ((!seeMoreTitle || seeMoreTitle.length > 45) && (userClause || catName)) {
                    seeMoreTitle = catName ? `See more ${catName} suggestions` : `See more ${userClause} suggestions`;
                }
                if (!seeMoreTitle || seeMoreTitle.length > 45) seeMoreTitle = 'See more suggestions';
            } else {
                if (userClause && catName) seeMoreTitle = `See more ${userClause} ${catName}`;
                else if (userClause) seeMoreTitle = `See more ${userClause}`;
                else if (catName) seeMoreTitle = `See more ${catName}`;
                else seeMoreTitle = 'See more products';

                if (seeMoreTitle.length > 45) {
                    const tier2 = `See more ${systemClause} ${catName}`;
                    if (systemClause && catName && tier2.length <= 45 && systemClause !== userClause) seeMoreTitle = tier2;
                    else if (catName && `See more ${catName}`.length <= 45) seeMoreTitle = `See more ${catName}`;
                    else seeMoreTitle = 'See more products';
                }
            }
            seeMoreTitle = truncateButtonTitle(seeMoreTitle, 45); // Standard search keeps the 45 length logic intact but safe limits it
        }
        globalButtons.push({ id: `__nav:more:${snapshotId}__`, title: seeMoreTitle, priority: 100 });
    }

    if (products.length === 1) {
        const singleId = products[0].id || products[0].handle || products[0].product_id;
        if (singleId) {
            globalButtons.push({ id: `__cart:add:${singleId}__`, title: 'Add to cart', priority: 115 });
        }
    }

    globalButtons.unshift({ id: `__nav:cards:${snapshotId}__`, title: 'Shop these items 🛍️', priority: 110 });
    globalButtons.push(...facetButtons);

    return globalButtons.slice(0, 3);
}

/**
 * Standard composer that combines the atomic utilities to run the full post-search payload.
 * Legacy searches call this to get the exact previous behavior.
 */
async function handleSearchResults(searchResult, params, context, snapshotId, cat, catId, isSuggestion = false) {
    // 1. Normalize
    const normalizedData = await normalizeSearchResult(searchResult);

    // 2. Extract Attributes
    const productAttrsMap = extractProductAttributesMap(normalizedData.rawProducts);

    // 3. State Write
    await recordSearchContext({
        context,
        products: normalizedData.products,
        query: params.query,
        cat,
        catId,
        params,
        totalCount: normalizedData.totalCount,
        productAttrsMap,
        rawProducts: normalizedData.rawProducts
    });

    // 4. Build UX
    const buttons = buildSearchUx(normalizedData, params, snapshotId, cat, isSuggestion);

    // Assemble final output
    return {
        ...searchResult,
        ...(searchResult.results ? { results: searchResult.results.map(p => ({ ...p, suppress_images: true })) } : {}),
        products: normalizedData.products.map(p => ({ ...p, suppress_images: true })),
        total: normalizedData.totalCount,
        whatsapp_product_cards: undefined,
        whatsapp: buttons.length > 0 ? { type: 'button', buttons } : undefined
    };
}

module.exports = {
    normalizeSearchResult,
    extractProductAttributesMap,
    buildSearchUx,
    handleSearchResults
};
