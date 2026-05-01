# Chapter 13 — Schema Resolver & IDF Scoring

## What It Does

The **Schema Resolver** (`pipeline/schemaResolver.js`) takes the extracted entities and cleaned text, scores every registered intent, and returns a ranked list of candidates. It is the core **intent matching engine** — answering the question: *"Given what we know about this statement, which intent is most likely?"*

It does this through a 6-phase pipeline of deterministic scoring, with transformer L3 scores applied on top in the main loop.

---

## Two Key Mappings

### `ENTITY_TO_PARAM` — Entity Type to Parameter Slot

```js
const ENTITY_TO_PARAM = {
    'vendor':           'vendor',
    'category':         'category',
    'brand':            'brand',
    'order_id':         'order_id',
    'quantity':         'quantity',
    'price_max':        'price_max',
    'price_min':        'price_min',
    'clause':           'clause_words',
    'resolved_product': 'product_name',
    'facet_target':     'facet_target'
};
```

This is how entity types from the extractor are matched to parameter names in intent config schemas. For example, a `category` entity fills the `category` param slot in `product_search`.

### `ACTION_TO_INTENTS` — Action Category to Intent

```js
const ACTION_TO_INTENTS = {
    'purchase':       ['product_search'],   // buy → search first; porter pivots to cart
    'cart_add':       ['add_to_cart'],
    'cart_view':      ['view_cart'],
    'cart_remove':    ['remove_from_cart'],
    'cart_update':    ['update_cart_quantity'],
    'discovery':      ['product_search', 'browse_collection', 'vendor_products'],
    'contact':        ['vendor_contact'],
    'tracking':       ['order_status'],
    'checkout':       ['start_checkout'],
    'info':           ['vendor_info', 'get_help'],
    'help':           ['get_help'],
    'compare':        ['product_compare'],
    'discovery_meta': ['facet_list', 'vendor_facet']
    // ...
};
```

When an action entity like `{ verb: "add", category: "cart_add" }` is detected, `cart_add` maps to `['add_to_cart']`, giving that intent an IDF score boost.

**Note**: `"buy"` maps to `'purchase'` → `['product_search']`, not directly to `add_to_cart`. The **intentPorter** later pivots `product_search` to `add_to_cart` when the user has product context. This prevents false cart additions when users are still browsing.

---

## Phase 1 — Build Entity-to-Param Map

```js
const entityParams = {};   // { 'category': entity, 'vendor': entity, ... }
const entityTypes  = new Set();
const actionEntities = [];

for (const entity of entities) {
    if (entity.type === 'action') {
        actionEntities.push(entity);
    } else {
        const paramName = ENTITY_TO_PARAM[entity.type];
        if (paramName) {
            entityParams[paramName] = entity;
            entityTypes.add(entity.type);
        }
    }
}
```

If `residualWords` exist and no `product_name` is filled, residuals become a synthetic product_name entity:

```js
if (residualWords.length > 0 && !entityParams['product_name']) {
    entityParams['product_name'] = {
        type: 'product_name',
        value: residualWords.join(' '),
        source: 'residual'
    };
}
```

---

## Phase 2 — Action Verb Intent Set

```js
for (const action of actionEntities) {
    // Skip generic cart_view when a specific cart op exists
    // e.g. "bump my cart" → cart_update wins over cart_view
    if (action.category === 'cart_view' && hasSpecificCartOp) continue;

    const suggestedIntents = ACTION_TO_INTENTS[action.category] || [];
    suggestedIntents.forEach(i => actionSuggestedIntents.add(i));
    if (action.idf > bestActionIdf) bestActionIdf = action.idf;
}
```

Three important flags computed here:
- `hasPurchaseAction` — user said "buy", "want", "need" etc.
- `hasCartRemoveAction` — triggers Cart Remove Dominance rule.
- `hasCompareAction` — triggers Compare Dominance rule.

---

## Phase 3 — Score Each Intent

For every registered intent, the scorer runs a sequential series of modifiers. Each modifier calls `applyModifier(value, reason)` which both adds to the score and appends an audit entry to `deterministicBreakdown[]`.

### 3a — Schema Fit

For each parameter in the intent's schema:

```js
if (entity fills the slot) {
    if (paramDef.required) { requiredFilled++; score += 2.0 }
    if (!paramDef.required) { optionalFilled++; score += 0.5 }
}
if (no entity && paramDef.required) {
    hasUnfilledRequired = true;
}
```

**Strict Type Rule**: A `category` entity cannot fill a `product_name` or `products` slot. This prevents a category match from satisfying a `product_compare` intent's product requirement.

**Context Ownership**: If `product_name`, `products`, or `item` is empty but `resolved_product` entities exist (from context resolution), the first resolved product takes ownership of that slot.

**Category Quality Downweight**: Optional category slots with `quality < 1.0` (partial/semantic matches) reduce their own score contribution:

```js
score -= (1.0 - catQuality) * 0.5;
```

### 3b — Schema Score

```
Required slot filled:  +2.0 per slot
Optional slot filled:  +0.5 per slot
```

### 3c — Action Verb Boost

If the action verb's category maps to this intent, add the verb's IDF weight:

```js
applyModifier(action.idf, `Action verb: "add" (+1.4 IDF)`);
matchedKeywords.push(action.verb);
```

IDF weights are pre-computed by `intentRegistry.buildIdfMap()` at startup. A verb that appears in only one intent's training bench gets a high IDF weight; a verb that appears across many intents gets a low weight.

### 3d — IDF Keyword Matching

Every keyword and synonym in the intent's config is checked against the text:

```js
for (const kw of intent.keywords) {
    const matched = isMultiWord
        ? textLower.includes(kwLower)    // phrase: substring match
        : textWords.includes(kwLower);   // token: whole-word match

    if (matched) {
        const kwIdf = idfMap[kwLower] || 0.5;
        const exactMatchBoost = exactMatch ? 3.0 : 0;
        const phraseBoost = isMultiWord ? 1.5 : 0;
        applyModifier(kwIdf + exactMatchBoost + phraseBoost, ...);
    }
}
```

- **Multi-word phrases** use substring match and get `+1.5` phrase bonus.
- **Exact full-text match** gets an extra `+3.0` bonus.
- **IDF** from `idfMap` ensures rare, intent-specific keywords score higher than common words.

### 3e — Synonym Phrase Matching

Multi-word synonyms get `+1.5` if found in the text. Single-word synonyms are skipped here (they are in the keywords list anyway).

---

## Phase 3f — Intent-Specific Signal Rules

These rules override or adjust scores for specific situations:

### Cart Remove Dominance
```js
if (hasCartRemoveAction) {
    remove_from_cart += 6.0;
    product_search   -= 4.0;
    browse_collection -= 4.0;
}
```
Prevents "remove the iphone" from accidentally routing to product_search.

### Compare-by-Signal Rule
```js
if (hasComparisonSignal && likelyMultiProductRequest) {
    product_compare += 5.0;
    product_search  -= 2.5;
}
```
`hasComparisonSignal`: regex on text for "vs", "versus", "comparison", "which one should I get".
`likelyMultiProductRequest`: 2+ brand tokens in text (iPhone, Galaxy, etc.).

### Compare Dominance Rule
```js
if (hasCompareAction) {
    product_compare += 6.0;
    product_search  -= 4.0;
}
```
When the user explicitly says "compare", the compare intent dominates even if brand/clause entities are present.

### Discovery Sentinel Suppression
```js
discovery_sentinel -= 15.0;
```
`discovery_sentinel` is a **port-only intent** — it only exists to be ported by the intentPorter into `browse_collection`. It should never win classification directly.

### Search-Discovery Rule
```js
if (product_search && hasCategory && hasClause) {
    product_search += 2.0;
}
```
"Cheap smartphones" = category + clause → strong product search signal even without an action verb.

### Unfilled Required Penalty
```js
if (hasUnfilledRequired && requiredFilled === 0 && entities.length > 0 && !actionDirectlySupports) {
    applyModifier(-5.0, 'No required slots match (unfilled)');
}
```
An intent with required params that no entity can fill gets penalised — unless an action verb directly suggests it (in which case the parameter extractor may fill it downstream).

### Vendor Official Tenant Boost
```js
if (entityParams['vendor'] && params.vendor && isOfficialTenant) {
    score += 1.0;
}
```

### Zero-Param Baseline Penalty
```js
if (params.length === 0 && matchedKeywords.length === 0 && !actionSuggestedIntents.has(intent)) {
    applyModifier(-2.0, 'Baseline penalty (zero-param intent)');
}
```

### Discovery vs Identity Bias
```js
if (entityParams['brand'] || entityParams['category']) {
    product_search    += 1.5 × categoryQuality;
    vendor_identity   -= 2.0;  // if no info action verb
}
```
A brand mention alone should route to product_search, not vendor_identity.

### Hierarchy Boost
```js
if (isRootCategory && !hasProductTerms && !hasPurchaseAction) {
    discovery_sentinel += 2.0;
}
```
A root category alone (e.g., "Gadgets") → user wants to browse, not search. Boosts the discovery_sentinel which the porter converts to `browse_collection`.

### Facet Dominance Rule
```js
if (facet_list && entityParams['facet_target']) {
    if (hasDiscoveryMeta) facet_list += 10.0;  // "what colors..."
    else if (hasDiscovery) facet_list += 8.0;  // "show me colors..."
    else                   facet_list += 2.0;
}
```

### Vendor Facet Dominance
```js
if ("who sells" / "which store" phrasing) {
    vendor_facet    += 8.0;
    vendor_identity -= 5.0;
}
```

### Orphan Noun Rule
```js
if (entityParams['product_name'].source === 'residual' && intentName === 'product_search') {
    // Boost only if: not a keyword for another intent, no resolved product, no ambient context
    product_search += 2.0;
    vendor_identity -= 1.0;
}
```
A free-standing product-like noun routes to product_search by default.

### Similarity Dominance Rule
```js
if (nonSearchHitIntents.has('product_similar')) {
    product_similar += 6.0;
    product_search  -= 4.0;
}
```
Prevents the large keyword bench of `product_search` from drowning out an explicit similarity request.

---

## Phase 3.5 — Signal Density Gating

```js
const signalDensity = entityCount > 0 ? signalCount / entityCount : 0.0;
const isLowSignal = signalDensity < 0.3 && signalCount === 0;

if (isLowSignal) {
    for (const candidate of scored) {
        candidate.score *= 0.5;  // Halve all positive scores
    }
}
```

`signalCount` = number of action entities + (1 if any non-search keyword matched). `entityCount` = total extracted entities.

**Intuition**: If a statement has 4 entities (category, vendor, clause, brand) but zero action verbs and zero keyword hits, those entities may be extraction noise from an ambiguous phrase. The gating halves all scores to prevent a noisy extraction from confidently routing to the wrong intent.

---

## Phase 4 — Sort and Select Winner

```js
scored.sort((a, b) => b.score - a.score);
const validCandidates = scored.filter(c => c.score > 0);
const winner = validCandidates[0] || null;
```

---

## Phase 6 — Residual Product Search Fallback

If residual words exist but no `product_search` candidate has score > 1, a minimal `product_search` candidate is injected:

```js
validCandidates.push({
    intentName: 'product_search',
    score: 0.5,
    matchedKeywords: ['orphan_product'],
    matchedParams: { product_name: residualWords.join(' ') }
});
```

This ensures that even a pure product name with no action verb and no keyword match still routes to search as a safe default.

---

## Return Value

```js
{
  winner: {
    intentName:              "add_to_cart",
    score:                   7.4,
    matchedKeywords:         ["add", "cart"],
    matchedParams:           { product_name: "iPhone16ProMax" },
    requiredFilled:          1,
    requiredTotal:           1,
    optionalFilled:          0,
    deterministicBreakdown: [
        { value: 2.0, reason: "Required slot match (1)" },
        { value: 1.4, reason: 'Action verb: "add" (+1.4 IDF)' },
        { value: 4.0, reason: 'Keyword match: "cart"' }
    ]
  },
  candidates:     [...all scored intents with score > 0],
  fallbackUsed:   false,
  extractedEntities: [...],
  residualWords:  [],
  signalDensity:  0.5,
  entityCount:    2
}
```

The `deterministicBreakdown` array is the full scoring audit trail — every modifier applied to each intent is recorded. This is the primary tool for debugging unexpected intent resolutions.

---

## Combining with Transformer L3 Scores

After `resolveIntent()` returns, the main statement loop in `index.js` merges the L3 transformer scores with the schema resolver candidates. The L3 winner boosts matching schema candidates and suppresses non-matching ones. This merged signal is what the parameter extractor and intent porter ultimately work from.

---

*Next: Chapter 14 — Parameter Extractor*
