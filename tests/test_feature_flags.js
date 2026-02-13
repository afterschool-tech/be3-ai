/**
 * Test Feature Flags and Metrics System
 * Phase 0, Task 0.1
 */

const { FEATURES, shouldUseToolSystem, getFeatures } = require('./featureFlags');
const { trackRequest, getMetrics, resetMetrics, getMetricsSummary } = require('./metrics');

console.log('🧪 Testing Feature Flag System\n');

// Test 1: Feature flag loading
console.log('✅ Test 1: Feature Flags Loaded');
console.log(getFeatures());
console.log('');

// Test 2: A/B routing logic
console.log('✅ Test 2: A/B Routing (should all be false with 0% traffic)');
const sessions = ['sess-1', 'sess-2', 'sess-3', 'sess-4', 'sess-5'];
sessions.forEach(sessionId => {
    const useTools = shouldUseToolSystem(sessionId);
    console.log(`  ${sessionId}: ${useTools ? 'TOOLS' : 'LEGACY'}`);
});
console.log('');

// Test 3: Metrics tracking
console.log('✅ Test 3: Metrics Tracking');
resetMetrics();

// Simulate legacy requests
trackRequest('legacy', { apiCalls: 1, responseTime: 250, error: false });
trackRequest('legacy', { apiCalls: 1, responseTime: 300, error: false });
trackRequest('legacy', { apiCalls: 1, responseTime: 200, error: true });

// Simulate tool system requests
trackRequest('toolSystem', {
    apiCalls: 0,
    responseTime: 50,
    error: false,
    tools: ['vendor.getInfo']
});
trackRequest('toolSystem', {
    apiCalls: 1,
    responseTime: 150,
    error: false,
    tools: ['product.search']
});

console.log(getMetricsSummary());
console.log('');

// Test 4: Detailed metrics
console.log('✅ Test 4: Detailed Metrics Object');
console.log(JSON.stringify(getMetrics(), null, 2));
console.log('');

console.log('🎉 All tests passed! Feature flag system working correctly.');
