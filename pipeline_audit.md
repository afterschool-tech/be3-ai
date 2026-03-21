# Pipeline Stage Redundancy Audit

## Stage 0: Active Microstate Check
**What it does:** Checks if a microstate is open. If yes, processes the message inside the microstate. If handled → returns early. If not (breakthrough) → falls through.
**Redundancy:** ✅ None. This is a gate, not duplicated work.

---

## Stage 1: Fuzzy Typo Correction
**What it does:** Levenshtein-based typo correction with entity guards (e.g. "crrt" → "cart").
**Redundancy:** ✅ None. Runs once on raw input. No earlier stage does this.

---

## Stage 0b: IntelliSense (LLM Pre-Pass)
**What it does:** LLM call to split statements, extract product names, and mark pronouns to skip.
**Redundancy:** ✅ None. This is the first stage that detects products and splits text. It's upstream of everything else.

---

## Stage 3: Preprocessing
**What it does:** Normalize text, detect negation, split on conjunctions.
**What already does it:** IntelliSense (Stage 0b) also splits text into statements.
**Does it redo blindly?** ⚠️ **Partially conditional.** If IntelliSense provided `manualStatements`, the preprocessor uses those directly. If not, it falls back to its own splitting. **The negation detection is always independent** — IntelliSense doesn't handle negation.

---

## Stage 0.5: Batched Transformer
**What it does:** Calls the transformer service (`/analyze`) to get semantic intent classification + entity extraction (categories, vendors, clauses, attributes) in one batch.
**Redundancy:** ✅ None. This is the only semantic/embedding-based analysis stage. Its output (`semanticContext`) is consumed by later stages.

---

## Per-Statement Loop begins here:

### Stage 4a (Context): Context Resolution
**What it does:** Resolves pronouns ("it", "the first one") using `reference_map` and `ordinal_list` from state.
**Redundancy:** ✅ None. This is where state-based pronoun resolution happens. IntelliSense handles `skip_resolve` guards, but this stage does the actual resolution.

### Stage 4a: Entity Extraction
**What it does:** Extracts vendors, categories, brands, actions, clauses, and residual words from text. Builds the dynamic "shape" of the statement.
**What already does it:** Transformer (Stage 0.5) already extracted categories, vendors, clauses, and attributes.
**Does it redo blindly?** ⚠️ **Yes, partially blind.** It re-runs its own lexical N-gram category scanner, vendor detection, action verb detection, and brand detection from scratch. However, it does:
- **Respect** IntelliSense pre-entities (`statementPreEntities`) — it shields `resolved_product` entities from the category scanner.
- **Receive** transformer semantic hints (`localSemanticContext`) — but these are used as **boost signals** in [normalizeCategory](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/normalization.js#10-647), not as a replacement. The lexical scan still runs independently.

> [!WARNING]
> The lexical category scan here can **conflict** with the transformer's category detection. A word like "iphone" might match a category lexically even though the transformer says it's part of a product name.

### Stage 4b: Schema Resolution (Intent Scoring)
**What it does:** Scores intent candidates using deterministic schema fit (keyword matches, slot matches, action verb IDF).
**What already does it:** Transformer (Stage 0.5) already classified intents with semantic similarity scores.
**Does it redo blindly?** ⚠️ **Yes, then merges.** It builds its own candidate list from deterministic scoring, then at Stage 4.5 it **adds** the transformer's semantic scores on top. Both scores are combined — neither replaces the other.

### Stage 5: Parameter Extraction
**What it does:** Maps entities to intent parameter slots. Uses PIE (Product Intel Extractor) to synthesize product names. Applies regex patterns and structural matching.
**What already does it:** IntelliSense (Stage 0b) already extracted product names.
**Does it redo blindly?** ⚠️ **Partially.** PIE runs its own product detection logic (segmentation, heuristics) independently of IntelliSense. However, PIE **does check** for IntelliSense-provided `resolved_product` entities in `statementPreEntities` and uses them as signals. The category normalization inside parameter extraction also runs [normalizeCategory](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/normalization.js#10-647) again for `category` parameters.

### Stage 4c: Context Reconciliation
**What it does:** Maps resolved references ("the first one" → specific product) from state context to parameters.
**Redundancy:** ✅ Independent. This is the only stage that does state-based parameter reconciliation.

---

## Post-Loop Stages:

### Stage 7.5: Intent Porting
**What it does:** Pivots `product_search` → `add_to_cart` when a product is in `reference_map` and a purchase verb is detected.
**Redundancy:** ✅ Independent. No other stage does intent pivoting.

### Stage 6: Parameter Bleeding
**What it does:** Pass missing required params from earlier statements to later ones in multi-intent scenarios.
**Redundancy:** ✅ Independent. Only relevant for multi-intent, no other stage handles cross-statement parameter transfer.

### Stage 6.5: Parameter Normalization
**What it does:** Converts `clause_words` → `attributes`, normalizes vendor names, resolves category IDs.
**What already does it:**
- **Category normalization** — [normalizeCategory](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/normalization.js#10-647) was already called in Stage 4a (entity extraction) to detect categories. Here it runs **again** to normalize the `category` parameter.
- **Vendor normalization** — [normalizeVendor](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/normalization.js#648-699) runs here. Stage 4a also detected vendors.
**Does it redo blindly?** ⚠️ **Yes, category normalization runs again.** Stage 4a calls [normalizeCategory](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/normalization.js#10-647) to detect category entities. Stage 6.5 calls it **again** to normalize the `category` parameter into an ID. In practice these often process different inputs (entity extraction uses residual words, normalization uses the extracted category param), but the underlying function runs twice.

### Stage 7: Inventory Check + Parental Pivot
**What it does:** Checks if a category has 0 products, suggests siblings, pivots to parent category.
**Redundancy:** ✅ Independent. No other stage checks inventory counts.

### Stage 8a: Search Context (Read/Write)
**What it does:** For search intents: writes search context (category, clauses, attributes). For cart/compare: reads search context to resolve references (ordinals, pronouns, clause matches).
**Redundancy:** ✅ Independent. This is the only stage that reads/writes search context for cross-request persistence.

### Stage 8b: Tool Mapping
**What it does:** Maps intents → tool calls via `paramMap`, expands product arrays.
**Redundancy:** ✅ Independent. Mechanical mapping, no logic overlap.

### Stage 10: Microstate Trigger Check
**What it does:** Checks if the winning intent triggers a microstate (e.g. `product_is_category`, `missing_product`).
**What already does it:** Entity extraction (Stage 4a) already identified entities including `resolved_product`.
**Does it redo blindly?** ⚠️ **Was blind, now fixed.** Previously called [extractEntities()](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/entityExtractor.js#101-529) from scratch, discarding all IntelliSense/PIE signals. Now uses `winner.pipelineEntities` (just fixed). However, the `product_is_category` trigger **still calls [normalizeCategory](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/normalization.js#10-647) independently** — that's the 3rd call to normalizeCategory in the pipeline.

---

## Summary: [normalizeCategory](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/normalization.js#10-647) Call Sites

| Stage | Caller | Input | Purpose |
|-------|--------|-------|---------|
| 4a | [entityExtractor.js](file:///c:/Users/chatz/Downloads/eCommerce/be3-ai-transformer/src/services/entityExtractor.js) | residual words / N-grams | Detect category entities from text |
| 6.5 | [parameterNormalizer.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/parameterNormalizer.js) | `params.category` string | Normalize category param → UUID |
| 10 | [add_to_cart.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/config/intents/add_to_cart.js) trigger | `params.product_name` | Check if product name is actually a category |

All three are independent calls. **#1 and #3 can conflict**: Stage 4a might NOT detect a category, but Stage 10 re-runs [normalizeCategory](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/normalization.js#10-647) on the product name and gets a hit.

## Summary: Entity Extraction Overlap

| Signal | IntelliSense (0b) | Transformer (0.5) | EntityExtractor (4a) | PIE (5) |
|--------|-------------------|--------------------|---------------------|---------|
| Product names | ✅ LLM | ❌ | ❌ (uses as pre-entity) | ✅ heuristic |
| Categories | ❌ | ✅ semantic | ✅ lexical N-gram | ❌ |
| Vendors | ❌ | ✅ semantic | ✅ lexical | ❌ |
| Clauses | ❌ | ✅ semantic | ❌ (pre-entity) | ❌ |
| Attributes | ❌ | ✅ semantic | ❌ | ❌ |
| Intent class | ❌ | ✅ semantic | ❌ | ❌ |
| Actions/verbs | ❌ | ❌ | ✅ IDF-weighted | ❌ |

> [!IMPORTANT]
> **Key redundancy:** Category detection runs in **three** places (Transformer semantic, EntityExtractor lexical, and microstate trigger). Vendor detection runs in **two** places (Transformer and EntityExtractor). These are intentionally layered for resilience (transformer may be down), but the microstate trigger's [normalizeCategory](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/normalization.js#10-647) call is the problematic one — it doesn't benefit from either upstream result.
