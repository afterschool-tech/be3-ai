# Inline inventories (outside config)

## `ACTION_VERBS` — `pipeline/entityExtractor.js`
### What it does
- Maps single-token verbs to action categories.
- Creates action entities used for high-precision intent routing.

### What it does NOT do
- Does not capture multi-word phrases.

### Questions before adding
- Is the verb ambiguous?
- Does it map to exactly one category?

### If not here, add it instead
- Multi-word action phrases: intent `synonyms`.
- Generic desire scaffolding: `weakSynonyms`.

---

## `FILLERS` — `pipeline/entityExtractor.js`
### What it does
- Skips noise tokens so residual product lumps are cleaner.

### What it does NOT do
- Does not affect fuzzy correction.

### Questions before adding
- Is it frequently polluting residual lumps?

---

## `CLAUSE_EXCLUDE` — `pipeline/entityExtractor.js`
### What it does
- Prevents clause extraction from triggering on generic tokens.

---

## IntentScorer guard lists — `pipeline/intentScorer.js`
### What it does
- Penalizes product_name that is actually navigational/verb junk.

### What it does NOT do
- Does not prevent extraction.
