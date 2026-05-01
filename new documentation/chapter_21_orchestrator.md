# Chapter 21 — Tool Orchestrator: Execution & Circuit Breaker

## The Boundary Between Resolution and Execution

Everything from the NLP cleaner through the tool mapper has been pure classification and translation — no API calls, no data writes, no side effects. The orchestrator is the first component that crosses into actual execution. When `executeTools()` is called, intent resolution is finished. What happens next has real consequences: products are searched, items are added to carts, orders are tracked.

This is why the orchestrator is deliberately minimal in its decision-making. It does not re-interpret, re-rank, or substitute tool calls based on results. All the intelligence that determines which tools to run lives upstream. The orchestrator is the executor, not the planner.

---

## The Context Object

Before any tool handler runs, the orchestrator builds a shared context object passed as the second argument to every handler:

```js
const context = {
    CATEGORIES,       // Full store category taxonomy
    VENDORS,          // Official store vendor registry
    ATTRIBUTES,       // Attribute metadata (codes, predefined values)
    COLLECTIONS,      // Curated product collections
    summary:          getContextSummary(),  // Compact store description for conversation tools
    sessionId:        sessionId,
    microstate_active: !!microstate,
    microstate_scope:  microstate ? 'microstate' : 'global'
};
```

The `CATEGORIES`, `VENDORS`, and `ATTRIBUTES` objects give tool handlers direct access to the store's live taxonomy without needing to re-fetch it. A `product.search` handler uses `CATEGORIES` to validate and resolve category IDs; a `conversation.chat` handler uses `summary` to know what to tell users about the store.

`microstate_active` and `microstate_scope` let handlers behave differently when a microstate is running. For example, a disambiguation tool would not open another microstate if one is already active.

If the individual tool call carries a `pipelineContext` object (set by `server.js` with per-message metadata like `statementText`), it is merged into the context immediately before that tool's handler is called:

```js
if (toolCall.pipelineContext) {
    Object.assign(context, toolCall.pipelineContext);
}
```

---

## The Unresolved Pronoun Guard (Phase 1)

Before invoking any tool, the orchestrator applies a specific guard for `cart.add` calls in multi-tool batches. If the batch contains more than one tool call and one of them is `cart.add`, the orchestrator checks whether the `product_id` param is an unresolved pronoun:

```js
function isUnresolvedPronounForAdd(value) {
    const v = value.trim().toLowerCase();
    // UUID means it's resolved → let it through
    if (UUID_REGEX.test(v)) return false;
    // "one", "ones", "first one", "the flagship one" → unresolved
    return v === 'one' || v === 'ones' ||
        /\s+(one|ones)$/.test(v) || /^(one|ones)$/.test(v);
}
```

When this fires, the `cart.add` call is skipped with a user-facing message:

```
"I found some options. Say 'add the first one' or 'add the white one'
 in your next message to add it to cart."
```

**Why this exists**: When a user says `"search for phones and add the first one to cart"` in a single message, the stack handles the sequential execution between turns. But if for any reason both tool calls end up in the same batch — the search and the add — the add would arrive at the cart API with `product_id: "first one"`, which is meaningless. The guard skips it cleanly rather than sending a bad API call.

---

## The Execution Loop

The orchestrator iterates through tool calls in order, treating the list as a sequential pipeline where each step can influence the ones that follow:

```js
for (const toolCall of toolsSelected) {
    const toolDef = TOOL_REGISTRY[toolName];

    // Missing handler → push error, continue (not a circuit breaker)
    if (!toolDef) {
        results.push({ tool: toolName, error: `Tool ${toolName} not found`, success: false });
        continue;
    }

    // Apply pronoun guard for same-turn cart adds
    if (toolName === 'cart.add' && isMultiTool) { ... }

    // Execute handler — passes accumulated results as third arg
    const result = await toolDef.handler(toolCall.params, context, results);

    results.push({
        tool:          toolName,
        params:        toolCall.params,
        result:        result,
        success:       result && !result.error,
        reason:        toolCall.reason,
        ported:        !!toolCall.portedFrom,
        portedFrom:    toolCall.portedFrom || undefined,
        statementText: toolCall.statementText || undefined
    });

    // Circuit breaker for critical tools
    if (result.error && isCritical) break;
}
```

The third argument `results` — the accumulating array — is passed to every handler. This allows later tool calls to inspect what earlier ones returned. In practice this is used sparingly, but it enables patterns like a search that informs a follow-up disambiguation tool without a round-trip through the pipeline.

---

## The Circuit Breaker

After each tool execution, the orchestrator evaluates whether to stop:

```js
const isCritical = toolName.startsWith('cart.') || toolName.startsWith('order.');

if (result.error && isCritical) {
    // STOP — do not run remaining tools
    break;
} else if (result.error) {
    // Non-critical — log and continue
}
```

**Critical tools** are anything under `cart.*` and `order.*`. If a `cart.add` fails, running the next tool in the batch is unsafe — the cart state is now uncertain, and any operation that assumes a successful add may produce wrong outcomes. The circuit breaks immediately.

**Non-critical tools** (product search, discovery, conversation) do not stop the loop on failure. A failed search is a degraded experience, not a data integrity problem. The personality layer receives the failure in the results array and handles it in the response.

**Unhandled exceptions** — handlers that throw rather than returning an error object — are caught by a try-catch wrapper. The exception is recorded as a failed result and the loop breaks unconditionally, regardless of tool criticality. An unexpected throw means the handler's internal state is unknown, so stopping is the only safe choice:

```js
try {
    const result = await toolDef.handler(toolCall.params, context, results);
    results.push({ ..., success: result && !result.error });
} catch (error) {
    results.push({ tool: toolName, error: error.message, success: false });
    break;  // Always break on exception
}
```

---

## The Results Array

The final output is an ordered array of execution result objects — one per tool call (or one per expanded product in a multi-item add). The personality layer consumes this array to construct its response. Key fields it reads:

| Field | Used for |
|---|---|
| `success` | Whether to report success or failure |
| `result` | Product lists, cart confirmations, order data |
| `reason` | The intent name that triggered this tool |
| `portedFrom` | If the intent was ported (e.g. `product_search → add_to_cart`), the personality layer frames the response differently — acknowledging the inference |
| `skipped` + `skippedMessage` | Renders a contextual suggestion instead of a result |
| `statementText` | The raw sub-statement text, for reference in multi-intent responses |

The `portedFrom` field is particularly important. A result where `portedFrom === "product_search"` tells the personality layer the user was browsing and the system inferred a purchase intent. The personality frames this differently to a direct cart command — it confirms what was done and why, rather than simply reporting a cart addition.

---

*Next: Chapter 22 — Product Sentinel: Relevance Gate*
