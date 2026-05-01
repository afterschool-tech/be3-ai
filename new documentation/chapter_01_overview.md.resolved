# Chapter 1 — System Overview & Architecture

## What Is `be3_ai`?

`be3_ai` is the **AI brain** of the Be3 e-commerce platform. It is a standalone Node.js service that sits between your chat client (e.g. WhatsApp or a web storefront) and your backend product/order API. Its job is deceptively simple: receive a free-text message from a shopper and return a structured, actionable response — in the voice of Be3's shopping personality.

Under the hood, it does something extremely sophisticated: it parses natural language, resolves ambiguous references, classifies intent across a 3-tier taxonomy, executes real backend operations (searching products, managing a cart, tracking orders), and then generates a warm, human-sounding reply — all within a single HTTP round-trip.

---

## The Ecosystem

`be3_ai` does not run alone. It is part of a three-service system:

```
[ Chat Client (WhatsApp / Storefront) ]
            │
            │  POST /chat  { message, session_id }
            ▼
    ┌─────────────────┐
    │    be3_ai       │  ← You are here
    │  (Node.js :3005)│
    └────────┬────────┘
             │
     ┌───────┼──────────────────────┐
     │       │                      │
     ▼       ▼                      ▼
[ be3_backend ]   [ be3-ai-transformer ]   [ Groq Cloud ]
 (Postgres/REST)    (Local Python LLM)      (LLaMA models)
```

### 1. `be3_backend` (REST API)
The commerce engine. Handles products, carts, orders, vendors, categories. `be3_ai` calls it via HTTP for all real data operations. Configured via `BACKEND_API_URL` and `TENANT_ID` environment variables.

### 2. `be3-ai-transformer` (Local Transformer Service)
A locally-hosted Python service (default: `http://localhost:3009`) that provides:
- **`/classify`** — Hierarchical intent classification (L1 → L2 → L3).
- **`/extract`** — Named entity extraction (categories, brands, attributes, clauses).
- **`/health`** — Availability check.

This is called the "Transformer" throughout the codebase. It runs a fine-tuned or instruction-prompted language model optimized for your specific product taxonomy. Because it runs locally, there is no API cost and latency is low (~50–200ms per call). Configured via `TRANSFORMER_URL`.

### 3. Groq Cloud (Remote LLM)
Groq is used for all **natural language generation** tasks — producing the final human-sounding reply, running the IntelliSense pre-processor, evaluating product relevance, and handling conversational fallbacks. It is accessed via the OpenAI-compatible SDK pointing to `https://api.groq.com/openai/v1`. Configured via `GROQ_API_KEY`.

There is also a legacy **HuggingFace Router** (`aiService.js`) that was the original AI provider (Qwen models). It is still wired in for specific classification tasks but the primary inference path now goes through Groq.

---

## The Two Pipeline Modes

`be3_ai` supports two pipeline modes, controlled by environment variables:

### Hierarchical Mode (`USE_HIERARCHICAL=true`, default ON)
The current production mode, introduced in the `micarch` branch. Intent classification is done in three sequential calls to the local Transformer:
1. **L1** → identify the broad class (e.g. `Discovery`).
2. **L2** → narrow to an intent group (e.g. `Cart_Management`).
3. **L3** → pick the specific sub-intent (e.g. `add_to_cart`).

This sequential narrowing dramatically reduces classification errors by eliminating irrelevant intents from consideration at each tier.

### Legacy Mode (`USE_HIERARCHICAL=false`)
The older approach where the Transformer's `/analyze` endpoint is called once with all statements, returning flat classification scores across all ~33 intents simultaneously. Still available for A/B comparison or rollback.

### IntelliSense Class Hint (`USE_INTELLISENSE_CLASS_HINT=true`, default OFF)
When enabled, the LLM-based IntelliSense pre-processor provides a coarse `class_hint` (e.g. `"Shopping_Management"`) which is used to **skip the L1 classification call** entirely, reducing the Transformer round-trips from 3 to 2 per statement.

---

## The 3-Tier Intent Taxonomy

All intent resolution in `be3_ai` is organized around a strict hierarchy defined in `src/services/intentResolver/config/taxonomy.js`:

```
L1 CLASS                   L2 INTENT                  L3 SUB-INTENT
─────────────────────────────────────────────────────────────────────
Discovery              → Product_Research          → product_search
                                                   → browse_categories
                                                   → browse_collection
                                                   → facet_list
                       → Product_Analysis          → get_product_details
                                                   → product_compare
                                                   → product_similar

Shopping_Management    → Cart_Management           → add_to_cart
                                                   → remove_from_cart
                                                   → update_cart_quantity
                                                   → view_cart
                       → Checkout_Flow             → start_checkout
                                                   → set_delivery
                                                   → confirm_order
                                                   → check_availability
                       → Post_Purchase             → order_status
                                                   → list_orders
                                                   → cancel_order

Vendor_Intelligence    → Vendor_Lookup             → list_vendors
                                                   → vendor_info
                                                   → vendor_identity
                       → Vendor_Catalog_Exploration→ vendor_products
                                                   → vendor_facet
                       → Vendor_Direct_Contact     → vendor_contact

Support_Feedback       → Assistance_Request        → get_help
                                                   → get_advice
                       → Platform_Feedback         → give_feedback
```

Two special intents — `conversation` and `end_conversation` — are handled by IntelliSense short-circuit and **do not participate** in the hierarchy.

---

## The Session State Object

Every user interaction is anchored to a **session state** object, identified by `session_id`. This state is the memory of the conversation. It is stored in Redis when available, falling back to an in-memory cache.

Here is what the full state object contains:

```js
{
  // Identity
  session_id: "whatsapp_+234...",
  user_id: "whatsapp_+234...",

  // Conversation history
  conversation_history: [
    { role: "user",      text: "show me iphone" },
    { role: "assistant", text: "Here are some iPhones I found..." }
  ],
  conversation_summary: "User browsed iPhones, added iPhone 12 Pro to cart.",

  // Intent tracking
  current_intent: "add_to_cart",
  active_flow: null,

  // Product context — the most important part for resolution
  product_context: {
    last_search: {
      results: [ /* array of product objects */ ],
      filters: { query: "iphone", category: "smartphones", page: 1 }
    },
    currently_viewing: "product-uuid-123",
    product_attributes_map: { "product-uuid-123": { name: "iPhone 12 Pro", ... } }
  },

  // Reference map — aliases → product IDs (built by product.search)
  reference_map: {
    "iphone_12_pro": "product-uuid-123",
    "the_first_one": "product-uuid-123",
    "iphone":        "product-uuid-123"
  },

  // Ordinal list — ordered product IDs from last search
  ordinal_list: ["product-uuid-123", "product-uuid-456", "product-uuid-789"],

  // Session memory — user's own language mapped to product IDs
  user_query_map: {
    "iphone": "product-uuid-123"
  },

  // Search context — facets/attributes from last search for refinement
  search_context: {
    product_ids: ["product-uuid-123", ...],
    query: "iphone",
    category_id: "cat-smartphones",
    product_attributes_map: { ... }
  },

  // Active microstate — conversational sub-routine
  microstate: {
    type: "confirm_add_ported",
    intent: "add_to_cart",
    sandbox: "hard",
    params: { product_id: "...", _require_confirmation: true, _confirm_context: { ... } },
    contract: { maxMessages: 2, messagesUsed: 0, ... }
  },

  // Cart (mirrored from backend for fast personality context)
  cart: {
    items: [ { product_id: "...", name: "iPhone 12 Pro", quantity: 1, price: 450000 } ],
    total: 450000
  },

  // Checkout state
  checkout: { delivery_address: null, payment_method: null },

  // User preferences
  preferences: { currency: "NGN", language: "en" },

  // LLM suggestion pending confirmation
  last_bot_suggestion: {
    intent: "product_search",
    rephrase: "show me other phones from that vendor",
    params: { ... }
  },

  // Metadata
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:01:30Z",
  version: 4
}
```

### Why is the state so important?
Without state, every message is treated as a fresh conversation with no memory. State enables:
- **Pronoun resolution**: "add it" → knows "it" = last viewed product.
- **Ordinal resolution**: "the first one" → knows ordinal 1 = product UUID.
- **Intent porting**: knows the user searched for iphone 2 turns ago.
- **Microstate continuity**: knows to collect a slot (e.g. delivery address) this turn.
- **Cart context**: knows what's already in the cart before deciding a response tone.

---

## Request/Response Lifecycle (High Level)

Every message goes through this sequence. Later chapters will zoom into each step.

```
User: "show me iphone and add the first one"
         │
         ▼
[1] server.js — POST /chat
    - Load state
    - Check for system commands (.clearcache etc.)
    - Check for visual search (image in body)
         │
         ▼
[2] resolveDeterministic()
    - IntelliSense LLM pre-pass (split, normalize, class_hint)
    - Check for engineered tokens (__nav:more__, __cart:add__ etc.)
    - Check for active microstate → microstateRunner
    - Resolve LLM suggestions
         │
         ▼
[3] resolveAndMap() — The Main Pipeline
    - Stage 0.5:  Transformer /extract (entity extraction)
    - Stage 3a:   Global clause/brand pre-pass
    - Per-statement loop:
        - Stage 4b: L1→L2→L3 hierarchical classification
        - Stage Gates: decide which stages to run
        - Stage 2:  Context resolver (pronouns → IDs)
        - Stage 4a: Entity extractor
        - Stage 4b: Schema resolver (IDF scoring)
        - Stage 5:  Parameter extractor
        - Stage 6:  Parameter bleeder
        - Stage 7:  Intent porter (safety gating)
        - Stage 8:  Parameter normalizer
    - Stage 9:    Tool mapper → tool call list
         │
         ▼
[4] executeTools()
    - Orchestrator runs tools in sequence
    - Phase 1 guard (same-turn ordinal skip)
    - Circuit breaker on critical failures
         │
         ▼
[5] server.js — Post-execution
    - Stack continuation (deferred intents)
    - Image injection
    - Product Sentinel (relevance check → re-search if needed)
    - Snapshot Aggregator (multi-intent UI reconciliation)
         │
         ▼
[6] generateResponseFromTools()
    - DCO assembles intent-aware personality prompt
    - Groq llama-3.3-70b-versatile generates reply
    - Sanitization
         │
         ▼
[7] Response: { reply, buttons, product_cards, images }
```

---

## Key Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3005` | HTTP server port |
| `BACKEND_API_URL` | `http://localhost:3000` | Be3 backend REST API |
| `TENANT_ID` | (hardcoded UUID) | Multi-tenant identifier |
| `TRANSFORMER_URL` | `http://localhost:3009` | Local transformer service |
| `GROQ_API_KEY` | — | Groq Cloud API key |
| `HUGGINGFACE_TOKEN` | — | HuggingFace API key (legacy) |
| `TEST_MODEL` | `llama-3.3-70b-versatile` | Override Groq model |
| `USE_HIERARCHICAL` | `true` | Enable 3-tier hierarchical pipeline |
| `USE_INTELLISENSE_CLASS_HINT` | `false` | Enable L1 bypass via IntelliSense hint |
| `DEBUG` | — | Enable debug logging |
| `DB_SOURCE` | — | `cloud` for Neon, local otherwise |
| `DATABASE_URL` | — | Neon connection string (cloud) |
| `REDIS_URL` | — | Redis URL for state persistence |

---

*Next: Chapter 2 — Entry Point: `server.js` & the `/chat` Endpoint*
