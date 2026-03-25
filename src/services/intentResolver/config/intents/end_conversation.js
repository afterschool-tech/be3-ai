/**
 * Intent: end_conversation
 * Triggered when the user wants to end the chat / say goodbye.
 */

module.exports = {
    name: 'end_conversation',

    keywords: [
        'bye', 'goodbye', 'end', 'done', 'exit'
    ],

    synonyms: [
        'see you later', 'talk to you later', 'thanks bye',
        'that is all', "that's all", 'nothing else', 'i am done',
        "i'm done", 'close chat', 'end chat', 'finish',
        'later', 'peace', 'catch you later', 'gotta go'
    ],

    parameters: {},

    toolName: 'conversation.end',

    paramMap: {},

    minProducts: 0,
    maxProducts: 0,
    invertTo: null,

    dco: {
        segments: ['core', 'formatting'],
        storeContext: 'none',
        historyDepth: 3,
        includeSummary: false,
        maxResponseTokens: 256
    }
};
