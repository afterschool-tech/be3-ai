/**
 * Intent: get_help
 * Class: Support_Feedback > Assistance_Request
 * Triggered when the user asks for help, guidance, or wants to understand
 * how the platform or a feature works. Routes to rag.query to serve
 * indexed policy, capability, and platform knowledge chunks.
 */

module.exports = {
    name: 'get_help',
    class: 'Support_Feedback',
    intent: 'Assistance_Request',

    keywords: [
        'help', 'guide', 'how', 'explain', 'understand', 'assist', 'support', 'tutorial'
    ],

    synonyms: [
        'i need help', 'can you help me', 'how do i', 'i have a question',
        'help me figure this out', 'i don\'t understand', 'can you guide me',
        'i\'m confused about', 'can you explain', 'i need some guidance',
        'what can you do', 'what is be3', 'how does this work',
        'i\'m lost', 'can someone help', 'need assistance'
    ],

    parameters: {
        query: { type: 'string', required: true, description: 'The full user question or help request' }
    },

    toolName: 'rag.query',

    paramMap: {
        query: 'query'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'capabilities', 'rag_context', 'grounding'],
        storeContext: 'none',
        historyDepth: 5,
        includeSummary: true,
        maxResponseTokens: 512
    }
};
