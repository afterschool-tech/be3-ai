/**
 * Multi-Intent Comprehensive Test
 *
 * Exercises the full MULTI_INTENT_FIX_PLAN:
 * - Phase 1: Same-turn guard + skip + message
 * - Phase 2/3: Grouped + single ordinals + microstate guard
 * - Phase 4: Intent porting (add_to_cart + naked product_search)
 * - User query map: "i want to buy X" → search then add_to_cart
 *
 * NOTE: This is a console-driven smoke test, not a strict unit suite.
 * It prints intents, tools, and execution summaries and throws on core regressions.
 */

const { resolveDeterministic } = require('../src/core/deterministicResolver');
const { executeTools } = require('../src/core/orchestrator');
const stateManager = require('../src/state/stateManager');

const SESSION_ID = 'test-multi-intent-comprehensive';

async function runScenario(label, message, { setup, validate } = {}) {
    console.log(`\n==============================`);
    console.log(`🧪 Scenario: ${label}`);
    console.log(`User: "${message}"`);

    if (setup) {
        await setup();
    }

    const state = await stateManager.getState(SESSION_ID);
    const { tools, result } = await resolveDeterministic(message, state);

    // Intents
    if (result.intents && result.intents.length > 0) {
        console.log(`\nIntents:`);
        result.intents.forEach((i, idx) => {
            console.log(
                `  Intent ${idx + 1}: ${i.intentName} (score: ${i.score?.toFixed(2) ?? 'N/A'})`
            );
            if (i.parameters && Object.keys(i.parameters).length > 0) {
                const visibleParams = Object.entries(i.parameters)
                    .filter(([k, v]) => v !== null && v !== undefined && !k.startsWith('_'))
                    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                    .join(', ');
                if (visibleParams) {
                    console.log(`    params: { ${visibleParams} }`);
                }
            }
            if (i._ported_from) {
                console.log(`    (ported from ${i._ported_from})`);
            }
        });
    } else {
        console.log('\nIntents: <none>');
    }

    // Tools
    console.log(`\nTools selected:`);
    if (!tools || tools.length === 0) {
        console.log('  <none>');
    } else {
        tools.forEach(t => {
            console.log(
                `  - ${t.tool} (reason: ${t.reason || 'n/a'}, params: ${JSON.stringify(
                    t.params || {}
                )})`
            );
        });
    }

    // Execute tools
    let executionResults = [];
    if (tools && tools.length > 0) {
        executionResults = await executeTools(tools, SESSION_ID);
    }

    console.log(`\nExecution results:`);
    if (executionResults.length === 0) {
        console.log('  <none>');
    } else {
        executionResults.forEach(er => {
            const status = er.success ? '✓' : er.skipped ? '⊘' : '✗';
            const flags = [
                er.skipped ? 'skipped' : null,
                er.ported ? `ported from ${er.portedFrom}` : null,
                er.error || (er.result && er.result.error) ? 'error' : null
            ]
                .filter(Boolean)
                .join(', ');
            console.log(
                `  ${status} ${er.tool}${flags ? ` (${flags})` : ''}`
            );
            if (er.result && er.result.message) {
                console.log(`    message: ${er.result.message}`);
            }
            if (er.error) {
                console.log(`    error: ${er.error}`);
            }
            if (er.result && er.result.error) {
                console.log(`    result.error: ${er.result.error}`);
            }
        });
    }

    if (validate) {
        await validate({ result, executionResults, tools });
    }
}

async function main() {
    console.log('🧪 Starting Multi-Intent Comprehensive Test...\n');

    // Fresh state
    await stateManager.clearState(SESSION_ID);

    try {
        // PHASE 1: Same-turn guard — "show me iphone and add the first one to cart"
        await runScenario(
            'Phase 1 — Same-turn guard (no unresolved cart.add)',
            'show me iphone and add the first one to cart',
            {
                validate: ({ executionResults }) => {
                    const cartAdds = executionResults.filter(er => er.tool === 'cart.add');
                    if (cartAdds.length === 0) {
                        return;
                    }
                    const anySkipped = cartAdds.some(er => er.skipped);
                    if (!anySkipped) {
                        throw new Error(
                            'Expected at least one cart.add to be skipped in same-turn ordinal scenario (Phase 1 guard).'
                        );
                    }
                }
            }
        );

        // PHASE 2/3: Grouped + single ordinals & cart ordinal
        await runScenario(
            'Phase 2/3 — Grouped ordinals & compare top two',
            'search fro budget phones and then compare the top two',
            {
                validate: ({ result }) => {
                    const compareIntent = result.intents.find(
                        i => i.intentName === 'product_compare'
                    );
                    if (!compareIntent) {
                        console.log(
                            '  ⚠️ No product_compare intent resolved (depends on catalog content and clauses).'
                        );
                    }
                }
            }
        );

        // PHASE 3: "add the first one" should mean exactly one product (two-turn)
        await runScenario(
            'Phase 3 — Two-turn "add the first one"',
            'show me iphones',
            {}
        );
        await runScenario(
            'Phase 3 — Follow-up "add the first one"',
            'add the first one',
            {
                validate: ({ executionResults }) => {
                    const cartAdds = executionResults.filter(er => er.tool === 'cart.add');
                    if (cartAdds.length === 1) {
                        console.log('  ✅ Exactly one cart.add call for "first one".');
                    } else {
                        console.log(
                            `  ⚠️ Expected 1 cart.add for "first one", got ${cartAdds.length} (backend/search dependent).`
                        );
                    }
                }
            }
        );

        // PHASE 4: Porting — "find laptops then add macbook air and iphone 17 to cart and iphone xs max"
        await runScenario(
            'Phase 4 — Intent porting after add_to_cart',
            'find laptops then add macbook air and iphone 17 to cart and iphone xs max',
            {
                validate: ({ result, executionResults }) => {
                    const addIntents = result.intents.filter(i => i.intentName === 'add_to_cart');
                    if (addIntents.length >= 2) {
                        console.log(
                            `  ✅ Found ${addIntents.length} add_to_cart intents (porting in effect).`
                        );
                    } else {
                        console.log(
                            `  ⚠️ Expected multiple add_to_cart intents from porting, got ${addIntents.length}.`
                        );
                    }
                    const portedTools = executionResults.filter(er => er.ported);
                    if (portedTools.length > 0) {
                        console.log(
                            `  ✅ Ported tools observed: ${portedTools
                                .map(p => `${p.tool} from ${p.portedFrom}`)
                                .join(', ')}`
                        );
                    } else {
                        console.log('  ⚠️ No ported tools flagged in execution results.');
                    }
                }
            }
        );

        // USER QUERY MAP: "i want to buy spaghetti" (first as search, then as add_to_cart)
        await runScenario(
            'User Query Map — First pass (search spaghetti)',
            'i want to buy spaghetti',
            {}
        );
        await runScenario(
            'User Query Map — Second pass (ported buy spaghetti)',
            'i want to buy spaghetti',
            {
                validate: ({ result, executionResults }) => {
                    const topIntent = result.intents[0];
                    if (topIntent.intentName === 'add_to_cart') {
                        console.log('  ✅ Second "i want to buy spaghetti" resolved as add_to_cart.');
                    } else {
                        console.log(
                            `  ⚠️ Expected add_to_cart on second "i want to buy spaghetti", got ${topIntent.intentName}.`
                        );
                    }
                    const portedAdds = executionResults.filter(
                        er => er.tool === 'cart.add' && er.ported
                    );
                    if (portedAdds.length > 0) {
                        console.log(
                            `  ✅ Ported cart.add observed for spaghetti (count=${portedAdds.length}).`
                        );
                    } else {
                        console.log(
                            '  ⚠️ No ported cart.add observed for spaghetti (check logs for IntentPorter).'
                        );
                    }
                }
            }
        );

        console.log('\n✅ Multi-Intent Comprehensive Test finished (see logs above for details).');
        process.exit(0);
    } catch (err) {
        console.error('\n❌ Multi-Intent Comprehensive Test FAILED:', err);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

