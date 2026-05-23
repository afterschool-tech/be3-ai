const stateManager = require('../../../state/stateManager');
const { logDebug } = require('../../../utils/debugLogger');

/**
 * Handles updating all context and state after a successful product search.
 * Includes reference_map, last_search, search_context, and currently_viewing.
 */
async function recordSearchContext({ context, products, query, cat, catId, params, totalCount, productAttrsMap, rawProducts }) {
    if (!context || !context.sessionId || !products || products.length === 0) return;

    const scope = context.microstate_active ? 'microstate' : 'global';

    logDebug('TOOL:REFERENCE_MAP_UPDATE [product.search]', {
        _desc: 'Reference map update — add product aliases (name, handle, vendor) to reference_map',
        _example: 'Product "Rattan 2 Drawers" → keys: rattan_2_drawers, the_drawer, etc.',
        productCount: products.length,
        sessionId: context.sessionId
    });

    await stateManager.updateReferenceMap(context.sessionId, products, { scope });

    const queryForMap = typeof query === 'string' ? query : (query?.query ?? null);
    if (queryForMap) await stateManager.updateUserQueryMap(context.sessionId, queryForMap, products);

    let existingCtx = (await stateManager.getSearchContext(context.sessionId)) || {
        product_ids: [], result_count: 0, product_attributes_map: {}, ttl_messages: 5
    };

    existingCtx.product_ids = products.slice(0, 10).map(p => p.id || p.handle || p.product_id).filter(Boolean);
    existingCtx.result_count = totalCount;
    existingCtx.product_attributes_map = { ...existingCtx.product_attributes_map, ...(productAttrsMap || {}) };

    if (!existingCtx.category_id && catId) {
        existingCtx.category_id = catId;
        if (cat?.label) existingCtx.category = cat.label;
    }

    logDebug('TOOL:SEARCH_CONTEXT_UPDATE [product.search]', {
        _desc: 'Search context update — fill product_ids and product_attributes_map',
        _example: 'product_ids: [uuid1, uuid2], attributes_map: { uuid1: { color: white } }',
        productIdsCount: existingCtx.product_ids.length,
        attributesMapSize: Object.keys(productAttrsMap || {}).length
    });

    await stateManager.setSearchContext(context.sessionId, existingCtx);
    await stateManager.updateLastSearch(context.sessionId, query || (cat?.label ?? 'Search'), params, products, totalCount);

    const firstId = products[0].handle || products[0].id || products[0].product_id;
    await stateManager.setCurrentlyViewing(context.sessionId, firstId);

    // --- AMBIENT CONTEXT: Record active browsing topic ---
    let finalCatId = catId;
    let finalCatLabel = cat?.label;

    // If no explicit category was passed to the tool, infer from results
    if (!finalCatId && rawProducts && rawProducts.length > 0) {
        const firstProduct = rawProducts[0];
        const meta = firstProduct.metadata || {};
        if (Array.isArray(meta.category_ids) && meta.category_ids.length > 0) {
            finalCatId = meta.category_ids[0];
            finalCatLabel = Array.isArray(meta.category_names) ? meta.category_names[0] : null;
        }
    }

    await stateManager.setActiveTopic(context.sessionId, {
        type: "product",
        category_id: finalCatId || null,
        category_label: finalCatLabel || null,
        vendor: params?.tag || params?.attributes?.vendor || null,
        product_id: null,
        product_name: null,
        attributes: params?.attributes || null
    });

    const currentState = await stateManager.getState(context.sessionId);
    await stateManager.updateState(context.sessionId, {
        session: { ...currentState.session, search_refinement_count: (currentState.session?.search_refinement_count || 0) + 1 }
    });
}

module.exports = {
    recordSearchContext
};
