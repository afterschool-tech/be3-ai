/**
 * Image Injector Utility
 * Re-attaches cached image URLs to product objects in tool results.
 * This ensures the frontend receives full visual data while maintaining a lean state/context for the AI.
 */

async function injectImages(data, stateManager) {
    if (!data || typeof data !== 'object') return;

    let injectionCount = 0;

    // Helper to process a single product
    const processProduct = async (product) => {
        // If it looks like a product (has ID) and is missing an image
        if (product && product.id && !product.image_url) {
            const cachedImage = await stateManager.getProductImage(product.id);
            if (cachedImage) {
                product.image_url = cachedImage;

                // Restore metadata image if it existed there too (optional but consistent)
                if (product.metadata && !product.metadata.image_url) {
                    product.metadata.image_url = cachedImage;
                }

                injectionCount++;
                // console.log(`[ImageInjector] Re-injected image for ${product.id}`); // Verbose log
            }
        }
    };

    // Helper to traverse structure
    const traverse = async (obj, depth = 0) => {
        if (depth > 5) return; // Prevent infinite recursion matching

        if (Array.isArray(obj)) {
            for (const item of obj) await traverse(item, depth + 1);
        } else if (obj && typeof obj === 'object') {
            // Check if this node is a product
            if (obj.id && (obj.content_type === 'product' || obj.title || obj.name)) {
                await processProduct(obj);
            }

            // Continue traversal for nested arrays (like 'products', 'results')
            // We specifically look for common container keys to be efficient
            const keys = Object.keys(obj);
            for (const key of keys) {
                // Traverse deeper only for objects and arrays
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    await traverse(obj[key], depth + 1);
                }
            }
        }
    };

    await traverse(data);

    if (injectionCount > 0) {
        console.log(`[ImageInjector] 💉 Re-injected ${injectionCount} images into response.`);
    }
}

/**
 * Flat extractor for unique image URLs from product data
 */
function extractImages(data) {
    const images = new Set();

    const traverse = (obj, depth = 0) => {
        if (depth > 5 || !obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            obj.forEach(item => traverse(item, depth + 1));
        } else {
            // Check if this is a product with an image
            if (obj.image_url) {
                images.add(obj.image_url);
            }
            if (obj.metadata && obj.metadata.image_url) {
                images.add(obj.metadata.image_url);
            }

            // Continue traversal
            Object.values(obj).forEach(val => {
                if (typeof val === 'object') traverse(val, depth + 1);
            });
        }
    };

    traverse(data);
    return Array.from(images);
}

module.exports = { injectImages, extractImages };
