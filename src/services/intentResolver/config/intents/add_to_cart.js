const { normalizeCategory } = require('../../../../utils/normalization');

/**
 * Intent: add_to_cart
 * Triggered when the user wants to add one or more products to their shopping cart.
 */

module.exports = {
    name: 'add_to_cart',

    keywords: [
        'add', 'buy', 'get', 'purchase', 'put', 'cart', 'order', 'basket', 'want', 'need'
    ],

    synonyms: [
        'add to cart', 'add to basket', 'buy now', 'purchase',
        'put in cart', 'put in basket', 'i want to buy',
        'add [product] to cart', 'order [product]', 'get [product]',
        'i need [product]', 'put [product] in my basket'
    ],

    parameters: {
        products: { type: 'list', required: true, description: 'List of product names to add.' },
        product_name: { type: 'string', required: false, description: 'Single product name (fallback)' },
        quantity: { type: 'number', required: false, description: 'Number of items to add' },
        _require_confirmation: { type: 'boolean', required: false, description: 'Internal flag for ported confirmation' }
    },

    slotTags: ['[product]', '[quantity]'],

    toolName: 'cart.add',

    paramMap: {
        products: { target: 'product_id', expand: true },
        product_name: 'product_id',
        quantity: 'quantity'
    },

    minProducts: 1,
    maxProducts: 10,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'grounding', 'vendor_rules', 'suggestions'],
        storeContext: 'none',
        historyDepth: 4,
        includeSummary: false,
        maxResponseTokens: 1024
    },

    /**
     * Microstates:
     *  - confirm_add_ported: Handles the "Do you want to add X?" confirmation after porting from a search.
     *  - product_is_category: Catches broad category requests (e.g. "add smartphones") and asks for specifics.
     *  - missing_product: Re-prompts for a product name if the initial request was too vague.
     */
    microstates: {
        confirm_add_ported: {
            trigger: (params, entities) => {
                return params && params._require_confirmation === true;
            },
            sandbox: 'hard',
            boostScore: 10.0,
            validators: {
                confirmation: (v) => v === true
            },
            prompt: {
                tool: 'microstate.confirm',
                params: {
                    question: 'Do you want me to add this to your cart?'
                }
            },
            termination: {
                maxMessages: 2,
                onFulfilled: ['confirmation'],
                onKeyword: ['no', 'nah', 'nope', 'cancel', 'nevermind', 'stop', 'ms_no'],
                escalation: null
            },
            features: [
                'show_captured'
            ]
        },

        product_is_category: {
            trigger: (params, entities) => {
                // If context reconciler already resolved specific products, skip
                if (params.product_id || params._resolved_product_id || (params.products && params.products.length > 0 && params.products[0] !== params.product_name)) {
                    return false;
                }

                // Ignore generic placeholders
                const genericWords = ['something', 'product', 'item', 'stuff', 'one'];
                const isGeneric = (name) => genericWords.includes(name?.toLowerCase());

                if (!params.product_name && !params.products) return false;
                const name = params.product_name || (params.products && params.products[0]);
                if (!name || isGeneric(name)) return false;

                // If entities already identified this as a resolved_product, skip
                if (Array.isArray(entities) && entities.some(e => e.type === 'resolved_product')) {
                    return false;
                }

                const hasModelNumber = /\d/.test(name);
                const resolvedCatId = normalizeCategory(name, null, hasModelNumber, { debug: true, initiator: 'add_to_cart' });
                return !!resolvedCatId;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.disambiguate',
                params: {
                    reason: 'category_match',
                    message: 'Which specific product would you like to add to your cart?',
                    missingParam: 'product_name'
                }
            },
            termination: {
                maxMessages: 3,
                onFulfilled: ['product_name'],
                onKeyword: ['cancel', 'nevermind', 'stop'],
                escalation: 'product_search'
            }
        },

        missing_product: {
            trigger: (params, entities) => {
                const genericWords = ['something', 'product', 'item', 'stuff'];
                const isGeneric = (name) => name && genericWords.includes(name.toLowerCase());

                const hasValidName = params.product_name && !isGeneric(params.product_name);
                const hasValidProducts = Array.isArray(params.products) && params.products.length > 0 && !isGeneric(params.products[0]);

                return !hasValidName && !hasValidProducts;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.collect',
                params: {
                    paramName: 'product_name',
                    message: 'What product would you like to add to your cart?',
                    hint: 'e.g., "iPhone 15 Pro Max"'
                }
            },
            termination: {
                onFulfilled: ['product_name'],
                escalation: 'product_search'
            },
            features: [
                'show_captured',
                { type: 'suggest_related_products' }
            ]
        }
    }
};
