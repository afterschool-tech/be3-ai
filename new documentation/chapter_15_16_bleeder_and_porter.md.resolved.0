# Chapter 15 — Parameter Bleeder

## What It Does

The **Parameter Bleeder** (`pipeline/parameterBleeder.js`) handles **cross-intent parameter inheritance** in multi-intent messages. When statement 2 (`"add it to cart"`) is missing a required parameter that statement 1 (`"show me the iPhone 16"`) already resolved, the bleeder copies it across.

This is Stage 6 in the pipeline and runs **after** parameter extraction for all statements has completed.

---

## When It Runs

```js
if (resolvedStatements.length <= 1) return resolvedStatements;
```

Single-statement messages are returned immediately — there is nothing to bleed from.

---

## The Bleed Logic

```js
for (let i = 1; i < resolvedStatements.length; i++) {
    const current = resolvedStatements[i];
    const intent   = intentRegistry.get(current.intentName);

    for (const [paramName, paramDef] of Object.entries(intent.parameters)) {
        if (!paramDef.required) continue;

        const currentValue = current.extractedParams[paramName];
        const isMissing    = currentValue === null || currentValue === undefined;
        const isIncomplete = ...;  // products array < minProducts

        if (isMissing || isIncomplete) {
            // Look backwards at preceding statements (nearest first)
            for (let j = i - 1; j >= 0; j--) {
                const precedingValue = resolvedStatements[j].extractedParams[paramName];
                if (precedingValue != null) {
                    // inherit or merge
                    break;
                }
            }
        }
    }
}
```

Only **required** parameters are bled. Optional parameters are never inherited.

---

## Two Bleed Modes

### Mode 1 — Direct Inheritance (`isMissing`)

When the parameter is completely absent from the current statement:

```js
current.extractedParams[paramName] = precedingValue;
current.bledParams.push({ param, inherited: precedingValue, fromStatement: j, action: 'inherited' });
```

**Example**: 
- Statement 1: `"show me the iPhone 16"` → resolves `product_name: "iPhone 16"`
- Statement 2: `"add it to cart"` → resolves `product_name: null` (pronoun, not resolved before bleeder)
- Bleeder: copies `product_name: "iPhone 16"` from statement 1 to statement 2.

### Mode 2 — Array Merge (`isIncomplete`)

Only for the `products` array parameter when the intent has a `minProducts` requirement (i.e., `product_compare`):

```js
const isIncomplete = paramName === 'products' &&
    Array.isArray(currentValue) &&
    intent.minProducts &&
    currentValue.length < intent.minProducts &&
    current.intentName === 'product_compare';

// Merge: preceding products prepended + deduplicated
const merged = [...precedingValue, ...currentValue];
current.extractedParams['products'] = [...new Set(merged)];
```

**Example**:
- Statement 1: `"compare the Galaxy S25"` → `products: ["uuid-1"]`
- Statement 2: `"and the iPhone 16"` → `products: ["uuid-2"]`
- Bleeder: merges to `products: ["uuid-1", "uuid-2"]` (product_compare needs ≥ 2).

---

## The `bledParams` Audit Trail

Each inheritance is recorded:

```js
{
  param:         "product_name",
  inherited:     "iPhone 16 Pro Max",
  fromStatement: 0,
  action:        "inherited"   // or "merged"
}
```

This array is attached to each resolved statement and is visible in debug logs.

---

## Nearest-First Inheritance

The backward scan stops at the **nearest** preceding statement that has the required value. If statement 3 needs `product_name` and statements 1 and 2 both have it, statement 3 inherits from statement 2 (closest).

---

---

# Chapter 16 — Intent Porter & Safety Gating

## What It Does

The **Intent Porter** (`pipeline/intentPorter.js`) is Stage 7.5. After all scoring, extraction, and bleeding, it has one final opportunity to **pivot intents** based on state context, purchase signals, and safety guards.

Its core mission: **safely convert `product_search` into `add_to_cart`** when the user's intent is clearly to buy something they've already found.

---

## Helper Functions

### `hasDiscoveryPhrasing(intent)`
Returns `true` if matched keywords or statement text contain discovery verbs:
```
"show", "see", "find", "search", "look", "browse", "details", "info", "specs", "check out",
"what do you have", "let me see", "can i see", "do you sell"
```
If this returns `true`, no porting happens — the user is browsing, not buying.

### `hasPurchasePhrasing(intent)`
Returns `true` if matched keywords or text contain purchase signals:
```
"buy", "purchase", "order", "add to cart", "add it", "grab", "cop", "get",
"i want", "i need", "i'll take", "gimme", "give me"
```

### `isQuestionPhrase(text)`
Returns `true` for phrasing that looks like info-seeking rather than buying:
```
"what about the iPhone?"
"how is the Galaxy?"
"tell me about this one"
```
Question phrases block porting even when purchase verbs are present.

### `isNakedProductSearch(intent)`
Returns `true` when:
- Intent is `product_search`
- No discovery verbs in matched keywords
- Has `product_name` or non-empty `products[]`

A naked product search is `"iPhone 16"` with no context — a strong signal the user wants to act on a product, not find more.

---

## The Porter Loop

```js
for (const intent of intents) {
    // 1. Degradation check
    // 2. Phase 4: Consecutive naked add
    // 3. Existing product_search porting logic
    result.push(out);
}
```

---

## Rule 1 — Degradation to Conversation

```js
const isExtremelyWeak = metrics.signalDensity === 0 &&
                        metrics.entityCount   === 0 &&
                        metrics.transformerGap < 0.1;

if (isExtremelyWeak && !hasDiscoveryPhrasing(intent)) {
    out.intentName    = 'conversation';
    out._downgraded   = true;
    out._original_intent = intent.intentName;
}
```

If an intent has **zero signal density** (no action verbs), **zero entities**, and a **near-zero transformer confidence gap** (the classifier wasn't sure either), the intent is downgraded to `conversation`. This handles gibberish, greetings, and ambiguous single-word inputs.

---

## Rule 2 — Phase 4: Consecutive Naked Product Search

```js
if (intent.intentName === 'product_search' && prevIntentName === 'add_to_cart') {
    if (isNakedProductSearch(intent) && !isQuestionPhrase(intent.statementText)) {
        out.intentName = 'add_to_cart';
        out._ported_from = 'product_search';
    }
}
```

**Scenario**: The user says: `"add the iPhone 16 to my cart and the Galaxy S25"`.

- Statement 1 → `add_to_cart` for iPhone 16.
- Statement 2 → `product_search` for Galaxy S25 (no explicit "add" verb).

Phase 4 detects that a `product_search` follows an `add_to_cart` and the second statement is a naked product reference — it ports the second statement to `add_to_cart` as well. This is how multi-product cart additions work in a single message.

---

## Rule 3 — Stage2 Resolution Porting (Confirmed Product + Purchase)

```js
const stage2Ids = getResolvedProductIdsFromStage2(out.stage2Resolutions);
if (stage2Ids.length === 1 && hasPurchasePhrasing(out) && !isQuestionPhrase(out.statementText)) {
    result.push({
        ...out,
        intentName: 'add_to_cart',
        parameters: {
            ...out.parameters,
            product_id: pid,
            products: [pid],
            _require_confirmation: true,       // ← Opens confirm_add_ported microstate
            _confirm_context: { product, price, vendor }
        },
        _ported_from: 'product_search'
    });
    continue;
}
```

**Scenario**: After a product search, the user says `"I want the cheapest one"`. Context resolution (Stage 3.1) resolved `"the cheapest one"` to a specific product ID via the reference_map. The Stage2 resolutions carry this ID into the porter.

The porter detects: one resolved product ID + purchase phrasing → ports to `add_to_cart` with `_require_confirmation: true`.

`_require_confirmation` opens the `confirm_add_ported` microstate (see `add_to_cart.js`), which asks the user to confirm before executing the cart action. This prevents accidental purchases.

---

## Rule 4 — Reference Map / Query Map Porting

The most common porting path. For any `product_search` with:
- A purchase verb in matched keywords
- No discovery phrasing
- No question phrasing

The porter attempts to resolve the `product_name` to a product ID through three lookup steps:

```
Step 1: user_query_map  → stateManager.resolveUserQuery(userId, productName)
        (Only ports if single result — multi-result = ambiguous, skip)

Step 2: reference_map   → referenceMap[productSlug] || referenceMap[rawLower]
        (Exact slug/name match)

Step 3: reference_map (substring) → key.includes(queryLower) || queryLower.includes(key)
        (Partial match — e.g., "spaghetti" in "home_made_spaghetti")
        (Skips generic ordinal keys: "it", "first", "the_second_one", etc.)
```

If a `knownId` is found:

```js
{
    intentName: 'add_to_cart',
    parameters: {
        product_id:            knownId,
        products:              [knownId],
        _require_confirmation: true,
        _confirm_context:      { product: "...", price: "...", vendor: "..." }
    },
    _ported_from: 'product_search'
}
```

The `_confirm_context` object carries the product name, price, and vendor — used by the `confirm_add_ported` microstate to show the user a confirmation card.

If no ID is found, the intent stays as `product_search` and proceeds normally.

---

## `_require_confirmation` & `confirm_add_ported`

Whenever a porting produces `_require_confirmation: true`, the downstream intent handler (in `add_to_cart.js` config) opens a microstate:

```js
// From add_to_cart.js
microstates: {
    confirm_add_ported: {
        type: 'confirmation',
        prompt: { message: "Just to confirm — add {{product}} to your cart?" },
        onConfirm: [{ tool: 'cart.add', ... }],
        onDeny:    [{ tool: 'conversation.chat', ... }]
    }
}
```

The user sees a card like: **"Just to confirm — add iPhone 16 Pro to your cart? ✅ Yes / ❌ No"**

This is the safety gate that prevents the porter from accidentally purchasing a product the user was just browsing.

---

## Complete Porting Decision Tree

```
For each intent:
    ├─ signalDensity=0 & entities=0 & transformerGap<0.1?
    │   └─ → conversation (degraded)
    │
    ├─ product_search after add_to_cart (naked reference)?
    │   └─ isQuestionPhrase? → keep as product_search
    │   └─ → add_to_cart (Phase 4, no confirmation)
    │
    └─ product_search with purchase phrasing?
        ├─ hasDiscoveryPhrasing? → keep as product_search
        ├─ stage2Ids.length === 1?
        │   └─ → add_to_cart + _require_confirmation
        └─ lookup user_query_map / reference_map
            ├─ Found single ID?
            │   └─ → add_to_cart + _require_confirmation
            └─ Not found → keep as product_search
```

---

*Next: Chapter 17 — Parameter Normalizer*
