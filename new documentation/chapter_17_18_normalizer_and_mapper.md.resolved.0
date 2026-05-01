# Chapter 17 — Parameter Normalizer

## What It Does

The **Parameter Normalizer** (`pipeline/parameterNormalizer.js`) is Stage 6.5. It takes the raw extracted parameters and performs three critical translations:

1. **Clause → Attribute mapping**: Converts semantic clause words (`"cheap"`, `"blue"`, `"apple"`) into structured attribute filters (`{ "p:p": "budget,midrange" }`, `{ "m": "blue" }`, `{ "b": "apple" }`).
2. **Brand folding**: Lifts the top-level `brand` param into `attributes`.
3. **Vendor normalization**: Verifies and canonicalizes the vendor name against official store tenants.

---

## Rule 0 — Compare Intent Guard

```js
const isCompareIntent = intent?.intentName === 'product_compare';
if (params.clause_words && !isCompareIntent) { ... }
```

`product_compare` intents are skipped for clause-to-attribute mapping entirely. A compare request like `"compare the iPhone 16 and the Infinix Hot 40"` may contain brand tokens inside resolved product names, but those should not become search filter attributes — they are part of the product identity, not search refinements.

---

## Step 1 — Clause to Attribute Mapping

The `clause_words` array (built by the entity extractor and parameter extractor) is processed into `params.attributes`.

Each clause entry is of the form `{ clauseId: "budget_range", word: "cheap" }`.

The mapping works in three resolution levels:

### Level 1 — Composite Attribute Encoding (Preferred)

The most precise path. Used when the clause ID matches a named clause definition inside an attribute's `clauses[]` array:

```js
// Given clause: budget_range, attribute: price_tier
// storeContext.ATTRIBUTES["price_tier"] = {
//     code: "p",
//     clauses: [
//         { label: "Budget Range", name: "p", matches: ["budget", "midrange"] }
//     ]
// }
// → compositeKey = "p:p" = attrCode + ":" + clauseDef.name
// → csv = "budget,midrange"
// → params.attributes["p:p"] = "budget,midrange"
```

This produces highly precise backend filter keys that the search API understands as named clause filters.

**Double Mapping Guard**: If the composite key (`"p:p"`) is being set, the raw code key (`"p"`) is deleted from `params.attributes` first. This prevents both keys from coexisting and sending contradictory filters.

### Level 2 — Raw Attribute Code Fallback

If no matching clause definition was found in the attribute, but the attribute metadata exists, the clause word is mapped directly to the attribute's `code`:

```js
const finalValue = canonicalizeValue(clauseWord, attrMeta, clause);
params.attributes[attrMeta.code] = finalValue;  // e.g. attributes["m"] = "blue"
```

`canonicalizeValue()` normalizes the value against `predefined_values` (see below).

### Level 3 — Global Fallback

If no attribute metadata is available at all, the raw key from `clause.attribute` is used:

```js
params.attributes[clause.attribute] = clause.label || clauseWord;
```

### Facet Target Rebinding

If `params.target_facet` is set (from a `facet_target` entity), generic clauses like `"high"` are rebound to that specific facet:

```
"high storage" → target_facet = "storage" → clause "high" rebound to attributes["storage"] = "high"
```

---

## Step 1.5 — Brand Folding

```js
if (params.brand) {
    const attrMeta = attributesContext?.brand;
    const brandCode = attrMeta?.code || 'b';

    // Only fold if no specific brand clause (like b:a=apple) already exists
    const hasSpecificBrandAttr = Object.keys(params.attributes).some(
        k => k === brandCode || k.startsWith(`${brandCode}:`)
    );

    if (!hasSpecificBrandAttr) {
        params.attributes[brandCode] = canonicalizeValue(params.brand, attrMeta);
    }
    delete params.brand;
}
```

`params.brand` is a top-level parameter populated by the entity extractor. It's folded into `params.attributes` under the brand attribute code. The top-level `brand` key is deleted afterward to keep params clean.

---

## Step 2 — Vendor Normalization

```js
const officialVendor = Object.values(vendorsContext).find(v =>
    v.business_name.toLowerCase() === vLower ||
    v.tag.toLowerCase() === vLower ||
    v.id.toLowerCase() === vLower
);
```

**If found** in `storeContext.VENDORS`:
- Intent expects a `vendor` param → normalize to `vendorTag` (human-readable, not UUID)
- Intent does NOT expect a `vendor` param → fold into `params.attributes.vendor` and delete top-level

**If not found** (unknown vendor):
- Already in `attributes.brand` → delete vendor
- Matches a known brand clause → move to `attributes.brand`, delete vendor
- Intent doesn't expect vendor → delete vendor (schema pollution prevention)

---

## `canonicalizeValue()` — Value Normalization

```js
function canonicalizeValue(value, attrMeta, clause = null) {
    const predefined = attrMeta.predefined_values; // e.g. [{value: "apple"}, {value: "samsung"}]

    // 1. Direct match: "apple" === "apple" → "apple"
    // 2. Clause synonym: clause.matches includes "apple product" → predefined["apple"]
    // 3. Substring fuzzy: "iphones" includes "iphone" → "iphone" (only for sets < 50 values)
    // 4. Fallback: return original value unchanged
}
```

This ensures that `"Apple product"` maps to `"apple"` (the backend's predefined brand value), and `"iPhones"` maps to `"iphone"`.

---

---

# Chapter 18 — Tool Mapper

## What It Does

The **Tool Mapper** (`pipeline/toolMapper.js`) is the final translation stage. It takes a fully resolved, normalized intent and produces one or more **tool call objects** — the format the orchestrator (personality layer) passes to tool handlers.

```js
function mapToTools(resolvedIntents) {
    return resolvedIntents.flatMap(intent => mapToTool(intent));
}
```

---

## The `paramMap`

Each intent config defines a `paramMap` — a translation table from intent parameter names to tool parameter names:

```js
// From product_search.js:
paramMap: {
    product_name:  'query',        // intent param → tool param
    category:      'category_id',
    clause_words:  'clause_words',
    attributes:    'attributes',
    price_max:     'price_max',
    price_min:     'price_min',
    vendor:        'vendor'
}
```

The `paramMap` decouples the intent's semantic parameter vocabulary from the tool handler's API vocabulary. A single tool can be called by multiple intents with different param names.

---

## Step 1 — Parameter Translation (First Pass)

```js
for (const [intentParam, mapping] of Object.entries(intent.paramMap)) {
    const toolParam  = typeof mapping === 'object' ? mapping.target : mapping;
    const shouldExpand = typeof mapping === 'object' && mapping.expand;
    const value = resolvedIntent.parameters[intentParam];

    if (value != null) {
        if (shouldExpand && Array.isArray(value)) {
            // Will be expanded into multiple tool calls
            expansionParam  = toolParam;
            expansionValues = value;
        } else {
            toolParams[toolParam] = value;
        }
    }
}
```

**Array vs String Priority**: When two intent params map to the same tool param (e.g., both `products[]` and `product_name` map to `query`), arrays take priority over strings. An existing array is never overwritten by a string, unless the array is empty.

**Empty arrays are treated as unset**: `products: []` is skipped entirely so it doesn't overwrite a more informative `product_name` string.

---

## Step 1.5 — Internal Flag Pass-Through

```js
for (const [key, value] of Object.entries(resolvedIntent.parameters)) {
    if (key.startsWith('_')) {
        toolParams[key] = value;
    }
}
```

Parameters prefixed with `_` are internal pipeline flags (`_require_confirmation`, `_confirm_context`, `_resolved_product_id`, `_from_context`, etc.). These pass straight through to the tool handler without going through the `paramMap`. This is how the porter's confirmation flags reach the `add_to_cart` handler.

---

## Step 2 — Default Value Injection

```js
for (const [intentParam, mapping] of Object.entries(intent.paramMap)) {
    const toolParam = typeof mapping === 'object' ? mapping.target : mapping;
    if (toolParams[toolParam] === undefined) {
        const paramDef = intent.parameters[intentParam];
        if (paramDef?.default !== undefined) {
            toolParams[toolParam] = paramDef.default;
        }
    }
}
```

Parameters with a `default` value in the intent config are injected if they weren't set by extraction. For example, `sort_by: { default: 'relevance' }` ensures the tool always receives a sort parameter.

---

## Step 3 — Tool Call Generation

### Standard Case (Single Tool Call)

```js
return [{
    tool:          intent.toolName,   // e.g. "product.search"
    params:        toolParams,
    reason:        resolvedIntent.intentName,
    portedFrom:    resolvedIntent._ported_from || null,
    statementText: resolvedIntent.statementText
}];
```

### Expansion Case (Multi-Product Tool Calls)

When a `paramMap` entry has `{ target: 'product_id', expand: true }` and the value is an array, one tool call is generated per item:

```js
// Intent: add_to_cart, parameters.products = ["uuid-1", "uuid-2"]
// paramMap: { products: { target: "product_id", expand: true } }

return ["uuid-1", "uuid-2"].map(val => ({
    tool: "cart.add",
    params: { ...toolParams, product_id: val },
    reason: 'add_to_cart',
    portedFrom: null
}));
```

This is the mechanism behind multi-product cart additions: one `add_to_cart` intent with `products: ["uuid-1", "uuid-2"]` expands into two separate `cart.add` tool calls.

**Safe Expansion Guard**: If `expansionValues.length === 1` and `toolParams` already has a specific scalar for the same key (from a microstate), the scalar takes precedence. This prevents overriding a confirmed product ID with the expansion array value.

---

## Final Tool Call Shape

```js
{
  tool:          "product.search",
  params: {
    query:        "iPhone 16 Pro",
    category_id:  "cat-smartphones-uuid",
    attributes:   { "p:p": "budget,midrange", "m": "blue" },
    clause_words: [{ word: "cheap", clauseId: "budget_range" }],
    price_max:    200,
    _resolved_product_id: null
  },
  reason:        "product_search",
  portedFrom:    null,
  statementText: "show me cheap blue phones"
}
```

The `tool` string is the key the personality layer uses to look up the tool handler. `reason` is the intent name. `portedFrom` is set when the intent was ported (e.g., `"product_search"` → `add_to_cart`).

---

*Next: Chapter 19 — The Stack: Deferred Multi-Intent Execution*
