/**
 * Conversation Tools
 * Capabilities related to managing the conversation flow and user experience.
 */

const { CATEGORIES, VENDORS } = require('../context/storeContext');

const conversationTools = {
    'conversation.help': {
        description: 'Provide help and usage instructions to the user. Use this when the user asks for help or what you can do.',
        params: {},
        handler: async (params, context) => {
            return {
                message: "I can help you with finding products, checking prices, tracking orders, and managing your cart.\n\nTry asking things like:\n- 'Show me gaming laptops'\n- 'Track my order #12345'\n- 'What's in my cart?'\n- 'Find cheap headphones'"
            };
        }
    },

    'conversation.handover': {
        description: 'Hand over the conversation to a human support agent.',
        params: {
            reason: { type: 'string', description: 'Reason for requesting human support' }
        },
        handler: async (params, context) => {
            console.log(`[Conversation] Handover requested: ${params.reason || 'No reason provided'}`);
            return {
                message: "I've flagged this conversation for a human agent. Someone will review it shortly. In the meantime, is there anything else I can try to help with?",
                action: "handover_initiated"
            };
        }
    },

    'conversation.end': {
        description: 'End the current conversation session.',
        params: {},
        handler: async (params, context) => {
            return {
                message: "Thanks for chatting! Have a great day. 👋",
                action: "session_ended"
            };
        }
    },

    'conversation.feedback': {
        description: 'Collect user feedback on the interaction.',
        params: {
            rating: { type: 'number', description: 'Rating from 1-5' },
            comment: { type: 'string', description: 'Optional comment' }
        },
        handler: async (params, context) => {
            console.log(`[Conversation] Feedback received: ${params.rating}/5 - ${params.comment || ''}`);
            return {
                message: "Thank you for your feedback! We appreciate it.",
                success: true
            };
        }
    },

    'conversation.retry': {
        description: 'Retry the last tool execution. Use this when the user says "Try again", "Retry", or "Repeat".',
        params: {},
        handler: async (params, context, results) => {
            return {
                message: "Retrying your last request...",
                is_retry: true
            };
        }
    },

    'conversation.clarify': {
        description: 'Ask the user for clarification when their intent is ambiguous or unclear. Use this when the INTENT ADVISOR suggests clarification needed.',
        params: {
            reason: { type: 'string', description: 'Why clarification is needed (e.g. "Ambiguous intent between A and B")' },
            options: { type: 'array', description: 'Possible interpretations to offer the user (e.g. ["View Orders", "Buy Items"])' }
        },
        handler: async (params, context) => {
            console.log(`[Conversation] Clarification requested: ${params.reason}`);
            return {
                message: "I'm not quite sure I follow. Could you clarify what you'd like to do?",
                reason: params.reason,
                options: params.options,
                action: "clarification_requested"
            };
        }
    },

    'conversation.getAdvice': {
        description: 'Provide AI-powered shopping advice, recommendations, or guidance. Use this ONLY when the user clearly needs advice or help choosing between options.',
        params: {
            category: { type: 'string', description: 'Category the user needs advice about' },
            need: { type: 'string', description: 'Specific need or use case (e.g. "gaming", "budget", "a gift")' },
            query: { type: 'string', description: 'The full advice query from the user' }
        },
        handler: async (params, context) => {
            const { queryAI } = require('../core/aiService');
            const { category, need, query } = params;

            // Build store context for AI
            const categoryList = Object.values(CATEGORIES || {})
                .filter(c => c.total_count > 0)
                .map(c => `${c.label} (${c.total_count} items)`)
                .slice(0, 15)
                .join(', ');

            const vendorList = Object.values(VENDORS || {})
                .map(v => v.business_name)
                .slice(0, 10)
                .join(', ');

            const prompt = `You are a helpful shopping advisor for an e-commerce store.
The user needs advice: "${query || need || category || 'general shopping advice'}"
${category ? `Category of interest: ${category}` : ''}
${need ? `Specific need: ${need}` : ''}

STORE CONTEXT:
- Available categories: ${categoryList || 'various products'}
- Vendors: ${vendorList || 'multiple sellers'}

Provide concise, helpful shopping advice (2-3 sentences max). 
If relevant, suggest what they should search for or what category to browse.
Be friendly and knowledgeable.`;

            try {
                const advice = await queryAI([
                    { role: 'system', content: 'You are a concise, friendly shopping advisor. Keep answers short and actionable.' },
                    { role: 'user', content: prompt }
                ], 300, 0.7);

                return {
                    advice: advice.trim(),
                    category: category || null,
                    need: need || null,
                    suggested_action: category
                        ? `Would you like me to search for ${category}?`
                        : 'Would you like me to search for something specific?'
                };
            } catch (e) {
                console.error('[Conversation] AI Advice failed:', e.message);
                return {
                    advice: 'I\'d be happy to help! Could you tell me more about what you\'re looking for? For example, the type of product, your budget, or what you\'ll use it for.',
                    suggested_action: 'Try telling me what category or product type you\'re interested in.'
                };
            }
        }
    },

    /**
     * Test response tool - used by test_microstate intent
     */
    'conversation.test_response': {
        description: 'Respond to test microstate confirmation',
        params: {
            confirmation: { type: 'boolean', required: true, description: 'User confirmation (true/false)' }
        },
        handler: async (params) => {
            const { confirmation } = params;
            if (confirmation === true) {
                return {
                    message: 'Great! You confirmed. The test microstate worked perfectly! ✅',
                    success: true
                };
            } else {
                return {
                    message: 'Okay, you declined. The test microstate is now closed.',
                    success: true
                };
            }
        }
    }
};

module.exports = conversationTools;
