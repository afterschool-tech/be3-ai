/**
 * Conversation Tools
 * Capabilities related to managing the conversation flow and user experience.
 */

const conversationTools = {
    'conversation.help': {
        description: 'Provide help and usage instructions to the user. Use this when the user asks for help or what you can do.',
        params: {
            product_name: { type: 'string', required: false, description: 'Optional product name to provide help for' }
        },
        handler: async (params, context) => {
            const { product_name } = params;
            if (product_name) {
                try {
                    const productTools = require('./product');
                    const details = await productTools['product.getDetails'].handler({ product_id: product_name }, context);

                    if (details.product) {
                        return {
                            message: `I found details for **${details.product.name}**. I can help you with specific information or adding it to your cart.`,
                            product: details.product,
                            whatsapp: details.whatsapp
                        };
                    }
                } catch (e) {
                    console.error('[Conversation] Failed to fetch product details for help:', e.message);
                }

                return {
                    message: `I can help you find more information about **${product_name}** or help you add it to your cart.\n\nYou can try saying:\n- 'Tell me more about ${product_name}'\n- 'Add ${product_name} to my cart'\n- 'Compare ${product_name} with other items'`
                };
            }
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
            const { processRAGQuery } = require('../core/ragService');
            const { queryAI } = require('../core/aiService');
            const { category, need, query } = params;

            const fullQuery = query || need || category || 'general shopping advice';
            console.log(`[Conversation.getAdvice] Query: "${fullQuery}" | Category: ${category} | Need: ${need}`);

            // Try RAG first — it will pull real knowledge chunks about categories/vendors
            let ragContext = null;
            try {
                const extracted = {};
                if (category) extracted.category = category;
                ragContext = await processRAGQuery(context.sessionId, fullQuery, extracted);
                if (ragContext) {
                    console.log(`[Conversation.getAdvice] RAG resolved — passing to DCO for grounding`);
                    return ragContext;
                }
            } catch (e) {
                console.warn('[Conversation.getAdvice] RAG failed, falling back to vanilla AI:', e.message);
            }

            // Fallback — lean, no raw storeContext dump
            console.log(`[Conversation.getAdvice] No RAG match. Using vanilla AI fallback.`);
            try {
                const advice = await queryAI([
                    { role: 'system', content: 'You are a concise, friendly shopping advisor for Be3, a Nigerian e-commerce marketplace. Keep answers short and actionable. Never invent product names or prices.' },
                    { role: 'user', content: fullQuery }
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
                console.error('[Conversation.getAdvice] Vanilla AI fallback failed:', e.message);
                return {
                    advice: "I'd be happy to help! Could you tell me more about what you're looking for?",
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
        handler: async (params, context) => {
            const { confirmation } = params;
            if (confirmation === true) {
                try {
                    try {
                        const stateManager = require('../state/stateManager');
                        if (context?.sessionId) {
                            await stateManager.clearStack(context.sessionId);
                        }
                    } catch (_) {
                        // ignore state clearing errors in test tool
                    }

                    const productTools = require('./product');
                    const firstSearch = await productTools['product.search'].handler({
                        query: 'iphones',
                        limit: 10,
                        sort: 'relevance'
                    }, context);

                    let products = Array.isArray(firstSearch?.products) ? firstSearch.products : [];
                    if (!products.length) {
                        const fallbackSearch = await productTools['product.search'].handler({
                            query: 'laptops',
                            limit: 10,
                            sort: 'relevance'
                        }, context);
                        products = Array.isArray(fallbackSearch?.products) ? fallbackSearch.products : [];
                    }
                    const picked = products.slice(0, 4).filter(Boolean);
                    const top = picked[0] || null;
                    if (!top) {
                        return {
                            message: 'Confirmed ✅ — but I couldn\'t find any products to show right now. Try again in a bit.',
                            success: true
                        };
                    }

                    const buildCardText = (p) => {
                        const vendorName = p.vendor?.business_name || p.vendor?.name || p.vendor_name || p.vendor || null;
                        const priceText = (p.price !== undefined && p.price !== null) ? `₦${p.price}` : 'Price unavailable';
                        const desc = p.description ? String(p.description).slice(0, 140) : '';
                        return `*${p.name || p.title || 'Product'}*\n💰 ${priceText}` +
                            (vendorName ? `\n🏪 ${vendorName}` : '') +
                            (desc ? `\n📝 ${desc}` : '');
                    };

                    const cards = picked.map((p, idx) => {
                        const n = idx + 1;
                        const imageUrl = p.image_url || p.metadata?.image_url || null;
                        return {
                            sponsor: {
                                type: 'product',
                                product_id: p.id,
                                name: p.name || p.title || null,
                                ordinal: n
                            },
                            image_url: imageUrl,
                            text: buildCardText(p),
                            buttons: [
                                { id: `add the ${n}${n === 1 ? 'st' : (n === 2 ? 'nd' : (n === 3 ? 'rd' : 'th'))} one`, title: 'Add to cart' },
                                { id: `tell me more about the ${n}${n === 1 ? 'st' : (n === 2 ? 'nd' : (n === 3 ? 'rd' : 'th'))} one`, title: 'More info' },
                                { id: `contact vendor for the ${n}${n === 1 ? 'st' : (n === 2 ? 'nd' : (n === 3 ? 'rd' : 'th'))} one`, title: 'Contact vendor' }
                            ]
                        };
                    });

                    return {
                        success: true,
                        message: `✅ Confirmed! Here are ${cards.length} product cards:`,
                        products: picked,
                        whatsapp: {
                            type: 'button',
                            transaction: 'product_card',
                            cards
                        },
                        directResponse: true
                    };
                } catch (e) {
                    return {
                        message: `Confirmed ✅ — but product card test failed: ${e.message}`,
                        success: false,
                        directResponse: true
                    };
                }
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
    },

    'conversation.chat': {
        description: 'Primary AI conversational tool. Handles general questions, semantic knowledge about the store, vendors, categories, policies, and open-ended chatting. Uses Active Knowledge (RAG) to fetch store truths dynamically.',
        params: {
            query: { type: 'string', description: 'The raw question or statement from the user', required: true },
            vendor: { type: 'string', description: 'Extracted vendor ID if present' },
            category: { type: 'string', description: 'Extracted category ID if present' }
        },
        handler: async (params, context) => {
            const { processRAGQuery } = require('../core/ragService');

            const sessionId = context.sessionId;
            // Safely resolve the query from all possible param names
            const userQuery = params.query || params.product_name || params.message || params.text || '';
            const extracted = { vendor: params.vendor, category: params.category };

            console.log(`[RAG:chat] ── Incoming query: "${userQuery}"`);
            console.log(`[RAG:chat] ── Extracted entities: vendor=${params.vendor || 'none'} | category=${params.category || 'none'}`);

            if (!userQuery) {
                console.warn(`[RAG:chat] ⚠ No query resolved from params:`, JSON.stringify(params));
                return { rag_fallback: true };
            }
            try {
                console.log(`[RAG:chat] ▶ Running RAG pipeline (session: ${sessionId})`);
                const response = await processRAGQuery(sessionId, userQuery, extracted);

                if (!response) {
                    // RAG returned null — no KB context found (greeting, off-topic, etc.)
                    // Do NOT call LLM here — that's the personality layer's job.
                    // Return a rag_fallback signal so DCO responds naturally from conversation history.
                    console.log(`[RAG:chat] ◀ No KB match — returning rag_fallback signal to DCO.`);
                    return { rag_fallback: true };
                }

                console.log(`[RAG:chat] ◀ RAG context ready — entity: ${response.rag_entity?.type}:${response.rag_entity?.name} | buttons: ${response.whatsapp?.buttons?.length || 0}`);
                return response;

            } catch (e) {
                console.error('[RAG:chat] ✖ RAG pipeline threw exception:', e.message);
                return { rag_fallback: true, error: e.message };
            }
        }
    }
};

// rag.query is the canonical tool name for the RAG knowledge pipeline.
// conversation.chat is kept as a backward-compat alias (same handler).
conversationTools['rag.query'] = conversationTools['conversation.chat'];

module.exports = conversationTools;
