# Microstate Capabilities Audit

Based on a codebase scan, microstates use three primary payload tools: `microstate.collect` (text input), `microstate.disambiguate` (buttons/options), and `microstate.confirm` (yes/no).

The following table documents all production microstates and the advanced UX features they leverage.

| Intent | Microstate Trigger | Form Tool | UX Features & Pipeline Mechanics |
| :--- | :--- | :--- | :--- |
| `add_to_cart` | `missing_product` | `collect` | **Hints**: Provides example products. |
| `add_to_cart` | `confirm_add_ported` | [confirm](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/config/intents/add_to_cart.js#72-73) | **Hard Sandbox**: Locks interpretation to Yes/No responses only. |
| `add_to_cart` | `product_is_category` | `disambiguate` | **Escalation**: Seamlessly pivots to `product_search` if the user repeats the generic category. |
| `product_search` | `missing_query` | `collect` | **Hints**: Suggests generic searches. |
| `product_compare` | `missing_products` | `disambiguate` | **Algorithmic UI Controls**: Includes robust `controls` (`{ more: true, cancel: true, recommendedIndex: 0 }`). Integrates with the backend vector catalog to dynamically page through recommended sibling/category products as clickable buttons. |
| `vendor_products` | `collect_vendor_for_products` | `collect` | **Hints**, **Validators** (string length gating), **Normalizers** (whitespace stripping), **Breakthrough** (custom `minScore` threshold for pivoting intents). |
| `set_delivery` | `collect_delivery_details` | `collect` | **Multi-field Collection**: Defines an ordered `fields` array ([address](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intentResolver/config/intents/set_delivery.js#71-75) required, `delivery_type` optional) to seamlessly walk users through multi-step form filling. Includes robust text **validators**. |
| `update_cart_quantity` | `collect_quantity` | `collect` | **Hints**, **Numeric Validators** (enforces `1-100` bounds), **Numeric Normalizers** (cleans text to integers). |
| `order_status` | `collect_order_id` | `collect` | **Hints**, **Regex Validators** (forces `\d{3,}`), **Regex Normalizers** (strips leading `#`). |
| `confirm_order` | `collect_confirm_order_id` | `collect` | **Hints**, **Regex Validators**, **Regex Normalizers**. |
| `cancel_order` | `collect_cancel_order_id` | `collect` | **Hints**, **Regex Validators**, **Regex Normalizers**. |
| `[Multiple]` | `ordinal_choice` | `disambiguate` | **Virtual Microstate**: Triggered directly in [index.js](file:///C:/Users/chatz/Downloads/eCommerce/be3-ai-transformer/src/index.js) Stage 8a when users say "one" or "the first one" but multiple results exist in the current reference map. |
| `product_compare` | `engineered_compare` | `collect` | **Virtual Microstate**: Triggered by `__product:compare:<id>__` engineered tokens (from product detail cards) to collect the second product for comparison. |

## Takeaways for Improvement
1. **IntelliSense Integration (Pending)**: While microstates perfectly define boundaries for their parameters using local regex/validators, sending the raw inputs through the [intelliSense.js](file:///c:/Users/chatz/Downloads/eCommerce/be3_ai/src/services/intelliSense.js) transformer would allow for semantic matching rather than rigid bounds.
2. **Missing Hints**: A few `disambiguate` prompts natively lack descriptive text hints that exist uniformly on `collect` states.
3. **Escalation Underutilization**: Most microstates have `escalation: null`. When users tap out or expire, they simply drop out of the pipeline without guidance. Defining deliberate catch-nets (like how `add_to_cart` pivots to `product_search`) would improve edge-case retention.
