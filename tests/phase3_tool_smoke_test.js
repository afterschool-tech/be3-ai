/**
 * Phase 3: Tool Architecture Smoke Test
 * Verifies that the registry loads tools and the orchestrator can execute them.
 */

const { executeTools } = require('../src/core/orchestrator');
const { TOOL_REGISTRY, getToolDescriptions } = require('../src/tools/registry');

async function runSmokeTest() {
    console.log('🧪 Starting Tool System Smoke Test...\n');

    // 1. Check Registry
    const toolCount = Object.keys(TOOL_REGISTRY).length;
    console.log(`[Registry] Loaded ${toolCount} tools.`);
    if (toolCount < 3) throw new Error('Registry failed to load initial tools');

    const descriptions = getToolDescriptions();
    console.log(`[Registry] Descriptions generated for: ${descriptions.map(d => d.name).join(', ')}\n`);

    // 2. Check Orchestrator Execution
    const testPlan = [
        {
            tool: 'vendor.list',
            params: {},
            reason: 'Testing vendor list'
        },
        {
            tool: 'vendor.getInfo',
            params: { vendor: 'Dareymi' }, // Assuming Dareymi exists in context
            reason: 'Testing vendor lookup'
        }
    ];

    console.log('[Orchestrator] Executing test plan...');
    try {
        const results = await executeTools(testPlan, 'test-session-id');

        console.log('\n[Orchestrator] Results received:');
        results.forEach(r => {
            console.log(`- Tool: ${r.tool}`);
            console.log(`  Success: ${r.success}`);
            if (r.success) {
                const preview = JSON.stringify(r.result).substring(0, 100);
                console.log(`  Output: ${preview}...`);
            } else {
                console.log(`  Error: ${r.error}`);
            }
        });

        // Verification
        const vendorListResult = results.find(r => r.tool === 'vendor.list');
        if (!vendorListResult || !vendorListResult.success || !Array.isArray(vendorListResult.result)) {
            throw new Error('vendor.list failed or returned invalid data');
        }

        const vendorInfoResult = results.find(r => r.tool === 'vendor.getInfo');
        if (!vendorInfoResult || !vendorInfoResult.success || !vendorInfoResult.result.business_name) {
            console.warn('vendor.getInfo returned:', vendorInfoResult);
            throw new Error('vendor.getInfo failed or returned invalid data (check context data?)');
        }

        console.log('\n✅ SMOKE TEST PASSED: Tool system is operational.');

    } catch (error) {
        console.error('\n❌ SMOKE TEST FAILED:', error);
        process.exit(1);
    }
}

runSmokeTest();
