# Chapter 22 — Product Sentinel: Relevance Gate

## The Problem With Keyword Search Results

Keyword search is deterministic and fast, but it can produce results that are technically a token-overlap match while being semantically wrong. A user asking for `"gaming phones"` might get gaming chairs if the backend's search engine categorises or indexes imprecisely. A user asking for `"wireless earbuds"` might get over-ear headphones that have `"wireless"` in their description but are a completely different product class.

The pipeline's entity extractor and parameter normaliser work hard to send the right category, brand, and attribute filters to the search API. But the search API is a separate service with its own indexing logic. The pipeline cannot control how it interprets a query, and the results it returns may or may not match what the user actually wants.

The Product Sentinel is the quality gate that sits between the search tool's response and the personality layer's output. It evaluates whether the returned products genuinely address the user's intent. If they do not, it generates a smarter, semantically-rephrased search query — a `vector_query` — that triggers a re-search using meaning rather than keywords.

---

## Architecture: A Cheap, Focused LLM Call

The sentinel is not a general-purpose AI call. It is a purpose-built, token-constrained evaluator using `llama-3.1-8b-instant` via Groq — a small, fast model that can answer a binary question reliably:

```js
const response = await queryGroqAI(
    messages,
    60,         // max tokens — forces a short, structured output
    0.1,        // near-zero temperature — deterministic judgement
    1,          // single retry
    { response_format: { type: 'json_object' } },
    SENTINEL_MODEL_ID
);
```

The 60-token ceiling is deliberately tight. The model is not being asked to explain, summarise, or generate prose — it must output one of exactly two JSON shapes:

```json
{ "relevant": true }

{ "relevant": false, "vector_query": "a smarter search phrase" }
```

This constraint keeps the call fast and economical. The JSON mode enforces structure. The low temperature minimises hallucination. The sentinel is the minimum viable LLM intervention that can catch the worst category of search mismatches.

---

## What Gets Sent to the Sentinel

The sentinel is passed the user's original message and a lean summary of the first 8 products returned by the search:

```js
const productSummary = products.slice(0, 8).map(p => ({
    name: p?.name || p?.title || 'unknown',
    description: typeof p?.description === 'string'
        ? p.description.substring(0, 80)   // Truncated — just enough for context
        : null
}));
```

Only names and truncated descriptions go in. Price, vendor, attributes, IDs — all stripped. The sentinel doesn't need them to judge category-level relevance, and keeping the payload lean reduces token costs and response latency.

If a conversation summary is available (the session has prior context), it is prepended to the user message so the sentinel can judge relevance against the full conversational intent, not just the raw last message:

```js
const userContext = conversationSummary
    ? `Conversation Summary: "${conversationSummary}"\n\nCurrent User message: "${userMessage}"`
    : `User message: "${userMessage}"`;
```

---

## The Relevance Prompt: Carefully Scoped Rules

The system prompt given to the sentinel defines precise relevance and irrelevance rules. These rules matter more than the model's general language understanding — the model is being anchored to a specific evaluation framework rather than left to judge freely.

**What counts as relevant** (`{ "relevant": true }`):

- **Broad match**: The user asked for a category (e.g., `"phone"`) and the results contain products of that category — even if not the exact model.
- **Model variations**: Minor spec variations (`"iPhone 16"` vs `"iPhone 16 Pro Max"`) are relevant if the product type is right.
- **Subsidiaries**: If the user asked for a brand (`"Samsung"`), any Samsung product is relevant.
- **Partial entity**: If at least one or two items in the result set correctly match the requested type, the whole set is marked relevant.

**What counts as irrelevant** (`{ "relevant": false, ... }`):

- **Category mismatch**: User wants `"gaming phones"` but results are *only* `"gaming chairs"`.
- **Zero match**: No words or meaning in the product names relate to the query at all.
- **Noise**: Generic placeholder data or entirely different product types.

**The absolute vetting rule** — this overrides everything else:

> If the returned products already contain the exact brand and model the user mentioned, you MUST mark `{"relevant": true}`.

This prevents the sentinel from second-guessing precise, resolved searches. If the user asked for `"iPhone 16 Pro Max"` and the results contain `"Apple iPhone 16 Pro Max"`, the sentinel must pass them regardless of anything else.

**The anti-loop rule**: The sentinel is explicitly told not to suggest the same query as the `vector_query`. If it cannot think of a genuinely different or better search phrase, it must return `relevant: true`. This prevents a re-search loop where the same bad query keeps triggering sentinel rejection in a cycle.

---

## What `vector_query` Means and How Re-Search Works

When the sentinel returns `{ "relevant": false, "vector_query": "high performance smartphone for gaming" }`, this phrase is handed to the personality layer alongside the original (irrelevant) results. The `vector_query` is used to trigger a semantic re-search — typically passed to a vector similarity endpoint that retrieves products based on meaning rather than keyword overlap.

The `vector_query` is typically a reformulation of the user's intent: broader, semantically richer, and phrased in a way that a vector embedding model will match well against product descriptions. Where the original query might have been the literal phrase `"gaming phone"` filtered through a category that the backend misinterpreted, the vector query might be `"high performance Android smartphone suitable for gaming"` — a description rather than a label.

---

## Fail-Open Design

If the sentinel's LLM call fails for any reason — network timeout, parse error, malformed JSON from the model — the function returns `{ relevant: true }` and logs the error:

```js
} catch (err) {
    logDebug('SENTINEL:EVALUATION_ERROR', {
        _desc: 'Sentinel evaluation failed — defaulting to relevant (safe fallback)',
        error: err.message
    });
    return { relevant: true };  // Never block the pipeline on a sentinel failure
}
```

This is a deliberately fail-open design. The sentinel is a quality improvement layer, not a hard requirement. A sentinel failure degrades the experience — the user might see slightly irrelevant results — but it never blocks the response entirely. The alternative (fail-closed, returning `relevant: false` on error) would mean a network hiccup causes the entire search to produce no response, which is a much worse user experience.

---

## Early-Exit Conditions

The sentinel short-circuits before making any LLM call in two cases:

```js
if (!ENABLE_SENTINEL) return { relevant: true };
if (!Array.isArray(products) || products.length === 0) return { relevant: true };
```

An empty result set is not judged for relevance. If nothing was returned, the personality layer handles the empty state — it might ask a clarifying question, suggest categories, or offer a different framing. There is no need to spend an LLM call judging an empty list as relevant or irrelevant.

---

## The `ENABLE_SENTINEL` Flag and Future Activation

Currently the sentinel is hardcoded active (`ENABLE_SENTINEL = true`). The architecture comment documents the intended evolution: activation will eventually be driven by the pipeline confidence scoring system from `pipelineConfidence.js`. The idea is to make the sentinel cost-proportional:

- Queries that are confidently resolved (high entity detection confidence, low fallback count, strong semantic score) skip the sentinel — they are unlikely to have produced irrelevant results.
- Queries that were uncertain (high fallback rate, low semantic match, no clear entity detection) pay the additional 60-token LLM cost for the safety check.

This would make the sentinel fire most when it is most needed, rather than running unconditionally on every search.

---

*Next: Chapter 23 — Personality Layer*
