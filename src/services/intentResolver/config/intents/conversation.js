/**
 * Intent: conversation
 * Triggers when the user is engaging in general chit-chat or when an intent is downgraded
 * due to low signal density and unsure transformer scores.
 */

module.exports = {
    name: 'conversation',

    keywords: [
        'hi', 'hello', 'hey', 'okay', 'ok', 'good', 'nice', 'cool', 'thanks', 'thank you',
        'help', 'assist', 'support', 'guide', 'explain', 'manual', 'options', 'services',
        'policy', 'feedback', 'issue', 'complaint'
    ],

    synonyms: [
        'how are you', 'how is it going', 'how are things', 'greetings', 'morning', 'evening',
        'what can you do', 'how do i', 'help me', 'i need help',
        'what are your features', 'what do you offer', 'how does this work'
    ],

    parameters: {
        query: { type: 'string', required: true, description: 'The raw user message or question to answer' },
        vendor: { type: 'string', required: false, description: 'Vendor ID extracted from context, if any' },
        category: { type: 'string', required: false, description: 'Category ID extracted from context, if any' }
    },

    toolName: 'rag.query', // Canonical RAG knowledge tool

    paramMap: {
        query: 'query',
        vendor: 'vendor',
        category: 'category'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'capabilities', 'rag_context', 'grounding'],
        storeContext: 'none',
        historyDepth: 6,
        includeSummary: true,
        maxResponseTokens: 512
    }
};
