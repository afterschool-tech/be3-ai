# Chapter 24 — Snapshot Aggregator: Multi-Intent UI Reconciler

## The Problem It Solves

When a multi-intent message executes, several tool handlers run in sequence. Each one may produce its own UI payload: `cart.add` returns "View cart / Checkout / Continue shopping" buttons; `product.search` returns product cards with "Add to cart / More info / Show similar" buttons per card; `vendor.getContact` might return a WhatsApp contact button. If all of these were sent to the frontend as-is, the client would receive multiple conflicting button sets and have no clear way to render them coherently into a single response frame.

The snapshot aggregator is the reconciliation pass that runs after all tools have executed and a natural language response has been generated. Its job is to collect every UI contribution from every tool result in the batch, resolve conflicts, deduplicate, rank, and assemble a single canonical UI payload for the turn.

---

## Two Separate UI Channels

The aggregator maintains two distinct UI channels that are never mixed:

**Channel 1 — Product Cards** (`whatsapp_product_cards`): These are the rich product card components — visual representations of individual products with name, price, image URL, ordinal position, and three action buttons per card ("Add to cart", "More info", "Show similar"). They render in the WhatsApp UI as a horizontally scrollable carousel. They are always kept separate from the action button channel because they have their own rendering contract on the frontend.

**Channel 2 — Action Buttons** (`whatsapp_buttons`): These are context-specific action buttons that appear as a flat button row below the text response. "View cart", "Checkout", "Continue shopping", vendor contact links, microstate controls (More / Cancel). Multiple tools may contribute buttons to this channel, and the aggregator merges them into a single button set.

```js
// Separating the two channels:
const whatsappProductCardResults = toolResults
    .map(tr => tr?.result?.whatsapp_product_cards)
    .filter(w => w && w.type === 'button' && w.transaction === 'product_card');

const globalButtonPayloads = whatsappButtonResults
    .filter(w => w?.transaction !== 'product_card');
```

For product cards, the aggregator picks the first non-empty card payload. There is never more than one valid product card payload per turn — the last tool to produce cards wins, but in practice only one tool per batch generates them.

---

## The Microstate Button Guard

Before collecting button results, the aggregator checks whether the final response was a direct microstate response:

```js
const ignoreMicrostateButtons = !directResponseResult;
const whatsappButtonResults = toolResults
    .filter(tr => {
        if (!ignoreMicrostateButtons) return true;
        const toolName = String(tr?.tool || '');
        return !toolName.startsWith('microstate.');
    })
    .map(tr => tr?.result?.whatsapp)
    .filter(w => w && w.type === 'button');
```

When the turn's response came from a tool execution (not from a microstate reprompt), microstate tools' buttons — like the "More / Cancel" disambiguation controls — are excluded from the aggregated payload. This prevents the disambiguation controls from leaking into a completed tool response. For example: a `product_compare` microstate might have been fulfilled this turn. Its disambiguation controls (`More options / Cancel`) are no longer relevant once the compare tool has run. The guard strips them.

---

## The Priority-Aware Button Merge Algorithm

When multiple tools contribute action buttons to Channel 2, the aggregator runs a full merge:

**Step 1 — Collect all candidates**: Every button from every contributing tool payload is extracted into a flat list. Each candidate carries: its `id`, `title`, its declared `priority` (either per-button or inherited from the payload's own priority), and a stable `order` counter (its position in the sequence of contributions).

```js
for (const w of globalButtonPayloads) {
    const payloadPriority = Number.isFinite(w?.priority) ? w.priority : 0;
    for (const b of w.buttons) {
        candidates.push({
            id:       String(b?.id ?? ''),
            title:    String(b?.title ?? b?.text ?? id),
            priority: Number.isFinite(b?.priority) ? b.priority : payloadPriority,
            order:    order++
        });
    }
}
```

**Step 2 — Deduplicate by identity**: Two buttons with the same `id` and `title` are considered the same button. If the same button is contributed by two different tools, only the highest-priority version is kept. Among equal-priority duplicates, the one with the lower `order` (contributed earlier in the tool sequence) is preferred:

```js
const bestByKey = new Map();
for (const c of candidates) {
    const key = `${c.id}::${c.title}`;
    const existing = bestByKey.get(key);
    if (!existing || c.priority > existing.priority) {
        bestByKey.set(key, c);
    } else if (c.priority === existing.priority && c.order < existing.order) {
        bestByKey.set(key, c);
    }
}
```

**Step 3 — Sort and cap at 3**: Candidates are sorted descending by priority, with stable tie-breaking by original order. The top 3 are selected as the final button set. The 3-button cap mirrors WhatsApp's own rendering limit — the WA platform displays at most 3 interactive buttons per message.

```js
const selected = Array.from(bestByKey.values())
    .sort((a, b) => b.priority !== a.priority ? b.priority - a.priority : a.order - b.order)
    .slice(0, 3)
    .map(({ id, title }) => ({ id, title }));
```

---

## Helper Text Injection

After the button sets are assembled, the aggregator checks for specific button titles and injects a `helper_text` field into the payload if recognised:

```js
const SHOP_THESE_ITEMS_TITLE = 'Shop these items 🛍️';
const helperForShopTheseItems = '👉 Tap "Shop These Items 🛍️" to view details and buy';

if (titles.includes(SHOP_THESE_ITEMS_TITLE)) {
    whatsappButtons.helper_text = helperForShopTheseItems;
}

// For product cards with "More info" buttons:
const helperForMoreInfo = '👉 Tap "More info" to see full details or compare with related products';
if (hasMoreInfo) {
    productCardPayload.helper_text = helperForMoreInfo;
}
```

The `helper_text` is rendered by the WhatsApp client as a small grey instruction line above the button row. It is set by the AI service rather than being hardcoded in the WA client, which means it can vary per context — a different hint for browse results vs. checkout flows.

---

## Stale UI Payload Stripping

The response includes a `results` array containing every tool result from the turn. However, during stack execution across multiple turns, historical tool results from prior turns are preserved in `consolidatedToolResults`. If these historical results still carry their original `whatsapp` and `whatsapp_product_cards` payloads, a client that renders buttons directly from the results array would show stale buttons alongside the current turn's buttons.

The aggregator strips UI payloads from historical tool results before they reach the client:

```js
const resultsForClient = consolidatedToolResults.map(tr => {
    const isNewInThisRequest = toolResults.some(newTr => newTr === tr);
    if (!isNewInThisRequest && tr.result) {
        const strippedResult = { ...tr.result };
        delete strippedResult.whatsapp;
        delete strippedResult.whatsapp_product_cards;
        return { ...tr, result: strippedResult };
    }
    return tr;
});
```

Identity comparison (`newTr === tr`) is used rather than property matching. Only results that are literally the same object reference as one of this turn's `toolResults` entries are treated as "new" — everything else is historical and gets stripped.

---

## The `<suggestion>` XML Block Extraction

After the personality layer generates the natural language response, the server scans it for a `<suggestion>` XML block. This is the structured follow-up suggestion system: the LLM can end its response by embedding a machine-readable suggestion for the user's next action:

```xml
<suggestion>
{
  "is_suggestion": true,
  "hint": "vendor products",
  "rephrase": "Show me other products from Dareymi"
}
</suggestion>
```

The aggregator extracts and parses this block:

```js
const suggestionRegex = /<suggestion>([\s\S]*?)<\/suggestion>/i;
const match = sanitizedResponse.match(suggestionRegex);
if (match) {
    const parsed = JSON.parse(match[1].trim());
    if (parsed.is_suggestion && parsed.rephrase) {
        extractedSuggestion = {
            type: 'structured_payload',
            hint: parsed.hint || 'general',
            rephrase: parsed.rephrase  // The simulated user message
        };
        await stateManager.updateState(session_id, { last_bot_suggestion: extractedSuggestion });
    }
    // Always strip the block from the visible reply
    sanitizedResponse = sanitizedResponse.replace(suggestionRegex, '').trim();
}
```

The `rephrase` is the exact message that would be simulated if the user taps the suggestion. It is stored in session state as `last_bot_suggestion`. On the next turn, if the user's message is detected as an implicit acknowledgement of the suggestion ("yes please", "sure", "go ahead"), the server replays `rephrase` through the pipeline as if the user had typed it. This is how suggestion taps work without requiring the client to send a special structured event — they look like natural user messages.

---

## The Facet Refiner System

`buildFacetRefinerButtons()` generates filter refinement buttons from the facets returned by a product search. When a search result includes facet data (available colour options, price tier clauses, brand options), the function selects up to 3 of the most productive filter suggestions as buttons.

The selection logic is attribute-aware: it skips any facet filter that is already active in the current search (no point suggesting "Budget" when the user already filtered by budget). It prefers clause-type filters (named filter groups like "Budget range") over raw value filters, then sorts by product count (the filter with the most products gets the top button slot):

```js
combinedCandidates
    .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.type === 'clause' ? -1 : 1;  // Clauses beat raw values on ties
    })
    .slice(0, 3)
    .forEach(item => {
        // Button ID encodes the filter action for the engineered token system
        const id = `__filter:clause:${snapshotId}:${item.attrCode}:${encoded}__`;
        clauseButtons.push({ id, title: item.title, priority: 10 });
    });
```

The `snapshotId` embedded in the button ID is a 4-byte hex identifier for the current search result set. When the user taps a filter button, the engineered token system parses this ID to know exactly which search to narrow and by what attribute and value.

---

## Tool History Persistence

At the end of each turn, the aggregator checks whether a stack or microstate is still active:

```js
const hasStack = !!(endStack && endStack.remaining_intents?.length > 0);
const hasMicrostate = !!endMicrostate;

if (hasStack || hasMicrostate) {
    await stateManager.setLastTools(session_id, consolidatedToolResults.slice(-50));
} else {
    await stateManager.setLastTools(session_id, []);
}
```

When a multi-turn flow is in progress — either a stack mid-execution or a microstate waiting for user input — the full accumulated tool result history (capped at 50 entries) is persisted to Redis. This is what makes the `consolidatedToolResults` available on the next turn: the server reads `getLastTools()` at the start of each request and merges them with the current turn's results. When the flow ends, the history is cleared to prevent stale data from accumulating across unrelated conversations.

---

## The Final Response Shape

Every `/chat` endpoint response has the same top-level structure:

```js
{
    success:               true,
    reply:                 "Here are some great phones... 📱",   // Personality layer output
    intent:                "product_search",                      // Primary intent name
    display_images:        [...],                                 // Injected product images
    tools_used:            [...],                                 // Tool calls from the mapper
    results:               resultsForClient,                      // Stripped historical + current results
    whatsapp_buttons:      { type: 'button', buttons: [...] },   // Aggregated action buttons
    whatsapp_product_cards: { type: 'button', transaction: 'product_card', cards: [...] }
}
```

The client separates `reply` (text), `whatsapp_product_cards` (card carousel), and `whatsapp_buttons` (action button row) into their respective rendering slots. The suggestion from `last_bot_suggestion` is not in the response body — it is stored server-side and activated on the next turn.

---

*Next: Chapter 25 — DCO: Dynamic Context Orchestrator*
