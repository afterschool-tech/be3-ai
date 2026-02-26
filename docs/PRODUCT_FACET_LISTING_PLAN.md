# Plan: product.facetListing intent + tool

## Goal
Support questions like:
- "What brands of smartphones do you have?"
- "What colors are available for laptops?"
- "Which storage options do you have for iPhones?"

Return a list of available facet values for a scoped product set.

## Non-goals (v1)
- Perfect semantic QA over facet values
- Multi-turn facet refinement UX beyond basic follow-up prompts

## Proposed user-facing behavior
- If the user asks for available values of an attribute (e.g. brands/colors/storage) and a category is known/resolvable:
  - Return a list of facet values (paginated if needed)
- If the category is missing:
  - Ask a follow-up question to choose the category
- If the attribute is missing (e.g. "what options do you have?"):
  - Ask a follow-up question to choose the attribute

## New intent
- Name: product.facetListing
- Example utterances:
  - "What brands of smartphones do you have?"
  - "List available colors for shoes"
  - "What storage options are available for phones?"
- Parameters (v1):
  - category (optional but usually needed)
  - attribute (required): brand/color/storage/material/size/vendor/price_tier/...
  - product_name (optional): for queries like "what colors does iPhone 15 come in?"
  - vendor (optional)
  - clause_words / price_min / price_max (optional constraints)
  - page / limit (optional)

## Semantic resolving (attribute + category)
### 1) Attribute resolver (similar to clauses)
Maintain an attribute registry:
- canonical: brand
  - synonyms: brand, brands, maker, manufacturer
- canonical: color
  - synonyms: color, colours, shade
- canonical: storage
  - synonyms: storage, memory, gb, rom
- canonical: size
  - synonyms: size, sizes, inch, inches
- canonical: material
  - synonyms: material, fabric
- canonical: vendor
  - synonyms: vendor, store, seller, shop

Resolver rules:
- Detect facet-question patterns:
  - (what|which|list) + (attribute synonym) + (do you have|available|options)
- If multiple attributes detected, choose the best by:
  - proximity to (what|which|list)
  - supported-by-category when category is known

### 2) Category resolver
Reuse existing category normalization + ordinal/reference phrase guards.

## Tool support
### Option A (preferred): new tool `product.facetListing`
- Input:
  - filters: category/product_name/vendor/clause_words/price_min/price_max
  - facet attribute
  - paging: page/limit
- Output:
  - attribute: "brand"
  - category: { id, label }
  - values: [{ value, count? }]
  - pagination: { page, pageSize, hasMore }

Implementation detail: call backend search/index with faceting enabled, or aggregate from product catalog if faceting is unavailable.

### Option B: extend `product.search` to return facets
- `product.facetListing` becomes a thin orchestrator over `product.search`
- Risk: current tool-result optimization may drop facets unless explicitly preserved

## Pipeline changes
- Add intent config: `config/intents/product_facetListing.js`
- schemaResolver scoring:
  - boost when facet-question patterns match
- parameterExtractor:
  - deterministic extraction of `attribute` via synonym table
  - reuse existing category detection + clause stripping
- server tool-result optimization:
  - preserve facet payload fields so the LLM can answer without hallucinating

## UX concerns
- Pagination:
  - return first N facet values + "Next" control
- If values > N and WhatsApp buttons are limited:
  - show a numbered list + "next/cancel"
- Avoid polluting global reference maps:
  - facet listing should not write `reference_map` unless user selects a product

## Tests/logging
Add regression tests/log checks for:
- "What brands of smartphones do you have?"
- "List colors for laptops under $1000"
- "What storage options for iPhone?"
