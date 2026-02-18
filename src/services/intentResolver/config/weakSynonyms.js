/**
 * Weak Synonyms — Generic intent phrases
 * These phrases indicate a DESIRE but don't uniquely identify any intent.
 * "I want to compare" means comparison, not cart addition.
 * "I need you to add" means cart, not just generic need.
 * 
 * When detected, they score much lower (0.3) to avoid
 * overpowering specific action keywords like "compare" or "search".
 */

module.exports = [
    'i want',
    'i need',
    'i would like',
    'i wanna',
    'i gotta',
    'can you',
    'could you',
    'please',
    'help me',
    'let me',
    'i want to buy',
    'i want to purchase',
    'i want to get',
    'i want to order',
    'i want to have',
    'can i buy',
    'can i get',
    "i'll take",
    'grab',
    'cop',
    'gimme',
    'hook me up with',
    'let me get',
    'let me buy'
];
