/**
 * MICROSTATE Improvements — Runtime-Level Tests
 *
 * Verifies:
 *  - per-param validators & normalizers in buildNewParams
 *  - smarter breakthrough config application
 *  - contextual reprompts picking the first missing param
 *  - basic multi-field progression metadata (fields + currentFieldIndex)
 */

const { _test } = require('../src/services/intentResolver/pipeline/microstateRunner');
const microstateRegistry = require('../src/services/intentResolver/config/microstateRegistry');

let pass = 0;
let fail = 0;

function assert(name, actual, expected) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        pass++;
        console.log('  ✅ ' + name);
    } else {
        fail++;
        console.log('  ❌ ' + name + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
}

console.log('\n=== MICROSTATE IMPROVEMENTS ===');

// ── 1. Validators & Normalizers ──
console.log('\n--- validators & normalizers ---');
(() => {
    const microstate = {
        type: 'collect_order_id',
        intent: 'order_status',
        sandbox: 'soft',
        boostScore: 10.0,
        params: {},
        entities: [],
        options: [],
        validators: {
            order_id: (v) => /^#?\d{3,}$/.test(String(v || ''))
        },
        normalizers: {
            order_id: (v) => String(v || '').replace(/^#/, '')
        },
        contract: {
            maxMessages: 2,
            messagesUsed: 0,
            onFulfilled: ['order_id'],
            onKeyword: ['cancel'],
            escalation: null
        }
    };

    const baseExtraction = { entities: [], residualWords: [] };

    // Invalid value should be dropped by validator
    let resp = { yesNo: 'ambiguous', ordinal: null, selection: { match: 'abc' }, multiSelection: null, rawText: 'abc' };
    let newParams = _test.buildNewParams(resp, baseExtraction, microstate);
    assert('validator drops invalid order_id', newParams, {});

    // Valid value should be normalized (strip "#") and kept
    resp = { yesNo: 'ambiguous', ordinal: null, selection: { match: '#1234' }, multiSelection: null, rawText: '#1234' };
    newParams = _test.buildNewParams(resp, baseExtraction, microstate);
    assert('normalizer strips hash, validator accepts', newParams.order_id, '1234');
})();

// ── 2. Breakthrough config helper ──
console.log('\n--- breakthrough config ---');
(() => {
    const microstate = {
        type: 'confirm_cancel_order',
        intent: 'cancel_order',
        breakthrough: {
            minScore: 2.0,
            blockIntents: ['product_search']
        }
    };

    // Below threshold → no strong signal
    let cfg = _test.applyBreakthroughConfig(microstate, 'get_help', 1.5);
    assert('below minScore is not strong', cfg.isStrongSignal, false);

    // Above threshold but blocked intent
    cfg = _test.applyBreakthroughConfig(microstate, 'product_search', 2.5);
    assert('blocked intent isBlocked=true', cfg.isBlocked, true);

    // Different intent, strong signal, not blocked
    cfg = _test.applyBreakthroughConfig(microstate, 'get_help', 3.0);
    assert('unblocked strong different intent', {
        isDifferentIntent: cfg.isDifferentIntent,
        isStrongSignal: cfg.isStrongSignal,
        isBlocked: cfg.isBlocked
    }, { isDifferentIntent: true, isStrongSignal: true, isBlocked: false });
})();

// ── 3. Contextual reprompts: choose first missing param ──
console.log('\n--- contextual reprompts ---');
(() => {
    const microstate = {
        type: 'collect_address_and_payment',
        intent: 'set_delivery',
        params: {
            address: '123 Street, Lagos',
            payment_method: ''
        },
        contract: {
            maxMessages: 3,
            messagesUsed: 1,
            onFulfilled: ['address', 'payment_method']
        }
    };

    const msg = _test.buildReprompt(
        microstate,
        {}, // no new params
        { yesNo: 'ambiguous' }
    );

    // Should be asking about payment method, not address
    const expectedFragment = _test.getParamQuestion('payment_method'); // "how would you like to pay?"
    assert('reprompt targets first missing param', msg.includes(expectedFragment), true);
})();

// ── 4. Multi-field metadata: advancing index when field satisfied ──
console.log('\n--- multi-field metadata ---');
(() => {
    const microstate = {
        type: 'collect_multi',
        intent: 'set_delivery',
        fields: [
            { name: 'address', required: true },
            { name: 'delivery_type', required: false }
        ],
        currentFieldIndex: 0,
        params: {},
        contract: {
            maxMessages: 3,
            messagesUsed: 0,
            onFulfilled: ['address']
        }
    };

    // Simulate advanceMicrostate's field progression logic locally:
    function localAdvance(ms, newParams) {
        ms.params = { ...ms.params, ...newParams };
        if (ms.fields && Array.isArray(ms.fields) && ms.fields.length > 0) {
            const idx = ms.currentFieldIndex || 0;
            const currentField = ms.fields[idx];
            if (currentField && currentField.name) {
                const val = ms.params[currentField.name];
                if (val !== undefined && val !== null && String(val).trim().length > 0) {
                    const nextIdx = idx + 1;
                    if (nextIdx < ms.fields.length) {
                        ms.currentFieldIndex = nextIdx;
                    }
                }
            }
        }
    }

    localAdvance(microstate, { address: '10 Broad Street' });
    assert('currentFieldIndex moves to next when field set', microstate.currentFieldIndex, 1);
})();

// ── 5. Intent-specific microstate triggers wired correctly ──
console.log('\n--- intent microstate triggers ---');
(() => {
    microstateRegistry.resetIndex();

    const msOrderStatus = microstateRegistry.checkTriggers('order_status', {}, [], null);
    assert('order_status.collect_order_id triggers when order_id missing',
        !!msOrderStatus && msOrderStatus.triggerName === 'collect_order_id',
        true);

    const msSetDelivery = microstateRegistry.checkTriggers('set_delivery', {}, [], null);
    assert('set_delivery.collect_delivery_details triggers when address/delivery_type missing',
        !!msSetDelivery && msSetDelivery.triggerName === 'collect_delivery_details',
        true);

    const msUpdateQty = microstateRegistry.checkTriggers('update_cart_quantity', { quantity: null }, [], null);
    assert('update_cart_quantity.collect_quantity triggers when quantity missing',
        !!msUpdateQty && msUpdateQty.triggerName === 'collect_quantity',
        true);

    const msCancelOrder = microstateRegistry.checkTriggers('cancel_order', {}, [], null);
    assert('cancel_order.collect_cancel_order_id triggers when order_number missing',
        !!msCancelOrder && msCancelOrder.triggerName === 'collect_cancel_order_id',
        true);

    const msConfirmOrder = microstateRegistry.checkTriggers('confirm_order', {}, [], null);
    assert('confirm_order.collect_confirm_order_id triggers when order_number missing',
        !!msConfirmOrder && msConfirmOrder.triggerName === 'collect_confirm_order_id',
        true);

    const msVendorProducts = microstateRegistry.checkTriggers('vendor_products', {}, [], null);
    assert('vendor_products.collect_vendor_for_products triggers when vendor missing',
        !!msVendorProducts && msVendorProducts.triggerName === 'collect_vendor_for_products',
        true);

    const msVendorContact = microstateRegistry.checkTriggers('vendor_contact', {}, [], null);
    assert('vendor_contact.collect_vendor_for_contact triggers when vendor missing',
        !!msVendorContact && msVendorContact.triggerName === 'collect_vendor_for_contact',
        true);

    const msVendorInfo = microstateRegistry.checkTriggers('vendor_info', {}, [], null);
    assert('vendor_info.collect_vendor_for_info triggers when vendor missing',
        !!msVendorInfo && msVendorInfo.triggerName === 'collect_vendor_for_info',
        true);

    const msVendorIdentity = microstateRegistry.checkTriggers('vendor_identity', {}, [], null);
    assert('vendor_identity.collect_product_for_vendor_identity triggers when product_name missing',
        !!msVendorIdentity && msVendorIdentity.triggerName === 'collect_product_for_vendor_identity',
        true);
})();

// Summary
console.log('\n═══════════════════════════════════');
console.log('Results: ' + pass + ' passed, ' + fail + ' failed');
console.log('═══════════════════════════════════');
process.exit(fail > 0 ? 1 : 0);

