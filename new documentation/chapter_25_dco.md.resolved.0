# Chapter 25 — DCO: Dynamic Context Orchestrator

## The Problem With Monolithic Prompts

Before the DCO existed, every LLM response call in the system used the same large system prompt. It covered every possible intent: it had product comparison formatting rules, vendor grouping instructions, checkout link integrity rules, capabilities lists, availability checking logic, and the full Be3 personality instructions — all assembled into one 800-1000 token block that was prepended to every single call.

The problem was that 90% of that prompt was irrelevant to any given intent. When a user added something to their cart, the LLM received comparison formatting rules it would never need. When a user asked a conversational question, it received checkout link integrity rules that did not apply. Irrelevant instructions waste tokens, push useful instructions further from the attention window, and create opportunities for the model to apply the wrong instructions to the wrong context.

The DCO replaces this with a composable architecture: each intent declares precisely which prompt segments it needs, and the DCO assembles only those segments into the final system prompt. A cart addition gets ~210 tokens of instructions. A product comparison gets ~450. A conversation reply gets ~400. No intent pays for instructions it will never use.

---

## The Segment Registry

All available prompt segments live in `promptSegments.js` as a flat dictionary of named functions, each returning a focused string:

```js
const SEGMENTS = {
    core:        () => `You are a super friendly, playful, and LOVING shopping assistant...`,
    formatting:  () => `FORMATTING:\n- NO TABLES: Use lists or bullet points...`,
    grounding:   () => `GROUNDING RULES:\n- TRUTHFULNESS: Only mention products provided...`,
    suggestions: () => `SUGGESTIONS (SYSTEM GUIDELINE):\nIf you end your message by asking...`,
    gratitude:   () => `GRATITUDE: If the user adds to cart... ALWAYS say "Thank you"...`,
    comparison:  () => `PRODUCT COMPARISON RULES:\n- You MUST compare more than just price...`,
    similarity:  (refName) => `SIMILARITY SEARCH RESULTS:\n- The user asked for products similar to "${refName}"...`,
    capabilities: () => `BOT CAPABILITIES (if user asks "what can you do?")...`,
    availability: () => `AVAILABILITY CHECKING:\n- If a product isn't in "Tool Results"...`,
    vendor_rules: () => `VENDOR DISPLAY:\n- If results include vendor_groups, group products clearly...`,
    checkout_links: () => `CHECKOUT LINKS (CRITICAL):\n- Copy the URL EXACTLY as provided...`,
    visual_search: () => `VISUAL SEARCH RESULTS (GROUNDING OVERRIDE):\n- TRUST THE DATA...`,
    suggested_products_grounding: () => `SUGGESTED PRODUCTS (CURATION REQUIRED)...`
};
```

Every segment function returns a complete, self-contained instruction block. Segments that require runtime data take arguments — `similarity` takes the reference product name so it can tell the LLM exactly what product the results are similar to, rather than using a generic placeholder.

The approximate token costs are documented in comments: `core` is ~150 tokens, `formatting` ~80, `grounding` ~120, `comparison` ~150. These estimates exist so engineers can reason about prompt size when adding new intents or segments.

---

## Intent DCO Config Declaration

Each intent's configuration file declares a `dco` block alongside its schema, parameters, and tool mapping:

```js
// product_search.js
module.exports = {
    name: 'product_search',
    tool: 'product.search',
    dco: {
        segments:          ['core', 'formatting', 'grounding', 'suggestions', 'availability'],
        storeContext:      'lean',
        historyDepth:      4,
        includeSummary:    true,
        maxResponseTokens: 1024
    },
    // ... paramMap, params, etc.
};

// add_to_cart.js
module.exports = {
    name: 'add_to_cart',
    tool: 'cart.add',
    dco: {
        segments:          ['core', 'formatting', 'grounding', 'gratitude'],
        storeContext:      'none',
        historyDepth:      2,
        includeSummary:    false,
        maxResponseTokens: 512
    }
};

// product_compare.js
module.exports = {
    name: 'product_compare',
    tool: 'product.compare',
    dco: {
        segments:          ['core', 'formatting', 'grounding', 'comparison', 'checkout_links'],
        storeContext:      'none',
        historyDepth:      3,
        includeSummary:    true,
        maxResponseTokens: 1500
    }
};
```

The five DCO config fields control distinct aspects of the response:

**`segments`** — the prompt segments to include. Order matters: segments appear in the system prompt in the order declared.

**`storeContext`** — whether and how much live store taxonomy to inject: `'none'` (no store data), `'lean'` (category names, vendor names, basic attribute keys), `'full'` (full slugs, product counts, full attribute metadata). Most intents use `'none'` because the tool result data is sufficient. `product_search` and `conversation` use `'lean'` so the LLM can answer availability questions even when the search returned nothing.

**`historyDepth`** — how many recent conversation turns to include. A `cart.add` does not need history — the current message is self-contained. A `conversation` or `product_search` benefits from 4–6 turns of context to maintain coherent dialogue across a browsing session.

**`includeSummary`** — whether to inject the compressed conversation summary (a background-generated summary of older history beyond `historyDepth`). Not needed for transactional intents; important for conversational ones.

**`maxResponseTokens`** — the token budget for the LLM's response. Short transactional confirmations cap at 512. Rich comparisons and discovery responses allow 1024–1500.

---

## Lazy Config Loading and Caching

The DCO does not import all intent configs at startup. It loads them lazily on first use and caches the extracted `dco` fields:

```js
let intentDcoCache = null;

function loadIntentDcoConfigs() {
    if (intentDcoCache) return intentDcoCache;

    const configDir = path.join(__dirname, '../../services/intentResolver/config/intents');
    intentDcoCache = {};

    const files = fs.readdirSync(configDir).filter(f => f.endsWith('.js'));
    for (const file of files) {
        const config = require(path.join(configDir, file));
        if (config.name && config.dco) {
            intentDcoCache[config.name] = config.dco;
        }
    }

    return intentDcoCache;
}
```

This design has two benefits. First, the DCO does not add startup cost — configs are loaded the first time `assemblePrompt()` is called. Second, the cache persists for the lifetime of the process, so subsequent calls are a map lookup with no file I/O. A `clearCache()` function exists for hot-reload scenarios where intent configs change without a process restart.

Intents without a `dco` block fall back to the `DEFAULT_DCO`:

```js
const DEFAULT_DCO = {
    segments:          ['core', 'formatting', 'grounding', 'suggestions'],
    storeContext:      'none',
    historyDepth:      4,
    includeSummary:    true,
    maxResponseTokens: 1024
};
```

This is a reasonable general-purpose config that works for most contexts. New intents automatically get a sensible default without needing to declare a full DCO block immediately.

---

## Multi-Intent DCO Config Merging

When a message resolves to multiple intents (a stack execution), the personality layer receives an array of intent names. The DCO merges their individual configs using five strategies, designed to always produce a prompt that satisfies all active intents' needs simultaneously:

```js
function getMergedDcoConfig(intentNames) {
    if (names.length === 1) return getDcoConfig(names[0]);

    const configs = names.map(n => getDcoConfig(n));

    // 1. Segments: UNION — preserve order, deduplicate
    const segmentSet = new Set();
    const mergedSegments = [];
    for (const cfg of configs) {
        for (const seg of cfg.segments) {
            if (!segmentSet.has(seg)) {
                segmentSet.add(seg);
                mergedSegments.push(seg);
            }
        }
    }

    // 2. Store context: highest level wins
    const CONTEXT_PRIORITY = { none: 0, lean: 1, full: 2 };
    let highestContext = 'none';
    for (const cfg of configs) {
        if (CONTEXT_PRIORITY[cfg.storeContext] > CONTEXT_PRIORITY[highestContext]) {
            highestContext = cfg.storeContext;
        }
    }

    return {
        segments:          mergedSegments,
        storeContext:      highestContext,
        historyDepth:      Math.max(...configs.map(c => c.historyDepth)),  // 3. MAX
        includeSummary:    configs.some(c => c.includeSummary),            // 4. ANY
        maxResponseTokens: Math.max(...configs.map(c => c.maxResponseTokens)) // 5. MAX
    };
}
```

**Why UNION for segments?** Every active intent's formatting and grounding rules must be represented. A multi-intent turn that includes both a product search and a cart add needs `grounding` (for accurate search presentation) and `gratitude` (for the cart action). The union ensures neither intent's requirements are dropped.

**Why MAX for historyDepth?** The intent that needs the most context should determine how much history the LLM sees. The less context-hungry intent is unaffected by receiving more history than it strictly needs.

**Why ANY for includeSummary?** If even one intent in the batch benefits from a conversation summary, include it. The LLM can ignore summary context it does not need; it cannot synthesise context that was withheld.

**Why highest level for storeContext?** Same logic as includeSummary. If any intent needs the store taxonomy, all intents benefit from having it available. The LLM will reference it only where relevant.

---

## The Six-Step `assemblePrompt()` Build

The final system prompt is assembled in six steps:

**Step 1 — Visual search DCO override**: If the call is for a visual search result with products, the `visual_search` segment is force-added and `grounding` and `availability` are pruned. The visual search segment overrides standard grounding rules specifically to prevent the LLM from second-guessing visual matches:

```js
if (options.visual_search) {
    if (!dco.segments.includes('visual_search')) dco.segments.push('visual_search');
    if (hasProducts) {
        dco.segments = dco.segments.filter(s => s !== 'grounding' && s !== 'availability');
    }
}
```

**Step 2 — Segment injection**: Each segment in the (possibly modified) merged list is called and its output appended. Dynamic segments receive their arguments:

```js
for (const segmentKey of dco.segments) {
    const segmentFn = SEGMENTS[segmentKey];
    if (!segmentFn) continue;
    if (segmentKey === 'similarity' && options.similarityRef) {
        promptParts.push(segmentFn(options.similarityRef));
    } else {
        promptParts.push(segmentFn());
    }
}
```

**Step 3 — Dynamic suggestion grounding**: If the tool results contain `suggested_products` and the `suggested_products_grounding` segment is not already in the config, it is injected automatically. This prevents fallback product results from being presented without the LLM knowing to handle them carefully:

```js
if (toolResultsSummary.includes('"suggested_products"') && !dco.segments.includes('suggested_products_grounding')) {
    promptParts.push(SEGMENTS['suggested_products_grounding']());
}
```

**Step 4 — Store context injection**: Appends the live store taxonomy if requested. `getLeanContext()` is used for both `'lean'` and `'full'` levels currently (the `'full'` path calls `getLeanContext()` as the leanest version that includes all relevant data):

```js
if (dco.storeContext !== 'none') {
    const ctx = dco.storeContext === 'full' ? getLeanContext() : getUltraLeanContext();
    promptParts.push(`STORE CONTEXT:\n${JSON.stringify(ctx)}`);
}
```

**Step 5 — Failure and skip instructions**: Explicit instructions are injected when tools failed or actions were skipped. These override the LLM's natural tendency to be vague about failures and force clear, actionable error communication.

**Step 6 — Tool results and verbosity**: The summarised tool results are appended, followed by the adaptive verbosity hint. All parts are joined with double newlines so the model sees each section as a distinct block.

---

## History Windowing

`getHistoryWindow()` implements a two-tier history strategy that balances context richness against token cost:

```js
function getHistoryWindow(intentNames, fullHistory = [], conversationSummary = null) {
    const dco = getMergedDcoConfig(intentNames);

    const messages = [];

    // Tier 1: Compressed summary of older history (if configured and available)
    if (dco.includeSummary && conversationSummary?.trim().length > 0) {
        messages.push({
            role: 'system',
            content: `CONVERSATION CONTEXT: ${conversationSummary}`
        });
    }

    // Tier 2: Raw recent messages (last N turns)
    const recentHistory = fullHistory.slice(-dco.historyDepth);
    for (const h of recentHistory) {
        messages.push({
            role:    h.role === 'ai' ? 'assistant' : 'user',
            content: h.text
        });
    }

    return messages;
}
```

The summary, when present, is injected as a `system` role message rather than mixed into the user/assistant history. This placement ensures it is read as context, not as part of the conversation turn sequence. The LLM treats system messages as ground truth, so summary information receives appropriate weight without the model needing to distinguish it from raw turn content.

---

*Next: Chapter 26 — Personality Layer: Response Generation*
