# user_query_map — Safety + Data Model Plan

## Goal
Use `user_query_map` to respect the user’s terminology (e.g. “spaghetti”) when mapping later actions (e.g. “add spaghetti to cart”) to the correct product(s), without causing sticky mis-routing or unintended cart actions.

## Current Behavior (as of today)
- `product.search` writes successful queries into `state.user_query_map` via `stateManager.updateUserQueryMap()`.
- `intentPorter` checks `user_query_map` first, then `reference_map`, to decide whether to port a search-like utterance into a purchase intent (e.g. `add_to_cart`).
- `user_query_map` is **volatile** (memory-only):
  - Explicitly excluded from Redis persistence (`delete stateForRedis.user_query_map`).
  - Resets when `be3_ai` restarts or if state is rehydrated from Redis.

## Risk Assessment: "Lock down" / sticky wrong mapping
Potential UX failures that can feel like lock-in:
- Stale mapping: user once searched "spaghetti" → specific product ID, later means a different spaghetti product, but porting still fires.
- Cross-topic reuse: mapping persists while user changes category/topic.
- Over-eager porting: bot executes `cart.add` for a weak match without confirming.

Volatility reduces persistence across restarts/instances, but **does not fully prevent stale mappings within a running process**.

## Recommended Safeguards
### 1) Per-entry TTL (not just session TTL)
Store an object per query instead of a raw string:
- `user_query_map[query] = { ids: string[], ts: ISOString, scope: { category_id?: string, tag?: string } }`

Eligibility rules:
- Only trust mapping if `now - ts <= X minutes` (e.g. 10 minutes) OR within last N messages.

### 2) Scope to recent search context
Only apply `user_query_map` when:
- There is a fresh `search_context`, OR
- `product_context.last_search` is present and recent.

### 3) Never auto-port on ambiguity
If mapping resolves to multiple IDs:
- Do NOT port to `cart.add`.
- Trigger disambiguation (microstate or quick "Reply 1-3" choice).

### 4) Confirm when confidence is weak
If mapping is old or scope mismatched:
- Return product cards again and ask confirmation rather than auto-adding.

## Handling "product arrays" / multi-match
### Data model
- Prefer storing `ids` as an array.
- Store `primary_id` only when the result is truly singular.

### Resolver behavior
Update `resolveUserQueryToProductId()` to return:
- `string` (single ID, safe)
- OR `string[]` (ambiguous set)

Update `intentPorter` to:
- Auto-port only on single-ID result.
- Escalate to disambiguation when array length > 1.

## Persistence decision (later)
If you want the feature to survive restarts, persist to Redis safely only after safeguards:
- per-entry TTL
- scope keys
- ambiguity handling
- confidence/recency gating

## Candidate implementation touchpoints
- `src/state/stateManager.js`
  - `updateUserQueryMap()`
  - `resolveUserQueryToProductId()`
- `src/services/intentResolver/pipeline/intentPorter.js`
  - gating rules + ambiguity path
- `src/services/intentResolver/pipeline/microstateRunner.js` / microstate registry
  - add a small disambiguation microstate if needed
