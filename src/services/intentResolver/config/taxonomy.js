/**
 * Intent Taxonomy — Hierarchical Classification Map
 * 
 * Defines the 3-tier hierarchy: CLASS → INTENT → SUB-INTENT
 * Used by the pipeline orchestrator for hierarchical narrowing
 * and by the transformer for fragmented KB selection.
 * 
 * Structure:
 *   Class (L1) → Intent (L2) → [Sub-Intents (L3)]
 * 
 * Rules:
 * - Each sub-intent appears in exactly ONE location.
 * - `conversation` and `end_conversation` are handled by IntelliSense
 *   short-circuit and do not participate in the hierarchy.
 */

const TAXONOMY = {
    Discovery: {
        Product_Research: [
            'product_search',
            'semantic_search',
            'browse_collection',
            'facet_list'
        ],
        Product_Analysis: [
            'get_product_details',
            'product_compare',
            'product_similar'
        ]
    },

    Shopping_Management: {
        Cart_Management: [
            'add_to_cart',
            'remove_from_cart',
            'update_cart_quantity',
            'view_cart'
        ],
        Wishlist_Management: [
            'add_to_wishlist',
            'remove_from_wishlist',
            'view_wishlist',
            'move_to_cart'
        ],
        Checkout_Flow: [
            'start_checkout',
            'set_delivery',
            'confirm_order',
            'check_availability'
        ],
        Post_Purchase: [
            'order_status',
            'list_orders',
            'cancel_order',
            'return_item'
        ]
    },

    Vendor_Intelligence: {
        Vendor_Lookup: [
            'list_vendors',
            'vendor_info',
            'vendor_identity'
        ],
        Vendor_Catalog_Exploration: [
            'vendor_products',
            'vendor_facet'
        ],
        Vendor_Direct_Contact: [
            'vendor_contact'
        ]
    }
};

// ── Derived lookup maps (built once at require-time) ──

/**
 * Reverse lookup: sub-intent name → { class, intent }
 * e.g., 'add_to_cart' → { class: 'Shopping_Management', intent: 'Cart_Management' }
 */
const SUBINTENT_TO_HIERARCHY = {};

/**
 * All class names as an array.
 */
const CLASS_NAMES = Object.keys(TAXONOMY);

/**
 * Intent names per class.
 * e.g., { Discovery: ['Product_Research', 'Product_Analysis'], ... }
 */
const INTENTS_BY_CLASS = {};

/**
 * Sub-intent names per intent.
 * e.g., { Cart_Management: ['add_to_cart', 'remove_from_cart', ...], ... }
 */
const SUBINTENTS_BY_INTENT = {};

for (const [className, intents] of Object.entries(TAXONOMY)) {
    INTENTS_BY_CLASS[className] = Object.keys(intents);

    for (const [intentName, subIntents] of Object.entries(intents)) {
        SUBINTENTS_BY_INTENT[intentName] = subIntents;

        for (const subIntent of subIntents) {
            SUBINTENT_TO_HIERARCHY[subIntent] = {
                class: className,
                intent: intentName
            };
        }
    }
}

module.exports = {
    TAXONOMY,
    SUBINTENT_TO_HIERARCHY,
    CLASS_NAMES,
    INTENTS_BY_CLASS,
    SUBINTENTS_BY_INTENT
};
