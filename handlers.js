/**
 * Intent Handlers
 * Each handler makes API calls to the backend at :3000 and returns structured data
 */

const axios = require('axios');
const { INTENTS, getHelpMessage } = require('./intents');
const { CATEGORIES, VENDORS } = require('./storeContext');
const { CLAUSES } = require('./clauses');
const stateManager = require('./stateManager');

/**
 * Constructs a semantic slug for the resolve-slug endpoint
 * Pattern: prefix + category_slug + suffix
 */
function constructSemanticSlug(categorySlug, clauses = []) {
    if (!categorySlug || clauses.length === 0) return null;

    // Use the first clause as the primary semantic modifier
    const clauseId = clauses[0];
    const clause = CLAUSES[clauseId];

    if (!clause) return null;

    const prefix = (clause.display.prefix || '').toLowerCase().replace(/\s+/g, '-');
    const suffix = (clause.display.suffix || '').toLowerCase().replace(/\s+/g, '-');

    return `${prefix}${categorySlug}${suffix}`;
}

/**
 * Normalizes a category label or slug to its canonical slug
 */
function normalizeCategory(cat) {
    if (!cat) return null;
    const catLower = cat.trim().toLowerCase();

    // 1. Direct key match
    if (CATEGORIES[catLower]) return CATEGORIES[catLower].slug;

    // 2. Direct slug match
    const bySlug = Object.values(CATEGORIES).find(c => c.slug.toLowerCase() === catLower);
    if (bySlug) return bySlug.slug;

    // 3. Exact label match
    const byLabel = Object.values(CATEGORIES).find(c => c.label.toLowerCase() === catLower);
    if (byLabel) return byLabel.slug;

    // 4. Fuzzy match (Starts with or contains)
    const fuzzy = Object.values(CATEGORIES).find(c =>
        c.label.toLowerCase().includes(catLower) ||
        catLower.includes(c.label.toLowerCase())
    );

    return fuzzy ? fuzzy.slug : cat;
}

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

    // Use semantic clauses if present in microstate
    console.log(`[Handlers] Checking microstate for sessionId: ${sessionId}. State type: ${state?.microstate?.type}`);
    const semanticClauses = state?.microstate?.type === 'clause_resolution' ? (state.microstate.data.clauses || []) : [];
    const normalizedCategory = normalizeCategory(category);

    console.log(`[Handlers] Semantic clauses: ${JSON.stringify(semanticClauses)}, Category: ${normalizedCategory}`);

    let result = null;
    let resolvedSeo = null;

    // STAGE 0: Try Semantic Slug Resolution (Native Backend Logic)
    if (normalizedCategory && semanticClauses.length > 0) {
        const semanticSlug = constructSemanticSlug(normalizedCategory, semanticClauses);
        if (semanticSlug) {
            console.log(`[Handlers] Attempting semantic slug resolution for: "${semanticSlug}"`);
            const slugResult = await callBackendAPI(`/search/resolve-slug/${semanticSlug}`);

            if (slugResult.success && slugResult.data.filter) {
                console.log(`[Handlers] Semantic slug SUCCESS! Using filter: ${slugResult.data.filter}`);

                // Store SEO data from resolution for the final response
                resolvedSeo = slugResult.data.seo || {
                    title: slugResult.data.title,
                    description: slugResult.data.meta_description
                };
                console.log(`[Handlers] Resolved SEO context: ${resolvedSeo.title}`);

                // Step 2: Fetch products using the resolved filter string
                result = await callBackendAPI(`/search?${slugResult.data.filter}&per_page=${limit}`);
                if (result.success) {
                    console.log(`[Handlers] Products successfully fetched via semantic filter.`);
                }
            } else {
                console.warn(`[Handlers] Semantic slug "${semanticSlug}" not found or has no filters. Falling back.`);
            }
        }
    }

    // STAGE 1: Standard Search (if slug resolution wasn't attempted or failed)
    if (!result || !result.success) {
        const searchParams = new URLSearchParams({
            q: query || '',
            per_page: limit
        });

        if (price_min) searchParams.append('price_min', price_min);
        if (price_max) searchParams.append('price_max', price_max);

        if (normalizedCategory) {
            searchParams.append('category', normalizedCategory);
            console.log(`[Handlers] Applied category filter: ${normalizedCategory} (from ${category})`);
        }

        if (vendor) searchParams.append('vendor', vendor);

        // Use the specialized products endpoint for AI bot (forces content_type=product)
        result = await callBackendAPI(`/search/products?${searchParams.toString()}`);

        if (!result.success) {
            // Fallback to storefront search if specialized search fails or 404s
            const fallbackSearchParams = new URLSearchParams({
                q: searchString,
                category: category || '',
                limit
            });

            result = await callBackendAPI(`/search/storefront?${fallbackSearchParams.toString()}`);

            if (!result.success) {
                return { error: result.error };
            }
        }
    }

    // Capture results from either specialized or standard endpoints
    const rawProducts = result.data.products || result.data.results || result.data.data || (Array.isArray(result.data) ? result.data : []) || [];

    // Normalize product data
    let products = rawProducts.map(p => ({
        id: p.id || p._id,
        name: p.name || p.title,
        price: p.price || (p.offers ? p.offers.price : null),
        description: p.description,
        image: p.image || p.image_url,
        url: p.url,
        categories: p.categories || p.category
    })).filter(p => p.id && p.name); // Simple filter, backend now handles exclusion 

    // Update state with search results and reference map
    if (state) {
        // Use pMax or inferred pMax for learning
        const learnPriceMax = pMax || cleanPrice(params.price_max) || null;

        await stateManager.updateLastSearch(sessionId, searchString, { price_min: pMin, price_max: learnPriceMax, category, vendor }, products, products.length);
        await stateManager.updateReferenceMap(sessionId, products);

        if (learnPriceMax !== null) {
            await stateManager.learnFromBehavior(sessionId, 'search', { price_max: learnPriceMax, category });
        }
    }

    // Extract SEO metadata if present
    const seo = resolvedSeo || result.data.seo || (result.data.mainEntityOfPage ? {
        title: result.data.name,
        description: result.data.description
    } : {
        title: query ? `Results for "${query}"` : 'Search Results',
        description: `Found ${products.length} products`
    });

    return {
        message: `I found ${products.length} product${products.length > 1 ? 's' : ''}${seo.title ? ` for "${seo.title}"` : ''}:`,
        products: products,
        seo: seo.title ? seo : null,
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
async function handleCompareProducts(params, sessionId, state = null) {
    let { product_names = [], product_ids = [] } = params;

    // Robust extraction: Handle if AI returns product1, product2, etc.
    Object.keys(params).forEach(key => {
        if (key.match(/^product\d+$/)) {
            if (!product_names.includes(params[key])) {
                product_names.push(params[key]);
            }
        }
    });

    // Ensure they are arrays
    if (!Array.isArray(product_names)) product_names = [product_names];
    if (!Array.isArray(product_ids)) product_ids = [product_ids];

    const rawIdentifiers = [...product_ids, ...product_names];

    if (rawIdentifiers.length < 2) {
        return { error: "Please specify at least 2 products to compare." };
    }

    console.log(`[Handlers] Resolving ${rawIdentifiers.length} identifiers for comparison: ${rawIdentifiers.join(', ')}`);

    // Step 1: Resolve all identifiers to real product IDs/handles
    const resolvedIdentifiers = [];
    for (const ident of rawIdentifiers) {
        let resolvedIdent = ident;

        // Try state resolution first (for "the first one", "the last one")
        if (state) {
            const stateRef = await stateManager.resolveReference(sessionId, ident);
            if (stateRef) {
                console.log(`[Handlers] Resolved "${ident}" via state reference to: ${stateRef}`);
                resolvedIdent = stateRef;
            }
        }

        // If it's a generic name and wasn't a state ref, try to find it via search
        if (resolvedIdent === ident && (ident.includes(' ') || ident.length > 20)) {
            console.log(`[Handlers] Searching for product match for: "${ident}"`);
            const searchRes = await handleSearchProducts({ query: ident, limit: 1 }, sessionId, state);
            if (searchRes.products && searchRes.products.length > 0) {
                console.log(`[Handlers] Resolved "${ident}" via search to: ${searchRes.products[0].id}`);
                resolvedIdent = searchRes.products[0].id;
            }
        }

        resolvedIdentifiers.push(resolvedIdent);
    }

    // Step 2: Fetch all products
    const productPromises = resolvedIdentifiers.map(id =>
        callBackendAPI(`/products/storefront/products/${id}`)
    );

    const results = await Promise.all(productPromises);
    const products = results
        .filter(r => r.success)
        .map(r => r.data.product);

    if (products.length < 2) {
        return { error: "I couldn't find enough products to compare. Please check the product names." };
    }

    // Persist compared products to state for follow-up context (e.g. advice, add-to-cart)
    if (state) {
        await stateManager.updateLastSearch(sessionId, `Comparison: ${products.map(p => p.name).join(' vs ')}`, {}, products, products.length);
        await stateManager.updateReferenceMap(sessionId, products);
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
 * Get advice or follow-up reasoning for products in state
 */
async function handleGetAdvice(params, sessionId, state = null) {
    const { product_name } = params;
    let products = [];
    let product = null;

    // 1. If a specific product name is provided, try to find it
    if (product_name) {
        console.log(`[Handlers] Advice requested for specific product: ${product_name}`);
        const resolvedId = await stateManager.resolveReference(sessionId, product_name);
        const identifier = resolvedId || product_name;

        const result = await callBackendAPI(`/products/storefront/products/${identifier}`);
        if (result.success) {
            product = result.data.product;
        }
    }

    // 2. If no specific product, or search failed, pull from currently viewing
    if (!product && state?.product_context?.currently_viewing) {
        console.log(`[Handlers] Pulling advice context from currently_viewing: ${state.product_context.currently_viewing}`);
        const result = await callBackendAPI(`/products/storefront/products/${state.product_context.currently_viewing}`);
        if (result.success) {
            product = result.data.product;
        }
    }

    // 3. Fallback: Pull from last search results
    if (!product && state?.product_context?.last_search?.results) {
        console.log(`[Handlers] Pulling advice context from last search results.`);
        products = state.product_context.last_search.results.slice(0, 3);
    }

    if (!product && products.length === 0) {
        return {
            message: "I don't have any products in mind. Which one are you asking about?",
            error: "No context found"
        };
    }

    return {
        message: "Context gathered for advice.",
        product: product ? {
            id: product.id,
            name: product.name,
            price: product.price,
            description: product.description,
            attributes: product.resolved_attributes || []
        } : null,
        recent_products: products.map(p => ({
            id: p.id,
            name: p.name,
            price: p.price
        }))
    };
}

/**
 * Handle initial greetings
 */
async function handleGreeting(params, sessionId, state = null) {
    // Get store categories
    const categories = state?.store_context?.categories || [];
    const randomCats = [...categories].sort(() => 0.5 - Math.random()).slice(0, 3).map(c => c.label);

    // Dynamic rotation pool of things we can do
    const thingsWeDo = [
        "finding the best tech and home items",
        "managing your shopping cart with ease",
        "tracking your orders so you stay updated",
        "comparing products to find your perfect match",
        "sourcing awesome deals just for you",
        "giving you friendly shopping advice"
    ];
    const randomThings = thingsWeDo.sort(() => 0.5 - Math.random()).slice(0, 3);

    return {
        message: "Hello! Welcome to Be3!",
        store_name: "Be3",
        rotation_context: {
            suggested_categories: randomCats,
            what_we_can_do: randomThings
        }
    };
}

/**
 * Override standard help with context
 */
async function handleHelp(params, sessionId, state = null) {
    const categories = state?.store_context?.categories || [];

    return {
        message: "I'm your Be3 assistant. I can help find products, manage your cart, and track orders.",
        capabilities: [
            "Search for products",
            "Compare specs",
            "Calculate discounts",
            "Track shipments",
            "Personalized shopping advice"
        ],
        available_categories: categories.slice(0, 10),
        help_menu: true
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
    [INTENTS.GREETING]: handleGreeting,
    [INTENTS.GET_ADVICE]: handleGetAdvice,
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
