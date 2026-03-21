# State Management Audit & Enhancement Plan

## Executive Summary

Your state system has **23 tracked fields** but only **~8 are actively used** by the pipeline. Most pipeline stages (`schemaResolver`, `entityExtractor`, `parameterBleeder`, `intentPorter`, `contextReconciler`) are **fully stateless** — they never see user history, preferences, cart state, or past intents. This is a massive untapped opportunity.

---

## Part 1: Current State Field Inventory

### ✅ Actively Used (8 fields)

| Field | Where Written | Where Read | Pipeline Impact |
|---|---|---|---|
| `reference_map` | [updateReferenceMap()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#782-924) after tool results | `contextResolver` (pronoun → product ID) | **HIGH** — core pronoun resolution |
| `ordinal_list` | [updateReferenceMap()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#782-924) | `contextResolver` (1st/2nd → product ID) | **HIGH** — ordinal resolution |
| `search_context` | [setSearchContext()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#592-638) after `product.search` | `contextResolver`, [index.js](file:///c:/Users/chatz/Downloads/eCommerce/be3-ai-transformer/src/index.js) (Stage 0a pagination), [product.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/tools/product.js) | **HIGH** — search continuity, clause memory, attribute maps |
| `user_query_map` | [updateUserQueryMap()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#925-965) after successful search | `contextResolver`, [index.js](file:///c:/Users/chatz/Downloads/eCommerce/be3-ai-transformer/src/index.js) (reconcileNameFromId) | **MEDIUM** — query → product mapping |
| `microstate` | [setMicrostate()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#410-447) in server stack loop | `microstateRunner` (Stage 0), [index.js](file:///c:/Users/chatz/Downloads/eCommerce/be3-ai-transformer/src/index.js), [server.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/server.js) | **HIGH** — multi-turn sandboxed flows |
| `current_intent` | [setCurrentIntent()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#313-319) in [server.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/server.js) | [stack.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/stack.js) (intent porting), [index.js](file:///c:/Users/chatz/Downloads/eCommerce/be3-ai-transformer/src/index.js) (for logging) | **LOW** — used for porting only, not scoring |
| `last_bot_suggestion` | [server.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/server.js) suggestion detection | [index.js](file:///c:/Users/chatz/Downloads/eCommerce/be3-ai-transformer/src/index.js) (Stage intercept), `suggestionHelper` | **MEDIUM** — suggestion confirmation |
| `cart` | [updateCart()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#1062-1070) in [cart.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/tools/cart.js) handlers | [index.js](file:///c:/Users/chatz/Downloads/eCommerce/be3-ai-transformer/src/index.js) (cart item count for product extraction) | **LOW** — only checked for count > 0 |

### 💀 Dead Fields (5 fields — never read by pipeline)

| Field | Status | Notes |
|---|---|---|
| `active_flow` | **DEPRECATED** | All methods print deprecation warning. Superseded by `microstate`. Only referenced in [server.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/server.js) STATE_BEFORE log. |
| `expecting_input` | **DEPRECATED** | [setExpectingInput()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#372-386) / [clearExpectingInput()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#401-407) exist but are never called. Superseded by `microstate`. |
| `comparison_set` | **DEAD** | Defined in `product_context.comparison_set` but never written or read anywhere outside `DEFAULT_STATE`. |
| `recently_viewed` | **DEAD** | [addToRecentlyViewed()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#724-750) exists but is never called from any handler or pipeline stage. |
| `conversation_summary` | **DEAD** | [updateConversationSummary()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#285-291) exists but is never called. Only logged in [server.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/server.js) STATE_BEFORE. |

### 😴 Underutilized Fields (4 fields — written but barely read)

| Field | Written By | Read By | Gap |
|---|---|---|---|
| `preferences` (price_range, favorite_brands, favorite_categories, abandoned_items) | [learnFromBehavior()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#1091-1134) in [product.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/tools/product.js) (search) and legacy [handlers.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/legacy/handlers.js) (view_product) | [cart.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/tools/cart.js) (only preferences.price_range) | **NEVER used in intent resolution, entity extraction, or scoring.** The pipeline doesn't know if a user has searched for phones 10 times. |
| `paused_context` | [pauseContext()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#1194-1207) in [server.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/server.js) | [server.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/server.js) (STATE_BEFORE log only) | **NEVER resumed.** The [resumeContext()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#1216-1237) method exists but is never called. |
| `search_refinement_count` | [product.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/tools/product.js) (increments on refinement) | [product.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/tools/product.js) (refinement detection) | **Only used internally in one handler.** Pipeline stages don't know if user is refining or starting fresh. |
| `product_context.last_search` | [updateLastSearch()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#709-723) in tool handlers | [index.js](file:///c:/Users/chatz/Downloads/eCommerce/be3-ai-transformer/src/index.js) (Stage 0a pagination only) | **Never used for intent scoring.** If user just searched for "phones", pipeline doesn't use this to bias toward phone-related intents. |

### 🔗 Actively Used But Only In Specific Places

| Field | Used In | Not Used In (but should be) |
|---|---|---|
| `conversation_history` | [server.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/server.js) (passed to AI for response generation) | **Never used in pipeline stages.** SchemaResolver doesn't know what the user has been asking about. |
| `session.message_count` | `stateManager` (incrementing), [server.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/server.js) (logging) | **Never used for behavior calibration.** A new user (message 1) gets the same microstate thresholds as a power user (message 50). |
| `last_tools` | [server.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/server.js) (setLastTools after execution) | **Never used for intent scoring.** If the last tool was `cart.add`, the next message "how much?" logically means `view_cart`, but the pipeline doesn't know. |

---

## Part 2: Pipeline Stages & State Access

| Stage | Receives State? | What It Uses |
|---|---|---|
| **Stage 0 (MicrostateRunner)** | ✅ Full state | `microstate`, `reference_map`, `ordinal_list` |
| **Stage 0b (IntelliSense)** | ❌ None | Stateless LLM pre-pass |
| **Stage 1 (FuzzyMatcher)** | ❌ None | Pure text → text correction |
| **Stage 2 (ContextResolver)** | ✅ Partial | `reference_map`, `ordinal_list`, `user_query_map`, `search_context` |
| **Stage 3 (Preprocessor)** | ❌ None | Stateless split/normalize |
| **Stage 4a (EntityExtractor)** | ❌ None | Only uses `storeContext` (catalog), not user state |
| **Stage 4b (SchemaResolver)** | ❌ None | Only uses extracted entities and IDF map |
| **Stage 4.5 (Semantic/Transformer)** | ❌ None | External transformer call, no state |
| **Stage 5 (ParameterExtractor)** | ❌ None | Fills params from entities only |
| **Stage 6 (ParameterBleeder)** | ❌ None | Cross-intent param inheritance (stateless) |
| **Stage 7 (IntentPorter)** | ✅ Minimal | Only `current_intent` for buy→search pivot |
| **Stage 8 (ParameterNormalizer)** | ❌ None | ID normalization only |
| **Stage 9 (ToolMapper)** | ❌ None | Intent → tool mapping config |
| **Stage 10 (MicrostateRegistry)** | ❌ None | Trigger checking only |

> [!CAUTION]
> **12 of 14 pipeline stages are completely state-blind.** They process each message as if the user just arrived. Your deterministic + semantic layers are strong, but they're operating in a vacuum — no memory of what the user has done, wanted, or been shown.

---

## Part 3: Proposed Enhancements

### 🟢 Tier 1 — High-Impact, Low-Risk (Use existing state you already track)

#### 1. **Intent History Bias** — SchemaResolver
**State needed:** `current_intent` + new `intent_history` (last 3-5 intents)
**How it helps:**
- If user's last 2 intents were `product_search`, an ambiguous message like "and the red ones" should strongly bias toward `product_search` over `vendor_contact`
- If user just did `add_to_cart`, "how much?" should bias toward `view_cart` not `get_product_details`
- **Implementation:** Add `+1.5` score boost for intents matching recent history pattern

#### 2. **Cart-Aware Intent Resolution** — SchemaResolver  
**State needed:** `cart.item_count` (already tracked)
**How it helps:**
- If cart is empty, suppress `view_cart`, `start_checkout`, `update_cart_quantity` intents
- If cart has items, boost `start_checkout` when user says "I'm done" or "that's all"
- **Implementation:** `-3.0` penalty for cart intents when cart is empty, `+2.0` boost when cart has items and checkout-adjacent keywords appear

#### 3. **Last-Tool Context** — SchemaResolver or IntentPorter
**State needed:** `last_tools` (already tracked)
**How it helps:**
- After `product.search`, "tell me more about the first one" → `get_product_details` (not `vendor_info`)
- After `cart.add`, "remove it" → `remove_from_cart` (not general product removal)
- **Implementation:** Map last tool to expected follow-up intents, apply `+2.0` boost

#### 4. **Search Context for Entity Extraction** — EntityExtractor
**State needed:** `search_context` (already tracked — category, vendor, attributes)
**How it helps:**
- If user just searched in "Phones" category, "the cheap ones" should extract `clause:cheap` + `category:phones` even without explicitly saying "phones"
- Residual words in entity extraction can be disambiguated using search context
- **Implementation:** Pass `search_context.category` to entity extractor as a "ambient category" hint

#### 5. **Preference-Weighted Results** — ParameterExtractor or ToolMapper
**State needed:** `preferences.favorite_categories`, `preferences.favorite_brands`
**How it helps:**
- If user has searched "phones" 5 times but "food" once, an ambiguous "show me something nice" should default to phones
- Brand preferences can pre-fill brand parameters for ambiguous queries
- **Implementation:** Use `favorite_categories[0]` as default category when no category is extracted

---

### 🟡 Tier 2 — Medium-Impact, Medium-Risk (Requires new state tracking)

#### 6. **Session Phase Detection** — New State: `session.phase`
**Values:** `browsing` → `comparing` → `deciding` → `purchasing` → `post_purchase`
**How it helps:**
- In `browsing` phase: boost `product_search`, `browse_collection`
- In `deciding` phase: boost `get_product_details`, `product_compare`, `get_advice`
- In `purchasing` phase: boost `add_to_cart`, `start_checkout`
- In `post_purchase` phase: boost `order_status`, `get_help`
- **Implementation:** Calculate from `intent_history` pattern + `cart.item_count` + `session.message_count`

#### 7. **Failed-Search Memory** — New State: `failed_queries[]`
**How it helps:**
- If user searched "angel wipes" and got 0 results, don't repeat the same search params
- Can suggest category browsing instead: "I couldn't find 'angel wipes' before. Want to browse our Personal Care section?"
- **Implementation:** Track `{ query, timestamp, result_count: 0 }` in state on zero-result searches

#### 8. **Entity Affinity Map** — New State: `entity_affinity`
**Format:** `{ category: { "phones": 5, "food": 2 }, vendor: { "taye": 3 }, brand: { "samsung": 4 } }`
**How it helps:**
- Weighted disambiguation: "show me the new ones" → phones (affinity 5) vs food (affinity 2)
- Vendor default for `vendor_contact`: if user has mentioned "Taye" 3 times, auto-fill vendor when they say "contact the vendor"
- **Implementation:** Increment on every successful extraction, decay over time

#### 9. **Conversation Topic Tracker** — New State: `active_topics[]`
**How it helps:**
- Tracks what the user is "thinking about" across messages
- Enables better pronoun resolution: if topics = ["crypto", "forex"] and user says "what about the risks?", contextResolver knows it's about crypto/forex, not products
- **Implementation:** Extract topics from IntelliSense or Transformer analysis, store with TTL

#### 10. **Microstate Success Rate** — New State: `microstate_stats`
**Format:** `{ total_opened: 5, total_fulfilled: 3, total_cancelled: 2, avg_messages_to_fulfill: 1.8 }`
**How it helps:**
- If a user cancels microstates 80% of the time, reduce breakthrough threshold (let them escape faster)
- If they always complete, increase confidence in microstates → tighter sandbox
- **Implementation:** Update on [clearMicrostate()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#525-534) with reason

---

### 🔴 Tier 3 — Transformational (Architecture changes)

#### 11. **State-Aware SchemaResolver** — Pass state to scoring
Currently [resolveIntent()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/schemaResolver.js#62-565) receives: `extractionResult, text, idfMap, storeContext`
**Change to:** [resolveIntent(extractionResult, text, idfMap, storeContext, userContext)](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/schemaResolver.js#62-565)

Where `userContext = { current_intent, intent_history, cart, preferences, search_context, session_phase, entity_affinity }`

This one change would allow ALL the Tier 1 and Tier 2 scoring modifications to live inside SchemaResolver.

#### 12. **State-Aware EntityExtractor** — Ambient context entities
**Pass:** `search_context.category`, `search_context.vendor` to entity extractor
**Effect:** When user says "the red one", entity extractor can emit a phantom `category` entity from ambient context, not just from the message text

#### 13. **Predictive Intent Pre-Loading**
**New State:** `predicted_next_intents[]`
After each intent execution, predict the likely next intents based on:
- Intent transition probabilities (learned from usage)
- Current session phase
- Cart state

Use predictions to pre-bias SchemaResolver before the next message even arrives.

---

## Part 4: Cleanup Recommendations

### Remove Dead Code
- Delete `active_flow`, `expecting_input` from `DEFAULT_STATE` and remove deprecated methods ([startFlow](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#320-335), [updateFlow](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#336-351), [completeFlow](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#352-362), [getActiveFlow](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#363-371), [setExpectingInput](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#372-386), [clearExpectingInput](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#401-407))
- Delete `comparison_set` from `product_context`
- Either implement `recently_viewed` tracking (call [addToRecentlyViewed](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#724-750) from `product.getDetails` handler) or delete it

### Wire Up Existing Features
- `conversation_summary` — implement periodic LLM summarization of conversation or delete
- `paused_context` — wire up [resumeContext()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#1216-1237) in server.js or delete
- [learnFromBehavior](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/state/stateManager.js#1091-1134) — extend beyond search/view_product to cover all intents

---

## Part 5: Priority Implementation Order

| Priority | Enhancement | Effort | Impact |
|---|---|---|---|
| 1 | **Cart-Aware Intent Resolution** (Tier 1.2) | 🟢 Small | Immediate UX improvement |
| 2 | **Last-Tool Context** (Tier 1.3) | 🟢 Small | Better follow-up handling |
| 3 | **Intent History Bias** (Tier 1.1) | 🟡 Medium | Smarter disambiguation |
| 4 | **Search Context for EntityExtractor** (Tier 1.4) | 🟡 Medium | Better implicit context |
| 5 | **Cleanup dead fields** (Part 4) | 🟢 Small | Code hygiene |
| 6 | **Session Phase Detection** (Tier 2.6) | 🟡 Medium | Behavioral intelligence |
| 7 | **Entity Affinity Map** (Tier 2.8) | 🟡 Medium | Personalization |
| 8 | **State-Aware SchemaResolver** (Tier 3.11) | 🔴 Large | Foundational upgrade |
| 9 | **Failed-Search Memory** (Tier 2.7) | 🟡 Medium | Error recovery |
| 10 | **Predictive Intent Pre-Loading** (Tier 3.13) | 🔴 Large | Proactive intelligence |
