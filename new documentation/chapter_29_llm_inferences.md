# Chapter 29 — Every LLM Inference in the Pipeline

## Two AI Service Providers

The system uses two separate AI service modules that expose the same `queryAI()` interface:

**`aiService.js`** — The HuggingFace Inference API. Used for legacy classification calls and utility inferences. Model is `llama-3.1-70b-versatile` or equivalent through HuggingFace's endpoint.

**`hfAiService.js`** — The Groq API via the OpenAI-compatible SDK. This is the primary inference provider for all production calls. Default model is `llama-3.3-70b-versatile`, configurable via `TEST_MODEL` env var. Falls back to `llama-3.1-70b-versatile` on 400/404 model errors.

```js
// hfAiService.js — Groq via OpenAI SDK
const client = new OpenAI({
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: GROQ_API_KEY,
});
const MODEL_ID = process.env.TEST_MODEL || "llama-3.3-70b-versatile";
const FALLBACK_MODEL_ID = "llama-3.1-70b-versatile";
```

The `queryAI()` function in both modules shares the same signature:
```js
queryAI(messages, maxTokens, temperature, retries, extraParams, modelOverride)
```

**Self-healing fallback**: If the primary model returns a 400 or 404 error, the call transparently switches to `FALLBACK_MODEL_ID` and retries — the attempt counter is reset to give the fallback a clean slate. Rate limit (429), timeout, and socket errors trigger exponential back-off: 1s, 2s, 4s between retries.

---

## The Complete LLM Inference Map

| # | Location | Model | Max Tokens | Temperature | Retries | When It Fires |
|---|---|---|---|---|---|---|
| 1 | `intentResolver` / IntelliSense | Groq 70B | 256 | 0.1 | 2 | Every message via Stage 0b (gated) |
| 2 | `server.js` / Legacy classifier | HF 70B | 256 | 0.7 | 2 | Legacy flow only |
| 3 | `server.js` / Conversation summary | HF 70B | 150 | 0.3 | 2 | Background: after every N turns |
| 4 | `conversationalDetector.js` | HF 70B | 64 | 1.0 | 1 | When message pattern is ambiguous |
| 5 | `suggestionHelper.js` | HF 70B | 64 | 1.0 | 1 | When prior suggestion was made |
| 6 | `productSentinel.js` | Groq 8B (instant) | 60 | 0.1 | 1 | After product.search (non-visual) |
| 7 | `personalityLayer.js` | Groq 70B | 512–1500 | 0.4 | 1 | Every response generation |
| 8 | `discovery.js` (verification) | HF 70B | 10 | 0.1 | 2 | Fallback discovery category check |
| 9 | `discovery.js` (inference) | HF 70B | 50 | 0.1 | 2 | Fallback discovery intent inference |
| 10 | `conversation.js` (advice) | HF 70B | varies | 0.4 | 2 | Shopping advice intents |
| 11 | `toolSelector.js` | HF 70B | 1024 | 0.2 | 0 | Legacy AI tool selection |

---

## 1. IntelliSense Pre-Processor

**File**: `intentResolver` → deterministic resolver → Stage 0b  
**Model**: Groq Llama 3.3 70B  
**Max tokens**: 256  
**Temperature**: 0.1 (near-deterministic)  
**Retries**: 2

This is the most strategically positioned LLM call in the system. It fires before the NLP pipeline and rewrites ambiguous, colloquial, or contextually incomplete messages into a cleaner, more entity-rich form that the deterministic pipeline can process with higher accuracy.

The call is gated — it only fires when the deterministic resolver cannot confidently parse the message on its own. Short, clear messages (`"show me phones"`) skip IntelliSense entirely. Ambiguous messages (`"what about the cheaper one?"`, `"get me something in red"`) trigger it.

The temperature is 0.1 because this is a rewriting task, not a creative one. The output should be a precise, enriched version of the input — not a paraphrase with added commentary. The 256-token cap ensures the output stays tightly scoped to the rewritten message.

```js
// Inside deterministic resolver, Stage 0b
const response = await queryAI(messages, 256, 0.1);  // Low temp for precision
```

---

## 2. Legacy Intent Classifier

**File**: `server.js` → `classifyIntent()`  
**Model**: HuggingFace 70B  
**Max tokens**: 256  
**Temperature**: 0.7  
**Retries**: 2

This is the original intent classification call from before the deterministic pipeline was built. It produces a JSON object `{ intent, params, confidence }` from a structured prompt listing all available intents and their descriptions. It is now only active in the legacy code path (`FEATURES.contextIntegration` off) — the modern deterministic pipeline has completely replaced it for production traffic.

The higher temperature (0.7 vs 0.1) was appropriate for the classification task when it was the primary path — some variance in classification allowed better generalisation across phrasing variations. Now, its only purpose is maintaining backward compatibility with legacy sessions.

---

## 3. Conversation Summariser

**File**: `server.js` → background summary generation  
**Model**: HuggingFace 70B  
**Max tokens**: 150  
**Temperature**: 0.3  
**Retries**: 2

This call runs in the background after every N conversation turns (typically every 8-10 messages). It compresses older conversation history into a short `conversation_summary` string stored in session state. The summary is then injected into the LLM context window by the DCO's history windowing logic, allowing the personality layer to maintain conversational coherence across long sessions without paying the token cost of raw history.

The 150-token output cap enforces that summaries stay concise. The 0.3 temperature keeps the summary factual and stable — a summary that changes on each regeneration would confuse the LLM trying to use it as grounding context.

```js
const summary = await queryAI(messages, 150, 0.3);
```

---

## 4. Conversational Detector

**File**: `middleware/conversationalDetector.js`  
**Model**: HuggingFace 70B  
**Max tokens**: 64  
**Temperature**: 1.0  
**Retries**: 1

This utility call determines whether an incoming message is a pure conversational statement (greeting, chit-chat, complaint, thanks) rather than a shopping intent. It fires when the message's surface features are ambiguous between conversational and shopping intent.

The extraordinarily high temperature (1.0) is unusual — but this call is not generating content. It is classifying between two categories, and the LLM is asked to return a single word or short phrase. High temperature with such a constrained output does not introduce meaningful variance; it just prevents the model from being anchored to the exact phrasing of the training distribution. Single retry, 64 tokens max — the cheapest possible classification call.

```js
const response = await queryAI(prompt, 64, 1);  // 1 retry, fast
```

---

## 5. Suggestion Acknowledgement Checker

**File**: `middleware/suggestionHelper.js`  
**Model**: HuggingFace 70B  
**Max tokens**: 64  
**Temperature**: 1.0  
**Retries**: 1

When the previous AI response contained a `<suggestion>` block (a proposed next action), this call checks whether the user's current message is acknowledging or accepting that suggestion. Phrases like `"yes please"`, `"sure"`, `"go ahead"`, `"sounds good"` would trigger this.

The check is used to decide whether to replay the `last_bot_suggestion.rephrase` through the pipeline as if the user had typed it directly. Same temperature/token profile as the conversational detector — cheap binary classification, high temperature is fine at this response scale.

---

## 6. Product Sentinel

**File**: `core/productSentinel.js`  
**Model**: Groq Llama 3.1 8B Instant  
**Max tokens**: 60  
**Temperature**: 0.1  
**Retries**: 1

The sentinel is the only call in the system that deliberately uses a smaller, faster model (`8b-instant` vs the standard `70b-versatile`). The task is strictly binary: relevant or not relevant. Binary classification does not require the reasoning depth of a 70B model.

The 60-token cap forces the model to output only the required JSON structure. The 0.1 temperature makes the evaluation deterministic. JSON mode is enforced via `response_format: { type: 'json_object' }` to guarantee parseable output:

```js
const response = await queryGroqAI(
    messages,
    60,   // Max tokens — forces short JSON-only output
    0.1,  // Near-zero temperature — deterministic verdict
    1,    // Single retry — fail-fast, fail-open
    { response_format: { type: 'json_object' } },
    SENTINEL_MODEL_ID  // "llama-3.1-8b-instant"
);
```

---

## 7. Personality Layer Response Generator

**File**: `core/personalityLayer.js`  
**Model**: Groq Llama 3.3 70B  
**Max tokens**: 512–1500 (intent-dependent via DCO)  
**Temperature**: 0.4  
**Retries**: 1

This is the most expensive and most important LLM call in the system. It is the one the user directly experiences. Every response the user receives in the WhatsApp chat is generated here.

Temperature 0.4 is the carefully tuned balance between sounding natural and sounding hallucinated. Below 0.3, responses become robotic and repetitive. Above 0.6, the model starts inventing product details, adding prices it did not see, and generating plausible-sounding but false information.

Max tokens is controlled per-intent by the DCO config. A `cart.add` confirmation caps at 512 — there is no need for a long response. A `product_compare` allows 1500 — a meaningful comparison needs space to cover multiple dimensions.

Single retry. If the Groq API fails, the system falls back to the tool result's own `message` field. Hanging on multiple retries would introduce unacceptable latency for a user expecting a WhatsApp response.

---

## 8 & 9. Discovery Tool Inferences

**File**: `tools/discovery.js`  
**Model**: HuggingFace 70B  
**Max tokens**: 10 (verification) / 50 (inference)  
**Temperature**: 0.1  
**Retries**: 2

The discovery tool makes two LLM calls as part of its fallback pipeline:

**Verification call (10 tokens)**: Given the user's query and a candidate store category, the model outputs a single word — `"yes"` or `"no"` — to confirm whether the category is relevant. 10 tokens is enough for a word and punctuation. This is the smallest LLM call in the entire system.

**Inference call (50 tokens)**: After verification, the model outputs a brief inference about what the user likely wants — used to generate a `recovery_reason` string that explains to the personality layer why the discovery fallback was triggered and what direction the recovery is taking. 50 tokens for a short phrase. Temperature 0.1 keeps the inference factual.

```js
// Verification — 10 tokens, pure yes/no
const verification = await queryAI([{ role: 'user', content: verificationPrompt }], 10, 0.1);

// Inference — 50 tokens, short phrase
const inference = await queryAI([{ role: 'user', content: inferencePrompt }], 50, 0.1);
```

---

## 10. Shopping Advice (Conversation Tool)

**File**: `tools/conversation.js`  
**Model**: HuggingFace 70B  
**Max tokens**: varies  
**Temperature**: 0.4  
**Retries**: 2

When the intent is a shopping advice question (`"which phone has the best battery?"`, `"what's the difference between these two laptops?"`), the conversation tool makes a direct LLM call grounded on the store's product catalogue. This is distinct from the personality layer — it is a tool-level inference that generates the core answer content, which the personality layer then styles and delivers.

---

## 11. Legacy Tool Selector

**File**: `core/toolSelector.js`  
**Model**: HuggingFace 70B  
**Max tokens**: 1024  
**Temperature**: 0.2 (primary) / 0.4 (fallback)  
**Retries**: 0 (primary) / 1 (fallback)

The tool selector is the legacy AI-based tool selection system, predating the deterministic pipeline. It uses a structured prompt to ask the LLM to output a JSON array of tool calls based on the user's message. Zero retries on the primary pass — if it fails, a fallback model at temperature 0.4 tries once more. This system is inactive in the current production flow but remains in the codebase for compatibility.

---

## Cost and Latency Profile

In a typical production request (text-based, non-visual, no sentinel rejection), the LLM calls that fire are:

| Call | Model | Approx cost |
|---|---|---|
| IntelliSense (if triggered) | Groq 70B, 256 tok | ~$0.0001 |
| Product Sentinel | Groq 8B, 60 tok | <$0.00001 |
| Personality Layer | Groq 70B, ~800 tok avg | ~$0.0003 |
| **Total** | | **~$0.0004** |

For a purely conversational message that bypasses the search flow and triggers no sentinel, only the personality layer fires. For a visual search, the sentinel is skipped entirely. The system is designed to minimise LLM calls to the absolute minimum required for each request type.

---

*Next: Chapter 30 — System Diagnostics: REPL, Metrics, Debug Logger*
