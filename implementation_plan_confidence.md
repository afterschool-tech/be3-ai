# Pipeline Confidence Score — Implementation Plan

## Goal

Build a **multi-directional confidence tracker** that flows through the entire intent resolution pipeline, aggregating signals from every stage. Each stage contributes a confidence delta (positive or negative). The final score (0–100) determines whether the Product Sentinel activates, replacing the current hardcoded `ENABLE_SENTINEL = true` flag.

## Pipeline Stage Map & Confidence Signals

The pipeline has **12 confidence-contributing stages** grouped into 4 phases:

### Phase A — Pre-Processing (Stages 0–1)
| Stage | File | Confidence Signal | Impact |
|---|---|---|---|
| **0: Microstate** | `index.js:630` | If handled → 100 (skip sentinel entirely). If breakthrough → −10 (unstable context) | Context stability |
| **0b: IntelliSense** | [intelliSense.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intelliSense.js) | Product count extracted, grounding pass/fail, statement split count | Extraction quality |
| **0.5: Transformer** | `index.js:700` | Available/unreachable, classification confidence gap, entity count | External service reliability |
| **1: Fuzzy** | [fuzzyMatcher.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/fuzzyMatcher.js) | `changed` flag — if corrections were needed → −5 | Input quality |

### Phase B — Entity & Intent Resolution (Stages 3–4)
| Stage | File | Confidence Signal | Impact |
|---|---|---|---|
| **3a: Global Pre-pass** | `semanticClauseResolver` | Clause/brand count, quality scores | Entity richness |
| **4a: Entity Extraction** | [entityExtractor.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/entityExtractor.js) | Entity count, category tier (1=exact/2=fuzzy), category quality score, residual word count | Entity precision |
| **4b: Schema Resolution** | [schemaResolver.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/schemaResolver.js) | Winner score, score gap to 2nd place, required slots filled ratio, signal density, fallback used | Intent certainty |
| **4.5: Confidence Amplifier** | `index.js:935` | Transformer gap × amplifier, agreement between deterministic + semantic winner | Cross-system agreement |

### Phase C — Post-Resolution (Stages 5–7)
| Stage | File | Confidence Signal | Impact |
|---|---|---|---|
| **5: Params** | [parameterExtractor.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/parameterExtractor.js) | Were all required params filled? AI needed? | Parameter completeness |
| **7.5: Intent Porting** | [intentPorter.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/intentPorter.js) | Was intent ported? (search→cart pivot) | Intent stability |
| **6: Bleeding** | [parameterBleeder.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/parameterBleeder.js) | Were params bled from another statement? | Cross-dependency |
| **7: Inventory** | `index.js:1187` | Empty category found, parental pivot needed | Catalog coverage |

### Phase D — Cross-System Agreement (Bonus/Penalty)
| Signal | Description | Impact |
|---|---|---|
| **IntelliSense ↔ Entity Extractor** | Did both find the same product name? | ±10 |
| **Transformer ↔ Schema** | Did both pick the same winning intent? | ±15 |
| **Category Tier** | Tier 1 (exact) vs Tier 2 (fuzzy normalizeCategory) | ±5 |
| **Orphan Fallback** | Was intent assigned via orphan product fallback? | −15 |
| **Semantic-Only Winner** | Did the winner have 0 deterministic score? | −20 |
| **Fallback Chain** | How many fallback stages fired in product.search tool? | −5 per fallback |

---

## Proposed Implementation

### 1. Confidence Tracker Module

#### [NEW] [pipelineConfidence.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/pipelineConfidence.js)

A lightweight tracker object that gets created once per request and flows through the pipeline. Each stage calls `tracker.record(stage, delta, reason)`.

```js
class PipelineConfidenceTracker {
    constructor() {
        this.score = 100;
        this.signals = [];
    }
    record(stage, delta, reason) { ... }
    bonus(stage, value, reason) { ... }
    penalty(stage, value, reason) { ... }
    getScore() { return Math.max(0, Math.min(100, this.score)); }
    getSummary() { return { score, signals, verdict }; }
}
```

---

### 2. Integration Points (14 Instrumentation Points)

#### [MODIFY] [index.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js)

1. **Create tracker** at pipeline entry ([resolveAndMap](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#99-2100) start)
2. **Stage 1 (Fuzzy)**: `if (changed) tracker.penalty('fuzzy', 5, 'Typo corrections applied')`
3. **Stage 0b (IntelliSense)**: Record product extraction count, grounding failures
4. **Stage 0.5 (Transformer)**: Record availability, confidence gap
5. **Stage 3a (Pre-pass)**: Record clause/brand richness
6. **Stage 4a (Entities)**: Record entity count, category quality/tier, residual count
7. **Stage 4b (Schema)**: Record winner score, score gap, signal density, fallback
8. **Stage 4.5 (Amplifier)**: Record deterministic-semantic agreement/disagreement
9. **Stage 5 (Params)**: Record required param fill rate
10. **Stage 7.5 (Porting)**: Record if intent was ported
11. **Stage 7 (Inventory)**: Record empty category / parental pivot
12. **Cross-system agreement**: IntelliSense vs EntityExtractor product match, Transformer vs Schema winner match
13. **Attach tracker** to the final return object: `result.confidenceTracker = tracker`

#### [MODIFY] [deterministicResolver.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/core/deterministicResolver.js)

Pass the confidence score through to [server.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/core/server.js):
```js
output.pipelineConfidence = result.confidenceTracker?.getScore() ?? 100;
output.confidenceSummary = result.confidenceTracker?.getSummary() ?? null;
```

#### [MODIFY] [server.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/core/server.js)

Replace `ENABLE_SENTINEL = true` with threshold check:
```js
const SENTINEL_THRESHOLD = 60; // Below this → sentinel activates
const shouldRunSentinel = selection.pipelineConfidence < SENTINEL_THRESHOLD;
```

#### [MODIFY] [productSentinel.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/core/productSentinel.js)

- Accept `pipelineConfidence` as param instead of checking internal flag
- Log the confidence score that triggered activation

---

### 3. Telemetry

Add a `SERVER:PIPELINE_CONFIDENCE` log entry showing the full breakdown before the sentinel check:

```js
logDebug('SERVER:PIPELINE_CONFIDENCE', {
    _desc: 'Pipeline confidence score — aggregate signals across all stages',
    score: pipelineConfidence,
    verdict: pipelineConfidence >= 60 ? 'PASS (sentinel skipped)' : 'LOW (sentinel activated)',
    signals: confidenceSummary?.signals
});
```

---

## Confidence Scoring Rules (Detailed)

### Penalties (subtract from 100)

| Rule | Delta | Condition |
|---|---|---|
| Fuzzy correction applied | −5 | `afterFuzzy !== userMessage` |
| IntelliSense grounding failure | −5 | Any [text](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/core/dco/index.js#241-250) replacement in vetting |
| Transformer unreachable | −10 | `batchedSemanticContext === null` |
| Transformer low confidence gap | −5 | Gap between 1st and 2nd < 0.04 |
| Low entity count | −5 | Total entities ≤ 1 |
| Category from Tier 2 (fuzzy) | −5 | `entity.quality < 1.0` |
| High-scoring category lost to tier | −8 | Category with score > winner but lower tier |
| Signal density gate fired | −10 | `isLowSignal === true` |
| Winner score gap < 2 | −10 | Gap between 1st and 2nd intent < 2.0 |
| Orphan product fallback used | −15 | Winner has `matchedKeywords: ['orphan_product']` |
| Semantic-only winner (0 deterministic) | −20 | `breakdown.deterministic === 0` |
| Required params unfilled | −5 per param | Missing required slot |
| Intent ported (search→cart) | −3 | `_ported_from` set |
| Parameter bleeding occurred | −3 | `bledParams.length > 0` |
| Parental pivot (empty category) | −8 | `_pivoted_from` set |
| Ambient context injected | −5 | Phantom entities added |
| **product.search fallback chain** | −5 per step | Vector fallback, relaxed query, etc. |

### Bonuses (add to 100 / restore lost points)

| Rule | Delta | Condition |
|---|---|---|
| IntelliSense ↔ Entity product match | +10 | Same product name from both |
| Transformer ↔ Schema agree on winner | +15 | Same `intentName` at #1 |
| Category from Tier 1 (exact match) | +5 | `quality === 1.0` |
| High confidence gap (transformer) | +5 | Gap > 0.10 |
| Winner score > 15 total | +5 | Strong intent signal |
| All required params filled | +5 | Full parameter coverage |
| Engineered token (button click) | +100 | User clicked a structured button — skip sentinel |

---

## Verification Plan

### Automated Tests
There are no existing unit tests for the pipeline confidence system (it's new). We will create:

#### [NEW] `__pipeline_tests__/pipelineConfidence.test.js`
Unit tests for the `PipelineConfidenceTracker` class:
- Starts at 100
- `penalty()` subtracts, `bonus()` adds
- Score capped at 0–100
- `getSummary()` returns signals array
- Multiple signals accumulate correctly

**Run with:** `npx jest __pipeline_tests__/pipelineConfidence.test.js`

### Manual Verification
1. **Search "gaming phones"** → Should show low confidence (poor entity match) → Sentinel activates
2. **Search "Samsung phones"** → Should show high confidence (strong entity match) → Sentinel skips
3. **Click a product button** → Should show 100 confidence (engineered token) → Sentinel skips
4. **Check telemetry** → `SERVER:PIPELINE_CONFIDENCE` log shows full breakdown with all signals

> [!IMPORTANT]
> The threshold (`SENTINEL_THRESHOLD = 60`) is a tuning parameter. After implementation, we'll run several queries and calibrate based on telemetry data.
