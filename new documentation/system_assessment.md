# System Assessment — Category Detector & Global Pre-pass

> Written 2026-05-01. Revisit these items when time allows.

---

## Category Detector (`entityExtractor.js` + `normalizeCategory()`)

**Rating: 8.5 / 10** — Production-grade. Architecture is intentional.

### What's Strong (don't touch)
- **Full-scan before committing** — compares all candidates across the full sentence before picking a winner. Most naive implementations break early.
- **Precision Slasher** — dilutes tier points by the category's word count. Without this, long multi-word category names with many overlapping tokens would always win over short precise ones.
- **Tier > Score sort** — certainty of match wins over raw numeric strength. Prevents substring coincidences (e.g. `"son"` inside `"Personal Care & Accessories"`) from beating a confident affix match on `"Sony"`.
- **Three commit outcomes** — certain / partial / semantic guess. Partial matches don't consume words, protecting the downstream search query from being poisoned by uncertain detections.
- **`catMeta.usedWords` for selective consumption** — only the words that directly contributed to the match are consumed. Other words in the phrase stay free for other extractors.

### What to Fix Later

#### 1. Process-scoped memoization cache
`normalizationCache` is a module-level `Map` — fast within a request but wiped on restart. For high-volume stores with large category trees, the first requests after a restart are expensive.

**Fix idea:** Warm the cache on startup by pre-running `normalizeCategory()` on all category labels. Or move to Redis with a short TTL.

#### 2. Semantic boost has no floor guard
The transformer can contribute up to `+50` to a category's score via `semanticBoost = confidence × 50`. This means a category with **zero lexical evidence** can still end up in the sorted results if the transformer is moderately confident. The `quality: 0.35` flag on pure semantic guesses is a partial mitigation, but the boost still affects competition in the `scored[]` array before the final commit.

**Fix idea:** Gate the semantic boost — require at least Tier 2 lexical evidence before applying any semantic boost. Pure transformer confidence alone should not be enough to beat a lexical candidate.

#### 3. Amplification formula edge case
Layer 2 final score = `puritySum × matchedWordCount`. Two weak substring matches (Tier 2) can amplify each other to beat one strong exact match (Tier 4). The tier sort catches the worst cases, but within the same tier, coverage multiplication can occasionally over-reward wide partial coverage over precise single-word hits.

**Fix idea:** Cap the coverage multiplier to `min(matchedWordCount, totalWordsInLabel)` so amplification is bounded by the category's own density.

---

## Global Pre-pass (`resolveClausesGlobal`)

**Rating: 6.5 / 10** — Concept is right, execution relies too heavily on static lists.

### What's Strong (don't touch)
- **Brand priority over clauses** in Step 1 — brands are consumed first so they can't be swallowed by generic clause lookups.
- **Brands excluded from TF-IDF semantic step (Step 2)** — correct decision. Semantic similarity for proper nouns is unreliable.
- **Transformer boost integration (Step 2.5)** — augments existing detections rather than overwriting. Only injects when deterministic layers missed something.
- **Category hints flowing downstream** — clauses pass their `categories[]` arrays as hints to `normalizeCategory()`, giving a `+20 boost` to contextually relevant categories without hard-coding any relationship.

### What to Fix Later

#### 1. CLAUSE_EXCLUDE is a manual, non-scaling blacklist
Words like `"high"`, `"small"`, `"new"`, `"color"` were added to CLAUSE_EXCLUDE because they caused false positives at some point. But this blocks legitimate multi-word clauses like `"high storage"` from matching in Step 1. Every time a new clause overlaps with a common word, someone has to manually add it to CLAUSE_EXCLUDE.

**Fix:** The POS gate (current work) replaces this pattern. Once POS gating is live, CLAUSE_EXCLUDE should be audited and stripped of any words that are legitimate adjectives/nouns (`"high"`, `"small"`, `"new"` etc.).

#### 2. TF-IDF word anchor is approximate
After Step 2 identifies a matching clause, it hunts for the anchor word by checking if any unconsumed word appears in the clause's `label`, `matches[]`, or bench variations. If the user's word doesn't literally appear in those lists (e.g. a synonym or variant), the anchor fails and the entity gets `globalWordIndex: -1` (phantom — no position). The entity still emits, but downstream it can't participate in word-level consumption shielding.

**Fix idea:** Extend the anchor check to also try stemmed/singular forms of bench variations, not just exact matches.

#### 3. One clause per word — no competition
If two clauses both want the same word (e.g. `"large"` could be a size clause OR a quality clause), the first one to consume wins. There's no scoring between competing interpretations.

**Fix idea:** For ambiguous 1-gram matches, emit both candidates as provisional and let a downstream confidence comparison resolve it (similar to how the category scanner runs a full scan before committing).

#### 4. Duplicated FILLERS set
Both `entityExtractor.js` and `semanticClauseResolver.js` maintain their own identical `FILLERS` Set (same ~40 words). Updating one requires manually updating the other.

**Fix:** Extract `FILLERS` to a shared config file (`src/services/intentResolver/config/fillers.js`) and `require()` it in both files.

#### 5. Step 2 can be skipped by Step 1 over-consumption
If Step 1 consumes many words (unlikely but possible on long queries with many brand/clause hits), the `unconsumedText` passed to Step 2 can be so short that the TF-IDF signal is too weak to surface real matches. No explicit guard exists for this edge case.

**Fix idea:** Log a warning when `unconsumedText.length < 3` after Step 1 — this would at least make the situation visible in telemetry.

---

## Side-by-Side Summary

| | Category Detector | Pre-pass |
|---|---|---|
| Core design | ✅ Excellent | ✅ Good |
| Handles edge cases | ✅ Mostly | ⚠️ Sometimes |
| Scales with catalog growth | ✅ Yes | ⚠️ Needs maintenance |
| Scales with clause library growth | ✅ Yes | ❌ Fragile |
| Dependency on static lists | 🟡 Low | 🔴 High |
| Biggest failure mode | Transformer overconfidence inflating score | CLAUSE_EXCLUDE collisions + duplicate FILLERS |
| Most urgent fix | Semantic boost floor guard | POS gate (replaces CLAUSE_EXCLUDE logic) |
