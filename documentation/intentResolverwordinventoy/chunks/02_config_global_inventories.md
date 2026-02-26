# Global inventories in `src/services/intentResolver/config/`

## `stopWords` — `config/stopWords.js`
### What it does
- Skips words for fuzzy correction and orphan fallback logic.

### What it does NOT do
- Does not prevent a word from matching intent `keywords`/`synonyms`.

### Questions before adding
- Is it purely grammatical?
- Do you want typos in this word to ever be corrected?

### If not here, add it instead
- Social noise: `FILLERS` or `nlpCleaner.cleanQuery()` greetings.
- Generic desire scaffolding: `weakSynonyms`.

---

## `commonWords` — `config/commonWords.js`
### What it does
- Protects common conversational words from fuzzy correction.

### What it does NOT do
- Does not influence intent matching.

### Questions before adding
- Is this word being incorrectly typo-corrected?

---

## `weakSynonyms` — `config/weakSynonyms.js`
### What it does
- Down-weights generic multi-word phrases during candidate detection.

### What it does NOT do
- Does not block matching.

### Questions before adding
- Is it generic scaffolding rather than intent-specific?

---

## `conjunctions` — `config/conjunctions.js`
### What it does
- Splits multi-intent statements.

### What it does NOT do
- Does not detect intent.

### Questions before adding
- Does it separate intents reliably?

---

## `conjunctionGuards` — `config/conjunctionGuards.js`
### What it does
- Prevents bad splitting when conjunction links operands.

### What it does NOT do
- Does not guard “then”.

---

## `negations` — `config/negations.js`
### What it does
- Detects negation prefix patterns.

### What it does NOT do
- Does not invert intents by itself.

---

## `intentInversions` — `config/intentInversions.js`
### What it does
- Remaps invertible intents when negated.

### What it does NOT do
- Does not handle nuanced negation.

---

## `intentRegistry` — `config/intentRegistry.js`
### What it does
- Loads intents, builds keyword maps and IDF maps.

### What it does NOT do
- Does not filter stopwords while building IDF.
