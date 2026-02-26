# Where do I add this new word/phrase? (Checklist)

1) Single verb for high-precision routing → `ACTION_VERBS`
2) Multi-word phrase specific to an intent → intent `synonyms`
3) Single strong unambiguous trigger word → intent `keywords`
4) Generic desire scaffolding → `weakSynonyms`
5) Greeting/politeness polluting residuals → `FILLERS` and/or `nlpCleaner.cleanQuery()`
6) Common English word wrongly typo-corrected → `commonWords`
7) Grammar word that should never be corrected → `stopWords`
8) Multi-intent splitting bugs → `conjunctions` / `conjunctionGuards`
