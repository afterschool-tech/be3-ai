/**
 * Personality Layer — Shared AI response generation
 * 
 * Extracted from server.js so both the server and the REPL can share
 * the same LLM-based personality pipeline (Groq Llama 3.3 70B).
 */

require('dotenv').config();
const { queryAI: queryGroqAI, MODEL_ID: GROQ_MODEL_ID } = require('./hfAiService');
const { getUltraLeanContext } = require('../context/storeContext');
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

        const hasProducts = Array.isArray(rr.products) || Array.isArray(rr.results);
        const productArray = Array.isArray(rr.products) ? rr.products : (Array.isArray(rr.results) ? rr.results : null);

        if (hasProducts && Array.isArray(productArray)) {
            const isCartView = tool === 'cart.view' || tool === 'cart.get' || tool === 'cart';
            const max = isCartView ? productArray.length : MAX_PRODUCTS_FOR_LLM;

            base.products = productArray.slice(0, max).map(p => ({
                id: p?.id || p?.handle || p?.product_id || null,
                name: p?.name || p?.title || null,
                price: p?.price ?? null,
                vendor: p?.vendor || p?.metadata?.vendor || null,
                whatsapp_link: p?.whatsapp_link || null,
                checkout_url: p?.checkout_url || null
            }));
            base.products_truncated = !isCartView && productArray.length > MAX_PRODUCTS_FOR_LLM;
            base.total_products = productArray.length;
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
 * @param {string} userMessage - The original user message
 * @param {Array} toolResults - Array of tool execution results
 * @param {Array} conversationHistory - Array of { role, text } objects
 * @returns {Promise<string>} The AI-generated reply string
 */
async function generateResponseFromTools(userMessage, toolResults, conversationHistory) {
    logDebug('PERSONALITY:TOOL_RESULT_OPTIMIZATION', {
        _desc: 'Tool result optimization — trim product fields for prompt size',
        _example: 'Drop long HTML descriptions, keep name/price/vendor',
        inputToolCount: toolResults.length
    });

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
                    products: (Array.isArray(limitedProducts) ? limitedProducts : []).map(p => (isCartView ? ({
                        id: p?.id || null,
                        name: p?.product_name || p?.name || p?.title || null,
                        quantity: p?.quantity ?? null,
                        price: p?.price ?? null,
                        subtotal: p?.subtotal ?? null
                    }) : ({
                        id: p.id,
                        name: p.name || p.title,
                        price: p.price,
                        whatsapp_link: p.whatsapp_link,
                        checkout_url: p.checkout_url
                    }))),
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

    const skippedActions = toolResults.filter(tr => tr.skipped && tr.skippedMessage);
    const skippedInstruction = skippedActions.length > 0
        ? `\nSKIPPED ACTIONS (same-turn): Some add-to-cart actions were skipped because the item wasn't resolved yet. You MUST tell the user: "${skippedActions[0].skippedMessage}" (or the same idea in your own words) so they know to say "add the first one" or "add the white one" in their next message.\n`
        : '';

    // Surface tool failures
    const failedActions = toolResults.filter(tr =>
        tr && !tr.skipped && (
            tr.success === false ||
            !!tr.error ||
            !!tr.result?.error
        )
    );
    const failuresInstruction = failedActions.length > 0
        ? `\nTOOL FAILURES: One or more tools failed. You MUST acknowledge the failure(s) clearly and helpfully in your reply.\n` +
        `- Say what succeeded (if anything) AND what failed.\n` +
        `- If a cart/remove/compare action failed, suggest a next step (retry, rephrase, or pick by ordinal like "remove the second item").\n` +
        `- Do NOT pretend the failed action worked.\n` +
        `Failed tools summary: ${JSON.stringify(failedActions.map(f => ({ tool: f.tool, error: f.error || f.result?.error || null, reason: f.reason || null })))}\n`
        : '';

    const summarizedResultsForLLM = summarizeToolResultsForLLM(optimizedResults);
    const resultsSummary = JSON.stringify(summarizedResultsForLLM);

    const hasComparisonData = Array.isArray(summarizedResultsForLLM) && summarizedResultsForLLM.some(x =>
        x && Array.isArray(x.comparison) && x.comparison.length >= 2
    );

    // Only include ultra-lean context as a rescue aid when something failed/skipped.
    const shouldIncludeRescueContext = failedActions.length > 0 || skippedActions.length > 0;
    let rescueContext = '';
    try {
        rescueContext = shouldIncludeRescueContext ? JSON.stringify(getUltraLeanContext()) : '';
    } catch (_) {
        // storeContext may not be fully loaded in REPL — safe to skip rescue context
    }

    const systemPrompt = `You are a super friendly, playful, and LOVING shopping assistant for the Be3 store. ✨👋

PERSONALITY:
- Vibe: Affectionate, street-smart, and cute! You are a caring friend.
- Tone: Expressive with natural slang. Use ENDEARING terms naturally.
- EMOJIS: Use them expressively to describe feelings, products, and reactions. 🤩🔥👜

CRITICAL GROUNDING RULES:
1. TRUTHFULNESS: Only mention products provided in the "Tool Results" below. 
2. NO HALLUCINATIONS: If no products are found for a search request, admit it warmly. For general conversation, do NOT mention the lack of products.
3. PRICE INTEGRITY: Never guess prices. Use the exact "price" from results.
4. LINKS & BUTTONS: If a "whatsapp_link" or "checkout_url" is provided, you can mention it. HOWEVER, if they are missing, do NOT apologize, do NOT mention that you "don't have the link", and do NOT say you'll "try to find it". The system automatically provides buttons for these actions.
5. FORMATTING: Use lists/bullet points. NO markdown tables (poor display on WhatsApp).

BOT CAPABILITIES (What you can do):
- Search and find products (e.g., "Show me smartphones", "Find cheap white shoes").
- Compare products side-by-side (e.g., "Compare the first two").
- Check product details and specs (e.g., "Tell me more about the MacBook").
- Manage the shopping cart (add, remove, view items).
- Check active orders and order status.
- Find store/vendor information and contact links.
- Provide shopping advice and recommendations.

GREETING & HELP:
- If the user says "Hi", "Hello", or "Hii", or asks "What can you do?", greet them warmly and list 3-4 interesting things you can do from the list above using bullet points.
- If you've already introduced yourself in the history, keep it brief and don't repeat your name.

RENDER-ONLY MODE:
- You are mainly a presentation layer for tool results.
- Do NOT invent products, prices, specs, or links.
- If tool results are insufficient, ask ONE short clarifying question.

${hasComparisonData ? `PRODUCT COMPARISON RULES (IMPORTANT):
- The user is explicitly comparing products.
- You MUST compare more than just price.
- Do NOT dump a raw list of every attribute key/value. Summarize like a helpful friend.
- Structure your reply like this:
  1) QUICK VERDICT: 1–2 lines on the biggest difference(s).
  2) BEST FOR: 1 bullet per product (e.g. "Best for storage", "Best for premium build", "Best on a budget").
  3) KEY DIFFERENCES: 3–6 short bullets total, written in plain language (not "b/c/j" codes).
- Use "attributes" to justify the differences (storage, color, size, material, brand, price_tier, etc.).
- If attributes exist, you MUST mention at least 3 non-price attribute differences overall (unless fewer are available).
- If attributes are missing/empty, say so and ask ONE short question: "Which spec matters most to you (storage, color, size, etc.)?"` : ''}

${shouldIncludeRescueContext ? `RESCUE CONTEXT (ONLY FOR HELP WHEN TOOLS FAIL):\n${rescueContext}\n` : ''}

TOOL RESULTS DATA:
${resultsSummary}`;

    logDebug('PERSONALITY:LLM_PROMPT_SIZE', {
        _desc: 'Prompt size telemetry — chars and approximate tokens',
        systemPromptChars: systemPrompt.length,
        toolResultsChars: resultsSummary.length,
        historyChars: (conversationHistory || []).slice(-10).reduce((sum, h) => sum + ((h?.text || '').length), 0),
        approxTokens: Math.ceil(systemPrompt.length / 4)
    });

    const messages = [
        { role: "system", content: systemPrompt },
        ...(conversationHistory || []).slice(-10).map(h => ({
            role: h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        })),
        { role: "user", content: userMessage }
    ];

    try {
        const response = await queryGroqAI(messages, 1024, 0.4, 1, {}, GROQ_MODEL_ID);
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
