/**
 * Intent: product_compare
 * Triggered when the user wants to compare two or more products side by side.
 */

module.exports = {
    name: 'product_compare',

    keywords: [
        'compare', 'comparison', 'versus', 'vs', 'side by side'
    ],

    synonyms: [
        'match up', 'stack up', 'weigh', 'put against',
        'how does x stack against', 'differences between',
        'compare with', 'compare to', 'compare against',
        'which is better', 'which one is better',
        'difference between', 'better between',
        'vs', 'v/s'
    ],

    parameters: {
        products: { type: 'list', required: false, description: 'List of product names ONLY (e.g. ["iphone 12", "samsung s21"]). Do NOT include comparison verbs or sentences.' },
        product_name: { type: 'string', required: false, description: 'Single product name (fallback)' },
        query: { type: 'string', required: false, description: 'Single product query (fallback)' },
        category: { type: 'string', required: false, description: 'Category context' },
        attributes: { type: 'dict', required: false, description: 'Specific attributes to compare' },
        clause_words: { type: 'list', required: false, description: 'Detected semantic clauses' }
    },

    slotTags: ['[action]', '[product]', '[product]', '[clause]', '[category]'],

    toolName: 'product.compare',

    paramMap: {
        products: 'product_ids',
        product_name: 'product_ids',
        query: 'product_ids'
    },

    minProducts: 2,
    maxProducts: 4,
    invertTo: null,

    microstates: {
        missing_products: {
            trigger: (params, entities) => {
                const products = params.products || [];
                const hasProductName = !!params.product_name;
                // Need at least 2 products to compare; trigger if fewer
                return products.length < 2 && !hasProductName;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.collect',
                params: {
                    paramName: 'products',
                    message: 'Which products would you like to compare?',
                    hint: 'e.g., "iPhone 16 and Galaxy S24"'
                }
            },
            termination: {
                maxMessages: 3,
                onFulfilled: ['products'],
                escalation: null
            }
        }
    }
};
