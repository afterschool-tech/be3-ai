/**
 * Intent: product_compare
 * Triggered when the user wants to compare two or more products side by side.
 */

module.exports = {
    name: 'product_compare',

    keywords: [
        'compare', 'comparison', 'versus', 'vs', 'side by side', 'contrast', 'differentiate', 'benchmark', 'differences'
    ],

    synonyms: [
        'match up', 'stack up', 'weigh', 'put against',
        'how does x stack against', 'differences between',
        'compare with', 'compare to', 'compare against',
        'which is better', 'which one is better',
        'difference between', 'better between',
        'vs', 'v/s',
        'is x better than y', 'compare these', 'show differences', 'compare prices',
        'contrast features', 'compare models', 'stack them up', 'which one should i get'
    ],

    parameters: {
        products: { type: 'list', required: false, description: 'List of product names ONLY (e.g. ["iphone 12", "samsung s21"]). Do NOT include comparison verbs or sentences.' },
        product_segments: { type: 'list', required: false, description: 'Structured product segments with localized metadata.' },
        product_name: { type: 'string', required: false, description: 'Single product name (fallback)' },
        query: { type: 'string', required: false, description: 'Single product query (fallback)' },
        category: { type: 'string', required: false, description: 'Category context' },
        attributes: { type: 'dict', required: false, description: 'Specific attributes to compare' },
        clause_words: { type: 'list', required: false, description: 'Detected semantic clauses' }
    },

    slotTags: ['[action]', '[product]', '[product]', '[clause]', '[category]'],

    toolName: 'product.compare',

    paramMap: {
        product_segments: 'product_segments',
        products: 'product_ids',
        product_name: 'product_ids',
        query: 'product_ids'
    },

    minProducts: 2,
    maxProducts: 4,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'grounding', 'comparison'],
        storeContext: 'none',
        historyDepth: 4,
        includeSummary: false,
        maxResponseTokens: 1024
    },
    microstates: {
        missing_products: {
            trigger: (params, entities) => {
                const products = params.products || [];
                const segments = params.product_segments || [];
                const hasProductName = !!params.product_name;
                // Need at least 2 products to compare; trigger if fewer
                return products.length < 2 && segments.length < 2 && !hasProductName;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.disambiguate',
                params: {
                    reason: 'compare_recommendations',
                    message: 'Which products would you like to compare?',
                    options: [],
                    controls: { more: true, recommendedIndex: 0 },
                    missingParam: 'products'
                }
            },
            termination: {
                maxMessages: 3,
                onFulfilled: ['products'],
                escalation: null
            },
            features: [
                'show_captured',
                { type: 'suggest_related_products' }
            ]
        }
    }
};
