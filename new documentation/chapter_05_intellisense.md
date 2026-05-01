# Chapter 5 — IntelliSense: The LLM Pre-Processor

## What Is IntelliSense?

IntelliSense is a **lightweight LLM-powered pre-processor** that runs on every text message before the main NLU pipeline begins. Its job is to do things deterministic code would struggle with:

1. **Split** compound messages into clean, individual statements.
2. **Normalize** each statement (remove filler, preserve meaning).
3. **Extract** product names mentioned in the message.
4. **Flag** pronouns that should NOT be resolved (to prevent false context injection).
5. **Classify** each statement with a coarse class hint.
6. **Recommend** which pipeline path to use (full NLU, conversational, or state-only).

IntelliSense is implemented in `src/services/intelliSense.js` and is called at the very start of `resolveDeterministic()`, before any transformer or schema-resolver work.

---

## Why It Exists

Without IntelliSense, the main pipeline receives one blob of text and has to guess whether:
- "show me iphone and add the first one to cart" is one intent or two.
- "it" in "add it" refers to something in the current statement or a prior turn.
- "also find a lady's shoe and i also need a shirt" is one search or two.

The pipeline's `preprocessor.js` can do basic splitting on conjunctions, but IntelliSense does it **semantically** — understanding context and intent, not just grammar.

---

## The LLM Used

```
Model:       llama-3.1-8b-instant (Groq Cloud)
Temperature: 0.1   (near-deterministic — we want consistent JSON)
Max Tokens:  800
Format:      json_object
Retries:     2
```

The 8B model is chosen deliberately: it's fast and cheap. The task (structured JSON output from a well-specified prompt) doesn't require a large model's reasoning depth.

---

## The Full System Prompt

This is the exact `SYSTEM_PROMPT` string sent as the `system` role message:

```
You are a pre-processor for a shopping assistant. Return ONLY a JSON object.

TASK: For each user message —
1. Split into statements only on clear topic changes
2. For each statement return a verbatim original span and a normalized text
3. Extract product names
4. Mark idiomatic pronouns to skip
5. At the TOP LEVEL, recommend an execution path (FULL_PIPELINE, CONVERSATIONAL, or STATE_RESOLUTION),
   a reason, and your confidence (0.0 to 1.0).

SPLITTING: Split on "that aside", "by the way", or clearly separate questions. Also split when the
user issues multiple FIND/SHOW/SEARCH clauses, each with its own product (e.g., "help me find
smartphones that are blue in color, also find a lady's shoe and i also need a shirt" → 3 statements).
Do NOT split true comparison phrasing like "compare X and Y", "X vs Y", "difference between X and Y"
(these stay as a single statement for comparison). Do NOT split obviously same-topic modifiers joined
by "and/or" (e.g., "cheap blue samsung phones"). "and then"/"then" between different actions = split.
When unsure, keep as one.

ORIGINAL: Copy verbatim from the message. No changes. Single statement = full message.
Multi = each chunk exactly as written.

TEXT (constrained normalization — NOT free paraphrase):
- Lowercase and remove ONLY: greetings, "please", "kindly", "actually", filler sounds
  ("ahh", "oo", "hmm"), discourse openers ("so", "well", "basically")
- KEEP exactly: action verbs, negations, interrogative openers (how do i / can you / do you have),
  quantities, product names, model numbers, brand names, adjectives, specs

PRODUCTS:
- "X called Y" / "X named Y" → { name: "Y X" }
- Abstract concepts (crypto, forex, politics) → NOT a product
- No product mentioned → products: []

PRONOUNS — skip_resolve when idiomatic or intra-statement:
- "that aside", "help with that" (end), "that said", "do/try that" (action) → skip
- Pronoun refers to product IN SAME statement → skip ("find iphone and add it" → skip "it")
- Keep only cross-statement pronouns with no local antecedent ("add it to cart" standalone → keep)

PATH_RECOMMENDATION:
- FULL_PIPELINE: Use when a product search, cart action, or order lookup is needed.
- CONVERSATIONAL: Use for pure greetings, gratitude, or social noise with NO products or action verbs.
- STATE_RESOLUTION: Use for messages that ONLY contain pronouns or references to items on screen
  (e.g., "add it", "show more", "compare them").

CLASS_HINT (per statement, optional but recommended):
- Provide a coarse class hint when clear:
  "Discovery", "Shopping_Management", "Vendor_Intelligence", or "Support_Feedback".
- If unclear, use null.

OUTPUT_SCHEMA:
{
  "statements": [{
    "original": "string",
    "text": "string",
    "products": [{"name": "string", "adjectives": ["string"]}],
    "skip_resolve": ["string"],
    "class_hint": "Discovery|Shopping_Management|Vendor_Intelligence|Support_Feedback|null"
  }],
  "recommended_path": "FULL_PIPELINE|CONVERSATIONAL|STATE_RESOLUTION",
  "short_circuit_reason": "string",
  "confidence": number
}
```

---

## Few-Shot Examples

Three examples are baked into the prompt messages (as `user/assistant` pairs) to ground the model:

### Example 1 — Product Search
```
User:      "how do i make moi moi please"
Assistant: {
  "statements": [{
    "original": "how do i make moi moi please",
    "text": "how do i make moi moi",
    "products": [],
    "skip_resolve": [],
    "class_hint": "Discovery"
  }],
  "recommended_path": "FULL_PIPELINE",
  "short_circuit_reason": "Requires product/recipe search",
  "confidence": 0.98
}
```

### Example 2 — Social Commentary (Conversational)
```
User:      "None of it because I'm not an Iphone Freak"
Assistant: {
  "statements": [{
    "original": "None of it because I'm not an Iphone Freak",
    "text": "not an iphone freak",
    "products": [],
    "skip_resolve": ["it"],
    "class_hint": "Support_Feedback"
  }],
  "recommended_path": "CONVERSATIONAL",
  "short_circuit_reason": "Social commentary",
  "confidence": 0.85
}
```

### Example 3 — State Resolution (Pronoun + Action)
```
User:      "add it to cart"
Assistant: {
  "statements": [{
    "original": "add it to cart",
    "text": "add it to cart",
    "products": [],
    "skip_resolve": [],
    "class_hint": "Shopping_Management"
  }],
  "recommended_path": "STATE_RESOLUTION",
  "short_circuit_reason": "Direct reference to previous context",
  "confidence": 0.95
}
```

Note how `skip_resolve` is **empty** here — "it" in "add it to cart" IS an unresolved cross-turn pronoun, so it must flow to the context resolver. In Example 2, "it" in "None of it" is idiomatic and has no antecedent, so it goes to `skip_resolve`.

---

## The `original` vs `text` Distinction

Every statement carries two text fields:

| Field | Purpose | Rules |
|-------|---------|-------|
| `original` | Verbatim span from the source message | Must be a real substring of the source |
| `text` | Normalized version for entity extraction | Strip only filler; preserve all meaningful tokens |

**`text` is NOT a free paraphrase.** The only things stripped are: greetings, "please", "kindly", "actually", filler sounds, and discourse openers. Everything meaningful — action verbs, product names, adjectives, negations, quantities — is kept exactly as written.

This distinction matters because:
- The transformer is called with `original` (for intent classification — raw text is more representative).
- Entity extraction works on `text` (cleaner, more precise).
- The context resolver works on `text`.

---

## The Vetting Layer

The LLM's output cannot be trusted blindly. Hallucinations happen. The `vetResults()` function applies four strict passes to every statement before it enters the pipeline.

### Pass 1 — Original Grounding

```
stmtOriginal must be a real substring of sourceText (case-insensitive).
```

If `original` is not found in the source message (e.g., LLM fabricated it):
- **Single-statement** message → fallback to full source text.
- **Multi-statement** message → fallback to `stmt.text`.

### Pass 2 — Text Grounding (Token Overlap)

`stmt.text` must share significant tokens with the source. Significant tokens are those with length ≥ 2 that are not stop words (`the`, `and`, `for`, etc.).

**Rule**: At least one significant token must match, AND more than 50% of significant tokens must be in the source.

If this fails (likely LLM returned a canned few-shot example instead of the real message):
- `stmt.text` is replaced with `stmtOriginal` (real but noisier — better than hallucinated).

### Pass 2.5 — Fully Ungrounded Statement Discard

If **both** `text` AND `original` (after Pass 1/2 fallbacks) share no significant tokens with the source, the entire statement is **discarded**. This is rare but prevents zombie statements from entering the pipeline.

If all statements are discarded, `vetResults()` returns `null` → pipeline falls back to raw message.

### Pass 3 — Product Hallucination Detection

Each extracted product's name tokens must exist in the **original source text** (not just in `stmt.text`, which could be normalized away from the original).

```
name tokens = name.split(/\s+/).filter(t => t.length > 2 && not stop word && not ["called","named"])
At least one name token must exist in sourceLower.
```

Additionally, generic semantic translations are dropped:
- `"food"`, `"drink"`, `"drinks"`, `"stuff"`, `"item"`, `"product"`, `"things"`, `"something"` → discarded.

Adjectives are similarly validated — each adjective must appear in the source text.

### Pass 4 — skip_resolve Vetting

Each pronoun listed in `skip_resolve` must actually appear in `stmt.text`. This prevents the LLM from hallucinating pronouns to skip.

### Class Hint Vetting

The `class_hint` value must be one of the four allowed values:
```
ALLOWED_CLASS_HINTS = { 'Discovery', 'Shopping_Management', 'Vendor_Intelligence', 'Support_Feedback' }
```

Any other value (null, an empty string, or a made-up class) is dropped — the statement's `class_hint` is set to `null`.

---

## Short-Circuit Paths

Based on `recommended_path`, the pipeline can be partially or fully bypassed:

### `CONVERSATIONAL`
Used for pure greetings, gratitude, chit-chat. The main NLU pipeline is skipped. The message goes directly to the personality layer (Groq) with a conversational system prompt. No tools are called. No product resolution happens.

### `STATE_RESOLUTION`
Used when the message only contains pronouns or engineered tokens. The context resolver handles it with no schema-matching or transformer calls.

### `FULL_PIPELINE`
Default. Everything runs.

---

## Output Shape

After vetting, IntelliSense returns:

```js
{
  statements: [
    {
      original: "show me iphone",
      text: "show me iphone",
      products: [{ name: "iphone", adjectives: [] }],
      skip_resolve: [],
      class_hint: "Discovery"
    },
    {
      original: "add the first one to cart",
      text: "add the first one to cart",
      products: [],
      skip_resolve: [],
      class_hint: "Shopping_Management"
    }
  ],
  recommended_path: "FULL_PIPELINE",
  short_circuit_reason: "Multi-intent: search + cart add",
  confidence: 0.96
}
```

The `statements` array is what the main pipeline iterates. Each statement is processed independently through all NLU stages, then the results are merged at the end.

---

## Graceful Degradation

If IntelliSense fails for any reason (network error, JSON parse failure, timeout, all statements vetted out), `analyze()` returns `null`.

When `senseResult` is `null`:
- The pipeline treats the full user message as a **single, un-split statement**.
- No products are pre-extracted.
- All pronouns flow to the context resolver.
- No class hint is available (L1 classification runs normally).
- `recommended_path` defaults to `FULL_PIPELINE`.

This ensures IntelliSense is a pure enhancement — its absence degrades gracefully without breaking the bot.

---

## Performance Profile

| Step | Time |
|------|------|
| Groq API call (llama-3.1-8b-instant) | ~150–400ms |
| Vetting (pure JS, no I/O) | <1ms |
| Total IntelliSense overhead | ~150–400ms |

This is the only Groq call before any tool execution. Everything else (tool responses, personality) happens after.

---

## Example: Full IntelliSense Debug Log

When `DEBUG=true`, IntelliSense emits this to the debug logger:

```json
{
  "_desc": "IntelliSense — LLM-based pre-pass for splitting, products, and pronoun guards",
  "duration": "213ms",
  "summary": {
    "statementCount": 2,
    "totalProducts": 1,
    "totalSkipResolve": 0
  },
  "vettingLogs": [],
  "results": [
    { "original": "show me iphone", "text": "show me iphone", "products": [{"name":"iphone"}], "skip_resolve": [], "class_hint": "Discovery" },
    { "original": "add the first one to cart", "text": "add the first one to cart", "products": [], "skip_resolve": [], "class_hint": "Shopping_Management" }
  ],
  "recommendedPath": "FULL_PIPELINE",
  "shortCircuitReason": "Multi-intent: search + cart action",
  "confidence": 0.96
}
```

Retrieve this via `GET /logs/:runId` and look for event key `PIPELINE:STAGE0B_INTELLISENSE`.

---

*Next: Chapter 6 — Deterministic Resolver & Pipeline Orchestrator*
