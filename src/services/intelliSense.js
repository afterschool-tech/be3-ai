const { logDebug } = require('../utils/debugLogger');

/**
 * IntelliSense Service
 * LLM-powered pre-processor for multi-statement splitting, product extraction,
 * and pronoun disambiguation logic.
 * 
 * Includes STRICT vetting to ensure LLM does not hallucinate product names 
 * or "semantic translations" (like something to eat -> food) that aren't in the text.
 */

const SYSTEM_PROMPT = `You are a text pre-processor for a shopping assistant. Given a user message, return ONLY a JSON object with no explanation.

TASK:
1. Split the message into separate statements only when the user is clearly switching topics
2. Extract product names (resolve naming patterns like "X called Y" → product is "Y X" or just "Y")
3. Mark pronouns that are discourse/idiomatic and should NOT be resolved to products

SPLITTING RULES:
- Split on clear topic changes ("that aside", "by the way", separate questions about different things)
- Do NOT split coordinated noun phrases: "advantage and disadvantages" = one statement
- Do NOT split on "and/or" when both sides are about the same topic
- "and then" and "then" between different actions = split
- When unsure, keep as one statement

PRODUCT EXTRACTION RULES:
- "X called Y" → { name: "Y X", adjectives: [] }
- "X named Y" → { name: "Y X", adjectives: [] }  
- "cheap blue Samsung phone" → { name: "Samsung phone", adjectives: ["cheap", "blue"] }
- "something to eat" → { name: "food", adjectives: [] }
- Abstract concepts (crypto, forex, politics, finance) → NOT a product, leave products: []
- If no product is mentioned → products: []

PRONOUN RULES — mark as skip_resolve when:
- "that aside" → skip "that"
- "this aside" → skip "this"  
- "help with that" at end of sentence → skip "that"
- "could you help with that/this" → skip "that/this"
- "that said", "that being said" → skip "that"
- "do that", "try that" referring to an action not a product → skip "that"
- INTRA-STATEMENT COREFERENCE: If a pronoun (it/this/that/them) refers to a product noun WITHIN THE SAME statement, skip it. The pipeline handles cross-statement references separately.
  - "find iphone 15 and add it to cart" (one statement) → "it" refers to "iphone 15" in the same sentence → skip "it"
  - "show me samsung s24 then add it to my bag" (one statement) → "it" refers to "samsung s24" → skip "it"
- Only keep for resolution (do NOT skip): pronouns that clearly refer to something OUTSIDE the statement with no antecedent in the same sentence
  - "add it to cart" (standalone, no product mentioned) → keep "it" for resolution
  - "how much is it" (standalone) → keep "it" for resolution

OUTPUT SCHEMA:
{
  "statements": [
    {
      "text": "cleaned statement text",
      "products": [
        { "name": "product name", "adjectives": ["adj1", "adj2"] }
      ],
      "skip_resolve": ["pronoun1"]
    }
  ]
}

EXAMPLES:
Input: "Show me cheap blue samsung phones"
Output: {"statements":[{"text":"show me cheap blue samsung phones","products":[{"name":"samsung phones","adjectives":["cheap","blue"]}],"skip_resolve":[]}]}

Input: "Yeah, lately I've been looking for a particular product which is Wipes called Angel. That aside, I'm trying to weigh the advantage and disadvantages of Crypto and Forex. Could you please help with that?"
Output: {"statements":[{"text":"looking for angel wipes","products":[{"name":"angel wipes","adjectives":[]}],"skip_resolve":[]},{"text":"i'm trying to weigh the advantage and disadvantages of crypto and forex","products":[],"skip_resolve":["that"]}]}

Input: "find iphone 15 and add it to cart"
Output: {"statements":[{"text":"find iphone 15 and add it to cart","products":[{"name":"iphone 15","adjectives":[]}],"skip_resolve":["it"]}]}
`;

/**
 * Perform strict vetting on the LLM output.
 * 1. Product names/adjectives MUST exist in the original statement text.
 * 2. Semantic translations like "something to eat" -> "food" are forbidden and dropped.
 * 3. Pronouns in skip_resolve MUST exist in the statement.
 */
function vetResults(originalText, parsed) {
    if (!parsed || !Array.isArray(parsed.statements)) return null;

    const vettedStatements = [];
    const logs = [];

    for (const stmt of parsed.statements) {
        const stmtText = (stmt.text || '').toLowerCase();
        
        // 1. Validate product names and adjectives
        const vettedProducts = [];
        if (Array.isArray(stmt.products)) {
            for (const p of stmt.products) {
                const name = (p.name || '').toLowerCase();
                const adjs = Array.isArray(p.adjectives) ? p.adjectives : [];

                // 1.1 Drops unstable semantic translation: "something to eat" -> "food"
                if (['food', 'drink', 'drinks', 'stuff', 'item', 'product'].includes(name)) {
                    logs.push(`Dropped unstable semantic translation: "${name}"`);
                    continue;
                }

                // 1.2 Multi-token logic: At least one significant token (>2 chars) must exist in text.
                // This allows "Angel wipes" for "Wipes called Angel".
                const nameTokens = name.split(/\s+/)
                    .filter(t => t.length > 2 && !['the', 'and', 'for', 'with', 'from', 'called', 'named'].includes(t));
                
                const someFound = nameTokens.some(t => stmtText.includes(t));

                if (nameTokens.length > 0 && !someFound) {
                    logs.push(`Dropped hallucinated product: "${name}" (no significant tokens found in statement text)`);
                    continue;
                }

                // 1.3 Adjective check (strict, must be in text)
                const vettedAdjs = adjs.filter(adj => {
                    const found = stmtText.includes(adj.toLowerCase());
                    if (!found) logs.push(`Dropped hallucinated adjective: "${adj}" for product "${name}"`);
                    return found;
                });

                vettedProducts.push({ name: p.name, adjectives: vettedAdjs });
            }
        }

        // 2. Validate skip_resolve pronouns
        const vettedSkip = [];
        if (Array.isArray(stmt.skip_resolve)) {
            for (const pr of stmt.skip_resolve) {
                if (stmtText.includes(pr.toLowerCase())) {
                    vettedSkip.push(pr);
                } else {
                    logs.push(`Dropped invalid skip_resolve: "${pr}" (not found in statement text)`);
                }
            }
        }

        vettedStatements.push({
            ...stmt,
            products: vettedProducts,
            skip_resolve: vettedSkip
        });
    }

    return { vettedStatements, logs };
}

/**
 * Analyze text using LLM and return vetted IntelliSense data.
 * @param {string} text - User message
 * @param {Function} aiQueryFn - Function to call LLM (provided by resolveAndMap)
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

        // Vetting phase
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
