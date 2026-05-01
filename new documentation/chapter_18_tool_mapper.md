# Chapter 18 — Tool Mapper

## The Vocabulary Problem

Every component in the pipeline up to this point has spoken in the language of intents and user meaning: `product_name`, `clause_words`, `category`, `resolved_product_id`. These names describe what the user said and what it means. But the tool handlers — the functions that actually call the search API, modify the cart, look up orders — speak in a different vocabulary: `query`, `category_id`, `product_id`, `filters`. These names describe what the API endpoints accept.

Keeping these two vocabularies separate is an important design principle. It means that if the search API changes its parameter names, only the tool mapper configuration changes — not the scoring logic, not the entity extractor, not the parameter extractor. It also means the same tool can be called by multiple intents without those intents needing to know anything about the API contract. A `product_search`, a `product_similar`, and a `browse_collection` might all eventually call the same `product.search` tool, but they each describe their intent-level parameters in terms that make sense for their respective contexts.

The `paramMap` defined in each intent's configuration file is the contract that bridges these two worlds. It is a simple key-value table where each key is an intent-level parameter name and each value is either a tool-level parameter name or an object with additional instructions.

---

## The Translation Pass

The mapper iterates over every entry in the `paramMap`. For each entry, it looks up the corresponding value in the resolved intent's parameters. If the value is `null` or `undefined`, it is skipped — there is no point translating a parameter that was not extracted. If the value is an empty array, it is also skipped. This is a deliberate rule to prevent empty arrays from overwriting more informative values. Consider a case where both `products` (an array, potentially empty) and `product_name` (a string) both map to the tool's `query` parameter. The mapper processes entries in order, and if `products` maps first and is empty, it would normally write `query = []` — which would then be overwritten correctly when `product_name` is processed. But skipping empty arrays entirely means the mapper never writes an empty value that needs correcting.

---

## Array vs String Priority

When two intent parameters map to the same tool parameter, the mapper needs a tie-breaking rule. The rule it uses is: arrays always win over strings, but an existing array is never overwritten by a string unless the array is empty.

The practical reason for this: product IDs are arrays (multiple resolved UUIDs), and product names are strings (a text query). Both can map to the tool's `query` or `product_id` parameter depending on the intent. When the context resolver has resolved specific product UUIDs, those IDs should take precedence over a text query — they are more precise. An array of resolved IDs represents certainty; a product name string represents a search expression. The mapper honours this hierarchy automatically without requiring the intent config to specify priority.

---

## The Expand Mechanism: One Intent, Multiple Tool Calls

Some intents produce a single resolved intent object but need to generate multiple tool calls from it. The clearest example is `add_to_cart` with multiple products: a user who says `"add the iPhone 16 and the Samsung S25 to my cart"` resolves to one `add_to_cart` intent with `products: ["uuid-1", "uuid-2"]`. The cart API, however, expects one product per call.

The `paramMap` handles this through the `expand` flag:

```js
paramMap: {
    products: { target: "product_id", expand: true }
}
```

When the mapper encounters a parameter with `expand: true` and the value is an array, it does not write the array to `toolParams`. Instead, it records the array as the expansion set. After the full first-pass translation, the mapper generates one tool call object per item in the expansion array, copying all the base `toolParams` and substituting the individual item for the expansion parameter.

The result is that one `add_to_cart` intent with two products becomes two `cart.add` tool calls with one product each. The orchestrator receives these as a list and executes them sequentially.

**The Safe Expansion Guard** prevents a subtle bug. When a microstate fulfils a `confirm_add_ported` flow, the resolved product ID from the microstate's params might appear in `toolParams` as a scalar under the same key as the expansion parameter (because the internal flags pass it through). If the expansion set has exactly one item and `toolParams` already carries a scalar for that key, the scalar takes precedence over the expansion value. This prevents a microstate-confirmed ID from being overridden by the generic expansion logic.

---

## Internal Flag Pass-Through

The mapper has a second pass after translation that copies every parameter beginning with an underscore directly into `toolParams`, bypassing the `paramMap` entirely. This is how the pipeline's internal metadata — `_require_confirmation`, `_confirm_context`, `_resolved_product_id`, `_from_context`, `_context_product_ids`, `_pie_product_name` — travels through to the tool handlers.

These flags are never declared in intent configs because they are not user-facing parameters. They are coordination signals between pipeline stages. The underscore convention marks them as internal and ensures they are preserved throughout the entire journey from parameter extraction to tool execution. Without this pass-through, confirmation microstates could not fire, stack metadata would be lost, and the tool handlers would have no way to know whether a product reference came from the user's direct input or from contextual resolution.

---

## Default Value Injection

After translation and after the expansion check, the mapper does a second pass over the `paramMap` to inject any configured default values for parameters that were not set during extraction. A parameter defined in the intent config with `default: "relevance"` will have `"relevance"` written to the corresponding tool parameter if that tool parameter is still undefined.

Defaults are injected after translation rather than before because the translation pass may produce values from extraction that should override the default. Processing defaults last ensures they are truly a last resort, not a competing value.

---

## What Leaves the Tool Mapper

Every item leaving the tool mapper is a standardised tool call object with the following structure:

- **`tool`**: The tool handler identifier as declared in the intent config (`"product.search"`, `"cart.add"`, `"order.track"`, etc.). This string is what the orchestrator looks up in its tool registry.
- **`params`**: The fully translated, default-injected, flag-enriched parameter object in the tool's own vocabulary.
- **`reason`**: The intent name that generated this tool call. Used by the orchestrator and the personality layer for logging and response generation.
- **`portedFrom`**: If the intent was ported by the porter (e.g., `"product_search"` ported to `"add_to_cart"`), this records the original intent name. The personality layer uses this to construct contextually appropriate responses — if you ported from a search, you know the user was browsing and then decided to buy, which is different conversationally from a direct purchase command.
- **`statementText`**: The raw text of the sub-statement that produced this tool call. Useful for logging and for the personality layer to reference what the user specifically said.

The final output of the mapper is an array of these objects — potentially more than one if expansion was used, and potentially spanning multiple intents if this was a multi-intent message. This array is what the orchestrator receives and executes.

---

*Next: Chapter 19 — The Stack: Deferred Multi-Intent Execution*
