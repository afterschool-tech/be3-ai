# Chapter 8 — The Main Statement Loop

## Overview

After all the pre-pipeline stages (0.5, 3, 3.1, 3a) have run, `resolveAndMap()` enters its **main processing loop**. For each statement produced by IntelliSense (or the preprocessor), every NLU stage runs independently: classification, context resolution, entity extraction, parameter extraction, bleeding, porting, and normalization.

This architecture is what enables true **multi-intent resolution**: statement 1 (`"show me iphone"`) and statement 2 (`"add the first one to cart"`) are processed through their own independent classification and parameter extraction passes, then their tool calls are merged at the end.

---

## The Loop

```js
const resolvedStatements = [];

for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    let textForExtraction = statement.text;
    // ...all stages for this statement...
    resolvedStatements.push(resolvedStatement);
}
```

Each iteration of the loop processes one statement from `statements[]`. The `resolvedStatements` array accumulates the output of each iteration and is merged into a unified tool list at the end.

---

## Per-Statement Variables

At the start of each iteration, these variables are initialized fresh:

| Variable | Purpose |
|----------|---------|
| `statement.text` | The normalized statement text (from IntelliSense or preprocessor) |
| `statement.original` | The verbatim source span (for transformer calls) |
| `textForExtraction` | Working copy of text; mutated by context resolver |
| `initialCleanedText` | `cleanText(statement.text)` — used for hierarchical classification |
| `localSemanticContext` | L3 scores from hierarchical classification (null if not hierarchical) |
| `hierarchicalResult` | Full L1→L2→L3 classification object |
| `stageGates` | Stage gate config loaded from `getGates(hierarchicalResult.intent)` |
| `afterContext` | Text after context resolution (pronouns/ordinals replaced) |
| `resolutions` | Array of resolution events for debug/context tracking |
| `statementPreEntities` | Pre-seeded entities from Stage 3a and IntelliSense products |
| `confidenceGap` | Top-minus-second L3 score gap (used for degradation/porting checks) |

---

## `cleanText()` and `stripSocialNoise()`

Before classification, the statement text is passed through `cleanText()`:

```js
const initialCleanedText = cleanText(statement.text);
```

`cleanText()` (from `pipeline/nlpCleaner.js`) does light normalization:
- Lowercase.
- Strip punctuation noise.
- Collapse whitespace.

It does **not** remove meaningful words. It is much lighter than IntelliSense normalization — its sole purpose is to give the transformer a clean input without affecting entity detection downstream.

`stripSocialNoise()` (also available but not used on `initialCleanedText`) is more aggressive — it removes greetings, filler, and politeness phrases. It's used in specific contexts where a cleaner signal is needed for classification.

---

## Step 1 — Hierarchical Classification (Stage 4b)

The first thing inside the loop for each statement is the L1→L2→L3 call:

```js
const classHint = USE_INTELLISENSE_CLASS_HINT
    ? senseResult?.statements?.[i]?.class_hint
    : null;

hierarchicalResult = await transformerClient.classifyHierarchical(
    initialCleanedText, classHint
);
```

**What `classifyHierarchical()` returns** (from Chapter 9):

```js
{
  class:        "Shopping_Management",
  intent:       "Cart_Management",
  subIntent:    "add_to_cart",
  classSkipped: false,      // true if class_hint was used
  l1:           { winner: "Shopping_Management", scores: [...] },
  l2:           { winner: "Cart_Management",     scores: [...] },
  l3:           { winner: "add_to_cart",         scores: [...] },
  totalDuration: 187
}
```

The `l3.scores` array is immediately converted into `localSemanticContext`:

```js
localSemanticContext = {
    available: true,
    classification: hierarchicalResult.l3.scores.map(s => ({
        intentName: s.name,
        score:      s.score,
        bestMatch:  s.bestMatch
    }))
};
```

This `classification` array is the same format the old legacy pipeline used from flat `/analyze` scores — enabling all downstream stages (schema resolver, porter, normalizer) to consume it without modification.

---

## Step 2 — Stage Gate Loading

```js
if (hierarchicalResult.intent) {
    stageGates = getGates(hierarchicalResult.intent);
}
```

`getGates()` returns the gate configuration for the **L2 intent** (e.g., `"Cart_Management"`). The gates control which downstream stages run for this statement. See Chapter 10 for all gate definitions.

If classification failed or returned no intent, `stageGates` remains `null` and all stages run.

---

## Step 3 — Context Resolution (Stage 4a)

```js
if (stageGates?.contextResolution === false) {
    // SKIP: gate disabled
} else {
    const resolved = contextResolver.resolveReferences(
        statement.text, state, storeContext, skipResolve, 'specific'
    );
    afterContext = resolved.resolvedText;
    resolutions = [...structuralResolutions, ...resolved.resolutions];
}
```

Context resolution at this stage is `'specific'` mode — it resolves brand names, product names, and entity-level references that require knowledge of the L2 intent. (Pronoun and ordinal resolution for classification was already done in Stage 3.1.)

`skipResolve` is the list of pronouns IntelliSense marked as idiomatic (e.g., "that" in "help with that"). These are passed to the resolver to prevent false resolution.

After resolution, `afterContext` has pronouns and references replaced with their actual values. It then goes through a final `cleanText()`:

```js
const cleanedText = cleanText(afterContext);
```

`cleanedText` is the text used by entity extraction, schema resolver, and parameter extractor for this statement.

---

## Step 4 — Confidence Gap Calculation

```js
let confidenceGap = 1.0;
if (localSemanticContext?.available && Array.isArray(localSemanticContext.classification)) {
    const topScore    = localSemanticContext.classification[0]?.score || 0;
    const secondScore = localSemanticContext.classification[1]?.score || 0;
    confidenceGap = topScore - secondScore;
}
```

`confidenceGap` is how far ahead the top L3 sub-intent score is from the second-best score. A high gap (e.g., 0.8) means the transformer is confident. A near-zero gap (e.g., 0.02) means the classification is ambiguous.

This value is used later by:
- **Intent Porter (Stage 7)**: A very low gap + low entity density triggers degradation to `conversation`.
- **Schema Resolver**: Boosts score for intents that align with transformer's confident winner.

---

## Step 5 — Entity Injection (Stage 3d)

Before running the full entity extractor, pre-detected entities are seeded into `statementPreEntities`:

### 5a — Stage 3a Global Entities
```js
const localStatementEntities = statementLevelEntities[i] || [];
statementPreEntities.push(...localStatementEntities);
```

Clauses and brands from the global pre-pass (Chapter 7, Stage 3a) are injected first — they take priority over IntelliSense-detected products in word position consumption.

### 5b — IntelliSense Products
```js
const senseStmt = senseResult?.statements?.[i];
for (const p of senseStmt?.products || []) {
    // Find contiguous token span in cleanedText
    // Build entity: { type: "resolved_product", value: p.name, wordIndices: [...] }
    statementPreEntities.push(entity);
}
```

Products extracted by IntelliSense are converted to `resolved_product` entities with their word positions tracked. The **contiguous span search** ensures only the first occurrence of each product name is consumed (preventing duplicate entities from repeated words).

**Priority order**: `clause` / `vendor` (Stage 3a) → `resolved_product` (IntelliSense). This prevents a product name from overriding a correctly detected vendor clause.

---

## Step 6 — Full Entity Extraction (Stage 4a)

```js
const extractedEntities = extractEntities(
    cleanedText,
    storeContext,
    statementPreEntities,
    positionTracker,
    localSemanticContext,
    statementLevelCategoryHints[i]
);
```

The entity extractor runs on `cleanedText` with:
- Pre-seeded entities (Stage 3d).
- Transformer semantic context (L3 scores).
- Category hints from Stage 3a.
- A position tracker to prevent double-counting.

See Chapter 12 for entity extractor internals.

---

## Step 7 — Schema Resolution (Stage 4b continued)

```js
const intentMatches = resolveIntent(
    cleanedText,
    extractedEntities,
    localSemanticContext,
    idfMap,
    stageGates
);
```

The schema resolver scores every intent config against the statement using keyword matching, IDF weighting, and transformer semantic context. The result is a ranked list of intent matches with scores and matched keywords.

See Chapter 13 for schema resolver internals.

---

## Steps 8–12 — Parameter Extraction, Bleeding, Porting, Normalization

These run in order on the intent matches:

```
Stage 5: parameterExtractor.extract()  → fill parameters for each intent
Stage 6: parameterBleeder.bleed()      → cross-intent parameter inheritance
Stage 7: intentPorter.port()           → safety-gated buy/search pivoting
Stage 8: parameterNormalizer.normalize() → vendor/category name → ID
```

Each of these is covered in its own chapter (14–17).

---

## Per-Statement Output Shape

After all stages, each statement contributes a `resolvedStatement` object:

```js
{
  statement:   { text: "add the first one to cart", original: "...", negated: false },
  intents: [
    {
      intentName:      "add_to_cart",
      score:           0.92,
      parameters:      { product_id: "uuid-123", quantity: 1 },
      matchedKeywords: ["add", "cart"],
      statementText:   "add the first one to cart"
    }
  ],
  resolutions: [{ pronoun: "the first one", resolvedTo: "uuid-123" }],
  hierarchical: {
    class:     "Shopping_Management",
    intent:    "Cart_Management",
    subIntent: "add_to_cart"
  }
}
```

---

## After the Loop — Merge & Tool Mapping

After all statements are processed, the pipeline:

1. **Flattens** all per-statement intents into a single ordered list.
2. **Builds the Stack** (if more than one intent exists, the first executes immediately, the rest are deferred).
3. **Maps intents to tool calls** via `toolMapper.mapToTools()`.
4. **Calculates overall pipeline confidence** via `calculatePipelineConfidence()`.

The final `resolveAndMap()` return is assembled from these merged results.

---

## Loop Execution Diagram (One Statement)

```
Statement text
    │
    ├─ cleanText()                    → initialCleanedText
    ├─ classifyHierarchical()         → hierarchicalResult (L1→L2→L3)
    ├─ getGates(L2 intent)            → stageGates
    │
    ├─ [Gate: contextResolution]
    │   └─ contextResolver (specific) → afterContext, resolutions
    │
    ├─ cleanText(afterContext)        → cleanedText
    ├─ confidenceGap calculation
    │
    ├─ [Inject Stage 3a entities]     → statementPreEntities[]
    ├─ [Inject IntelliSense products] → statementPreEntities[]
    │
    ├─ [Gate: entityExtraction]
    │   └─ extractEntities()         → extractedEntities
    │
    ├─ [Gate: pie]
    │   └─ resolveIntent()           → intentMatches[]
    │
    ├─ parameterExtractor.extract()   → intents with params
    ├─ parameterBleeder.bleed()       → cross-intent inheritance
    ├─ intentPorter.port()            → ported/degraded intents
    └─ parameterNormalizer.normalize()→ IDs resolved
```

---

*Next: Chapter 9 — Hierarchical Classification (L1 → L2 → L3)*
