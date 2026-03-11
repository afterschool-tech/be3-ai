/**
 * Stop Words
 * Common words to skip during fuzzy matching.
 * These should not be corrected or treated as keywords.
 */

module.exports = [
    'the', 'a', 'an', 'is', 'are', 'was', 'were',
    'to', 'for', 'of', 'in', 'on', 'at', 'by',
    'my', 'me', 'i', 'we', 'you', 'your', 'our',
    'with', 'from', 'about', 'into', 'through',
    'please', 'can', 'could', 'would', 'will', 'shall',
    'just', 'like', 'some', 'any', 'all', 'each',
    'do', 'does', 'did', 'have', 'has', 'had',
    'be', 'been', 'being', 'am',
    'if', 'or', 'but', 'so', 'yet', 'nor',
    'up', 'out', 'off', 'over', 'under',
    'very', 'too', 'really', 'quite',
    'looking', 'search', 'searching', 'find', 'list', 'show', 'give', 'me',
    'available', 'stock', 'store', 'shop', 'order', 'buy', 'purchase',
    'need', 'want', 'tell', 'info', 'details', 'check', 'price',
    'something', 'someone', 'some', 'any', 'good', 'best', 'popular',
    'item', 'items', 'product', 'products', 'thing', 'things'
];
