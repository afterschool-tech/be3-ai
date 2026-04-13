# Hierarchical Intent Resolution — Full Design Document

> **Status**: Design Refinement (Pre-Implementation)
> **Date**: 2026-04-13
> **Scope**: be3_ai Intent Resolver Pipeline — Architectural Redesign

---

## 1. Executive Summary

The current intent resolution pipeline uses a **flat classification model**: all 31 intents compete in a single scoring pool. Every message runs through ~12 pipeline stages regardless of complexity. The transformer embeds all intent variations into one large knowledge base and classifies against all of them in a single batch call that frequently times out.

The proposed architecture replaces this with a **hierarchical narrowing model**:

```
CLASS → INTENT → SUB-INTENT
```

Classification happens in **3 sequential levels**, each against a small, focused embedding space. Pipeline stages become **conditional** — only stages relevant to the resolved intent actually execute. This reduces latency, improves classification accuracy, and eliminates timeout issues.

---

## 2. Current Architecture

### 2.1 Classification Flow (Current)

```
Message
  │
  ├─ IntelliSense (LLM call)
  │    → Multi-statement splitting
  │    → Product name extraction
  │    → Pronoun skip detection (skip_resolve)
  │    → Conversational short-circuit (if confident)
  │
  ├─ Preprocessor
  │    → Text normalization, negation detection, conjunction splitting
  │    → Uses IntelliSense statements if available, else deterministic
  │
  ├─ Transformer (single batch /analyze call against FULL knowledge base)
  │    → Intent classification: scores ALL 31 intents simultaneously
  │    → Entity extraction: categories, vendors, clauses, attributes
  │    → Returns: semanticContext (consumed by all downstream stages)
  │
  └─ For each statement:
       ├─ Stage 4a: Entity Extraction (lexical N-gram scan)
       ├─ Stage 4b: Schema Resolution (deterministic keyword/slot scoring)
       ├─ Stage 4.5: Semantic Integration (merge transformer + deterministic)
       ├─ Stage 5: Parameter Extraction (PIE + slot filling)
       ├─ Stage 4c: Context Reconciliation
       ├─ Stage 7.5: Intent Porting
       ├─ Stage 6: Parameter Bleeding
       ├─ Stage 6.5: Parameter Normalization
       ├─ Stage 7: Inventory Check + Parental Pivot
       ├─ Stage 8a: Search Context (read/write)
       ├─ Stage 8b: Tool Mapping
       └─ Stage 10: Microstate Trigger Check
```

### 2.2 Problems with Current Architecture

| Problem | Description |
|---|---|
| **Timeout-prone batch call** | The transformer embeds all intent variations into one large knowledge base. A single `/analyze` call classifies + extracts entities for all statements. This frequently times out under load. |
| **Flat competition** | All 31 intents compete in one pool. "show me phones" scores against `product_search`, `vendor_products`, `browse_categories`, and `get_product_details` simultaneously. False positives are common. |
| **Every stage runs for every message** | "view cart" runs through entity extraction, category detection, PIE, schema resolution, etc. — all unnecessary for a simple lookup intent. |
| **Double normalizeCategory** | `normalizeCategory` runs in Stage 4a (entity extraction) and Stage 10 (add_to_cart microstate trigger). Redundant processing. |
| **Monolithic knowledge base** | One large embedding space means more noise, more false matches, and more computation per classification. |

---

## 3. Proposed Architecture

### 3.1 Core Principle

**Hierarchical narrowing**: Classify at each tier, then narrow the search space before classifying the next tier. Each classification step operates against a **small, focused embedding space** containing only peer-level candidates.

```
Level 1: CLASS          — 6 candidates    (e.g., Discovery vs Shopping Management)
Level 2: INTENT         — 2-5 candidates  (e.g., Product_Research vs Product_Analysis)
Level 3: SUB-INTENT     — 2-4 candidates  (e.g., product_search vs browse_categories)
```

### 3.2 Classification Flow (Proposed)

```
Message
  │
  ├─ IntelliSense (LLM call) — UNCHANGED (+ class_hint added)
  │    → Multi-statement splitting
  │    → Product name extraction
  │    → Pronoun skip detection (skip_resolve)
  │    → Conversational short-circuit (if confident)
  │    → NEW: class_hint (Level 1 classification as bonus output)
  │
  ├─ Fuzzy Typo Correction — UNCHANGED
  │
  ├─ Global Pre-pass — UNCHANGED (always runs)
  │    → Clause detection (semantic + lexical)
  │    → Brand detection
  │    → Word consumption shielding
  │
  ├─ Preprocessor — UNCHANGED
  │    → Text normalization, negation detection, conjunction splitting
  │
  └─ For each statement:
       │
       ├─ L1: CLASS CLASSIFICATION
       │    Primary: IntelliSense class_hint
       │    Fallback: Transformer call against CLASS_KB (6 candidates)
       │    Output: winning class (e.g., "Discovery")
       │
       ├─ L2: INTENT CLASSIFICATION
       │    Transformer call against INTENT_KB[class] (2-5 candidates)
       │    + Deterministic word matching (action verbs, keywords)
       │    Output: winning intent (e.g., "Product_Research")
       │
       ├─ L3: SUB-INTENT CLASSIFICATION
       │    Transformer call against SUBINTENT_KB[intent] (2-4 candidates)
       │    Output: scored sub-intent candidates
       │
       ├─ CONDITIONAL STAGES (gated by class/intent — see Section 6)
       │    • Context Resolution
       │    • Entity Extraction (Transformer for categories/clauses/attributes)
       │    • Category Detection
       │    • PIE (Product Intel Extractor)
       │
       ├─ SCHEMA RESOLUTION
       │    L3 transformer scores
       │    + Schema satisfaction (parameter slot fit)
       │    + Keyword/action verb deterministic scores
       │    + Boosts and penalties
       │    Output: winning sub-intent with parameters
       │
       ├─ Context Reconciliation — CONDITIONAL
       ├─ Intent Porting — UNCHANGED (independent, logic-based)
       ├─ Parameter Bleeding — UNCHANGED
       ├─ Parameter Normalization — UNCHANGED
       ├─ Inventory Check — CONDITIONAL (Discovery only)
       ├─ Search Context — CONDITIONAL
       ├─ Tool Mapping — UNCHANGED
       └─ Microstate Trigger Check — SIMPLIFIED
```

---

## 4. The Classification Hierarchy

### 4.1 Full Taxonomy

```
CLASS A: DISCOVERY
  ├── Intent: Product_Research
  │     ├── Sub-Intent: product_search
  │     ├── Sub-Intent: browse_categories
  │     ├── Sub-Intent: browse_collection
  │     └── Sub-Intent: facet_list
  └── Intent: Product_Analysis
        ├── Sub-Intent: get_product_details
        ├── Sub-Intent: product_compare
        └── Sub-Intent: product_similar

CLASS B: SHOPPING MANAGEMENT
  ├── Intent: Cart_Management
  │     ├── Sub-Intent: add_to_cart
  │     ├── Sub-Intent: remove_from_cart
  │     ├── Sub-Intent: update_cart_quantity
  │     └── Sub-Intent: view_cart
  ├── Intent: Wishlist_Management
  │     ├── Sub-Intent: add_to_wishlist
  │     ├── Sub-Intent: remove_from_wishlist
  │     ├── Sub-Intent: view_wishlist
  │     └── Sub-Intent: move_to_cart
  ├── Intent: Checkout_Flow
  │     ├── Sub-Intent: start_checkout
  │     ├── Sub-Intent: set_delivery
  │     ├── Sub-Intent: confirm_order
  │     └── Sub-Intent: check_availability
  └── Intent: Post_Purchase
        ├── Sub-Intent: order_status
        ├── Sub-Intent: list_orders
        ├── Sub-Intent: cancel_order
        └── Sub-Intent: return_item

CLASS C: VENDOR INTELLIGENCE
  ├── Intent: Vendor_Lookup
  │     ├── Sub-Intent: list_vendors
  │     ├── Sub-Intent: vendor_info
  │     └── Sub-Intent: vendor_identity
  ├── Intent: Vendor_Catalog_Exploration
  │     ├── Sub-Intent: vendor_products
  │     └── Sub-Intent: vendor_facet
  └── Intent: Vendor_Direct_Contact
        └── Sub-Intent: vendor_contact

CLASS D: SUPPORT & FEEDBACK
  ├── Intent: Assistance_Request
  │     ├── Sub-Intent: get_help
  │     └── Sub-Intent: get_advice
  └── Intent: Platform_Feedback
        └── Sub-Intent: give_feedback

CLASS E: ACCOUNT & STORE (future — not implemented yet)
  ├── Intent: Account_Management
  └── Intent: Store_Locator

CLASS F: SYSTEM & UTILITY (future — not implemented yet)
  ├── Intent: Session_Navigation
  └── Intent: Clarification_Request
```

### 4.2 What Maps to Current Intents

| Current Intent | → Class | → Intent | → Sub-Intent |
|---|---|---|---|
| `product_search` | Discovery | Product_Research | product_search |
| `browse_categories` | Discovery | Product_Research | browse_categories |
| `browse_collection` | Discovery | Product_Research | browse_collection |
| `facet_list` | Discovery | Product_Research | facet_list |
| `get_product_details` | Discovery | Product_Analysis | get_product_details |
| `product_compare` | Discovery | Product_Analysis | product_compare |
| `product_similar` | Discovery | Product_Analysis | product_similar |
| `add_to_cart` | Shopping Management | Cart_Management | add_to_cart |
| `remove_from_cart` | Shopping Management | Cart_Management | remove_from_cart |
| `update_cart_quantity` | Shopping Management | Cart_Management | update_cart_quantity |
| `view_cart` | Shopping Management | Cart_Management | view_cart |
| `start_checkout` | Shopping Management | Checkout_Flow | start_checkout |
| `set_delivery` | Shopping Management | Checkout_Flow | set_delivery |
| `confirm_order` | Shopping Management | Checkout_Flow | confirm_order |
| `check_availability` | Shopping Management | Checkout_Flow | check_availability |
| `order_status` | Shopping Management | Post_Purchase | order_status |
| `list_orders` | Shopping Management | Post_Purchase | list_orders |
| `cancel_order` | Shopping Management | Post_Purchase | cancel_order |
| `list_vendors` | Vendor Intelligence | Vendor_Lookup | list_vendors |
| `vendor_info` | Vendor Intelligence | Vendor_Lookup | vendor_info |
| `vendor_identity` | Vendor Intelligence | Vendor_Lookup | vendor_identity |
| `vendor_products` | Vendor Intelligence | Vendor_Catalog_Exploration | vendor_products |
| `vendor_facet` | Vendor Intelligence | Vendor_Catalog_Exploration | vendor_facet |
| `vendor_contact` | Vendor Intelligence | Vendor_Direct_Contact | vendor_contact |
| `get_help` | Support & Feedback | Assistance_Request | get_help |
| `get_advice` | Support & Feedback | Assistance_Request | get_advice |
| `give_feedback` | Support & Feedback | Platform_Feedback | give_feedback |
| `conversation` | *(short-circuited by IntelliSense — no hierarchy needed)* | | |
| `end_conversation` | *(short-circuited by IntelliSense — no hierarchy needed)* | | |
| `discovery_sentinel` | Discovery | Product_Research | product_search *(merged)* |

### 4.3 New Intents (not yet in codebase)

| Sub-Intent | Class | Intent | Status |
|---|---|---|---|
| `add_to_wishlist` | Shopping Management | Wishlist_Management | **NEW** |
| `remove_from_wishlist` | Shopping Management | Wishlist_Management | **NEW** |
| `view_wishlist` | Shopping Management | Wishlist_Management | **NEW** |
| `move_to_cart` | Shopping Management | Wishlist_Management | **NEW** |
| `return_item` | Shopping Management | Post_Purchase | **NEW** |

---

## 5. Knowledge Base Structure

### 5.1 Fragmentation Strategy

The transformer knowledge base is split into **isolated embedding spaces** per classification level. Each level contains only peer-level candidates, ensuring maximum separation and minimum noise.

```
knowledge-bases/
  ├── class_kb.json                          # L1: 6 classes
  ├── intent_kb/
  │     ├── discovery.json                   # L2: Product_Research, Product_Analysis
  │     ├── shopping_management.json         # L2: Cart_Management, Wishlist_Management, Checkout_Flow, Post_Purchase
  │     ├── vendor_intelligence.json         # L2: Vendor_Lookup, Vendor_Catalog_Exploration, Vendor_Direct_Contact
  │     └── support_feedback.json            # L2: Assistance_Request, Platform_Feedback
  ├── subintent_kb/
  │     ├── product_research.json            # L3: product_search, browse_categories, browse_collection, facet_list
  │     ├── product_analysis.json            # L3: get_product_details, product_compare, product_similar
  │     ├── cart_management.json             # L3: add_to_cart, remove_from_cart, update_cart_quantity, view_cart
  │     ├── wishlist_management.json         # L3: add_to_wishlist, remove_from_wishlist, view_wishlist, move_to_cart
  │     ├── checkout_flow.json              # L3: start_checkout, set_delivery, confirm_order, check_availability
  │     ├── post_purchase.json               # L3: order_status, list_orders, cancel_order, return_item
  │     ├── vendor_lookup.json               # L3: list_vendors, vendor_info, vendor_identity
  │     ├── vendor_catalog_exploration.json  # L3: vendor_products, vendor_facet
  │     ├── vendor_direct_contact.json       # L3: vendor_contact (single sub-intent)
  │     ├── assistance_request.json          # L3: get_help, get_advice
  │     └── platform_feedback.json           # L3: give_feedback (single sub-intent)
  └── entity_kb.json                         # Entity extraction: categories, clauses, attributes (unchanged)
```

### 5.2 Variation Design Principles

Each level follows a different strategy for its variations:

**Level 1 — CLASS variations: Clear, unambiguous, distinct**

Each class's variations must be obviously different from every other class. No overlap allowed. The goal is to make the classification trivially easy for the model.

```
Discovery:
  "show me products"
  "I want to browse"
  "what phones do you have"
  "find me something nice"
  "search for laptops"

Shopping Management:
  "add to my cart"
  "checkout now"
  "where is my order"
  "remove the second item"

Vendor Intelligence:
  "who sells this"
  "tell me about this vendor"
  "I want to contact the seller"
```

**Level 2 — INTENT variations: Can share similar phrasing across classes**

Because intents from different classes are **never in the same embedding space**, they can safely reuse similar words. Within a class, variations should distinguish between sibling intents.

```
Within Discovery:
  Product_Research: "find me something", "search for laptops", "show me categories"
  Product_Analysis: "compare these two", "more details about this", "show similar products"

Within Shopping Management:
  Cart_Management: "add this to cart", "remove an item", "what's in my cart"
  Checkout_Flow: "proceed to checkout", "set my delivery address"
  Post_Purchase: "where is my order", "cancel order #123"
```

**Level 3 — SUB-INTENT variations: Can mirror variations across intents**

Sub-intents from different intents never share an embedding space, so they can use identical phrasing patterns.

```
Within Product_Research:
  product_search: "search for laptops", "show me cheap phones"
  browse_categories: "what categories do you have", "show me all departments"
  facet_list: "what colors are available", "show me the storage options"

Within Cart_Management:
  add_to_cart: "add this to my cart", "I want to buy this"
  remove_from_cart: "remove this from cart", "take it out"
  view_cart: "show my cart", "what's in my basket"
```

### 5.3 Variation Volume

With fragmented KBs, each level needs **fewer variations** because the classification task is simpler (fewer candidates to distinguish between).

| Level | Candidates per space | Suggested variations per candidate |
|---|---|---|
| L1 (Class) | 4-6 | 30-50 variations |
| L2 (Intent) | 2-5 | 20-40 variations |
| L3 (Sub-Intent) | 2-4 | 15-30 variations |
| Entity KB | N/A | Unchanged from current |

### 5.4 Embedding Structure

Each KB file follows the same structure:

```json
{
  "level": "class",
  "candidates": [
    {
      "name": "Discovery",
      "variations": [
        "show me products",
        "I want to browse",
        "what phones do you have",
        "find me something nice",
        "search for laptops",
        "do you have any headphones"
      ]
    },
    {
      "name": "Shopping_Management",
      "variations": [
        "add this to my cart",
        "I want to checkout",
        "where is my order",
        "remove the second item"
      ]
    }
  ]
}
```

All variations within one file are embedded together into a single vector space. Classification = find the nearest candidate to the input embedding.

---

## 6. Conditional Stage Execution

### 6.1 The Core Idea

Not every intent needs every pipeline stage. In the current architecture, all messages pass through all stages. In the new architecture, stages are **gated by the resolved intent** from L2.

### 6.2 Stage Definitions

| Stage | What It Does | When It Runs |
|---|---|---|
| **IntelliSense** | Multi-statement split, product extraction, skip_resolve, class_hint | **ALWAYS** |
| **Fuzzy Typo Correction** | Levenshtein-based typo correction with entity guards | **ALWAYS** |
| **Global Pre-pass** | Clause detection (semantic + lexical), brand detection, word shielding | **ALWAYS** |
| **Preprocessor** | Normalize text, detect negation, split on conjunctions | **ALWAYS** |
| **L1 Classification** | Classify into one of 6 classes | **ALWAYS** |
| **L2 Classification** | Classify into intent within class + deterministic word confirmation | **ALWAYS** |
| **L3 Classification** | Classify into sub-intent within intent | **ALWAYS** |
| **Context Resolution** | Resolve pronouns ("it", "the first one") using reference_map and ordinal_list | **CONDITIONAL** — Cart_Management, Wishlist_Management, Product_Analysis |
| **Entity Extraction (Transformer)** | Extract categories, clauses, attributes via transformer | **CONDITIONAL** — Discovery, Vendor_Catalog_Exploration |
| **Category Detection** | Lexical N-gram scan via normalizeCategory | **CONDITIONAL** — Product_Research (only if no resolved products from context) |
| **PIE** | Product Intel Extractor — assemble product names from residuals | **CONDITIONAL** — Product_Research; Cart_Management/Wishlist_Management (fallback only) |
| **Schema Resolution** | Pick winning sub-intent: L3 scores + schema satisfaction + boosts/penalties | **ALWAYS** (but simpler when fewer stages ran) |
| **Context Reconciliation** | Map resolved references to parameters | **CONDITIONAL** — only if Context Resolution ran |
| **Intent Porting** | Logic-based pivoting (search→cart, cart→search) | **ALWAYS** (independent, cheap) |
| **Parameter Bleeding** | Cross-intent parameter inheritance (multi-intent) | **CONDITIONAL** — only if multi-intent |
| **Parameter Normalization** | Clause→attribute mapping, brand folding, vendor normalization | **ALWAYS** |
| **Inventory Check** | Check empty categories, suggest siblings, parental pivot | **CONDITIONAL** — Product_Research only |
| **Search Context** | Write search context for Discovery; read context for Cart/Wishlist | **CONDITIONAL** — Discovery (write), Cart/Wishlist (read) |
| **Tool Mapping** | Map winning sub-intent → tool call | **ALWAYS** |
| **Microstate Trigger** | Check if winning intent triggers a microstate | **ALWAYS** (but simplified — see Section 6.4) |

### 6.3 Full Conditional Execution Matrix

Rows = Intent (L2 resolved). Columns = Pipeline stages.
✅ = always runs, ❌ = skipped, ⚠️ = runs conditionally.

| Intent (L2) | Context Res | Entity Ext (Transformer) | Category Det | PIE | Schema Res | Inventory Check | Search Ctx |
|---|---|---|---|---|---|---|---|
| **Product_Research** | ❌ | ✅ | ⚠️ only if no resolved products | ✅ | ✅ | ✅ | ✅ write |
| **Product_Analysis** | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Cart_Management** | ✅ | ❌ | ❌ | ⚠️ fallback → microstate if fails | ✅ | ❌ | ✅ read |
| **Wishlist_Management** | ✅ | ❌ | ❌ | ⚠️ fallback → microstate if fails | ✅ | ❌ | ✅ read |
| **Checkout_Flow** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Post_Purchase** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Vendor_Lookup** | ❌ | ✅ (vendor only) | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Vendor_Catalog_Exploration** | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Vendor_Direct_Contact** | ❌ | ✅ (vendor only) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Assistance_Request** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Platform_Feedback** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### 6.4 Microstate Trigger Simplification

**Current**: Stage 10 uses `normalizeCategory` to check if a product name is actually a category (the `product_is_category` trigger in `add_to_cart.js`). This is the 2nd call to `normalizeCategory` in the pipeline.

**Proposed**: This call is **eliminated**.

- **Context-resolved products** → definitively a product, not a category. No check needed.
- **PIE-resolved products** → PIE already does its own category check internally. No redundant check needed.
- **Neither resolved** → Microstate triggers with `missing_product` type. User is asked to specify.

Result: `normalizeCategory` runs in exactly **1 place** in the pipeline (Stage 4a entity extraction, Product_Research only).

### 6.5 Cart_Management PIE Fallback Flow

When `Cart_Management` intent is resolved but the product isn't in state (context resolution found nothing):

```
Context Resolution → ❌ no match in reference_map or search_context
  │
  └─ PIE runs as FALLBACK
       (PIE already has IntelliSense product override baked in via
        statementPreEntities — no stage should access IntelliSense
        products directly, PIE owns that integration)
       │
       ├─ PIE found a product name → VALIDATE first
       │    │
       │    ├─ Hit backend to resolve product name → UUID
       │    │    │
       │    │    ├─ Product resolved (UUID found)
       │    │    │    → Trigger confirmation microstate WITH resolved product
       │    │    │    "Add [Product Name] ($X.XX) to your cart?"
       │    │    │
       │    │    └─ Product NOT found (no UUID)
       │    │         → Trigger missing_product microstate
       │    │         "I couldn't find that product. What would you like to add?"
       │    │
       │    └─ (Never skip validation — PIE output is heuristic, not guaranteed)
       │
       └─ PIE found nothing → Trigger missing_product microstate
            "What product would you like to add to your cart?"
```

> [!IMPORTANT]
> **No intent accesses IntelliSense's product list directly.** PIE already ingests IntelliSense products via `statementPreEntities` (the IntelliSense override). This is the single integration point.

> [!IMPORTANT]
> **PIE results must be validated before confirmation.** When PIE resolves a product name for Cart_Management, we first attempt to resolve it to an actual product UUID via the backend. Only if the product is real do we trigger a confirmation microstate. If the product doesn't resolve, we trigger `missing_product` instead. This prevents confirming phantom products.

---

## 7. Transformer Call Structure

### 7.1 Current: 1 Large Batch Call

```
POST /analyze
Body: { texts: ["show me cheap samsung phones", "and add the first one to cart"] }
Against: FULL knowledge base (all 31 intents + entity extraction)
Returns: classification + entities for all texts
Duration: 500-2000ms (frequently times out)
```

### 7.2 Proposed: 3 Small Sequential Calls

```
CALL 1: POST /classify
  Body: { text: "show me cheap samsung phones", level: "class" }
  Against: CLASS_KB (6 candidates)
  Returns: { winner: "Discovery", scores: [{name: "Discovery", score: 0.95}, ...] }
  Duration: ~100-200ms

CALL 2: POST /classify
  Body: { text: "show me cheap samsung phones", level: "intent", parent: "Discovery" }
  Against: INTENT_KB for Discovery (2 candidates)
  Returns: { winner: "Product_Research", scores: [{name: "Product_Research", score: 0.91}, ...] }
  Duration: ~100-200ms

CALL 3: POST /classify
  Body: { text: "show me cheap samsung phones", level: "subintent", parent: "Product_Research" }
  Against: SUBINTENT_KB for Product_Research (4 candidates)
  Returns: { scores: [{name: "product_search", score: 0.92}, {name: "browse_categories", score: 0.71}, ...] }
  Duration: ~100-200ms

OPTIONAL CALL 4: POST /extract-entities (only if Discovery or Vendor class)
  Body: { text: "show me cheap samsung phones" }
  Against: ENTITY_KB (categories, clauses, attributes — unchanged)
  Returns: { categories: [...], vendors: [...], clauses: [...], attributes: [...] }
  Duration: ~200-400ms
```

**Total: 300-800ms** (vs current 500-2000ms with timeouts)

### 7.2.1 Embedding Storage: Redis Consideration

The current transformer stores embeddings in flat JSON files loaded into memory. With fragmented KBs (~15 separate embedding spaces), a **Redis-based embedding storage** is being considered:

| Factor | File-based (current) | Redis-based (considered) |
|---|---|---|
| **Startup time** | Load all KBs into memory on boot | Lazy-load per request |
| **Memory footprint** | All KBs resident in process memory | Offloaded to Redis |
| **Hot-reload** | Restart required | Update KB in Redis, no restart |
| **Multi-instance** | Each instance loads its own copy | Shared Redis, single source of truth |
| **Vector search** | Custom cosine similarity loop | Redis VSS module (RediSearch) or custom |

> [!NOTE]
> Redis embedding storage is an infrastructure decision that affects the transformer service internally. It does **not** change the API contract (`/classify`, `/extract-entities`) or the pipeline's interaction with the transformer. This can be implemented independently of the pipeline refactor.

### 7.3 Why Sequential Small Calls Beat One Large Batch

| Factor | Current Batch | Proposed Sequential |
|---|---|---|
| **Embedding space size** | All 31 intents + entities | 2-6 candidates per call |
| **Timeout risk** | High (large KB, long compute) | Low (tiny KBs, fast compute) |
| **Error recovery** | All-or-nothing | Can retry individual calls |
| **Wasted work** | Entity extraction runs even for "view cart" | Entity extraction skipped unless needed |
| **Cache friendliness** | Low (different queries hit different intents) | High (hot paths load same small KB) |

### 7.4 Transformer API Changes

The transformer service needs a new endpoint or parameter to specify which KB to classify against:

```
Current:
  POST /analyze  { texts: [...] }  → classification + entities

Proposed:
  POST /classify  { text, level: "class" }                            → class scores
  POST /classify  { text, level: "intent", parent: "Discovery" }      → intent scores
  POST /classify  { text, level: "subintent", parent: "Product_Research" } → sub-intent scores
  POST /extract   { text }                                             → entity extraction (unchanged)
```

---

## 8. L2 Deterministic Word Confirmation

### 8.1 Purpose

After the transformer returns L2 (intent) scores, a **deterministic word match** runs alongside as confirmation or correction. This is not primarily a tiebreaker — the transformer rarely ties. It's a safety net that allows the deterministic system to confirm what the transformer did, or correct it when the transformer was indecisive.

### 8.2 How It Works

The current `ACTION_VERBS` map categorizes words into action types:

```js
'buy' → 'purchase'    // Maps to Cart_Management
'show' → 'discovery'   // Maps to Product_Research
'compare' → 'compare'  // Maps to Product_Analysis
'track' → 'tracking'   // Maps to Post_Purchase
'contact' → 'contact'  // Maps to Vendor_Direct_Contact
```

Each action category maps to one or more intents. The deterministic score is compared against the transformer score:

| Scenario | Result |
|---|---|
| Transformer and deterministic agree | Winning intent confirmed with high confidence |
| Transformer confident, deterministic weak/absent | Trust transformer (user phrasing was unusual but semantically clear) |
| Transformer indecisive, deterministic has clear winner | Trust deterministic (action verb is unambiguous) |
| Both indecisive | Pick transformer's top score, let downstream guards handle |

### 8.3 Key Principle

**We do NOT block on ties.** If both systems are indecisive, we pick one and move forward. The joy of hierarchical classification is that **we already got the class right** — we aren't mistakenly routing an add-to-cart to a similarity search. An intent-level error within the correct class is much less catastrophic because downstream guards (schema resolution, microstate triggers) catch sub-intent mismatches.

---

## 9. IntelliSense Changes

### 9.1 Current Role (Unchanged)

IntelliSense is an LLM pre-pass that:
- Splits multi-statement messages into individual statements
- Extracts product names (supplements/overrides PIE)
- Marks pronouns to skip during context resolution ("it" isn't always a product reference)
- Short-circuits pure conversational messages

### 9.2 New Addition

All current responsibilities remain. One new output is added — **per-statement `class_hint`**:

```js
// Current IntelliSense output
{
  statements: [
    { text: "show me phones", products: [], skip_resolve: [] },
    { text: "add the first one to cart", products: [], skip_resolve: [] }
  ],
  recommended_path: "FULL_PIPELINE" | "CONVERSATIONAL",
  confidence: 0.95
}

// Proposed IntelliSense output
{
  statements: [
    { text: "show me phones", products: [], skip_resolve: [], class_hint: "Discovery" },
    { text: "add the first one to cart", products: [], skip_resolve: [], class_hint: "Shopping_Management" }
  ],
  recommended_path: "FULL_PIPELINE" | "CONVERSATIONAL",
  confidence: 0.95
}
```

**`class_hint` is per-statement, not per-message.** This is critical for multi-intent messages where each statement can belong to a different class ("show me phones" = Discovery, "add the first one" = Shopping Management). IntelliSense already understands each statement individually — adding a class hint per statement is natural.

If `class_hint` is present on a statement, the L1 transformer call is skipped for that statement.

### 9.3 What IntelliSense Does NOT Do

IntelliSense does **NOT**:
- Attempt L2 or L3 classification (causes hallucination)
- Provide products directly to intents (PIE owns that integration via `statementPreEntities`)

Adding more classification tasks to the LLM prompt reduces quality on its core strengths (statement splitting, product extraction). The transformer handles L2 and L3.

### 9.4 IntelliSense Down Fallback

If IntelliSense is completely unavailable:
- **L1 classification**: Falls back to Transformer L1 call against CLASS_KB
- **Statement splitting**: Falls back to deterministic preprocessor (conjunction/comma splitting)
- **Product extraction**: Falls back to PIE only
- **Pronoun skip detection**: Falls back to none (all pronouns attempt resolution)

---

## 10. Side-by-Side Comparison: Current vs Proposed

### 10.1 Pipeline Stage Comparison

| Stage | Current | Proposed | Change Type |
|---|---|---|---|
| Engineered Token Handling | Runs first (bypass NLU) | **UNCHANGED** | — |
| Microstate Check (Stage 0) | Gate — process or breakthrough | **UNCHANGED** | — |
| Fuzzy Typo Correction | Always runs | **UNCHANGED** | — |
| IntelliSense | LLM pre-pass | LLM pre-pass + **class_hint** | Minor addition |
| Preprocessor | Always runs | **UNCHANGED** | — |
| **Transformer Call** | **1 large batch against full KB** | **3 small sequential against fragmented KBs** | **MAJOR** |
| Global Pre-pass (3a) | Always runs (clauses, brands) | **UNCHANGED** | — |
| Context Resolution (4a) | Always runs per statement | **CONDITIONAL** — Cart, Wishlist, Product_Analysis | **Gated** |
| Entity Extraction (4a) | Always runs (lexical N-gram) | **CONDITIONAL** — Discovery, Vendor_Catalog | **Gated** |
| Category Detection | Always runs inside entity extraction | **CONDITIONAL** — Product_Research only, skip if resolved products | **Gated** |
| Schema Resolution (4b) | Scores all 31 intents deterministically | Scores **2-4 sub-intents** within winning intent | **Narrowed** |
| Semantic Integration (4.5) | Merges transformer + deterministic for all intents | L3 scores + deterministic for sub-intents only | **Narrowed** |
| Parameter Extraction (5) / PIE | Always runs | **CONDITIONAL** — Product_Research, Cart/Wishlist fallback | **Gated** |
| Context Reconciliation (4c) | Always runs | **CONDITIONAL** — only if Context Resolution ran | **Gated** |
| Intent Porting (7.5) | Always runs | **UNCHANGED** (logic-based, independent) | — |
| Parameter Bleeding (6) | Always runs | **CONDITIONAL** — multi-intent only | **Gated** |
| Parameter Normalization (6.5) | Always runs | **UNCHANGED** | — |
| Inventory Check (7) | Runs for search+availability intents | **CONDITIONAL** — Product_Research only | **Gated** |
| Search Context (8a) | Write for search, read for cart/compare | **CONDITIONAL** — Discovery write, Cart/Wishlist read | **Gated** |
| Tool Mapping (8b) | Always runs | **UNCHANGED** | — |
| **Microstate Trigger (10)** | Calls normalizeCategory independently | **SIMPLIFIED** — no normalizeCategory call | **Simplified** |

### 10.2 normalizeCategory Call Sites

| | Current | Proposed |
|---|---|---|
| Stage 4a (Entity Extraction) | ✅ Runs for every message | ✅ Runs for Product_Research only |
| Stage 10 (add_to_cart trigger) | ✅ Runs independently | ❌ **ELIMINATED** |
| **Total calls per pipeline** | **2** | **1** (and only for Discovery class) |

### 10.3 Transformer Call Comparison

| | Current | Proposed |
|---|---|---|
| Calls per message | 1 (batch) | 2-4 (sequential, small) |
| KB size per call | Full (31 intents + entities) | 2-6 candidates per classification call |
| Entity extraction | Always | Only if Discovery or Vendor class |
| Timeout risk | High | Low |
| Total latency | 500-2000ms | 300-800ms |

### 10.4 Example Walkthrough: "view my cart"

**Current pipeline** (all stages run):
```
IntelliSense → Fuzzy → Preprocessor → Transformer (full batch) → Global Pre-pass →
Context Resolution → Entity Extraction (N-gram scan) → Schema Resolution (31 candidates) →
Parameter Extraction / PIE → Context Reconciliation → Porting → Bleeding →
Normalization → Inventory Check → Search Context → Tool Mapping → Microstate Check
= ~12 stages, ~800-1500ms
```

**Proposed pipeline** (most stages skipped):
```
IntelliSense (class_hint: Shopping_Management) →
Fuzzy → Preprocessor → Global Pre-pass →
L1: Shopping_Management (from IntelliSense, no transformer call) →
L2: Cart_Management (transformer, 4 candidates, ~150ms) →
L3: view_cart (transformer, 4 candidates, ~150ms) →
Schema Resolution (4 candidates, trivial — view_cart wins easily) →
Normalization → Tool Mapping → Microstate Check

SKIPPED: Context Resolution, Entity Extraction, Category Detection,
         PIE, Context Reconciliation, Inventory Check, Search Context
= ~8 stages, ~300-500ms
```

### 10.5 Example Walkthrough: "show me cheap samsung phones"

**Current pipeline**:
```
IntelliSense → Fuzzy → Preprocessor → Transformer (full batch with entities) →
Global Pre-pass (cheap→clause, samsung→brand) →
Context Resolution → Entity Extraction (N-gram: phones→category) →
Schema Resolution (31 candidates) → PIE → Context Reconciliation →
Porting → Bleeding → Normalization → Inventory Check →
Search Context (write) → Tool Mapping → Microstate Check
= ~14 stages, ~1000-2000ms
```

**Proposed pipeline**:
```
IntelliSense (class_hint: Discovery) →
Fuzzy → Preprocessor → Global Pre-pass (cheap→clause, samsung→brand) →
L1: Discovery (from IntelliSense) →
L2: Product_Research (transformer, 2 candidates, ~150ms) →
L3: product_search scored highest (transformer, 4 candidates, ~150ms) →
Entity Extraction via Transformer (categories, clauses, attributes, ~300ms) →
Category Detection (N-gram: phones→category) →
PIE (residuals → product name if any) →
Schema Resolution (4 candidates: L3 scores + schema fit → product_search wins) →
Normalization → Inventory Check → Search Context (write) →
Tool Mapping → Microstate Check

SKIPPED: Context Resolution, Context Reconciliation
= ~12 stages, ~600-1000ms
```

### 10.6 Example Walkthrough: "add the first one to my cart"

**Current pipeline**:
```
IntelliSense → Fuzzy → Preprocessor → Transformer (full batch) →
Global Pre-pass → Context Resolution (resolves "first one" → product ID) →
Entity Extraction → Schema Resolution (31 candidates) →
PIE (runs but wasted) → Context Reconciliation →
Porting → Normalization → Search Context (read) →
Tool Mapping → Microstate Check (normalizeCategory runs)
= ~13 stages
```

**Proposed pipeline**:
```
IntelliSense (class_hint: Shopping_Management, skip_resolve: []) →
Fuzzy → Preprocessor → Global Pre-pass →
L1: Shopping_Management (from IntelliSense) →
L2: Cart_Management (transformer, 4 candidates, ~150ms) →
L3: add_to_cart scored highest (transformer, 4 candidates, ~150ms) →
Context Resolution (resolves "first one" → product ID from search_context) ✅ →
Schema Resolution (4 candidates: L3 scores + schema fit → add_to_cart wins) →
Context Reconciliation → Normalization → Search Context (read) →
Tool Mapping → Microstate Check (NO normalizeCategory call)

SKIPPED: Entity Extraction, Category Detection, PIE, Inventory Check
= ~9 stages
```

---

## 11. What Stays Completely Unchanged

These components require **zero modifications**:

| Component | File(s) | Why Unchanged |
|---|---|---|
| Engineered token handling | index.js (lines 148-651) | Bypasses NLU entirely — buttons, pagination |
| Microstate runner | microstateRunner.js | Processes messages inside active microstates |
| Fuzzy typo correction | fuzzyMatcher.js | Runs on raw input before classification |
| Global pre-pass | semanticClauseResolver.js | Clause + brand detection, word shielding |
| Preprocessor | preprocessor.js | Text normalization, negation, splitting |
| Intent porting | intentPorter.js | Logic-based pivoting, independent of classification |
| Parameter bleeding | parameterBleeder.js | Cross-intent param inheritance, mechanical |
| Parameter normalization | parameterNormalizer.js | Clause→attribute, brand folding, vendor |
| Tool mapping | toolMapper.js | Mechanical intent→tool translation |
| Microstate feature provider | microstateFeatureProvider.js | Generates recommendations after microstate opens |
| All tool implementations | src/tools/*.js | product.js, cart.js, vendor.js, etc. |
| State management | stateManager.js | reference_map, search_context, microstates |
| Store context | storeContext.js | CATEGORIES, VENDORS, ATTRIBUTES, CLAUSES |
| NLP cleaner | nlpCleaner.js | Text cleaning utilities |
| Context reconciler | contextReconciler.js | Maps resolved refs to params |
| Residual chunk analyzer | residualChunkAnalyzer.js | Background logging/analysis |
| Pipeline confidence | pipelineConfidence.js | End-of-pipeline confidence scoring |

---

## 12. What Changes

### 12.1 Transformer Service (be3-ai-transformer)

| Change | Details |
|---|---|
| New `/classify` endpoint | Accepts `{ text, level, parent }` — classifies against a specific fragmented KB |
| Knowledge base regeneration | Split current monolithic KB into ~15 fragmented KBs (1 class + 4 intent + ~11 sub-intent + 1 entity) |
| Variation authoring | Write new, simpler variations per level following the design principles in Section 5.2 |
| Embedding pipeline | Embed each KB file independently into its own vector space |
| Keep `/extract` endpoint | Entity extraction remains unchanged, just conditionally called |

### 12.2 Intent Resolver (index.js)

| Change | Details |
|---|---|
| Replace single transformer batch call | With 3 sequential `/classify` calls (L1, L2, L3) |
| Add conditional stage gating | Wrap stages in intent-based guards per the matrix in Section 6.3 |
| Schema resolution narrowing | Score only the 2-4 sub-intents from L3, not all 31 |
| Semantic integration refactor | L3 scores replace the current flat semantic scores |
| Remove redundant normalizeCategory | The `product_is_category` trigger in `add_to_cart.js` becomes unnecessary |

### 12.3 IntelliSense (intelliSense.js)

| Change | Details |
|---|---|
| Add `class_hint` output | Add class classification to the LLM prompt as a bonus output field |
| No other changes | Statement splitting, product extraction, skip_resolve stay identical |

### 12.4 Entity Extractor (entityExtractor.js)

| Change | Details |
|---|---|
| Conditional execution | Only runs when L2 intent requires it (Discovery, Vendor_Catalog) |
| No structural changes | N-gram scanner, vendor detection, action verb detection — all internal logic stays the same |

### 12.5 Schema Resolver (schemaResolver.js)

| Change | Details |
|---|---|
| Narrowed candidate set | Instead of building candidates from all registered intents, receives only the 2-4 sub-intent candidates from L3 |
| L3 semantic scores | Uses L3 transformer scores instead of flat `/analyze` scores |
| Deterministic scoring unchanged | Keyword matching, slot fit, IDF weights — all the same logic, just fewer candidates |

### 12.6 Context Resolver (contextResolver.js)

| Change | Details |
|---|---|
| Conditional execution | Only runs for Cart_Management, Wishlist_Management, Product_Analysis |
| No structural changes | Pronoun resolution, ordinal resolution, reference_map lookup — all identical |

### 12.7 Intent Config Files (config/intents/*.js)

| Change | Details |
|---|---|
| Add class + intent metadata | Each config file gets `class` and `intent` fields for routing |
| `add_to_cart.js` | Remove `product_is_category` microstate trigger (normalizeCategory call eliminated) |
| New config files | `add_to_wishlist.js`, `remove_from_wishlist.js`, `view_wishlist.js`, `move_to_cart.js`, `return_item.js` |

### 12.8 Intent Registry (intentRegistry.js)

| Change | Details |
|---|---|
| Hierarchy-aware registration | Intents register with `class`, `intent`, and `subintent` fields |
| Lookup by hierarchy | New methods: `getByClass(class)`, `getByIntent(class, intent)`, `getSubIntents(intent)` |

---

## 13. Search Context Storage

### 13.1 Current Storage

```js
await stateManager.setSearchContext(userId, {
  category: params.category_name || params.category || null,
  category_id: params.category || null,
  vendor: params.vendor || null,
  clauses: ['price_tier_budget'],              // Clause IDs
  attributes: { 'p:p': 'budget,midrange' },    // Resolved attribute composites
  product_ids: ['uuid-1', 'uuid-2'],
  product_attributes_map: {                     // Per-product attribute values
    'uuid-1': { p: 'budget', b: 'apple', c: 'black' },
    'uuid-2': { p: 'midrange', b: 'apple', c: 'white' }
  },
  query: 'cheap phones',
  source_intent: 'product_search'
});
```

### 13.2 Proposed: No Change

The search context storage remains as-is. The two-layer approach works:

- **`clauses`** (array of clause IDs) — used for **matching** in Stage 8a ("the cheap ones" → does this match the search context's clauses?)
- **`attributes`** (structured key-value) — used for **filtering** products via `product_attributes_map`
- **`product_attributes_map`** (per-product attribute snapshot) — the real source of truth for attribute-based filtering

`reference_map` continues to use literal product names for pronoun resolution. No changes needed.

---

## 14. Multi-Intent Statement Handling

### 14.1 The Problem

Multi-intent messages like "show me phones and add the first one to cart" produce **multiple statements** that can belong to **different classes**:

```
Statement 1: "show me phones"          → Class A: Discovery
Statement 2: "add the first one to cart" → Class B: Shopping Management
```

The hierarchical model must handle this without forcing all statements into the same class.

### 14.2 Solution: Per-Statement Classification

Each statement runs through L1→L2→L3 **independently**. The class resolved for Statement 1 has no bearing on Statement 2.

```
IntelliSense splits: ["show me phones", "add the first one to cart"]

Statement 1:
  L1: Discovery (from class_hint)
  L2: Product_Research (transformer)
  L3: product_search (transformer)
  Stages: Entity Extraction ✅, Category Detection ✅, PIE ✅
  Result: { intent: product_search, params: { category: phones } }

Statement 2:
  L1: Shopping_Management (from class_hint)
  L2: Cart_Management (transformer)
  L3: add_to_cart (transformer)
  Stages: Context Resolution ✅ (resolves "first one" from Statement 1's results)
  Result: { intent: add_to_cart, params: { products: [resolved_id] } }

Post-loop:
  Parameter Bleeding: Statement 2 inherits category from Statement 1 if needed
  Stack: Execute Statement 1 first, then Statement 2
```

### 14.3 Transformer Call Pattern for Multi-Intent

For a 2-statement message with different classes:

```
                          Statement 1              Statement 2
                          ───────────              ───────────
L1 (Class):              IntelliSense hint         IntelliSense hint
                         (no transformer call)      (no transformer call)

L2 (Intent):             /classify intent/discovery  /classify intent/shopping_management
                         (~150ms)                    (~150ms)

L3 (Sub-Intent):         /classify subintent/        /classify subintent/
                         product_research             cart_management
                         (~150ms)                    (~150ms)

Entity Extraction:       /extract-entities           SKIPPED
                         (~300ms)
```

**Total transformer calls: 4 classify + 1 extract = 5 calls**
(vs current: 1 batch call for both statements, timeout-prone)

But note: L2 and L3 calls for different statements that hit **the same KB** could potentially be batched. If both statements are Discovery class, L2 only needs one call. This is an optimization, not a requirement.

### 14.4 Cross-Statement Dependencies

Statements are classified independently, but they still share **pipeline state**:

| Dependency | How It Works | Changed? |
|---|---|---|
| **Parameter bleeding** | Statement 2 inherits missing params from Statement 1 | UNCHANGED |
| **Context resolution** | Statement 2 can reference products resolved by Statement 1 | UNCHANGED |
| **Search context** | Statement 1 writes search context, Statement 2 reads it | UNCHANGED |
| **Stack execution** | Execute Statement 1 first, defer Statement 2 to stack | UNCHANGED |
| **Porting** | If Statement 2 is search but Statement 1 already searched, port to cart | UNCHANGED |

### 14.5 Same Class, Same Intent Optimization

When IntelliSense splits into statements that have the **same class_hint**, we can optimize:

```
"show me phones and also show me laptops"
  Statement 1: class_hint = Discovery
  Statement 2: class_hint = Discovery

  → L1 skipped for both (same class_hint)
  → L2 can be batched: one /classify call with both texts against intent_kb/discovery
  → L3 can be batched: one /classify call with both texts against subintent_kb/product_research
```

This is a latency optimization, not a correctness requirement. The pipeline works correctly even if every statement makes its own calls.

---

## 15. Open Items

| Item | Decision Needed |
|---|---|
| **Wishlist sub-intents** | These are new. What tools do they map to? Do they need backend API endpoints? |
| **`return_item` sub-intent** | New. What's the return flow? Does it open a microstate? |
| **`discovery_sentinel` merger** | Currently a separate intent. Should it merge into `product_search` or remain distinct? |
| **`conversation` and `end_conversation`** | These are short-circuited by IntelliSense. Do they need a class, or stay outside the hierarchy? |
| **Transformer `/classify` endpoint design** | Exact API contract, error handling, response format, timeout behavior |
| **Redis embedding storage** | Evaluate Redis VSS vs in-memory for fragmented KBs. Impact on latency, hot-reload, multi-instance. |
| **Variation authoring** | Who writes the variations? Manual? LLM-generated? How many per candidate? |
| **Fallback when IntelliSense is down** | L1 falls back to transformer. Statement splitting falls back to preprocessor. Product extraction falls back to PIE only. Is this sufficient? |
| **L1 confidence threshold** | Should IntelliSense class_hint have a minimum confidence to be trusted? Or always trust it? |
| **Single sub-intent intents** | Vendor_Direct_Contact has only `vendor_contact`. Platform_Feedback has only `give_feedback`. Should L3 be skipped for these? (Probably yes — deterministic shortcut.) |
| **PIE product validation endpoint** | When PIE resolves a product for Cart_Management fallback, what backend endpoint validates it? `/search/products?query=X`? Or a dedicated product lookup? |
| **Same-class batching** | For multi-intent messages where statements share the same class, should L2/L3 calls be batched into one request? (Optimization, not required for correctness.) |
