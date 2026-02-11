/**
 * Intent Handlers
 * Each handler makes API calls to the backend at :3000 and returns structured data
 */

const axios = require('axios');
const { INTENTS, getHelpMessage } = require('./intents');
const stateManager = require('./stateManager');

// Backend API configuration
const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

/**
 * Helper function to make backend API requests
 */
async function callBackendAPI(endpoint, options = {}) {
    try {
        const config = {
            ...options,
            headers: {
                'X-Tenant-ID': TENANT_ID,
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const url = `${BACKEND_URL}${endpoint}`;
        console.log(`[API] ${options.method || 'GET'} ${url}`);

        const response = await axios({
            url,
            ...config
        });

        return { success: true, data: response.data };
    } catch (error) {
        console.error(`[API Error] ${endpoint}:`, error.message);
        return {
            success: false,
            error: error.response?.data?.error || error.message || 'API request failed'
        };
    }
}

/**
 * Search for products
 */
async function handleSearchProducts(params, sessionId, state = null) {
    let { query = '', category, price_min, price_max, vendor, limit = 10 } = params;

    // Helper to clean price strings (strip $ etc)
    const cleanPrice = (val) => {
        if (typeof val === 'number') return val;
        if (!val) return null;
        const cleaned = val.toString().replace(/[^0-9.]/g, '');
        return cleaned ? parseFloat(cleaned) : null;
    };

    // Clean params
    let pMin = cleanPrice(price_min);
    let pMax = cleanPrice(price_max);

    // Fallback: Try to extract price from query if missing in params
    if (query) {
        // Between pattern: "between 10 and 30"
        const betweenMatch = query.match(/between\s*\$?(\d+(?:\.\d+)?)\s*and\s*\$?(\d+(?:\.\d+)?)/i);
        if (betweenMatch) {
            if (pMin === null) pMin = parseFloat(betweenMatch[1]);
            if (pMax === null) pMax = parseFloat(betweenMatch[2]);
        }

        // Under pattern
        const underMatch = query.match(/(?:under|below|less than)\s*\$?(\d+(?:\.\d+)?)/i);
        if (underMatch && pMax === null) pMax = parseFloat(underMatch[1]);

        // Over pattern
        const overMatch = query.match(/(?:over|above|more than)\s*\$?(\d+(?:\.\d+)?)/i);
        if (overMatch && pMin === null) pMin = parseFloat(overMatch[1]);

        // General $ match
        const priceMatch = query.match(/\$\s*(\d+(?:\.\d+)?)/);
        if (priceMatch && pMax === null) pMax = parseFloat(priceMatch[1]);
    }

    // Determine search string. 
    // If we have a query, use it. 
    // If we DON'T have a query BUT we have new filters (price/category), treat query as empty string.
    // ONLY fallback to last search query if EVERYTHING is missing.
    let searchString = query;
    if (!searchString && !pMin && !pMax && !category && !vendor) {
        searchString = state?.product_context?.last_search?.query || '';
    } else if (!searchString) {
        searchString = ''; // New search with filters, don't inherit "laptops"
    }

    // Use state preferences if available
    const finalPriceMax = pMax || cleanPrice(state?.preferences?.price_range?.max);

    const searchParams = new URLSearchParams({
        q: query,
        per_page: limit
    });

    if (price_min) searchParams.append('price_min', price_min);
    if (price_max) searchParams.append('price_max', price_max);
    if (category) searchParams.append('category', category);
    if (vendor) searchParams.append('vendor', vendor);

    let result = await callBackendAPI(`/search?${searchParams.toString()}`);

    if (!result.success) {
        // Fallback to storefront search if initial search fails
        const fallbackSearchParams = new URLSearchParams({
            q: searchString,
            category: category || '',
            price_min: pMin || '',
            price_max: finalPriceMax || '',
            vendor: vendor || '',
            limit
        });

        result = await callBackendAPI(`/search/storefront?${fallbackSearchParams.toString()}`);

        if (!result.success) {
            return { error: result.error };
        }
    }

    const products = result.data.results || result.data.data || result.data || [];

    if (products.length === 0) {
        return {
            message: "I couldn't find any products matching your search. Try different keywords or filters.",
            products: []
        };
    }

    // Update state with search results and reference map
    if (state) {
        await stateManager.updateLastSearch(sessionId, searchString, { price_min: pMin, price_max: finalPriceMax, category, vendor }, products, products.length);
        await stateManager.updateReferenceMap(sessionId, products);

        // Learn from search behavior (use pMax specifically from this search)
        if (pMax !== null) {
            await stateManager.learnFromBehavior(sessionId, 'search', { price_max: pMax, category });
        }
    }

    return {
        message: `I found ${products.length} product${products.length > 1 ? 's' : ''} for you:`,
        products: products.map(p => ({
            id: p.id,
            name: p.name,
            price: p.price,
            description: p.description,
            image_url: p.image_url
        })),
        total: result.data.pagination?.total || products.length
    };
}

/**
 * View product details
 */
async function handleViewProduct(params, sessionId, state = null) {
    let { product_id, product_handle, product_name } = params;

    // Try to resolve reference from state
    if (!product_id && !product_handle && product_name && state) {
        const resolvedId = await stateManager.resolveReference(sessionId, product_name);
        if (resolvedId) {
            product_id = resolvedId;
        }
    }

    // If we only have a product_name and no resolved ID, it's likely a name the AI resolved
    // We should try to find the product ID via search first
    if (!product_id && !product_handle && product_name && !product_name.includes(' ')) {
        // Simple word, maybe it's a slug? 
    } else if (!product_id && !product_handle && product_name) {
        const searchResult = await handleSearchProducts({ query: product_name, limit: 1 }, sessionId, state);
        if (searchResult.products && searchResult.products.length > 0) {
            product_id = searchResult.products[0].id;
        }
    }

    // Use handle or ID, prefer handle
    const identifier = product_handle || product_id || product_name;

    if (!identifier) {
        return { error: "Please specify which product you want to view." };
    }

    const result = await callBackendAPI(`/products/storefront/products/${identifier}`);

    if (!result.success) {
        return { error: `Product not found: ${identifier}` };
    }

    const product = result.data.product;

    // Update state
    if (state) {
        await stateManager.setCurrentlyViewing(sessionId, product.id);
        await stateManager.addToRecentlyViewed(sessionId, product.id, product.name);

        // Learn brand preference
        if (product.vendor) {
            await stateManager.learnFromBehavior(sessionId, 'view_product', { brand: product.vendor });
        }
    }

    return {
        message: `Here are the details for ${product.name}:`,
        product: {
            id: product.id,
            name: product.name,
            price: product.price,
            description: product.description,
            images: product.images || [],
            categories: product.categories || [],
            attributes: product.resolved_attributes || [],
            stock: product.stock_quantity
        }
    };
}

/**
 * Compare multiple products
 */
async function handleCompareProducts(params, sessionId) {
    const { product_names = [], product_ids = [] } = params;

    const identifiers = [...product_ids, ...product_names];

    if (identifiers.length < 2) {
        return { error: "Please specify at least 2 products to compare." };
    }

    // Fetch all products
    const productPromises = identifiers.map(id =>
        callBackendAPI(`/products/storefront/products/${id}`)
    );

    const results = await Promise.all(productPromises);
    const products = results
        .filter(r => r.success)
        .map(r => r.data.product);

    if (products.length < 2) {
        return { error: "I couldn't find enough products to compare. Please check the product names." };
    }

    return {
        message: `Comparing ${products.length} products:`,
        products: products.map(p => ({
            id: p.id,
            name: p.name,
            price: p.price,
            description: p.description,
            attributes: p.resolved_attributes || []
        }))
    };
}

/**
 * Add product to cart
 */
async function handleAddToCart(params, sessionId, state = null) {
    let { product_id, product_name, quantity = 1 } = params;

    // Try to resolve reference from state ("add this", "add the first one")
    if (!product_id && product_name && state) {
        const resolvedId = await stateManager.resolveReference(sessionId, product_name);
        if (resolvedId) {
            product_id = resolvedId;
            product_name = null; // Clear name since we have ID
        }
    }

    // If still no ID but we have "this" reference, use currently viewing
    if (!product_id && !product_name && state?.product_context?.currently_viewing) {
        product_id = state.product_context.currently_viewing;
    }

    // If only product name is provided, search for it first
    let productId = product_id;

    if (!productId && product_name) {
        const searchResult = await handleSearchProducts({ query: product_name, limit: 1 }, sessionId);
        if (searchResult.products && searchResult.products.length > 0) {
            productId = searchResult.products[0].id;
        } else {
            return { error: `Could not find product: ${product_name}` };
        }
    }

    if (!productId) {
        return { error: "Please specify which product to add to cart." };
    }

    // Get product price first
    const productResult = await callBackendAPI(`/products/storefront/products/${productId}`);
    if (!productResult.success) {
        return { error: "Product not found." };
    }

    const product = productResult.data.product;

    // Add to cart
    const result = await callBackendAPI('/cart/items', {
        method: 'POST',
        data: {
            product_id: productId,
            quantity: parseInt(quantity),
            price: product.price,
            session_id: sessionId
        }
    });

    if (!result.success) {
        return { error: result.error };
    }

    // Update cart state
    if (state) {
        const cartData = result.data.cart || {};
        await stateManager.updateCart(sessionId, {
            id: cartData.id,
            item_count: cartData.item_count || (state.cart.item_count + 1),
            total: cartData.total || (state.cart.total + (product.price * quantity))
        });
    }

    return {
        message: `Added ${quantity} x ${product.name} to your cart.`,
        product: {
            id: product.id,
            name: product.name,
            price: product.price,
            quantity: parseInt(quantity)
        }
    };
}

/**
 * Remove product from cart
 */
async function handleRemoveFromCart(params, sessionId) {
    const { cart_item_id, product_id, product_name } = params;

    // If cart_item_id is provided, use it directly
    if (cart_item_id) {
        const result = await callBackendAPI(`/cart/items/${cart_item_id}`, {
            method: 'DELETE'
        });

        if (!result.success) {
            return { error: result.error };
        }

        return { message: "Item removed from cart." };
    }

    // Otherwise, get cart and find the item
    const cartResult = await handleViewCart({}, sessionId);
    if (!cartResult.items || cartResult.items.length === 0) {
        return { error: "Your cart is empty." };
    }

    // Find item by product_id or product_name
    const item = cartResult.items.find(i =>
        i.product_id === product_id ||
        i.product_name?.toLowerCase().includes(product_name?.toLowerCase())
    );

    if (!item) {
        return { error: "Item not found in cart." };
    }

    const result = await callBackendAPI(`/cart/items/${item.id}`, {
        method: 'DELETE'
    });

    if (!result.success) {
        return { error: result.error };
    }

    return {
        message: `Removed ${item.product_name} from your cart.`,
        removed_item: item
    };
}

/**
 * View cart contents
 */
async function handleViewCart(params, sessionId) {
    const result = await callBackendAPI(`/cart?session_id=${sessionId}`);

    if (!result.success) {
        return { error: result.error };
    }

    const { cart, items } = result.data;

    if (!cart || items.length === 0) {
        return {
            message: "Your cart is empty.",
            items: [],
            total: 0
        };
    }

    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    return {
        message: `You have ${items.length} item${items.length > 1 ? 's' : ''} in your cart:`,
        items: items.map(item => ({
            id: item.id,
            product_id: item.product_id,
            product_name: item.product_name,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.price * item.quantity
        })),
        total: total.toFixed(2),
        cart_id: cart.id
    };
}

/**
 * Update cart item quantity
 */
async function handleUpdateQuantity(params, sessionId) {
    const { cart_item_id, product_id, product_name, quantity } = params;

    if (!quantity || quantity < 1) {
        return { error: "Please specify a valid quantity." };
    }

    // If cart_item_id is provided, use it directly
    if (cart_item_id) {
        const result = await callBackendAPI(`/cart/items/${cart_item_id}`, {
            method: 'PATCH',
            data: { quantity: parseInt(quantity) }
        });

        if (!result.success) {
            return { error: result.error };
        }

        return {
            message: `Updated quantity to ${quantity}.`,
            item: result.data.item
        };
    }

    // Otherwise, get cart and find the item
    const cartResult = await handleViewCart({}, sessionId);
    if (!cartResult.items || cartResult.items.length === 0) {
        return { error: "Your cart is empty." };
    }

    // Find item by product_id or product_name
    const item = cartResult.items.find(i =>
        i.product_id === product_id ||
        i.product_name?.toLowerCase().includes(product_name?.toLowerCase())
    );

    if (!item) {
        return { error: "Item not found in cart." };
    }

    const result = await callBackendAPI(`/cart/items/${item.id}`, {
        method: 'PATCH',
        data: { quantity: parseInt(quantity) }
    });

    if (!result.success) {
        return { error: result.error };
    }

    return {
        message: `Updated ${item.product_name} quantity to ${quantity}.`,
        item: result.data.item
    };
}

/**
 * Start checkout process
 */
async function handleStartCheckout(params, sessionId) {
    // First, get the cart to check if it has items
    const cartResult = await handleViewCart({}, sessionId);

    if (!cartResult.items || cartResult.items.length === 0) {
        return { error: "Your cart is empty. Add some items before checking out." };
    }

    return {
        message: `Ready to checkout! Your cart total is $${cartResult.total}. To complete your order, I'll need:\n\n1. Your delivery address\n2. Contact information\n3. Payment method\n\nPlease provide your delivery address to continue.`,
        cart_summary: {
            items: cartResult.items,
            total: cartResult.total
        },
        next_step: "provide_address"
    };
}

/**
 * Set delivery option
 */
async function handleSetDeliveryOption(params, sessionId) {
    const { delivery_option, delivery_speed } = params;

    // This would typically update the cart or checkout session
    // For now, we'll return a confirmation message
    return {
        message: `Delivery option set to: ${delivery_option || delivery_speed || 'standard'}. This will be applied to your order.`,
        delivery_option: delivery_option || delivery_speed
    };
}

/**
 * Confirm order
 */
async function handleConfirmOrder(params, sessionId) {
    // This would typically create an order from the cart
    // For now, we'll return a placeholder message
    return {
        message: "To confirm your order, please complete the checkout process through our website or WhatsApp checkout flow. I can guide you through the steps!",
        next_step: "complete_checkout"
    };
}

/**
 * View orders
 */
async function handleViewOrders(params, sessionId) {
    const result = await callBackendAPI(`/orders?session_id=${sessionId}`);

    if (!result.success) {
        return { error: result.error };
    }

    const orders = result.data.orders || [];

    if (orders.length === 0) {
        return {
            message: "You don't have any orders yet.",
            orders: []
        };
    }

    return {
        message: `You have ${orders.length} order${orders.length > 1 ? 's' : ''}:`,
        orders: orders.map(order => ({
            order_number: order.order_number,
            status: order.status,
            total: order.total,
            created_at: order.created_at
        }))
    };
}

/**
 * Track order status
 */
async function handleTrackOrder(params, sessionId) {
    const { order_number, order_id } = params;

    const identifier = order_number || order_id;

    if (!identifier) {
        // Get the most recent order
        const ordersResult = await handleViewOrders({}, sessionId);
        if (!ordersResult.orders || ordersResult.orders.length === 0) {
            return { error: "You don't have any orders to track." };
        }

        const latestOrder = ordersResult.orders[0];
        return {
            message: `Your most recent order (#${latestOrder.order_number}) is currently: ${latestOrder.status}`,
            order: latestOrder
        };
    }

    const result = await callBackendAPI(`/orders/${identifier}`);

    if (!result.success) {
        return { error: `Order not found: ${identifier}` };
    }

    const order = result.data.order;

    return {
        message: `Order #${order.order_number} is currently: ${order.status}`,
        order: {
            order_number: order.order_number,
            status: order.status,
            total: order.total,
            created_at: order.created_at,
            items: order.items || []
        }
    };
}

/**
 * Cancel order
 */
async function handleCancelOrder(params, sessionId) {
    const { order_number, order_id } = params;

    const identifier = order_number || order_id;

    if (!identifier) {
        return { error: "Please specify which order you want to cancel." };
    }

    const result = await callBackendAPI(`/orders/${identifier}/cancel`, {
        method: 'POST'
    });

    if (!result.success) {
        return { error: result.error };
    }

    return {
        message: `Order #${identifier} has been cancelled.`,
        order: result.data.order
    };
}

/**
 * Handle help request
 */
async function handleHelp(params, sessionId) {
    return {
        message: getHelpMessage()
    };
}

/**
 * Handle unknown/fallback intent
 */
async function handleFallbackUnknown(params, sessionId) {
    return {
        message: "I'm not sure I understand. Could you rephrase that? You can also type 'help' to see what I can do for you."
    };
}

/**
 * Intent handler mapping
 */
const INTENT_HANDLERS = {
    [INTENTS.SEARCH_PRODUCTS]: handleSearchProducts,
    [INTENTS.VIEW_PRODUCT]: handleViewProduct,
    [INTENTS.COMPARE_PRODUCTS]: handleCompareProducts,
    [INTENTS.ADD_TO_CART]: handleAddToCart,
    [INTENTS.REMOVE_FROM_CART]: handleRemoveFromCart,
    [INTENTS.VIEW_CART]: handleViewCart,
    [INTENTS.UPDATE_QUANTITY]: handleUpdateQuantity,
    [INTENTS.START_CHECKOUT]: handleStartCheckout,
    [INTENTS.SET_DELIVERY_OPTION]: handleSetDeliveryOption,
    [INTENTS.CONFIRM_ORDER]: handleConfirmOrder,
    [INTENTS.VIEW_ORDERS]: handleViewOrders,
    [INTENTS.TRACK_ORDER]: handleTrackOrder,
    [INTENTS.CANCEL_ORDER]: handleCancelOrder,
    [INTENTS.HELP]: handleHelp,
    [INTENTS.FALLBACK_UNKNOWN]: handleFallbackUnknown
};

/**
 * Execute intent handler
 */
async function executeIntent(intent, params, sessionId, state = null) {
    const handler = INTENT_HANDLERS[intent];

    if (!handler) {
        console.error(`[Handler] No handler found for intent: ${intent}`);
        return handleFallbackUnknown(params, sessionId, state);
    }

    console.log(`[Handler] Executing ${intent} with params:`, params);

    try {
        const result = await handler(params, sessionId, state);
        return result;
    } catch (error) {
        console.error(`[Handler Error] ${intent}:`, error);
        return {
            error: "Something went wrong while processing your request. Please try again."
        };
    }
}

module.exports = {
    executeIntent,
    INTENT_HANDLERS
};
