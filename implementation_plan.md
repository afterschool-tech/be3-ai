# Implementation Plan: Product Name Context Matcher (≤20k products)

## Goal
Add a deterministic **Product Name Context** subsystem that:
- Extracts a clean **`product_mention`** span from user text (unlumps “for my sister”, etc.).
- Optionally resolves to **`product_canonical`** and **`product_id`** (UUID) with a confidence score.
- Integrates with the existing intentResolver pipeline (entity extraction + residual/chunk logic + parameter extraction).
- Enables **API optimization** by skipping remote product-search calls when local match is confident.

## Non-Goals
- No intent discovery changes.
- No embedding/LLM calls.
- No requirement that user knows UUID.
- No full-text search engine dependency (in-memory is fine for <20k).

---

## Data Contract (Product Name Context)
Maintain an in-memory array refreshed at intervals:

```ts
type ProductContextItem = {
  id?: string;              // uuid (optional)
  canonical: string;        // display name, e.g. "Riggs Perfume"
  aliases?: string[];       // optional, e.g. ["riggs perfume 50ml", "riggs eau de parfum"]
};
```

Store/source can be:
- A JSON file built offline and loaded at boot.
- DB fetch at startup + periodic refresh.
- Cache warmed from API, then persisted.

---

## Core Output Contract (Matcher Result)

```ts
type ProductMatchResult = {
  product_mention?: string;      // span from user query, cleaned
  product_canonical?: string;    // canonical catalog name
  product_id?: string;           // uuid if available
  confidence: number;            // 0..1
  method: "none" | "index_overlap" | "index_overlap_span";
  candidates?: Array<{
    product_id?: string;
    product_canonical: string;
    confidence: number;
  }>;
};
```

---

## Where It Fits in the Pipeline
Recommended placement:

1. `preprocessor` (existing): normalized text / statements
2. `entityExtractor` (existing): vendor/category/brand/action/price + `residualWords`
3. **(new)** `productCatalogMatcher`:
   - Input: original statement text + residual span (or full text)
   - Output: `ProductMatchResult`
4. `schemaResolver` (existing): intent choice (unchanged)
5. `parameterExtractor` (existing): use `ProductMatchResult` to fill params
6. Downstream: tool mapping / microstates

**Key decision**: store matcher output inside extraction result, e.g. `extractionResult.productMatch`.

---

## Component Breakdown

### 1) Normalization Utilities
Implement a single normalization function used for both catalog and query:
- lowercase
- replace punctuation with spaces
- collapse whitespace
- normalize common patterns (optional rules):
  - “air pods” -> “airpods”
  - strip apostrophes
- keep numbers (12, 256gb)
- tokenize into words

Maintain a stopword list for candidate generation:
- `for`, `my`, `the`, `a`, `an`, `with`, `to`, `from`, `please`, etc.

### 2) Index Builder (In-Memory)
Build once per refresh interval:

- **Token inverted index**
  - `token -> Set(productKey)`
- **Product entries**
  - For each `productKey`, store:
    - `canonical`
    - `id`
    - `tokensCanonical`
    - `tokensAliases` (flattened)
- **Token weights (IDF-like)**
  - `idf[token] = log( (N + 1) / (df[token] + 1) ) + 1`
  - Compute `df[token]` across all product names + aliases.

This is fast at 20k.

### 3) Candidate Generation
Inputs:
- `queryText`
- `residualSpanText` (preferred) or full statement
- optional gating signals (vendor/category/brand if later added)

Process:
- `queryTokens = tokenize(residualSpanText || queryText)`
- filter stopwords and very short tokens (len < 2/3)
- for each remaining token:
  - get `candidateSet = index[token]`
- rank candidates by:
  - count of matched tokens (or sum of token IDFs matched)
- keep top K candidates (e.g. `K=200`)

### 4) Candidate Scoring (Deterministic)
For each candidate, compute a confidence score from:

- **IDF-weighted token coverage**
  - `coverage = sum(idf[t] for t in matchedTokens) / sum(idf[t] for t in productTokens)`
- **Length guard**
  - penalize candidates where only 1 weak token matched (e.g. “pro”)
- **Gap / dispersion penalty** (optional but helpful)
  - measure distance between first and last matched token positions in query
  - more dispersion => more penalty

Return the top candidate + top-N list if close.

### 5) Span Extraction (Unlumping)
This step produces `product_mention`.

Given:
- original `residualSpanText` (or full statement)
- positions of matched tokens in the query tokens

Compute:
- minimal window in token indices that covers the matched tokens
- map that back to a substring of the original text (best-effort)
- output substring as `product_mention`

Notes:
- If query order is reversed (“perfume from riggs”), window may become "perfume from riggs" which is acceptable as a `mention`.
- You can still set `product_canonical` = "Riggs Perfume".

### 6) Confidence Bands & Ambiguity
Define thresholds (tune later):

- **High confidence** (e.g. `>= 0.75`)
  - set `product_id` (if known), `product_canonical`, `product_mention`
- **Medium** (e.g. `0.45–0.75`)
  - set `product_mention` + `candidates` top 3
  - allow microstate disambiguation if intent requires exact product
- **Low** (`< 0.45`)
  - don’t claim a product; return `method: "none"` (or weak mention only if desired)

---

## Integration Details

### Entity Extraction Integration
Add a new field on extraction result (do not confuse with intent entities):
- `extractionResult.productMatch = ProductMatchResult`

Optionally also add an entity-style entry:
- `{ type: "product_match", ... }`

### Parameter Extraction Integration
When an intent expects `product_name` / `product_id`:
- prefer `productMatch.product_id` if high confidence and present
- else use `productMatch.product_canonical` if high confidence
- else use `productMatch.product_mention`
- else fallback to existing residual-lump behavior

**Important invariant**: never overwrite an already-solid structured extraction (e.g. if structural template already extracted `product_name`).

### Microstate (Optional)
If:
- intent requires product specificity AND
- `productMatch.candidates` exist AND are close in score

Trigger microstate:
- “Which one did you mean?”
- show canonical names

---

# Fixing Suggestion Button Logic and Image Suppression

The user wants product suggestions to remain as a text list with "See product details" and "See more" buttons (no cards, no images). 
However, when "See product details" is clicked, it should trigger a re-search using the fallback parameters, and THIS re-search should return product cards and images.

Currently, the re-search fails to show cards because:
1. The `engineered_see_results` flag (triggered by the button) isn't reaching the `product.search` tool.
2. `product.search` suppresses cards if `products.length` is 0, and fallback results are currently kept in `suggestedProducts`.

## Proposed Changes

### Core Orchestrator

#### [MODIFY] [orchestrator.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/core/orchestrator.js)

- Update `executeTools` to pass `pipelineContext` (which contains `engineered_*` flags like `engineered_see_results`) into the `context` object passed to tool handlers.

---

### Product Search Tool

#### [MODIFY] [product.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/tools/product.js)

- Update `product.search` handler to check for `context.engineered_see_results`.
- **Primary Change**: If `engineered_see_results` is present, the tool should intentionally "promote" fallback results to primary products.
- In `buildSearchCall`, if `engineered_see_results` is true, the re-searched products should be returned as `products` (not `suggestedProducts`).
- Ensure `suppress_images` is set on suggestions (list mode) but **not** on replayed results (card mode).

---

### Image Injection

#### [MODIFY] [imageInjector.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/imageInjector.js) (Verify)

- Confirm `extractImages` and `injectImages` respect the `suppress_images` flag.

## Verification Plan

### Automated Tests
- Modify `test_see_results.js` to simulate the `engineered_see_results` flag and verify `whatsapp_product_cards` is present.

### Manual Verification
1. Search for a non-existent item (e.g. "iPhone 99").
2. Verify:
   - AI response is a text list of suggestions.
   - NO product cards or images are visible.
   - "See product details" button is at the bottom.
3. Click "See product details".
4. Verify:
   - The bot returns product cards for the suggested items.
   - Images are shown on these cards.

---

## API Optimization Plan
Since local context is refreshed periodically:

### 1) Skip search when confident local match exists
If `productMatch.confidence >= HIGH` and you have `product_id`:
- Skip remote product search calls.
- Use local match to proceed (or fetch product detail by id only if required).

### 2) Avoid empty/low-signal searches
If `productMatch.confidence` is very low and residual contains no meaningful tokens:
- Ask clarification rather than calling search API.

### 3) Do NOT block remote search if local context is incomplete
If local context might be stale:
- treat local “no match” as weak signal
- still allow remote search, but consider adjusting query to the extracted `product_mention` span.

---

## Refresh / Update Strategy (Intervals)
- Build index at boot from stored list.
- Refresh every X minutes/hours:
  - replace index atomically (build new, then swap reference)
- Keep build cost bounded:
  - for 20k products, rebuild is typically fine.

---

## Testing Plan (Minimal but Effective)
Create a small deterministic test set (unit tests or a script):

- **Span extraction**
  - “riggs perfume for my sister” => mention “riggs perfume”
  - “perfume from riggs for my sister” => mention “perfume from riggs”
- **Variant/discontinuous**
  - “airpods, i want the pro version” => canonical “AirPods Pro” (if exists)
- **False positive guards**
  - “a perfume for my sister” => no product match
- **Ambiguity**
  - “iphone 12” with multiple SKUs => candidates returned

Log:
- confidence
- candidate count
- chosen mention span

---

## Deliverables Checklist (When You Implement)
- Module: `ProductCatalogMatcher` (buildIndex + match)
- Data loader: loads product context list + periodic refresh
- Pipeline wiring:
  - call matcher after residual/chunk decision
  - attach result to extraction output
- Parameter extractor update:
  - uses match result to fill `product_name`/`product_id`
- API gate:
  - skip/search decisions based on confidence + availability of UUID
- Tests: basic coverage for the categories above
