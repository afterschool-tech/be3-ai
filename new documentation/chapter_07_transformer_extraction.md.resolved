# Chapter 7 — Stage 0.5: Transformer Entity Extraction

## Position in the Pipeline

Stage 0.5 runs immediately after:
- Fuzzy correction (Stage 1)
- IntelliSense analysis (Stage 0b)
- Preprocessor splitting (Stage 3)
- Structural context resolution (Stage 3.1)

And before the **per-statement main loop** begins. It is a **one-shot batch call** — the transformer is called once for all statements simultaneously, and its results are cached in `batchedSemanticContext` and fed into every downstream stage that needs them.

---

## What the Transformer Does at Stage 0.5

In **Hierarchical Mode** (current production default), Stage 0.5 calls the transformer's `/extract` endpoint — **not** `/classify`. Classification is deliberately deferred to the per-statement L1→L2→L3 hierarchical loop (Stage 4b, Chapter 9).

The sole job of Stage 0.5 is **named entity extraction**:
- Which **clauses** apply? (e.g., `apple_product`, `budget_range`)
- Which **categories** are mentioned? (e.g., `smartphones`, `ladies_shoes`)
- Which **attributes** are present? (e.g., `{ brand: ["Apple"], color: ["blue"] }`)

This extracted data becomes the semantic enrichment layer passed to the global clause pre-pass (Stage 3a) and, per-statement, to the schema resolver (Stage 4b) and entity extractor (Stage 4a).

---

## The `/extract` API Call

```js
const textsToAnalyze = statements.map(s => s.original || s.text);

const extractResults = await Promise.all(textsToAnalyze.map(async (t) => {
    const resp = await axios.post(
        `${TRANSFORMER_URL}/extract`,
        { text: t },
        { timeout: 10000 }
    );
    return resp.data;
}));
```

Key points:
- **Uses `statement.original`** (the verbatim message span), not the normalized `text`. This gives the transformer the rawest possible signal.
- **All statements run in parallel** via `Promise.all` — for a 3-statement message, 3 calls fire simultaneously.
- **Timeout**: 10,000ms per call (10 seconds).
- **URL**: `process.env.TRANSFORMER_URL` (default `http://localhost:3009`).

---

## The `/extract` Response Shape

The transformer returns:

```json
{
  "entities": {
    "clause":    ["apple_product", "budget_range"],
    "category":  ["smartphones", "iphones"],
    "attribute": {
      "brand":   ["Apple"],
      "color":   ["blue"],
      "storage": ["128GB"]
    }
  },
  "confidence": {
    "clause:apple_product":        0.89,
    "clause:budget_range":         0.71,
    "category:smartphones":        0.88,
    "category:iphones":            0.92,
    "attribute:brand:Apple":       0.84,
    "attribute:color:blue":        0.76,
    "attribute:storage:128GB":     0.68
  }
}
```

Entities are arrays of string slugs. Confidence scores are stored in a flat map using `type:key` or `type:attrKey:value` as the key.

---

## `reshapeExtractEntities()` — Format Adaptation

The `/extract` response uses a different format than what the downstream pipeline expects (`resolveClausesGlobal` and the entity extractor want `{ key, score }` objects). A local helper reshapes it:

```js
function reshapeExtractEntities(rawResult) {
    // clause: ["apple_product"] → [{ key: "apple_product", score: 0.89 }]
    shaped.clause = entities.clause.map(key => ({
        key,
        score: confidence[`clause:${key}`] || 0
    }));

    // category: ["smartphones"] → [{ key: "smartphones", score: 0.88 }]
    shaped.category = entities.category.map(key => ({
        key,
        score: confidence[`category:${key}`] || 0
    }));

    // attribute: { brand: ["Apple"] } → { brand: [{ value: "Apple", score: 0.84 }] }
    shaped.attribute[attrKey] = values.map(v => ({
        value: v,
        score: confidence[`attribute:${attrKey}:${v}`] || 0
    }));
}
```

This reshape happens **per-statement** at Stage 3a, not globally — so each statement gets its own shaped entity object.

---

## `batchedSemanticContext` — The Shared Cache

All transformer results are stored in a single object:

```js
batchedSemanticContext = {
    results: [
        {
            text:           "show me iphone",          // the text sent to /extract
            classification: [],                        // ALWAYS empty in hierarchical mode
            entities: {
                clause:    ["apple_product"],
                category:  ["iphones", "smartphones"],
                attribute: { brand: ["Apple"] }
            },
            confidence: {
                "clause:apple_product": 0.89,
                "category:iphones":     0.92
            }
        },
        {
            text:           "add the first one to cart",
            classification: [],
            entities: {},
            confidence: {}
        }
    ],
    duration:  143,       // total wall-clock time in ms
    available: true
};
```

**Important**: `classification: []` is intentionally empty. The old legacy pipeline stored flat classification scores (e.g., `[{ intent: "add_to_cart", score: 0.91 }]`) here. In hierarchical mode, that field is suppressed so the old scores can never pollute the L1→L2→L3 pipeline.

---

## Stage 3a — Global Clause Pre-Pass

After `batchedSemanticContext` is built, Stage 3a runs once per statement **before** the main loop:

```js
for (let idx = 0; idx < statements.length; idx++) {
    const rawResult = batchedSemanticContext?.available
        ? batchedSemanticContext.results?.[idx]
        : null;

    const shapedEntities = rawResult ? reshapeExtractEntities(rawResult) : null;
    const semContext = shapedEntities
        ? { entities: shapedEntities, available: true }
        : null;

    const { globalEntities, categoryHints } = resolveClausesGlobal(
        statement.text, [], semContext
    );
    statementLevelEntities[idx]      = globalEntities;
    statementLevelCategoryHints[idx] = categoryHints || [];
}
```

`resolveClausesGlobal` (from `src/utils/semanticClauseResolver.js`) performs **deterministic brand and clause detection** from the store context — independently of whether the transformer returned anything.

When transformer context is present (`semContext`), it enhances detection with semantic confidence scores. When it's absent, the function still works via exact/fuzzy string matching.

### What `resolveClausesGlobal` returns:

```js
globalEntities = [
    { type: "clause",    value: "apple_product", clauseId: "apple_product", source: "transformer", score: 0.89 },
    { type: "vendor",    value: "Apple",          source: "deterministic" },
    { type: "category",  value: "smartphones",    source: "deterministic" }
]

categoryHints = ["smartphones", "iphones"]
```

These arrays are stored indexed by statement position:
- `statementLevelEntities[0]` → entities for statement 0
- `statementLevelCategoryHints[0]` → category hints for statement 0

They are passed into the main statement loop and made available to Stage 4a (entity extractor) and Stage 4b (schema resolver).

### Why statement-level isolation matters

If a user says "show me iphones also find a dress", the apple clause should only attach to the "show me iphones" statement, not bleed into the "find a dress" statement. By running `resolveClausesGlobal` per-statement rather than on the full message, clause isolation is guaranteed.

---

## Bypass Flags

### `state.skipTransformer = true`

If this flag is set in state (manually or via test harness), Stage 0.5 is skipped entirely. `batchedSemanticContext` remains `null`. The pipeline continues normally, relying only on deterministic extraction.

### Transformer unreachable / timeout

If the transformer service is down or takes >10 seconds:
- The `catch` block fires.
- `batchedSemanticContext` remains `null`.
- A `PIPELINE:STAGE0.5_HIERARCHICAL_EXTRACT` debug log with `status: 'UNREACHABLE'` is emitted.
- Stage 3a still runs — `resolveClausesGlobal` has no transformer input but continues deterministically.
- The rest of the pipeline is unaffected.

---

## Fuzzy Matcher (Stage 1) — Quick Reference

Stage 1 runs just before IntelliSense and Stage 0.5, so it's worth documenting here:

```js
const afterFuzzy = fuzzyMatcher.correctText(userMessage, storeContext);
```

`fuzzyMatcher.correctText()` applies **Levenshtein distance correction** to catch common typos:
- `"add to crrt"` → `"add to cart"`
- `"shoew me"` → `"show me"`

It uses an entity guard to avoid correcting proper nouns (product names, brand names) — correcting "iPhone" to something else would be catastrophic.

The corrected string `afterFuzzy` is what IntelliSense receives, and it's also the base for all downstream text processing.

---

## Debug Log

Stage 0.5 emits `PIPELINE:STAGE0.5_HIERARCHICAL_EXTRACT`:

```json
{
  "_desc": "Hierarchical mode — entity-only /extract call (no flat classification).",
  "statementCount": 2,
  "duration": "143ms",
  "status": "OK",
  "results": [
    {
      "statement": "show me iphone",
      "entityKeys": ["clause", "category", "attribute"],
      "confidence": {
        "clause:apple_product": 0.89,
        "category:iphones": 0.92
      }
    },
    {
      "statement": "add the first one to cart",
      "entityKeys": [],
      "confidence": {}
    }
  ]
}
```

Retrieve via `GET /logs/:runId` and filter for key `PIPELINE:STAGE0.5_HIERARCHICAL_EXTRACT`.

---

## Complete Stage Sequence up to This Point

```
User message arrives
    │
    ├─ Stage 1:   fuzzyMatcher.correctText()         → afterFuzzy
    ├─ Stage 0b:  intelliSense.analyze()             → senseResult (statements, path, class_hints)
    │             ↕ If CONVERSATIONAL + confidence≥0.8 → short-circuit, return conversation.chat
    ├─ Stage 3:   preprocessor.preprocess()          → statements[], isMultiIntent
    ├─ Stage 3.1: contextResolver (structural only)  → resolve ordinals/pointers pre-classification
    ├─ Stage 0.5: POST /extract × N statements       → batchedSemanticContext
    └─ Stage 3a:  resolveClausesGlobal() × N         → statementLevelEntities[], statementLevelCategoryHints[]
```

Everything from here enters the **per-statement loop** — Chapter 8.

---

*Next: Chapter 8 — The Main Statement Loop*
