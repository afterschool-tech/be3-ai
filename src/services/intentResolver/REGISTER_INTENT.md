# Registering a New Intent in Be3 AI

This guide outlines the steps required to register a new intent and integrate it with the AI pipeline.

## Step 1: Define the Intent
Create a new `.js` file in `src/services/intentResolver/config/intents/`.
Specify the intent name, keywords, synonyms, and parameters.

```javascript
module.exports = {
    name: 'your_intent_name',
    keywords: ['word1', 'word2'],
    synonyms: ['phrase one', 'phrase two'],
    parameters: {
        param1: { type: 'string', required: false, description: 'Description' }
    },
    toolName: 'tool.name',
    paramMap: {
        param1: 'toolParamName'
    },
    minProducts: 0,
    maxProducts: 1
};
```

## Step 2: Implement or Update Tools
Check `src/tools/` (e.g., `product.js`, `conversation.js`) to see if a tool exists for your intent.
- If not, create a new tool in the relevant file.
- If it exists, update it to handle any new parameters or provide richer data for the personality layer.

## Step 3: Add Semantic Lab Support
Navigate to `src/services/intentResolver/semanticLab/intents/`.
1. **Create a directory** named after your intent.
2. **Create `bench.json`**: Add 20-30 initial variations with relevant placeholders like `[product]`, `[category]`, or `[vendor]`.
3. **Create `prompt.txt`**: Write a specific LLM prompt for generating variations. Include clear rules and negative/positive examples.
4. **Create `sync.js`**: Create a dedicated sync script for your intent (refer to `facet_list/sync.js` for the pattern). This allows for independent synchronization and high-quality variation generation.

## Step 4: Verification
1. **Syntax Check**: Run `node --check` on your files.
2. **REPL Test**: Use `tests/repl_intent_resolver.js` to verify resolution and parameter extraction.
3. **personalityLayer**: Ensure the tool output is descriptive enough for the LLM to generate a helpful branded response.

## Best Practices
- **Keyword Overlap**: Be careful with common words like "help" or "show" which might be shared across many intents. Use specific keywords or synonyms to boost score.
- **Rich Data**: Always return full objects (like `product`) in tools so the personality layer can "see" the data it's talking about.
- **Buttons**: Include WhatsApp-compatible buttons in the tool response for better UX.
