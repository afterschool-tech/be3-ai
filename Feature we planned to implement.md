Feature we planned to implement (high level)
Upgrade your PREPASS + pipeline so that transformer-detected attribute values (not just clauses/brands) can be used as first-class filtering signals when appropriate, instead of being left inside product_name as “residual”.

Concretely:

Before: PREPASS mainly detects clauses + brands, and anything else often ends up as part of the product query string.
After: if the transformer returns something like attribute.storage = 256gb, we should:
emit it into params.attributes (in backend-accepted key format), and
remove that token from product_name/products so the query is “clean” and filtering happens via attributes.
Core constraints / rules we were working under
Clauses/brands remain first-class: if a clause already resolves a facet, don’t double-apply the transformer attribute for that same facet (the “don’t duplicate clause meaning” rule).
Attribute values should become structural signals: those tokens should get recognized as [attribute]-like signals (i.e., not leak back into product query text).
Backend contract: backend does not accept attributes: { storage: "256gb" }; it expects attribute code keys, e.g. storage → j, price_tier → p, brand → b, etc.
Problem #1 we diagnosed (why transformer attribute wasn’t showing in params originally)
In your original example log, transformer detected storage: ["256gb"], but you saw no attribute in final params.

Root cause:

IntelliSense/context emitted a resolved_product like "256gb smartphone".
That marks word indices as “consumed”.
Your transformer attribute injector was originally written to only inject if !consumed.has(wordIdx).
Since 256gb was inside the consumed resolved_product, injection never happened, so nothing reached params.attributes.
Planned fix:

Allow transformer attribute injection even if the word is consumed, but only when that consumed word index belongs to an existing resolved_product.
This is the “snatch attribute from resolved product” rule.
Problem #2 we diagnosed (why attributes were in the wrong format for backend)
Once transformer attributes started flowing, they arrived as:

attributes: { "storage": "256gb" }
But your backend expects:

attributes: { "j": "256gb" } (because storeContext.ATTRIBUTES.storage.code === "j")
Planned fix:

Add a canonicalization step that maps “human keys” → backend code keys using storeContext.ATTRIBUTES:
storage → j
price_tier → p
brand → b
etc.
Preserve composite keys already in backend clause form (like p:p) without remapping.
Problem #3 we diagnosed (why attribute values stayed inside product_name/products)
After we successfully extracted 256gb into attributes, you asked:

“if we already got 256gb out, why is it still inside the product name?”

Root cause:

product_name/products were being set from earlier entities (especially resolved_product from IntelliSense/context).
Even after we added attributes, nothing automatically removed the token from the product string.
Planned fix:

After attribute extraction is reflected in combinedBase.attributes, strip attribute value tokens from:
product_name
every entry in products[]
Only do safe stripping for simple tokens (single token values like 256gb, not CSVs like budget,midrange).
The “PIE bare category” issue we investigated (the subtle pipeline bug)
You also asked why PIE wasn’t dropping “smartphone” even when it’s clearly a category.

We found two distinct scenarios:

A) “do you have smartphone”
PIE correctly flags it as bare category and sets _blocked_bare_category.
That path was handled.
B) “do you have 256gb smartphone”
This was the tricky one.

What happened:

PIE initially sees "256gb smartphone" as not-bare-category, so it does not trigger “bare category drop”.
Later in the pipeline, we strip 256gb (because it became an attribute), leaving "smartphone" as the product_name.
Now it’s bare category but it’s too late: PIE’s bare-category logic already ran earlier.
Why it matters:

You end up with:
attributes: { j: "256gb" } (good)
product_name: "smartphone" (bad—this is a category token resurrected as a product query)
Planned fix:

Add a second bare-category guard after stripping:
If product_name (or any entry in products[]) becomes exactly the category label/slug (with basic plural tolerance), then clear:
product_name = null
products = []
_resolved_product_id = null
Keep category + attributes intact so the system browses/filter by category+attributes rather than keyword-searching “smartphone”.
The full implementation plan we followed (step-by-step)
Read diffs + logs to locate where transformer attributes exist and where they disappear.
Inject transformer attribute entities in entityExtractor with rule:
allow “snatching” when token is consumed by resolved_product.
Map entity → params in parameterExtractor (already existed for other entity types) and ensure transformer attributes are included.
Canonicalize attributes keys to backend attribute code keys (e.g. storage → j).
Strip attribute tokens from product_name/products after attributes exist.
Fix the “late bare-category” edge case:
re-run a bare-category drop check after stripping.
The problem we were facing at the end (current edge case)
The remaining edge case was:

For queries like 256gb smartphone:
The pipeline correctly extracts 256gb as attribute.
Stripping leaves product_name = "smartphone".
But because PIE’s bare-category drop happened earlier, "smartphone" could survive unless we add the second post-strip guard.
That’s the “timing problem”: attribute extraction and stripping happen later than PIE’s drop decision, so you need a post-strip bare-category cleanup.

What you should expect the pipeline to do after all this
For: “do you have 256gb smartphone”

category: smartphones (set)
attributes: { j: "256gb" } (backend format)
product_name/products: should be null/empty (because after stripping the remaining token is just the category)
So the tool call becomes “browse smartphones with storage=256gb” instead of “search keyword ‘smartphone’ with storage=256gb”.

If you want, I can also write a short “developer note” spec of the rules (when transformer attrs are allowed vs suppressed by clause coverage), but the above is the full documented plan + the exact failure mode we hit.