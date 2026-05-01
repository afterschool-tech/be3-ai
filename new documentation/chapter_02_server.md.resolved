# Chapter 2 — Entry Point: `server.js` & the `/chat` Endpoint

## Overview

`src/core/server.js` is the HTTP layer of `be3_ai`. It is an Express.js application that:
1. Accepts messages from chat clients.
2. Routes them through the pipeline or short-circuits them when appropriate.
3. Aggregates tool results.
4. Calls the personality layer for a human-sounding reply.
5. Assembles and returns the final JSON response.

It runs on port `3005` by default (`PORT` env var).

---

## Startup Sequence

On start, the server first attempts to connect to Redis:

```js
redisClient.initRedis().then(() => {
    app.listen(PORT, () => console.log(`🤖 Be3 AI on port ${PORT}`));
}).catch(err => {
    // Graceful degradation: start anyway, use in-memory state
    app.listen(PORT, () => console.log(`🤖 Be3 AI (Fallback) on port ${PORT}`));
});
```

**Key point**: Redis failure does not crash the service. It falls back to an in-memory state cache. This means the bot keeps working but conversation state will not survive a server restart.

On `SIGINT` (Ctrl+C), the Redis connection is gracefully closed before process exit.

---

## HTTP Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/chat` | Main chat endpoint |
| `GET` | `/health` | Health check — returns `200 OK` |
| `GET` | `/metrics` | Performance metrics |
| `GET` | `/logs` | List all debug run IDs |
| `GET` | `/logs/:runId` | Fetch all log entries for a run |
| `DELETE` | `/logs/:runId` | Delete logs for a run |
| `DELETE` | `/logs` | Wipe ALL debug logs |
| `GET` | `/debug/state/:session_id` | Inspect current session state |
| `DELETE` | `/debug/state/:session_id` | Clear session state |

---

## The `/chat` Endpoint — Complete Flow

### Request Shape

```json
{
  "message": "show me iphone and add the first one",
  "session_id": "whatsapp_+2348012345678",
  "image": "<base64_string_optional>"
}
```

`session_id` is the anchor for all state. Every call with the same `session_id` is part of the same conversation.

---

### Step 1 — System Commands

Before any AI work begins, the server checks for debug commands typed by developers:

```
.clearcache   → stateManager.clearState() + stateManager.setLastTools([], [])
.clearcahe    → same (typo-tolerant)
.clearcart    → calls clearBackendCart() to remove all items via REST API
.clearall     → both of the above combined
```

These are hard-coded strings compared with `.trim().toLowerCase()`. They short-circuit the entire pipeline and return immediately.

---

### Step 2 — Run ID & Debug Tracing

```js
const runId = `req_${Date.now()}`;
startRun(runId);
```

Every request gets a unique `runId`. This is registered with the `debugLogger` so all `logDebug()` calls within this request are grouped under the same run ID. Later, you can retrieve all logs for this specific request via `GET /logs/:runId`.

---

### Step 3 — Feature Gate Check

```js
if (shouldUseToolSystem(session_id)) { ... }
```

`shouldUseToolSystem()` is a feature flag check from `featureFlags.js`. When it returns `true` (which it does for all real traffic), the full deterministic tool pipeline runs. When `false`, it falls back to the legacy `classifyIntent()` → `executeIntent()` → `generateResponse()` chain (which predates the hierarchical pipeline and is preserved as a safety net).

---

### Step 4 — Load State

```js
const state = await stateManager.getState(session_id);
const previousToolHistory = await stateManager.getLastTools(session_id);
```

The full session state is loaded from Redis (or memory cache). See Chapter 1 for the complete state shape and Chapter 3 for state management internals.

`previousToolHistory` is the tool results from the **previous request** — kept in state to give the personality layer full context across multi-turn flows (e.g., if a microstate spans two messages).

---

### Step 5 — Add User Message to History

```js
await stateManager.addMessage(session_id, 'user', message || '[Image Search]');
```

The user's raw message is appended to `conversation_history` immediately. If it is a visual search (no text), the placeholder `[Image Search]` is stored.

---

### Step 6 — Visual Search Short-Circuit

```js
const isVisualSearch = !!req.body.image;
if (isVisualSearch) {
    selection = { intent: 'product_search', confidence: 1.0, tools: [] };
    forceVisualSearchTool = {
        tool: 'product.search',
        params: { image: req.body.image, search_mode: 'IMAGE', limit: 5 },
        reason: 'User sent an image for visual search'
    };
}
```

When the request body includes a `base64` image, the NLU pipeline is bypassed entirely. The server directly constructs a `product.search` tool call with `search_mode: 'IMAGE'`. The Transformer is never called. IntelliSense is never called. The image is passed as-is to the `product.search` tool, which forwards it to the backend API.

---

### Step 7 — Deterministic Resolution

For text messages (non-visual), the pipeline kicks off:

```js
selection = await resolveDeterministic(message, state);
```

This is the entry point into the full NLU pipeline. `resolveDeterministic()` is a thin wrapper (in `deterministicResolver.js`) that calls `resolveAndMap()` in `intentResolver/index.js`. It returns:

```js
{
  intent: "add_to_cart",      // primary intent name
  confidence: 0.92,
  tools: [                    // ordered tool call sequence
    { tool: "product.search", params: { query: "iphone", limit: 5 }, reason: "..." },
    { tool: "cart.add",       params: { product_id: "one" },         reason: "..." }
  ],
  intents: [ ... ],           // all resolved intent objects (for DCO)
  corrections: { original: "...", resolved: "..." }
}
```

See Chapters 5–18 for every step inside `resolveAndMap()`.

---

### Step 8 — Contextual Checkout Injection

A small piece of business logic runs before tool execution:

```js
const isCheckoutIntent = intent === 'start_checkout' || ...;
const isCartEmpty = !state.cart?.items?.length;
const currentlyViewing = state.product_context?.currently_viewing;

if (isCheckoutIntent && isCartEmpty && currentlyViewing) {
    toolsSelected.unshift({
        tool: 'cart.add',
        params: { product_id: currentlyViewing, quantity: 1 },
        reason: 'Contextual checkout recovery'
    });
}
```

**What this solves**: A user views a product details page, then says "checkout". The cart is technically empty (they never explicitly said "add to cart"), but their intent is clearly to buy what they're looking at. This logic preemptively inserts a `cart.add` before the checkout tool so the flow works naturally.

---

### Step 9 — Prune State & Set Intent

```js
await stateManager.pruneState(session_id, intent);
await stateManager.setCurrentIntent(session_id, intent);
```

`pruneState()` clears stale context from previous topics. For example, if the user searched for "phones" in a prior turn but now says "show me shoes", the `reference_map` and `ordinal_list` from the phone search are cleared so "the first one" now refers to shoes, not phones.

`setCurrentIntent()` stamps the resolved intent into state for diagnostic visibility.

---

### Step 10 — Tool Execution

```js
toolResults = await executeTools(toolsSelected, session_id);
```

The `Orchestrator` (`orchestrator.js`) runs the tool sequence. Each tool calls the backend REST API, updates state, and returns a result object. See Chapter 21 for the Orchestrator's full logic.

---

### Step 11 — Image Injection

```js
await injectImages(toolResults, stateManager);
```

Product images are **stripped from state** to save storage. But they need to be present in the response. `injectImages()` re-attaches cached image URLs to tool results from a separate image cache before the response is assembled.

---

### Step 12 — Search Context Snapshotting

After `product.search` runs, its search context (product IDs, query, category) is snapshotted into the Stack:

```js
const ranProductSearch = toolResults.some(tr => tr.tool === 'product.search' && tr.success);
if (ranProductSearch) {
    const sCtx = await stateManager.getSearchContext(session_id);
    s.last_search_context = sCtx;
    s.search_history.push({ ts, intent, query, category_id, ... });
    await stateManager.setStack(session_id, s);
}
```

This snapshot is used by the Stack's ordinal re-resolver (`reResolveOrdinalsForRemainingIntents`) so that deferred intents (e.g., `add_to_cart` that runs later) can still resolve "the first one" from the correct product list.

---

### Step 13 — Stack Continuation

After the first intent's tools run, any remaining intents from a multi-intent message are executed sequentially from the Stack:

```js
while (stackData?.remaining_intents?.length > 0) {
    // 1. Check if a microstate was triggered — if so, pause
    const activeMicrostateInLoop = await stateManager.getMicrostate(session_id);
    if (activeMicrostateInLoop) { pausedForMicrostate = true; break; }

    // 2. Re-resolve ordinals before each intent
    await stack.reResolveOrdinalsForRemainingIntents(...);

    // 3. Check if next intent needs a microstate
    const triggered = microstateRegistry.checkTriggers(nextIntent.intentName, ...);
    if (triggered) { /* open microstate, pause */ break; }

    // 4. Map and execute
    const nextTools = toolMapper.mapToTools([nextIntent]);
    const nextToolResults = await executeTools(nextTools, session_id);
    toolResults.push(...nextToolResults);

    // 5. Advance stack pointer
    stackData.remaining_intents = stackData.remaining_intents.slice(1);
}
```

**Why the loop can pause**:
- A microstate needs a full turn to collect user input. It cannot be started and resolved in the same turn it was opened.
- When a microstate is opened, the remaining stack intents stay queued and will resume on the next user message after the microstate is resolved.

See Chapter 19 for the full Stack architecture.

---

### Step 14 — Consolidate Tool Results

```js
consolidatedToolResults = [...previousToolHistory, ...toolResults];
await injectImages(consolidatedToolResults, stateManager); // stack-aware re-injection
```

`previousToolHistory` (from the prior turn) is merged with the current turn's results. This gives the personality layer full context — for example, when a microstate spans two turns, the product search result from turn 1 is still visible when generating the response on turn 2.

Image injection runs again on the consolidated results to catch images from prior-turn tool results.

---

### Step 15 — Direct Response Check

```js
const directResponseResult = toolResults.find(tr =>
    tr.result?.directResponse === true && tr.result?.message
);
```

**Microstate tools** (`microstate.confirm`, `microstate.collect`, `microstate.disambiguate`) return `directResponse: true`. This signals that the tool's message should be sent directly to the user **without going through the personality layer**. This is how the microstate's structured prompt question (e.g., "Which product would you like to add?") is sent exactly as written, not rephrased by the LLM.

---

### Step 16 — Product Sentinel

When no `directResponse` is present, before invoking the personality layer, the Sentinel runs on search results:

```js
for (const tr of consolidatedToolResults where tool === 'product.search') {
    const verdict = await evaluateProductRelevance(statementText, tr.result.products, summary);
    if (!verdict.relevant && verdict.vector_query) {
        // Re-run product.search in VECTOR mode
        const sentinelResults = await executeTools([{
            tool: 'product.search',
            params: { query: verdict.vector_query, search_mode: 'VECTOR', limit: 5 }
        }], session_id);
        // Replace original search result with sentinel's result (hidden behind a button)
    }
}
```

If the Sentinel decides the returned products don't match what the user asked for, it re-runs the search using a semantic vector query and puts the results behind a "Shop these items 🛍️" button instead of showing them inline. See Chapter 23 for Sentinel internals.

Sentinel is **skipped** for:
- Visual search (`isVisualSearch = true`)
- Engineered tokens (messages starting with `__`)

---

### Step 17 — Snapshot Aggregator

When a multi-intent message produces **more than one** `product.search` result, they would normally render as separate button sets. The Aggregator merges them:

```js
if (searchResultsAgg.length > 1) {
    const megaSnapshotId = 'mega_' + Date.now().toString(36);
    // Merge all products into one snapshot
    // Give the first search a single "Shop these items 🛍️" button
    // Strip whatsapp UI from all subsequent searches
}
```

**Result**: The user sees one clean button for all multi-intent searches, instead of a confusing row of separate "See more" / "Filter" sets. See Chapter 24 for details.

---

### Step 18 — Personality Layer (Response Generation)

```js
response = await generateResponseFromTools(
    message,
    consolidatedToolResults,
    state.conversation_history,
    { intentNames: allIntentNames, conversationSummary: ..., visual_search: ... }
);
```

The DCO (Dynamic Context Orchestrator) assembles an intent-aware system prompt. Groq's `llama-3.3-70b-versatile` generates the reply. See Chapters 25–26 for full details.

---

### Step 19 — Sanitization

The AI response is cleaned before sending to the user:

```js
// Strip internal product UUIDs that leaked into the text
const idPattern = /(\*_*\s*\(ID[:\s]\s*[a-z0-9-]*\)...)/gi;
sanitizedResponse = response.replace(idPattern, '').replace(/\*\*(.*?)\*\*/g, '*$1*').trim();
```

Two specific operations:
1. **UUID stripping**: Removes any `(ID: abc-123)`, `(Item: ...)`, `(#abc...)` patterns — these are internal identifiers that sometimes bleed into LLM output.
2. **Markdown normalization**: Converts `**bold**` to `*bold*` for WhatsApp compatibility (WhatsApp uses single asterisks for bold).

Direct responses from microstates bypass sanitization — they are already structured and deterministic.

---

### Step 20 — Conversation Summary

Every 10 total messages, a background summarizer runs asynchronously (non-blocking):

```js
if (totalMessages > 0 && totalMessages % 10 === 0) {
    summarizeConversation(session_id).catch(...);
}
```

The `summarizeConversation()` function:
- Fetches the last 20 messages from history.
- Sends them to the HuggingFace model (legacy AI service, `aiService.js`) with a focused summarizer prompt.
- Stores the summary in `state.conversation_summary`.
- The summary is injected into the personality layer's DCO prompt on every subsequent turn, giving the AI long-term memory without needing to send the full history every time.

**Summarizer prompt focus**:
> Capture only: products discussed, cart actions, user preferences, sentiment, and service quality. Under 100 words.

---

### Step 21 — LLM Suggestion Extraction

The personality layer's prompt instructs the LLM to optionally embed a structured suggestion inside its response using an XML tag:

```xml
<suggestion>{"is_suggestion": true, "hint": "vendor", "rephrase": "show me other phones from Dareymi"}</suggestion>
```

The server detects and extracts this:

```js
const suggestionRegex = /<suggestion>([\s\S]*?)<\/suggestion>/i;
const match = sanitizedResponse.match(suggestionRegex);
if (match) {
    const parsed = JSON.parse(match[1].trim());
    if (parsed.is_suggestion && parsed.rephrase) {
        extractedSuggestion = { type: 'structured_payload', hint: parsed.hint, rephrase: parsed.rephrase };
        await stateManager.updateState(session_id, { last_bot_suggestion: extractedSuggestion });
        sanitizedResponse = sanitizedResponse.replace(suggestionRegex, '').trim(); // Strip from reply
    }
}
```

The XML block is **removed** from the visible reply. The suggestion is stored in `state.last_bot_suggestion`. On the next user turn, if the user replies "yes" or with an affirmative, the suggestion's `rephrase` string is used as the new query (recursively calling `resolveAndMap()`) instead of the user's literal message. This is how the bot can make contextual recommendations that take effect on user confirmation.

---

### Step 22 — WhatsApp Button Aggregation

Tools return `result.whatsapp` objects containing button payloads. Multiple tools can each contribute buttons. The server merges them into a single payload:

```js
// Priority-aware merge across all tool button contributions
// De-duplicate by id+title, keep highest priority
// Slice to top 3 (WhatsApp button limit)
const selected = Array.from(bestByKey.values())
    .sort((a, b) => b.priority - a.priority || a.order - b.order)
    .slice(0, 3)
    .map(({ id, title }) => ({ id, title }));
```

**Key rules**:
- Maximum 3 buttons per response (WhatsApp platform limit).
- De-duplication: if two tools contribute the same button ID, the higher-priority one wins.
- Microstate tool buttons are ignored when the final response is NOT a directResponse (prevents old microstate prompts from leaking into normal replies).

Helper text is added for known button types:
- `"Shop these items 🛍️"` → `"👉 Tap 'Shop These Items 🛍️' to view details and buy"`
- Cards with `"More info"` button → `"👉 Tap 'More info' to see full details or compare with related products"`

---

### Step 23 — Tool History Persistence

```js
const hasMicrostate = !!endMicrostate;
const hasStack = !!endStack?.remaining_intents?.length;
if (hasStack || hasMicrostate) {
    await stateManager.setLastTools(session_id, consolidatedToolResults.slice(-50));
} else {
    await stateManager.setLastTools(session_id, []);
}
```

Tool results are only persisted across turns when there is an **active multi-turn flow** (a microstate or remaining stack). When the flow completes, the tool history is cleared to prevent stale data from leaking into unrelated future turns. The cap of 50 items prevents unbounded memory growth.

---

### Step 24 — Final JSON Response

```json
{
  "success": true,
  "reply": "Here's what I found! ✨ ...",
  "intent": "product_search",
  "display_images": ["https://cdn.../iphone.jpg", "..."],
  "tools_used": [
    { "tool": "product.search", "params": { "query": "iphone" }, "reason": "..." }
  ],
  "results": [ /* consolidated tool results, UI payloads stripped from old turns */ ],
  "whatsapp_buttons": {
    "type": "button",
    "buttons": [
      { "id": "__nav:more__", "title": "See more 👇" },
      { "id": "__cart:add:uuid__", "title": "Add to cart 🛒" }
    ],
    "helper_text": "👉 Tap 'Shop These Items 🛍️' to view details and buy"
  },
  "whatsapp_product_cards": {
    "type": "button",
    "transaction": "product_card",
    "cards": [ /* array of product card objects */ ],
    "helper_text": "👉 Tap 'More info' to see full details..."
  }
}
```

**Important**: Stale UI payloads (buttons/cards from previous turns) are stripped from `results` for old tool entries — only the current turn's tool results carry live UI payloads. This prevents clients that render buttons directly off `results` from showing outdated buttons.

---

### Step 25 — Error Handling

The entire `/chat` handler is wrapped in a try/catch:

```js
} catch (err) {
    console.error("Chat Error:", err);
    res.status(500).json({ success: false, error: err.message });
}
```

Any unhandled exception from any stage (pipeline, tools, personality layer) results in a clean 500 JSON response. The error message is included for debugging. No partial state is left dirty — state operations are atomic via Redis.

---

## Summary Flow Diagram

```
POST /chat
    │
    ├─ System command? (.clearcache etc.) → immediate return
    │
    ├─ startRun(runId) — attach debug trace
    ├─ shouldUseToolSystem() check
    │
    ├─ Load state + previousToolHistory
    ├─ addMessage(user)
    │
    ├─ isVisualSearch? → short-circuit to product.search IMAGE
    │
    ├─ resolveDeterministic() → intent + tools
    │
    ├─ Contextual checkout injection (if empty cart + viewing product)
    ├─ pruneState() + setCurrentIntent()
    │
    ├─ executeTools() → toolResults
    ├─ injectImages()
    ├─ Snapshot search context into Stack
    │
    ├─ Stack continuation loop (remaining intents)
    │     ├─ microstate check (pause if triggered)
    │     ├─ reResolveOrdinals()
    │     └─ executeTools(nextIntent)
    │
    ├─ consolidate toolResults
    ├─ injectImages() [stack-aware]
    │
    ├─ directResponse? → use tool message as reply (skip personality)
    │
    ├─ Product Sentinel (relevance check → optional re-search)
    ├─ Snapshot Aggregator (multi-intent UI merge)
    │
    ├─ generateResponseFromTools() [Groq LLM]
    │
    ├─ Sanitize response (strip UUIDs, normalize markdown)
    ├─ addMessage(ai, sanitizedResponse)
    ├─ extendTTL()
    ├─ summarizeConversation() [every 10 msgs, async]
    │
    ├─ Extract <suggestion> block
    ├─ Aggregate WhatsApp buttons (priority merge, top 3)
    ├─ Persist tool history (if multi-turn flow active)
    │
    └─ return JSON { reply, intent, whatsapp_buttons, whatsapp_product_cards, results, ... }
```

---

*Next: Chapter 3 — State Management: Redis & Memory*
