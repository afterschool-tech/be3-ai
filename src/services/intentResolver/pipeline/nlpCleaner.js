const nlp = require('compromise');

/**
 * Clean user text of linguistic noise (adverbs, conjunctions, punctuation).
 * This turns "I seriously need a tablet" into "I need tablet" for robust detection.
 * 
 * @param {string} text - Raw user input
 * @returns {string} - Cleaned text
 */
function cleanText(text) {
    if (!text) return "";

    const doc = nlp(text);

    // 1. Remove adverbs (seriously, actually, really, very)
    doc.adverbs().remove();

    // 2. Remove conjunctions (and, but, or) - optional depending on sub-tool usage
    // doc.conjunctions().remove();

    // 3. Remove punctuation to keep words pure (using regex as compromise uses methods for parts of speech)
    let cleaned = doc.text().trim().toLowerCase();
    cleaned = cleaned.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");

    return cleaned;
}

/**
 * Remove specific conjunctions and fillers that often "lump" into queries.
 */
function stripSocialNoise(text) {
    if (!text) return "";

    // Compromise can also identify social greetings
    const doc = nlp(text);

    // Remove "hello", "hi", "hey"
    const greetings = ['hello', 'hi', 'hey', 'yo', 'sup'];
    greetings.forEach(g => doc.match(g).remove());

    return doc.text().trim();
}

/**
 * Clean user text for parameter extraction (extracting core product).
 * Aggressively removes linguistic noise like conjunctions, pronouns, and prepositions.
 */
function cleanQuery(text) {
    if (!text) return "";
    const doc = nlp(text);

    // Remove noise types
    doc.adverbs().remove();
    doc.conjunctions().remove();
    doc.prepositions().remove();
    doc.pronouns().remove();
    doc.match('#Modal').remove(); // Removes "can", "could", "should", etc.

    // Remove specific navigation/action verbs that are noise for search
    const actionNoise = ['get', 'show', 'find', 'view', 'search', 'give', 'want', 'need', 'buy'];
    actionNoise.forEach(v => doc.match(v).remove());

    // Remove social greetings
    const greetings = ['hello', 'hi', 'hey', 'yo', 'sup', 'please', 'thanks', 'thank you'];
    greetings.forEach(g => doc.match(g).remove());

    let cleaned = doc.text().trim().toLowerCase();

    // Final punctuation and double space cleanup
    cleaned = cleaned.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
        .replace(/\s{2,}/g, " ");

    return cleaned.trim();
}

module.exports = { cleanText, stripSocialNoise, cleanQuery };
