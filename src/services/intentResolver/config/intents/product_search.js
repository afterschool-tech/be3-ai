/**
 * Intent: product_search
 * Triggered when the user wants to find, browse, or search for products.
 */

module.exports = {
    name: 'product_search',

    keywords: [
        'search', 'find', 'show', 'discovery', 'explore', 'inspect', 'examine'
    ],

    synonyms: [
        'look', 'browse', 'show me', 'let me see', 'i want to see', 'looking for',
        'do you have', 'what do you have', 'any', 'got any',
        'help me find', 'where can i find',
        'display', 'view', 'buy', 'want', 'get', 'need',
        'hi', 'hello', 'hey', 'start', 'onboarding',
        'pull up', 'filter for', 'can i see', 'is there any', 'search for', 'find me',
        'catalogue', 'gallery', 'list products', 'check for', 'recommend', 'suggestions',
        'what is in stock', 'what items'
    ],

    parameters: {
        products: { type: 'list', required: false, description: 'List of product names' },
        product_name: { type: 'string', required: false, description: 'Extracted product name or keywords ONLY' },
        category: { type: 'string', required: false, description: 'Category filter' },
        price_min: { type: 'number', required: false, description: 'Minimum price' },
        price_max: { type: 'number', required: false, description: 'Maximum price' },
        sort: { type: 'string', required: false, description: 'Sort order' },
        limit: { type: 'int', required: false, default: 5, description: 'Number of results' },
        clause_words: { type: 'list', required: false, description: 'Detected semantic clauses' },
        attributes: { type: 'dict', required: false, description: 'Dynamic attribute filters' },
        similar_to: { type: 'string', required: false, description: 'The Product ID or Handle to find products similar to' }
    },
    
    slotTags: ['[clause]', '[product]', '[category]', '[price]'],
    
    toolName: 'product.search',
    
    paramMap: {
        query: 'query',
        products: { target: 'query', expand: false },
        product_name: 'query',
        category: 'category',
        price_min: 'price_min',
        price_max: 'price_max',
        sort: 'sort',
        limit: 'limit',
        attributes: 'attributes',
        similar_to: 'similar_to',
        clause_words: 'clause_words'
    },

    minProducts: 1,
    maxProducts: null,
    invertTo: null,

    microstates: {
        missing_query: {
            trigger: (params, entities) => {
                return !params.query && !params.product_name && !params.category;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.collect',
                params: {
                    paramName: 'query',
                    message: 'What would you like to search for?',
                    hint: 'e.g., "cheap smartphones" or "blue shirts"'
                }
            },
            termination: {
                maxMessages: 2,
                onFulfilled: ['query'],
                escalation: null
            }
        }
    }
};
