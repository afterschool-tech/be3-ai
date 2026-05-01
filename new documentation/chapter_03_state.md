# Chapter 3 — State Management: Redis & Memory

## Overview

Every user conversation in `be3_ai` is anchored to a **session state object**. This state is the bot's memory — it tracks what the user searched for, what's in their cart, which product they're viewing, which microstate is active, and much more.

State is managed by `src/state/stateManager.js` — a class-based singleton that uses a **dual-layer storage architecture**:

1. **Primary**: Redis (remote, shared, persistent across restarts).
2. **Fallback**: In-memory `Map` (local, per-process, lost on restart).

When Redis is available, it is always the source of truth. The memory cache is kept in sync as a fast fallback for when Redis is temporarily unavailable.

---

## Storage Architecture

```
stateManager.getState(userId)
    │
    ├─ Try Redis (redisClient.getState)
    │     └─ Key: be3:state:<userId>
    │
    ├─ If Redis miss → try memoryCache.get(userId)
    │
    └─ If neither → create new state (_createNewState), save everywhere
```

```
stateManager.setState(userId, state)
    │
    ├─ Strip user_query_map (volatile, never persisted to Redis)
    ├─ Save to Redis (with TTL)
    └─ Save full state (with user_query_map) to memoryCache
```

### Why `user_query_map` is volatile

`user_query_map` stores the mapping from a user's raw search terms to product IDs (e.g., `"spaghetti" → "product-uuid-123"`). It is built session-by-session from actual search results and is only relevant within the current browser/WhatsApp session. Persisting it to Redis would pollute cross-session state and create confusing references. So it lives **only in memory** and is re-built from scratch each session.

---

## TTL & Configuration

| Setting | Env Variable | Default | Description |
|---------|-------------|---------|-------------|
| Session TTL | `STATE_TTL` | 300s (5 min) | How long an inactive session lives in Redis |
| History limit | `CONVERSATION_HISTORY_LIMIT` | 20 messages | Max messages kept in `conversation_history` |
| Search Snapshot TTL | `SEARCH_SNAPSHOT_TTL` | 900s (15 min) | How long button-linked search snapshots persist |
| Ambient Topic Threshold | `AMBIENT_TOPIC_STALE_THRESHOLD` | 6 messages | How many messages before an active topic expires |

`extendTTL()` is called after every successful response to reset the session expiry timer. Active users never time out.

---

## The Full State Schema (DEFAULT_STATE)

This is the complete shape of a state object, annotated with what each field does:

```js
{
  // ── Identity ───────────────────────────────────────────────────────
  user_id:    "whatsapp_+2348012345678",  // same as session_id
  session_id: "whatsapp_+2348012345678",
  tenant_id:  "cbe1df05-...",             // from TENANT_ID env var

  // ── Intent Tracking ────────────────────────────────────────────────
  current_intent: "add_to_cart",          // last resolved intent name
  active_flow:    null,                   // DEPRECATED (use microstate)
  expecting_input: null,                  // DEPRECATED (use microstate)

  // ── Conversation Memory ────────────────────────────────────────────
  conversation_history: [
    { role: "user",      text: "show me iphone", timestamp: "..." },
    { role: "assistant", text: "Here are...",     timestamp: "..." }
  ],
  // Max 20 entries (trimmed from oldest). Always trimmed from the front.
  conversation_summary: "User browsed iPhones, added iPhone 12 Pro, prefers mid-range.",
  // Injected into DCO every turn. Updated every 10 messages by background summarizer.

  // ── Product Context ────────────────────────────────────────────────
  product_context: {
    currently_viewing: "product-uuid-123",  // set when product.getDetails runs
    last_search: {
      results: [ /* array of product objects from last product.search */ ],
      filters: { query: "iphone", category: "smartphones", page: 1 }
    },
    comparison_set: [],       // products currently being compared
    recently_viewed: []       // history of viewed product IDs
  },

  // ── Resolution Maps ────────────────────────────────────────────────
  reference_map: {
    // Built by product.search: maps aliases → product IDs
    "iphone_12_pro": "product-uuid-123",
    "iphone":        "product-uuid-123",
    "the_first_one": "product-uuid-123",   // ordinal aliases
    "first":         "product-uuid-123"
  },

  ordinal_list: [
    // Product IDs in display order from last search
    "product-uuid-123",  // index 0 → "the first one" / "option 1"
    "product-uuid-456",  // index 1 → "the second one"
    "product-uuid-789"   // index 2 → "the third one"
  ],

  user_query_map: {
    // VOLATILE (memory-only): user's raw query terms → product IDs
    // Single product: "spaghetti" → "product-uuid-123"
    // Multiple matches: "pasta" → "product-uuid-1,product-uuid-2"
    "spaghetti": "product-uuid-123"
  },

  // ── Search Context (TTL-based) ──────────────────────────────────────
  search_context: {
    // Semantic snapshot of the last search. Expires after ttl_messages turns.
    category: "smartphones",
    category_id: "cat-smartphones",
    vendor: null,
    vendor_id: null,
    clauses: ["apple_product"],          // active attribute clauses
    attributes: { brand: "Apple" },      // active attribute filters
    product_ids: ["uuid-1", "uuid-2"],   // up to 10
    product_attributes_map: {
      "uuid-1": { brand: "Apple", color: "black", storage: "128GB" }
    },
    result_count: 12,
    query: "iphone",
    source_intent: "product_search",
    created_at: "...",
    ttl_messages: 5   // decremented each turn; cleared when 0
  },

  // ── Cart ────────────────────────────────────────────────────────────
  cart: {
    id: "cart-uuid-abc",
    item_count: 2,
    total: 900000,       // in NGN kobo or base currency unit
    last_modified: "..."
  },

  // ── Checkout ────────────────────────────────────────────────────────
  checkout: {
    stage: "address",
    address: null,
    delivery_option: null,
    payment_method: null
  },

  // ── User Preferences (learned over time) ───────────────────────────
  preferences: {
    price_range: { min: null, max: null },
    favorite_brands: ["Apple"],
    favorite_categories: ["smartphones"],
    abandoned_items: [
      { id: "...", name: "iPhone 13", price: 600000, abandoned_at: "..." }
    ],
    language: "en"
  },

  // ── Session Metadata ───────────────────────────────────────────────
  session: {
    started_at: "...",
    last_activity: "...",
    message_count: 14,       // total messages (user + assistant) — used for summarizer trigger
    search_refinement_count: 3,
    is_active: true,
    platform: "whatsapp"
  },

  // ── Active Microstate ──────────────────────────────────────────────
  microstate: {
    id: "ms_1714000000000",
    type: "confirm_add_ported",
    intent: "add_to_cart",
    sandbox: "hard",         // "hard" = owns turn, "soft" = can be interrupted
    boostScore: 10.0,
    params: { product_id: "...", _require_confirmation: true },
    entities: [],
    options: [],             // product/option list for disambiguate prompts
    features: ["show_captured"],
    controls: {},
    contract: {
      maxMessages: 2,
      messagesUsed: 1,
      onFulfilled: ["confirmation"],
      onKeyword: ["no", "cancel", "nevermind"],
      escalation: null,
      onFulfilledSpawn: null
    },
    confidence: 0.7,         // decays by 0.3 per off-topic turn
    created_at: "...",
    expires_at: "..."        // hard TTL expiry
  },

  // ── Suggestions ─────────────────────────────────────────────────────
  last_bot_suggestion: {
    type: "structured_payload",
    hint: "vendor",
    rephrase: "show me other phones from Dareymi"
    // Cleared at start of next turn (lives exactly one turn)
  },

  // ── Tool History ────────────────────────────────────────────────────
  last_tools: [
    /* Array of tool result objects from previous turn(s) */
    /* Populated only during active multi-turn flows (stack/microstate) */
    /* Capped at 50 entries. Cleared when all flows complete. */
  ],

  // ── Ambient Topic ───────────────────────────────────────────────────
  active_topic: {
    // Set by tool handlers after execution. Stale after 6 messages.
    type: "product_search",
    category_id: "cat-smartphones",
    category_label: "Smartphones",
    vendor: null,
    product_id: null,
    product_name: null,
    product_ids: ["uuid-1", "uuid-2"],
    attributes: { brand: "Apple" },
    set_at_message: 8,
    reinforced_at_message: 10
  },

  // ── Other ────────────────────────────────────────────────────────────
  paused_context: null,   // Stores context when user goes off-topic mid-transaction

  // ── Timestamps & Version ─────────────────────────────────────────────
  created_at: "...",
  updated_at: "...",
  version: 1
}
```

---

## Key State Manager Methods

### Core CRUD

| Method | What it does |
|--------|-------------|
| `getState(userId)` | Load full state. Creates new state if none exists. |
| `setState(userId, state, ttl?)` | Save full state. Strips `user_query_map` before Redis write. |
| `updateState(userId, updates)` | Partial update: merge `updates` into existing state. |
| `clearState(userId)` | Delete from Redis AND memory cache. |
| `extendTTL(userId, seconds?)` | Bump session TTL. Called after every response. |

### Conversation

| Method | What it does |
|--------|-------------|
| `addMessage(userId, role, text, intent?)` | Append to `conversation_history`. Trim to `historyLimit`. Increment `message_count`. |
| `getConversationHistory(userId, limit?)` | Return last N messages. |
| `updateConversationSummary(userId, summary)` | Store new conversation summary. |
| `pruneState(userId, intent)` | For category shifts: clear `currently_viewing`. |

### Microstate Lifecycle

The full lifecycle of a microstate is: **Open → Advance (N times) → Clear**

```
setMicrostate()     → opens the sandbox, sets contract
    │
    ▼
advanceMicrostate() → merges new params, increments messagesUsed, decays confidence
    │              (called each turn while microstate is active)
    ▼
clearMicrostate()   → sets state.microstate = null (sandbox closed)
```

#### `setMicrostate(userId, microstateObj, ttlSeconds?)`
Opens the microstate. Attaches a unique `ms_<timestamp>` ID. Sets `expires_at` for hard TTL expiry.

#### `getMicrostate(userId)`
Returns the active microstate or `null` if:
- No microstate exists.
- `expires_at` has passed (hard TTL).
- `contract.messagesUsed >= contract.maxMessages`.
- `confidence <= 0`.

#### `advanceMicrostate(userId, newParams, advanced?, isNavigation?)`
- **Merges** `newParams` into `microstate.params`.
- **Multi-field**: If the microstate has `fields[]`, advances `currentFieldIndex` when the current field's value is now set.
- **Contract**: Increments `messagesUsed`. If the message did NOT advance the microstate (user said something off-topic), decays `confidence` by 0.3.
- **Navigation flag**: `isNavigation = true` skips contract penalties (used for `__nav:more__` inside a microstate).

#### `clearMicrostate(userId)`
Sets `state.microstate = null`. Logs `🔓 Microstate CLEARED`.

---

### Stack Management

The Stack holds deferred intents for multi-intent messages.

```js
state.stack = {
    remaining_intents: [ /* intent objects not yet executed */ ],
    current_intent_index: 2,
    executed_intents: [ /* already executed */ ],
    accumulated_results: [],
    created_at: "...",
    expires_at: "..."   // 5-minute TTL
}
```

| Method | What it does |
|--------|-------------|
| `setStack(userId, stackObj)` | Create or replace the stack. |
| `getStack(userId)` | Return stack or `null` if expired. |
| `clearStack(userId)` | Remove the stack from state. |

---

### Search Context (TTL-Based)

The search context is a **semantic snapshot** of the most recent search — capturing which products were returned, their attributes, and which filters were active. It is used by the context resolver and intent porter to resolve references like "the blue one" or "add it".

```js
state.search_context = {
    category, category_id,
    vendor, vendor_id,
    clauses: ["apple_product"],
    attributes: { brand: "Apple" },
    product_ids: ["uuid-1", ...],
    product_attributes_map: { "uuid-1": { brand: "Apple", color: "black" } },
    result_count: 12,
    query: "iphone",
    source_intent: "product_search",
    ttl_messages: 5  // ← counts down each turn
}
```

| Method | What it does |
|--------|-------------|
| `setSearchContext(userId, context)` | Write a new snapshot. Caps `product_ids` at 10. |
| `getSearchContext(userId)` | Return snapshot. Returns `null` if `ttl_messages <= 0`. |
| `decrementSearchContextTTL(userId)` | Called each turn. Decrements TTL. Clears if hits 0. |
| `clearSearchContext(userId)` | Immediately expire the snapshot. |

---

### Search Snapshots (Button-Linked)

Search snapshots are a separate storage mechanism from `search_context`. They are created when a search result is hidden behind a button (e.g., "Shop these items 🛍️") and the user must click the button to reveal the products.

```
Key: be3:search_snapshot:<userId>:<snapshotId>
TTL: 15 minutes (configurable via SEARCH_SNAPSHOT_TTL)
```

The `snapshotId` is embedded in the engineered button token: `__nav:cards:<snapshotId>__`. When the user taps the button, the server looks up the snapshot to know which search filters to replay.

Snapshots are stored in Redis when available, with a separate in-memory `searchSnapshotCache` as fallback.

---

### Ambient Topic

The "ambient topic" is the bot's sense of what conversation topic is currently active. It is set by tool handlers (e.g., `product.search` sets `type: "product_search"` with category and vendor context).

Unlike `search_context` which is TTL-based on message count, the ambient topic expires based on **message gap**: if 6 or more messages have passed since the topic was last reinforced, it is considered stale and auto-cleared.

`reinforceActiveTopic()` is called by handlers that confirm the topic is still relevant without changing it (e.g., a follow-up search in the same category).

---

### Product Context

```js
await stateManager.updateProductContext(userId, {
    currently_viewing: "product-uuid-123",
    last_search: { results: [...], filters: { query: "iphone" } }
});
```

`currently_viewing` is the most recently `product.getDetails`-viewed product. This is the source for the Contextual Checkout Injection (Chapter 2) — when the user says "checkout" with an empty cart but is actively viewing a product.

---

## Redis Key Patterns

| Key Pattern | Purpose |
|-------------|---------|
| `be3:state:<userId>` | Full session state |
| `be3:search_snapshot:<userId>:<snapshotId>` | Button-linked search snapshot |
| `be3:debug:<runId>` | Debug log for a pipeline run |
| `be3:debug:index` | Master list of all run IDs |

---

## Graceful Degradation Summary

| Scenario | Behaviour |
|----------|-----------|
| Redis connection fails on startup | App starts anyway, uses memory cache |
| Redis read fails mid-session | Falls back to memory cache |
| Redis write fails | Saves to memory cache; returns `false` (non-fatal) |
| Both Redis and memory miss | Creates fresh state (conversation resets) |
| Microstate TTL expires | `getMicrostate()` returns `null`; microstate silently cleared |
| Stack TTL expires | `getStack()` returns `null`; stack silently dropped |
| Search context TTL=0 | Auto-cleared; next message starts fresh |

---

*Next: Chapter 4 — Engineered Tokens: The UI Button Layer*
