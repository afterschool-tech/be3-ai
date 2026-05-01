# Chapter 20 — Microstates: Conversational Slot-Filling

## The Design Philosophy

A microstate is the system's answer to an intent that cannot be completed with the information available in the current message. Rather than silently failing, guessing, or returning an error, the system enters a conversational sub-mode in which subsequent user messages are processed not by the full pipeline but by a focused runner that knows exactly what information is still needed.

The design goal is to make this feel natural. The user should experience it as the AI asking a follow-up question — not as hitting a wall. The microstate runner achieves this by interpreting the user's reply with the same intelligence the full pipeline uses (entity extraction, selection matching, ordinal resolution), but within a constrained context where the goal is known and the missing slot is specific.

Microstates are also the mechanism that makes it safe to run deferred confirmations. When the intent porter marks a ported intent with `_require_confirmation: true`, a microstate is the gate that catches the user's yes or no before any cart action executes. The microstate is not just a question prompt — it is an execution checkpoint.

---

## The Microstate Object

A microstate lives in Redis under the user's session key. Its structure defines everything the runner needs to process messages without re-running the full pipeline:

**`id`**: A unique identifier generated when the microstate opens, used for logging.

**`type`**: The category of microstate. This determines which response utilities are tried first. The type `"ordinal_choice"` signals that the user will likely respond with a number or position word. The type `"confirmation"` signals a yes/no response. The type `"missing_query"` signals a free-text product name is expected. The type `"tool_pagination"` signals navigation tokens are the expected input. The type names are used by the runner to route response analysis.

**`intent`**: The intent name that will be executed when the microstate fulfils. The runner uses this to call `toolMapper.mapToTools()` at the right moment and to run `parameterNormalizer.normalizeParameters()` on the accumulated params.

**`tool`**: The tool to call for re-prompt responses. Usually `"microstate.disambiguate"` — a presentation tool that renders a question with options and control buttons for the personality layer.

**`sandbox`**: Either `"soft"` or `"hard"`. Soft sandboxes allow unrelated intents to break through; hard sandboxes do not. Most product-related microstates are soft, because if the user suddenly asks about something completely different, the system should respond to that rather than stubbornly asking for a product name again. Confirmation microstates for cart actions are hard — the user must answer yes or no; a vague redirect would leave the cart in an ambiguous state.

**`confidence`**: An integer that starts at a value set by the intent config (typically 3) and is decremented each time the user sends a message that contributes no new parameter information. When confidence reaches zero, the microstate expires. This prevents the system from re-prompting forever on genuinely unhelpful inputs.

**`params`**: The accumulated parameter object. Everything the intent has captured so far lives here. When the microstate opens, `params` is seeded with whatever was already extracted — the product name if it was detected, the category if it was resolved, the product IDs if Stage 2 resolution worked. Over successive turns, more fields are filled in as the user responds.

**`options`**: An array of selectable options to display in the UI (rendered as buttons). These may be present from the moment the microstate opens (e.g., a list of disambiguated vendor choices) or injected dynamically by the feature system on each turn.

**`contract`**: The fulfillment specification. Contains `onFulfilled` (the list of parameter names that must be non-empty before execution), `maxMessages` (the hard turn limit), `messagesUsed` (the current counter), `escalation` (an intent name to execute on termination if set), and `onKeyword` (the termination keyword list).

**`features`**: An array of active feature descriptors. This is where the microstate's dynamic behaviour is configured. See the Features section below.

**`breakthrough`**: Configuration for soft sandbox breakthrough behaviour, including `minScore` (how confident the new intent must be) and `blockIntents` (intents that are never allowed to break through even if they score above the threshold).

---

## The Runner Lifecycle (Turn by Turn)

Every message arriving while a microstate is active is intercepted by `microstateRunner.run()`. What happens depends on what the user said and what state the microstate is in.

### Engineered Cancel Token

The runner checks first for `__flow:cancel__` — an underscore-delimited token that the UI injects when the user clicks a Cancel button. This is the deterministic exit path. It does not go through any ambiguity resolution. The microstate is cleared immediately. If the microstate has an `escalation` intent configured, that intent is executed with the microstate's accumulated params — so, for example, cancelling an add-to-cart confirmation might trigger a fallback product search. If there is no escalation, the result is empty tools and `microstate_cancelled: true`.

### Navigation Tokens

Before keyword checking, the runner handles navigation tokens (`__nav:more__`, `__nav:prev__`, `__paging:next__`) for microstates that support pagination. There are four navigation handlers executed in priority order:

The **feature-driven store rotation** handler runs when the microstate has a `suggest_from_store` feature active. It advances the offset into the store items list (categories or vendors) by the feature's configured `limit`, wraps around if past the end, and re-injects a fresh window of options. The updated options are immediately synced back to Redis so that the user's next selection (ordinal or text) resolves against the new window.

The **feature-driven product rotation** handler runs when `suggest_related_products` is active. It calls the feature provider to fetch the next page of products from the current category, or advances to the next category in the traversal sequence if the current one is exhausted.

The **tool pagination** handler runs for microstates of type `"tool_pagination"`. These microstates are opened when a search result has multiple pages — `more` increments the `page` param and re-calls the original tool. This is pure pagination: no re-prompting, no new parameter collection.

The **legacy list paging** handler is a fallback for older-style microstates that hold a full `_all_options` list in params. It shifts the display window without a live API call.

### Termination Keywords

After navigation, the runner checks whether the cleaned text matches any of the keywords in `contract.onKeyword` — typically `["cancel", "stop", "nevermind", "forget it"]`. A keyword match triggers the same escalation/clear logic as the engineered cancel token, but with one difference: without an escalation, this path returns `handled: false` rather than `handled: true`. This allows the normal pipeline to process the user's message as a new intent — for instance, `"never mind, search for laptops"` terminates the microstate and lets the search proceed normally.

### Response Analysis

The runner runs four response utilities in parallel on the cleaned text:

`resolveYesNo()` detects affirmative and negative signals. It handles not just explicit `"yes"` and `"no"` but their natural language variants: `"yeah"`, `"yup"`, `"absolutely"` map to `"yes"`; `"nah"`, `"nope"`, `"don't"` map to `"no"`. The result is `"yes"`, `"no"`, or `"ambiguous"`.

`resolveOrdinal()` converts position words and numerals to 1-based integers. `"first"` → 1, `"second"` → 2, `"7"` → 7, `"last"` → -1 (special sentinel for last position). This covers the ordinal responses in choice microstates.

`resolveSelection()` and `resolveMultiSelection()` match the text against the current `microstate.options` array. These utilities use fuzzy substring matching so that a user typing `"iPhone"` will match an option labelled `"iPhone 16 Pro Max"`. Selection returns a single match; multi-selection parses lists and conjunctions to return multiple matches.

`resolveEngineeredToken()` scans the raw (un-cleaned) text for `__namespace:command__` patterns emitted by UI buttons.

### Soft Sandbox Breakthrough

For soft-sandbox microstates, the runner performs a quick intent resolution on the text — running entity extraction and schema resolution — before doing any entity extraction for param-filling purposes. This is a deliberate ordering: if the user has said something that is clearly a different, strong intent, the runner should know this before attempting to fill slots with what the user said.

The breakthrough decision uses three conditions, all of which must be true:

1. The winning intent is different from the microstate's current intent.
2. The winning score is above `minScore` (default 2.5) and specifically higher than the microstate's own intent would score on this message. This prevents a low-confidence signal from breaking a microstate that the microstate's own intent would also explain.
3. The winning intent is not in the `blockIntents` list.
4. The winning intent's required parameters do not overlap with the microstate's `onFulfilled` params. This prevents a collision where the user says a vendor name while the microstate is asking for a vendor — the new intent would score high for `vendor_search` because it also wants a vendor name, but the overlap guard recognises this as input to the microstate rather than a subject change.

If breakthrough passes, the microstate is cleared and the runner returns `handled: false`, handing control back to the normal pipeline.

### Entity Extraction and `buildNewParams()`

If no breakthrough occurs, the runner runs entity extraction on the cleaned text. The extracted entities — categories, vendors, brands — are mapped to params in a straightforward way. But the more nuanced param building happens in `buildNewParams()`, which has several important sub-systems:

**Yes/No Confirmation Mapping**: When the `contract.onFulfilled` list includes `"confirmation"` and the user has said something unambiguous, `newParams.confirmation` is set to `true` or `false`. This is the mechanism behind the porter's confirmation gate.

**Selection Mapping**: When a selection was resolved (the user picked from the displayed options), the matched value is written to the first unfilled parameter in `onFulfilled`. For `product_compare`, selections are appended to the existing `products` array rather than replacing it, because the compare intent needs two products collected across potentially two separate turns.

**Ordinal Choice Resolution**: When the microstate type is `"ordinal_choice"` and the user sent an ordinal, the runner resolves it against `params._ordinal_choice_product_ids` — the list of product UUIDs that were presented as choices. `"Second"` becomes index 1, which becomes the UUID at position 1 in the list. This is written to `products` and `product_name` is cleared to ensure the tool mapper uses the resolved UUID rather than any stale text phrase.

**Product List Splitting**: When the microstate is collecting `products` for a compare or multi-add intent and the user types a natural language list (`"iphone and samsung"`, `"galaxy s25, pixel 9"`), the residual text is split on conjunctions and separators. Each item is appended to the existing products list and deduplicated. Critically, this appending respects any products already in `params.products` from when the microstate opened — if the user started a compare from a product detail page (seeding products with one ID), their typed additions are appended rather than overwriting the seed.

**Universal Microstate Democratisation**: If the microstate is waiting for any text-based parameter and the user's reply was not consumed by entity extraction or selection matching, the raw residual text is funnelled directly into that parameter slot. This is how a microstate asking `"Which product?"` accepts `"the red Nike Air Max 270"` — none of those words are entities, so they land as residual text and are written to `product_name`. For address parameters, the raw pre-cleaned text is used to preserve commas and punctuation that `cleanText()` would strip.

**Per-Microstate Validators and Normalizers**: Microstate configs can declare a `validators` object mapping param names to validator functions and a `normalizers` object mapping param names to transformer functions. The runner applies normalizers first (transforming the value, e.g., converting `"100"` to the integer `100`), then validators (gating whether the transformed value is acceptable, e.g., quantity must be between 1 and 100). Values that fail validation are removed from `newParams` entirely, which prevents bad data from advancing the microstate. Validators can return a boolean or an object with `{ valid, normalized }` to both gate and normalise in a single step.

---

## The Feature System

The feature system is what elevates microstates from simple question prompts to rich, interactive experiences. Features are declared as entries in the microstate's `features` array, and they are executed by `microstateFeatureProvider.getFeatureInjections()` on every turn that generates a reprompt. The provider returns three things: a `promptPrefix` (content shown before the question), a `promptSuffix` (content shown after), an `options` array (the buttons or numbered list to display), and `controls` (metadata about which navigation controls to show).

### `show_captured` — Progress Breadcrumbs

This is the simplest feature. When active, it generates a formatted list of all parameters in `onFulfilled` that have already been filled in the current `params`. For example, in a multi-step checkout microstate that collects product, quantity, and delivery address, after the user has specified the product and quantity, the reprompt would begin with:

```
Already Captured:
- Product: iPhone 16 Pro Max
- Quantity: 2
```

This gives the user confidence that their previous answers were heard and keeps the conversation coherent across multiple turns. The feature resolves human-readable labels for params using `_compare_labels`, `_suggest_labels`, `_list_labels`, and `_labels` lookups in the params object — these are label maps populated as selections are made, so that UUID values display as product names.

### `suggest_from_store` — Dynamic Button Injection from Store Inventory

This feature injects live store data into the microstate's options. It is configured with a `datasource` (`"categories"` or `"vendors"`) and a `limit` (typically 5). On each turn that generates a reprompt, it fetches the current window of store items from the live `storeContext` and sets them as the `options` array.

The window is offset-aware: as the user pages through (`__nav:more__`, `__nav:prev__`), the offset advances or retreats within the full items list, and the feature re-fetches the corresponding window. Items wrap around when paged past the end.

The feature also implements a **3-button allocation pattern** for the UI. The displayed options list may contain up to 5 items for text enumeration, but the UI typically renders at most 3 primary buttons: one or two selection choices plus a More/Cancel control. The feature sets `recommendedIndex: 0` to designate the top item as the primary button, `secondaryIndex: 1` if there is no More button (when the list fits in one page), and `controls.more: true` when there are more items to page through. This metadata is consumed by the personality layer's rendering logic to produce the appropriate button layout.

### `suggest_related_products` — Dynamic Product Recommendations

This is the most sophisticated feature. It fetches real product data from the backend and injects up to 5 product cards as options. It operates in two phases depending on how many products have been collected so far.

**Phase A — Seed Rotation**: When no products have been selected yet (the microstate is asking for the first product in a compare flow, for example), the feature rotates through a seed list of the store's most-populated categories — up to 5 categories sorted by product count. For each category, it calls the backend search API and formats the returned products as selectable options with label, value (product ID), and price. If the user pages forward and the current category has more results, it paginates within that category first. When the current category is exhausted, it advances to the next seed category and wraps around. When it retreats (Previous), it goes to the previous page within the current category, or the previous category if at the first page.

**Phase B — By-Category Traversal**: Once the user has selected at least one product, the feature enters the second phase. It calls the backend product detail API on the first selected product to retrieve its `category_ids`. Using the first category ID, it looks up the category's slug and finds all sibling categories (categories that share the same parent). It then builds a traversal list: the product's own category first, then all siblings. Page navigation advances through this tailored list rather than the generic seed list, so the user is presented with products that are contextually related to their first selection — ideal for a compare or cross-sell flow.

If the product lookup fails (e.g., the first product is stored as a raw name rather than a UUID), the feature falls back to the seed category rotation. A fallback is also used if the category hierarchy lookup produces no results. The feature never returns an error to the user — it always has something to show.

The `_suggest_rec` object in `params` is the feature's internal state tracker. It records the current phase, seed categories, seed index, base category, sibling slugs, sibling index, current page, and `hasMoreInCurrentCategory`. This state is persisted across turns in the microstate's params so the feature can resume accurately on the next turn.

---

## Fulfillment Execution

When `checkFulfillment()` determines that all `onFulfilled` params are non-empty — and for `product_compare`, at least 2 products are present — the microstate executes:

1. The microstate is cleared from Redis.
2. The accumulated params are normalised through `parameterNormalizer.normalizeParameters()` — the same stage that runs in the main pipeline.
3. The normalised params are mapped to tool calls through `toolMapper.mapToTools()`.
4. If `onFulfilledSpawn` is set on the microstate contract, the next microstate is opened immediately, chaining the conversational flow.
5. If a stack is active, the fulfilled intent is removed from the stack's `remaining_intents` queue and the stack is updated. The result includes `stack_active: true` so the server continues the stack loop.
6. The result is returned with `microstate_fulfilled: true`.

---

## Expiry and Confidence Depletion

After each unsuccessful turn (no new params added), `stateManager.advanceMicrostate()` decrements the microstate's `confidence` value. When it reaches zero, or when `messagesUsed` reaches `maxMessages`, the microstate expires.

On expiry, if an `escalation` intent is configured, that intent is executed with whatever params have been accumulated — even if incomplete. This is the graceful failure path: if the user spent three turns not providing a product name for a cart action, the system might escalate to a `conversation` intent that apologises and offers help rather than silently dying. If no escalation is configured, the expiry path returns `microstate_expired: true` and checks for an active stack — an expired microstate should not kill an ongoing multi-intent stack.

---

*Next: Chapter 21 — Tool Orchestrator: Execution & Circuit Breaker*
