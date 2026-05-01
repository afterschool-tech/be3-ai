# Chapter 14 — Parameter Extractor

## What It Does

The **Parameter Extractor** (`pipeline/parameterExtractor.js`) is the stage that fills every parameter slot for the winning intent. It is a **hybrid engine**: deterministic patterns run first, PIE handles product name discovery, and AI fills any remaining gaps as a last resort.

The function: `extractParameters(text, candidates, aiQueryFn, storeContext, resolutions, entities, rawText)`

---

## Execution Order (Full)

```
Step 0:  Ingest entities into baseFromEntities (category, vendor, brand, clause, resolved_product, ...)
Step 0b: Collect transformer_attribute_hints (intent-gated)
Step 0c: 4-step sanitizeAttributeHints() pipeline
Step 0d: Prepare safeTokens (attribute values to strip from product names)
Step 0e: Strip safeTokens from baseFromEntities.product_name early
Step 1:  extractDeterministic() → quantity, order_id, prices, PIE product discovery
Step 1b: Intel Shield — deduplicate PIE name vs resolved name
Step 2:  Merge base + deterministic (array-aware)
Step 3:  Attribute key canonicalization (human label → backend code)
Step 4:  Identify missing params
Step 5:  AI fallback (only for missing params, if aiQueryFn available)
Step 6:  Final merge (AI overridden by deterministic)
Step 7:  Similarity suppression guard
```

---

## Step 0 — Entity Ingestion (`baseFromEntities`)

All entities from the entity extractor are translated into parameter values:

```js
const baseFromEntities = {};

// From resolutions (context resolver)
resolutions.forEach(res => {
    if (res.productId) {
        baseFromEntities.products     = [..., res.productId];
        baseFromEntities.product_name = res.resolved;
        baseFromEntities._resolved_product_id = res.productId;
    }
});

// From entities[]
entities.forEach(ent => {
    if (ent.type === 'category')          baseFromEntities.category  = ent.id;
    if (ent.type === 'vendor')            baseFromEntities.vendor    = ent.value;
    if (ent.type === 'brand')             baseFromEntities.brand     = ent.value;
    if (ent.type === 'order_id')          baseFromEntities.order_id  = ent.value;
    if (ent.type === 'quantity')          baseFromEntities.quantity  = ent.value;
    if (ent.type === 'price_max')         baseFromEntities.price_max = ent.value;
    if (ent.type === 'price_min')         baseFromEntities.price_min = ent.value;
    if (ent.type === 'resolved_product')  baseFromEntities.product_name = ent.value;
    if (ent.type === 'clause')            baseFromEntities.clause_words = [..., { word, clauseId }];
    if (ent.type === 'facet_target')      baseFromEntities.facet_target = ent.value;
});
```

Special flags propagated:
- `is_partial_match: true` — category was matched via substring
- `is_kickstart: true` — category came from pure transformer guess (no free words for determinism)

---

## Step 0b — Transformer Attribute Hint Collection (Intent-Gated)

`transformer_attribute_hint` entities are collected separately for bulk sanitization:

```js
if (ent.type === 'transformer_attribute_hint') {
    const isFacetIntent = candidates[0].intentName === 'facet_list' || 'vendor_facet';
    const hasFacetTarget = entities.some(e => e.type === 'facet_target' && e.attribute === ent.subType);

    if (isFacetIntent) DROP;      // facet listing: direct attributes blocked
    else if (hasFacetTarget) DROP; // user explicitly named this attribute → already handled
    else COLLECT;
}
```

**Two gates before collecting**:
1. **Facet intent gate**: `facet_list`/`vendor_facet` intents never accept attribute hints — they ARE the facet exploration.
2. **Facet target gate**: If the user said "what colors do you have" and `facet_target` picked up `color`, a transformer `color: "blue"` hint would be wrong context — dropped.

---

## Step 0c — `sanitizeAttributeHints()` — 4-Step Pipeline

Collected hints are run through a 4-step sanitization pipeline before being written to `baseFromEntities.attributes`:

### Step 1 — Bench Word Stripping
Remove facet attribute name words from the hint value:

```
Input:  { subType: "storage", value: "256gb storage" }
Bench:  storage → ["storage", "disk space", "rom", "memory"]
Output: { _cleanValue: "256gb", _strippedWords: ["storage"] }
```

If all words are stripped (pure echo like `{ value: "storage" }`), the hint is dropped entirely.

### Step 2 — Category Support Gating
If a category was detected, reject hints for attributes the category doesn't support:

```js
const catSupports   = catAttributes.includes(attrKey);
const attrListsCat  = attrMeta?.categories?.includes(catSlug);
if (!catSupports && !attrListsCat) → DROP;
```

Example: Category = `ladies_shoes`, hint = `{ subType: "storage", value: "256gb" }` → dropped because shoes don't have storage.

If no category was detected, all hints pass through.

### Step 3 — Same-Value Tie-Breaking
When two different attribute types claim the same clean value (e.g., both `color` and `material` claim `"white"`):

```js
// The hint with MORE stripped bench words wins
// (more stripping means the attribute name was more explicitly present in text)
// e.g. color: "white color" → _strippedWords: ["color"]
//      material: "white"    → _strippedWords: []
// → color wins (1 stripped > 0 stripped)
```

### Step 4 — Category Redundancy Check
If the hint value is already captured by the category name/slug, drop it:

```
Category: iphones, Hint: { subType: "brand", _cleanValue: "iphone" }
catTextCombined: "iphones iphones"
"iphone" is a substring of "iphones" → DROP
```

This prevents `category=iphones AND brand=iphone` — a redundant double-filter.

Surviving hints are written to `baseFromEntities.attributes`:

```js
baseFromEntities.attributes = {
    "storage": "256gb",
    "color":   "blue"
}
```

---

## Step 0d/0e — Safe Token Stripping (Pre-PIE)

Attribute values that survived sanitization are compiled into a `safeTokens` list and **immediately stripped from any already-resolved product name**:

```js
safeTokens = ["256gb", "blue"];   // attribute values

// Strip from baseFromEntities.product_name BEFORE PIE runs
baseFromEntities.product_name = stripTokenFromText("256gb iPhone 13", "256gb");
// → "iPhone 13"
```

This prevents attribute tokens from bleeding into the product name search query.

---

## Step 1 — `extractDeterministic()` (PIE-Powered)

Deterministic extraction covers:

### Simple patterns (regex):
```
quantity:  /\b(?:add|buy|get|...)\s+(\d+)\b/i
order_id:  /(?:#|order\s*[-#]?|ord[-#])\s*(\d{3,})/i
price_max: /(?:under|below|...)\s*\$?\s*(\d+)/i
price_min: /(?:over|above|...)\s*\$?\s*(\d+)/i
"cheap" heuristic: price_max = 200 if no explicit price found
```

### PIE — Product Intelligence Extractor

For three intent types, deterministic delegates to `extractProductIntel()`:

**`product_compare`**: Extracts multiple product segments. Runs PIE on `rawText` (pre-cleanText, preserving commas):
```js
extracted.product_segments = [
    { query: "iphone 13",  category: null, attributes: {}, clause_words: [...] },
    { query: "iphone 15",  category: null, attributes: {} }
];
extracted.products = ["iphone 13", "iphone 15"];
```

**`product_search`**: Extracts single product name. Then runs **Bare Category Guard**:
```js
// If PIE finds "iphones" → check if it exactly matches a category label/slug/alias
// If YES and a category entity exists → drop product_name, let category browse take over
// If NO category entity → keep product_name as search query
```

**`product_similar`**: Extracts the product the user wants similar items for.

### The Exclude Set

Before PIE runs, a large `excludeSet` is built containing:
- All intent keywords and synonyms for candidate intents
- All action verbs, fillers, and stop words
- All already-extracted parameter values (quantity, order_id, prices)
- All entity values (clause words, category words, brand words)

This ensures PIE's product name discovery doesn't pick up noise words.

---

## Intel Shield — Deduplication After PIE

After PIE and base entity ingestion both have `product_name`, the Intel Shield reconciles them:

```js
if (baseFromEntities.product_name && deterministic.product_name) {
    const resolvedName = baseFromEntities.product_name.toLowerCase();  // "iPhone 16 Pro Max"
    const pieWords = deterministic.product_name.split(/\s+/);          // ["iphone", "16", "pro"]

    // Keep only PIE words that don't exist in the resolved name
    const cleanPieWords = pieWords.filter(w => !resolvedName.includes(w));

    if (cleanPieWords.length > 0) {
        // Prepend novel PIE words: "iphone 16 pro" + "iPhone 16 Pro Max"
        combinedBase.product_name = `${cleanPieWords.join(' ')} ${baseFromEntities.product_name}`;
    } else {
        combinedBase.product_name = baseFromEntities.product_name;  // Resolved wins, PIE discarded
    }
}
```

This handles the case where PIE finds "iphone 16 pro" from residuals and IntelliSense resolved "iPhone 16 Pro Max" from the reference_map. The shield merges without duplication.

---

## PIE Lifecycle Log

A consolidated `PARAM:PIE_LIFECYCLE` log entry is emitted for every extraction:

```json
{
  "intent": "product_search",
  "pieDiscovery": "blue phone",
  "intelliSenseProduct": null,
  "finalProductName": "blue phone",
  "outcome": "pie_only",
  "bareCategoryDropped": false,
  "resolvedProductId": null
}
```

Outcome values:
| Outcome | Meaning |
|---------|---------|
| `pie_only` | Only PIE found a product name |
| `intellisense_only` | Only IntelliSense resolved a product |
| `agreement` | Both found the same product |
| `intellisense_override` | Both found different products; IntelliSense won |
| `bare_category_dropped` | PIE found a product name that was exactly a category; dropped |
| `no_product` | No product name found by either |

---

## Step 3 — Attribute Key Canonicalization

Transformer attribute keys often come in human-readable form (`"storage"`, `"color"`). The backend expects attribute codes (`"j"`, `"m"`). The extractor maps them:

```js
function mapAttrKeyToBackend(attrKey) {
    // 1. Composite keys (e.g. "p:p") pass through
    // 2. If already a code key → keep
    // 3. Direct lookup: storeContext.ATTRIBUTES["storage"].code → "j"
    // 4. Snake_case normalization: "price tier" → "price_tier" → code
    // 5. Label match: find attribute where label === attrKey → code
    // 6. Fallback: return original key unchanged
}
```

After canonicalization:
```js
{ "storage": "256gb" } → { "j": "256gb" }
{ "color": "blue" }    → { "m": "blue" }
```

---

## Step 5 — AI Fallback

Only parameters that are still `undefined` after all deterministic passes are sent to the AI:

```js
const missingParams = {};
for (const [name, def] of Object.entries(schema)) {
    if (combinedBase[name] === undefined) {
        missingParams[name] = def;
    }
}

if (Object.keys(missingParams).length > 0 && aiQueryFn) {
    const prompt = buildExtractionPrompt(text, missingParams, excludeWords);
    const response = await aiQueryFn(prompt, 500, 0.1, 2, 'json_object');
    aiExtracted = JSON.parse(response);
}
```

The AI prompt explicitly excludes intent trigger words (keywords and synonyms) so the AI doesn't return them as parameter values.

**Priority rule**: `merged = { ...aiExtracted, ...combinedBase }` — deterministic always overwrites AI.

---

## Step 7 — Similarity Suppression Guard

```js
if (merged.similar_to) {
    delete merged.product_name;
    delete merged._resolved_product_id;
}
```

If `similar_to` is set (from a `product_similar` extraction), `product_name` must be absent. The `product.search` tool uses `similar_to` as a vector similarity mode and must not fall back to keyword matching.

---

## Final Output Shape

```js
{
  // From entity ingestion
  category:   "cat-smartphones-uuid",
  vendor:     "Dareymi",
  clause_words: [{ word: "cheap", clauseId: "budget_range" }],

  // From PIE / context resolution
  product_name: "iPhone 16 Pro Max",
  _resolved_product_id: "product-uuid-123",
  _pie_product_name: "iphone 16 pro",   // PIE's independent discovery (for logging)

  // From attribute hints (sanitized + canonicalized)
  attributes: { "j": "256gb", "m": "blue" },

  // From regex
  price_max: 200,
  quantity:  1,

  // Meta flags
  is_partial_match: false,
  is_kickstart: false
}
```

---

*Next: Chapter 15 — Parameter Bleeder*
