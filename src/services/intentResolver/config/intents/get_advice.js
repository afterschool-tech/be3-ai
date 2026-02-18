/**
 * Intent: get_advice
 * Triggered when the user needs shopping advice, recommendations, or guidance.
 * This intent is AI-powered and should only fire when the user clearly needs guidance.
 */

module.exports = {
    name: 'get_advice',

    keywords: [
        'advice', 'should', 'ought', 'recommend', 'suggest', 'guidance', 'advisor',
        'should i buy', 'what to buy', 'recommend me'
    ],

    synonyms: [
        'buy', 'choose', 'pick',
        'what should i buy', 'what do you recommend', 'can you suggest',
        'recommendation', 'suggestion', 'tips', 'guide', 'advice for',
        'i need advice', 'help me choose', 'help me decide',
        'which one should i get', 'what is the best', 'best option',
        'i am confused', 'not sure what to pick', 'guide me',
        'what would you suggest', 'any recommendations', 'tips for buying'
    ],

    parameters: {
        category: { type: 'string', required: false, description: 'Category the user needs advice about' },
        need: { type: 'string', required: false, description: 'Specific need or use case (e.g. "gaming", "budget", "a gift")' },
        query: { type: 'string', required: false, description: 'The full advice query from the user' }
    },

    toolName: 'conversation.getAdvice',

    paramMap: {
        category: 'category',
        need: 'need',
        query: 'query'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
