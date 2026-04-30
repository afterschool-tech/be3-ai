#!/usr/bin/env node
/**
 * pos_repl.js
 * Interactive Part-of-Speech tagging REPL using compromise.
 * Usage: node pos_repl.js
 */

const readline = require('readline');
const nlp      = require('compromise');

// ─── POS tag → readable label ─────────────────────────────────────────────────
// Priority list: most-specific first. First matching tag wins.
const TAG_PRIORITY = [
    ['Acronym',       'Acronym'],
    ['Honorific',     'Honorific'],
    ['FirstName',     'First Name'],
    ['LastName',      'Last Name'],
    ['Place',         'Place'],
    ['Organization',  'Organization'],
    ['Person',        'Person'],
    ['Demonym',       'Demonym'],
    ['ProperNoun',    'Proper Noun'],
    ['Pronoun',       'Pronoun'],
    ['Noun',          'Noun'],
    ['Comparative',   'Adjective (Comparative)'],
    ['Superlative',   'Adjective (Superlative)'],
    ['Adjective',     'Adjective'],
    ['Adverb',        'Adverb'],
    ['Gerund',        'Verb (Gerund)'],
    ['Infinitive',    'Verb (Infinitive)'],
    ['PastTense',     'Verb (Past Tense)'],
    ['PresentTense',  'Verb (Present Tense)'],
    ['Auxiliary',     'Auxiliary Verb'],
    ['Verb',          'Verb'],
    ['Preposition',   'Preposition'],
    ['Conjunction',   'Conjunction'],
    ['Determiner',    'Determiner'],
    ['QuestionWord',  'Question Word'],
    ['Negative',      'Negation'],
    ['Expression',    'Interjection / Expression'],
    ['Abbreviation',  'Abbreviation'],
    ['Ordinal',       'Ordinal'],
    ['Cardinal',      'Cardinal Number'],
    ['Currency',      'Currency'],
    ['Fraction',      'Fraction'],
    ['Percent',       'Percent'],
    ['Value',         'Number / Value'],
    ['Date',          'Date'],
    ['Month',         'Month'],
    ['WeekDay',       'Weekday'],
    ['Duration',      'Duration'],
    ['Time',          'Time'],
    ['Url',           'URL'],
    ['Email',         'Email'],
    ['PhoneNumber',   'Phone Number'],
    ['HashTag',       'Hashtag'],
    ['Emoji',         'Emoji'],
    ['Punctuation',   'Punctuation'],
];

// ─── Build a Set of tag keys from a term's tags field ─────────────────────────
// In compromise v14+, doc.json() returns tags as a plain object: { Noun: true, ... }
// Older versions returned an array. We handle both.
function buildTagSet(rawTags) {
    if (!rawTags) return new Set();
    if (Array.isArray(rawTags))            return new Set(rawTags);
    if (typeof rawTags === 'object')        return new Set(Object.keys(rawTags));
    return new Set();
}

function getLabel(tagSet) {
    for (const [tag, label] of TAG_PRIORITY) {
        if (tagSet.has(tag)) return label;
    }
    return 'Unknown';
}

// ─── ANSI colours ─────────────────────────────────────────────────────────────
const C = {
    reset:   '\x1b[0m',
    bold:    '\x1b[1m',
    dim:     '\x1b[2m',
    cyan:    '\x1b[36m',
    yellow:  '\x1b[33m',
    green:   '\x1b[32m',
    blue:    '\x1b[34m',
    magenta: '\x1b[35m',
    red:     '\x1b[31m',
    white:   '\x1b[37m',
    gray:    '\x1b[90m',
};

function tagColour(label) {
    if (['Proper Noun','First Name','Last Name','Place','Organization','Person','Demonym','Acronym'].some(l => label.includes(l))) return C.cyan;
    if (label === 'Noun')                  return C.cyan;
    if (label === 'Pronoun')               return C.magenta;
    if (label.startsWith('Verb') || label === 'Auxiliary Verb') return C.green;
    if (label.startsWith('Adjective'))     return C.yellow;
    if (label === 'Adverb')                return C.magenta;
    if (label === 'Determiner')            return C.blue;
    if (label === 'Preposition')           return C.red;
    if (label === 'Conjunction')           return C.red;
    if (label === 'Question Word')         return C.yellow;
    if (label === 'Negation')              return C.red;
    if (label.includes('Number') || label.includes('Ordinal') || label.includes('Cardinal') || label === 'Value') return C.white;
    if (label === 'Punctuation')           return C.gray;
    if (label === 'Interjection / Expression') return C.yellow;
    return C.white;
}

// ─── Flatten compromise doc.json() into a flat term list ─────────────────────
// doc.json() → [{text, terms: [{text, tags:{...}}, ...]}, ...]
// We flatten all sentences into one array of {text, tagSet}
function extractTerms(input) {
    const doc = nlp(input);
    const sentences = doc.json();  // array of sentence objects

    const flat = [];
    for (const sentence of sentences) {
        if (!Array.isArray(sentence.terms)) continue;
        for (const term of sentence.terms) {
            flat.push({
                text:   term.text,
                tagSet: buildTagSet(term.tags)
            });
        }
    }
    return flat;
}

// ─── Render one analysis ──────────────────────────────────────────────────────
function analyse(input) {
    const terms = extractTerms(input);

    if (!terms.length) {
        console.log(`${C.dim}  (no terms found)${C.reset}\n`);
        return;
    }

    // Compute labels + widths
    const labelled = terms.map(t => ({
        text:    t.text,
        label:   getLabel(t.tagSet),
        allTags: [...t.tagSet]
            .filter(tag => !['Term', 'Word', 'Expression'].includes(tag) || t.tagSet.size === 1)
            .join(', ')
    }));

    const maxWord = Math.max(4, ...labelled.map(t => t.text.length));
    const maxPos  = Math.max(14, ...labelled.map(t => t.label.length));
    const hr = `${C.gray}  ${'─'.repeat(maxWord + maxPos + 20)}${C.reset}`;

    console.log(hr);
    console.log(
        `${C.gray}  ${'WORD'.padEnd(maxWord)}   ${'PART OF SPEECH'.padEnd(maxPos)}   ALL TAGS${C.reset}`
    );
    console.log(hr);

    for (const t of labelled) {
        const colour = tagColour(t.label);
        console.log(
            `  ${colour}${C.bold}${t.text.padEnd(maxWord)}${C.reset}` +
            `   ${colour}${t.label.padEnd(maxPos)}${C.reset}` +
            `   ${C.dim}${t.allTags}${C.reset}`
        );
    }
    console.log(hr);
    console.log();
}

// ─── REPL loop ────────────────────────────────────────────────────────────────
const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
    prompt: `${C.bold}${C.cyan}pos>${C.reset} `
});

console.log(`\n${C.bold}POS Tagger — powered by compromise${C.reset}`);
console.log(`${C.dim}Type any sentence and press Enter. Type .exit or Ctrl+C to quit.${C.reset}\n`);

rl.prompt();

rl.on('line', (line) => {
    const input = line.trim();
    if (!input)                            { rl.prompt(); return; }
    if (input === '.exit' || input === '.quit') { rl.close(); return; }

    analyse(input);
    rl.prompt();
});

rl.on('close', () => {
    console.log(`\n${C.dim}Bye!${C.reset}\n`);
    process.exit(0);
});
