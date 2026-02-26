/**
 * ContextResolver guard lists.
 *
 * These lists are used to prevent over-aggressive reference_map replacement
 * in cases where the user is clearly mentioning a new model/product.
 */

const MODEL_QUALIFIER_WORDS = new Set([
    'pro', 'max', 'plus', 'mini', 'ultra', 'se',
    'series', 'fold', 'flip', 'note', 'edge', 'air'
]);

module.exports = {
    MODEL_QUALIFIER_WORDS
};
