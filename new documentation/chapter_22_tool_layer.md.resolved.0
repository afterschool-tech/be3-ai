# Chapter 22 — The Tool Layer: All 11 Tools

## The Tool Registry

Every tool the orchestrator can call is registered in `TOOL_REGISTRY`, a flat key-value object assembled from 10 tool modules. Each entry has the same shape:

```js
'cart.add': {
    description: 'Add a product to the shopping cart',
    params: {
        product_id: { type: 'string', description: '...' },
        quantity:   { type: 'number', description: 'Quantity (default 1)' }
    },
    handler: async (params, context) => { ... }
}
```

The `description` and `params` fields are exposed to the AI prompt builder when needed. The `handler` is what the orchestrator actually calls. Every handler receives: `params` (the translated tool parameters from the mapper), `context` (the shared orchestrator context with categories, vendors, session ID, and microstate flags), and optionally `results` (the accumulated prior tool results in the same batch).

---

## `product.search`

The primary search tool. It takes a `query` string plus optional filters (`category_id`, `attributes`, `price_min`, `price_max`, `vendor`, `clause_words`) and calls the backend search API. The most important things it does beyond the basic API call:

**Search context update**: After a successful search, the tool writes the returned product IDs and the original query to `stateManager.setSearchContext()`. This is the data the stack's ordinal re-resolution reads. Every search tool call refreshes the search context so that ordinal references in subsequent messages (`"add the first one"`) resolve against the most recent results.

**Reference map update**: All returned product IDs are added to the `reference_map` in session state, keyed by product handle and name. This makes every product the user has seen addressable by name in future messages.

**Sentinel re-search**: If the product sentinel evaluates the results as irrelevant, the tool re-runs the search using the sentinel's `vector_query` against the vector search endpoint, returning the refined results as `suggested_products` with `is_sentinel: true`.

**Fallback cascade**: If the primary keyword search returns nothing, the tool falls through to: (1) category-scoped browse, (2) vector similarity search against a broader query, (3) a discovery-based suggestion set. Each fallback is marked `is_fallback: true` so the personality layer knows not to name specific products it cannot guarantee are relevant.

---

## `product.getDetails`

Fetches full details for a single product by UUID. Used by `check_availability`, `product_detail`, and various comparison flows. The tool calls `/products/storefront/products/:id` and returns a structured product object with attributes, images, vendor, pricing, and description.

The handler also resolves the product ID through `resolveProduct()` if the input is a name or ordinal reference rather than a raw UUID.

---

## `product.compare`

Takes a `products` array of 2–5 UUIDs and fetches full details for each. It assembles a `comparison` array where each item contains its full attribute set expanded to human-readable keys (via the attribute metadata in `storeContext.ATTRIBUTES`). This expansion is what the personality layer uses to generate meaningful comparison prose rather than dumping raw backend attribute codes at the user.

---

## `product.facets`

Returns the available filter options for a given attribute within a search scope. Used by `facet_list` intents — when a user asks `"what colours are available?"` or `"show me all the brands"`. The tool queries the backend's facet endpoint and returns a list of `{ value, count }` pairs. The `clause_words` param can scope the facet to a specific attribute code.

---

## `cart.add`

The most complex cart tool. Its handler has a two-stage product resolution flow before it touches the cart API:

**Stage 1 — `resolveProduct()`**: The `product_id` parameter from the mapper may not be a UUID. It might be a product name, an ordinal phrase like `"the second one"`, or a relative reference like `"it"`. `resolveProduct()` runs through the session's reference_map, search_context, and query_map to find the actual UUID. If it cannot resolve, it returns an honest error message telling the user to search first.

```js
const product_id = await resolveProduct(identifier, context);
if (!product_id) {
    return { error: `I couldn't find a product matching "${identifier}".` };
}
```

**Stage 2 — Product validation**: Even after UUID resolution, the tool fetches the full product from `/products/storefront/products/:id`. This serves two purposes: it confirms the product is still active and retrievable, and it gets the current price to send to the cart API (the pipeline's extracted price may be stale).

**State side effects**: After a successful add, the tool syncs the updated cart state to Redis via `stateManager.updateCart()`. It also tracks the item in the user's `abandoned_items` preference list — a rolling list of the last 5 products added to cart, used by re-engagement features. The add result includes WhatsApp button metadata for "View cart", "Checkout", and "Continue shopping" — UI affordances the frontend renders without the AI needing to generate them.

---

## `cart.view`

Fetches the current cart via `/cart?session_id=...` and returns a fully itemised summary. Items are synced to Redis for use by downstream pipeline tools (the context resolver can read cart state to resolve references like `"the item I just added"`). The response includes `vendor_groups` — a breakdown of cart items grouped by vendor, with their individual subtotals. This is used by the checkout flow to display per-vendor WhatsApp checkout links.

---

## `cart.remove`

Removes a specific item from the cart. The challenge here is that `product_id` from the pipeline may not be the cart's internal line item ID (`cart_item_id`). The tool runs a three-step resolution:

1. Check if the value is already a `cart_item_id` by looking it up directly in the fetched cart items list.
2. Run `resolveProduct()` to convert a product name/reference to a product UUID, then find the matching cart line item by `product_id`.
3. Fall back to fuzzy substring matching against `product_name` in the cart.

```js
const fuzzyMatch = items.find(i =>
    i.product_name && i.product_name.toLowerCase().includes(lowerQuery)
);
```

This cascade ensures that `"remove the iPhone"` works even when the cart item's internal ID is a UUID the user has never seen.

---

## `cart.updateQuantity`

Updates the quantity of a cart line item. Uses the same resolution logic as `cart.remove` to find the `cart_item_id` from a product name or reference. Quantity must be at least 1 — the handler validates this deterministically without any LLM involvement and returns a specific error message if the value is invalid.

---

## `vendor.*` Tools

The vendor module exposes several tools:

**`vendor.list`**: Returns all active store vendors with their product counts and delivery information. Capped at 25 in the personality summariser.

**`vendor.getProducts`**: Fetches products from a specific vendor, using the vendor's tag to scope the search. Works like `product.search` but vendor-scoped.

**`vendor.getContact`** / **`vendor.getContactLink`**: Returns the vendor's WhatsApp contact link and phone number, plus a pre-filled message template the user can send. The result includes a `message_preview` — the text that will be pre-filled in the WhatsApp compose box.

**`vendor.search`**: Fuzzy-searches the vendor list by name or tag. Returns a ranked list of vendor matches. Used by `vendor_search` intents.

---

## `order.*` Tools

**`order.track`**: Takes an `order_id` and fetches the full order status from the backend. Returns status, items, vendor breakdown, and estimated delivery. The circuit breaker treats this as critical — if it fails, the orchestrator stops.

**`order.list`**: Returns the user's recent orders using the session ID. Scoped to the current tenant. Returns a list of order summaries with IDs, statuses, and totals.

---

## `category.browse`

Fetches products within a specific category, using the category's backend ID or slug. Supports pagination via `page` and `per_page` params. Used by `browse_collection` and `browse_category` intents. The result updates `search_context` just like `product.search` does — category browse results become ordinal-resolvable in subsequent messages.

---

## `collection.browse`

Similar to `category.browse` but scoped to a curated collection (a manually assembled group of products defined by the store admin). Uses the collection's slug to identify the collection, fetches its products, and updates search context.

---

## `attribute.list` / `product.facets`

The attribute tool returns available attribute options (colour options, storage sizes, etc.) across the store or scoped to a category. The distinction from `product.facets` is scope: `attribute.list` is store-wide, while `product.facets` is query-scoped. Both return `{ value, count }` pairs the personality layer uses to generate filter suggestion lists.

---

## `discovery.sentinel`

The discovery tool is the AI's last resort when all specific search paths fail. It runs a prompt-based LLM call asking the AI to generate a list of product recommendations from the store's known categories. Unlike `product.search`, it does not call the backend search API — it asks the LLM to creatively suggest based on the conversation context and the store's category taxonomy. Results are marked `is_fallback: true` so the personality layer frames them as suggestions rather than search results. The tool's `recovery_reason` field tells the personality layer why recovery was needed (empty search, entity mismatch, etc.).

---

## `conversation.chat`

The fallback tool for all `conversation` intents — questions, greetings, capability queries, complaints, off-topic requests. It does not call any backend API. It returns a minimal result object that signals to the personality layer to generate a pure conversational response using the store summary and conversation history. The DCO config for `conversation` includes the `capabilities` segment so the LLM can answer "what can you do?" accurately, and the `availability` segment so it can check the store's category inventory before saying "we don't have that."

---

## `microstate.disambiguate`

The disambiguation tool is unique in that its handler does almost no work itself. Its output is a structured object that the personality layer and the frontend use to render an interactive question — a re-prompt with numbered options and control buttons. The real work of running a microstate is done by the microstate runner and the feature provider; the tool simply represents the re-prompt's existence to the orchestrator so it appears in the tool results array and gets summarised correctly for the personality layer.

```js
// microstate.disambiguate result shape:
{
    tool: 'microstate.disambiguate',
    params: {
        message:       "Which vendor are you interested in?",
        options:       [{ label: "Jumia", value: "jumia" }, ...],
        controls:      { more: true, cancel: true, recommendedIndex: 0 },
        missingParam:  "vendor",
        parentIntent:  "vendor_search"
    }
}
```

The frontend reads `options` and `controls` to render buttons. The personality layer reads `message` to generate a warm re-phrasing of the question in Be3's voice.

---

*Next: Chapter 23 — Product Sentinel: Relevance Gate*

> **Note on chapter numbering**: The numbering in earlier drafts placed the Sentinel at Ch22 and the Tool Layer at Ch22. The canonical task order has the Tool Layer at Ch22 and the Sentinel at Ch23, which is what this document follows.
