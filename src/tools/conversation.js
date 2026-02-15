/**
 * Conversation Tools
 * Capabilities related to managing the conversation flow and user experience.
 */

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
            // In a real system, this would trigger a socket event or DB update
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
            // Logic to clear session state could go here
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
            // This is a special tool as its execution is handled by the orchestrator re-evaluating the turn
            // OR we can just return a message saying we are retrying.
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
    }
};

module.exports = conversationTools;
