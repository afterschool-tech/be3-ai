const sm = require('../src/state/stateManager');

async function testReferenceRefinement() {
    const userId = 'test_user_' + Date.now();

    console.log('🧪 Starting Intelligent Reference Mapping Tests...');

    // 1. First Single Product (iPhone 12)
    console.log('\n--- Step 1: Search "iPhone 12" (Single) ---');
    await sm.updateReferenceMap(userId, [{ id: 'id-12', name: 'iPhone 12', price: 600 }]);
    let state = await sm.getState(userId);
    console.log('First:', state.reference_map.first);
    console.log('All:', state.reference_map.all);
    if (state.reference_map.first === 'id-12' && state.reference_map.all === 'id-12') {
        console.log('✅ PASS');
    } else {
        console.log('❌ FAIL');
    }

    // 2. Second Single Product (iPhone 15)
    console.log('\n--- Step 2: Search "iPhone 15" (Single) ---');
    await sm.updateReferenceMap(userId, [{ id: 'id-15', name: 'iPhone 15', price: 900 }]);
    state = await sm.getState(userId);
    console.log('First:', state.reference_map.first);
    console.log('Second:', state.reference_map.second);
    console.log('All:', state.reference_map.all);
    if (state.reference_map.first === 'id-12' && state.reference_map.second === 'id-15' && state.reference_map.all === 'id-12,id-15') {
        console.log('✅ PASS: Accumulation successful');
    } else {
        console.log('❌ FAIL');
    }

    // 3. Set Overwrite (Macbooks)
    console.log('\n--- Step 3: Search "Macbooks" (Set of 2) ---');
    await sm.updateReferenceMap(userId, [
        { id: 'mac-1', name: 'Macbook Air', price: 1000 },
        { id: 'mac-2', name: 'Macbook Pro', price: 2000 }
    ]);
    state = await sm.getState(userId);
    console.log('First:', state.reference_map.first);
    console.log('Second:', state.reference_map.second);
    console.log('All:', state.reference_map.all);
    console.log('Slug Check (iphone_12):', state.reference_map.iphone_12);

    const isSetCorrect = state.reference_map.first === 'mac-1' && state.reference_map.second === 'mac-2' && state.reference_map.all === 'mac-1,mac-2';
    const isSlugPersistent = state.reference_map.iphone_12 === 'id-12';

    if (isSetCorrect && isSlugPersistent) {
        console.log('✅ PASS: Set overwrite + Slug persistence successful');
    } else {
        console.log('❌ FAIL');
    }

    // 4. Additive Plural after Set
    console.log('\n--- Step 4: Search "Surface" (Single) ---');
    await sm.updateReferenceMap(userId, [{ id: 'surf-1', name: 'Surface Pro', price: 800 }]);
    state = await sm.getState(userId);
    console.log('All:', state.reference_map.all);
    console.log('First:', state.reference_map.first);
    console.log('Third:', state.reference_map.third);

    if (state.reference_map.all === 'mac-1,mac-2,surf-1' && state.reference_map.third === 'surf-1') {
        console.log('✅ PASS: Additive plural and slot filling successful');
    } else {
        console.log('❌ FAIL');
    }

    console.log('\n📊 Summary: If all steps are green, Intelligent Reference Mapping is working perfectly.');
}

testReferenceRefinement().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
