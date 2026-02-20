# Be3_AI Message Processing Pipeline — Complete Stage List

Every stage a user message passes through, from when it is sent until a response is returned.  
Steps that may not always run are still listed.

---

## I. Entry & Server

| # | Stage | What it does |
|---|-------|--------------|
| 1 | **POST /chat endpoint** | Receives the user message and `session_id` via HTTP |
| 2 | **Feature flag check** | `shouldUseToolSystem(session_id)` decides tool-system vs legacy flow |
| 3 | **Debug logging (REQUEST_RECEIVED)** | Logs incoming request metadata |
| 4 | **State retrieval** | `stateManager.getState(session_id)` loads or creates user state (Redis or memory) |
| 5 | **Special command handling** | `.clearcache` triggers full state clear and returns early |
| 6 | **Add user message** | `stateManager.addMessage(session_id, 'user', message)` appends to conversation history |

---

## II. Intent Resolution (resolveDeterministic)

| # | Stage | What it does |
|---|-------|--------------|
| 7 | **Deterministic resolve entry** | `resolveDeterministic(message, state)` calls `resolveAndMap` with `aiQueryFn = null` |

---

## III. Intent Resolver Pipeline (resolveAndMap)

### Stage 0: Microstate Gate

| # | Stage | What it does |
|---|-------|--------------|
| 8 | **Get active microstate** | `stateManager.getMicrostate(userId)` |
| 9 | **Microstate termination keyword check** | `isTerminationKeyword()` — if match, clear microstate, possibly escalate |
| 10 | **Microstate response analysis** | `analyzeResponse()` for yes/no, ordinal, selection, multi-selection |
| 11 | **Microstate soft sandbox breakthrough** | `checkBreakthrough()` for unrelated intents; if breakthrough, clear microstate and exit |
| 12 | **Microstate entity extraction** | `extractEntities()` on the message (same as main pipeline) |
| 13 | **Microstate param merge** | Merge extracted entities into microstate params |
| 14 | **Microstate fulfillment check** | `checkFulfillment()` against contract; if fulfilled, map to tools and return |
| 15 | **Microstate advance** | If not fulfilled but progressed, `stateManager.advanceMicrostate()` and return |

### Stage 1: Fuzzy Matching

| # | Stage | What it does |
|---|-------|--------------|
| 16 | **Fuzzy text correction** | `fuzzyMatcher.correctText()` with Levenshtein, entity guard, and common-word guard |

### Stage 2: Context Resolution

| # | Stage | What it does |
|---|-------|--------------|
| 17 | **Reference resolution** | `contextResolver.resolveReferences()` replaces pronouns/ordinals (e.g. "it", "first") with product names from `reference_map` and `ordinal_list` |

### Stage 3: Preprocessing

| # | Stage | What it does |
|---|-------|--------------|
| 18 | **Preprocessing** | `preprocessor.preprocess()` normalizes, detects negation, splits on conjunctions |
| 19 | **Negation detection** | `detectNegation()` marks negated statements |
| 20 | **Statement splitting** | `splitStatements()` splits on conjunctions (and, also, then) with guards |

### Stage 3b: Intra-Query Coreference

| # | Stage | What it does |
|---|-------|--------------|
| 21 | **Intra-query coreference** | For multi-statement queries (i > 0), replaces pronouns with entities from the previous statement |

### Stage 3c: NLP Cleaning

| # | Stage | What it does |
|---|-------|--------------|
| 22 | **cleanText** | `nlpCleaner.cleanText()` removes adverbs and punctuation (compromise.js) |

### Stage 4a: Entity Extraction

| # | Stage | What it does |
|---|-------|--------------|
| 23 | **Entity extraction** | `extractEntities(text, storeContext, idfMap)` for vendor, category, brand, action, order_id, quantity, price, clause |
| 24 | **IDF weighting** | Action verbs scored using `intentRegistry.buildIdfMap()` |
| 25 | **Residual word collection** | Leftover words kept as potential product names |

### Stage 4b: Schema Resolution (Intent Scoring)

| # | Stage | What it does |
|---|-------|--------------|
| 26 | **Phase 1: Entity-to-param map** | Maps extracted entities to intent parameter slots |
| 27 | **Phase 2: Action intent set** | Maps action categories (purchase, cart_add, discovery, etc.) to intents |
| 28 | **Phase 3a: Schema fit** | Scores required/optional param fulfillment |
| 29 | **Phase 3b: Schema score** | +2.0 per required filled, +0.5 per optional filled |
| 30 | **Phase 3c: Action verb boost** | IDF-weighted boost when action verbs suggest the intent |
| 31 | **Phase 3d: IDF keyword match** | Intent keywords matched against text with IDF weights |
| 32 | **Phase 3e: Multi-word synonym match** | Phrase-level synonym bonus |
| 33 | **Phase 3f: Intent-specific rules** | Search–discovery, vendor, hierarchy, orphan noun, discovery vs identity |
| 34 | **Phase 3g: Unfilled-required penalty** | Penalty when required params are unfilled |
| 35 | **Phase 3h: Zero-param baseline penalty** | Penalty for zero-param intents without action match |
| 36 | **Phase 3i: Discovery vs identity bias** | Boosts discovery when brand/category present |
| 37 | **Phase 3j: Hierarchy boost** | Root category alone boosts discovery_sentinel |
| 38 | **Phase 4: Sort and select winner** | Sort by score, keep positive-scoring candidates |
| 39 | **Phase 5: Semantic fallback** | If no positive score, `semanticScorer.discoverCandidates()` as last resort |
| 40 | **Phase 6: Residual product fallback** | Ensures product_search is candidate when residual words exist |

### Stage 5: Parameter Extraction

| # | Stage | What it does |
|---|-------|--------------|
| 41 | **Entity-to-param mapping** | Map entity types to intent params |
| 42 | **Structural alignment (Stage 5a)** | `StructuralMatcher` uses `compiled_index.json` positional templates |
| 43 | **Deterministic extraction** | Regex extraction for quantity, order_id, price, comparison products, search params |
| 44 | **Clause stripping** | `performClauseStripping()` separates clause words from product names |
| 45 | **AI parameter extraction** | Optional `aiQueryFn` for remaining params (disabled when null) |
| 46 | **Param merge** | Merge schema-matched params with extracted params |

### Negation Handling

| # | Stage | What it does |
|---|-------|--------------|
| 47 | **Intent inversion** | If statement negated and intent has `invertTo`, switch intent |

### Stage 4c: Context Reconciliation

| # | Stage | What it does |
|---|-------|--------------|
| 48 | **Context reconciliation** | `contextReconciler.reconcile()` maps category to products from `state.product_context.last_search` for transactional intents |

### Rule 8: Clarification Fallback

| # | Stage | What it does |
|---|-------|--------------|
| 49 | **Fallback on no intents** | If no intents resolved, return `fallback_unknown` and `conversation.clarify` |

### Stage 7.5: Intent Porting

| # | Stage | What it does |
|---|-------|--------------|
| 50 | **Intent porting** | `intentPorter.portIntents()` pivots product_search → add_to_cart when product is in reference_map and purchase verbs present |

### Stage 6: Parameter Bleeding

| # | Stage | What it does |
|---|-------|--------------|
| 51 | **Parameter bleeding** | `parameterBleeder.bleedParameters()` passes missing required params from earlier statements in multi-intent queries |

### Stage 6.5: Parameter Normalization

| # | Stage | What it does |
|---|-------|--------------|
| 52 | **Parameter normalization** | `parameterNormalizer.normalizeParameters()` maps clause_words → attributes, normalizes vendors and categories |

### Stage 7: Inventory Check & Parental Pivot

| # | Stage | What it does |
|---|-------|--------------|
| 53 | **Inventory check** | For empty categories, sets `_empty_category`, `_empty_category_label` |
| 54 | **Sibling suggestions** | `getSiblings()` for alternative categories |
| 55 | **Parental pivot** | If parent has products, broaden search to parent via `getParent()` |

### Stage 8a: Search Context (Write & Read)

| # | Stage | What it does |
|---|-------|--------------|
| 56 | **Search context TTL decrement** | `stateManager.decrementSearchContextTTL(userId)` on each message |
| 57 | **Search context write** | For product_search/discovery_sentinel, `stateManager.setSearchContext()` stores category, vendor, clauses, attributes, query |
| 58 | **Search context read** | For add_to_cart, product_compare, check_availability, loads `getSearchContext()` |
| 59 | **Clause match detection** | Matches user clauses to context clauses |
| 60 | **Attribute filtering (clause match)** | Filters products by `params.attributes` using `product_attributes_map` (attrKey + code fallback) |
| 61 | **Attribute filtering (attribute match)** | When no clause match but params.attributes exist |
| 62 | **Pronoun fallback with attribute filtering** | Explicit pronouns ("ones", "it") trigger context product injection with attribute filter |
| 63 | **Product injection** | Injects `_context_product_ids` and `params.products` when clause/category/attribute matches |
| 64 | **Pronoun cleanup** | Filters pronouns out of params and clears `product_name` when it is a pronoun |

### Stage 8b: Tool Mapping

| # | Stage | What it does |
|---|-------|--------------|
| 65 | **Tool mapping** | `toolMapper.mapToTools()` maps intents to tool calls via `paramMap` |
| 66 | **Parameter expansion** | Product arrays expanded into one tool call per product |
| 67 | **Internal param pass-through** | Params prefixed with `_` passed through to tools |
| 68 | **Default param application** | Applies intent defaults for missing mapped params |

### Stage 10: Microstate Triggers

| # | Stage | What it does |
|---|-------|--------------|
| 69 | **Microstate trigger check** | `microstateRegistry.checkTriggers(intentName, params, entities)` after pipeline completes |
| 70 | **Microstate open** | If triggered, `stateManager.setMicrostate()` and return prompt tool instead of mapped tools |

---

## IV. State Management

| # | Stage | What it does |
|---|-------|--------------|
| 71 | **Prune state** | `stateManager.pruneState(session_id, intent)` on new search or category shift |
| 72 | **Set current intent** | `stateManager.setCurrentIntent(session_id, intent)` |

---

## V. Tool Execution (Orchestrator)

| # | Stage | What it does |
|---|-------|--------------|
| 73 | **Orchestrator start** | `executeTools(toolsSelected, session_id)` |
| 74 | **Tool lookup** | Lookup in `TOOL_REGISTRY` by tool name |
| 75 | **Context passing** | Passes `CATEGORIES`, `VENDORS`, `ATTRIBUTES`, `COLLECTIONS`, `getContextSummary()`, `sessionId` |
| 76 | **Tool handler invocation** | `toolDef.handler(params, context, results)` per tool |
| 77 | **Result aggregation** | Results accumulated in order |
| 78 | **Circuit breaker** | Stops on error for cart/order tools |
| 79 | **Reference map update** | product.search, discovery call `stateManager.updateReferenceMap()` |
| 80 | **Search context update** | Tools call `stateManager.setSearchContext()` with product_ids and product_attributes_map |

---

## VI. Within Tools (Internal Stages)

| # | Stage | What it does |
|---|-------|--------------|
| 81 | **Product resolution (resolveProduct)** | UUID check → state resolveReference → search fallback |
| 82 | **Category auto-discovery** (product.search) | Infers category from query when not provided |
| 83 | **Semantic search** (product.search) | `performSemanticSearch()` within category |
| 84 | **Reference map expansion** (product.search) | Builds reference_map from product names/handles/vendor |
| 85 | **Product attributes map build** | Extracted from raw products before stripping (product tool, discovery) |
| 86 | **Sentinel verification** (discovery.sentinel) | String-matching relevance check |
| 87 | **Recovery fallback** (discovery.sentinel) | Category browse when results empty or irrelevant |

---

## VII. Post-Tool Processing

| # | Stage | What it does |
|---|-------|--------------|
| 88 | **Image injection** | `injectImages(toolResults, stateManager)` re-injects cached product images |
| 89 | **Direct response check** | Detects `directResponse === true` to bypass personality layer |

---

## VIII. Response Generation

| # | Stage | What it does |
|---|-------|--------------|
| 90 | **Direct response path** | Microstate tools with `directResponse` use `result.message` as reply |
| 91 | **AI personality path** | `generateResponseFromTools()` calls Groq (Llama 3.3 70B) |
| 92 | **Tool result optimization** | Trims product fields for prompt size |
| 93 | **Response sanitization** | Removes internal ID patterns and markdown; skipped for direct responses |
| 94 | **Display image extraction** | `extractImages(toolResults)` collects product image URLs |

---

## IX. Final State & Response

| # | Stage | What it does |
|---|-------|--------------|
| 95 | **Add AI message** | `stateManager.addMessage(session_id, 'ai', sanitizedResponse)` |
| 96 | **Extend TTL** | `stateManager.extendTTL(session_id)` |
| 97 | **Conversation summarization** | Background `summarizeConversation()` when toolCount % 10 === 0; uses queryAI |
| 98 | **WhatsApp button extraction** | Extracts `whatsapp_buttons` from tool results |
| 99 | **Final JSON response** | Returns `{ success, reply, intent, display_images, tools_used, results, whatsapp_buttons }` |

---

## X. Legacy Flow (when shouldUseToolSystem is false)

| # | Stage | What it does |
|---|-------|--------------|
| 100 | **Legacy intent classification** | `classifyIntent()` via queryAI with `getIntentClassificationPrompt` |
| 101 | **Legacy handler execution** | `executeIntent(intent, params, session_id, state)` |
| 102 | **Legacy response generation** | `generateResponse()` based on handler result and context |

---

## XI. Referenced but Not in Main Path

| # | Stage | What it does |
|---|-------|--------------|
| 103 | **stripSocialNoise** | Exported by nlpCleaner; removes greetings; not used in main pipeline |
| 104 | **cleanQuery** | Aggressive cleaning for parameter extraction; used in specific extractor paths |
| 105 | **Knowledge injection** | Referenced in categoryHelpers and tests; no explicit KI step in main pipeline |
| 106 | **SemanticMatcher / joint_bench** | Used by semanticScorer for fallback discovery |

---

## Summary

- **Main path (tool system):** stages 1–99
- **Legacy path:** stages 100–102
- **Optional / referenced:** stages 103–106
