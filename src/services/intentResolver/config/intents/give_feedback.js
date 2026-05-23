/**
 * Intent: give_feedback
 * Class: Support_Feedback > Platform_Feedback
 * Triggered when the user wants to leave a review, complaint, report a bug,
 * or give feedback about a product or the platform. Routes to rag.query to
 * surface the correct feedback/contact/support policy chunks.
 */

module.exports = {
    name: 'give_feedback',
    class: 'Support_Feedback',
    intent: 'Platform_Feedback',

    keywords: [
        'feedback', 'review', 'complaint', 'report', 'issue', 'problem', 'rate', 'rating', 'bug'
    ],

    synonyms: [
        'i want to give feedback', 'i have a complaint', 'i want to leave a review',
        'something is wrong', 'i want to report an issue', 'your app has a bug',
        'i want to share my experience', 'this platform needs improvement',
        'i have a suggestion', 'how do i report', 'how do i review',
        'file a complaint', 'submit feedback', 'rate my experience'
    ],

    parameters: {
        query: { type: 'string', required: true, description: 'The full user feedback message or complaint' }
    },

    toolName: 'rag.query',

    paramMap: {
        query: 'query'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting', 'rag_context', 'grounding'],
        storeContext: 'none',
        historyDepth: 4,
        includeSummary: false,
        maxResponseTokens: 512
    }
};
