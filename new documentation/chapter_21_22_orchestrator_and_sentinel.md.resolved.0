# Chapter 21 — Tool Orchestrator: Execution & Circuit Breaker

## The Boundary Between Resolution and Execution

Everything from the NLP cleaner through the tool mapper has been pure classification and translation work — no API calls, no data writes, no side effects. The orchestrator is the first component that crosses the boundary into actual execution. When `executeTools()` is called, the intent resolution is over. What happens next has real consequences: products are searched, items are added to carts, orders are tracked.

This is why the orchestrator is deliberately minimal in its decision-making. It does not re-interpret the tool calls it receives. It does not re-rank them, re-order them, or substitute one for another based on results. Its job is to execute the tool calls exactly as given, in the order given, and to handle failures in a principled way. All the intelligence that determines which tools to run and in what form lives upstream. The orchestrator is the executor, not the planner.

---

## The Context Object

Before any tool executes, the orchestrator builds a shared context object that every tool handler receives as its second argument. This context carries:

- The full store taxonomy: `CATEGORIES`, `VENDORS`, `ATTRIBUTES`, `COLLECTIONS` — loaded once from the in-memory store context module. Tool handlers use these to validate inputs, resolve IDs to labels, and scope their API queries to the correct store configuration.
- A `summary` from `getContextSummary()` — a compact text description of the store's active configuration, used by conversation tools that need to know what the store sells.
- The `sessionId` — passed through to every tool so handlers can read and write to session state (reference maps, search context, cart state) without needing the user ID as a separate parameter.
- `microstate_active` and `microstate_scope` — flags indicating whether a microstate was open at the moment of execution. Some tool handlers behave differently when a microstate is active — for example, a disambiguation tool would not open another microstate if one is already running.

The context is constructed fresh for each call to `executeTools()`, using the current snapshot of store state. If a `pipelineContext` object was attached to an individual tool call (set by `server.js` to carry per-message flags like `statementText`), it is merged into the shared context object before that tool's handler is called.

---

## The Unresolved Pronoun Guard (Phase 1)

Before invoking any tool handler, the orchestrator applies a specific guard for `cart.add` calls in multi-tool scenarios. If the current execution contains more than one tool call (meaning the pipeline produced multiple intents from one message), and one of those calls is `cart.add`, the orchestrator inspects the `product_id` parameter.

If `product_id` is the string `"one"`, `"ones"`, or any phrase ending in `" one"` or `" ones"` — and is not a UUID — the cart.add call is skipped with a `skippedReason: "unresolved_pronoun_same_turn"`. In its place, a result entry is pushed with a human-readable `skippedMessage` that explains what happened and tells the user how to complete the action on their next turn.

The reason this guard exists: when a user says `"search for phones and add the first one to cart"` as a single message, the full pipeline runs before any search has executed. The ordinal `"the first one"` cannot be resolved to a product UUID at extraction time because no search results exist yet. The stack system handles this for sequential execution across turns. But in a same-turn multi-tool scenario — where both the search and the add are fired together — the add call would arrive at the cart API with `product_id: "first one"` which is meaningless. Rather than send a bad API call, the orchestrator skips it and instructs the user to make the reference explicit on their next turn, by which time the search results will be in the session context.

---

## The Execution Loop

The orchestrator iterates over the tool calls in order. For each call:

1. It looks up the tool name in `TOOL_REGISTRY`. If no handler is registered for that name, it pushes an error result and moves to the next call. Missing tool names do not stop the loop.
2. It applies the unresolved pronoun guard if applicable.
3. It calls `toolDef.handler(params, context, results)` — passing the translated params, the shared context, and the **accumulated results so far**. The third argument allows later tools to see what earlier tools returned. A `product.search` that runs first might populate data that a subsequent `cart.add` needs to reference, though this is the exception rather than the rule.
4. It pushes an execution result object containing: the tool name, the params that were passed, the raw result from the handler, a `success` flag (true if the result has no `error` field), the `reason` (intent name), `ported` and `portedFrom` flags, and `statementText`.

---

## The Circuit Breaker

After each tool execution, the orchestrator checks whether the result contains an error and whether the tool is "critical". Critical tools are those in the `cart.*` and `order.*` namespaces. Any failure in these categories immediately breaks the loop — no further tools in the current batch are executed.

This is the circuit breaker pattern. The rationale is straightforward: if adding a product to the cart fails, continuing to process remaining tool calls that may depend on that cart state (for example, a second `cart.add` for a different product, or an `order.place`) would produce undefined behaviour. Better to surface the failure cleanly and let the user address it, rather than partially executing a financial operation.

Non-critical tools — product searches, discovery queries, conversation responses — do not trigger the circuit breaker on failure. A failed product search might mean the backend is temporarily unavailable or the query returned no results; this does not warrant stopping the entire batch. The error is logged and execution continues to the next tool.

Unhandled exceptions (tool handlers that throw rather than returning an error object) are caught by a try-catch wrapper around each tool execution. The caught exception is pushed as a failed result and the loop breaks — exceptions are treated as critical failures regardless of the tool namespace. This is the most conservative path: if a tool throws unexpectedly, the integrity of the session state is unknown, so no further tools should run.

---

## The Results Array

The final output of `executeTools()` is an ordered array of execution result objects, one per tool call (or one per expanded item in a multi-product add, since expansion produces multiple calls from one intent). Each object in this array is available to the personality layer, which uses it to understand what happened — which searches returned results, which cart actions succeeded, which tools were skipped — and to construct an appropriate natural language response.

The `portedFrom` field in each result is particularly important to the personality layer. A tool result where `portedFrom === "product_search"` tells the personality layer that the user originally appeared to be searching and the system inferred a purchase intent. The personality layer uses this to frame its response differently — acknowledging the inference and confirming what was done, rather than simply reporting a cart addition as if the user had explicitly requested it.

---

---

# Chapter 22 — Product Sentinel: Relevance Gate

## The Problem with Keyword Search

Keyword search is deterministic and fast, but it can produce results that are technically a match by token overlap while being semantically wrong. A user asking for `"gaming phones"` might get gaming chairs if the store's search engine indexes categories imprecisely. A user asking for `"wireless earbuds"` might get noise-cancelling headphones that have `"wireless"` in their description but are a completely different product class.

The pipeline's entity extractor and parameter normaliser work hard to ensure the right category, brand, and attribute filters are sent to the search API. But the search API is a separate service with its own indexing logic, and the pipeline cannot control how it interprets the query. The results it returns may or may not match what the user actually wants.

The Product Sentinel is the quality gate that catches this. It runs after the search tool has returned its results and before the personality layer formulates a response. Its job is to evaluate whether the returned products genuinely address the user's intent, and if not, to trigger a smarter re-search using vector semantics rather than keyword matching.

---

## Architecture: A Cheap LLM Call as a Guard

The sentinel uses a small, fast language model — `llama-3.1-8b-instant` via the Groq inference API — with a maximum response of 60 tokens and a temperature of 0.1. This is an intentionally cheap call. The model is not being asked to generate a response or explain its reasoning; it is being asked to output one of two JSON structures: `{"relevant": true}` or `{"relevant": false, "vector_query": "..."}`. The 60-token ceiling ensures the call is fast and economical.

The sentinel only activates when there are products to evaluate. Empty result sets return `relevant: true` immediately — if nothing was returned, there is nothing to judge as irrelevant, and the personality layer will handle the empty state on its own terms.

---

## The Relevance Prompt: Carefully Scoped Rules

The system prompt given to the sentinel defines four relevance rules and four irrelevance rules, plus one absolute vetting rule that overrides everything else.

**What counts as relevant**: A broad match where the category is correct even if the exact model is not. Model variations and spec suffixes — `"iPhone 16"` vs `"iPhone 16 Pro Max"` — are relevant if the product type is right. Any product from the requested brand is relevant for brand queries. Even partial matches count: if at least one or two items in the result set correctly match the request, the whole set is marked relevant.

**What counts as irrelevant**: A category mismatch where the result set is entirely the wrong product type. Complete zero-match where no words or meaning in the product names relate to the query. Generic placeholder or clearly unrelated product types.

**The absolute vetting rule**: If the returned products already contain the exact brand and model the user mentioned, the sentinel must mark them relevant regardless of any other signals. This prevents the sentinel from second-guessing precise, resolved searches. It also instructs the model not to suggest the same query it received as the `vector_query` — if it cannot think of a meaningfully different search phrase, it must return `relevant: true` rather than triggering an identical re-search loop.

---

## The `vector_query` and What Happens With It

When the sentinel returns `{"relevant": false, "vector_query": "gaming smartphones"}`, the personality layer receives this alongside the original (irrelevant) results. The `vector_query` is used to trigger a re-search using a vector similarity approach rather than keyword matching — passing it to a semantic search endpoint that retrieves results based on meaning rather than token overlap.

The `vector_query` the sentinel generates is typically a reformulated, more semantically precise version of what the user was asking for. Where the original query might have been `"gaming phone"` filtered by a `gaming` category that the backend misinterpreted, the vector query might be `"high performance smartphone for gaming"` — a phrase that the vector model can embed and match against product descriptions semantically.

---

## Fail-Open Design

If the sentinel's LLM call fails — due to network issues, parse errors, or the model returning malformed JSON — the function returns `{ relevant: true }` and logs the error. This is a deliberately fail-open design. The sentinel is a quality improvement layer, not a hard requirement. If it cannot evaluate, the pipeline continues as if the results are relevant and the personality layer generates a response from whatever the search returned. This is always preferable to blocking the user's query on a sentinel failure.

The sentinel is currently gated by a hardcoded `ENABLE_SENTINEL = true` flag. The architecture comment notes that this will eventually be driven by the pipeline confidence scoring system — activating only when the pipeline's own confidence metrics suggest the search quality may be low (high fallback count, low semantic similarity score, poor entity detection confidence). This would make the sentinel cost-proportional: expensive queries that are confidently resolved skip the gate, while uncertain queries pay the additional 60-token cost for the safety check.

---

*Next: Chapter 23 — Personality Layer*
