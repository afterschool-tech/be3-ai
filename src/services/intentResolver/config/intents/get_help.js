/**
 * Intent: get_help
 * Triggered when the user asks for help or wants to know what the bot can do.
 */

module.exports = {
    name: 'get_help',

    keywords: [
        'help', 'assist', 'support', 'guide'
    ],

    synonyms: [
        'what can you do', 'how do i', 'help me', 'i need help',
        'i need assistance', 'show me how', 'what are your features',
        'what do you offer', 'how does this work', 'instructions',
        'tutorial', 'usage', 'capabilities', 'menu'
    ],

    parameters: {},

    toolName: 'conversation.help',

    paramMap: {},

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
