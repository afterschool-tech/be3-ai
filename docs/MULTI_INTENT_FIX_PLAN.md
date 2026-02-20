# Multi-Intent Resolution — Phased Fix Plan

Solve one phase at a time. **Test after each phase** before moving to the next.

---

## Test Suite (Run After Each Phase)

Use these 5 statements to validate fixes:

| # | Statement | Expected behavior |
|---|-----------|-------------------|
| 1 | `show me iphone and add the first one to cart` | Search iphones → add **only the first** result to cart (1 item) |
| 2 | `search fro budget phones and then compare the top two` | Search budget phones → compare **first 2 results** (fuzzy fixes "fro") |
| 3 | `add 2 samsung tablets to caert and show me iphones` | Add 2 Samsung tablets → show iphones (correct product resolution) |
| 4 | `show me my cart and remove the second item` | View cart → remove **2nd cart item** |
| 5 | `find cheap smartphones and then add the white one and the flagship one` | Search cheap smartphones → add **2 products** (white + flagship) to cart |

---

## Phase 1: Same-Turn Multi-Intent — Unresolved "one" / "ones"

**Problem:** In a single turn ("show me iphone and add the first one to cart"), reference_map / ordinal_list / search_context are empty when we resolve add_to_cart, because tools haven’t run yet. "The first one", "the white one" can’t resolve → cart.add gets product_id="one" → 404.

**Long-term solution:** STACK (sequential tool execution with state updates between steps). When we implement STACK, intent 2 will be resolved after intent 1’s tool runs, so context will be populated and this will work naturally.

**Current solution (Option A — Guard + skip + message):**
- [ ] **Guard:** Before running add_to_cart (and similar tools that need resolved references), detect clearly unresolved identifiers (e.g. literal `"one"`, `"ones"` with no matching reference_map/ordinal).
- [ ] **Skip:** Do not call the cart API when the identifier is unresolved in a same-turn multi-intent case.
- [ ] **Message:** Response layer (or injected hint) tells the user: e.g. *"I found these options. Say *add the first one* or *add the white one* in your next message to add it to cart."*

**Test after Phase 1:** Same-turn "show me iphone and add the first one" → search runs, no failed cart call, reply instructs user to say "add the first one" next.

---

## Phase 2: Prefix → Grouped Ordinals + Fallback Microstate

**Problem:** "first one" / "second one" work when in reference_map. "First two", "top two" don’t — we have no **prefix + nominal** system (prefix → grouped ordinals). "Second item" (cart) also needs ordinal → cart_item_id.

**Solution:**

1. **Prefix → grouped ordinals (proper logical system)**
   - [ ] Define prefix semantics: e.g. `first two` / `top two` → indices [1, 2]; `last three` → last 3 indices; `first one` → [1]; etc.
   - [ ] Map these indices to product IDs (or cart_item_ids) using ordinal_list / search_context.product_ids / cart items.
   - [ ] Use this for **product_compare** ("compare the top two"), **add_to_cart** ("add the first two"), **remove_from_cart** ("remove the second item" → 2nd cart item).

2. **Fallback when we can’t resolve**
   - [ ] When ordinal/group can’t be resolved (no context, ambiguous, or unsupported phrasing), open a **special microstate** that:
     - Presents **only ordinals** (1st, 2nd, 3rd, …) with their **product names** — no raw context or reference maps.
     - Asks the user to specify which one(s) by **product name** or **number** (e.g. "the first one" or "2").
   - [ ] Microstate completes the action (compare / add / remove) once the user picks.

**Test after Phase 2:** Statements #2 (compare top two) and #4 (remove second item) work; edge cases open ordinal-choice microstate.

---

## Phase 3: Param Bleeding & Expansion for add_to_cart

**Problem in plain terms:** When the user says "add the **first** one" (two-turn: we already have search results), we currently inject **all** context product IDs into `params.products` and the toolMapper expands to one cart.add per product — so we get 3 cart.add calls instead of 1. The user asked for only the *first* one, so we should inject only that one product ID (or at most the ordinal-matched subset), not the full list.

**Fix areas:**
- [ ] **Stage 8a:** When the user said an ordinal ("first one", "first two"), inject only the matching product ID(s) into `params.products`, not the full context list.
- [ ] **Expansion logic (toolMapper):** No change needed if Stage 8a injects the right list (one ID for "first one", two for "first two", etc.).
- [ ] **Param bleeding:** Avoid products from a later intent bleeding into product_search params so search doesn’t get a huge products array.

**Test after Phase 3:** Two-turn: "show me iphones" then "add the first one" → only 1 cart.add (first result). Statement #1 in same-turn is handled by Phase 1 (guard + message) until STACK.

### Scenarios: Why Phase 3 is needed (Phase 2 vs Phase 3)

All scenarios: **Turn 1** was "show me budget phones" → search ran → we have **5 product IDs** in `search_context` (e.g. Phone A, B, C, D, E). **Turn 2** the user says one of the following.

---

**Scenario A — User says: "add the first one"**

| | Without Phase 3 (Phase 2 only) | With Phase 3 |
|--|--------------------------------|--------------|
| **Path** | Depends on earlier pipeline. (1) If reference resolution already replaced "first one" with a product name/ID → we have 1 product → 1 cart.add. (2) If not, params still have e.g. `product_name: "first one"`. Stage 8a then hits the **pronoun fallback** ("one" = pronoun) and injects **all 5** product IDs. | Stage 8a has an explicit rule: "message says 'first one' → inject **only** the 1st product ID." So we set `params.products = [id of Phone A]` and never run the pronoun fallback. |
| **Tool calls** | (1) 1× cart.add. (2) **5× cart.add** (one per result). | **1× cart.add** (Phone A only). |
| **User sees** | (1) "Added Phone A." (2) "Added Phone A, B, C, D, E." (wrong). | "Added Phone A." (correct). |

Phase 3 guarantees (2) never happens: "first one" always means one product.

---

**Scenario B — User says: "add the first two"**

| | Phase 2 (grouped ordinals) | Phase 3 |
|--|----------------------------|--------|
| **What happens** | Stage 8a **grouped ordinal** rule: "first two" → indices [0,1] → `params.products = [id of A, id of B]`. | Same. Phase 3 does not change this. |
| **Tool calls** | 2× cart.add (A and B). | 2× cart.add (A and B). |

Phase 2 already fixes "first two". Phase 3 does not change it.

---

**Scenario C — User says: "add the one"** (no ordinal: just "one")

| | Phase 2 | Phase 3 |
|--|---------|--------|
| **What happens** | Ordinal-choice microstate opens: "You have 5 options. Which one? Say 1–5 or 'the first one'." User picks → then we add that one. | Same. Phase 3 does not change this. |
| **Tool calls** | 1× microstate prompt, then (after user reply) 1× cart.add. | Same. |

Phase 2 already handles bare "one". Phase 3 does not change it.

---

**Scenario D — User says: "add the second one"**

| | Without Phase 3 | With Phase 3 |
|--|-----------------|--------------|
| **Path** | Same as Scenario A. Either (1) reference resolution gives one product → 1 cart.add, or (2) pronoun fallback injects **all 5** → 5× cart.add. | Single-ordinal rule: "second one" → inject only 2nd product ID → `params.products = [id of Phone B]`. |
| **Tool calls** | (1) 1× or (2) 5×. | **1× cart.add** (Phone B only). |

Phase 3 guarantees "second one" = one product (the 2nd), not all five.

---

**Summary**

- **Phase 2:** "first **two**" (group), "the **one**" (ordinal-choice), "second **item**" (cart). It does **not** define "first **one**" / "second **one**" as "only that single product."
- **Phase 3:** Adds the rule: "first one" / "second one" / "last one" → inject **only that one** product ID. So we never let those phrases hit the pronoun fallback (which would add the full list).

---

## Phase 4: "Add X and Y" → One add_to_cart with Two Products (Intent Porting)

**Problem:** "add the white one and the flagship one" is split on "and" into 3 statements → product_search, add_to_cart, **product_search** (third is wrong). The third is a single product name with no add verb, so it resolves to product_search by default. We want the third to be add_to_cart (add both products).

**Why not only a split guard?** Splitting happens way before intent resolution. We already have a guard for **compare** (e.g. "compare phone1 and phone2") so we don’t split and get one compare intent. For **add**, we can’t rely on "and" always being there ("add the white one" has no "and"), and the only rule we have is: a bare product name as intent defaults to product_search. So we use **intent porting** after resolution.

**Proposed solution — Intent porting:**
- [ ] **Rule:** If the previous intent is **add_to_cart** and the next intent(s) are **product_search** that are really just a **single product name** (no real search query — no "show me", "find", category from user; just product_name/products), then **port** that intent to add_to_cart (add that product). Repeat for all consecutive intents that match: port every "naked" product_search after add_to_cart to add_to_cart until the condition is false.
- [ ] **Result:** product_search, add_to_cart(white one), product_search(flagship one) → product_search, add_to_cart(white_id), add_to_cart(flagship_id). **Do not merge** — keep one tool call per ported product so we can see exactly what ported in the tool list (better for debugging).
- [ ] **Safety:** Only port when the product_search is a "naked" product reference (single product name, no explicit search phrasing). Do **not** port "show me the flagship one" or "find the flagship one" — those stay as search. So: port when intent is product_search and the *reason* it’s search is the default (residual product name), not an explicit discovery verb.
- [ ] **Question guard (nuance):** Do **not** port when the statement looks like a question — e.g. "what about the flagship one?", "how about X?", "tell me about X?". Those may mean "tell me about" not "add it." Only port when the follow-up is not question phrasing so we avoid wrongly adding on "what about X."

**Test after Phase 4:** Statement #5 → 2 intents (product_search, add_to_cart with 2 products).

---

## Phase 5: Product Resolution / Search Fallback — N/A (Clause Coverage)

**Not a pipeline bug.** "samsung tablets" → Tecno is due to **clause system coverage**: there is no Samsung clause yet. Search for "samsung" alone does match Samsung products; "tablets" is a known category and gets matched first, and Tecno is first in that list. This will fix naturally when a Samsung (brand) clause is added. No code fix in this plan.

---

## Phase 6: Fuzzy Correction — No Change (Non-Stripping Rule Only)

**Decision:** Leave the fuzzy matcher as is. We don’t have to forgive all spelling mistakes (e.g. "fro" for "for" can stay uncorrected). If any change is made at all: apply the **non-stripping rule** — don’t strip or normalize spellings. No new typo forgiveness or Levenshtein tweaks in this plan.

---

## Phase 7: Response Layer — Surface Tool Failures

**Problem:** Bot never tells user when cart.add, product.compare, or cart.remove fail.

**Fix areas:**
- [ ] **generateResponseFromTools / personality prompt:** Include tool success/failure in context
- [ ] **Tool result inspection:** If any tool returned `error`, instruct LLM to acknowledge it
- [ ] **Fallback message:** "I added X to your cart, but I couldn’t remove the second item — try again or describe it differently."

**Test after Phase 7:** When a tool fails, the reply should mention it.

---

## Execution Order

| Phase | Focus | Depends on |
|-------|-------|------------|
| 1 | Same-turn multi-intent: Guard + skip + message (STACK later) | — |
| 2 | Prefix→grouped ordinals + ordinal-choice microstate fallback | — |
| 3 | Param bleeding & expansion | 1, 2 |
| 4 | Intent porting: add_to_cart + naked product_search → add_to_cart | — |
| 5 | N/A — clause coverage (add Samsung clause when needed) | — |
| 6 | No change — non-stripping rule only if anything | — |
| 7 | Response layer (tool failures) | — |

Phases 1, 2, 4, 5, 6, 7 can be done in parallel or any order. Phase 3 benefits from 1 and 2.

**Recommended sequence:** 1 → 2 → 3 → 4 → 5 → 6 → 7 (tackle resolution first, then splitting, then polish).

---

## Progress Log

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 1 | ✅ Done | | Guard + skip in orchestrator; message in generateResponseFromTools |
| 2 | ✅ Done | | Grouped ordinals (top two, first two, last N); cart ordinal (second item); ordinal-choice microstate |
| 3 | ✅ Done | | Single ordinal injection: "first one"/"second one"/"last one" → one product ID only |
| 4 | ✅ Done | | Intent porting: naked product_search after add_to_cart → add_to_cart; question guard |
| 5 | ⬜ Pending | | |
| 6 | ⬜ Pending | | |
| 7 | ⬜ Pending | | |
