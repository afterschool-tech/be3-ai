/**
 * Personality Layer — Shared AI response generation
 * 
 * Extracted from server.js so both the server and the REPL can share
 * the same LLM-based personality pipeline (Groq Llama 3.3 70B).
 */

require('dotenv').config();
const { queryAI: queryGroqAI, MODEL_ID: GROQ_MODEL_ID } = require('./hfAiService');
const dco = require('./dco');
const { logDebug } = require('../utils/debugLogger');

const MAX_PRODUCTS_FOR_LLM = 6;
const MAX_VENDORS_FOR_LLM = 25;

/**
 * Trim tool results down to an LLM-friendly summary.
 * Keeps only the fields the personality prompt needs.
 */
function summarizeToolResultsForLLM(results) {
    const summarized = [];

    for (const tr of results || []) {
        const tool = tr?.tool || tr?.name || 'tool';
        const success = tr?.success !== false && !tr?.error && !tr?.result?.error;
        const base = {
            tool,
            success,
            skipped: !!tr?.skipped,
            message: tr?.result?.message || tr?.message || null,
            error: tr?.error || tr?.result?.error || null
        };

        const r = tr?.result;

        if (tool === 'vendor.list' && Array.isArray(r)) {
            base.vendors = r.slice(0, MAX_VENDORS_FOR_LLM).map(v => ({
                name: v?.name || null,
                tag: v?.tag || null,
                product_count: v?.product_count ?? null,
                delivery: v?.delivery ?? null
            }));
            base.vendors_truncated = r.length > MAX_VENDORS_FOR_LLM;
            base.total_vendors = r.length;
            summarized.push(base);
            continue;
        }

        const rr = (r && typeof r === 'object') ? r : {};

        if ((tool === 'vendor.getContactLink' || tool === 'vendor.getContact') && rr && typeof rr === 'object') {
            base.vendor_contact = {
                vendor: rr.vendor || null,
                whatsapp_link: rr.whatsapp_link || null,
                phone: rr.phone || null,
                message_preview: rr.message_preview || null
            };
        }

        if (tool === 'discovery.sentinel' && rr && typeof rr === 'object') {
            base.target_category = rr.target_category || null;
            base.suggestion_type = rr.suggestion_type || null;
            base.recovery_reason = rr.recovery_reason || null;
            if (rr.whatsapp_product_cards) base.whatsapp_product_cards = rr.whatsapp_product_cards;
            if (rr.whatsapp) base.whatsapp = rr.whatsapp;
        }

        // Facet results: pass structured options to personality layer
        if (tool === 'product.facets' && rr && typeof rr === 'object') {
            base.facet_target = rr.facet_target || null;
            base.attribute_code = rr.attribute_code || null;
            base.scope = rr.scope || null;
            base.scope_label = rr.scope_label || null;
            if (Array.isArray(rr.options)) {
                base.facet_options = rr.options.slice(0, 15).map(o => ({
                    value: o.value,
                    count: o.count ?? null
                }));
            }
            if (Array.isArray(rr.clauses) && rr.clauses.length > 0) {
                base.facet_clauses = rr.clauses.slice(0, 10);
            }
        }

        if (tool === 'cart.add' && rr) {
            // Prioritize name from tool result (backend) then from pre-reconciled params
            base.product_name = rr.product_name || tr.params?.product_name || null;
        }

        // Suggested products (product.search fallbacks)
        if (Array.isArray(rr.suggested_products) && rr.suggested_products.length > 0) {
            base.suggestion_message = rr.suggestion_message || null;
            base.suggested_total = rr.suggested_total ?? rr.suggested_products.length;
            base.suggested_products = rr.suggested_products.slice(0, MAX_PRODUCTS_FOR_LLM).map(p => ({
                id: p?.id || p?.handle || p?.product_id || null,
                name: p?.name || p?.title || null,
                price: p?.price ?? null,
                vendor: p?.vendor || p?.metadata?.vendor || null,
                whatsapp_link: p?.whatsapp_link || null,
                checkout_url: p?.checkout_url || null
            }));
        }

        // Cart view items: preserve full line items for grounded cart responses.
        // cart.view returns r.items (not r.products), so we explicitly summarize it.
        if (Array.isArray(rr.items) && (tool === 'cart.view' || tool === 'cart.get' || tool === 'cart')) {
            base.cart_items = rr.items.map(i => ({
                id: i?.id || null,
                name: i?.product_name || i?.name || i?.title || null,
                quantity: i?.quantity ?? null,
                price: i?.price ?? null,
                subtotal: i?.subtotal ?? null
            }));
            base.total = rr.total ?? null;
            base.item_count = rr.item_count ?? base.cart_items.length;
        }

        // Single-product details (e.g., product.getDetails)
        if (rr && rr.product && typeof rr.product === 'object' && !Array.isArray(rr.product)) {
            const p = rr.product;
            base.product = {
                id: p?.id || p?.handle || p?.product_id || null,
                name: p?.name || p?.title || null,
                price: p?.price ?? null,
                vendor: p?.vendor || p?.metadata?.vendor || null,
                description: typeof p?.description === 'string'
                    ? (p.description.length > 220 ? `${p.description.substring(0, 220)}...` : p.description)
                    : null,
                attributes: (p?.attributes && typeof p.attributes === 'object' && !Array.isArray(p.attributes))
                    ? Object.keys(p.attributes).slice(0, 12).reduce((acc, k) => {
                        acc[k] = p.attributes[k];
                        return acc;
                    }, {})
                    : null,
                image_url: p?.image_url || p?.metadata?.image_url || null
            };
        }

        // List of tools that return a product array we want to summarize for the LLM
        const toolsWithProducts = [
            'product.search', 'product_search',
            'product.recommend', 'product_recommendations',
            'vendor.getProducts', 'vendor_products',
            'cart.view', 'cart.get', 'cart'
        ];

        if (toolsWithProducts.includes(tool)) {
            const tempProducts = Array.isArray(rr.products) ? rr.products : (Array.isArray(rr.results) ? rr.results : null);
            if (tempProducts && rr.method !== 'vector') {
                base.facets = rr.facets?.attributes
                    ? Object.keys(rr.facets.attributes).slice(0, 5).reduce((acc, k) => {
                        acc[k] = rr.facets.attributes[k].clauses || rr.facets.attributes[k].options;
                        return acc;
                    }, {})
                    : null;
            }
            if (rr.vendor) {
                base.vendor = rr.vendor;
            }
        }

        const hasProducts = Array.isArray(rr.products) || Array.isArray(rr.results);
        const productArray = Array.isArray(rr.products) ? rr.products : (Array.isArray(rr.results) ? rr.results : null);

        if (hasProducts && Array.isArray(productArray)) {
            const isCartView = tool === 'cart.view' || tool === 'cart.get' || tool === 'cart';
            const max = isCartView ? productArray.length : MAX_PRODUCTS_FOR_LLM;

            base.products = productArray.slice(0, max).map(p => {
                const attrs = (p?.attributes || p?.metadata?.attributes);
                return {
                    id: p?.id || p?.handle || p?.product_id || null,
                    name: p?.name || p?.title || null,
                    price: p?.price ?? null,
                    vendor: p?.vendor || p?.metadata?.vendor || null,
                    description: typeof p?.description === 'string'
                        ? (p.description.length > 160 ? `${p.description.substring(0, 160)}...` : p.description)
                        : null,
                    attributes: (attrs && typeof attrs === 'object' && !Array.isArray(attrs))
                        ? Object.keys(attrs).slice(0, 12).reduce((acc, k) => {
                            acc[k] = attrs[k];
                            return acc;
                        }, {})
                        : null
                };
            });
            base.products_truncated = !isCartView && productArray.length > MAX_PRODUCTS_FOR_LLM;
            base.total_products = productArray.length;

            // ── SIMILARITY CONTEXT ──
            // If the search was run in "similar" mode, tell the LLM so it can frame
            // the results correctly ("here are products similar to X") instead of
            // treating them like a generic keyword search (and saying "I found nothing similar").
            if (rr.mode === 'similar' || rr.search_mode === 'similar') {
                base.search_mode = 'similar';
                if (rr.similar_to_name) base.similar_to_name = rr.similar_to_name;
                if (rr.similar_to) base.similar_to = rr.similar_to;
            } else if (rr.mode === 'IMAGE' || rr.search_mode === 'image') {
                base.search_mode = 'image';
            }
        }

        // Preserve critical vendor breakdown / checkout links if present, but keep it lean
        if (Array.isArray(rr.vendor_breakdown)) {
            base.vendor_breakdown = rr.vendor_breakdown.map(v => ({
                vendor: v.vendor || v.vendor_name || v.name || null,
                order_number: v.order_number || null,
                subtotal: v.subtotal || null,
                whatsapp_link: v.whatsapp_link || null,
                checkout_url: v.checkout_url || null,
                status: v.status || v.message || null
            }));
        }

        // Product comparisons (e.g., product.compare)
        if (Array.isArray(rr.comparison)) {
            base.comparison = rr.comparison.map(p => ({
                id: p?.id || p?.handle || p?.product_id || null,
                name: p?.name || p?.title || null,
                price: p?.price ?? null,
                vendor: p?.vendor || p?.metadata?.vendor || null,
                whatsapp_link: p?.whatsapp_link || p?.metadata?.whatsapp_link || null,
                checkout_url: p?.checkout_url || p?.metadata?.checkout_url || null,
                description: typeof p?.description === 'string'
                    ? (p.description.length > 220 ? `${p.description.substring(0, 220)}...` : p.description)
                    : null,
                // Prefer expanded_attributes (human-keyed) emitted by product.compare tool.
                // Fall back to attributes/raw_attributes when not present.
                attributes: (() => {
                    const attrs = (p?.expanded_attributes && typeof p.expanded_attributes === 'object' && !Array.isArray(p.expanded_attributes))
                        ? p.expanded_attributes
                        : (p?.attributes && typeof p.attributes === 'object' && !Array.isArray(p.attributes))
                            ? p.attributes
                            : (p?.raw_attributes && typeof p.raw_attributes === 'object' && !Array.isArray(p.raw_attributes))
                                ? p.raw_attributes
                                : null;

                    if (!attrs) return null;
                    return Object.keys(attrs).slice(0, 24).reduce((acc, k) => {
                        acc[k] = attrs[k];
                        return acc;
                    }, {});
                })()
            }));
        }

        summarized.push(base);
    }

    return summarized;
}

/**
 * Generate a personality-styled response from tool results using Groq LLM.
 * This is the full "Be3 voice" pipeline used by the server's /chat endpoint.
 * 
 * Now powered by the Dynamic Context Orchestrator (DCO) for intent-aware
 * prompt assembly, token-efficient context injection, and smart history windowing.
 *
 * @param {string} userMessage - The original user message
 * @param {Array} toolResults - Array of tool execution results
 * @param {Array} conversationHistory - Array of { role, text } objects
 * @param {Object} dcoContext - DCO context from the caller
 * @param {string|string[]} dcoContext.intentNames - Resolved intent name(s), supports multi-intent stacks
 * @param {string|null} [dcoContext.conversationSummary] - Existing conversation summary for history compression
 * @returns {Promise<string>} The AI-generated reply string
 */
async function generateResponseFromTools(userMessage, toolResults, conversationHistory, dcoContext = {}) {
    const intentNames = dcoContext.intentNames || 'conversation';
    const conversationSummary = dcoContext.conversationSummary || null;



    const optimizedResults = toolResults.map(tr => {
        if (tr.result && (tr.result.products || tr.result.results || tr.result.items || tr.result.suggested_products)) {
            const isCartView = tr.tool === 'cart.view' || tr.tool === 'cart.get' || tr.tool === 'cart';
            const rawProducts = tr.result.products || tr.result.results || (isCartView ? tr.result.items : null);
            const limitedProducts = Array.isArray(rawProducts)
                ? (isCartView ? rawProducts : rawProducts.slice(0, MAX_PRODUCTS_FOR_LLM))
                : rawProducts;

            const rawSuggested = tr.result.suggested_products;
            const limitedSuggested = Array.isArray(rawSuggested) ? rawSuggested.slice(0, MAX_PRODUCTS_FOR_LLM) : rawSuggested;
            return {
                ...tr,
                result: {
                    ...tr.result,
                    mode: tr.result.mode || tr.result.search_mode || null,
                    products: (Array.isArray(limitedProducts) ? limitedProducts : []).map(p => {
                        if (isCartView) {
                            return {
                                id: p?.id || null,
                                name: p?.product_name || p?.name || p?.title || null,
                                quantity: p?.quantity ?? null,
                                price: p?.price ?? null,
                                subtotal: p?.subtotal ?? null
                            };
                        } else {
                            const attrs = (p.attributes || p.metadata?.attributes);
                            return {
                                id: p.id || p.handle || null,
                                name: p.name || p.title || null,
                                price: p.price || null,
                                description: typeof p.description === 'string'
                                    ? (p.description.length > 160 ? `${p.description.substring(0, 160)}...` : p.description)
                                    : null,
                                attributes: (attrs && typeof attrs === 'object' && !Array.isArray(attrs))
                                    ? Object.keys(attrs).slice(0, 12).reduce((acc, k) => {
                                        acc[k] = attrs[k];
                                        return acc;
                                    }, {})
                                    : null
                            };
                        }
                    }),
                    suggested_products: (Array.isArray(limitedSuggested) ? limitedSuggested : []).map(p => ({
                        id: p?.id || null,
                        name: p?.name || p?.title || null,
                        price: p?.price ?? null,
                        whatsapp_link: p?.whatsapp_link || null,
                        checkout_url: p?.checkout_url || null
                    })),
                    suggestion_message: tr.result.suggestion_message || null,
                    suggested_total: tr.result.suggested_total ?? null
                }
            };
        }
        return tr;
    });

    // Detect skipped/failed actions for DCO options
    const skippedActions = toolResults.filter(tr => tr.skipped && tr.skippedMessage);
    const failedActions = toolResults.filter(tr =>
        tr && !tr.skipped && (
            tr.success === false ||
            !!tr.error ||
            !!tr.result?.error
        )
    );

    // Detect similarity data for DCO options
    const summarizedResultsForLLM = summarizeToolResultsForLLM(optimizedResults);

    logDebug('PERSONALITY:TOOL_RESULT_OPTIMIZATION', {
        _desc: 'Tool result optimization — trim product fields for prompt size',
        _example: 'Drop long HTML descriptions, keep name/price/vendor',
        inputToolCount: toolResults.length,
        optimizedResultsForLLM: summarizedResultsForLLM
    });

    const resultsSummary = JSON.stringify(summarizedResultsForLLM);

    const hasSimilarityData = Array.isArray(summarizedResultsForLLM) && summarizedResultsForLLM.some(x =>
        x && x.search_mode === 'similar' && Array.isArray(x.products) && x.products.length > 0
    );
    const similarityRef = hasSimilarityData
        ? (summarizedResultsForLLM.find(x => x.search_mode === 'similar')?.similar_to_name || null)
        : null;

    // ═══════════════════════════════════════════════
    // DCO: Assemble intent-aware system prompt
    // ═══════════════════════════════════════════════
    const systemPrompt = dco.assemblePrompt(intentNames, resultsSummary, {
        similarityRef,
        hasFailures: failedActions.length > 0,
        hasSkipped: skippedActions.length > 0,
        skippedMessage: skippedActions[0]?.skippedMessage || null,
        failedToolsSummary: failedActions.map(f => ({ tool: f.tool, error: f.error || f.result?.error || null, reason: f.reason || null })),
        visual_search: !!dcoContext.visual_search
    });

    // ═══════════════════════════════════════════════
    // DCO: Get intent-aware history window
    // ═══════════════════════════════════════════════
    const historyMessages = dco.getHistoryWindow(intentNames, conversationHistory, conversationSummary);

    const maxTokens = dco.getMaxResponseTokens(
        Array.isArray(intentNames) ? intentNames[0] : intentNames
    );

    logDebug('PERSONALITY:DCO_PROMPT_ASSEMBLY', {
        _desc: 'DCO prompt assembly — intent-aware system prompt built from composable segments',
        _example: 'add_to_cart → core+formatting+grounding+gratitude only (no capabilities, no comparison)',
        intentNames,
        systemPromptChars: systemPrompt.length,
        toolResultsChars: resultsSummary.length,
        historyMessages: historyMessages.length,
        maxTokens,
        approxTokens: Math.ceil(systemPrompt.length / 4)
    });

    const messages = [
        { role: "system", content: systemPrompt },
        ...historyMessages,
        { role: "user", content: userMessage }
    ];

    try {
        const response = await queryGroqAI(messages, maxTokens, 0.4, 1, {}, GROQ_MODEL_ID);
        if (!response || response.trim().length === 0) {
            const primaryToolResult = toolResults.find(t => t.result && t.result.message);
            return primaryToolResult ? primaryToolResult.result.message : "I've processed your request successfully.";
        }
        return response.trim();
    } catch (error) {
        console.error('[AI] Unified Response Error:', error.message);
        const primaryToolResult = toolResults.find(t => t.result && t.result.message);
        return primaryToolResult ? primaryToolResult.result.message : "I've hit a small snag, but your request went through!";
    }
}


module.exports = {
    generateResponseFromTools,
    summarizeToolResultsForLLM
};
