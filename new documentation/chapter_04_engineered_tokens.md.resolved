# Chapter 4 — Engineered Tokens: The UI Button Layer

## What Are Engineered Tokens?

Engineered tokens are **special message strings** that the `be3_ai` backend embeds in button payloads sent to the chat client (e.g. WhatsApp). When a user taps a button, the button's `id` is sent as the next message. If that `id` starts and ends with `__`, it is an engineered token — it bypasses the NLU pipeline entirely and maps directly to a pre-determined action.

This system allows the UI to express structured intent with zero ambiguity, zero NLU cost, and near-zero latency.

---

## Token Format

### Primary Format (canonical)
```
__<namespace>:<command>__
__<namespace>:<command>:<arg>__
```

### Alias Formats (WhatsApp button ID constraints)
WhatsApp has limitations on button ID characters. Aliases handle edge cases:

```
__navmore__          → nav:more
__navprev__          → nav:prev
__navresults__       → nav:results
__flowcancel__       → flow:cancel
__flowskip__         → flow:skip
__navmore<id>__      → nav:more with arg=<id>   (snapshot-aware)
__navresults<id>__   → nav:results with arg=<id>
```

### Parsing — `resolveEngineeredToken(text)`

Located in `src/utils/responseResolver.js`. The parser returns:

```js
{
    raw: "__nav:more:abc123__",
    namespace: "nav",
    command: "more",
    arg: "abc123"         // null if not present
}
```

Returns `null` for any input that doesn't match the pattern — meaning normal text messages fall through cleanly.

---

## The Microstate Guard

Before processing any navigation token, the server checks for an active microstate:

```js
const activeMicrostateEarly = state?.microstate;
const isMicrostateActive = !!(activeMicrostateEarly?.intent && activeMicrostateEarly?.type);
if (baseFilters && !isMicrostateActive) {
    // Execute pagination
}
```

**Why**: If a microstate is active (e.g. collecting a delivery address), a `__nav:more__` tap should be handled by the `microstateRunner`, not by the pagination logic. The Stage 0 engineered token handlers only fire when **no microstate** is active.

---

## All Token Types

### `__nav:more__` / `__nav:prev__` — Pagination

**Emitted by**: `product.search` tool (a "See more 👇" and "⬆️ Go back" button).

**Parsed**: `namespace=nav`, `command=more|prev`.

**Action**: Re-runs the last product search with `page` incremented or decremented.

```js
const currentPage = baseFilters.page || 1;
const delta = (command === 'prev') ? -1 : 1;
const nextPage = Math.max(1, currentPage + delta);
return { tool: 'product.search', params: { ...baseFilters, page: nextPage } };
```

**Snapshot-aware**: If the token carries a `snapshotId` (e.g. `__nav:more:abc123__`), the server retrieves the snapshot from `stateManager.getSearchSnapshot()` and uses those filters instead of `state.product_context.last_search.filters`. This ensures that buttons from a specific earlier search use the correct context even if later searches have overwritten the session's `last_search`.

---

### `__nav:results:<snapshotId>__` — "See Suggested Products"

**Emitted by**: The Sentinel (Chapter 23) when it finds products but hides them behind a suggestion.

**Action**: Replays the stored snapshot filters but **drops the `query` and `clause_words`** so that the relaxed search (attribute-only) executes successfully and returns product cards.

```js
if (command === 'results') {
    delete resolvedFilters.query;
    delete resolvedFilters.q;
    delete resolvedFilters.clause_words;
}
```

This is how a Sentinel-suggested result gets revealed to the user when they tap "See Suggestions".

---

### `__filter:clause:<snapshotId?>:<attrCode>:<clauseName>__` — Clause Filter Buttons

**Emitted by**: `product.search` via `buildFacetRefinerButtons()`.

**Example**: A button labelled "Only Apple products" sends `__filter:clause:s1d2:brand:apple_product__`.

**Action**: Re-runs the last search with the clause added to `attributes`:
```js
attributes: { ...baseAttrs, [`${attrCode}:${clauseName}`]: clauseName }
```
The page is reset to 1. The format `attrCode:clauseName` is the clause key convention used by the backend search API.

**Snapshot-aware**: A `snapshotId` can be embedded as a prefix (3+ parts detected) to ensure filters apply to the correct prior search.

---

### `__filter:value:<snapshotId?>:<attrCode>:<value>__` — Facet Value Buttons

**Emitted by**: `product.search` via `buildFacetRefinerButtons()`.

**Example**: A button labelled "In Blue" sends `__filter:value:s1d2:color:Blue__`.

**Action**: Re-runs the last search with a specific attribute value applied:
```js
attributes: { ...baseAttrs, [attrCode]: value }
```
Values are URL-decoded (`decodeURIComponent`) in case they contain special characters.

---

### `__facet:select:<attrCode>:<value>[:<categoryId>]__` — Facet Selector Buttons

**Emitted by**: `facet.list` tool handler.

**Example**: When the user asks "what brands do you have?", the bot might send buttons like `__facet:select:brand:Samsung__`.

**Action**: Directly executes a new `product.search` with the selected attribute and optional category scope:
```js
return {
    tool: 'product.search',
    params: { attributes: { [attrCode]: value }, category: categoryId, limit: 5, page: 1 },
    reason: `Engineered facet select: ${attrCode}=${value}`
}
```

---

### `__product:details:<productId>__` — "More Info" Button

**Emitted by**: Product cards in `product.search` results.

**Action**: Directly calls `product.getDetails` with the product ID:
```js
return { tool: 'product.getDetails', params: { product_id: productId } };
```

**No NLU**: The product ID is already known. Zero AI inference needed.

---

### `__product:similar:<productId>__` — "Show Similar" Button

**Emitted by**: Product detail card.

**Action**: Calls `product.search` with `similar_to` param:
```js
return { tool: 'product.search', params: { similar_to: productId } };
```
The backend handles the similarity logic (usually vector-based retrieval).

---

### `__product:compare:<productId>__` — "Compare" Button

**The most complex engineered token.** This one doesn't just call a tool — it **opens a microstate**.

**Emitted by**: Product detail card.

**Action flow**:
1. Look up the `product_compare.missing_products` trigger definition from `microstateRegistry`.
2. Resolve the product name from the ID (via `reconcileNameFromId()` — checks `last_search`, `reference_map`, `search_context`, `user_query_map`).
3. Build a complete microstate object with `params.products = [productId]` and `_labels = { productId: productName }`.
4. Call `stateManager.setMicrostate()` to open the sandbox.
5. Run `microstateFeatureProvider.getFeatureInjections()` to get recommendations (e.g. "compare with these similar products").
6. Sync any injected options back to the microstate in state.
7. Return a `microstate.disambiguate` or `microstate.collect` tool response immediately.

The result is the bot immediately asks "What's the second product you'd like to compare?" without any NLU pass.

---

### `__cart:add:<productId>__` — "Add to Cart" Button

**Emitted by**: Product cards.

**Action**: Directly calls `cart.add` with the product ID:
```js
return {
    tool: 'cart.add',
    params: { product_id: productId, product_name: resolvedName }
};
```

`resolvedName` is populated via `reconcileNameFromId()` so the personality layer can say "Added iPhone 12 Pro to your cart!" instead of a raw UUID.

---

### `__cart:view__` — "View Cart" Button

**Emitted by**: `cart.add` tool after a successful addition.

**Action**: `cart.view` tool call. No params needed.

---

### `__order:checkout__` — "Checkout" Button

**Emitted by**: `cart.view` tool and `cart.add` tool.

**Action**: `order.checkout` tool call. No params needed.

---

### `__shop:continue__` — "Continue Shopping" Button

**Emitted by**: `cart.add` and `cart.view`.

**Action**: Re-runs the last product search:
- If `state.product_context.last_search.filters` exists → replay with those filters.
- If not → default browse: `product.search` with `query: 'popular', limit: 5`.

---

### `__nav:cards:<snapshotId>__` — "Shop These Items 🛍️" Button

**Emitted by**: The Sentinel (Chapter 23) and the Snapshot Aggregator (Chapter 24) when products are hidden.

**Action**: Retrieves the snapshot from `stateManager.getSearchSnapshot()` and calls `product.showCards`:
```js
return { tool: 'product.showCards', params: { snapshot_id: snapshotId } };
```
`product.showCards` reads the snapshot, fetches the cached products, and renders them as product cards.

---

## Response Resolver Utilities

`responseResolver.js` also exports several utilities used throughout the pipeline and microstateRunner to interpret user replies. They are pure functions with no side effects.

### `resolveYesNo(text)` → `'yes' | 'no' | 'ambiguous'`

Used by the `confirm_add_ported` microstate and the LLM suggestion intercept.

**YES words**: yes, yeah, yep, yup, sure, ok, okay, absolutely, definitely, of course, go ahead, proceed, do it, confirm, alright, bet, cool, done, approved, `ms_yes`

**NO words**: no, nah, nope, never, cancel, stop, don't, negative, nevermind, forget it, back, skip, pass, `ms_no`

Resolution order:
1. Exact match (highest confidence).
2. Starts with a yes/no signal word.
3. First word match.
4. Returns `'ambiguous'` if none match.

---

### `resolveOrdinal(text)` → `number | null`

Converts ordinal/number text to a 1-based index.

```
"first"       → 1
"2nd"         → 2
"the third"   → 3
"option 4"    → 4
"#5"          → 5
"last"        → -1  (caller handles -1 as list.length - 1)
```

Supports up to 12 named ordinals, all digit forms, and prefix patterns like "option N", "number N", "pick N", "choose N".

---

### `resolveGroupedOrdinal(phrase, listLength)` → `number[] | null`

Converts group phrases to **arrays of 0-based indices**.

```
"first two"   (list: 5 items) → [0, 1]
"top three"   (list: 5 items) → [0, 1, 2]
"last two"    (list: 5 items) → [3, 4]
```

Used by the intent porter and context resolver for "add the first two to cart" type expressions.

---

### `resolveSelection(text, options)` → `{ match, index, confidence } | null`

Resolves user text against a list of presented options. Used heavily in `microstate.disambiguate` to match what a user typed to which option they meant.

**Resolution priority**:
1. Ordinal resolution (`resolveOrdinal`) — highest confidence (1.0).
2. Exact label match — confidence 1.0.
3. Partial match (contains or is contained by label) — confidence 0.85.
4. Word overlap scoring — confidence = overlap_ratio × 0.8.

---

### `resolveMultiSelection(text, options)` → `Array | null`

Splits on `" and "`, `"&"`, `","`, `"+"` and resolves each part individually via `resolveSelection`. Returns an array of matches if 2+ parts resolve, otherwise `null`.

Used for expressions like "the first and third one" or "option 1 and 3".

---

### `isTerminationKeyword(text, keywords?)` → `boolean`

Checks if the user's message matches a termination keyword (microstate exit trigger).

Default keywords: `cancel`, `nevermind`, `forget it`, `stop`, `exit`, `back`, `quit`.

The microstate contract's `onKeyword` list is passed here to override defaults.

---

## Complete Token Reference

| Token | Source | Direct Tool | Notes |
|-------|--------|-------------|-------|
| `__nav:more[:<id>]__` | product.search | product.search (+page) | Snapshot-aware |
| `__nav:prev[:<id>]__` | product.search | product.search (-page) | Snapshot-aware |
| `__nav:results:<id>__` | Sentinel | product.search (relaxed) | Drops query/clauses |
| `__nav:cards:<id>__` | Sentinel, Aggregator | product.showCards | Shows hidden products |
| `__filter:clause:...__` | product.search | product.search (+clause) | Snapshot-aware |
| `__filter:value:...__` | product.search | product.search (+value) | Snapshot-aware |
| `__facet:select:...__` | facet.list | product.search | Category-scoped |
| `__product:details:<id>__` | product cards | product.getDetails | Zero NLU |
| `__product:similar:<id>__` | product cards | product.search (similar) | Vector similarity |
| `__product:compare:<id>__` | product cards | Opens microstate | Most complex token |
| `__cart:add:<id>__` | product cards | cart.add | Resolves name |
| `__cart:view__` | cart.add result | cart.view | — |
| `__order:checkout__` | cart buttons | order.checkout | — |
| `__shop:continue__` | cart buttons | product.search (repeat) | Falls back to popular |

---

*Next: Chapter 5 — IntelliSense: The LLM Pre-Processor*
