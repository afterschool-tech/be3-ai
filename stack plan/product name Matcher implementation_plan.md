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
- else use `productMatch.product_mention` if medium confidence
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
