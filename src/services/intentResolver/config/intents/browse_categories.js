/**
 * Intent: browse_categories
 * Triggered when the user wants to see a list of available categories or departments.
 */

module.exports = {
    name: 'browse_categories',

    keywords: [
        'categories', 'departments', 'sections'
    ],

    synonyms: [
        'what are your categories', 'top categories', 'show me categories',
        'all categories', 'what do you sell', 'what do you have',
        'list categories', 'what kinds of products', 'what types of products',
        'what sections', 'browse categories', 'product categories'
    ],

    parameters: {},

    toolName: 'store.getCategories',

    paramMap: {},

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
