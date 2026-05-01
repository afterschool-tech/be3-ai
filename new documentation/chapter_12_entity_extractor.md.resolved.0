# Chapter 12 — Entity Extractor

## What It Does

The Entity Extractor (`pipeline/entityExtractor.js`) scans the cleaned, context-resolved statement text and extracts all typed entities — categorized signals about **what** the user is talking about. These entities are what the schema resolver and parameter extractor use to match intents and fill parameters.

It answers: *"In this statement, what vendor, category, brand, clause, action verb, product, price, quantity, or order ID is present?"*

---

## The `consumed` Set — The Extraction Shield

At the heart of the extractor is a `Set<number>` called `consumed`. Every word in the statement has a 0-based index. Once a word's index is added to `consumed`, **no subsequent extractor pass can claim it**. This prevents double-counting:

- A brand like "Apple" should not also be detected as a category.
- A collapsed product token like "iPhone16ProMax" should not trigger the category scanner.

The extractor runs its passes in strict priority order, with each pass only operating on unconsumed words.

---

## Stage 0 — Token Mask Consumption

First priority: protect **context-resolved product tokens**.

```js
for (const res of resolutions) {
    const collapsedLower = res.collapsed.toLowerCase();  // e.g. "iphone16promax"
    for (let i = 0; i < words.length; i++) {
        if (words[i] === collapsedLower) {
            entities.push({
                type: 'resolved_product',
                value: res.resolved,      // "iPhone 16 Pro Max"
                collapsed: res.collapsed, // "iPhone16ProMax"
                productId: res.productId,
                source: 'context_resolution',
                wordIndices: [i]
            });
            consumed.add(i);
        }
    }
}
```

If the context resolver replaced "the first one" with "iPhone16ProMax", this stage immediately marks that token as consumed and emits a `resolved_product` entity. The category scanner will never see it.

---

## Stage 0b — Pre-Detected Entity Ingestion

Second priority: entities from Stage 3a (global clause pre-pass) and IntelliSense products.

```js
for (const preEnt of preDetectedEntities) {
    // Phantom entities (from Ambient Context) → ingest directly, no word indices
    // Pre-pass entities → calculate localWordIndex and wordCount for index range
    // IntelliSense products → use explicit wordIndices array
    entities.push({ ...preEnt, wordIndices: indices });
    indices.forEach(idx => consumed.add(idx));
}
```

**Phantom Entities**: Entities with `source: 'AMBIENT_CONTEXT'` have no position in the text. They are injected with empty `wordIndices: []` and skip all index computation.

**Priority rule**: Clauses and brands are pushed before IntelliSense products, so they take word-position priority. If both claim the same word index, the first one wins.

**Guard**: If the very first word index of a pre-detected entity is already consumed, the entity is skipped. Exception: `resolved_product` entities still mark all their indices consumed (to shield their word spans), even if the entity itself is dropped.

---

## Stage 0c — Transformer Attribute Hints (Non-Consuming)

Third priority: advisory hints from the transformer.

```js
entities.push({
    type: 'transformer_attribute_hint',
    subType: 'color',
    value: 'blue',
    source: 'TRANSFORMER_SEMANTIC',
    advisory: true,  // ← non-consuming
    wordIndices: [wordIdx]
});
// NOTE: consumed.add() is NOT called
```

These hints are **deliberately non-consuming**. Facet target detection (Stage 2c, run later) needs the words to still be free to detect `"what colors do you have"` type queries. The parameter extractor reads these hints with intent-aware gating.

**Drop conditions**:
- A first-class `brand` entity already exists → drop transformer brand hint.
- A first-class `clause` entity already covers this attribute type → drop transformer hint for that attribute.

---

## Stage 1 — Vendor Detection (N-gram, Longest First)

```js
for (let size = 4; size >= 1; size--) {
    for (let i = 0; i <= words.length - size; i++) {
        if (consumed.has(i)) continue;
        const phrase = words.slice(i, i + size).join(' ');
        // Exact match → found
        // Fuzzy match (Levenshtein ≤ 2) for phrases > 4 chars → found
        // → emit vendor entity, mark indices consumed, break
    }
}
```

- 4-gram down to 1-gram: tries the longest possible vendor name first.
- Levenshtein fuzzy matching catches typos like "Dareyomi" → "Dareymi" (distance 2).
- **Only one vendor per statement** — breaks out of the loop after first match.

**Semantic fallback** (`1b`): If no vendor matched deterministically, the transformer's `entities.vendor` array is checked and the matching vendor from `storeContext.VENDORS` is injected with `wordIndices: [-1]` (semantic/global, no word position).

---

## Stage 2 — Action Verb Detection

```js
const ACTION_VERBS = {
    'buy': 'purchase', 'purchase': 'purchase', 'grab': 'purchase',
    'add': 'cart_add',
    'remove': 'cart_remove', 'delete': 'cart_remove',
    'show': 'discovery', 'find': 'discovery', 'search': 'discovery',
    'compare': 'compare', 'vs': 'compare',
    'checkout': 'checkout', 'pay': 'checkout',
    'track': 'tracking', 'status': 'tracking',
    // ... 40+ verbs total
};
```

Each word is checked against `ACTION_VERBS`. Matching words become `action` entities with an IDF weight:

```js
{
    type: 'action',
    verb: 'add',
    category: 'cart_add',
    idf: 1.4,   // from pre-built idfMap
    source: 'ACTION_VERBS',
    wordIndices: [0]
}
```

**Filler exclusion**: Words in the `FILLERS` set (common stop words and conversational noise) are skipped entirely before the `ACTION_VERBS` lookup.

**Key design decision**: Ambiguous words (`"order"`, `"all"`, `"yes"`, `"thanks"`) are intentionally excluded from `ACTION_VERBS` — they cause too many false positives.

### Stage 2c — Facet Target Detection

During the action verb scan, words near discovery verbs (or known attribute nouns like `"colors"`, `"brands"`, `"storage"`) are checked by `resolveFacetAttribute()`:

```js
if (isNearDiscovery || knownAttributeNounSet.has(word)) {
    const resolvedAttr = resolveFacetAttribute(word, semanticContext);
    if (resolvedAttr) {
        entities.push({ type: 'facet_target', value: word, attribute: resolvedAttr, ... });
        consumed.add(i);
    }
}
```

This is how `"what colors do you have for iphones?"` produces a `facet_target` entity with `attribute: 'color'` — triggering the `facet_list` intent.

---

## Stage 3 — Category N-gram Scanning (Full Sentence, Best Winner)

Unlike vendor detection (which stops at first match), the category scanner **scans the entire sentence** and selects the best candidate at the end.

```
For each n-gram size (3 → 2 → 1):
    For each window position:
        Skip if any word is consumed
        Skip if all words are fillers
        Skip if phrase is an ordinal/reference phrase
        normalizeCategory(phrase, ...) → catId + catMeta
        Track best candidate by: tier DESC, score DESC, size DESC
```

After the full scan, the best candidate is committed.

### Category Match Quality Tiers

`normalizeCategory()` returns a `lexTier` from 1–4:

| Tier | Meaning | Word consumption | Quality |
|------|---------|-----------------|---------|
| 4 | Exact / prefix affix match | Full | 1.0 |
| 3 | Good token overlap | Full | 0.9 |
| 2 | Substring partial match | **None** (words stay free) | varies |
| Semantic | Pure transformer guess | **None** | 0.35 |

**Tier 2 partial matches** are flagged `is_partial_match: true`. Their words are NOT consumed — they remain available for the search query. If `"personal care"` matched via substring on the word `"son"`, that `"son"` should still be searchable.

**Accountability**: Even for tier 3/4 matches, only words that `normalizeCategory` explicitly identifies as `usedWords` are consumed. This prevents over-consumption of context words that happened to overlap.

### Vendor-Category Prioritization (2b)

If a vendor was detected and the vendor has a known category list, the extractor logs which category would be inferred from the vendor's catalog. (Currently advisory only — the vendor's presence is itself sufficient context for the parameter extractor.)

### Semantic Kickstart (3b)

If all words were consumed by pre-pass/IntelliSense and the category scanner found nothing, the transformer's top category slug is resolved directly from `storeContext.CATEGORIES`. Emitted with `quality: 0.35` and `wordIndices: [-1]`.

---

## Stage 4 — Regex Detections

Simple regex patterns run on the raw text after all structural extraction:

```js
// Order ID: "#4521", "order-4521", "ord#4521"
/(?:#|order\s*[-#]?|ord[-#])\s*(\d{3,})/i
→ entity: { type: 'order_id', value: "4521" }

// Price max: "under $50000", "below 50000", "less than ₦50000"
/(?:under|below|less than|max|cheaper than|budget)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i
→ entity: { type: 'price_max', value: 50000 }

// Price min: "over $20000", "more than 20000"
/(?:over|above|more than|min|at least)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i
→ entity: { type: 'price_min', value: 20000 }

// Quantity: "add 3", "buy 2", "get 5"
/\b(?:add|buy|get|order|want|need|grab|purchase)\s+(\d+)\b/i
→ entity: { type: 'quantity', value: 3 }  (capped at 100)
```

---

## Stage 5 — Residual Words

After all extraction passes, unconsumed non-filler words are collected:

```js
const residualWords = [];
for (let i = 0; i < words.length; i++) {
    if (!consumed.has(i) && !FILLERS.has(words[i]) && words[i].length > 1) {
        residualWords.push(words[i]);
    }
}
```

`residualWords` represents **potential product names** that couldn't be matched to any known entity. The parameter extractor uses them as the search `query` when no explicit product was resolved.

---

## Stage 6 — Dynamic Shape Synthesis

The extractor builds a "shape" string by replacing each word with an entity-type placeholder:

```
"add the first iphone to cart"
→ consumed map: { 0: action, 3: resolved_product, ... }
→ shape: "[action] [product]"

"show me cheap blue samsung phones"
→ [action] [clause:price] [clause:color] [vendor] [category]
→ shape: "[action] [clause] [clause] [vendor] [category]"
```

This shape string is used for diagnostics, but could also be used for intent scoring heuristics (e.g., `[action] [category]` strongly suggests a search intent).

---

## Complete Entity Type Reference

| Type | Source | Consuming | Example |
|------|--------|-----------|---------|
| `resolved_product` | context resolver resolutions | Yes | `{ value: "iPhone 16 Pro Max", productId: "uuid-123" }` |
| `clause` | Stage 3a global pre-pass | Yes | `{ clauseId: "apple_product", value: "apple" }` |
| `vendor` | N-gram + transformer | Yes | `{ value: "Dareymi", id: "vendor-uuid" }` |
| `category` | N-gram + transformer | Varies by tier | `{ value: "smartphones", id: "cat-uuid", quality: 1.0 }` |
| `action` | ACTION_VERBS dict | Yes | `{ verb: "add", category: "cart_add", idf: 1.4 }` |
| `facet_target` | semanticFacetResolver | Yes | `{ value: "colors", attribute: "color" }` |
| `transformer_attribute_hint` | transformer /extract | **No** | `{ subType: "color", value: "blue", advisory: true }` |
| `order_id` | regex | No | `{ value: "4521" }` |
| `price_max` | regex | No | `{ value: 50000 }` |
| `price_min` | regex | No | `{ value: 20000 }` |
| `quantity` | regex | No | `{ value: 3 }` |

---

## Return Value

```js
{
  entities: [
    { type: 'action',   verb: 'show',   category: 'discovery', ... },
    { type: 'category', value: 'phones', id: 'cat-smartphones', quality: 1.0, ... }
  ],
  residualWords: ["blue", "fast"],   // potential search terms
  categoryHints: ["smartphones"],    // from Stage 3a
  shape: "[action] [category]"
}
```

---

*Next: Chapter 13 — Schema Resolver & IDF Scoring*
