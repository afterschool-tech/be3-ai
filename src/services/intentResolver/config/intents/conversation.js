/**
 * Intent: conversation
 * Triggers when the user is engaging in general chit-chat or when an intent is downgraded
 * due to low signal density and unsure transformer scores.
 */

module.exports = {
    name: 'conversation',

    keywords: [
        'hi', 'hello', 'hey', 'okay', 'ok', 'good', 'nice', 'cool', 'thanks', 'thank you'
    ],

    synonyms: [
        'how are you', 'how is it going', 'how are things', 'greetings', 'morning', 'evening'
    ],

    parameters: {},

    toolName: 'conversation.chat', // Virtual tool handled by personality layer

    paramMap: {},

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'capabilities'],
        storeContext: 'none',
        historyDepth: 6,
        includeSummary: true,
        maxResponseTokens: 512
    }
};
