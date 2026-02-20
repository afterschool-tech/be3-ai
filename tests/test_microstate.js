/**
 * MICROSTATE System — Functional Verification Tests
 */

const { resolveYesNo, resolveOrdinal, resolveSelection, resolveMultiSelection, isTerminationKeyword } = require('../src/utils/responseResolver');

let pass = 0, fail = 0;

function assert(name, actual, expected) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        pass++;
        console.log('  ✅ ' + name);
    } else {
        fail++;
        console.log('  ❌ ' + name + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
}

// ── resolveYesNo ──
console.log('\n--- resolveYesNo ---');
assert('yes', resolveYesNo('yes'), 'yes');
assert('yeah', resolveYesNo('yeah'), 'yes');
assert('sure', resolveYesNo('sure'), 'yes');
assert('yep bro', resolveYesNo('yep bro'), 'yes');
assert('no', resolveYesNo('no'), 'no');
assert('nah', resolveYesNo('nah'), 'no');
assert('cancel', resolveYesNo('cancel'), 'no');
assert('nevermind', resolveYesNo('nevermind'), 'no');
assert('iphone 16', resolveYesNo('iphone 16'), 'ambiguous');
assert('maybe', resolveYesNo('maybe'), 'ambiguous');
assert('empty', resolveYesNo(''), 'ambiguous');

// ── resolveOrdinal ──
console.log('\n--- resolveOrdinal ---');
assert('first', resolveOrdinal('first'), 1);
assert('2', resolveOrdinal('2'), 2);
assert('3rd', resolveOrdinal('3rd'), 3);
assert('the second one', resolveOrdinal('the second one'), 2);
assert('the last one', resolveOrdinal('the last one'), -1);
assert('iphone', resolveOrdinal('iphone'), null);
assert('empty', resolveOrdinal(''), null);

// ── resolveSelection ──
console.log('\n--- resolveSelection ---');
const opts = [
    { label: 'iPhone 16', value: 'p1' },
    { label: 'Galaxy S24', value: 'p2' },
    { label: 'Pixel 9', value: 'p3' }
];
assert('ordinal 1', resolveSelection('1', opts).match, 'p1');
assert('ordinal "the second one"', resolveSelection('the second one', opts).match, 'p2');
assert('text "pixel"', resolveSelection('pixel', opts).match, 'p3');
assert('exact match', resolveSelection('galaxy s24', opts).match, 'p2');
assert('exact match full', resolveSelection('iphone 16', opts).match, 'p1');
assert('no match', resolveSelection('nike shoes', opts), null);

// ── resolveMultiSelection ──
console.log('\n--- resolveMultiSelection ---');
const multi = resolveMultiSelection('1 and 3', opts);
assert('multi "1 and 3" count', multi.length, 2);
assert('multi "1 and 3" first', multi[0].match, 'p1');
assert('multi "1 and 3" second', multi[1].match, 'p3');
assert('single item returns null', resolveMultiSelection('just one', opts), null);

// ── isTerminationKeyword ──
console.log('\n--- isTerminationKeyword ---');
assert('cancel', isTerminationKeyword('cancel'), true);
assert('nevermind', isTerminationKeyword('nevermind'), true);
assert('stop', isTerminationKeyword('stop'), true);
assert('show me phones', isTerminationKeyword('show me phones'), false);
assert('add to cart', isTerminationKeyword('add to cart'), false);

// Summary
console.log('\n═══════════════════════════════════');
console.log('Results: ' + pass + ' passed, ' + fail + ' failed');
console.log('═══════════════════════════════════');
process.exit(fail > 0 ? 1 : 0);
