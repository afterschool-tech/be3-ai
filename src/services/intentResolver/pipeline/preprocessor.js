/**
 * Pipeline Stage 3: Preprocessor
 * Text normalization, negation detection, and multi-intent splitting.
 * 
 * Imports: conjunctions, negations from config
 * Inline data: NONE
 */

const conjunctions = require('../config/conjunctions');
const negations = require('../config/negations');
const conjunctionGuards = require('../config/conjunctionGuards');

/**
 * Normalize text: lowercase, trim, collapse whitespace.
 * Preserves # for order IDs and $ for prices.
 */
function normalize(text) {
    return text
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')
        // Remove punctuation except #, $, -, ', ., and ,
        // We keep commas so they can act as soft separators in splitStatements.
        .replace(/[^\w\s#$\-',.]/g, '');
}

/**
 * Detect if a statement contains a negation before an action verb.
 * Returns { negated: boolean, cleanText: string }.
 */
function detectNegation(statement) {
    for (const pattern of negations.patterns) {
        if (pattern.test(statement)) {
            return { negated: true, cleanText: statement };
        }
    }
    return { negated: false, cleanText: statement };
}

/**
 * Check if a conjunction at a given position is guarded by an intent keyword.
 * "compare iPhone and Galaxy" → "and" is guarded by "compare".
 * "add iPhone to cart and check order" → "and" is NOT guarded.
 * "then" acts as a strong sequence separator and is NEVER guarded.
 */
function isConjunctionGuarded(text, conjPosition, conjunction) {
    // "then" and "and then" are strong sequence separators — never guarded
    if (conjunction.toLowerCase().includes('then')) {
        return false;
    }

    const before = text.substring(0, conjPosition).trim();

    for (const guard of conjunctionGuards) {
        const guardLower = guard.toLowerCase();
        // Check if the guard word appears in the text before the conjunction
        if (before.includes(guardLower)) {
            return true;
        }
    }

    return false;
}

/**
 * Split a normalized text into sub-statements using conjunctions.
 * Uses greedy matching (multi-word conjunctions first).
 * Respects conjunction guards: won't split if a guard keyword precedes the conjunction.
 * Returns array of statement strings.
 */
function splitStatements(text) {
    // Commas and conjunctions are potential split points for multi-intent queries.
    // Both are checked against conjunctionGuards (e.g., "compare" prevents splitting).
    // PIE handles product segmentation separately via rawText.
    let statements = [text];

    const allSeparators = [
        ...conjunctions.map(c => ({ type: 'word', value: c })),
        { type: 'char', value: ',' }
    ];

    for (const sep of allSeparators) {
        const newStatements = [];

        for (const stmt of statements) {
            let regex;
            if (sep.type === 'word') {
                const escaped = sep.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                regex = new RegExp(`\\s+${escaped}\\s+`, 'gi');
            } else {
                regex = new RegExp(`\\s*${sep.value}\\s*`, 'gi');
            }

            const match = regex.exec(stmt);
            if (match) {
                if (isConjunctionGuarded(stmt, match.index, sep.value)) {
                    newStatements.push(stmt);
                } else {
                    regex.lastIndex = 0;
                    const parts = stmt.split(regex).map(s => s.trim()).filter(s => s.length > 0);
                    newStatements.push(...parts);
                }
            } else {
                newStatements.push(stmt);
            }
        }

        statements = newStatements;
    }

    return statements;
}

const acknowledgments = require('../config/acknowledgments');
const ACKS = new Set(acknowledgments);

/**
 * Check if a statement contains ONLY social noise/acknowledgments.
 * "yes" → true
 * "yes please" → true
 * "i need phones" → false
 */
function isSocialNoise(stmt) {
    const text = typeof stmt === 'object' ? (stmt.text || '') : stmt;
    const cleaned = text.toLowerCase().replace(/[^\w\s]/g, '').trim();
    if (!cleaned) return false;
    const words = cleaned.split(/\s+/);
    return words.every(w => ACKS.has(w));
}

/**
 * Main preprocessing pipeline.
 * Takes normalized, fuzzy-corrected, context-resolved text.
 * Returns structured output with statements and metadata.
 */
function preprocess(text, manualStatements = []) {
    const normalized = normalize(text);
    
    // Use manual statements (from IntelliSense) if provided, otherwise use regex split.
    const rawStatements = (Array.isArray(manualStatements) && manualStatements.length > 0)
        ? manualStatements
        : splitStatements(normalized);

    // Filter out statements that are pure social noise if there are other statements.
    // This prevents "yes, i want phones" from being marked as multi-intent.
    let filteredStatements = rawStatements;
    if (rawStatements.length > 1) {
        filteredStatements = rawStatements.filter(stmt => !isSocialNoise(stmt));
        // If everything was noise, keep the first one so we don't return an empty array.
        if (filteredStatements.length === 0) {
            filteredStatements = [rawStatements[0]];
        }
    }

    const statements = filteredStatements.map(stmt => {
        const stmtText = typeof stmt === 'object' ? stmt.text : stmt;
        const { negated, cleanText } = detectNegation(stmtText);
        
        // Return object with processed text and any metadata from the original stmt object
        return { 
            ...(typeof stmt === 'object' ? stmt : {}),
            text: cleanText, 
            negated 
        };
    });

    return {
        normalized,
        statements,
        isMultiIntent: statements.length > 1
    };
}

module.exports = { normalize, detectNegation, splitStatements, preprocess };
