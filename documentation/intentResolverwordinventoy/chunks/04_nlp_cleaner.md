# Cleaning inventories (`pipeline/nlpCleaner.js`)

## `cleanText(text)`
### What it does
- Removes adverbs.
- Lowercases and strips punctuation.

### What it does NOT do
- Does not remove conjunctions by default.

---

## `stripSocialNoise(text)`
### What it does
- Removes greetings.

---

## `cleanQuery(text)`
### What it does
- Aggressively removes adverbs, conjunctions, prepositions, pronouns, modals.
- Removes action-noise verbs and greetings/politeness.
- Produces a product-like query string.

### What it does NOT do
- Does not understand products (only removes noise).

### Questions before adding
- Could this token appear in real product names?
- Would removing it break meaning?
