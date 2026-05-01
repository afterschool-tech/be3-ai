# Chapter 19 — The Stack: Deferred Multi-Intent Execution

## The Sequential Dependency Problem

When a user sends a single message containing multiple intents — `"search for gaming laptops and add the first one to my cart"` — the naive approach would be to extract all intents, map them all to tool calls, and fire them simultaneously. This would be wrong.

The second intent (`add_to_cart`) depends on data that does not exist yet: the product ID of `"the first one"` in the search results. At the moment the pipeline processes this message, no search has been run. `"the first one"` is an ordinal reference that points into a result set that will only exist after the first tool call executes and returns. If both tool calls are fired at the same time, the `cart.add` call will receive either a null product ID or the literal string `"the first one"` — neither of which is useful.

This is a class of problem that cannot be solved at the parameter extraction stage regardless of how sophisticated the extraction is. The dependency is not linguistic; it is temporal. The second intent needs real runtime data that only the first intent's execution can provide.

The Stack exists to manage this class of problem. It converts what would be a simultaneous multi-tool execution into a sequential queue where each intent only executes after the preceding intent has completed and its results have been written to session state.

---

## The Design Contract Between Pipeline and Orchestrator

The stack does not execute tool calls itself. It has no connection to the backend API. What it does is structure the execution contract between the pipeline and the server layer (`server.js`). The pipeline signals that a stack is active by including `stack_active: true` in the result it returns. The server layer sees this flag, executes the first tool call, receives the response, updates session state with the result (search context, product IDs, reference map entries), and then checks whether a stack is still active. If it is, it calls `resumeIntentStack()` to get the next tool call, and repeats. This loop continues until the stack is empty.

The pipeline's role is to set up the queue correctly, advance it correctly on each resume, and handle the ordinal re-resolution that makes the deferred execution semantically correct.

---

## Single Intent Bypass

The stack always checks how many intents are in the current message before doing anything. A single-intent message bypasses the stack entirely — no Redis write, no queue, no overhead. The tool calls are mapped immediately and returned. This is the common case, and keeping it free of stack machinery is important for performance.

Only when there are two or more intents does the stack mechanism engage.

---

## The Stack Object

When multiple intents are present, the stack creates a queue object and writes it to Redis under the user's session key. The object holds:

- **`remaining_intents`**: All intents except the first, stored in execution order. Each entry is a fully resolved intent object including its parameters as extracted and normalised.
- **`executed_intents`**: An accumulating list of intents that have already run. Starts empty and grows by one entry each time `resumeIntentStack()` is called.
- **`current_intent_index`**: A monotonically increasing counter tracking how many intents have been executed so far.
- **`last_search_context`**: A stack-scoped search context that gets populated by the tool handler after each search runs within this stack. This is distinct from the global search context and is preferred for ordinal resolution within the stack.
- **`created_at` and `expires_at`**: Timestamps for TTL management. The stack expires after 5 minutes — the same window as a microstate. If the user takes longer than 5 minutes between steps of a multi-intent flow, the stack is considered abandoned.

After writing this object to Redis, the system maps the first intent to tool calls and returns immediately. The remaining intents wait in Redis until the server signals it is ready for the next one.

---

## Resumption: `resumeIntentStack()`

Each time `server.js` finishes processing a tool response and detects `stack_active: true` (or an explicit stack check), it calls `resumeIntentStack()`. This function:

1. Loads the stack from Redis. If none is found, returns null — the stack may have expired or been cleared.
2. Checks the expiry timestamp. An expired stack is cleared and null is returned.
3. Moves the front of `remaining_intents` to `executed_intents` and increments the index.
4. Checks whether `remaining_intents` is now empty. If so, clears the stack from Redis and returns `{ complete: true }`.
5. If intents remain, runs ordinal re-resolution on them.
6. Maps the new front intent to tool calls and saves the updated stack to Redis.
7. Returns the tool calls with `resumed_from_stack: true` so the server knows not to run a fresh pipeline pass.

This function is idempotent in design: calling it when the stack is already empty or expired is safe.

---

## The Ordinal Re-Resolution Problem

The hardest part of deferred execution is ordinal reference resolution. Consider the message: `"find me iphones and add the first two to my cart"`.

When the pipeline processes this message, it extracts two intents. The `add_to_cart` intent tries to resolve `"the first two"` through the context resolver and the parameter extractor. At that moment, the `search_context` in Redis is either empty or contains results from a completely different previous session query. `"The first two"` cannot be resolved to valid product IDs. The parameter extractor stores the phrase as a raw string in `products[0]` and records it in `_context_grouped_ordinal` for later.

After `resumeIntentStack()` is called following the iPhone search, the function runs `reResolveOrdinalsForRemainingIntents()`. This function:

1. Fetches the search context — preferring the stack-scoped `last_search_context` if the search ran within this stack, and falling back to the global search context otherwise.
2. For each remaining intent that involves products (`add_to_cart`, `product_compare`, `check_availability`, `remove_from_cart`), inspects `products[0]`, `product_name`, and any stored ordinal phrases.
3. Attempts to resolve the phrase using `resolveGroupedOrdinal()` (for phrases like `"first two"`, `"top three"`, `"last four"`), which returns a list of zero-based indices into the result set.
4. If grouped resolution succeeds, replaces `products` with the actual UUIDs from `search_context.product_ids` at those indices, clears `product_name`, and marks the parameters with `_from_context: true`.
5. If grouped resolution fails, attempts `resolveOrdinal()` for single ordinal phrases like `"the second one"` or `"the last"`.

The reason this runs on resume rather than at extraction time is not merely about data availability — it is about data correctness. The search results that exist at extraction time might be from a previous session. The re-resolution must happen against the results of the search that just ran within this stack, which is why the stack maintains its own `last_search_context` independently of the global session context.

---

## The UUID Guard: Handling Stale Partial Resolutions

A subtle edge case arises when the search context grows between re-resolution attempts. Consider a stack where the first intent is a search, the second is `add_to_cart` for `"the first two"`, and the first search returns only one result. On the first resume, re-resolution runs: `"the first two"` resolves to `["uuid-1"]` — only one UUID, because only one product was in the results. The intent's `products` now holds `["uuid-1"]` — a UUID.

If the stack has a third intent that runs another search and adds more results, and then a fourth intent that also references `"the first two"`, the fourth intent's `products[0]` would be `"uuid-1"` — a UUID, not a phrase. A naïve re-resolver would see a UUID and decide there is nothing to resolve. This would miss the expanded result set.

The UUID guard addresses this: before resolving, the function checks whether `products[0]` is a UUID. If it is, and the `_context_grouped_ordinal` or `_context_single_ordinal` flags are present, and the current search context is larger than what the UUID resolved against, the function re-attempts resolution using the stored ordinal phrase rather than the UUID. This allows each resume cycle to re-resolve more precisely as more data becomes available.

---

## Stack and Microstate Coordination

The stack and microstate system can be active simultaneously. This happens when an intent in the stack requires confirmation — the porter marks it `_require_confirmation: true`, which opens a microstate during execution of the first intent. The stack is not cleared when a microstate opens. It remains in Redis, waiting.

When the microstate is fulfilled, the microstate runner checks for an active stack. If one exists, it performs two operations: it removes the fulfilled intent from `remaining_intents` (matching by intent name and, where intents are duplicated, by `product_name` as a discriminator), and it returns `stack_active: true` in its result so `server.js` knows to continue the stack loop.

This coordination ensures that a confirmation gate — which is inherently a one-turn pause — does not break the sequential execution of a larger intent chain.

---

## TTL Management

The stack's 5-minute TTL mirrors the microstate TTL exactly. This alignment is intentional: if a microstate opens within a stack execution, both will expire at roughly the same time if the user abandons the conversation. When the stack expires, `resumeIntentStack()` detects this through the `expires_at` field, clears the stack from Redis, and returns null. The server treats a null resume as a natural end to the multi-intent flow and does not attempt further execution. Pending intents are simply abandoned.

The stack can also be cleared explicitly by the application layer — for example, when the user sends a clearly unrelated new message that triggers a breakthrough from a microstate sandbox, or when the user invokes a `__flow:cancel__` token.

---

*Next: Chapter 20 — Microstates: Conversational Slot-Filling*
