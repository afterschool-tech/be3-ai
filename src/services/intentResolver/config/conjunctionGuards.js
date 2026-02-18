/**
 * Conjunction Guards
 * Keywords that, when appearing before a conjunction like "and",
 * indicate the conjunction is connecting operands (e.g., products),
 * NOT separating distinct intents.
 * 
 * Example: "compare iPhone and Galaxy" → "and" connects products, don't split.
 * Example: "add iPhone to cart and check my order" → "and" separates intents, DO split.
 */

module.exports = [
    'compare',
    'comparison',
    'versus',
    'vs',
    'between',
    'difference',
    'differences',
    'match',
    'side by side'
];
