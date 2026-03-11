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
    'let me buy',
    'show me what you have',
    'show me what is in',
    'show me what is available',
    'what do you have',
    'what is available',
    'browse your',
    'browse the',
    'check out your',
    'check out the',
    'give me info on',
    'tell me about',
    'add this to my bag',
    'add to my cart',
    'add to the cart',
    'put this in my cart',
    'put it in my cart',
    'checkout now',
    'start checkout',
    'i am ready to buy',
    'i am ready to purchase',
    'i want to pay',
    'how much for',
    'what is the price of',
    'get me',
    'bring me'
];
