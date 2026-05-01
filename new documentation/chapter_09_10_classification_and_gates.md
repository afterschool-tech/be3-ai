# Chapter 9 — Hierarchical Classification (L1 → L2 → L3)

## The Taxonomy

The entire classification system is built on a **3-tier hierarchy** defined in `config/taxonomy.js`:

```
CLASS (L1)              INTENT (L2)                    SUB-INTENT (L3)
─────────────────────────────────────────────────────────────────────────────
Discovery             │ Product_Research            │ product_search
                      │                             │ browse_categories
                      │                             │ browse_collection
                      │                             │ facet_list
                      ├─────────────────────────────┤
                      │ Product_Analysis            │ get_product_details
                      │                             │ product_compare
                      │                             │ product_similar
─────────────────────────────────────────────────────────────────────────────
Shopping_Management   │ Cart_Management             │ add_to_cart
                      │                             │ remove_from_cart
                      │                             │ update_cart_quantity
                      │                             │ view_cart
                      ├─────────────────────────────┤
                      │ Wishlist_Management         │ add_to_wishlist
                      │                             │ remove_from_wishlist
                      │                             │ view_wishlist
                      │                             │ move_to_cart
                      ├─────────────────────────────┤
                      │ Checkout_Flow               │ start_checkout
                      │                             │ set_delivery
                      │                             │ confirm_order
                      │                             │ check_availability
                      ├─────────────────────────────┤
                      │ Post_Purchase               │ order_status
                      │                             │ list_orders
                      │                             │ cancel_order
                      │                             │ return_item
─────────────────────────────────────────────────────────────────────────────
Vendor_Intelligence   │ Vendor_Lookup               │ list_vendors
                      │                             │ vendor_info
                      │                             │ vendor_identity
                      ├─────────────────────────────┤
                      │ Vendor_Catalog_Exploration  │ vendor_products
                      │                             │ vendor_facet
                      ├─────────────────────────────┤
                      │ Vendor_Direct_Contact       │ vendor_contact
─────────────────────────────────────────────────────────────────────────────
Support_Feedback      │ Assistance_Request          │ get_help
                      │                             │ get_advice
                      ├─────────────────────────────┤
                      │ Platform_Feedback           │ give_feedback
─────────────────────────────────────────────────────────────────────────────
```

**Rules**:
- Each sub-intent appears in **exactly one** location.
- `conversation` and `end_conversation` are NOT in the taxonomy — they are handled by IntelliSense short-circuit (Chapter 5).
- The derived lookup maps (`SUBINTENT_TO_HIERARCHY`, `INTENTS_BY_CLASS`, `SUBINTENTS_BY_INTENT`) are built once at module load from the taxonomy.

---

## `transformerClient.classifyHierarchical()` — The Classification Entry Point

Located at `src/services/intentResolver/pipeline/transformerClient.js`.

```js
hierarchicalResult = await transformerClient.classifyHierarchical(
    initialCleanedText,   // cleaned statement text
    classHint             // optional class hint from IntelliSense (may be null)
);
```

The function orchestrates 3 sequential calls to the transformer service, narrowing from class → intent → sub-intent.

---

## Level 1 — Class Classification

### Without `class_hint`

```
POST http://localhost:3009/classify/class
{
  "text": "add the first one to cart"
}
```

**Transformer response**:
```json
{
  "winner": "Shopping_Management",
  "scores": [
    { "name": "Shopping_Management", "score": 0.94, "bestMatch": "add to cart" },
    { "name": "Discovery",           "score": 0.03 },
    { "name": "Vendor_Intelligence", "score": 0.02 },
    { "name": "Support_Feedback",    "score": 0.01 }
  ]
}
```

### With `class_hint` (IntelliSense bypass)

When `USE_INTELLISENSE_CLASS_HINT=true` and IntelliSense provided a non-null `class_hint` for this statement:

```js
if (classHint) {
    l1Result = {
        winner:     classHint,
        scores:     [{ name: classHint, score: 1.0, bestMatch: 'class_hint' }],
        classSkipped: true
    };
}
```

The L1 call is **skipped entirely**. The class hint is treated as a definitive L1 answer with confidence 1.0. This saves one transformer roundtrip (~50–100ms) per statement.

`classSkipped: true` is logged and visible in debug output.

---

## Level 2 — Intent Classification

After L1 resolves the winning class, the available L2 intents within that class are retrieved from the taxonomy:

```js
const intentsInClass = INTENTS_BY_CLASS[l1Winner];
// e.g. ["Cart_Management", "Wishlist_Management", "Checkout_Flow", "Post_Purchase"]
```

Then L2 is called with those intents as the candidate set:

```
POST http://localhost:3009/classify/intent
{
  "text":      "add the first one to cart",
  "class":     "Shopping_Management",
  "intents":   ["Cart_Management", "Wishlist_Management", "Checkout_Flow", "Post_Purchase"]
}
```

**Transformer response**:
```json
{
  "winner": "Cart_Management",
  "scores": [
    { "name": "Cart_Management",     "score": 0.91 },
    { "name": "Wishlist_Management", "score": 0.06 },
    { "name": "Checkout_Flow",       "score": 0.02 },
    { "name": "Post_Purchase",       "score": 0.01 }
  ],
  "parent": "Shopping_Management"
}
```

The L2 winner determines **which sub-intents are candidates** for L3, and also determines which **stage gates** load.

---

## Level 3 — Sub-Intent Classification

The sub-intents in the winning L2 intent are retrieved:

```js
const subIntentsInIntent = SUBINTENTS_BY_INTENT[l2Winner];
// e.g. ["add_to_cart", "remove_from_cart", "update_cart_quantity", "view_cart"]
```

Then L3 is called:

```
POST http://localhost:3009/classify/subintent
{
  "text":        "add the first one to cart",
  "intent":      "Cart_Management",
  "subintents":  ["add_to_cart", "remove_from_cart", "update_cart_quantity", "view_cart"]
}
```

**Transformer response**:
```json
{
  "winner": "add_to_cart",
  "scores": [
    { "name": "add_to_cart",          "score": 0.93, "bestMatch": "add item cart" },
    { "name": "remove_from_cart",     "score": 0.04 },
    { "name": "update_cart_quantity", "score": 0.02 },
    { "name": "view_cart",            "score": 0.01 }
  ],
  "parent": "Cart_Management"
}
```

---

## The Complete `hierarchicalResult` Object

```js
{
  // L1 result
  class:        "Shopping_Management",
  classSkipped: false,                // true when class_hint was used
  l1: {
    winner: "Shopping_Management",
    scores: [{ name: "Shopping_Management", score: 0.94, bestMatch: "add to cart" }, ...]
  },

  // L2 result
  intent: "Cart_Management",
  l2: {
    winner: "Cart_Management",
    parent: "Shopping_Management",
    scores: [{ name: "Cart_Management", score: 0.91 }, ...]
  },

  // L3 result
  subIntent: "add_to_cart",
  l3: {
    winner: "add_to_cart",
    parent: "Cart_Management",
    scores: [{ name: "add_to_cart", score: 0.93, bestMatch: "add item cart" }, ...]
  },

  // Meta
  text:              "add the first one to cart",
  classificationText: "add first one cart",
  totalDuration:     187   // ms for all 3 calls combined
}
```

---

## `localSemanticContext` — L3 Scores Adapted for Downstream

The L3 scores are immediately reshaped into the format all downstream stages expect:

```js
localSemanticContext = {
    available: true,
    classification: [
        { intentName: "add_to_cart",          score: 0.93, bestMatch: "add item cart" },
        { intentName: "remove_from_cart",     score: 0.04 },
        { intentName: "update_cart_quantity", score: 0.02 },
        { intentName: "view_cart",            score: 0.01 }
    ]
};
```

This `classification` array is the same shape the legacy `/analyze` endpoint produced — meaning the schema resolver, intent porter, and all other stages consume L3 scores without needing any changes.

---

## Reverse Lookup: `SUBINTENT_TO_HIERARCHY`

The taxonomy also exposes a reverse lookup built at startup:

```js
SUBINTENT_TO_HIERARCHY = {
    'add_to_cart':      { class: 'Shopping_Management', intent: 'Cart_Management' },
    'product_search':   { class: 'Discovery',           intent: 'Product_Research' },
    'vendor_info':      { class: 'Vendor_Intelligence', intent: 'Vendor_Lookup' },
    // ... all 28 sub-intents
}
```

This is used by the debug logger, the intent porter, and the DCO personality layer to look up the full hierarchy from just a sub-intent name.

---

## Error Handling

If any level's transformer call fails:
- The exception is caught in the `try/catch` block in the main loop.
- A `PIPELINE:STAGE4B_HIERARCHICAL_FAIL` debug log is emitted.
- `hierarchicalResult` remains `null`.
- `localSemanticContext` stays `{ available: false, classification: [] }`.
- `stageGates` remains `null` (all stages run).
- The pipeline continues — schema resolver runs without transformer signal, relying entirely on keyword matching.

---

## Performance

| Call | Typical Duration |
|------|-----------------|
| L1 `/classify/class` | 40–80ms |
| L2 `/classify/intent` | 40–80ms |
| L3 `/classify/subintent` | 40–80ms |
| **Total (3 sequential)** | **120–240ms** |
| With `class_hint` (L1 skipped) | **80–160ms** |

The three calls are sequential by design — each level's winner determines the candidate set for the next. They cannot be parallelized.

---

---

# Chapter 10 — Stage Gates

## What Are Stage Gates?

Stage gates are a **per-L2-intent configuration** that tells the pipeline which stages to skip, run, or run in a degraded mode. They are defined in `config/stageGates.js` and loaded immediately after L2 classification.

```js
stageGates = getGates(hierarchicalResult.intent);
// e.g. getGates("Cart_Management") → { contextResolution: true, entityExtraction: false, ... }
```

If the L2 intent is not found in the gate config (or classification failed), `getGates()` returns a **safe all-off default**:
```js
{
    contextResolution: false,
    entityExtraction:  false,
    categoryDetection: false,
    pie:               false,
    inventoryCheck:    false,
    searchContext:     false
}
```

---

## Gate Values

| Value | Meaning |
|-------|---------|
| `true` | Always runs for this intent |
| `false` | Never runs; stage is skipped entirely |
| `'fallback'` | Runs only if context resolution found nothing |
| `'vendor_only'` | Entity extraction runs but only for vendor detection |
| `'write'` | Search context is written after this intent's tools execute |
| `'read'` | Search context is read before this intent's tools execute |

---

## Stage Gate Definitions by L2 Intent

### `Product_Research` — Discovery search/browse
```js
{
    contextResolution: false,   // No pronouns: search has explicit params
    entityExtraction:  true,    // Extract brands, categories, attributes fully
    categoryDetection: true,    // Map to category IDs (skipped if products resolved)
    pie:               true,    // Full parameter extraction
    inventoryCheck:    true,    // Check stock availability
    searchContext:     'write'  // After search, write context for follow-up turns
}
```

`contextResolution: false` is intentional — a product search query like "show me blue samsung phones" has no pronouns to resolve. Running context resolution wastes time and risks injecting stale product IDs into what should be a fresh search.

### `Product_Analysis` — Product details, compare, similar
```js
{
    contextResolution: true,    // "it", "this one", "the product" → product_id
    entityExtraction:  false,   // Product ID comes from context, not text
    categoryDetection: false,
    pie:               false,
    inventoryCheck:    false,
    searchContext:     false    // Not a search, doesn't update search context
}
```

For product details, the user already selected a product. Context resolution gets the product ID from `currently_viewing` or `reference_map`. Full entity extraction would be wasted work.

### `Cart_Management` — Add, remove, update, view cart
```js
{
    contextResolution: true,    // "it", "the first one", "that" → product_id
    entityExtraction:  false,   // Product ID from context, not full extraction
    categoryDetection: false,
    pie:               'fallback', // Only if context resolution finds nothing
    inventoryCheck:    false,
    searchContext:     'read'   // Read search context to resolve ordinals
}
```

`searchContext: 'read'` — before executing the cart action, the pipeline reads the last search context to resolve ordinals ("the first one") into concrete product IDs.

`pie: 'fallback'` — if context resolution found a product ID, PIE (parameter extraction) is skipped. If context resolution came up empty, PIE runs as a fallback to extract product info from text.

### `Wishlist_Management` — Add/remove/view wishlist
Same pattern as `Cart_Management`: context + fallback PIE + read search context.

### `Checkout_Flow` — Checkout, delivery, payment
```js
{
    contextResolution: false,
    entityExtraction:  false,
    categoryDetection: false,
    pie:               false,   // Checkout has no free-text params
    inventoryCheck:    false,
    searchContext:     false
}
```

Checkout is a **structured flow** managed by microstates. There's no free-text parameter extraction — all data comes from form fields and state. Every gate is off.

### `Post_Purchase` — Orders, cancel, return
All gates off — same reasoning as Checkout. These intents are form-driven, not text-driven.

### `Vendor_Lookup` — List vendors, vendor info/identity
```js
{
    contextResolution: false,
    entityExtraction:  'vendor_only',  // Extract vendor name only
    categoryDetection: false,
    pie:               false,
    inventoryCheck:    false,
    searchContext:     false
}
```

`entityExtraction: 'vendor_only'` — the entity extractor runs a restricted pass that only looks for vendor names. Brand attributes and category detection are skipped.

### `Vendor_Catalog_Exploration` — Vendor products, vendor facets
```js
{
    contextResolution: false,
    entityExtraction:  true,    // Full extraction: vendor + category + attributes
    categoryDetection: true,    // User may specify a category within the vendor's catalog
    pie:               false,
    inventoryCheck:    false,
    searchContext:     false
}
```

### `Vendor_Direct_Contact` — Vendor contact
```js
{
    contextResolution: false,
    entityExtraction:  'vendor_only',
    categoryDetection: false,
    pie:               false,
    inventoryCheck:    false,
    searchContext:     false
}
```

### `Assistance_Request` / `Platform_Feedback` — Help, advice, feedback
All gates off. These are conversational and handled by the personality layer directly.

---

## Gate Effects in Code

In the main statement loop, gates control `if/else` branches:

```js
// Context resolution gate
if (stageGates?.contextResolution === false) {
    // SKIP
} else {
    // RUN contextResolver.resolveReferences()
}

// Entity extraction gate
if (stageGates?.entityExtraction === false) {
    // SKIP extractEntities()
} else if (stageGates?.entityExtraction === 'vendor_only') {
    // PARTIAL: vendor detection only
} else {
    // FULL extractEntities()
}

// PIE gate
if (stageGates?.pie === false) {
    // SKIP parameterExtractor.extract()
} else if (stageGates?.pie === 'fallback') {
    // ONLY if context resolution found nothing
} else {
    // FULL parameterExtractor.extract()
}

// Search context gate
if (stageGates?.searchContext === 'write') {
    // After tools: stateManager.setSearchContext()
} else if (stageGates?.searchContext === 'read') {
    // Before tools: stateManager.getSearchContext()
}
```

---

## Stage Gate Summary Table

| L2 Intent | ctx | entity | cat | pie | inv | searchCtx |
|-----------|-----|--------|-----|-----|-----|-----------|
| `Product_Research` | ✗ | ✓ | ✓ | ✓ | ✓ | write |
| `Product_Analysis` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `Cart_Management` | ✓ | ✗ | ✗ | fallback | ✗ | read |
| `Wishlist_Management` | ✓ | ✗ | ✗ | fallback | ✗ | read |
| `Checkout_Flow` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `Post_Purchase` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `Vendor_Lookup` | ✗ | vendor | ✗ | ✗ | ✗ | ✗ |
| `Vendor_Catalog_Exploration` | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| `Vendor_Direct_Contact` | ✗ | vendor | ✗ | ✗ | ✗ | ✗ |
| `Assistance_Request` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `Platform_Feedback` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

*ctx = contextResolution, entity = entityExtraction, cat = categoryDetection, pie = parameterExtraction (PIE), inv = inventoryCheck, searchCtx = searchContext*

---

*Next: Chapter 11 — Context Resolver (Pronouns & References)*
