/**
 * Microstate Feature Provider
 * 
 * Central hub for "Atomic" UX features that microstates can subscribe to.
 * Handles dynamic content generation for breadcrumbs, button lists, and paging.
 */

const { logDebug } = require('../../../utils/debugLogger');
const { callBackendAPI } = require('../../../utils/apiClient');
const { processProductList } = require('../../../utils/productUtility');

/**
 * Resolve active features for a microstate and return UI injections.
 * 
 * @param {object} microstate - Active microstate object
 * @param {object} storeContext - Current store context (categories, vendors, etc.)
 * @returns {object} { promptSuffix: string, options: array, controls: object }
 */
async function getFeatureInjections(microstate, storeContext) {
    const features = microstate.features || [];
    const msName = microstate.type || microstate.name || 'unidentified';
    if (features.length > 0) {
        console.log(`[FeatureProvider] 🧬 Applying ${features.length} features to microstate: ${msName}`);
    }
    logDebug('FEATURE_PROVIDER:START', { microstate: msName, featureCount: features.length, features });

    const injections = {
        promptSuffix: '',
        options: [...(microstate.options || [])],
        controls: { ...(microstate.controls || {}), cancel: true } // Cancel is always mandatory
    };

    for (const feature of features) {
        logDebug('FEATURE_PROVIDER:PROCESS_FEATURE', { feature });
        // Feature: show_captured (Breadcrumbs)
        if (feature === 'show_captured' || (typeof feature === 'object' && feature.type === 'show_captured')) {
            console.log(`[FeatureProvider]    ↳ Executing feature: show_captured`);
            const breadcrumbs = getBreadcrumbs(microstate);
            if (breadcrumbs) {
                injections.promptSuffix += `\n\n**Already Captured:**\n${breadcrumbs}`;
            }
        }

        // Feature: suggest_from_store (Dynamic 3-Button Rotation)
        if (typeof feature === 'object' && feature.type === 'suggest_from_store') {
            console.log(`[FeatureProvider]    ↳ Executing feature: suggest_from_store (${feature.datasource})`);
            const datasource = feature.datasource; // 'categories' or 'vendors'
            const limit = feature.limit || 5;
            const offset = microstate.params?._page_offset || 0;

            const items = getItemsFromStore(datasource, storeContext);
            logDebug('FEATURE_PROVIDER:STORE_LOOKUP', { datasource, itemCount: items.length, offset, limit });

            if (items.length > 0) {
                console.log(`[FeatureProvider] 💡 suggest_from_store: Found ${items.length} ${datasource}. Injecting offset ${offset}`);
                const window = items.slice(offset, offset + limit);
                const hasNextPage = items.length > offset + limit;
                logDebug('FEATURE_PROVIDER:WINDOW_BUILD', { windowSize: window.length, hasNextPage });

                // Sync the 5-item window to options for text display (enumerated list)
                injections.options = window;

                // Dynamic Button Allocation (The 3-Button Pattern)
                // Slot 3: Cancel (already in injections.controls)
                // Slot 2: More (if hasNextPage) OR Suggestion #2
                // Slot 1: Suggestion #1
                
                if (hasNextPage) {
                    injections.controls.more = true;
                    // Button slot 1 is usually the "recommendedIndex" in the tool layer
                    injections.controls.recommendedIndex = 0;
                } else {
                    injections.controls.more = false;
                    // If no More button, we can technically have 2 suggestions as buttons
                    // but the microstate.disambiguate tool usually interprets 'options' as buttons.
                    // If we want exactly 2 buttons + Cancel, we ensure only 2 are marked as primary?
                    // Actually, the frontend/transformer usually takes 'options' and 'controls'.
                    // If we only want 2 buttons + Cancel, we should probably signal that.
                    injections.controls.recommendedIndex = 0;
                    if (window.length > 1) {
                        injections.controls.secondaryIndex = 1; // Custom flag for the second slot
                    }
                }
            }
        }

        // Feature: suggest_related_products (Dynamic Product Recommendations)
        if (typeof feature === 'object' && feature.type === 'suggest_related_products') {
            console.log(`[FeatureProvider]    ↳ Executing feature: suggest_related_products`);
            // Pass delta=0 during initial injection to just fetch the current offset/category
            const rec = await getDynamicProductRecommendations(microstate, storeContext, 0);
            if (rec && rec.window && rec.window.length > 0) {
                injections.options = rec.window;
                injections.controls.more = rec.hasMore;
                injections.controls.recommendedIndex = 0;
                injections.promptSuffix += `\n\n*(Suggestions from **${rec.categorySlug}**)*`;
            }
        }
    }

    return injections;
}

/**
 * Advanced AI Feature: Dynamic Product Recommendations
 * Generalized from the product_compare logic. Rotates through active categories
 * and fetches up to 5 products per page.
 */
async function getDynamicProductRecommendations(microstate, storeContext, delta = 0) {
    const ms = microstate || {};
    const params = (ms.params && typeof ms.params === 'object') ? { ...ms.params } : {};

    const currentProducts = Array.isArray(params.products) ? params.products : [];
    const hasFirstProduct = currentProducts.length >= 1;
    const firstProduct = hasFirstProduct ? currentProducts[0] : null;

    // Use a generic param key for storing recommendation state
    const rec = (params._suggest_rec && typeof params._suggest_rec === 'object') ? { ...params._suggest_rec } : {};
    const limit = 5;

    // Currently only supports Phase A: random categories rotation
    if (!hasFirstProduct) {
        const seed = Array.isArray(rec.seedCategories) ? rec.seedCategories : [];
        const idx = Number.isFinite(rec.seedIndex) ? rec.seedIndex : 0;

        let seedCategories = seed;
        if (seedCategories.length === 0) {
            const cats = Object.values(storeContext?.CATEGORIES || {})
                .filter(c => (c?.total_count || 0) > 0 && c?.slug)
                .map(c => c.slug);
            seedCategories = cats.sort(() => Math.random() - 0.5).slice(0, 6);
        }

        let nextIndex = idx;
        let page = Number.isFinite(rec.page) ? rec.page : 1;

        if (delta !== 0) {
            if (delta > 0 && !rec.hasMoreInCurrentCategory) {
                // Next category
                nextIndex = seedCategories.length > 0 ? (idx + 1) % seedCategories.length : 0;
                page = 1;
            } else if (delta < 0 && page === 1) {
                // Previous category
                nextIndex = seedCategories.length > 0 ? (idx - 1 + seedCategories.length) % seedCategories.length : 0;
                page = 1; // Simplification: jump to start of previous category
            } else {
                // Paginate within category
                page = Math.max(1, page + (delta > 0 ? 1 : -1));
            }
        }

        const categorySlug = seedCategories[nextIndex] || pickRandomActiveCategorySlug(storeContext);
        if (!categorySlug) return null;

        const fetched = await fetchProductsForCategory({ categorySlug, page, limit });
        if (!fetched || !Array.isArray(fetched.options) || fetched.options.length === 0) return null;

        rec.phase = 'seed';
        rec.seedCategories = seedCategories;
        rec.seedIndex = nextIndex;
        rec.categorySlug = categorySlug;
        rec.page = page;
        rec.hasMoreInCurrentCategory = fetched.hasNext;

        params._suggest_rec = rec;

        return {
            window: fetched.options,
            hasMore: fetched.hasNext || seedCategories.length > 1,
            categorySlug,
            params
        };
    }

    // Phase B: first product picked → recommend from its category then siblings.
    if (!rec.phase || rec.phase === 'seed') {
        rec.phase = 'by_category';
        rec.baseCategoryId = rec.baseCategoryId || null;
        rec.baseCategorySlug = rec.baseCategorySlug || null;
        rec.siblingSlugs = Array.isArray(rec.siblingSlugs) ? rec.siblingSlugs : [];
        rec.siblingIndex = Number.isFinite(rec.siblingIndex) ? rec.siblingIndex : 0;
        rec.page = Number.isFinite(rec.page) ? rec.page : 1;
    }

    // Determine base category from first product if needed.
    if (!rec.baseCategoryId && firstProduct) {
        try {
            const details = await callBackendAPI(`/products/storefront/products/${firstProduct}`);
            const catIds = details?.data?.product?.metadata?.category_ids || [];
            if (Array.isArray(catIds) && catIds.length > 0) {
                rec.baseCategoryId = catIds[0];
            }
        } catch (_) {}
    }

    if (!rec.baseCategorySlug && rec.baseCategoryId) {
        rec.baseCategorySlug = findCategorySlugById(storeContext, rec.baseCategoryId);
    }

    if (rec.siblingSlugs.length === 0 && rec.baseCategoryId) {
        rec.siblingSlugs = getSiblingCategorySlugs(storeContext, rec.baseCategoryId);
        rec.siblingIndex = 0;
    }

    const traversal = [rec.baseCategorySlug, ...(rec.siblingSlugs || [])].filter(Boolean);
    if (traversal.length === 0) return null;

    // Paging within current category first; if no next page, move to next category.
    let currentCatIndex = Number.isFinite(rec.siblingIndex) ? rec.siblingIndex : 0;
    let currentCatSlug = traversal[Math.min(currentCatIndex, traversal.length - 1)];
    let page = Number.isFinite(rec.page) ? rec.page : 1;

    if (delta >= 0) {
        // Try next page; if exhausted, advance category.
        const probe = await fetchProductsForCategory({ categorySlug: currentCatSlug, page, limit });
        if (probe && probe.hasNext) {
            page = page + 1;
        } else {
            currentCatIndex = (currentCatIndex + 1) % traversal.length;
            currentCatSlug = traversal[currentCatIndex];
            page = 1;
        }
    } else {
        // Prev page; if at start, go to previous category.
        if (page > 1) {
            page = Math.max(1, page - 1);
        } else {
            currentCatIndex = (currentCatIndex - 1 + traversal.length) % traversal.length;
            currentCatSlug = traversal[currentCatIndex];
            page = 1;
        }
    }

    const fetched = await fetchProductsForCategory({ categorySlug: currentCatSlug, page, limit });
    if (!fetched || !Array.isArray(fetched.options) || fetched.options.length === 0) {
        return null;
    }

    rec.siblingIndex = currentCatIndex;
    rec.categorySlug = currentCatSlug;
    rec.page = page;
    params._suggest_rec = rec;

    return {
        window: fetched.options,
        hasMore: fetched.hasNext || traversal.length > 1,
        categorySlug: currentCatSlug,
        params
    };
}

function getSiblingCategorySlugs(storeContext, categoryId) {
    if (!storeContext?.CATEGORIES || !categoryId) return [];
    const catEntry = Object.values(storeContext.CATEGORIES).find(c => c?.id === categoryId);
    if (!catEntry?.parent_id) return [];
    return Object.values(storeContext.CATEGORIES)
        .filter(c => c?.parent_id === catEntry.parent_id && c?.id !== categoryId && c?.slug)
        .map(c => c.slug);
}

function findCategorySlugById(storeContext, categoryId) {
    if (!storeContext?.CATEGORIES || !categoryId) return null;
    const cat = Object.values(storeContext.CATEGORIES).find(c => c?.id === categoryId);
    return cat?.slug || null;
}


async function fetchProductsForCategory({ categorySlug, page = 1, limit = 5 }) {
    if (!categorySlug) return null;

    const searchParams = new URLSearchParams({
        category: String(categorySlug),
        per_page: String(limit),
        page: String(page)
    });

    const result = await callBackendAPI(`/search/products?${searchParams.toString()}`);
    if (!result?.success) return null;

    const rawProducts = result?.data?.products || result?.data?.results || [];
    const products = await processProductList(rawProducts);

    const total = Number(result?.data?.pagination?.total || result?.data?.total || 0);
    const hasNext = Number.isFinite(total) && total > 0
        ? (page * limit) < total
        : (Array.isArray(products) && products.length >= limit);

    const options = (products || [])
        .map(p => {
            const id = p?.id || p?.handle || p?.product_id;
            const label = p?.name || p?.title;
            if (!id || !label) return null;
            return { label: String(label), value: String(id), price: p?.price || p?.price_display || undefined };
        })
        .filter(Boolean);

    return { options, hasNext, products };
}

function pickRandomActiveCategorySlug(storeContext) {
    const cats = Object.values(storeContext?.CATEGORIES || {});
    const active = cats.filter(c => (c?.total_count || 0) > 0 && c?.slug);
    if (active.length === 0) return null;
    return active[Math.floor(Math.random() * active.length)].slug;
}

/**
 * Build human-readable breadcrumbs for already captured parameters.
 */
function getBreadcrumbs(microstate) {
    const params = microstate.params || {};
    const onFulfilled = microstate.contract?.onFulfilled || [];
    
    // Find params that ARE in onFulfilled and ARE already set
    const captured = onFulfilled
        .filter(p => {
            const val = params[p];
            if (val === null || val === undefined) return false;
            if (Array.isArray(val)) return val.length > 0;
            if (typeof val === 'string') return val.trim().length > 0;
            return true;
        })
        .map(p => {
            const label = getParamLabel(p);
            const value = formatParamValue(params[p], params);
            return `- **${label}:** ${value}`;
        });

    return captured.length > 0 ? captured.join('\n') : null;
}

/**
 * Fetch items (label/value pairs) from store context.
 */
function getItemsFromStore(datasource, storeContext) {
    if (datasource === 'categories') {
        return Object.values(storeContext?.CATEGORIES || {})
            .filter(c => (c?.total_count || 0) > 0 && c?.slug)
            .map(c => ({ label: c.label || c.slug, value: c.slug }));
    }
    if (datasource === 'vendors') {
        return Object.values(storeContext?.VENDORS || {})
            .filter(v => (v?.name || v?.business_name) && v?.id)
            .map(v => ({ label: v.business_name || v.name, value: v.id }));
    }
    return [];
}

function getParamLabel(paramName) {
    const labels = {
        'product_name': 'Product',
        'products': 'Products',
        'order_id': 'Order #',
        'quantity': 'Quantity',
        'vendor': 'Vendor',
        'category': 'Category',
        'address': 'Address',
        'payment_method': 'Payment',
        'delivery_type': 'Delivery'
    };
    return labels[paramName] || paramName;
}

function formatParamValue(val, params = {}) {
    const resolveLabel = (v) => {
        if (!v) return v;
        if (params._compare_labels && params._compare_labels[v]) return params._compare_labels[v];
        if (params._suggest_labels && params._suggest_labels[v]) return params._suggest_labels[v];
        if (params._list_labels && params._list_labels[v]) return params._list_labels[v];
        if (params._labels && params._labels[v]) return params._labels[v];
        return v;
    };

    if (Array.isArray(val)) return val.map(resolveLabel).join(', ');
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    return String(resolveLabel(val));
}

module.exports = {
    getFeatureInjections,
    getItemsFromStore,
    getDynamicProductRecommendations
};
