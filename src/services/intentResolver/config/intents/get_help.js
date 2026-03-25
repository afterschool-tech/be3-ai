/**
 * Intent: get_help
 * Triggered when the user asks for help or wants to know what the bot can do.
 */

module.exports = {
    name: 'get_help',

    keywords: [
        'help', 'assist', 'support', 'guide', 'explain', 'manual', 'options', 'services',
        'compatibility', 'maintenance', 'installation', 'tips'
    ],

    synonyms: [
        'what can you do', 'how do i', 'help me', 'i need help',
        'i need assistance', 'show me how', 'what are your features',
        'what do you offer', 'how does this work', 'instructions',
        'tutorial', 'usage', 'capabilities', 'menu',
        'how to use', 'what can i ask', 'what are my options', 'help with usage',
        'show commands', 'what is possible', 'bot guide',
        'is it compatible', 'how to install', 'maintenance guide', 'tips and tricks'
    ],

    parameters: {
        product_name: { type: 'string', required: false, description: 'Optional product name to provide help for' }
    },

    toolName: 'conversation.help',

    paramMap: {
        product_name: 'product_name'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
