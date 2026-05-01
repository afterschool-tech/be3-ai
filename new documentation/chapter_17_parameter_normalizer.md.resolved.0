# Chapter 17 — Parameter Normalizer

## Why Normalisation Exists as a Separate Stage

By the time parameters reach the normaliser, they are semantically correct but structurally raw. The entity extractor and parameter extractor speak in human terms: they produce things like `brand: "apple"`, `clause_words: [{ clauseId: "budget_range", word: "cheap" }]`, `vendor: "bola"`. The backend search API and tool handlers speak in coded terms: attribute codes like `"b"` for brand, composite filter keys like `"p:p"` for a named price tier clause, and official vendor tags like `"Bola Foods"`.

The normaliser is the translation layer between these two vocabularies. It takes the raw parameter output of the extraction stage and converts it into the precise format that downstream tools can execute against without ambiguity.

There is also a correctness problem it solves: raw extraction cannot know whether a detected vendor name is an official store tenant, a brand alias, or just noise. It cannot know whether a clause like `"affordable"` should map to a single attribute value or to a named multi-value filter. The normaliser has access to the full `storeContext` — the live catalogue of categories, attributes, vendors, and their configurations — and uses it to make these determinations.

---

## The Compare Intent Guard

The normaliser begins each intent with a check: is this a `product_compare` intent? If yes, clause-to-attribute mapping is skipped entirely for that intent.

The reason is subtle. When a user asks to compare two products, the resolved product names stored in `clause_words` may contain brand tokens — for instance, the word `"infinix"` might appear as a clause entity because Infinix is defined as a brand clause in the clause registry. But in a compare context, `"infinix"` is part of the product identity (`"Infinix Hot 40"`), not a search filter instruction. Converting it to `attributes.brand = "infinix"` would add a brand filter to the comparison query, which would silently narrow the results to only Infinix products and potentially exclude the other product being compared. The guard prevents this by treating compare intents as sovereign over their own product names.

---

## Clause-to-Attribute Mapping: The Three Resolution Levels

When `clause_words` is present and the intent is not a compare, the normaliser iterates over each clause entry and attempts to map it to a structured attribute filter through three levels of resolution, in order from most precise to most general.

### Level 1 — Composite Attribute Encoding

This is the most precise path and the preferred one. Each attribute in the store's `ATTRIBUTES` metadata can define its own `clauses` array — a list of named clause definitions that describe what certain adjectives mean in the context of that attribute. For example, the `price_tier` attribute (`code: "p"`) might define a clause called `"Budget Range"` whose name is `"p"` and whose matches are `["budget", "midrange"]`. When a user says `"affordable phones"`, the clause `budget_range` maps to this definition.

The normaliser computes a composite key by concatenating the attribute's backend code with the clause definition's own name, separated by a colon: `"p:p"`. It then takes the `matches` array from the clause definition and joins them into a comma-separated string: `"budget,midrange"`. The result is a single attribute entry: `{ "p:p": "budget,midrange" }`. This composite key syntax is understood by the backend as a named clause filter — it means "apply the price_tier attribute using the 'p' clause filter, which expands to budget and midrange tiers."

The power here is that the user said one word (`"affordable"`) and the system produced a precise multi-value filter that matches against the backend's internal taxonomy without any AI inference. Everything is deterministic from the clause registry.

**The Double Mapping Guard** sits inside this step. When a composite key like `"p:p"` is about to be written, the normaliser checks whether the raw attribute code `"p"` already exists in `params.attributes` from a previous step — perhaps a transformer attribute hint that extracted a raw price value. If it does, the raw code key is deleted before the composite key is written. This prevents the attribute from being filtered twice — once by the raw value and once by the clause expansion — which would create contradictory or over-constrained queries.

### Level 2 — Raw Attribute Code Fallback

If the clause does not match any named clause definition within the attribute's metadata, but the attribute metadata itself exists in the store context, the normaliser falls back to mapping the clause word directly to the attribute's `code`. It first passes the value through `canonicalizeValue()` to normalise it against the attribute's `predefined_values` list, then writes `{ [attrCode]: canonicalizedValue }`.

This path handles clauses that represent open-ended attribute values rather than named filter groups. A colour clause like `"blue"` mapping to the `color` attribute (`code: "m"`) produces `{ "m": "blue" }` — a direct value filter rather than a named group filter.

### Level 3 — Global Fallback

When no attribute metadata is found at all in the store context, the normaliser writes the clause directly using the raw attribute key defined on the clause entry itself: `{ [clause.attribute]: clause.label || clauseWord }`. For brand clauses specifically, the raw user word is preferred over the label, because brand names must match exactly as the user typed them (or as the entity extractor resolved them) rather than as a normalised label.

This level exists to ensure that clause mapping never silently fails. Even without full attribute metadata, the clause is written into the attributes object in a form that the search API can attempt to use.

---

## Facet Target Rebinding

A facet target entity (`type: "facet_target"`) is created by the entity extractor when the user explicitly names an attribute they want to filter on — for example, `"show me phones with 256gb storage"`. The word `"storage"` becomes `facet_target = "storage"`.

The facet target rebinds generic clauses to that specific attribute. Without this mechanism, a clause like `"high"` (which might nominally map to `price_tier`) would be incorrectly applied to the price attribute when the user's intent was to filter storage. With rebinding active, `"high"` gets rebound to the `storage` attribute because `target_facet = "storage"` overrides `clause.attribute`. The result is `{ "storage_code": "high" }` rather than `{ "p_code": "high" }`.

---

## Brand Folding

After clause mapping, the normaliser checks for a top-level `brand` parameter. This parameter is set by the entity extractor when it detects a vendor/brand entity, and it sits outside the `attributes` object at that point. The normaliser folds it in.

Before folding, it checks whether a more specific brand clause has already placed something into `attributes` for the brand code — for example, a brand clause definition that expanded `"apple"` into `{ "b:a": "apple,iphone,mac" }`. If a brand-specific entry already exists at the raw code or composite key level, folding is skipped entirely to avoid overwriting the more precise mapping. If not, `canonicalizeValue()` normalises the brand string against the attribute's `predefined_values` (so `"Apple Product"` becomes `"apple"`), and the result is written as `attributes[brandCode]`. The top-level `brand` key is then deleted to keep the parameters clean.

---

## Vendor Normalisation

The vendor parameter requires verification because the entity extractor may detect a vendor from loose text matching, and that detected value might not correspond to an actual store tenant. The normaliser performs a direct lookup against `storeContext.VENDORS`, matching by `business_name`, `tag`, or `id` (case-insensitive).

When a match is found, the normaliser decides what to do based on whether the intent actually uses a `vendor` parameter. A `vendor_search` intent or `vendor_facet` intent expects vendor at the root level — so it normalises the value to the official `tag` (the human-readable name the API expects, not the UUID). A `product_search` intent does not declare a `vendor` parameter in its schema — for that intent, the vendor is treated as a search attribute and is folded into `params.attributes.vendor`, with the root-level `vendor` key deleted.

When no match is found, the normaliser takes a different path. If the unrecognised vendor value is already covered by a brand entity in `params.attributes`, the vendor key is deleted to avoid duplication. If the value matches a brand clause entry in the clause registry, it is reclassified as a brand attribute. And if the intent does not expect vendor at all, the key is deleted unconditionally — an unverified, non-brand vendor string has no safe place to go and must not pollute the parameter set.

---

## `canonicalizeValue()` — Value Normalisation

This function is used wherever a string value needs to be validated against a set of known attribute values. It runs three checks in order:

**Direct match**: the value is lowercased and compared against every entry in the attribute's `predefined_values` array. An exact match returns the predefined form of the value (already lowercased and normalised), ensuring consistency regardless of how the user cased their input.

**Clause synonym match**: if the value does not directly appear in `predefined_values`, the function checks the clause's `matches` array — the list of synonyms or variant forms associated with that clause — against `predefined_values`. This handles cases where the user's word is a synonym of a supported value: if `"affordable"` is a match for the `budget_range` clause and `"budget"` is in `predefined_values`, the function returns `"budget"` rather than `"affordable"`.

**Substring/plural match**: for small attribute sets (fewer than 50 values), the function does a fuzzy check — whether the value contains a supported value, or a supported value contains the value. This catches plurals and partial matches: `"iphones"` would match against `"iphone"` in the predefined list.

If none of the three checks finds a match, the original value is returned unchanged. This ensures the function never silently drops information — worst case, the unconverted value goes to the backend and is handled there.

---

*Next: Chapter 18 — Tool Mapper*
