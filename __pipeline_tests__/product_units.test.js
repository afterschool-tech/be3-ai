/**
 * product_units.test.js
 *
 * Unit tests for all logic blocks that will be extracted from product.js
 * during the God-file refactor.
 *
 * HOW IT WORKS:
 *   - All external I/O (Redis, HTTP, Bloom) is mocked at module level.
 *   - Tests import the REAL functions and exercise their logic.
 *   - These tests must pass against the CURRENT product.js BEFORE any
 *     refactoring begins. Re-run after each migration step.
 *
 * RUN: npx jest __pipeline_tests__/product_units.test.js --verbose
 */

// ─── 1. MOCK ALL SIDE-EFFECTFUL MODULES ─────────────────────────────────────
// Must happen before any require() of the modules under test.

jest.mock('../src/state/stateManager', () => ({
    setSearchSnapshot: jest.fn().mockResolvedValue(undefined),
    getSearchSnapshot: jest.fn().mockResolvedValue(null),
    // session field MUST be present — product.js reads currentState.session.search_refinement_count
    getState: jest.fn().mockResolvedValue({
        session: { search_refinement_count: 0 },
        product_context: { last_search: { results: [] } },
        reference_map: {},
        search_context: null,
        user_query_map: {}
    }),
    updateState: jest.fn().mockResolvedValue(undefined),
    updateReferenceMap: jest.fn().mockResolvedValue(undefined),
    updateUserQueryMap: jest.fn().mockResolvedValue(undefined),
    getSearchContext: jest.fn().mockResolvedValue(null),
    setSearchContext: jest.fn().mockResolvedValue(undefined),
    updateLastSearch: jest.fn().mockResolvedValue(undefined),
    setCurrentlyViewing: jest.fn().mockResolvedValue(undefined),
    setActiveTopic: jest.fn().mockResolvedValue(undefined),
    learnFromBehavior: jest.fn().mockResolvedValue(undefined),
    cacheProductImage: jest.fn().mockResolvedValue(undefined),
    setMicrostate: jest.fn().mockResolvedValue(undefined),
    clearMicrostate: jest.fn().mockResolvedValue(undefined),
    // productResolver.js calls resolveReference — return null to skip resolution
    resolveReference: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/utils/apiClient', () => ({
    callBackendAPI: jest.fn().mockResolvedValue({ success: false, data: null }),
    TENANT_ID: 'test-tenant-id',
}));

jest.mock('../src/utils/bloomClient', () => ({
    checkBloom: jest.fn().mockResolvedValue({
        global: { passed: true, source: 'bloom', hits: [], misses: [] },
        categories: {}
    }),
}));

jest.mock('../src/utils/searchInterfaceClient', () => ({
    executeSearch: jest.fn().mockResolvedValue({
        products: [],
        total: 0,
        facets: {},
        classification: 'none',
        stage: 0,
        vector_fallback_needed: true,
        partialFallback: false,
        price_filter_applied: false,
        price_filter_failed: false,
        pagination: { page: 1, perPage: 5, total: 0, totalPages: 0 }
    }),
    buildSearchSpec: jest.requireActual('../src/utils/searchInterfaceClient').buildSearchSpec,
}));

jest.mock('../src/utils/vectorSearchUtility', () => ({
    performVectorSearch: jest.fn().mockResolvedValue(null),
    performSimilarSearch: jest.fn().mockResolvedValue(null),
    performImageSearch: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/utils/debugLogger', () => ({
    logDebug: jest.fn(),
}));

jest.mock('../src/context/storeContext', () => ({
    CATEGORIES: {
        smartphones: {
            id: 'cat-phones',
            slug: 'smartphones',
            label: 'Smartphones',
            parent_id: null,
            total_count: 20,
            attributes: ['vendor', 'storage', 'color'],
        },
        accessories: {
            id: 'cat-accessories',
            slug: 'accessories',
            label: 'Accessories',
            parent_id: 'cat-phones',
            total_count: 5,
            attributes: [],
        }
    },
    VENDORS: {},
    ATTRIBUTES: {
        storage: { id: 'attr-storage', code: 'j', label: 'storage', type: 'text' },
        color: { id: 'attr-color', code: 'c', label: 'color', type: 'text' },
        brand: { id: 'attr-brand', code: 'b', label: 'brand', type: 'select' },
        vendor: { id: 'attr-vendor', code: 'vendor', label: 'vendor', type: 'text' },
    },
}));

// ─── 2. SHARED TEST FIXTURES ─────────────────────────────────────────────────

function makeRawProduct(overrides = {}) {
    return {
        id: 'prod-abc-123',
        name: 'iPhone 15 Pro',
        title: 'iPhone 15 Pro',
        price: 150000,
        description: 'A great phone',
        image_url: 'https://cdn.example.com/images/iphone15.jpg',
        search_vector: [0.1, 0.2, 0.3],
        keywords: ['apple', 'iphone'],
        content_type: 'product',
        whatsapp_link: 'https://wa.me/234800',
        checkout_url: 'https://example.com/checkout/prod-abc-123',
        metadata: {
            image_url: 'https://cdn.example.com/images/iphone15.jpg',
            category_ids: ['cat-phones'],
            category_names: ['Smartphones'],
            attributes: { j: '256gb', c: 'black', vendor: 'Apple Store' },
            handle: 'iphone-15-pro',
        },
        ...overrides
    };
}

function makeContext(overrides = {}) {
    return {
        sessionId: 'test-session-001',
        microstate_active: false,
        CATEGORIES: require('../src/context/storeContext').CATEGORIES,
        ATTRIBUTES: require('../src/context/storeContext').ATTRIBUTES,
        VENDORS: {},
        history: [],
        ...overrides
    };
}

function makeSearchResult(productOverrides = [], meta = {}) {
    const products = productOverrides.length > 0
        ? productOverrides
        : [makeRawProduct()];
    return {
        products,
        total: products.length,
        facets: meta.facets || {},
        pagination: meta.pagination || { page: 1, perPage: 5, total: products.length, totalPages: 1 },
        ...meta
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// ══ SECTION A: storefrontWhatsAppUx utilities ════════════════════════════════
// ─────────────────────────────────────────────────────────────────────────────

const {
    buildProductCards,
    buildFacetRefinerButtons,
    buildDefaultSeeMoreTitle,
    pickVendorSeeMoreTitle,
    computeHasNextPage,
    createSnapshotId,
} = require('../src/utils/storefrontWhatsAppUx');

describe('buildProductCards', () => {
    test('returns cards array with correct structure', () => {
        const p = makeRawProduct();
        const result = buildProductCards([p]);
        expect(result.type).toBe('button');
        expect(result.transaction).toBe('product_card');
        expect(result.cards).toHaveLength(1);

        const card = result.cards[0];
        expect(card.id).toBe(p.id);
        expect(card.content_type).toBe('product');
        expect(card.sponsor.product_id).toBe(p.id);
        expect(card.sponsor.ordinal).toBe(1);
    });

    test('card buttons include add to cart, more info, show similar', () => {
        const p = makeRawProduct();
        const result = buildProductCards([p]);
        const btnIds = result.cards[0].buttons.map(b => b.id);
        expect(btnIds).toContain(`__cart:add:${p.id}__`);
        expect(btnIds).toContain(`__product:details:${p.id}__`);
        expect(btnIds).toContain(`__product:similar:${p.id}__`);
    });

    test('card text includes product name and price', () => {
        const p = makeRawProduct({ price: 75000 });
        const result = buildProductCards([p]);
        expect(result.cards[0].text).toContain('iPhone 15 Pro');
        expect(result.cards[0].text).toContain('₦75000');
    });

    test('handles empty product list gracefully', () => {
        const result = buildProductCards([]);
        expect(result.cards).toHaveLength(0);
    });

    test('handles null entries in products array', () => {
        const p = makeRawProduct();
        const result = buildProductCards([null, p, null]);
        expect(result.cards).toHaveLength(1);
        expect(result.cards[0].id).toBe(p.id);
    });

    test('assigns correct ordinal suffix for multiple cards', () => {
        const products = [
            makeRawProduct({ id: 'p1', name: 'Phone 1' }),
            makeRawProduct({ id: 'p2', name: 'Phone 2' }),
            makeRawProduct({ id: 'p3', name: 'Phone 3' }),
        ];
        const result = buildProductCards(products);
        expect(result.cards[0].sponsor.ordinal).toBe(1);
        expect(result.cards[1].sponsor.ordinal).toBe(2);
        expect(result.cards[2].sponsor.ordinal).toBe(3);
    });

    test('uses metadata.image_url as fallback when no top-level image_url', () => {
        const p = makeRawProduct();
        delete p.image_url;
        const result = buildProductCards([p]);
        expect(result.cards[0].image_url).toBe(p.metadata.image_url);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('buildFacetRefinerButtons', () => {
    const snapshotId = 'snap-001';

    function makeFacets(options = []) {
        return {
            attributes: [
                {
                    code: 'c',
                    label: 'Color',
                    options,
                    clauses: []
                }
            ]
        };
    }

    test('returns empty arrays when no facets provided', () => {
        const result = buildFacetRefinerButtons({ facets: {}, attributes: {}, snapshotId });
        expect(result.clauseButtons).toHaveLength(0);
        expect(result.valueButtons).toHaveLength(0);
    });

    test('builds value buttons from facet options', () => {
        const facets = makeFacets([
            { value: 'Black', count: 5 },
            { value: 'White', count: 3 },
        ]);
        const result = buildFacetRefinerButtons({ facets, attributes: {}, snapshotId });
        expect(result.valueButtons.length).toBeGreaterThanOrEqual(1);
        const ids = result.valueButtons.map(b => b.id);
        expect(ids.some(id => id.includes('filter:value'))).toBe(true);
        expect(ids.some(id => id.includes('Black'))).toBe(true);
    });

    test('skips options with count = 0', () => {
        const facets = makeFacets([
            { value: 'Black', count: 0 },
            { value: 'White', count: 3 },
        ]);
        const result = buildFacetRefinerButtons({ facets, attributes: {}, snapshotId });
        const titles = result.valueButtons.map(b => b.title);
        expect(titles).not.toContain('Black');
        expect(titles).toContain('White');
    });

    test('skips already-active value filters', () => {
        const facets = makeFacets([{ value: 'Black', count: 5 }]);
        const activeAttrs = { c: 'Black' }; // c = color already active
        const result = buildFacetRefinerButtons({ facets, attributes: activeAttrs, snapshotId });
        expect(result.valueButtons).toHaveLength(0);
    });

    test('limits combined buttons to 3', () => {
        const facets = makeFacets([
            { value: 'Red', count: 10 },
            { value: 'Blue', count: 8 },
            { value: 'Green', count: 6 },
            { value: 'Yellow', count: 4 },
        ]);
        const result = buildFacetRefinerButtons({ facets, attributes: {}, snapshotId });
        const total = result.valueButtons.length + result.clauseButtons.length;
        expect(total).toBeLessThanOrEqual(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('pickVendorSeeMoreTitle', () => {
    test('short names (≤10 chars): "More from [name]"', () => {
        expect(pickVendorSeeMoreTitle('Apple')).toBe('More from Apple');
    });

    test('medium names (≤16 chars): "See more [name] products"', () => {
        expect(pickVendorSeeMoreTitle('Home Decor Co')).toBe('See more Home Decor Co products');
    });

    test('long names (>16 chars): "See more"', () => {
        expect(pickVendorSeeMoreTitle('Taye\'s Amazing Home Decor Store')).toBe('See more');
    });

    test('empty string returns "See more"', () => {
        expect(pickVendorSeeMoreTitle('')).toBe('See more');
    });

    test('null/undefined returns "See more"', () => {
        expect(pickVendorSeeMoreTitle(null)).toBe('See more');
        expect(pickVendorSeeMoreTitle(undefined)).toBe('See more');
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('buildDefaultSeeMoreTitle', () => {
    test('combines label and clause when both provided', () => {
        const result = buildDefaultSeeMoreTitle({ labelBase: 'Phones', clauseName: 'budget' });
        expect(result).toBe('See more Phones (budget)');
    });

    test('uses just labelBase when no clause', () => {
        expect(buildDefaultSeeMoreTitle({ labelBase: 'Phones', clauseName: null })).toBe('See more Phones');
    });

    test('defaults to "results" when no labelBase', () => {
        expect(buildDefaultSeeMoreTitle({ labelBase: '', clauseName: null })).toBe('See more results');
    });

    test('skips clause if it equals labelBase (case-insensitive)', () => {
        expect(buildDefaultSeeMoreTitle({ labelBase: 'Phones', clauseName: 'phones' })).toBe('See more Phones');
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('computeHasNextPage', () => {
    test('returns true when currentPage < totalPages', () => {
        const result = computeHasNextPage({
            pagination: { page: 1, perPage: 5, total: 20, totalPages: 4 },
            fallbackCount: 20, page: 1, limit: 5
        });
        expect(result).toBe(true);
    });

    test('returns false when currentPage === totalPages', () => {
        const result = computeHasNextPage({
            pagination: { page: 4, perPage: 5, total: 20, totalPages: 4 },
            fallbackCount: 20, page: 4, limit: 5
        });
        expect(result).toBe(false);
    });

    test('returns false for a single page of results', () => {
        const result = computeHasNextPage({
            pagination: { page: 1, perPage: 5, total: 3, totalPages: 1 },
            fallbackCount: 3, page: 1, limit: 5
        });
        expect(result).toBe(false);
    });

    test('falls back to fallbackCount when pagination is missing', () => {
        // 6 results, limit 5 → 2 pages → page 1 should return true
        const result = computeHasNextPage({
            pagination: null,
            fallbackCount: 6, page: 1, limit: 5
        });
        expect(result).toBe(true);
    });

    test('returns false when total = 0', () => {
        const result = computeHasNextPage({
            pagination: { page: 1, perPage: 5, total: 0, totalPages: 0 },
            fallbackCount: 0, page: 1, limit: 5
        });
        expect(result).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('createSnapshotId', () => {
    test('returns an 8-character hex string', () => {
        const id = createSnapshotId();
        expect(id).toMatch(/^[0-9a-f]{8}$/);
    });

    test('returns unique IDs on successive calls', () => {
        const ids = new Set(Array.from({ length: 20 }, () => createSnapshotId()));
        expect(ids.size).toBe(20);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ══ SECTION B: productUtility ════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────────────────

const { processProductData, processProductList } = require('../src/utils/productUtility');
const stateManager = require('../src/state/stateManager');

describe('processProductData', () => {
    beforeEach(() => jest.clearAllMocks());

    test('returns null for falsy input', async () => {
        expect(await processProductData(null)).toBeNull();
        expect(await processProductData(undefined)).toBeNull();
    });

    test('strips image_url, search_vector, keywords from top-level and metadata', async () => {
        const raw = makeRawProduct();
        const lean = await processProductData(raw);

        expect(lean.image_url).toBeUndefined();
        expect(lean.search_vector).toBeUndefined();
        expect(lean.keywords).toBeUndefined();
        expect(lean.metadata?.image_url).toBeUndefined();
        expect(lean.metadata?.search_vector).toBeUndefined();
        expect(lean.metadata?.keywords).toBeUndefined();
    });

    test('preserves core fields (id, name, price, whatsapp_link, checkout_url)', async () => {
        const raw = makeRawProduct();
        const lean = await processProductData(raw);

        expect(lean.id).toBe(raw.id);
        expect(lean.name).toBe(raw.name);
        expect(lean.price).toBe(raw.price);
        expect(lean.whatsapp_link).toBe(raw.whatsapp_link);
        expect(lean.checkout_url).toBe(raw.checkout_url);
    });

    test('calls cacheProductImage when image_url and id are present', async () => {
        const raw = makeRawProduct();
        await processProductData(raw);
        expect(stateManager.cacheProductImage).toHaveBeenCalledWith(raw.id, raw.image_url);
    });

    test('does NOT call cacheProductImage if no image_url', async () => {
        const raw = makeRawProduct();
        delete raw.image_url;
        raw.metadata.image_url = undefined;
        await processProductData(raw);
        expect(stateManager.cacheProductImage).not.toHaveBeenCalled();
    });

    test('preserves metadata.attributes after stripping', async () => {
        const raw = makeRawProduct();
        const lean = await processProductData(raw);
        expect(lean.metadata?.attributes).toEqual(raw.metadata.attributes);
    });
});

describe('processProductList', () => {
    test('returns empty array for non-array input', async () => {
        expect(await processProductList(null)).toEqual([]);
        expect(await processProductList(undefined)).toEqual([]);
        expect(await processProductList('not-array')).toEqual([]);
    });

    test('processes all products in a list', async () => {
        const raws = [makeRawProduct({ id: 'p1' }), makeRawProduct({ id: 'p2' })];
        const result = await processProductList(raws);
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('p1');
        expect(result[1].id).toBe('p2');
    });

    test('strips heavy fields from all products in list', async () => {
        const raws = [makeRawProduct(), makeRawProduct({ id: 'p2' })];
        const result = await processProductList(raws);
        result.forEach(p => {
            expect(p.image_url).toBeUndefined();
            expect(p.search_vector).toBeUndefined();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ══ SECTION C: searchInterfaceClient — buildSearchSpec ═══════════════════════
// ─────────────────────────────────────────────────────────────────────────────

const { buildSearchSpec } = require('../src/utils/searchInterfaceClient');

describe('buildSearchSpec', () => {
    test('builds spec with correct query and defaults', () => {
        const spec = buildSearchSpec({ query: 'iphone', attributes: {}, limit: 5, page: 1, sort: 'relevance' });
        expect(spec.query).toBe('iphone');
        expect(spec.limit).toBe(5);
        expect(spec.page).toBe(1);
        expect(spec.sort).toBe('relevance');
        expect(spec.categoryType).toBe('none');
    });

    test('forwards _category_candidates as categories array', () => {
        const candidates = [
            { id: 'cat-phones', slug: 'smartphones', label: 'Smartphones', isWinner: true, isPartial: false }
        ];
        const spec = buildSearchSpec({
            query: 'iphone',
            _category_candidates: candidates,
            _category_type: 'single',
            attributes: {},
        });
        expect(spec.categories).toEqual(candidates);
        expect(spec.categoryType).toBe('single');
    });

    test('falls back to legacy category param when no candidates', () => {
        const spec = buildSearchSpec({
            query: 'iphone',
            category: 'cat-phones',
            is_partial_match: false,
            attributes: {},
        });
        expect(spec.categories).toHaveLength(1);
        expect(spec.categories[0].id).toBe('cat-phones');
        expect(spec.categories[0].isWinner).toBe(true);
        expect(spec.categoryType).toBe('single');
    });

    test('builds priceFilter when price_min or price_max provided', () => {
        const spec = buildSearchSpec({ query: 'phone', price_min: 10000, price_max: 50000, attributes: {} });
        expect(spec.priceFilter).toEqual({ min: 10000, max: 50000 });
    });

    test('priceFilter is null when no price range given', () => {
        const spec = buildSearchSpec({ query: 'phone', attributes: {} });
        expect(spec.priceFilter).toBeNull();
    });

    test('sets partialWord from _category_words', () => {
        const spec = buildSearchSpec({ query: 'phones', _category_words: 'smart', attributes: {} });
        expect(spec.partialWord).toBe('smart');
    });

    test('includes vendor inside attributes, not as separate field', () => {
        const spec = buildSearchSpec({
            query: 'phone',
            attributes: { vendor: 'Apple Store', c: 'black' },
        });
        // attributes should be passed straight through
        expect(spec.attributes.vendor).toBe('Apple Store');
        expect(spec.attributes.c).toBe('black');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ══ SECTION D: handleSearchResults ═══════════════════════════════════════════
// Tests for the shared post-search orchestration function.
// We access it indirectly by calling the product.search handler with a mocked
// executeSearch that returns controlled product data.
// ─────────────────────────────────────────────────────────────────────────────

const { executeSearch } = require('../src/utils/searchInterfaceClient');
const productTools = require('../src/tools/product');

function buildBaseSearchParams(overrides = {}) {
    return {
        query: 'iphone',
        category: null,
        limit: 5,
        page: 1,
        sort: 'relevance',
        attributes: {},
        ...overrides
    };
}

describe('handleSearchResults — state writes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default: executeSearch returns 1 valid product
        executeSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 1,
            facets: {},
            classification: 'valid',
            stage: 4,
            vector_fallback_needed: false,
            partialFallback: false,
            price_filter_applied: false,
            price_filter_failed: false,
            pagination: { page: 1, perPage: 5, total: 1, totalPages: 1 }
        });
    });

    test('calls updateReferenceMap with found products', async () => {
        await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        expect(stateManager.updateReferenceMap).toHaveBeenCalled();
    });

    test('calls updateLastSearch with query and products', async () => {
        await productTools['product.search'].handler(buildBaseSearchParams({ query: 'iphone' }), makeContext());
        expect(stateManager.updateLastSearch).toHaveBeenCalled();
        const callArgs = stateManager.updateLastSearch.mock.calls[0];
        expect(callArgs[1]).toBe('iphone'); // query arg
    });

    test('calls setActiveTopic with type "product"', async () => {
        await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        expect(stateManager.setActiveTopic).toHaveBeenCalled();
        const topicArg = stateManager.setActiveTopic.mock.calls[0][1];
        expect(topicArg.type).toBe('product');
    });

    test('calls setCurrentlyViewing with first product id', async () => {
        await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        expect(stateManager.setCurrentlyViewing).toHaveBeenCalledWith(
            'test-session-001',
            expect.stringMatching(/prod-abc-123|iphone-15-pro/)
        );
    });

    test('calls setSearchContext with product_ids and product_attributes_map', async () => {
        await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        expect(stateManager.setSearchContext).toHaveBeenCalled();
        const ctxArg = stateManager.setSearchContext.mock.calls[0][1];
        expect(Array.isArray(ctxArg.product_ids)).toBe(true);
        expect(typeof ctxArg.product_attributes_map).toBe('object');
    });

    test('does NOT write state when sessionId is missing', async () => {
        const ctx = makeContext({ sessionId: null });
        await productTools['product.search'].handler(buildBaseSearchParams(), ctx);
        expect(stateManager.updateReferenceMap).not.toHaveBeenCalled();
        expect(stateManager.updateLastSearch).not.toHaveBeenCalled();
    });
});

describe('handleSearchResults — WhatsApp UX output', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        executeSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 1,
            facets: {},
            classification: 'valid',
            stage: 4,
            vector_fallback_needed: false,
            partialFallback: false,
            price_filter_applied: false,
            price_filter_failed: false,
            pagination: { page: 1, perPage: 5, total: 1, totalPages: 1 }
        });
    });

    test('result includes whatsapp object with button type', async () => {
        const result = await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        expect(result.whatsapp).toBeDefined();
        expect(result.whatsapp.type).toBe('button');
        expect(Array.isArray(result.whatsapp.buttons)).toBe(true);
    });

    test('"Shop these items" button is always present', async () => {
        const result = await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        const btnIds = result.whatsapp.buttons.map(b => b.id);
        expect(btnIds.some(id => id.includes('__nav:cards:'))).toBe(true);
    });

    test('"Add to cart" button present when exactly 1 result', async () => {
        const result = await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        expect(result.total).toBe(1);
        const btnIds = result.whatsapp.buttons.map(b => b.id);
        expect(btnIds.some(id => id.includes('__cart:add:'))).toBe(true);
    });

    test('"Add to cart" button absent when >1 result', async () => {
        executeSearch.mockResolvedValue({
            products: [makeRawProduct({ id: 'p1' }), makeRawProduct({ id: 'p2' })],
            total: 2,
            facets: {},
            classification: 'valid',
            stage: 4,
            vector_fallback_needed: false,
            partialFallback: false,
            price_filter_applied: false,
            price_filter_failed: false,
            pagination: { page: 1, perPage: 5, total: 2, totalPages: 1 }
        });
        const result = await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        const btnIds = result.whatsapp.buttons.map(b => b.id);
        expect(btnIds.some(id => id.includes('__cart:add:'))).toBe(false);
    });

    test('"See more" button present when hasNextPage is true', async () => {
        executeSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 10,
            facets: {},
            classification: 'valid',
            stage: 4,
            vector_fallback_needed: false,
            partialFallback: false,
            price_filter_applied: false,
            price_filter_failed: false,
            pagination: { page: 1, perPage: 5, total: 10, totalPages: 2 }
        });
        const result = await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        const btnIds = result.whatsapp.buttons.map(b => b.id);
        expect(btnIds.some(id => id.includes('__nav:more:'))).toBe(true);
    });

    test('"See more" button absent when on last page', async () => {
        const result = await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        // total=1, totalPages=1 → no "See more"
        const btnIds = result.whatsapp.buttons.map(b => b.id);
        expect(btnIds.some(id => id.includes('__nav:more:'))).toBe(false);
    });

    test('whatsapp_product_cards is undefined (decoupled)', async () => {
        const result = await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        expect(result.whatsapp_product_cards).toBeUndefined();
    });

    test('products have suppress_images: true in output', async () => {
        const result = await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        expect(result.products.length).toBeGreaterThan(0);
        result.products.forEach(p => {
            expect(p.suppress_images).toBe(true);
        });
    });
});

describe('handleSearchResults — suggestion packaging', () => {
    beforeEach(() => jest.clearAllMocks());

    test('classification=suggested → wraps result as suggested_products', async () => {
        executeSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 1,
            facets: {},
            classification: 'suggested',
            stage: 2,
            vector_fallback_needed: false,
            partialFallback: false,
            price_filter_applied: false,
            price_filter_failed: false,
            pagination: { page: 1, perPage: 5, total: 1, totalPages: 1 }
        });

        const result = await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());

        expect(result.is_fallback).toBe(true);
        expect(Array.isArray(result.suggested_products)).toBe(true);
        expect(result.suggested_products.length).toBe(1);
        expect(result.products).toEqual([]);
        expect(result.suggestion_message).toBeDefined();
    });

    test('suggested result still has cards button', async () => {
        executeSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 1, facets: {},
            classification: 'suggested', stage: 2,
            vector_fallback_needed: false, partialFallback: false,
            price_filter_applied: false, price_filter_failed: false,
            pagination: { page: 1, perPage: 5, total: 1, totalPages: 1 }
        });

        const result = await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        const btnIds = result.whatsapp.buttons.map(b => b.id);
        expect(btnIds.some(id => id.includes('__nav:cards:'))).toBe(true);
    });

    test('partialFallback=true → also wraps as suggested', async () => {
        executeSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 1, facets: {},
            classification: 'valid', stage: 4,
            vector_fallback_needed: false, partialFallback: true,
            price_filter_applied: false, price_filter_failed: false,
            pagination: { page: 1, perPage: 5, total: 1, totalPages: 1 }
        });

        const result = await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        expect(result.is_fallback).toBe(true);
        expect(result.suggested_products).toBeDefined();
    });
});

describe('handleSearchResults — price filter annotation', () => {
    beforeEach(() => jest.clearAllMocks());

    test('price_filter_failed adds price_filter_note to result', async () => {
        executeSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 1, facets: {},
            classification: 'valid', stage: 4,
            vector_fallback_needed: false, partialFallback: false,
            price_filter_applied: false, price_filter_failed: true,
            pagination: { page: 1, perPage: 5, total: 1, totalPages: 1 }
        });

        const result = await productTools['product.search'].handler(buildBaseSearchParams(), makeContext());
        expect(result.price_filter_note).toBeDefined();
        expect(typeof result.price_filter_note).toBe('string');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ══ SECTION E: Vector/Image/Similar short-circuit ════════════════════════════
// ─────────────────────────────────────────────────────────────────────────────

const { performVectorSearch, performSimilarSearch, performImageSearch } = require('../src/utils/vectorSearchUtility');

describe('product.search — Vector mode short-circuit', () => {
    beforeEach(() => jest.clearAllMocks());

    test('search_mode=VECTOR calls performVectorSearch, skips executeSearch', async () => {
        performVectorSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 1, facets: {},
            pagination: { page: 1, perPage: 5, total: 1, totalPages: 1 }
        });

        await productTools['product.search'].handler(
            buildBaseSearchParams({ query: 'gift for dad', search_mode: 'VECTOR' }),
            makeContext()
        );

        expect(performVectorSearch).toHaveBeenCalled();
        expect(executeSearch).not.toHaveBeenCalled();
    });

    test('search_mode=VECTOR with empty results returns directResponse message', async () => {
        // Vector returns nothing
        performVectorSearch.mockResolvedValue({ products: [], total: 0, facets: {}, pagination: {} });

        // And structured also returns nothing (already the mock default)
        executeSearch.mockResolvedValue({
            products: [], total: 0, facets: {},
            classification: 'none', stage: 0,
            vector_fallback_needed: true, partialFallback: false,
            price_filter_applied: false, price_filter_failed: false,
            pagination: { page: 1, perPage: 5, total: 0, totalPages: 0 }
        });

        const result = await productTools['product.search'].handler(
            buildBaseSearchParams({ query: 'gift for dad', search_mode: 'VECTOR' }),
            makeContext()
        );

        // Should not explode. May return empty or fallback message.
        expect(result).toBeDefined();
    });

    test('similar_to param calls performSimilarSearch', async () => {
        performSimilarSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 1, facets: {},
            pagination: { page: 1, perPage: 5, total: 1, totalPages: 1 }
        });

        const result = await productTools['product.search'].handler(
            buildBaseSearchParams({ similar_to: 'prod-abc-123', query: '' }),
            makeContext()
        );

        expect(performSimilarSearch).toHaveBeenCalled();
        expect(executeSearch).not.toHaveBeenCalled();
        expect(result.mode).toBe('similar');
    });

    test('search_mode=IMAGE calls performImageSearch', async () => {
        performImageSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 1, facets: {},
            pagination: { page: 1, perPage: 5, total: 1, totalPages: 1 }
        });

        const result = await productTools['product.search'].handler(
            buildBaseSearchParams({ search_mode: 'IMAGE', image: 'base64encodeddata', query: '' }),
            makeContext()
        );

        expect(performImageSearch).toHaveBeenCalled();
        expect(result.mode).toBe('IMAGE');
    });

    test('image mode with no results returns directResponse', async () => {
        performImageSearch.mockResolvedValue({ products: [], total: 0, facets: {}, pagination: {} });

        const result = await productTools['product.search'].handler(
            buildBaseSearchParams({ search_mode: 'IMAGE', image: 'base64data', query: '' }),
            makeContext()
        );

        expect(result.directResponse).toBe(true);
        expect(typeof result.message).toBe('string');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ══ SECTION F: Structured search — vector fallback ═══════════════════════════
// ─────────────────────────────────────────────────────────────────────────────

describe('product.search — structured → vector fallback', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Structured search returns nothing
        executeSearch.mockResolvedValue({
            products: [], total: 0, facets: {},
            classification: 'none', stage: 0,
            vector_fallback_needed: true, partialFallback: false,
            price_filter_applied: false, price_filter_failed: false,
            pagination: { page: 1, perPage: 5, total: 0, totalPages: 0 }
        });
    });

    test('calls performVectorSearch when structured returns 0 and query exists', async () => {
        performVectorSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 1, facets: {},
            pagination: { page: 1, perPage: 5, total: 1, totalPages: 1 }
        });

        await productTools['product.search'].handler(buildBaseSearchParams({ query: 'iphone' }), makeContext());
        expect(performVectorSearch).toHaveBeenCalled();
    });

    test('vector fallback result is wrapped as suggested', async () => {
        performVectorSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 1, facets: {},
            pagination: { page: 1, perPage: 5, total: 1, totalPages: 1 }
        });

        const result = await productTools['product.search'].handler(buildBaseSearchParams({ query: 'iphone' }), makeContext());
        expect(result.is_fallback).toBe(true);
        expect(result.suggested_products).toBeDefined();
    });

    test('empty query skips vector fallback', async () => {
        const result = await productTools['product.search'].handler(
            buildBaseSearchParams({ query: '' }),
            makeContext()
        );
        expect(performVectorSearch).not.toHaveBeenCalled();
        expect(result.total).toBe(0);
    });

    test('returns empty when both structured and vector return nothing', async () => {
        performVectorSearch.mockResolvedValue({ products: [], total: 0, facets: {}, pagination: {} });

        const result = await productTools['product.search'].handler(buildBaseSearchParams({ query: 'xyzzy404' }), makeContext());
        expect(result.products ?? result.total).toBeDefined();
        expect((result.products || []).length).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ══ SECTION G: product.findCheapest ══════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────────────────

describe('product.findCheapest', () => {
    beforeEach(() => jest.clearAllMocks());

    test('delegates to product.search with sort=price_asc', async () => {
        executeSearch.mockResolvedValue({
            products: [makeRawProduct()],
            total: 1, facets: {},
            classification: 'valid', stage: 4,
            vector_fallback_needed: false, partialFallback: false,
            price_filter_applied: false, price_filter_failed: false,
            pagination: { page: 1, perPage: 5, total: 1, totalPages: 1 }
        });

        await productTools['product.findCheapest'].handler({ category: 'cat-phones' }, makeContext());

        expect(executeSearch).toHaveBeenCalled();
        const callSpec = executeSearch.mock.calls[0][0];
        expect(callSpec.sort).toBe('price_asc');
    });
});
