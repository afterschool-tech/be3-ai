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
            baseIndex: { type: 'number', required: false, description: '0-based index offset for global numbering (pagination)' },
            controls: { type: 'dict', required: false, description: 'Optional controls: { more: boolean, cancel: boolean, skip: boolean, recommendedIndex: number }' },
            parentIntent: { type: 'string', required: false, description: 'The intent that opened this microstate' },
            missingParam: { type: 'string', required: false, description: 'The parameter we need' }
        },
        handler: async (params, context) => {
            const { reason, message, options, baseIndex, controls, parentIntent, missingParam } = params;
            const offset = Number.isFinite(baseIndex) ? baseIndex : 0;
            const ctrl = controls || null;

            // Build numbered option list if options provided
            let formattedMessage = message;
            if (options && options.length > 0) {
                const optionList = options.map((opt, i) => {
                    const label = typeof opt === 'string' ? opt : opt.label;
                    const price = opt.price ? ` — ${opt.price}` : '';
                    return `${offset + i + 1}. ${label}${price}`;
                }).join('\n');
                formattedMessage = `${message}\n\n${optionList}`;
            }

            let whatsapp = null;
            if (Array.isArray(options) && options.length > 0) {
                if (options.length <= 3 && !ctrl) {
                    whatsapp = {
                        type: 'button',
                        buttons: options.slice(0, 3).map((opt, i) => {
                            const label = typeof opt === 'string' ? opt : opt.label;
                            return { id: String(offset + i + 1), title: label };
                        })
                    };
                } else if (ctrl) {
                    const buttons = [];
                    const recIndex = Number.isFinite(ctrl.recommendedIndex) ? ctrl.recommendedIndex : 0;
                    const rec = options[recIndex];
                    if (rec) {
                        const label = typeof rec === 'string' ? rec : rec.label;
                        buttons.push({ id: String(offset + recIndex + 1), title: label });
                    }
                    if (ctrl.more) buttons.push({ id: '__nav:more__', title: 'More' });
                    if (ctrl.cancel) buttons.push({ id: '__flow:cancel__', title: 'Cancel' });
                    if (ctrl.skip) buttons.push({ id: '__flow:skip__', title: 'Skip' });
                    whatsapp = {
                        type: 'button',
                        buttons: buttons.slice(0, 3)
                    };
                }
            }

            return {
                directResponse: true,
                message: formattedMessage,
                options: options || [],
                action: 'disambiguation_requested',
                reason,
                parentIntent,
                missingParam,
                updateHistory: true,
                whatsapp
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

            const buttons = [
                { id: 'ms_yes', title: 'Yes' },
                { id: 'ms_no', title: 'No' }
            ];

            // Standardize Cancel button as 3rd button if requested
            if (params.controls?.cancel) {
                buttons.push({ id: '__flow:cancel__', title: 'Cancel' });
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
                    buttons: buttons.slice(0, 3)
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
            hint: { type: 'string', required: false, description: 'Example or format hint (e.g. "e.g., #12345")' },
            controls: { type: 'dict', required: false, description: 'Optional controls: { cancel: boolean }' }
        },
        handler: async (params) => {
            const { paramName, message, parentIntent, hint, controls } = params;

            let formattedMessage = message;
            if (hint) {
                formattedMessage = `${message}\n_(${hint})_`;
            }

            const res = {
                directResponse: true,
                message: formattedMessage,
                action: 'param_collection_requested',
                paramName,
                parentIntent,
                updateHistory: true
            };

            // Standardize Cancel button for text collection
            if (controls?.cancel) {
                res.whatsapp = {
                    type: 'button',
                    buttons: [{ id: '__flow:cancel__', title: 'Cancel' }]
                };
            }

            return res;
        }
    },

    'microstate.buttons': {
        description: 'Send an interactive WhatsApp button prompt (up to 3 buttons).',
        params: {
            message: { type: 'string', required: true, description: 'Prompt text to show above the buttons' },
            buttons: { type: 'array', required: true, description: 'Buttons: [{ id, title }]. Max 3.' }
        },
        handler: async (params) => {
            const { message, buttons } = params;
            const safeButtons = Array.isArray(buttons) ? buttons.slice(0, 3) : [];

            return {
                directResponse: true,
                message,
                action: 'buttons_requested',
                updateHistory: true,
                whatsapp: {
                    type: 'button',
                    buttons: safeButtons.map(b => ({
                        id: String(b.id ?? ''),
                        title: String(b.title ?? b.id ?? '')
                    }))
                }
            };
        }
    }
};

module.exports = microstateTools;
