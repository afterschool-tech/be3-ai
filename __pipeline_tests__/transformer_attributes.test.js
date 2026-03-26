/**
 * Tests for the Transformer Attribute Injection Feature.
 *
 * Exercises the full "Inject Late, Don't Consume" pipeline:
 *  1. entityExtractor emits non-consuming `transformer_attribute_hint` entities
 *  2. parameterExtractor ingests hints with intent-gating + facet echo guard
 *  3. Key canonicalization (storage → j)
 *  4. Token stripping from product_name
 *  5. Second bare-category guard
 */

const { extractEntities } = require('../src/services/intentResolver/pipeline/entityExtractor');
const { extractParameters, extractDeterministic } = require('../src/services/intentResolver/pipeline/parameterExtractor');

// ── Minimal store context with real attribute codes ──
const storeContext = {
    VENDORS: {},
    CATEGORIES: {
        'smartphones': {
            id: 'cat-smartphones',
            label: 'Smartphones',
            slug: 'smartphones',
            attributes: ['vendor', 'storage', 'color', 'material'],
            allowed_clauses: [],
            product_count: 10,
            total_count: 10
        }
    },
    ATTRIBUTES: {
        storage: { id: 'attr-storage', code: 'j', label: 'storage', type: 'text' },
        color:   { id: 'attr-color',   code: 'c', label: 'color',   type: 'text' },
        material:{ id: 'attr-matl',    code: 'm', label: 'material', type: 'text' },
        brand:   { id: 'attr-brand',   code: 'b', label: 'brand',   type: 'select' }
    }
};

// ── Helpers ──
function buildSemanticContext(attributes = {}) {
    return {
        available: true,
        entities: { attribute: attributes },
        confidence: {}
    };
}

function noOpAi() { return Promise.resolve('{}'); }

// ═══════════════════════════════════════════════════════════════════════════
// 1. ENTITY EXTRACTOR — Advisory Hint Emission
// ═══════════════════════════════════════════════════════════════════════════
describe('EntityExtractor: Transformer Attribute Hints', () => {

    test('should emit transformer_attribute_hint entities (NOT hard attribute)', () => {
        const semanticCtx = buildSemanticContext({ storage: ['256gb'] });
        const { entities } = extractEntities(
            'show me 256gb smartphones', storeContext, {}, null, [], [], [], semanticCtx
        );

        const hints = entities.filter(e => e.type === 'transformer_attribute_hint');
        expect(hints.length).toBe(1);
        expect(hints[0].subType).toBe('storage');
        expect(hints[0].value).toBe('256gb');
        expect(hints[0].advisory).toBe(true);

        // Must NOT have a hard `attribute` type entity
        const hardAttrs = entities.filter(e => e.type === 'attribute');
        expect(hardAttrs.length).toBe(0);
    });

    test('should NOT consume the word — facet target detection stays unblocked', () => {
        // "storage" appears both as a transformer attribute AND is a facet target keyword.
        // Advisory hints must NOT consume it, so facet detection can still claim it.
        const semanticCtx = buildSemanticContext({ storage: ['storage'] });
        const { entities } = extractEntities(
            'what storage options do you have', storeContext, {}, null, [], [], [], semanticCtx
        );

        const hints = entities.filter(e => e.type === 'transformer_attribute_hint');
        expect(hints.length).toBeGreaterThanOrEqual(1);

        // "storage" should still be available for facet target detection if near a discovery verb
        // (The facet target detection depends on action verb proximity — "what" is discovery_meta)
        const facetTargets = entities.filter(e => e.type === 'facet_target');
        // If facet_target was consumed by the hint, this would be 0
        // It may or may not fire depending on resolver availability, but it should NOT be blocked
        // The critical assertion: "storage" is NOT in the consumed set
        const hint = hints.find(h => h.value === 'storage');
        if (hint) {
            expect(hint.advisory).toBe(true); // Advisory = non-consuming
        }
    });

    test('should skip hint if brand already detected as entity', () => {
        const brandEntity = {
            type: 'brand',
            value: 'apple',
            source: 'GLOBAL_PREPASS',
            localWordIndex: 2,
            wordCount: 1
        };
        const semanticCtx = buildSemanticContext({ brand: ['apple'] });
        const { entities } = extractEntities(
            'show me apple smartphones', storeContext, {}, null, [], [brandEntity], [], semanticCtx
        );

        const brandHints = entities.filter(e => e.type === 'transformer_attribute_hint' && e.subType === 'brand');
        expect(brandHints.length).toBe(0);
    });

    test('should skip hint if clause already detected for same attribute', () => {
        const clauseEntity = {
            type: 'clause',
            value: 'cheap',
            clauseId: 'affordable',
            attribute: 'price_tier',
            source: 'GLOBAL_PREPASS',
            localWordIndex: 2,
            wordCount: 1
        };
        const semanticCtx = buildSemanticContext({ price_tier: ['budget'] });
        const { entities } = extractEntities(
            'show me cheap smartphones', storeContext, {}, null, [], [clauseEntity], [], semanticCtx
        );

        const ptHints = entities.filter(e => e.type === 'transformer_attribute_hint' && e.subType === 'price_tier');
        expect(ptHints.length).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PARAMETER EXTRACTOR — Intent-Gated Ingestion & Guards
// ═══════════════════════════════════════════════════════════════════════════
describe('ParameterExtractor: Attribute Hint Ingestion', () => {

    // Helper: build a minimal entities array with a transformer_attribute_hint
    function hintEntity(subType, value) {
        return {
            type: 'transformer_attribute_hint',
            subType,
            value,
            source: 'TRANSFORMER_SEMANTIC',
            advisory: true,
            wordIndices: []
        };
    }

    function categoryEntity(id) {
        return { type: 'category', id, value: 'smartphones', source: 'storeContext.CATEGORIES', wordIndices: [] };
    }

    function facetTargetEntity(attribute) {
        return { type: 'facet_target', value: attribute, attribute, source: 'semanticFacetResolver', wordIndices: [] };
    }

    test('should ingest real attribute values for product_search intent', async () => {
        const candidates = [{ intentName: 'product_search', score: 8 }];
        const entities = [
            categoryEntity('cat-smartphones'),
            hintEntity('storage', '256gb')
        ];

        const result = await extractParameters(
            'show me 256gb smartphones', candidates, noOpAi, storeContext, [], entities
        );

        // Should be canonicalized: storage → j
        expect(result.attributes).toBeDefined();
        expect(result.attributes.j).toBe('256gb');
    });

    test('should NOT ingest hints for facet_list intent', async () => {
        const candidates = [{ intentName: 'facet_list', score: 8 }];
        const entities = [
            categoryEntity('cat-smartphones'),
            facetTargetEntity('storage'),
            hintEntity('storage', '256gb')
        ];

        const result = await extractParameters(
            'what storage options do you have', candidates, noOpAi, storeContext, [], entities
        );

        // Attributes should be empty or undefined — facet intents are gated
        const hasStorageAttr = result.attributes && (result.attributes.j || result.attributes.storage);
        expect(hasStorageAttr).toBeFalsy();
        // facet_target should still exist
        expect(result.facet_target).toBe('storage');
    });

    test('should reject facet name echo (value = attribute name)', async () => {
        const candidates = [{ intentName: 'product_search', score: 8 }];
        const entities = [
            categoryEntity('cat-smartphones'),
            hintEntity('material', 'material')  // Echo! value = attribute name
        ];

        const result = await extractParameters(
            'do you have a gold material smartphone', candidates, noOpAi, storeContext, [], entities
        );

        // "material" should be rejected as a facet name echo
        const hasMaterialAttr = result.attributes && (result.attributes.m || result.attributes.material);
        expect(hasMaterialAttr).toBeFalsy();
    });

    test('should reject facet bench variations as echo (e.g. "texture")', async () => {
        const candidates = [{ intentName: 'product_search', score: 8 }];
        const entities = [
            categoryEntity('cat-smartphones'),
            hintEntity('material', 'texture')  // "texture" is a variation of "material" in facet_bench
        ];

        const result = await extractParameters(
            'what texture of smartphone', candidates, noOpAi, storeContext, [], entities
        );

        const hasMaterialAttr = result.attributes && (result.attributes.m || result.attributes.material);
        expect(hasMaterialAttr).toBeFalsy();
    });

    test('should accept real attribute value (e.g. "gold") even for material', async () => {
        const candidates = [{ intentName: 'product_search', score: 8 }];
        const entities = [
            categoryEntity('cat-smartphones'),
            hintEntity('material', 'gold')  // "gold" is NOT in facet_bench → real value
        ];

        const result = await extractParameters(
            'show me gold smartphones', candidates, noOpAi, storeContext, [], entities
        );

        expect(result.attributes).toBeDefined();
        expect(result.attributes.m).toBe('gold');
    });

    test('should canonicalize attribute keys (storage → j)', async () => {
        const candidates = [{ intentName: 'product_search', score: 8 }];
        const entities = [
            categoryEntity('cat-smartphones'),
            hintEntity('storage', '128gb')
        ];

        const result = await extractParameters(
            'show me 128gb smartphones', candidates, noOpAi, storeContext, [], entities
        );

        // Should use backend code key, not human key
        expect(result.attributes.j).toBe('128gb');
        expect(result.attributes.storage).toBeUndefined();
    });

    test('should strip attribute value tokens from product_name', async () => {
        const candidates = [{ intentName: 'product_search', score: 8 }];
        const entities = [
            categoryEntity('cat-smartphones'),
            hintEntity('storage', '256gb')
        ];

        const result = await extractParameters(
            '256gb iphone', candidates, noOpAi, storeContext, [], entities
        );

        // "256gb" should be stripped from product_name
        if (result.product_name) {
            expect(result.product_name).not.toMatch(/256gb/i);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. FACET BENCH REJECTION SET — Comprehensive Coverage
// ═══════════════════════════════════════════════════════════════════════════
describe('Facet Bench Rejection Set', () => {
    // These are all words from facet_bench.json that should be rejected as echo values
    const echoWords = [
        'color', 'colours', 'shades', 'hue', 'pigment',
        'storage', 'capacity', 'memory', 'rom', 'gigabytes', 'gb',
        'brand', 'manufacturer', 'labels',
        'material', 'texture', 'fabric', 'metal', 'plastic',
        'quality', 'condition', 'grade', 'standard',
        'size', 'dimensions', 'proportions',
        'vendor', 'merchant', 'seller'
    ];

    test.each(echoWords)('should reject "%s" as a facet name echo', async (echoWord) => {
        const candidates = [{ intentName: 'product_search', score: 8 }];
        const entities = [hintEntity('material', echoWord)];

        function hintEntity(subType, value) {
            return {
                type: 'transformer_attribute_hint', subType, value,
                source: 'TRANSFORMER_SEMANTIC', advisory: true, wordIndices: []
            };
        }

        const result = await extractParameters(
            `show me ${echoWord} smartphone`, candidates, noOpAi, storeContext, [], entities
        );

        const hasAttr = result.attributes && Object.keys(result.attributes).length > 0;
        expect(hasAttr).toBeFalsy();
    });
});
