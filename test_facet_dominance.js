const { resolveIntent } = require('./src/services/intentResolver/pipeline/schemaResolver');

// Mock data to simulate the EntityExtractor output
const mockExtractionResult = {
    entities: [
        { type: 'category', value: 'smartphones', id: 'cat-123' },
        { type: 'facet_target', value: 'colors', attribute: 'c' }
    ],
    residualWords: []
};

// Test cases covering the three tiers of the Facet Dominance Rule
const testCases = [
    {
        name: 'Tier 1 (+10 Nuke): Interrogative / Meta',
        text: 'What colors of smartphones do you have?',
        expectedBoost: 10.0
    },
    {
        name: 'Tier 2 (+8 Heavy Boost): Discovery Verb',
        text: 'Show me the colors of smartphones',
        expectedBoost: 8.0
    },
    {
        name: 'Tier 3 (+2 Baseline): Just Attribute Mention',
        text: 'Colors of smartphones',
        expectedBoost: 2.0
    }
];

console.log('🧪 Running Facet Dominance Tests...\n');

testCases.forEach(test => {
    console.log(`\n==========================================`);
    console.log(`📝 Testing: "${test.text}"`);
    console.log(`==========================================`);

    // Run the schema resolver
    const result = resolveIntent(mockExtractionResult, test.text.toLowerCase());
    
    // Extract the facet_list candidate to inspect its scoring breakdown
    const facetCandidate = result.candidates.find(c => c.intentName === 'facet_list');
    
    if (!facetCandidate) {
        console.log('❌ facet_list intent was not found in candidates!');
        return;
    }

    // Find the facet dominance rule in the audit breakdown
    const dominanceRule = facetCandidate.deterministicBreakdown.find(rule => 
        rule.reason.includes('Facet dominance') || rule.reason.includes('Facet boost')
    );

    if (dominanceRule) {
        const pass = dominanceRule.value === test.expectedBoost;
        console.log(`${pass ? '✅ PASS' : '❌ FAIL'} | Applied Boost: +${dominanceRule.value}`);
        console.log(`   Rule Triggered: "${dominanceRule.reason}"`);
    } else {
        console.log('❌ FAIL | No Facet Dominance rule was triggered.');
    }
});
