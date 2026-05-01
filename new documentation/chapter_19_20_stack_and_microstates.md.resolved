# Chapter 19 — The Stack: Deferred Multi-Intent Execution

## What It Does

The **Stack** (`pipeline/stack.js`) manages sequential execution of **multi-intent messages**. When a user sends a message that resolves to multiple intents — e.g., `"search for iphones and add the first two to cart"` — those intents cannot all execute at once. The first intent (product search) must complete and return results **before** the second intent (add to cart) can resolve ordinals like "the first two".

The stack defers all but the first intent into a Redis-persisted queue and resumes them one at a time after each preceding intent completes.

---

## Single vs Multi Intent

```js
if (intents.length === 1) {
    // Bypass stack overhead entirely
    const tools = toolMapper.mapToTools([intents[0]]);
    return { intents, tools, isMultiIntent: false };
}
```

Single-intent messages skip the stack entirely — no Redis write, no queue. The stack only engages for 2+ intent messages.

---

## `executeIntentStack()` — First Execution

```js
const stack = {
    remaining_intents: intents.slice(1),   // All except first
    current_intent_index: 0,
    executed_intents: [],
    accumulated_results: [],
    last_search_context: null,
    search_history: [],
    created_at: ...,
    expires_at: now + 300s    // 5-minute TTL
};

await stateManager.setStack(userId, stack);

// Execute only the first intent
const tools = toolMapper.mapToTools([intents[0]]);
return { intents, tools, isMultiIntent: true, stack_active: true };
```

The stack object is persisted to Redis. `server.js` detects `stack_active: true` in the result and knows to check the stack after the tool response is processed.

---

## `resumeIntentStack()` — Continuation After Each Intent

Called by `server.js` after the previous intent's tool response is received and the state is updated:

```js
async function resumeIntentStack(userId, state, storeContext) {
    const stack = await stateManager.getStack(userId);
    if (!stack) return null;

    // Check TTL
    if (new Date() > new Date(stack.expires_at)) {
        await stateManager.clearStack(userId);
        return null;
    }

    // Advance: move first remaining_intent to executed
    stack.executed_intents.push(stack.remaining_intents[0]);
    stack.remaining_intents = stack.remaining_intents.slice(1);
    stack.current_intent_index++;

    // All done?
    if (stack.remaining_intents.length === 0) {
        await stateManager.clearStack(userId);
        return { complete: true };
    }

    // Re-resolve ordinals before executing next intent
    await reResolveOrdinalsForRemainingIntents(stack.remaining_intents, state, storeContext);

    // Execute the next intent
    const nextIntent = stack.remaining_intents[0];
    const tools = toolMapper.mapToTools([nextIntent]);
    await stateManager.setStack(userId, stack);

    return { intents: [nextIntent], tools, stack_active: true, resumed_from_stack: true };
}
```

---

## Ordinal Re-Resolution — The "First Two" Problem

The problem: when a user says `"search iphones and add the first two to cart"`, the pipeline processes the whole message at once. At that moment, `"the first two"` cannot be resolved to product IDs because the search hasn't run yet.

The solution: during parameter extraction, ordinals are stored as raw phrases:

```js
params._context_grouped_ordinal = "the first two"
params.products = ["the first two"]   // unresolved
```

After the search runs and updates `search_context`, `resumeIntentStack()` calls `reResolveOrdinalsForRemainingIntents()`:

```js
async function reResolveOrdinalsForRemainingIntents(remainingIntents, state, storeContext) {
    const searchCtx = stackData?.last_search_context || await stateManager.getSearchContext(userId);
    // searchCtx.product_ids = ["uuid-1", "uuid-2", "uuid-3", ...]

    for (const intent of remainingIntents) {
        // Skip non-cart intents
        if (!['add_to_cart', 'product_compare', ...].includes(intent.intentName)) continue;

        // Extract the ordinal phrase from products[0] or product_name or stored _context_grouped_ordinal
        const phraseStr = "the first two";

        // Try grouped ordinal: "first two" → indices [0, 1]
        const groupedIndices = resolveGroupedOrdinal(phraseStr, searchCtx.product_ids.length);
        if (groupedIndices?.length > 0) {
            params.products = groupedIndices.map(i => searchCtx.product_ids[i]);
            params._context_product_ids = params.products;
            params._context_grouped_ordinal = phraseStr;
            params._from_context = true;
            delete params.product_name;  // prevent toolMapper from using stale phrase
        }

        // Try single ordinal: "the second one" → index 1
        // Try "last one" → searchCtx.product_ids[last]
    }
}
```

The re-resolution prefers the **stack-scoped** `last_search_context` (updated by the tool handler after each search within the stack) over the global search context.

**UUID Guard**: If `products[0]` is already a UUID (from a previous re-resolve against a smaller search result), and we have a stored ordinal phrase, the system re-attempts with the stored phrase against the now-expanded search context. This prevents stale partial resolutions from locking in too early.

---

## Stack TTL & Expiration

```js
const STACK_TTL_SECONDS = 300;   // 5 minutes
```

If the user takes more than 5 minutes between intents in a stack, the stack expires. `resumeIntentStack()` checks this and clears the dead stack, returning `null` to signal no resume.

---

## Stack + Microstate Coordination

When a microstate opens during stack execution (e.g., the porter's `_require_confirmation` flag opens a confirm microstate), the stack is **preserved** intact. After the microstate is fulfilled, the microstate runner detects the active stack and passes `stack_active: true` in its result. `server.js` then calls `resumeIntentStack()` to continue.

The fulfilled microstate's intent is matched against `remaining_intents` and removed from the queue before the stack advances. This matching uses `product_name` as a discriminator when multiple intents have the same `intentName` (e.g., two `add_to_cart` intents in a single message).

---

---

# Chapter 20 — Microstates: Conversational Slot-Filling

## What They Are

A **microstate** is an active conversational context that the pipeline enters when it needs more information from the user before executing a tool. Instead of proceeding with incomplete parameters, the system opens a microstate and enters a **sandbox** — all subsequent user messages are intercepted and processed by the `microstateRunner` until the microstate is fulfilled, cancelled, or expired.

Example scenarios:
- `"add to cart"` with no product specified → `missing_query` microstate asks `"Which product?"`
- `"who sells iphone?"` → `ordinal_choice` microstate shows vendors to pick from
- `"i'll take the third one"` → confirm_add microstate asks `"Just to confirm — add iPhone 16?"`

---

## Microstate Structure (Stored in Redis)

```js
{
    id:         "ms_add_to_cart_1234567890",
    type:       "ordinal_choice",          // Determines response utility used
    intent:     "add_to_cart",             // Intent to execute when fulfilled
    tool:       "microstate.disambiguate", // Tool to call for re-prompt
    sandbox:    "soft",                    // "soft" = breakthrough allowed, "hard" = locked
    confidence: 3,                         // Decremented on useless turns
    boostScore: 7.4,
    params: {                              // Current accumulated params
        category: "cat-smartphones-uuid",
        products: [],
        _ordinal_choice_product_ids: ["uuid-1", "uuid-2", "uuid-3"]
    },
    options: [                             // Displayed choices (for button UX)
        { label: "iPhone 16 Pro", value: "uuid-1" },
        { label: "Samsung S25", value: "uuid-2" }
    ],
    contract: {
        onFulfilled: ["products"],         // Params needed to fulfill
        maxMessages: 3,                    // Max prompts before expiry
        messagesUsed: 0,
        escalation: null,                  // Intent to run on cancel/expiry
        onKeyword: ["cancel", "stop", "nevermind"]
    },
    features: [...]                        // Dynamic feature injections
}
```

---

## `microstateRunner.run()` — Full Execution Flow

Every incoming message passes through the runner when a microstate is active. It returns `{ handled: boolean, result }`:
- `handled: true` → microstate consumed the message; return result directly, skip normal pipeline.
- `handled: false` → message broke through the sandbox; run normal pipeline.

### Step 1 — Engineered Cancel Token

If the message is `__flow:cancel__` (injected by a UI cancel button), terminate immediately. If an escalation intent is configured, execute it. Otherwise clear and return empty tools.

### Step 2 — Navigation Tokens

`__nav:more__`, `__nav:prev__`, `__paging:next__` etc. trigger pagination logic:

| Navigation Type | Handler |
|----------------|---------|
| `suggest_from_store` feature | Store item rotation (wrap-around) |
| `suggest_related_products` feature | Dynamic product recommendation rotation |
| `tool_pagination` microstate | Tool re-call with incremented `page` param |
| Legacy option list | Generic option window shift |

All return a reprompt with updated options and `microstate_reprompt: true`.

### Step 3 — Termination Keywords

```js
if (isTerminationKeyword(cleanedText, microstate.contract.onKeyword)) {
    await stateManager.clearMicrostate(userId);
    // Escalate or let pipeline through (handled: false)
}
```

### Step 4 — Response Analysis (`analyzeResponse()`)

Runs all response utilities on the user's reply:

| Utility | What it resolves |
|---------|-----------------|
| `resolveYesNo()` | "yes", "yeah", "no", "nah", "nope" → `"yes"/"no"/"ambiguous"` |
| `resolveOrdinal()` | "first", "2", "third one", "last" → 1-based index or -1 |
| `resolveSelection()` | Button/option match by text or index |
| `resolveMultiSelection()` | Multiple selections ("the first two options") |
| `resolveEngineeredToken()` | `__ns:cmd__` tokens from UI buttons |

### Step 5 — Soft Sandbox Breakthrough

```js
if (microstate.sandbox === 'soft') {
    const breakthrough = checkBreakthrough(cleanedText, microstate, storeContext);
    if (breakthrough) {
        await stateManager.clearMicrostate(userId);
        return { handled: false, result: null };  // Normal pipeline takes over
    }
}
```

A "breakthrough" is when the user's message is clearly an unrelated new intent (e.g., `"show me laptops"` while in a cart disambiguation microstate). The soft sandbox allows this — it clears the microstate and hands off to the normal pipeline. A `"hard"` sandbox would not allow this.

### Step 6 — Entity Extraction

```js
const extractionResult = extractEntities(cleanedText, storeContext, getIdfMap());
```

Entities extracted from the user's reply are used to fill microstate params (category, vendor, brand).

### Step 7 — `buildNewParams()` — Map Reply to Params

The most complex step. Converts response analysis + entity extraction into parameter updates:

| Source | Mapping |
|--------|---------|
| `yesNo === 'yes'/'no'` | → `confirmation: true/false` (if contract needs `confirmation`) |
| `selection.match` | → first `onFulfilled` param, or appended to `products[]` for compare |
| `ordinal_choice + ordinal` | → `products[index]` from `_ordinal_choice_product_ids` |
| `multiSelection` | → multiple products for compare |
| Entity `category` | → `category` param (and fallback to `products` or `query`) |
| `residualWords` | → first missing `onFulfilled` param (with junk filter) |

**Junk Filter**: residual words like "please", "what", "okay", question phrases, and off-topic terms ("delivery", "refund") are rejected as param values. This prevents garbage from fulfilling a slot.

**Category-to-Product Fallback**: For `product_compare`, if the user types something that resolves as a category, it's treated as a product selection and appended to `products[]`.

### Step 8 — Fulfillment Check

```js
const fulfilled = checkFulfillment(microstate.contract.onFulfilled, mergedParams);
```

All params in `onFulfilled[]` must be non-null and non-empty. For `product_compare`, at least 2 products must be present regardless of `onFulfilled`.

### Step 9 — Fulfillment Execution

When fulfilled:
1. `clearMicrostate(userId)`
2. `normalizeParameters()` on merged params
3. `mapToTools()` to generate tool calls
4. If `onFulfilledSpawn` exists, set the next microstate
5. If a stack is active: remove the fulfilled intent from `remaining_intents`, update stack, return `stack_active: true`
6. Return `microstate_fulfilled: true`

### Step 10 — Not Fulfilled: Advance & Re-prompt

```js
const updated = await stateManager.advanceMicrostate(userId, newParams, advanced);
```

`advanceMicrostate` increments `messagesUsed` and decrements `confidence` if the turn was useless (no new params added). If the microstate expires (`messagesUsed >= maxMessages` or `confidence <= 0`), it follows the expiry escalation path.

Otherwise, `buildReprompt()` constructs the next question and injects feature-driven options (e.g., dynamic product suggestions from `microstateFeatureProvider`). The reprompt and options are returned as a `microstate.disambiguate` tool call.

---

## Microstate Types Reference

| Type | What triggers it | Resolved by |
|------|-----------------|-------------|
| `missing_query` | Intent needs product_name but has none | User types product name |
| `missing_category` | Intent needs category | User selects/types category |
| `ordinal_choice` | Multiple candidates for a slot | User picks by number or label |
| `confirmation` | Porter created `_require_confirmation` | User says yes/no |
| `confirm_add_ported` | Porter ported product_search → add_to_cart | User confirms or denies |
| `tool_pagination` | Search result has more pages | User says "more"/"next" |
| `disambiguation` | Ambiguous entity (multiple vendor matches, etc.) | User selects |

---

*Next: Chapter 21 — Tool Orchestrator: Execution & Circuit Breaker*
