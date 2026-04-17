/**
 * Stage Gate Configuration
 * 
 * Defines which pipeline stages run for each L2 Intent.
 * Used by the pipeline orchestrator to skip irrelevant stages.
 * 
 * Gate values:
 *   true        — always runs for this intent
 *   false       — never runs for this intent
 *   'fallback'  — runs only if a prior stage failed to resolve
 *   'vendor_only' — runs entity extraction but only for vendor detection
 *   'write'     — search context write mode
 *   'read'      — search context read mode
 */

const STAGE_GATES = {
    // ── Discovery Class ──

    Product_Research: {
        contextResolution: false,
        entityExtraction: true,
        categoryDetection: true,   // Skipped at runtime if resolved products exist
        pie: true,
        inventoryCheck: true,
        searchContext: 'write'
    },

    Product_Analysis: {
        contextResolution: true,
        entityExtraction: false,
        categoryDetection: false,
        pie: false,
        inventoryCheck: false,
        searchContext: false
    },

    // ── Shopping Management Class ──

    Cart_Management: {
        contextResolution: true,
        entityExtraction: false,
        categoryDetection: false,
        pie: 'fallback',           // Only if context resolution finds nothing
        inventoryCheck: false,
        searchContext: 'read'
    },

    Wishlist_Management: {
        contextResolution: true,
        entityExtraction: false,
        categoryDetection: false,
        pie: 'fallback',
        inventoryCheck: false,
        searchContext: 'read'
    },

    Checkout_Flow: {
        contextResolution: false,
        entityExtraction: false,
        categoryDetection: false,
        pie: false,
        inventoryCheck: false,
        searchContext: false
    },

    Post_Purchase: {
        contextResolution: false,
        entityExtraction: false,
        categoryDetection: false,
        pie: false,
        inventoryCheck: false,
        searchContext: false
    },

    // ── Vendor Intelligence Class ──

    Vendor_Lookup: {
        contextResolution: false,
        entityExtraction: 'vendor_only',
        categoryDetection: false,
        pie: false,
        inventoryCheck: false,
        searchContext: false
    },

    Vendor_Catalog_Exploration: {
        contextResolution: false,
        entityExtraction: true,
        categoryDetection: true,
        pie: false,
        inventoryCheck: false,
        searchContext: false
    },

    Vendor_Direct_Contact: {
        contextResolution: false,
        entityExtraction: 'vendor_only',
        categoryDetection: false,
        pie: false,
        inventoryCheck: false,
        searchContext: false
    },

    // ── Support & Feedback Class ──

    Assistance_Request: {
        contextResolution: false,
        entityExtraction: false,
        categoryDetection: false,
        pie: false,
        inventoryCheck: false,
        searchContext: false
    },

    Platform_Feedback: {
        contextResolution: false,
        entityExtraction: false,
        categoryDetection: false,
        pie: false,
        inventoryCheck: false,
        searchContext: false
    }
};

/**
 * Get the stage gates for a given L2 intent.
 * Returns a default "all-off" config if the intent is not found.
 * @param {string} intentName - L2 intent name, e.g. 'Cart_Management'
 * @returns {Object} gate config
 */
function getGates(intentName) {
    return STAGE_GATES[intentName] || {
        contextResolution: false,
        entityExtraction: false,
        categoryDetection: false,
        pie: false,
        inventoryCheck: false,
        searchContext: false
    };
}

module.exports = { STAGE_GATES, getGates };
