# Overview

## Scope
This documentation enumerates the word/phrase inventories used by your deterministic intentResolver pipeline.

It covers:
- Global lexicons in `src/services/intentResolver/config/*`
- Inline lexicons that materially affect behavior (e.g. `ACTION_VERBS`, `FILLERS`)
- Cleaning-related lists in `src/services/intentResolver/pipeline/nlpCleaner.js`
- Per-intent `keywords` and `synonyms` in `src/services/intentResolver/config/intents/*.js`

## What you get from this doc
For each inventory/list:
- What it does
- What it does NOT do
- Questions to ask before adding words
- Where to add the word instead if this isn’t the right place
