/**
 * Product Utility
 * Shared logic for processing product data, stripping heavy fields, and caching images.
 */

const stateManager = require('../state/stateManager');

/**
 * Strips heavy data from a product object and caches its image in Redis.
 * @param {Object} product - The raw product object from the API.
 * @returns {Promise<Object>} - The lean product object.
 */
async function processProductData(product) {
    if (!product) return null;

    // console.log("[ProductUtils] Processing product:", product.id);

    const imageUrl = product.image_url || product.metadata?.image_url;
    const productId = product.id;

    // 1. Cache image (await to ensure it's ready for reinjection later if needed)
    if (imageUrl && productId) {
        try {
            await stateManager.cacheProductImage(productId, imageUrl);
        } catch (e) {
            console.error(`[ProductUtils] Failed to cache image for ${productId}:`, e.message);
        }
    }

    // 2. Create lean object (strip images, vectors, and redundant data)
    const leanProduct = {
        id: product.id,
        content_type: product.content_type || 'product',
        title: product.title || product.name,
        name: product.name || product.title,
        description: product.description,
        price: product.price,
        whatsapp_link: product.whatsapp_link || product.metadata?.whatsapp_link,
        checkout_url: product.checkout_url || product.metadata?.checkout_url,
        metadata: {
            ...product.metadata,
            image_url: undefined,
            description: undefined,
            search_vector: undefined,
            keywords: undefined,
            content: undefined
        }
    };

    // Explicitly remove top-level heavy fields
    delete leanProduct.image_url;
    delete leanProduct.search_vector;
    delete leanProduct.keywords;

    // Deep cleanup of metadata
    if (leanProduct.metadata) {
        delete leanProduct.metadata.image_url;
        delete leanProduct.metadata.search_vector;
        delete leanProduct.metadata.keywords;
        delete leanProduct.metadata.content;
    }

    return leanProduct;
}

/**
 * Processes a list of products.
 * @param {Array} products - List of raw products.
 * @returns {Promise<Array>} - List of lean products.
 */
async function processProductList(products) {
    if (!Array.isArray(products)) return [];
    return await Promise.all(products.map(p => processProductData(p)));
}

module.exports = {
    processProductData,
    processProductList
};
