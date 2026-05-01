# Chapter 16 — Intent Porter & Safety Gating

## The Role of the Porter

By the time a resolved intent reaches the porter, it has already passed through scoring, parameter extraction, bleeding, and normalisation. The schema resolver has decided what the user wants. The parameter extractor has filled in the slots. So why is there still a stage that can change the intent name entirely?

The answer is that intent scoring is pattern-based — it classifies based on signals in the text. But some of the most important intent pivots can only be determined from **state**, not from text. The most critical example: a user who says `"I want the iPhone 16"` with a purchase verb and a product name the system has seen before is not browsing — they are buying. The scorer cannot know this because it does not know whether that product exists in the user's session history. The porter does.

The porter also handles a structural anomaly in multi-intent messages: when the user lists products after an initial cart action, those product references look like searches to the scorer but are actually continuations of a purchase flow. These require positional awareness — knowing what the previous intent was — which the scorer, operating on one statement at a time, cannot provide.

---

## Rule 1 — Degradation to Conversation

The first thing the porter checks is whether an intent is so weakly supported that keeping it would generate a bad tool call. It does this by examining three metrics that the schema resolver attaches to every resolved intent:

- **Signal density**: a measure of how many intent-specific action words were found in the text. Zero means no keywords at all fired for this intent.
- **Entity count**: how many typed entities (products, categories, brands, clauses) were extracted. Zero means the text was essentially empty of structure.
- **Transformer gap**: the margin between the top transformer classification and the second place. A gap below 0.1 means the classifier was nearly equally uncertain between two intents.

When all three of these are simultaneously at their worst — zero signal density, zero entities, transformer gap below 0.1 — and the text does not contain any discovery phrasing (the user is not clearly exploring), the porter concludes that the scoring system was essentially guessing. It downgrades the intent to `conversation`, marking it `_downgraded: true` and preserving `_original_intent` for logging. The conversation tool is a safe fallback: it allows the personality layer to generate a natural response without attempting to invoke a business tool on uncertain data.

This rule is narrowly targeted. It only fires when all three thresholds fail simultaneously. A message with weak keyword signals but a detected product entity would not degrade. A message with zero entities but strong discovery phrasing would not degrade. The combination of all three failing at once is the only reliable indicator that the system genuinely has nothing to work with.

---

## Rule 2 — Phase 4: Consecutive Cart Addition

Consider the message: `"add the AirPods Pro to my cart and the Samsung Galaxy Buds"`. After statement splitting, the first statement resolves cleanly as `add_to_cart` with a product. The second statement — `"the Samsung Galaxy Buds"` — contains no action verb. The scorer sees a product name with no command attached and classifies it as `product_search`, which is technically the closest match.

But semantically, the user is clearly continuing a cart action. They listed a second product in the same breath. Phase 4 detects this pattern by tracking the previous intent name across the loop. When it sees `product_search` immediately following `add_to_cart`, it checks whether the search is "naked" — a product reference with no discovery verb in the matched keywords. If it is naked, and the statement text does not look like a question (`"what about the Samsung?"` would be blocked), it ports the second statement to `add_to_cart`.

This porting does not require confirmation. The positional signal is strong enough: the user explicitly said "add X" in the same message, and the second item is structurally identical in form to the first. No safety gate is needed because the context makes the intent unambiguous.

---

## Rule 3 — Stage 2 Resolution Porting (Confirmed Product + Purchase Verb)

This rule handles a specific pattern: after a product search, the user refers to a result using a relative descriptor rather than its name. `"I want the cheapest one"`, `"give me the first"`, `"I'll take the blue one"`. These phrases were processed by the context resolver (Stage 3.1) before parameter extraction, which resolved the relative reference to a product ID using the `reference_map`. That resolved ID is carried into the intent's `stage2Resolutions` array.

When the porter sees a `product_search` intent that carries exactly one Stage 2 resolution, and the text contains purchase phrasing, and it is not a question phrase, it ports the intent to `add_to_cart`. However, unlike Phase 4, this porting always includes `_require_confirmation: true`. The reason is that Stage 2 resolution involves an inference — the system inferred that `"the cheapest one"` maps to a specific product. An inference-based purchase action should never be automatic. The user must explicitly confirm.

The porter enriches the confirmation context by looking up the resolved product ID in the last known search results and extracting the product name, price, and vendor. This context powers the confirmation card that the user sees: `"Just to confirm — add iPhone 16 Pro (₦450,000, Dareymi) to your cart?"`. Without this context, the confirmation would be abstract and unhelpful.

---

## Rule 4 — Reference Map / Query Map Porting

This is the most common porting path. It activates when a `product_search` intent contains an explicit purchase verb in its matched keywords — words like `"buy"`, `"purchase"`, `"order"`, `"grab"`, `"i'll take"`, `"give me"` — and the intent passes both the discovery phrasing guard and the question phrase guard.

The guard tests are necessary because purchase verbs also appear in non-purchase contexts. `"can you show me where to buy the iPhone?"` contains `"buy"` but is clearly a discovery request. `"what about buying the Samsung?"` contains `"buying"` but is a question. These must not be ported.

When the guards pass, the porter attempts to resolve the product name to a persistent product ID through three lookup levels:

**Level 1 — User Query Map**: The `stateManager.resolveUserQuery()` call checks a session-specific map of the user's own terminology. If the user searched for `"Galaxy"` earlier in the session and that search returned a specific product, `"Galaxy"` is recorded in the query map pointing to that product's ID. This respects how the individual user names things, which may not match canonical product names or slugs. The query map is session-only and volatile — it does not persist across sessions. Critically, if the query maps to multiple products (a comma-separated list), the porter does not port. Ambiguous references cannot be safely converted to purchase actions.

**Level 2 — Reference Map (Exact)**: The `reference_map` is the global session state for entity-to-ID mappings. The porter checks both the slug form (`product_name` converted to snake_case) and the raw lowercase string. A direct hit here means the product was definitively resolved in the current session.

**Level 3 — Reference Map (Substring)**: If exact lookup fails, the porter scans the entire reference_map for keys that are substrings of the query, or queries that are substrings of the keys. This catches cases like a user saying `"spaghetti"` when the reference_map key is `"home_made_spaghetti"`. However, this level explicitly skips generic ordinal keys — `"it"`, `"this"`, `"first"`, `"the_second_one"` and similar — because matching these in a substring scan would produce incorrect results.

When any level produces a `knownId`, the porter ports the intent to `add_to_cart` with `_require_confirmation: true` and populates `_confirm_context` from the last search results. If no level finds an ID, the intent stays as `product_search`. No speculative porting happens.

---

## The Safety Philosophy Behind `_require_confirmation`

Rules 3 and 4 both require confirmation before executing the cart add. This is not just a UX nicety — it is a safety architecture decision. Purchase actions are irreversible in the sense that they affect the user's cart state and may trigger payment flows or inventory holds downstream. The pipeline should never add a product to a user's cart based on an inference alone, no matter how confident that inference is.

The confirmation flag sets up a `confirm_add_ported` microstate. When this microstate is active, the next message from the user is processed by the microstate runner, not the normal pipeline. If the user confirms, the microstate fulfils and executes the `cart.add` tool with the resolved product ID. If the user denies, the microstate clears and the system falls back to a conversation response. If the user says something unrelated (a soft sandbox breakthrough), the microstate clears and the normal pipeline handles the new message.

This means the worst case is always a conversational fallback — never an accidental purchase.

---

## The Porter's Guard Hierarchy (Complete Decision)

Every `product_search` intent goes through guards in this exact order:

1. Does the intent have zero signal density, zero entities, and a transformer gap below 0.1? → Degrade to `conversation`. Stop.
2. Is the immediately preceding intent `add_to_cart`, and is this a naked product reference with no question phrasing? → Port to `add_to_cart` (Phase 4, no confirmation). Stop.
3. Does the text contain discovery phrasing (show, see, find, browse, etc.)? → Keep as `product_search`. Stop.
4. Does the intent carry exactly one Stage 2 resolution and purchase phrasing? → Port to `add_to_cart` with confirmation. Stop.
5. Does the matched keyword list contain a purchase verb? If not → Keep as `product_search`. Stop.
6. Can the product name be resolved to an ID via query map or reference map? → Port to `add_to_cart` with confirmation. Stop.
7. No resolution found → Keep as `product_search`.

The order matters. Discovery phrasing can only block Stage 2 resolution porting (Rule 3) if checked before Rule 3's purchase verb check. Phase 4 must run before any of the `product_search` purchase verb checks, because its positional rule supersedes them.

---

*Next: Chapter 17 — Parameter Normalizer*
