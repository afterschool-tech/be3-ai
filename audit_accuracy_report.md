# Pipeline Audit Accuracy Report

Comparing `pipeline_audit.md` against the current codebase state.

---

## Verdict: **Mostly Accurate** — 3 items need updating

---

## ✅ Still Accurate

| Audit Section | Status | Notes |
|---|---|---|
| **Stage 0: Microstate Check** | ✅ Correct | Gate logic at [index.js:659-694](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L659-694) unchanged |
| **Stage 1: Fuzzy Typo Correction** | ✅ Correct | [index.js:697](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L697) — runs once on raw input |
| **Stage 0b: IntelliSense** | ✅ Correct | [index.js:707](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L707) — LLM pre-pass, splits text, product names |
| **Stage 3: Preprocessing** | ✅ Correct | [index.js:757-758](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L757-758) — uses IntelliSense statements when available, independent negation |
| **Stage 0.5: Batched Transformer** | ✅ Correct | [index.js:777-823](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L777-823) — single `/analyze` call, `semanticContext` consumed downstream |
| **Stage 4a (Context): Context Resolution** | ✅ Correct | [index.js:862-864](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L862-864) — pronoun resolution via `reference_map` |
| **Stage 4a: Entity Extraction** | ✅ Correct | [entityExtractor.js:114-748](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/entityExtractor.js) — lexical N-gram still runs independently, uses transformer as boost signals via `semanticContext` |
| **Stage 4b: Schema Resolution** | ✅ Correct | [index.js:1059](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L1059) — deterministic scoring, then semantic merge at Stage 4.5 |
| **Stage 5: Parameter Extraction** | ✅ Correct | [index.js:1201-1204](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L1201-1204) — PIE runs independently, checks IntelliSense pre-entities |
| **Stage 4c: Context Reconciliation** | ✅ Correct | [index.js:1236-1242](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L1236-1242) — independent |
| **Stage 7.5: Intent Porting** | ✅ Correct | [index.js:1289](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L1289) — `product_search` → `add_to_cart` pivot |
| **Stage 6: Parameter Bleeding** | ✅ Correct | [index.js:1298](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L1298) — cross-intent param transfer |
| **Stage 7: Inventory Check + Parental Pivot** | ✅ Correct | [index.js:1318-1378](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L1318-1378) — independent |
| **Stage 8a: Search Context** | ✅ Correct | [index.js:1422-1931](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L1422-1931) — read/write cross-request persistence |
| **Stage 8b: Tool Mapping** | ✅ Correct | [index.js:2043-2047](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L2043-2047) — mechanical intent → tool mapping |
| **Stage 10: Microstate Trigger** | ✅ Correct | [index.js:2063-2072](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js#L2063-2072) — uses `winner.pipelineEntities` (not re-extract) |
| **Entity Extraction Overlap Table** | ✅ Correct | All signal sources verified against current code |

---

## ⚠️ Inaccurate / Outdated Items

### 1. Stage 6.5: `normalizeCategory` is NO LONGER called from `parameterNormalizer.js`

> [!IMPORTANT]
> The audit states that Stage 6.5 calls `normalizeCategory` again to normalize the `category` parameter into a UUID. **This is no longer true.**

The current [parameterNormalizer.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/parameterNormalizer.js) has zero references to `normalizeCategory`. Line 238-239 explicitly states:

```
// NOTE: Category Shifting and List Normalization have been removed.
// The pipeline solely relies on Stage 4a (Entity Extractor) for category detection to respect consumed words.
```

**Impact:** The audit's claim that `normalizeCategory` runs in Stage 6.5 is outdated. It only handles clause→attribute mapping, brand folding, and vendor normalization now.

---

### 2. `normalizeCategory` Call Sites Table is Wrong (3 → 2 Sites)

The audit lists **3 call sites** in the pipeline:

| Stage | Audit Claim | Current Status |
|---|---|---|
| 4a — [entityExtractor.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/entityExtractor.js#L454) | ✅ Still there | Lines 454 + 582 (winner trace) |
| 6.5 — parameterNormalizer.js | ❌ **REMOVED** | Zero calls — category normalization stripped |
| 10 — [add_to_cart.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/config/intents/add_to_cart.js#L105) trigger | ✅ Still there | Line 105 in `product_is_category` trigger |

**Corrected table should be:**

| Stage | Caller | Input | Purpose |
|---|---|---|---|
| 4a | entityExtractor.js | residual words / N-grams | Detect category entities from text |
| 10 | add_to_cart.js trigger | `params.product_name` | Check if product name is actually a category |

This drops the "3 places" redundancy claim to **2 places** in the pipeline.

---

### 3. Stage 6.5 Description is Partially Outdated

The audit says Stage 6.5 does:
- `clause_words` → `attributes` ✅ **Still accurate**
- Normalizes vendor names ✅ **Still accurate** (via inline matching, not `normalizeVendor()`)
- Resolves category IDs ❌ **No longer accurate** — this was removed

The `normalizeVendor()` function is only called from **tool-level code** (`product.js`, `discovery.js`), not from `parameterNormalizer.js`. The vendor normalization in Stage 6.5 is now a direct match against `storeContext.VENDORS` (lines 188-231), not a call to the shared `normalizeVendor()` utility.

---

## Summary of Key Redundancy Changes

The audit's **key redundancy conclusion** about `normalizeCategory` running in **3 places** is outdated. The current state is:

```
Before: entityExtractor (4a) → parameterNormalizer (6.5) → add_to_cart trigger (10) = 3 calls
 After: entityExtractor (4a) → add_to_cart trigger (10) = 2 calls
```

The second call site (Stage 6.5) was deliberately removed. The pipeline now relies solely on Stage 4a for category detection, as documented in parameterNormalizer.js line 239.

> [!TIP]
> The remaining concern from the audit is still valid: the `add_to_cart.js` microstate trigger (Stage 10) still calls `normalizeCategory` independently and **does not benefit from upstream results**. But this is now 2 calls, not 3.
