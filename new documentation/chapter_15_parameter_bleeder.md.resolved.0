# Chapter 15 — Parameter Bleeder

## The Problem It Solves

When a user sends a single compound message like `"add the iPhone 16 to my cart and compare it with the Galaxy S25"`, the pipeline splits it into two sub-statements and runs parameter extraction on each one independently. The second sub-statement — `"compare it with the Galaxy S25"` — contains only one product; the pronoun `"it"` was already resolved upstream by the context resolver, but the comparison requires **two** products to make sense. The Parameter Bleeder exists to fill that gap.

More generally: when a user chains intents together, they frequently rely on shared context rather than repeating themselves. They say `"add to cart"` after `"show me the iPhone 16"` precisely because the product is already established in the conversation. The bleeder formalises this shared context at the parameter level, letting each intent pick up what it needs from the intent that preceded it.

---

## When the Bleeder Runs

The bleeder runs as Stage 6, immediately after all sub-statements in a message have completed their own parameter extraction. At that point, all intents have their best-effort parameters — some complete, some with holes. The bleeder is the last pass before normalisation and tool mapping.

A single-intent message is returned immediately with no work done. There is nothing to bleed from when there is only one statement.

---

## The Core Logic: Backward Scanning

The bleeder iterates over every resolved statement from the **second one onward**. For each statement, it consults the intent registry to find which of that intent's parameters are marked as `required`. Only required parameters participate in bleeding — optional parameters are never inherited. This is a deliberate design choice: optional parameters are optional precisely because the intent can function without them, so inheriting them from a previous statement could introduce false precision.

For each required parameter that is either missing or incomplete in the current statement, the bleeder scans backwards through the list of already-processed statements, starting from the one immediately before the current one and working toward the beginning. The scan stops as soon as it finds a preceding statement that has a usable value for that parameter. Crucially, it always stops at the **nearest** predecessor — not the one with the richest value, but the most recent one. This mirrors conversational proximity: a user referring to something implicitly is almost always referring to what they just said, not something from three exchanges ago.

---

## Two Inheritance Modes

### Mode 1 — Direct Inheritance

When the required parameter is completely absent (null or undefined), the value from the preceding statement is copied directly into the current statement's extracted params. A `bledParams` audit entry is created recording which parameter was inherited, what value was taken, from which preceding statement index it came, and that the action was `"inherited"`.

**Why this matters in practice**: A user might say `"show me the iPhone 16. now add it to my cart"`. The context resolver turns `"it"` into the resolved product, and the `add_to_cart` statement gets `product_name` correctly. But if the user wrote `"show me the iPhone 16 then add to cart"` — without any pronoun to resolve — the `add_to_cart` statement would have no product at all after parameter extraction. The bleeder rescues it by copying `product_name` from the preceding `product_search` statement.

### Mode 2 — Array Merge (Incomplete Products)

This mode exists exclusively for the `products` array parameter when the current intent is `product_compare` and the `products` array has fewer items than the intent's declared `minProducts` threshold. Rather than replacing the current array, it **prepends** the preceding statement's products array and deduplicates the result.

**Why prepend rather than append?** The preceding statement's product typically represents a known, resolved entity — something the user already established. The current statement may have resolved one product of its own. Prepending the inherited products means the compare tool receives them in temporal order: the earlier-mentioned product comes first, which typically matches the user's mental framing.

**The `product_compare` guard**: The bleeder only applies the merge mode to `product_compare`, and only when the existing array length is below `minProducts`. For `add_to_cart`, even if there is a `products` array, a single-item list is intentional — the user is adding one thing. Merging in products from a prior search result would be wrong. This is why the `isIncomplete` condition explicitly checks for `product_compare` as the intent name.

---

## Real-World Example Walkthrough

**User message**: `"compare the Galaxy S25 with the iPhone 16 and add both to cart"`

After statement splitting:
1. `"compare the Galaxy S25 with the iPhone 16"` → `product_compare`, `products: ["uuid-galaxy", "uuid-iphone16"]`
2. `"add both to cart"` → `add_to_cart`, `products: []`  (the word "both" was not resolved to UUIDs at extraction time)

After the bleeder runs on statement 2:
- `products` is required for `add_to_cart` and the current value is `[]` (empty)
- Looks back at statement 1: `products: ["uuid-galaxy", "uuid-iphone16"]`
- Copies the array directly → `add_to_cart.products = ["uuid-galaxy", "uuid-iphone16"]`
- Records: `{ param: "products", inherited: [...], fromStatement: 0, action: "inherited" }`

---

## Another Example: The Partial Compare

**User message**: `"search for smartphones and compare the first and second"`

After statement splitting and parameter extraction:
1. `"search for smartphones"` → `product_search`, `products: []`, `category: "cat-smartphones"`
2. `"compare the first and second"` → `product_compare`, `products: ["uuid-first", "uuid-second"]` (resolved by ordinals in context resolver)

In this case the bleeder finds nothing to do — the compare intent is already complete. But if ordinal resolution had only resolved one product at extraction time (because `search_context` wasn't available yet), the merge mode would kick in and combine the one resolved UUID with the first product from the search statement.

---

## The Audit Trail

Every inheritance operation is logged in `current.bledParams`, an array attached to the resolved statement object. Each entry records: the parameter name, the value that was inherited, the index of the preceding statement it came from, and whether it was a direct `"inherited"` copy or an array `"merged"`. This trail is available to downstream consumers and appears in the debug logs under the pipeline telemetry.

---

*Next: Chapter 16 — Intent Porter & Safety Gating*
