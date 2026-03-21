let sanitizedResponse = `
I can help you with that! These are some great options for you.
And if you want, I can also look for more gadgets!

<suggestion>
{
  "is_suggestion": true,
  "hint": "vendor product",
  "rephrase": "show me other products from Dareymi"
}
</suggestion>
`;

let extractedSuggestion = null;
const suggestionRegex = /<suggestion>([\s\S]*?)<\/suggestion>/i;
const match = sanitizedResponse.match(suggestionRegex);

if (match) {
    try {
        const parsed = JSON.parse(match[1].trim());
        if (parsed && parsed.is_suggestion && parsed.rephrase) {
            extractedSuggestion = {
                type: 'structured_payload',
                hint: parsed.hint || 'general',
                rephrase: parsed.rephrase
            };
            sanitizedResponse = sanitizedResponse.replace(suggestionRegex, '').trim();
        }
    } catch (e) {
        console.error('Failed to parse:', e.message);
    }
}

console.log("SUGGESTION OBJECT:", JSON.stringify(extractedSuggestion, null, 2));
console.log("FINAL TEXT:", sanitizedResponse);
