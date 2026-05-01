# Chapter 11 — Context Resolver (Pronouns & References)

## What It Does

The **Context Resolver** (`pipeline/contextResolver.js`) transforms a text like:

```
"add the first one to cart"
```

into:

```
"add iPhone16ProMax to cart"
```

It does this by scanning the user's message for **pronouns, ordinals, and known aliases** that exist as keys in `state.reference_map`, then replacing them with the actual product name from search results. The result is a concrete, entity-rich text that the entity extractor and schema resolver can work with unambiguously.

---

## Two-Tier Resolution

The resolver is called **twice** for each statement:

| Call | Stage | Type | What it resolves |
|------|-------|------|-----------------|
| Stage 3.1 | Pre-classification | `'structural'` | Ordinals & pointer words only (`"the first one"`, `"it"`, `"them"`) |
| Stage 4a | Post-classification | `'specific'` | Brand aliases & product name references only |

The `type` parameter controls which tier runs via tier filtering:

```js
const isPointer = POINTER_WORDS.has(phrase) || POINTER_WORDS.has(refKey);
if (type === 'structural' && !isPointer) return matched;  // structural: skip non-pointers
if (type === 'specific'   &&  isPointer) return matched;  // specific: skip pointers
```

**Why two passes?**

Pre-classification (Stage 3.1) resolves ordinals so the transformer sees `"add iPhone16ProMax to cart"` instead of `"add the first one to cart"`. This gives the classifier a much stronger signal.

Post-classification (Stage 4a) resolves brand aliases like `"iphone"` (which might be in `reference_map` as an alias for a specific product UUID from the last search). This happens after gates confirm context resolution should run for this L2 intent.

---

## The `reference_map`

`state.reference_map` is populated by `product.search` every time a search returns results. It maps normalized aliases and ordinals to product IDs:

```js
{
  "iphone":             "product-uuid-123",
  "iphone_16_pro":      "product-uuid-123",
  "iphone_16":          "product-uuid-456",
  "samsung":            "product-uuid-789",
  "the_first_one":      "product-uuid-123",
  "first":              "product-uuid-123",
  "the_second_one":     "product-uuid-456",
  "second":             "product-uuid-456",
  "the_third_one":      "product-uuid-789",
  "last":               "product-uuid-789",
  "it":                 "product-uuid-123",  // most recently mentioned
  "this":               "product-uuid-123"
}
```

Keys are **underscore-normalized** — spaces become underscores so single-pass regex matching works cleanly. During matching, the resolver converts matched text to underscore form before looking up: `phrase.replace(/ /g, '_')`.

Keys are sorted **longest first** before building the regex — this ensures "the_first_one" matches before "first" on the same text, preventing partial matches from consuming tokens needed for longer patterns.

---

## How `reference_map` Is Built

The `product.search` tool handler (in `tools/product.js`) calls:

```js
await stateManager.setState(userId, {
    ...state,
    reference_map: {
        ...ordinalAliases,    // first, second, the_first_one, etc.
        ...productNameAliases // normalized product names -> IDs
    },
    ordinal_list: [
        "product-uuid-123",  // index 0 → "first"
        "product-uuid-456",  // index 1 → "second"
        "product-uuid-789"   // index 2 → "third"
    ]
});
```

`ordinal_list` is the ordered array of product IDs as they were displayed to the user. It is what makes "the second one" unambiguous — the resolver looks up ordinal index 1 (0-based) in `ordinal_list` to get the product ID.

---

## Resolution Logic (Single Pass)

```js
// Build one combined regex from all reference_map keys (longest first)
const patterns = refKeys.map(k =>
    `\\b${escapeRegex(String(k).replace(/_/g, ' '))}\\b`
).join('|');
const regex = new RegExp(patterns, 'gi');

resolvedText = text.replace(regex, (matched, offset, fullString) => {
    // 1. Check IntelliSense skip list
    // 2. Check relative pronoun guard
    // 3. Check brand collision guard
    // 4. Tier filter (structural vs specific)
    // 5. Look up in reference_map
    // 6. Resolve ID → product name
    // 7. Collapse name → single token
    // 8. Return collapsed token (or original if any guard fired)
});
```

The replacement function runs in a single regex pass — all reference_map keys are evaluated simultaneously. This is O(text_length × keys_count) worst case but is fast in practice because the combined regex is compiled once.

---

## Step 6 — ID to Name Resolution

```js
function resolveIdToName(productId, state) {
    const results = state?.product_context?.last_search?.results || [];
    for (const product of results) {
        if (product.id === productId || product.handle === productId) {
            return product.name || product.title || null;
        }
    }
    return null;
}
```

The resolver looks up the product name from `last_search.results`. If the reference_map maps to a **comma-separated list** of IDs (meaning multiple products matched the search term), all are resolved:

```js
if (productIdOrName.includes(',')) {
    const ids = productIdOrName.split(',');
    const names = ids.map(id => resolveIdToName(id.trim(), state)).filter(Boolean);
    productName = names.join(' and ');  // e.g. "iPhone 16 and iPhone 16 Pro"
}
```

If the product name can't be found in `last_search.results` (e.g., the results were cleared), the reference match is logged as a miss and the original text is returned unchanged.

---

## Step 7 — Token Collapsing (`collapseProductName`)

Product names with spaces break tokenization. "iPhone 16 Pro Max" would be tokenized as 4 separate words, confusing the entity extractor. The resolver collapses them:

```js
function collapseProductName(name) {
    return String(name)
        .replace(/[^a-zA-Z0-9]/g, '')  // remove all non-alphanumeric
        .trim();
}
```

```
"iPhone 16 Pro Max" → "iPhone16ProMax"
"Infinix Hot 30i"   → "InfinixHot30i"
"Samsung Galaxy A55" → "SamsungGalaxyA55"
```

The collapsed token is what enters the downstream pipeline. The `resolutions[]` array records both the `resolved` (human-readable) and `collapsed` (machine-safe) forms so the personality layer can get the real name back via `uncollapseFromResolutions()`.

---

## The Three Skip Guards

### Guard 1 — IntelliSense `skip_resolve` List

Before any matching, IntelliSense's `skip_resolve` list is loaded into a `Set`:

```js
const skipSet = new Set((skipWords || []).map(w => w.toLowerCase().trim()));
```

If a matched token is in `skipSet`, it is returned unchanged:

```js
if (skipSet.has(matched.toLowerCase())) return matched;
```

Example: `"None of it"` → IntelliSense marks `"it"` as idiomatic. The resolver sees `"it"` in `skipSet` and leaves it alone even though "it" might be in `reference_map`.

---

### Guard 2 — Relative Pronoun / Temporal Marker

```js
function shouldSkipAmbiguousReference(text, matchIndex, matchedWord) {
    const before = text.substring(0, matchIndex).trim();

    // "laptop that", "phone that" → relative pronoun
    const relativePronounPattern = /\b(laptop|phone|one|product|item|...)\s*$/i;
    if (relativePronounPattern.test(before)) return true;

    // "after that", "then that" → temporal/discourse
    const temporalPattern = /\b(after|then|before|when|once|...)\s*$/i;
    if (temporalPattern.test(before)) return true;

    return false;
}
```

This prevents `"that"` in `"a phone that can run games"` from being resolved to a product. The word before `"that"` is `"phone"` — matching the relative pronoun guard.

---

### Guard 3 — Brand Collision Prevention

```js
function shouldSkipBrandCollision(text, matchIndex, matchedWord, storeContext) {
    const lower = matchedWord.toLowerCase();
    if (!brandTokens.has(lower)) return false;

    const after = text.substring(matchIndex + matchedWord.length);
    const modelQualifierPattern = /^\s*(?:[0-9]+|[a-z]{1,3}[0-9]{1,4}|pro|max|ultra|plus|...)\b/i;
    if (modelQualifierPattern.test(after)) return true;
    return false;
}
```

This prevents `"iphone"` in `"show me iPhone 17 Pro"` from being resolved to the previously searched iPhone 16 from `reference_map`. The text after `"iphone"` is `" 17 Pro"` — the `17` matches the model qualifier pattern, so the match is skipped.

Brand tokens checked include: all `storeContext.ATTRIBUTES.brand.predefined_values` plus a hardcoded fallback set (`['iphone', 'macbook']`).

Model qualifier words come from `config/contextResolverGuards.js` (`MODEL_QUALIFIER_WORDS`) — a curated set of product variant suffixes.

---

## `uncollapseFromResolutions()`

After the pipeline produces a final text or product name, collapsed tokens can be expanded back:

```js
function uncollapseFromResolutions(text, resolutions) {
    let result = text;
    for (const res of resolutions) {
        if (res.collapsed && res.resolved) {
            result = result.replace(
                new RegExp(escapeRegex(res.collapsed), 'gi'),
                res.resolved
            );
        }
    }
    return result;
}
```

This is used by the personality layer and the intent parameter extractor to get back the human-readable product name (e.g., `"iPhone 16 Pro Max"`) from the collapsed token (`"iPhone16ProMax"`).

---

## Resolution Output Shape

```js
{
  resolvedText: "add iPhone16ProMax to cart",
  resolutions: [
    {
      original:   "the first one",
      resolved:   "iPhone 16 Pro Max",
      collapsed:  "iPhone16ProMax",
      productId:  "product-uuid-123",
      source:     "reference_map"
    }
  ]
}
```

The `resolutions[]` array is attached to the statement and carried through all downstream stages for diagnostic visibility and personality layer context.

---

## Debug Logs

| Log Key | What It Reports |
|---------|----------------|
| `CONTEXT:RESOLVE_START` | Text input, reference_map keys being checked |
| `CONTEXT:TOKEN_MASK` | Each successful resolution with collapsed token |
| `CONTEXT:RESOLVE_MISS` | reference_map hit but no product name in search results |
| `CONTEXT:RESOLVE_COMPLETE` | Full resolution count and output preview |

All logs retrieved via `GET /logs/:runId`.

---

*Next: Chapter 12 — Entity Extractor*
