/**
 * Intent: test_microstate
 * Test intent that triggers a microstate confirmation prompt when user says "dami"
 * This demonstrates microstate functionality with yes/no button clicks.
 */

module.exports = {
    name: 'test_microstate',

    keywords: [
        'dami'
    ],

    synonyms: [
        'dami microstate',
        'dami confirmation',
        'dami buttons'
    ],

    parameters: {
        // No parameters needed - this is just a trigger
    },

    slotTags: ['[action]'],

    toolName: 'conversation.test_response', // Simple response tool

    paramMap: {
        confirmation: 'confirmation'
    },

    /**
     * Microstate trigger declarations.
     * This intent always triggers a microstate confirmation prompt.
     */
    microstates: {
        test_confirmation: {
            // Always trigger when this intent is detected
            trigger: (params, entities) => {
                return true; // Always fire for demonstration
            },
            sandbox: 'soft', // Allow breakthrough if user says something else
            boostScore: 10.0,
            prompt: {
                tool: 'microstate.confirm',
                params: {
                    question: 'This is a test microstate! Do you want to proceed?',
                    context: {
                        'Intent': 'test_microstate',
                        'Purpose': 'Demonstrating microstate confirmation with yes/no buttons'
                    }
                }
            },
            termination: {
                maxMessages: 5, // Allow up to 5 messages in the microstate
                onFulfilled: ['confirmation'], // Expect a confirmation parameter
                onKeyword: ['cancel', 'nevermind', 'stop', 'no'],
                escalation: null
            },
            // Validators for the confirmation response
            validators: {
                confirmation: (value) => {
                    const lower = String(value).toLowerCase().trim();
                    // Accept yes/no variations
                    const yesWords = ['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay', 'proceed', 'continue'];
                    const noWords = ['no', 'n', 'nope', 'nah', 'cancel', 'stop'];
                    
                    if (yesWords.includes(lower)) return { valid: true, normalized: true };
                    if (noWords.includes(lower)) return { valid: true, normalized: false };
                    
                    return { valid: false, error: 'Please answer yes or no' };
                }
            },
            // Normalizers to convert yes/no to boolean
            normalizers: {
                confirmation: (value) => {
                    const lower = String(value).toLowerCase().trim();
                    const yesWords = ['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay', 'proceed', 'continue'];
                    return yesWords.includes(lower);
                }
            }
        }
    }
};
