const { CLAUSES, getClausesForCategory } = require('./clauses');
const { CATEGORIES } = require('./storeContext');
const { OpenAI } = require("openai");

const HF_TOKEN = process.env.HUGGINGFACE_TOKEN;
const MODEL_ID = "Qwen/Qwen2.5-Coder-32B-Instruct";

const client = new OpenAI({
    baseURL: "https://router.huggingface.co/v1",
    apiKey: HF_TOKEN,
});

/**
 * Resolver stage: Maps natural language terms to canonical clauses
 */
async function resolveClauses(userMessage, category, conversationHistory = []) {
    // 1. Identify which category we are talking about
    if (!category) return { clauses: [], display_words: [] };

    // Normalize category to its key (sluggified)
    let categoryKey = category.toLowerCase().replace(/\s+/g, '_');

    // Fallback: look up by label if normalization is different
    if (!CATEGORIES[categoryKey]) {
        const found = Object.entries(CATEGORIES).find(([id, cat]) => cat.label.toLowerCase() === category.toLowerCase());
        if (found) categoryKey = found[0];
    }

    if (!CATEGORIES[categoryKey]) {
        console.warn(`[Resolver] Category "${category}" not found in context (key: ${categoryKey})`);
        return { clauses: [], display_words: [] };
    }

    // 2. Get applicable clauses for this category, but also provide ALL clauses for better reasoning
    const categoryClauses = getClausesForCategory(categoryKey);
    console.log(`[Resolver] Applicable clauses for ${categoryKey}: ${Object.keys(categoryClauses).join(', ')}`);

    // Construct a reasoning context with ALL clauses, including their "Meanings" (display text)
    const clauseDescriptions = Object.entries(CLAUSES)
        .map(([id, c]) => {
            const isTypical = categoryClauses[id] !== undefined;
            const meaning = `${c.display.prefix} ${CATEGORIES[categoryKey].label} ${c.display.suffix}`.trim();
            return `${id}: ${c.label} ${isTypical ? '[TYPICAL]' : ''}
    Matches keywords: ${c.matches.join(', ')}
    Constructed meaning: "${meaning}"`;
        })
        .join('\n');

    console.log(`[Resolver] Category: "${categoryKey}". reasoning with ${Object.keys(CLAUSES).length} total clauses.`);

    // 3. Construct prompt for the AI to "reason" about the clauses
    const prompt = `You are a semantic resolver for a shopping assistant.
Category: ${categoryKey} (${CATEGORIES[categoryKey].label})

Below is a list of "Clauses" (modifiers). Some are marked as "[TYPICAL]", meaning they are commonly used with this category. However, you can match ANY clause if the user's adjective/word matches either the "Matches keywords" or the "Constructed meaning".

Available Clauses:
${clauseDescriptions}

The user said: "${userMessage}"

Identify if any of the user's adjectives or descriptive terms match the semantic intent of these clauses. 
- The user might use synonyms or related terms (e.g. "budget-friendly" -> "affordable", "costly" -> "costly", "colorful" -> "vibrant_color", "low storage" -> "under_1000").
- Focus on the *intent* of the words.

Return ONLY a JSON object:
{
  "matches": [
    { "canonical": "clause_id", "user_word": "the word they used" }
  ]
}
If no matches, return {"matches": []}.`;

    try {
        const response = await client.chat.completions.create({
            model: MODEL_ID,
            messages: [
                { role: "system", content: prompt },
                ...conversationHistory.slice(-2).map(h => ({
                    role: h.role === 'ai' ? 'assistant' : 'user',
                    content: h.text
                })),
                { role: "user", content: userMessage }
            ],
            max_tokens: 128,
            temperature: 0.1, // Low temperature for deterministic mapping
        });

        const resultStr = response.choices[0].message.content.trim();
        console.log(`[Resolver] Raw AI response: ${resultStr}`);

        // Extract JSON
        const jsonMatch = resultStr.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn(`[Resolver] No JSON found in response: ${resultStr}`);
            return { clauses: [], display_words: [] };
        }

        const result = JSON.parse(jsonMatch[0]);

        // Log results
        const fs = require('fs');
        const logMsg = `[${new Date().toISOString()}] Clause Resolution: ${Object.keys(categoryClauses).length} typical, Input: "${userMessage}", Matches: ${JSON.stringify(result.matches)}`;
        fs.appendFileSync('ai_steps.log', logMsg + '\n');

        return {
            clauses: result.matches.map(m => m.canonical),
            display_words: result.matches.map(m => m.user_word)
        };
    } catch (error) {
        console.error('[Resolver] Error resolving clauses:', error.message);
        return { clauses: [], display_words: [] };
    }
}

module.exports = {
    resolveClauses
};
