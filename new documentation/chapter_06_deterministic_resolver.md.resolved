# Chapter 6 — Deterministic Resolver & Pipeline Orchestrator

## Overview

The **Deterministic Resolver** is the first true processing layer after the `/chat` endpoint receives a message. Its name reflects that it contains **zero AI calls** in the critical path — all routing decisions are made from mathematical keyword matching, state lookups, and pre-compiled patterns.

The system has two parts:
1. **`deterministicResolver.js`** — a thin wrapper in `src/core/`.
2. **`intentResolver/index.js`** (`resolveAndMap()`) — the full pipeline orchestrator.

---

## `deterministicResolver.js` — The Entry Wrapper

```js
async function resolveDeterministic(userMessage, state) {
    const result = await resolveAndMap(
        userMessage,
        state,
        queryAI,          // The Groq AI function — only used for IntelliSense (Stage 0b)
        storeContext      // { CATEGORIES, VENDORS, ATTRIBUTES, COLLECTIONS }
    );

    return {
        tools:              result.tools || [],
        intent:             result.intents?.[0]?.intentName || 'unknown',
        confidence:         result.intents?.[0]?.score || 0,
        result:             result,
        pipelineConfidence: result.confidenceScore ?? 100,
        confidenceSummary:  result.confidenceSummary ?? null
    };
}
```

Key points:
- `queryAI` (Groq AI function) is passed as `aiQueryFn` — this is what IntelliSense uses. The rest of the pipeline uses it only as a fallback for parameter extraction.
- `storeContext` carries the full store catalogue (categories, vendors, attributes, collections) — it is compiled at startup from the backend API and cached in memory.
- The wrapper extracts the primary intent from `result.intents[0]` for the server layer to use. The full `result` is retained for multi-intent stack building.

---

## `resolveAndMap()` — The Pipeline Entry

`resolveAndMap()` is the **master orchestrator** of the entire NLU pipeline. It is ~2,500 lines of carefully ordered logic. The function begins with a series of **early-exit stages** (Stage -1, Stage 0a through 0h) before the main NLU work begins.

The signature:
```js
async function resolveAndMap(userMessage, state, aiQueryFn, storeContext)
```

---

## Module-Level Initialization

Before any request, the module runs:

```js
const idfMap = intentRegistry.buildIdfMap();
```

This builds the **IDF (Inverse Document Frequency) weight map** once at startup from all intent bench examples. Rare words that appear in only one intent's training data get higher IDF weights, making them stronger classification signals. This map is reused for every request without recomputation.

---

## Stage -1 — LLM Suggestion Confirmation Intercept

The very first thing `resolveAndMap()` checks is whether the previous AI response embedded a `<suggestion>` block (see Chapter 2, Step 21). If so:

```js
const lastSuggestion = state.last_bot_suggestion;
if (lastSuggestion) {
    // ALWAYS clear the suggestion — it lives exactly one turn
    await stateManager.updateState(state.user_id, { last_bot_suggestion: null });

    const confirmationType = isConfirmation(userMessage);

    if (confirmationType === 'yes' && lastSuggestion.rephrase) {
        // User confirmed → recurse with the rephrased string
        return await resolveAndMap(lastSuggestion.rephrase, state, aiQueryFn, storeContext);
    }
}
```

**Behaviour**:
- The suggestion is **cleared unconditionally** — it only lives for the one turn the bot offered it.
- If the user confirms (yes/yeah/sure/etc.), the pipeline **restarts recursively** using `lastSuggestion.rephrase` as the new user message. The user's original input is discarded.
- If the user declines or says something unrelated, the suggestion is cleared and the original message continues normally.

This is how a bot reply like "Would you like to see other phones from that vendor?" becomes an actionable follow-up — the rephrase string `"show me other phones from Dareymi"` replays the full NLU pipeline.

---

## Stage 0a — Navigation Tokens (Pagination & Cards)

The first engineered token check runs before IntelliSense.

```js
const engineeredEarly = resolveEngineeredToken(rawMessage);
```

**`__nav:cards:<snapshotId>__`** (cards):
- Returns `product.showCards` tool immediately with the snapshot ID.

**`__nav:more__`, `__nav:prev__`, `__nav:results__`** (pagination):
- Loads `last_search.filters` from state (or snapshot if `snapshotId` in arg).
- Increments/decrements the `page` field.
- `results` command drops `query` and `clause_words` (relaxed re-search).
- **Microstate guard**: If a microstate is active, skips Stage 0a entirely — the microstateRunner handles navigation within sandboxes.

---

## Stage 0b — Clause Filter Tokens

**`__filter:clause:<snapshotId?>:<attrCode>:<clauseName>__`**

- Loads base filters from state (or snapshot).
- Adds the clause to `attributes` under the key `attrCode:clauseName`.
- Resets `page` to 1.
- Returns `product.search` immediately.

The `attrCode:clauseName` format is a specific clause key convention the backend search API expects (e.g., `brand:apple_product`).

---

## Stage 0c — Facet Value Filter Tokens

**`__filter:value:<snapshotId?>:<attrCode>:<value>__`**

- Same pattern as clause filter, but uses the simpler `attrCode: value` format.
- Values are URL-decoded (`decodeURIComponent`).
- Returns `product.search` immediately.

---

## Stage 0d½ — Facet Selector Tokens

**`__facet:select:<attrCode>:<value>[:<categoryId>]__`**

- No state lookup needed (self-contained).
- Returns `product.search` with `attributes: { [attrCode]: value }` and optional `category`.

---

## Stage 0d — Product Details Tokens

**`__product:details:<productId>__`**

- Returns `product.getDetails` with the product ID.
- Zero state lookup, zero AI.

---

## Stage 0d½ — Product Similarity Tokens

**`__product:similar:<productId>__`**

- Returns `product.search` with `similar_to: productId`.

---

## Stage 0e — Product Compare Tokens (Opens a Microstate)

**`__product:compare:<productId>__`** — the most complex engineered token handler.

```
1. Load trigger definition from microstateRegistry ('product_compare' → 'missing_products')
2. Reconcile product name from ID via reconcileNameFromId()
3. Build full microstate object:
      params.products = [productId]
      params._labels  = { [productId]: productName }
4. stateManager.setMicrostate()  ← opens the sandbox
5. microstateFeatureProvider.getFeatureInjections()  ← gets "compare with similar" suggestions
6. Sync injected options back into microstate state
7. Build prompt:
      if injections.options.length > 0 → microstate.disambiguate
      else                              → microstate.collect
8. Return immediately with microstate_opened: true
```

The bot's reply will be "What is the second product you want to compare with?" along with suggestion buttons for similar products — without any NLU pass.

---

## Stage 0f — Cart Add Tokens

**`__cart:add:<productId>__`**

- Calls `reconcileNameFromId()` to look up the product name from last_search, reference_map, search_context, or user_query_map.
- Returns `cart.add` tool with `product_id` + `product_name`.
- The `product_name` is cosmetic — it gives the personality layer the name to say in the reply.

### `reconcileNameFromId(state, productId)` — Name Resolution Priority
```
1. state.product_context.last_search.results  → find by id/product_id/handle
2. state.reference_map                         → reverse lookup (id → alias)
3. state.search_context.product_attributes_map → check pAttrs.name / pAttrs.title
4. state.user_query_map                        → find which query mapped to this ID
```

---

## Stage 0g — Cart View, Checkout, Continue Shopping

**`__cart:view__`** → `cart.view`

**`__order:checkout__`** → `order.checkout`

**`__shop:continue__`** → `product.search` with:
- Last search filters if available.
- Fallback: `{ query: 'popular', limit: 5 }` (default browse).

---

## Stage 0h — Vendor Tokens

**`__vendor:products:<vendorKey>__`** → `vendor.getProducts`

**`__vendor:contact:<vendorKey>__`** → `vendor.getContactLink`

**`__vendor:info:<vendorKey>__`** → `vendor.getInfo`

The `vendorKey` is base64url-decoded first (WhatsApp-safe encoding), falling back to `decodeURIComponent` for legacy tokens. This handles vendor names with spaces and special characters.

---

## Stage 0 — Active Microstate Check

After all engineered token handlers, the microstate is checked for normal text messages:

```js
const activeMicrostate = await stateManager.getMicrostate(userId);
if (activeMicrostate) {
    const msResult = await microstateRunner.run(userMessage, activeMicrostate, state, storeContext);

    if (msResult.handled) {
        return msResult.result;   // ← exits the entire pipeline
    }
    // else: "breakthrough" — message broke through the soft sandbox
    // falls through to normal NLU pipeline
}
```

**`msResult.handled = true`** means the microstateRunner consumed the message:
- `microstate_fulfilled`: All required params collected → tools built and returned.
- `microstate_escalated`: Termination keyword detected → microstate cleared, escalation intent returned.
- `microstate_reprompt`: Input was invalid → bot re-asks the question.

**`msResult.handled = false`** (breakthrough) means:
- The message doesn't match what the microstate was collecting.
- The microstate sandbox mode is `'soft'` → the message falls through to the normal NLU pipeline.
- `'hard'` sandboxes would return `handled: true` with a reprompt even on unrelated input.

See Chapter 20 for the complete `microstateRunner` documentation.

---

## Transition to the Main NLU Pipeline

If none of the Stage 0x checks return, the message enters the **main NLU pipeline**. The next steps are:

```
Stage 0b — IntelliSense analysis (split/normalize/classify via Groq LLM)
Stage 0.5 — Transformer entity extraction (/extract)
Stage 3a  — Global clause pre-pass (brand/vendor terms per statement)
Per-statement loop:
    Stage 4b — Hierarchical classification (L1→L2→L3)
    Stage gates — decide which stages to run
    Stage 2  — Context resolver
    Stage 4a — Entity extractor
    Stage 4b — Schema resolver (IDF scoring)
    Stage 5  — Parameter extractor
    Stage 6  — Parameter bleeder
    Stage 7  — Intent porter
    Stage 8  — Parameter normalizer
Stage 9 — Tool mapper
```

These are covered in Chapters 7–18.

---

## The Return Shape of `resolveAndMap()`

```js
{
  intents: [
    {
      intentName:      "add_to_cart",
      score:           0.92,
      parameters:      { product_id: "uuid-123", quantity: 1 },
      matchedKeywords: ["add", "cart"],
      statementText:   "add the first one to cart"
    }
  ],
  tools: [
    { tool: "cart.add", params: { product_id: "uuid-123", quantity: 1 }, reason: "..." }
  ],
  isMultiIntent:      true,
  corrections:        { original: "show me iphone and add the first one", resolved: "..." },
  resolutions:        [{ pronoun: "the first one", resolvedTo: "uuid-123" }],
  confidenceScore:    87,
  confidenceSummary:  "High: strong keyword match, entity confirmed by transformer",
  engineered_*:       true   // flag present if an engineered token was processed
}
```

The server uses `intents[0].intentName` as the primary intent for state/log purposes. All intents are passed to the DCO for personality layer context.

---

*Next: Chapter 7 — Stage 0.5: Transformer Entity Extraction*
