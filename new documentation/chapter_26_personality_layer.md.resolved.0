# Chapter 26 — Personality Layer: Response Generation

## Two Stages in One Function

`generateResponseFromTools()` has two distinct jobs that run in strict sequence. First, it takes the raw tool execution results and compresses them into a prompt-safe summary. Second, it takes that summary, assembles the intent-aware system prompt via the DCO, and calls the LLM. These jobs are kept in the same function but are conceptually separate — the summarisation is pure data transformation with no AI, while the generation is the only LLM call in the entire post-execution pipeline.

The sequencing matters because the quality of the LLM response depends entirely on what data it receives. Passing the full, raw tool results to the LLM is not just wasteful — it is actively harmful. Product objects from the backend carry long HTML descriptions, nested metadata objects, image arrays, variant arrays, and dozens of fields the LLM has no business reading. Those fields take up context window space that should be occupied by the system prompt's instructions.

---

## The Pre-Pass: Product List Optimisation

Before `summarizeToolResultsForLLM()` runs, the function does a first-pass optimisation directly on the tool results. This trims product arrays in-place before they reach the summariser — a belt-and-suspenders approach to ensure the `MAX_PRODUCTS_FOR_LLM = 6` cap is always applied even if the summariser's own per-tool logic is bypassed:

```js
const optimizedResults = toolResults.map(tr => {
    if (tr.result && (tr.result.products || tr.result.results || tr.result.items || tr.result.suggested_products)) {
        const isCartView = tr.tool === 'cart.view' || tr.tool === 'cart.get';
        const rawProducts = tr.result.products || tr.result.results || (isCartView ? tr.result.items : null);

        // Cart view is never truncated; everything else is capped at 6
        const limitedProducts = isCartView
            ? rawProducts
            : Array.isArray(rawProducts) ? rawProducts.slice(0, MAX_PRODUCTS_FOR_LLM) : rawProducts;

        return {
            ...tr,
            result: {
                ...tr.result,
                products: Array.isArray(limitedProducts) ? limitedProducts.map(p => ({
                    id:          p.id || p.handle || null,
                    name:        p.name || p.title || null,
                    price:       p.price || null,
                    description: p.description?.substring(0, 160) || null,
                    attributes:  Object.keys(p.attributes || {}).slice(0, 12).reduce((acc, k) => {
                        acc[k] = p.attributes[k]; return acc;
                    }, {})
                })) : []
            }
        };
    }
    return tr;
});
```

Notice the 160-character description truncation. Backend descriptions can be several hundred characters of HTML or marketing copy. The LLM only needs a brief description to talk about a product — cutting at 160 characters gives it enough to characterise the item without overwhelming the context.

---

## `summarizeToolResultsForLLM()` in Depth

The summariser processes each tool result according to its tool type. The base object carries: tool name, success flag, skipped flag, any message, and any error. Tool-specific fields are added on top:

### `vendor.list`
Returns up to `MAX_VENDORS_FOR_LLM = 25` vendors. Keeps: name, tag, product_count, delivery. The `vendors_truncated` flag tells the LLM the list was cut. Vendor names and tags are enough for the LLM to respond to "show me all vendors" without needing delivery policies or contact details in the prompt.

### `vendor.getContactLink` / `vendor.getContact`
Extracts: vendor name, whatsapp_link, phone, message_preview. The message_preview is what the LLM can reference when explaining how to contact the vendor via WhatsApp — the actual pre-filled message text.

### `discovery.sentinel`
Extracts: target_category, suggestion_type, recovery_reason. If the sentinel result includes `whatsapp_product_cards` or `whatsapp` payloads, those are passed through directly — the discovery tool can attach pre-built card payloads.

### `product.facets`
Extracts: facet_target, attribute_code, scope, scope_label. Options are capped at 15 entries with `{ value, count }` pairs. Clauses are capped at 10. This gives the LLM enough to present meaningful filter options without listing every possible attribute value.

### `cart.add`
Extracts only the product name — prioritising the backend's authoritative name over whatever was in the pipeline's params:

```js
base.product_name = rr.product_name || tr.params?.product_name || null;
```

The LLM only needs to say "Added iPhone 16 Pro Max to your cart" — nothing else from the add response is relevant to the text reply.

### `cart.view` / `cart.get`
The cart view is never truncated. Every line item appears in the summary:

```js
base.cart_items = rr.items.map(i => ({
    id:       i?.id || null,
    name:     i?.product_name || i?.name || null,
    quantity: i?.quantity ?? null,
    price:    i?.price ?? null,
    subtotal: i?.subtotal ?? null
}));
base.total = rr.total ?? null;
base.item_count = rr.item_count ?? base.cart_items.length;
```

Truncating a cart view would mean lying to the user about what is in their cart. This is one of the few cases where the accuracy requirement overrides the token economy concern.

### `product.compare`
Uses `expanded_attributes` preferentially — these are human-readable attribute keys emitted by the compare tool's expansion logic. The fallback chain is `expanded_attributes → attributes → raw_attributes`. Up to 24 attribute pairs per product are included. Comparison responses need rich attribute data because that is the substance of the comparison:

```js
attributes: (() => {
    const attrs = p?.expanded_attributes || p?.attributes || p?.raw_attributes || null;
    if (!attrs) return null;
    return Object.keys(attrs).slice(0, 24).reduce((acc, k) => { acc[k] = attrs[k]; return acc; }, {});
})()
```

### Suggested products (fallback vs sentinel)
This is the most nuanced distinction in the summariser. When `suggested_products` is present, the LLM's behaviour should differ based on whether it is a fallback or a sentinel result:

```js
if (Array.isArray(rr.suggested_products) && rr.suggested_products.length > 0) {
    base.suggestion_message = rr.suggestion_message || null;
    base.is_fallback = !!rr.is_fallback;
    base.is_sentinel = !!rr.is_sentinel;

    // Fallback: LLM must NOT have product names — it should direct user to click a button
    // Sentinel: LLM CAN have product names — it describes them as refined matches
    if (!rr.is_fallback) {
        base.suggested_products = rr.suggested_products.slice(0, MAX_PRODUCTS_FOR_LLM).map(p => ({
            id: p?.id, name: p?.name, price: p?.price, whatsapp_link: p?.whatsapp_link, checkout_url: p?.checkout_url
        }));
    }
}
```

When `is_fallback` is true, the product names are intentionally withheld from the summary. The grounding segment's instructions tell the LLM to say "I found some options — tap the button to see them" without naming specific products. This is correct behaviour because fallback products are curated suggestions that may not directly match the user's request — naming them as if they were exact matches would be misleading.

When `is_sentinel` is true, the products are accurate refined matches from the sentinel's vector re-search. The LLM can name them, describe them, and present them as "I refined my search to find better matches."

### Search mode flag
```js
if (rr.mode === 'similar' || rr.search_mode === 'similar') {
    base.search_mode = 'similar';
    if (rr.similar_to_name) base.similar_to_name = rr.similar_to_name;
}
```

This flag prevents the LLM from framing similar-product results as a keyword search response. The `similarity` DCO segment provides specific instructions: "present these as similar to [product name]" — and this flag gives the DCO the information it needs to inject that segment and its argument.

---

## Detecting Skips and Failures

After optimisation and summarisation, the function identifies which tools had problems:

```js
const skippedActions = toolResults.filter(tr => tr.skipped && tr.skippedMessage);
const failedActions  = toolResults.filter(tr =>
    !tr.skipped && (tr.success === false || !!tr.error || !!tr.result?.error)
);
```

These two lists drive the DCO's failure instruction injection. A skipped action (pronoun guard) gets the scripted re-prompt message ("Say 'add the first one' in your next message"). A failed action gets a tool failure summary that the LLM uses to acknowledge what went wrong.

The distinction between skipped and failed matters for the LLM's framing: a skipped action is not a failure — the system made a safe choice and gave the user instructions. A failed action is an actual error that needs to be communicated clearly without pretending success.

---

## The LLM Call

With the prompt assembled and history windowed, the final call is:

```js
const messages = [
    { role: "system", content: systemPrompt },
    ...historyMessages,
    { role: "user",   content: userMessage }
];

const response = await queryGroqAI(messages, maxTokens, 0.4, 1, {}, GROQ_MODEL_ID);
```

**Model**: Groq Llama 3.3 70B — chosen for its strong instruction-following at conversational speeds. The 70B parameter count produces natural, varied prose; smaller models tend toward repetitive phrasing and struggle to maintain the Be3 personality consistently.

**Temperature 0.4**: This is a deliberate balance. A temperature near zero produces deterministic but robotic-sounding text — every cart confirmation sounds identical. Temperature above 0.6 risks hallucinating product names or inventing details. 0.4 gives the model enough randomness to sound genuinely conversational while keeping it anchored to the provided data.

**Max tokens**: From the DCO config — 512 for transactional responses, up to 1500 for comparisons. The LLM is told to be adaptive in length via the verbosity hint, so in practice short responses stay short even with a generous token budget.

**One retry**: The Groq call is configured with 1 retry on network failure. This is intentionally low — the system is designed to fail-fast to the fallback rather than hanging on retries.

---

## The Fallback Chain

If the LLM returns an empty response or throws:

```js
// 1. Try LLM
const response = await queryGroqAI(messages, maxTokens, 0.4, 1, {}, GROQ_MODEL_ID);
if (!response || response.trim().length === 0) {
    // 2. Fall back to tool result message
    const primaryToolResult = toolResults.find(t => t.result && t.result.message);
    return primaryToolResult
        ? primaryToolResult.result.message
        : "I've processed your request successfully.";  // 3. Generic fallback
}
return response.trim();
```

The primary fallback uses the `message` field that most tool handlers populate — for `cart.add` this is `"Added iPhone 16 Pro Max to your cart."`, which is accurate and complete even without AI embellishment. The tertiary generic fallback is a worst-case safety net that is almost never reached in production — it exists to ensure the endpoint never returns an empty reply under any circumstances.

---

## What the Personality Layer Does Not Do

Understanding the layer's scope is as important as understanding what it does. It does not:

- Make any decisions about which tools ran or why
- Modify tool results before sending them to the LLM
- Validate the LLM response for accuracy against the tool data
- Handle any UI formatting (buttons, cards, images) — those are the snapshot aggregator's responsibility
- Summarise or compress conversation history — that is a background process that runs separately

Its sole responsibility is: given a set of tool results and a user message, produce a natural language response in Be3's voice that accurately reflects what those tools found or did.

---

*Next: Chapter 27 — Image Injection & WhatsApp UX*
