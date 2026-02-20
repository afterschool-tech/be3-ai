/**
 * Microstate Tools
 * Purpose-built tools for microstate-driven user interactions.
 * 
 * These tools return directResponse: true, which tells the response layer
 * to send the message directly to the user WITHOUT going through AI generation.
 * This prevents personality corruption and ensures deterministic, structured prompts.
 * 
 * Conversation history is still updated for context preservation.
 */

const microstateTools = {

    /**
     * Present options to the user and ask them to pick.
     * Used for: category disambiguation, product selection, ambiguous matches.
     */
    'microstate.disambiguate': {
        description: 'Present disambiguation options to the user within a microstate sandbox.',
        params: {
            reason: { type: 'string', required: true, description: 'Why disambiguation is needed (category_match, multiple_results, etc.)' },
            message: { type: 'string', required: true, description: 'Human-readable question to ask' },
            options: { type: 'array', required: false, description: 'Structured options: [{ label, value }]' },
            parentIntent: { type: 'string', required: false, description: 'The intent that opened this microstate' },
            missingParam: { type: 'string', required: false, description: 'The parameter we need' }
        },
        handler: async (params, context) => {
            const { reason, message, options, parentIntent, missingParam } = params;

            // Build numbered option list if options provided
            let formattedMessage = message;
            if (options && options.length > 0) {
                const optionList = options.map((opt, i) => {
                    const label = typeof opt === 'string' ? opt : opt.label;
                    const price = opt.price ? ` — ${opt.price}` : '';
                    return `${i + 1}. ${label}${price}`;
                }).join('\n');
                formattedMessage = `${message}\n\n${optionList}`;
            }

            return {
                directResponse: true,
                message: formattedMessage,
                options: options || [],
                action: 'disambiguation_requested',
                reason,
                parentIntent,
                missingParam,
                updateHistory: true
            };
        }
    },

    /**
     * Ask user for yes/no confirmation.
     * Used for: checkout confirm, destructive actions, order cancellation.
     */
    'microstate.confirm': {
        description: 'Ask the user for a yes/no confirmation within a microstate sandbox.',
        params: {
            question: { type: 'string', required: true, description: 'The confirmation question' },
            context: { type: 'dict', required: false, description: 'Context to display (order summary, etc.)' }
        },
        handler: async (params) => {
            const { question, context: displayContext } = params;

            let formattedMessage = question;
            if (displayContext) {
                // Build a context summary above the question
                const contextLines = Object.entries(displayContext)
                    .map(([key, val]) => `• ${key}: ${val}`)
                    .join('\n');
                formattedMessage = `${contextLines}\n\n${question}`;
            }

            return {
                directResponse: true,
                message: formattedMessage,
                expects: 'yes_no',
                action: 'confirmation_requested',
                updateHistory: true,
                // WhatsApp-optimized: can be rendered as button message
                whatsapp: {
                    type: 'button',
                    buttons: [
                        { id: 'ms_yes', title: 'Yes' },
                        { id: 'ms_no', title: 'No' }
                    ]
                }
            };
        }
    },

    /**
     * Ask user for a specific missing value.
     * Used for: collecting order ID, delivery address, payment method, quantity.
     */
    'microstate.collect': {
        description: 'Ask the user for a specific missing parameter value.',
        params: {
            paramName: { type: 'string', required: true, description: 'Name of the parameter to collect' },
            message: { type: 'string', required: true, description: 'Human-readable prompt' },
            parentIntent: { type: 'string', required: false, description: 'The intent that needs this param' },
            hint: { type: 'string', required: false, description: 'Example or format hint (e.g. "e.g., #12345")' }
        },
        handler: async (params) => {
            const { paramName, message, parentIntent, hint } = params;

            let formattedMessage = message;
            if (hint) {
                formattedMessage = `${message}\n_(${hint})_`;
            }

            return {
                directResponse: true,
                message: formattedMessage,
                action: 'param_collection_requested',
                paramName,
                parentIntent,
                updateHistory: true
            };
        }
    }
};

module.exports = microstateTools;
