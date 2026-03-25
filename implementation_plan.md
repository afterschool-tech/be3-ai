# Pipeline Entity Extraction Bug Fixes

Three bugs in the entity pipeline cause category detection to fail or resolve incorrectly.

## Proposed Changes

---

### Bug 1: Multi-word `resolved_product` only shields first word index

#### [MODIFY] [index.js](file:///C:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/index.js)

Lines ~878-886: Add explicit `wordIndices` alongside existing fields:

```diff
 statementPreEntities.push({
     type: 'resolved_product',
     value: p.name,
     adjectives: p.adjectives || [],
     source: 'INTELLISENSE_OVERRIDE',
     quality: 1.0,
     localWordIndex: indices.length > 0 ? Math.min(...indices) : undefined,
+    wordIndices: indices.length > 0 ? indices : undefined,
     wordCount: nameTokens.length > 0 ? nameTokens.length : 1
 });
```

#### [MODIFY] [entityExtractor.js](file:///C:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/entityExtractor.js)

Lines ~172-185: Prefer pre-computed `wordIndices` when available:

```diff
 for (const preEnt of preDetectedEntities) {
     let localIdx = preEnt.localWordIndex;
     if (localIdx === undefined) localIdx = preEnt.globalWordIndex;
-    const wordCount = preEnt.wordCount || 1;
-    if (localIdx === undefined || localIdx < 0 || localIdx >= words.length) continue;
-    const indices = Array.from({ length: Math.min(wordCount, words.length - localIdx) }, (_, i) => localIdx + i);
+    let indices;
+    if (Array.isArray(preEnt.wordIndices) && preEnt.wordIndices.length > 0) {
+        indices = preEnt.wordIndices.filter(idx => idx >= 0 && idx < words.length);
+    } else {
+        const wordCount = preEnt.wordCount || 1;
+        if (localIdx === undefined || localIdx < 0 || localIdx >= words.length) continue;
+        indices = Array.from({ length: Math.min(wordCount, words.length - localIdx) }, (_, i) => localIdx + i);
+    }
+    if (indices.length === 0) continue;
+    if (localIdx === undefined) localIdx = Math.min(...indices);
     if (consumed.has(localIdx)) continue;
```

---

### Bug 2+3: Semantic kickstart when no residuals exist

After N-gram finds nothing AND all non-filler words are consumed, directly resolve transformer's top category slug from `storeContext.CATEGORIES`.

#### [MODIFY] [entityExtractor.js](file:///C:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/entityExtractor.js)

After line ~407, add semantic kickstart fallback:

```js
// ── 3b. Semantic Category Kickstart ──
if (!entities.some(e => e.type === 'category') && semanticContext?.available && semanticContext.entities?.category?.length > 0) {
    const hasUnconsumedNonFiller = words.some((w, i) => !consumed.has(i) && !FILLERS.has(w) && w.length > 1);

    if (!hasUnconsumedNonFiller) {
        const semCategories = semanticContext.entities.category
            .map(slug => ({ slug, confidence: semanticContext.confidence?.[`category:${slug}`] || 0 }))
            .sort((a, b) => b.confidence - a.confidence);

        const topSlug = semCategories[0]?.slug;
        if (topSlug) {
            const catEntry = Object.entries(storeContext.CATEGORIES).find(([key, c]) =>
                key === topSlug || c.slug === topSlug || c.label?.toLowerCase() === topSlug
            );
            if (catEntry) {
                const [, cat] = catEntry;
                entities.push({
                    type: 'category',
                    value: topSlug,
                    id: cat.id,
                    source: 'SEMANTIC_KICKSTART',
                    quality: 0.35,
                    wordIndices: [-1],
                    consumedWordIndices: []
                });
                logDebug('ENTITY:SEMANTIC_CATEGORY_KICKSTART', {
                    _desc: 'Semantic kickstart — determinism had no free words, transformer directly resolved category',
                    slug: topSlug,
                    confidence: semCategories[0].confidence,
                    resolvedId: cat.id,
                    resolvedLabel: cat.label
                });
            }
        }
    }
}
```

---

### Bug 4: Premature N-gram termination from semantic-only matches

**The real problem**: The 1-gram inner loop goes `i=0, 1, 2...`. When `i=0` lands on a non-category word like `"nice"`, [normalizeCategory("nice")](file:///C:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/normalization.js#10-647) returns null without semantic. But WITH semantic loaded, the transformer's category scores produce `semanticBoost > 0` with zero `wordMatches` → line 491 in [normalizeCategory](file:///C:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/normalization.js#10-647) doesn't skip it → a category is returned. The N-gram loop `break`s, and the actual category word at a later index (like `"smartphone"` at `i=2`) is never scanned.

**Concrete trace** — `"nice affordable smartphone"` with `affordable` consumed as clause:

| 1-gram `i` | Word | What happens |
|---|---|---|
| 0 | `nice` | [normalizeCategory("nice")](file:///C:/Users/chatz/Downloads/eCommerce/be3_ai/src/utils/normalization.js#10-647) → lexScore=0, semanticBoost=46.5 → **returns match** → loop breaks ❌ |
| 1 | `affordable` | consumed → skip |
| 2 | `smartphone` | **Never reached** — would have been a direct key hit ✅ |

**Fix**: In the N-gram loop, reject layer2 matches that have zero lexical contribution. Semantic stays loaded in every call — when determinism DOES find a real word match at a later iteration, semantic boosts it naturally.

#### [MODIFY] [entityExtractor.js](file:///C:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/pipeline/entityExtractor.js)

Line ~366, inside the `if (catId)` block:

```diff
 if (catId) {
+    // Reject semantic-only layer2 matches — no lexical evidence means
+    // this N-gram phrase doesn't actually contain a category word.
+    // Let the loop continue to find one that does.
+    if (catMeta && catMeta.layer === 'layer2' && (catMeta.lexScore === 0 || catMeta.lexScore === undefined)) {
+        continue;
+    }
     let categoryQuality = 1.0;
```

> [!NOTE]
> Key/layer1 matches are unaffected — they always have real evidence. And `"nice smartphone"` as a 2-gram still works because `"smartphone"` produces `wordMatches` → `lexScore > 0`.

---

## Verification

| # | Message | Expected |
|---|---|---|
| 1 | `show me smartphone` | Category via semantic kickstart |
| 2 | `show me a bucksaving smartphones` | Category via N-gram (regression) |
| 3 | `nice affordable smartphone` (`affordable` consumed) | Category via 1-gram on `smartphone`, NOT on `nice` |
| 4 | `show me phone accessories` | Multi-word category works |
| 5 | `show me iphone 15` | Stays `resolved_product` |
