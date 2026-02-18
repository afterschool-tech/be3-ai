/**
 * Intent Inversions
 * When a negation is detected before an intent's keywords,
 * the intent is remapped to its inverse.
 */

module.exports = {
    'add_to_cart': 'remove_from_cart',
    'remove_from_cart': 'add_to_cart'
};
