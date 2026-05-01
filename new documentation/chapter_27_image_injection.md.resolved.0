# Chapter 27 — Image Injection & WhatsApp UX

## Why Images Are Stripped Then Restored

Product image URLs travel an unusual path through the pipeline. They are present in the raw backend product data, deliberately stripped before anything reaches the AI, and then re-injected for the frontend after the AI response is generated. Understanding why requires understanding two competing requirements.

The AI prompt must be lean. Image URLs are long strings — often 150-300 characters of CDN path with cache-busting parameters — that contribute nothing to the LLM's ability to describe or reason about a product. Including 6 image URLs in a product list sent to the LLM is pure token waste. So the product serialisation in the personality layer's summariser intentionally drops `image_url` from every product object before building the prompt.

The frontend, however, needs images. A WhatsApp product card without an image renders as a text-only card — worse UX than having the image. The UI depends on `image_url` being present in the product objects within the `results` field of the API response.

The image injector solves this by re-attaching images after the LLM has already been called, using a Redis image cache that stores `product_id → image_url` mappings. The cache is populated by tool handlers (`product.search`, `vendor.getProducts`) whenever they process product objects — image URLs are cached alongside the search results so they can be restored later without an API call.

---

## The `injectImages()` Function

The injector uses a recursive depth-first traversal to find every product-like object nested anywhere in the tool results structure:

```js
async function injectImages(data, stateManager) {
    const processProduct = async (product) => {
        if (product && product.suppress_images) return;  // Phase 4 suppression flag
        if (product && product.id && !product.image_url) {
            const cachedImage = await stateManager.getProductImage(product.id);
            if (cachedImage) {
                product.image_url = cachedImage;
                // Keep metadata in sync if it exists
                if (product.metadata && !product.metadata.image_url) {
                    product.metadata.image_url = cachedImage;
                }
                injectionCount++;
            }
        }
    };

    const traverse = async (obj, depth = 0) => {
        if (depth > 5) return;  // Hard recursion guard

        if (Array.isArray(obj)) {
            for (const item of obj) await traverse(item, depth + 1);
        } else if (obj && typeof obj === 'object') {
            // Identify product nodes: has id + (content_type='product' OR title OR name)
            if (obj.id && (obj.content_type === 'product' || obj.title || obj.name)) {
                await processProduct(obj);
            }
            // Continue into nested objects/arrays
            for (const key of Object.keys(obj)) {
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    await traverse(obj[key], depth + 1);
                }
            }
        }
    };

    await traverse(data);
}
```

The product detection heuristic — `obj.id && (obj.content_type === 'product' || obj.title || obj.name)` — is intentionally broad. It matches product objects regardless of their nesting path: whether they appear in `result.products`, `result.comparison`, `result.suggested_products`, inside card objects in `whatsapp_product_cards`, or anywhere else. This breadth ensures that product cards, comparison arrays, and fallback suggestions all get their images injected.

The depth cap at 5 prevents infinite recursion on circular references or deeply nested structures. In practice, products are never more than 3-4 levels deep, so the cap is a safety net rather than a functional constraint.

**The `suppress_images` flag** gives tools explicit control to opt out of injection. This is used by tools that intentionally omit images — for example, a conversation response that references a product by name only, where attaching an image would be visually incongruous.

---

## The Two-Pass Injection Strategy

Image injection runs twice per request, not once. This is because of the stack execution pattern:

**Pass 1 — Immediate after initial tool execution (line ~422)**:
```js
toolResults = await executeTools(toolsSelected, session_id);
await injectImages(toolResults, stateManager);  // First pass
```

This restores images for the initial tool results before the stack loop begins.

**Pass 2 — After stack continuation (line ~565)**:
```js
consolidatedToolResults = [...previousToolHistory, ...toolResults];
await injectImages(consolidatedToolResults, stateManager);  // Second pass
```

This second pass runs on the full consolidated results after all stack intents have executed. It handles two cases: tool results from prior turns (loaded from `previousToolHistory`) that may have lost their cached images, and new tool results from stack intents that ran during the loop and may have products without images.

Running injection on the consolidated set rather than just the new additions is safe because the injector's `!product.image_url` guard makes it idempotent — it only writes to products that are missing an image. Products that already had images injected in Pass 1 are skipped in Pass 2 at zero cost.

---

## `extractImages()` and `display_images`

After injection, a second utility — `extractImages()` — flattens all injected image URLs out of the tool results into a deduplicated array:

```js
function extractImages(data) {
    const images = new Set();  // Set ensures deduplication

    const traverse = (obj, depth = 0) => {
        if (depth > 5 || !obj || typeof obj !== 'object') return;
        if (obj.suppress_images) return;

        if (obj.image_url)                    images.add(obj.image_url);
        if (obj.metadata?.image_url)          images.add(obj.metadata.image_url);

        Object.values(obj).forEach(val => {
            if (typeof val === 'object') traverse(val, depth + 1);
        });
    };

    traverse(data);
    return Array.from(images);
}
```

The extracted array becomes the `display_images` field in the final API response. The WhatsApp client reads this field to pre-load and display images associated with the response. By providing a flat deduplicated array rather than leaving images buried inside nested result objects, the client gets a single source of truth for all images it needs to render — it does not need to understand the structure of `results` to find them.

---

## Product Card Anatomy

Product cards are the rich interactive components that display product results in the WhatsApp UI. Each card is built by `buildProductCards()` from a product object:

```js
function buildProductCards(products) {
    return {
        type: 'button',
        transaction: 'product_card',
        cards: products.filter(Boolean).map((p, idx) => ({
            id:           p.id,
            content_type: 'product',
            sponsor: {
                type:       'product',
                product_id: p.id,
                name:       p.name || p.title || null,
                ordinal:    idx + 1  // 1-based position in the result set
            },
            image_url: p.image_url || p.metadata?.image_url || null,
            text:      `*${p.name || 'Product'}*\n💰 ${p.price !== undefined ? `₦${p.price}` : 'Price unavailable'}`,
            buttons: [
                { id: `__cart:add:${p.id}__`,     title: 'Add to cart' },
                { id: `__product:details:${p.id}__`, title: 'More info' },
                { id: `__product:similar:${p.id}__`, title: 'Show similar' }
            ]
        }))
    };
}
```

### The `sponsor` Object
The `sponsor` field carries product metadata for the WhatsApp client's carousel renderer. `ordinal` is the 1-based position of the card in the result set — the client uses this to display "1st", "2nd", "3rd" positional labels that make ordinal references in the user's next message ("add the second one") clearly resolvable.

### Button ID Engineering
Every button on every card carries a structured engineered token as its `id`. These IDs follow the `__namespace:action:payload__` pattern:

- `__cart:add:uuid__` — triggers the cart add flow for the specific product
- `__product:details:uuid__` — opens the product detail view
- `__product:similar:uuid__` — triggers a similar-products search seeded with this product's ID

The UUID is embedded in the token so that when the button is tapped, the AI service receives the exact product ID without needing to do any resolution. The engineered token handler in `server.js` parses these tokens and converts them directly to tool calls, bypassing the entire NLP pipeline. This makes card button taps faster and more reliable than typing the equivalent message.

### The `text` Field
Each card's text is WhatsApp-formatted: product name in bold (`*name*`) and price prefixed with the Naira symbol. This formatting is rendered natively by WhatsApp's carousel component. The personality layer does not generate this text — it is generated deterministically by `buildProductCards()` to ensure consistent formatting regardless of how the AI describes the products in its response.

---

## WhatsApp Formatting Constraints

The DCO's `formatting` segment exists because WhatsApp has specific rendering rules that differ from standard markdown:

```
- NO TABLES: WhatsApp does not render markdown tables. Lists only.
- *bold* for key details (prices, product names)
- _italics_ for emphasis
- Lists (- item) for choices
- New lines to separate content — no "walls of text"
```

These constraints are hard-coded in the segment because they apply to every single response the system generates. The Be3 storefront runs on WhatsApp — there is no web rendering context where tables would work. The formatting segment ensures the LLM knows this at every call, preventing it from generating table syntax that would appear as raw `|` characters in the user's chat.

The `checkout_links` segment adds another WhatsApp-specific constraint: never modify URLs. WhatsApp links must be exact — any URL encoding, shortening, or parameter addition will break the link. The LLM has a known tendency to reformat URLs for readability; the explicit instruction prevents this.

---

## The Full Image/Card/Button Lifecycle

Putting the full chain together for a `product_search` response:

1. **Backend API** returns product array with `image_url` fields.
2. **`product.search` handler** caches `id → image_url` in Redis via `stateManager.cacheProductImage()`. Then deliberately excludes `image_url` from the object sent to the personality layer.
3. **Personality layer** receives products without images. Summarises them, builds prompt. LLM generates response. No image URLs in the LLM call.
4. **`injectImages()`** traverses tool results, reads the Redis cache, and re-attaches `image_url` to each product object in-place.
5. **`buildProductCards()`** constructs card objects from the now-image-rich product array. Button IDs are stamped with the product UUIDs.
6. **`extractImages()`** collects all image URLs into the flat `display_images` array.
7. **Final response** ships: `reply` (LLM text), `whatsapp_product_cards` (card carousel), `display_images` (pre-load list), `whatsapp_buttons` (action buttons). The frontend renders each independently.

---

*Next: Chapter 28 — Visual Search*
