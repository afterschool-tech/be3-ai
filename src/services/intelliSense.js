const { logDebug } = require('../utils/debugLogger');

/**
 * IntelliSense Service
 * LLM-powered pre-processor for multi-statement splitting, product extraction,
 * and pronoun disambiguation logic.
 *
 * Each statement carries TWO text fields:
 *   - `original` → verbatim span from the user message (transformer input)
 *   - `text`     → constrained-normalized version (entity extraction input)
 *
 * `text` is NOT a free paraphrase. It strips only conversational filler while
 * explicitly preserving everything the pipeline depends on downstream.
 *
 * Vetting guarantees:
 *   1. `original` must be a real substring of the source message.
 *      Fallback: single-statement → full source. Multi-statement → stmt.text.
 *   2. `text` must be grounded — at least one significant token must appear in
 *      the source. If not (e.g. LLM returned an example verbatim), text is
 *      replaced with `original`. Replacement not discard — pipeline always
 *      has something real to work with.
 *   3. Products/adjectives must exist in text OR original.
 *   4. Unstable semantic translations dropped.
 *   5. skip_resolve pronouns must exist in text.
 */

const SYSTEM_PROMPT = `You are a pre-processor for a shopping assistant. Return ONLY a JSON object.

TASK: For each user message —
1. Split into statements only on clear topic changes
2. For each statement return a verbatim original span and a normalized text
3. Extract product names
4. Mark idiomatic pronouns to skip

SPLITTING: Split on "that aside", "by the way", or clearly separate questions. Do NOT split coordinated phrases or same-topic "and/or". "and then"/"then" between different actions = split. When unsure, keep as one.

ORIGINAL: Copy verbatim from the message. No changes. Single statement = full message. Multi = each chunk exactly as written.

TEXT (constrained normalization — NOT free paraphrase):
- Lowercase and remove ONLY: greetings, "please", "kindly", "actually", filler sounds ("ahh", "oo", "hmm"), discourse openers ("so", "well", "basically")
- KEEP exactly: action verbs, negations, interrogative openers (how do i / can you / do you have), quantities, product names, model numbers, brand names, adjectives, specs

PRODUCTS:
- "X called Y" / "X named Y" → { name: "Y X" }
- Abstract concepts (crypto, forex, politics) → NOT a product
- No product mentioned → products: []

PRONOUNS — skip_resolve when idiomatic or intra-statement:
- "that aside", "help with that" (end), "that said", "do/try that" (action) → skip
- Pronoun refers to product IN SAME statement → skip ("find iphone and add it" → skip "it")
- Keep only cross-statement pronouns with no local antecedent ("add it to cart" standalone → keep)

OUTPUT:
{"statements":[{"original":"verbatim span","text":"normalized text","products":[{"name":"","adjectives":[]}],"skip_resolve":[]}]}

EXAMPLES:
In: "how do i make moi moi please"
Out: {"statements":[{"original":"how do i make moi moi please","text":"how do i make moi moi","products":[],"skip_resolve":[]}]}

In: "find iphone 15 and add it to cart"
Out: {"statements":[{"original":"find iphone 15 and add it to cart","text":"find iphone 15 and add it to cart","products":[{"name":"iphone 15","adjectives":[]}],"skip_resolve":["it"]}]}

In: "I want Wipes called Angel. That aside, advantage and disadvantages of Crypto. Could you help with that?"
Out: {"statements":[{"original":"I want Wipes called Angel","text":"want angel wipes","products":[{"name":"angel wipes","adjectives":[]}],"skip_resolve":[]},{"original":"advantage and disadvantages of Crypto. Could you help with that?","text":"advantage and disadvantages of crypto","products":[],"skip_resolve":["that"]}]}

In: "Show me cheap blue samsung phones"
Out: {"statements":[{"original":"Show me cheap blue samsung phones","text":"show me cheap blue samsung phones","products":[{"name":"samsung phones","adjectives":["cheap","blue"]}],"skip_resolve":[]}]}

In: "None of it because I'm not an Iphone Freak"
Out: {"statements":[{"original":"None of it because I'm not an Iphone Freak","text":"not an iphone freak","products":[],"skip_resolve":["it"]}]}
`;

// Tokens too generic to serve as grounding evidence
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'its', 'are', 'was', 'has', 'have']);

/**
 * Extract significant tokens from a string for grounding/vetting checks.
 */
function significantTokens(str) {
    return str
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

/**
 * Vet LLM output against the original source text.
 *
 * Pass 1 — original: must be a real substring of the source.
 * Pass 2 — text grounding: stmt.text must share tokens with source.
 *           If not, replaced with stmtOriginal (real but noisier — never discarded).
 * Pass 3 — products: token presence in combined (text + original) search space.
 * Pass 4 — skip_resolve: pronouns must exist in text.
 */
function vetResults(sourceText, parsed) {
    if (!parsed || !Array.isArray(parsed.statements)) return null;

    const vettedStatements = [];
    const logs = [];
    const sourceLower = sourceText.toLowerCase();
    const isMultiStatement = parsed.statements.length > 1;

    for (const stmt of parsed.statements) {

        // ── Pass 1: vet original ──────────────────────────────────────────────
        let stmtOriginal = (stmt.original || '').trim();
        const originalIsValid = stmtOriginal && sourceLower.includes(stmtOriginal.toLowerCase());

        if (!originalIsValid) {
            if (stmtOriginal) {
                logs.push(
                    `original "${stmtOriginal.substring(0, 40)}..." not in source — ` +
                    `fallback: ${isMultiStatement ? 'stmt.text' : 'full message'}`
                );
            }
            stmtOriginal = isMultiStatement ? (stmt.text || sourceText) : sourceText;
        }

        // ── Pass 2: vet text grounding ────────────────────────────────────────
        // stmt.text must share at least one significant token with the source.
        // Catches example-leakage (LLM returning its own few-shot example verbatim).
        // Replace with stmtOriginal rather than discard — keeps pipeline running.
        let stmtText = (stmt.text || '').toLowerCase();
        const textTokens = significantTokens(stmtText);
        const textIsGrounded = textTokens.length === 0 || textTokens.some(t => sourceLower.includes(t));

        if (!textIsGrounded) {
            logs.push(
                `stmt.text "${stmtText.substring(0, 40)}..." not grounded in source ` +
                `(likely example leakage) — replacing with original`
            );
            stmtText = stmtOriginal.toLowerCase();
        }

        // ── Pass 2.5: discard fully ungrounded statements ─────────────────────
        // If both text AND original share no significant tokens with the source,
        // there is nothing real left to work with — discard the statement entirely.
        // This handles the case where original fallback landed on stmt.text which
        // was itself ungrounded (circular collapse), producing a fabricated statement
        // that would otherwise fire real tools against invented data.
        const originalGroundedAfterFallback = significantTokens(stmtOriginal).some(t => sourceLower.includes(t));
        const textGroundedAfterReplacement = significantTokens(stmtText).some(t => sourceLower.includes(t));

        if (!originalGroundedAfterFallback && !textGroundedAfterReplacement) {
            logs.push(`Statement fully ungrounded — both text and original share no tokens with source, discarding`);
            continue;
        }

        // Combined search space for product/adjective vetting
        const searchSpace = `${stmtText} ${stmtOriginal.toLowerCase()}`;

        // ── Pass 3: vet products ──────────────────────────────────────────────
        const vettedProducts = [];
        if (Array.isArray(stmt.products)) {
            for (const p of stmt.products) {
                const name = (p.name || '').toLowerCase();
                const adjs = Array.isArray(p.adjectives) ? p.adjectives : [];

                // Drop generic semantic translations
                if (['food', 'drink', 'drinks', 'stuff', 'item', 'product', 'things', 'something'].includes(name)) {
                    logs.push(`Dropped semantic translation: "${name}"`);
                    continue;
                }

                // At least one significant token must exist in search space
                const nameTokens = name
                    .split(/\s+/)
                    .filter(t => t.length > 2 && !STOP_WORDS.has(t) && !['called', 'named'].includes(t));

                if (nameTokens.length > 0 && !nameTokens.some(t => searchSpace.includes(t))) {
                    logs.push(`Dropped hallucinated product: "${name}"`);
                    continue;
                }

                const vettedAdjs = adjs.filter(adj => {
                    const found = searchSpace.includes(adj.toLowerCase());
                    if (!found) logs.push(`Dropped hallucinated adjective: "${adj}" for "${name}"`);
                    return found;
                });

                vettedProducts.push({ name: p.name, adjectives: vettedAdjs });
            }
        }

        // ── Pass 4: vet skip_resolve ──────────────────────────────────────────
        const vettedSkip = (stmt.skip_resolve || []).filter(pr => {
            const found = stmtText.includes(pr.toLowerCase());
            if (!found) logs.push(`Dropped invalid skip_resolve: "${pr}"`);
            return found;
        });

        vettedStatements.push({
            original: stmtOriginal,
            text: stmtText,
            products: vettedProducts,
            skip_resolve: vettedSkip
        });
    }

    // If all statements were discarded, return null so the pipeline falls back
    // to processing the raw message directly rather than running with no data
    if (vettedStatements.length === 0) return null;

    return { vettedStatements, logs };
}

/**
 * Analyze text using LLM and return vetted IntelliSense data.
 *
 * @param {string} text - User message
 * @param {Function} aiQueryFn - LLM caller provided by resolveAndMap
 * @returns {Promise<Object|null>}
 */
async function analyze(text, aiQueryFn) {
    if (!aiQueryFn) return null;

    const startTime = Date.now();
    try {
        const prompt = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: text }
        ];

        const response = await aiQueryFn(prompt, 800, 0.1, 2, 'json_object', 'llama-3.1-8b-instant');
        const parsed = JSON.parse(response);

        const { vettedStatements, logs } = vetResults(text, parsed);
        const duration = Date.now() - startTime;

        logDebug('PIPELINE:STAGE0B_INTELLISENSE', {
            _desc: 'IntelliSense — LLM-based pre-pass for splitting, products, and pronoun guards',
            _example: '"X called Y" → { name: "Y X" }, "that aside" → skip_resolve: ["that"]',
            duration: `${duration}ms`,
            summary: {
                statementCount: vettedStatements.length,
                totalProducts: vettedStatements.reduce((acc, s) => acc + s.products.length, 0),
                totalSkipResolve: vettedStatements.reduce((acc, s) => acc + s.skip_resolve.length, 0)
            },
            vettingLogs: logs,
            results: vettedStatements
        });

        return { statements: vettedStatements };
    } catch (err) {
        console.error('🔴 [IntelliSense] Analysis failed or timed out:', err.message);
        return null;
    }
}

module.exports = { analyze };
