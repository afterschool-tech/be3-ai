# Per-intent inventories (`config/intents/*.js`)

Each intent defines:
- `keywords`: primary triggers
- `synonyms`: recall expansion phrases

## What `keywords` do
- Used in candidate detection, schema scoring, IDF.
- FuzzyMatcher only corrects typos into `keywords`.

## What `synonyms` do
- CandidateDetector matches extra words and multi-word phrases.

## Current intent lexicons
See the interactive page for the full enumerated list, or refer to the source markdown.
