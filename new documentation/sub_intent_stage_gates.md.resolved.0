# Sub-Intent Stage Gate Reference

> **Prepass note (pronoun/ordinal resolution):** `contextResolver` pronoun/ordinal logic runs at **prepass** for every message regardless of these gates. What these gates control is whether the *full* contextResolution stage (cross-turn reference enrichment into params) runs after classification.

---

## Gate Legend

| Value | Meaning |
|---|---|
| `true` | Always runs |
| `false` | Never runs — stage is skipped |
| `'fallback'` | Runs only if contextResolution found nothing |
| `'vendor_only'` | entityExtraction runs but limited to vendor detection only |
| `'write'` | searchContext stage writes results to state |
| `'read'` | searchContext stage reads prior results into params |

---

## Full Table: All 31 Sub-Intents

| L3 Sub-Intent | L2 Group | contextResolution | entityExtraction | PIE | categoryDetection | searchContext |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **product_search** | Product_Research | ❌ false | ✅ true | ✅ true | ✅ true | write |
| **browse_categories** | Product_Research | ❌ false | ✅ true | ✅ true | ✅ true | write |
| **browse_collection** | Product_Research | ❌ false | ✅ true | ✅ true | ✅ true | write |
| **get_advice** | Product_Research | ❌ false | ✅ true | ✅ true | ✅ true | write |
| **facet_list** | Product_Research | ❌ false | ✅ true | ✅ true | ✅ true | write |
| **discovery_sentinel** | Product_Research* | ❌ false | ✅ true | ✅ true | ✅ true | write |
| **product_compare** | Product_Analysis | ✅ true | ❌ false | ❌ false | ❌ false | — |
| **product_similar** | Product_Analysis | ✅ true | ❌ false | ❌ false | ❌ false | — |
| **get_product_details** | Product_Analysis | ✅ true | ❌ false | ❌ false | ❌ false | — |
| **add_to_cart** | Cart_Management | ✅ true | ❌ false | fallback | ❌ false | read |
| **remove_from_cart** | Cart_Management | ✅ true | ❌ false | fallback | ❌ false | read |
| **view_cart** | Cart_Management | ✅ true | ❌ false | fallback | ❌ false | read |
| **update_cart_quantity** | Cart_Management | ✅ true | ❌ false | fallback | ❌ false | read |
| **start_checkout** | Checkout_Flow | ❌ false | ❌ false | ❌ false | ❌ false | — |
| **set_delivery** | Checkout_Flow | ❌ false | ❌ false | ❌ false | ❌ false | — |
| **confirm_order** | Checkout_Flow | ❌ false | ❌ false | ❌ false | ❌ false | — |
| **check_availability** | Checkout_Flow | ❌ false | ❌ false | ❌ false | ❌ false | — |
| **order_status** | Post_Purchase | ❌ false | ❌ false | ❌ false | ❌ false | — |
| **list_orders** | Post_Purchase | ❌ false | ❌ false | ❌ false | ❌ false | — |
| **cancel_order** | Post_Purchase | ❌ false | ❌ false | ❌ false | ❌ false | — |
| **vendor_info** | Vendor_Lookup | ❌ false | vendor_only | ❌ false | ❌ false | — |
| **vendor_identity** | Vendor_Lookup | ❌ false | vendor_only | ❌ false | ❌ false | — |
| **list_vendors** | Vendor_Lookup | ❌ false | vendor_only | ❌ false | ❌ false | — |
| **vendor_products** | Vendor_Catalog_Exploration | ❌ false | ✅ true | ❌ false | ✅ true | — |
| **vendor_facet** | Vendor_Catalog_Exploration | ❌ false | ✅ true | ❌ false | ✅ true | — |
| **vendor_contact** | Vendor_Direct_Contact | ❌ false | vendor_only | ❌ false | ❌ false | — |
| **get_help** | Assistance_Request | ❌ false | ❌ false | ❌ false | ❌ false | — |
| **give_feedback** | Platform_Feedback | ❌ false | ❌ false | ❌ false | ❌ false | — |
| **conversation** | *(no L2)* | ❌ false | ❌ false | ❌ false | ❌ false | — |
| **end_conversation** | *(no L2)* | ❌ false | ❌ false | ❌ false | ❌ false | — |
| **test_microstate** | *(no L2 — dev only)* | ❌ false | ❌ false | ❌ false | ❌ false | — |

*`discovery_sentinel` has no `intent:` field but routes through the same Product_Research gate path as `product_search`.

---

## Summary: Which Intents Run What

### ✅ Run contextResolution (full cross-turn reference enrichment)
These need to resolve references like "it", "the first one", "that product" into concrete params:

| Sub-Intent | Why |
|---|---|
| product_compare | User says "compare these two" — needs to resolve "these two" from search context |
| product_similar | "Show me similar" — needs to resolve what product they mean |
| get_product_details | "Tell me more about it" — resolves "it" |
| add_to_cart | "Add the red one" — resolves ordinal/pronoun to a product ID |
| remove_from_cart | "Remove the second one" — resolves from cart or search context |
| view_cart | Reads cart state; resolution populates context params |
| update_cart_quantity | "Change it to 3" — needs to resolve which cart item |

### ✅ Run entityExtraction (full NLP entity detection)
These extract new entities from the message text itself:

| Sub-Intent | entityExtraction value | What it extracts |
|---|---|---|
| product_search | true | product names, categories, price ranges, attributes, clauses |
| browse_categories | true | category names, filters |
| browse_collection | true | collection names |
| get_advice | true | product types, use-case context |
| facet_list | true | attribute codes, filter targets |
| discovery_sentinel | true | broad discovery terms |
| vendor_products | true | vendor name + category/product filter |
| vendor_facet | true | vendor name + attribute |
| vendor_info | vendor_only | vendor name only |
| vendor_identity | vendor_only | vendor name only |
| list_vendors | vendor_only | vendor name only |
| vendor_contact | vendor_only | vendor name only |

### ❌ Run neither — straight to params
These intents have unambiguous, self-contained actions. No NLP enrichment needed:

`start_checkout`, `set_delivery`, `confirm_order`, `check_availability`, `order_status`, `list_orders`, `cancel_order`, `get_help`, `give_feedback`, `conversation`, `end_conversation`

---

## The Key Pattern

```
Resolution (contextResolution=true)  →  Intents that REFERENCE things from prior context
Entity Extraction (entityExtraction=true)  →  Intents that DISCOVER things from the current message
```

They are mutually exclusive in your config — no L2 group has both set to `true`. This is intentional:
- If you're **searching/discovering**, there's no prior context to resolve against — you're building fresh state
- If you're **acting on something**, the entity is already known — you resolve it from state, not extract it from text

The only exception is `Cart_Management`, where PIE runs as a **fallback** — if resolution finds nothing (no ordinal, no pronoun match), PIE kicks in to try to extract a product from the raw text.
