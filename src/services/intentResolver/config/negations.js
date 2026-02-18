/**
 * Negation Patterns
 * Prefixes and regex patterns that invert the meaning of an intent.
 */

const prefixes = [
    "don't",
    'do not',
    'dont',
    'never',
    'stop',
    'no',
    "won't",
    'will not',
    'cancel',
    "shouldn't",
    'should not',
    "can't",
    'cannot',
    'not'
];

const patterns = [
    /\b(don'?t|do\s*not|never|stop|cancel|won'?t|can'?t|cannot|shouldn'?t|should\s*not)\s+/i
];

module.exports = { prefixes, patterns };
