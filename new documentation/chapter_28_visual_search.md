# Chapter 28 — Visual Search

## What Visual Search Is

Visual search is triggered when the user sends an image — a photo of a product they want to find, a screenshot from social media, or a picture of something they own and want to replace. Instead of typing `"show me black running shoes"`, they send a picture of a shoe. The system finds visually similar products in the store catalogue.

This is architecturally distinct from every other pipeline flow. Text-based searches pass through NLP cleaning, intent resolution, entity extraction, scoring, parameter extraction, and normalisation — all of which operate on language. An image contains none of that. There are no keywords to extract, no entities to detect, no intent to classify. The image is the query.

---

## Detection: The Pipeline Fork

Visual search is detected at the very top of the `/chat` request handler by checking the request body for an `image` field:

```js
const isVisualSearch = !!req.body.image;
```

This single boolean flag controls four major pipeline behaviours for the rest of the request lifecycle.

When `isVisualSearch` is true, the server immediately skips the entire deterministic resolver call:

```js
if (isVisualSearch) {
    console.log(`[Server] 📸 Visual search detected. Short-circuiting pipeline.`);
    selection = {
        intent:     'product_search',
        confidence: 1.0,
        tools:      []
    };
    forceVisualSearchTool = {
        tool:   'product.search',
        params: {
            image:       req.body.image,
            search_mode: 'IMAGE',
            limit:       5
        },
        reason: 'User sent an image for visual search'
    };
} else {
    selection = await resolveDeterministic(message, state);
}
```

The intent is hardcoded to `product_search` with confidence 1.0 — there is no ambiguity. A user who sends an image wants to search for products. The tool is also hardcoded to `product.search` with `search_mode: 'IMAGE'` and the raw image data in the `image` parameter.

```js
if (forceVisualSearchTool) toolsSelected = [forceVisualSearchTool];
```

All tool selection from the pipeline's normal flow is discarded. The forced tool is the only thing that runs. No user message text is analysed, no intent scored, no parameters extracted.

---

## What Gets Skipped and Why

### 1. The Stack Loop

```js
} else if (stackData?.remaining_intents?.length > 0 && !isVisualSearch) {
```

The stack execution loop is gated with `!isVisualSearch`. Visual search cannot generate a multi-intent message — the user sent a single image, not a compound text command. Attempting to run the stack on a visual search request would either do nothing (the stack from a previous turn has nothing to do with an image search) or produce incorrect behaviour by mixing visual results with deferred text intents. The guard ensures the stack loop is completely bypassed.

### 2. The Product Sentinel

```js
const ENABLE_SENTINEL = !isVisualSearch;  // SKIP sentinel for visual search
```

The sentinel's job is to evaluate whether returned products are relevant to the user's query. Its evaluation logic is keyword-based — it sends product names and descriptions to an LLM and asks whether they match the search phrase.

Visual search results are not matched by keyword relevance. They are matched by visual similarity — the backend's image embedding model found products whose visual features resemble the query image. A product might visually match a query image perfectly while having a name that shares zero words with a description the sentinel would evaluate against. Sending visual results through the sentinel would almost certainly produce false rejections.

For example: a user sends a photo of a brown leather handbag. The backend's vector search returns "Genuine Bovine Crossbody Bag — Dark Cognac". The sentinel's LLM, evaluating relevance against the query phrase (which is empty — the user sent only an image), would have no text to judge against and would either error or incorrectly mark the results as irrelevant. The `!isVisualSearch` guard prevents this entirely.

### 3. NLP Pipeline

The deterministic resolver, the intent resolver, the entity extractor, the scoring system, the parameter normaliser — none of these run. The `forceVisualSearchTool` is injected directly into `toolsSelected`, completely bypassing the pipeline's resolution layer. This is not just an optimisation; it is a correctness requirement. Running `"[Image Search]"` (the placeholder logged to conversation history) through the NLP pipeline would produce meaningless intent classifications.

---

## `product.search` in IMAGE Mode

The `product.search` tool handler detects `search_mode: 'IMAGE'` and routes the request to the backend's visual search endpoint rather than the standard keyword search endpoint. The `image` parameter carries the base64-encoded image data from the request body. The backend's image processing pipeline:

1. Decodes the image
2. Generates an embedding vector using a vision model
3. Performs ANN (approximate nearest neighbour) search against the catalogue's pre-computed product image vectors
4. Returns the top-K products ordered by visual similarity

The tool returns these results in the same format as a keyword search — a `products` array with `id`, `name`, `price`, `vendor`, `image_url` — with one additional field: `search_mode: 'IMAGE'`. This flag travels from the tool result through the personality layer's summariser, where it is preserved:

```js
} else if (rr.mode === 'IMAGE' || rr.search_mode === 'image') {
    base.search_mode = 'image';
}
```

---

## DCO: The Visual Search Flag

After tool execution and image injection, the personality layer is called with `visual_search: isVisualSearch` in the DCO context:

```js
response = await generateResponseFromTools(
    message,
    consolidatedToolResults,
    state.conversation_history,
    {
        intentNames:         allIntentNames,
        conversationSummary: state.conversation_summary || null,
        visual_search:       isVisualSearch   // ← forwarded to DCO
    }
);
```

Inside `assemblePrompt()`, this flag triggers two changes to the prompt:

**Force-add the `visual_search` segment**:
```js
if (options.visual_search) {
    if (!dco.segments.includes('visual_search')) {
        dco.segments.push('visual_search');
    }
}
```

**Prune `grounding` and `availability` when products are present**:
```js
const hasProducts = toolResultsSummary.includes('"products"') || toolResultsSummary.includes('"results"');
if (hasProducts) {
    dco.segments = dco.segments.filter(s => s !== 'grounding' && s !== 'availability');
}
```

---

## The `visual_search` Prompt Segment

The segment the DCO injects for visual results is specifically designed to override the default grounding rules:

```js
visual_search: () => `VISUAL SEARCH RESULTS (GROUNDING OVERRIDE):
- The user sent an image to find similar products.
- TRUST THE DATA: The products in "TOOL RESULTS DATA" are absolute visual matches.
- IGNORE KEYWORDS: These matches are based on visual similarity, NOT text keywords.
  Even if the product names don't match the user's previous words,
  they ARE the correct results for this image.
- Be brief, cute, and enthusiastic about these visual matches! 📸✨
- GROUNDING (MANDATORY):
  - Only mention the products provided in the list.
  - Use the exact "price" provided.
- DO NOT suggest "searching for something else" or "refining with text"
  because these results are perfect!
- FOCUS: Tell the user to use the "See product details" button to explore these items.`
```

Three instructions here are critical:

**"TRUST THE DATA"** — The default `grounding` segment instructs the LLM to cross-reference product availability against the store context when something seems missing. For visual results, this is wrong — the products returned are the results. The visual_search segment asserts these are "absolute visual matches" to prevent the LLM from hedging.

**"IGNORE KEYWORDS"** — The LLM may notice that the product names in the results don't match any keywords in the user's message (because the message was an image). Without this instruction, it might say "I couldn't find products matching your description." With it, the LLM understands the discrepancy is expected.

**"DO NOT suggest searching with text"** — The LLM's default conversational behaviour when results seem uncertain is to offer to try a different search. For visual results, this is actively unhelpful. The instruction suppresses this tendency.

### Why `grounding` is pruned

The `grounding` segment contains the rule: "If `products` is empty but `suggested_products` is NOT empty, [handle fallback]." For visual results, `products` is never empty (we returned actual matches), and the fallback logic is irrelevant. More importantly, grounding contains: "Use store context to check availability before saying 'we don't have it'." For visual search, we never say we don't have something — we show what we found. The prune keeps the prompt lean and conflict-free.

### Why `availability` is pruned

The `availability` segment tells the LLM to scan the store's category inventory if a product isn't in the results. For visual search, the results are the matches — there is no category-level fallback to invoke.

---

## The User Experience End-to-End

1. **User sends an image** via the WhatsApp interface.
2. **Server detects `req.body.image`** → entire NLP pipeline bypassed.
3. **`product.search` runs** with `search_mode: 'IMAGE'` → backend visual similarity search.
4. **Image injection** re-attaches `image_url` to all returned products for the card carousel.
5. **Sentinel skipped** → no risk of false rejection on visual matches.
6. **DCO visual_search flag** → `visual_search` segment injected, `grounding`/`availability` pruned.
7. **Personality layer** generates an enthusiastic response describing the visual matches without hedging.
8. **Product cards** render in the WhatsApp carousel with "Add to cart / More info / Show similar" per card.
9. **`display_images`** provides the pre-load list for the client.

The user receives a carousel of visually similar products with a response like: "Oh wow, I found some great matches for that! 📸✨ Here are the closest items from our store:" — followed by the product cards, each actionable with one tap.

---

*Next: Chapter 29 — Every LLM Inference in the Pipeline*
