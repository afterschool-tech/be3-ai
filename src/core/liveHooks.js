/**
 * Live Hooks Service
 * Provides mock data for Active RAG tools dynamically using consistent hashing.
 */

// Simple string hash function to generate consistent pseudo-random numbers
function hashEntity(str) {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

/**
 * Fetch mock statistics for a specific vendor using a deterministic hash
 */
async function fetch_vendor_stats(entityMeta) {
    const name = entityMeta.entity_name || 'Vendor';
    const hash = hashEntity(name);

    // Generate pseudo-random metrics based on the hash
    const ratingBase = 3.5 + ((hash % 15) / 10); // Between 3.5 and 4.9
    const totalSold = (hash % 500) + 10;
    const productCount = (hash % 100) + 5;

    // WhatsApp enabled roughly 80% of the time
    const whatsappEnabled = (hash % 10) > 2;
    // Store verified 90% of the time, Dareymi is verified (forced by hash logic mostly)
    const verified = (hash % 10) > 0;

    return {
        rating: parseFloat(ratingBase.toFixed(1)),
        total_sold: totalSold,
        product_count: productCount,
        verified: verified,
        whatsapp_enabled: whatsappEnabled,
        phone: whatsappEnabled ? `2348${10000000 + (hash % 90000000)}` : null,
        store_url: `https://bestmart.ng/${entityMeta.entity_id || 'store'}`
    };
}

/**
 * Fetch mock statistics for a specific category
 */
async function fetch_category_stats(entityMeta) {
    const name = entityMeta.entity_name || 'Category';
    const hash = hashEntity(name);

    const possibleSubs = ['gaming', 'laptops', 'accessories', 'deals', 'new-arrivals', 'clearance'];
    const subIdx = hash % possibleSubs.length;

    return {
        // total: removed, let the static prose handle product counts explicitly!
        active: true,
        trending_subs: [possibleSubs[subIdx], possibleSubs[(subIdx + 1) % possibleSubs.length]]
    };
}

/**
 * Fetch mock statistics for a specific collection
 */
async function fetch_collection_stats(entityMeta) {
    const name = entityMeta.entity_name || 'Collection';
    const hash = hashEntity(name);

    return {
        product_count: (hash % 150) + 10,
        featured: (hash % 2) === 0
    };
}

/**
 * Fetch generic store operational status
 */
async function fetch_store_status(entityMeta) {
    const name = entityMeta.entity_name || 'Store';
    const hash = hashEntity(name + new Date().toISOString().split('T')[0]); // Changes daily

    return {
        support_online: (hash % 10) > 1,
        carrier_delays: (hash % 20) === 0,
        payment_healthy: true
    };
}

const HOOKS = {
    'fetch_vendor_stats': fetch_vendor_stats,
    'fetch_category_stats': fetch_category_stats,
    'fetch_collection_stats': fetch_collection_stats,
    'fetch_store_status': fetch_store_status
};

/**
 * Executor function that runs the requested hooks in parallel and merges flat data
 */
async function executeLiveHooks(hooks, entityMeta) {
    if (!hooks || hooks.length === 0) return {};

    const promises = hooks.filter(h => HOOKS[h]).map(h => HOOKS[h](entityMeta));

    if (promises.length === 0) return {};

    const results = await Promise.all(promises);
    // Each result is a flat object, merge them all
    return Object.assign({}, ...results);
}

module.exports = {
    executeLiveHooks
};
