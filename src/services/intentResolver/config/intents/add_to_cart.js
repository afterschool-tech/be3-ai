/**
 * Intent: add_to_cart
 * Triggered when the user wants to add a product to their shopping cart.
 */

const { normalizeCategory } = require('../../../../utils/normalization');

module.exports = {
    name: 'add_to_cart',

    keywords: [
        'add', 'cart', 'basket', 'bag', 'select'
    ],

    synonyms: [
        'throw in', 'put in', 'grab', 'cop',
        "i'll take", 'gimme', 'hook me up with', 'i would like',
        'add to cart', 'add to basket', 'add to bag',
        'put in cart', 'put in basket', 'put in bag',
        'add it to cart', 'add this to cart', 'add that to cart',
        'add it to my cart', 'add this to my cart', 'add that to my cart',
        'buy it', 'purchase it', 'order it',
        'let me get', 'let me buy', 'grab', 'cop',
        'pick this', 'want this', 'need this', 'add to my selection',
        'put this in', 'get this', 'buy this', 'secure this',
        'save this to cart', 'move to cart', 'include this'
    ],

    parameters: {
        products: { type: 'list', required: false, description: 'List of product names ONLY (e.g. ["iphone 12"]). Do NOT include cart verbs or sentences.' },
        product_name: { type: 'string', required: false, description: 'Single product name (fallback)' },
        category: { type: 'string', required: false, description: 'Category filter' },
        quantity: { type: 'int', required: false, default: 1, description: 'Quantity to add' },
        attributes: { type: 'dict', required: false, description: 'Product attributes like color, size' },
        clause_words: { type: 'list', required: false, description: 'Detected semantic clauses' }
    },

    slotTags: ['[action]', '[product]', '[quantity]', '[clause]', '[category]'],

    toolName: 'cart.add',

    paramMap: {
        products: { target: 'product_id', expand: true },
        product_name: 'product_id',
        quantity: 'quantity',
        category: 'category'
    },

    minProducts: 1,
    maxProducts: null,
    invertTo: 'remove_from_cart',

    /**
     * Microstate trigger declarations.
     * Auto-collected by microstateRegistry at boot time.
     * 
     * Each trigger has:
     *   trigger(params, entities) → boolean
     *   sandbox: 'soft' | 'hard'
     *   boostScore: number
     *   prompt: { tool, params } — what tool to execute when triggered
     *   termination: { maxMessages, onFulfilled, onKeyword, escalation }
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
            }
        },

        product_is_category: {
            trigger: (params, entities) => {
                // If context reconciler already resolved specific products, skip
                // NOTE: Pipeline sets _resolved_product_id (not product_id) — must check both
                if (params.product_id || params._resolved_product_id || (params.products && params.products.length > 0 && params.products[0] !== params.product_name)) {
                    return false;
                }

                // Ignore generic placeholders
                const genericWords = ['something', 'product', 'item', 'stuff', 'one'];
                const isGeneric = (name) => genericWords.includes(name?.toLowerCase());

                if (!params.product_name && !params.products) return false;
                const name = params.product_name || (params.products && params.products[0]);
                if (!name || isGeneric(name)) return false;

                // If entities already identified this as a resolved_product (e.g. via IntelliSense),
                // it's a specific product — don't treat it as a category.
                if (Array.isArray(entities) && entities.some(e => e.type === 'resolved_product')) {
                    return false;
                }

                // If the name contains digits (model numbers like "iphone 15", "samsung s24"),
                // it's a specific product, not a category. Only exact category matches should trigger.
                const hasModelNumber = /\d/.test(name);

                // Only trigger when the product name itself clearly resolves to a category
                // (e.g. "add iphones to cart" where "iphones" is a category),
                // not just because some unrelated category entity exists.
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

                // If pipeline already resolved a product, don't ask again
                if (params._resolved_product_id || params.product_id) return false;

                const hasNoParams = !params.product_name && !params.products && (!params.query || params.query.length < 2);
                const hasGenericParam = isGeneric(params.product_name) || (params.products && isGeneric(params.products[0]));

                return hasNoParams || hasGenericParam;
            },
            sandbox: 'soft',
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.collect',
                params: {
                    paramName: 'product_name',
                    message: 'What product would you like to add to your cart?',
                    hint: 'e.g., "iPhone 16" or "Samsung Galaxy S24"'
                }
            },
            termination: {
                maxMessages: 2,
                onFulfilled: ['product_name'],
                escalation: null
            }
        }
    }
};
