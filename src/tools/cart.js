/**
 * Cart Tools
 * Capabilities related to shopping cart management.
 */

const axios = require('axios');

// Configuration
const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';
const TENANT_ID = process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713';

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
        console.log(`[CartTool] API Call: ${url}`);
        const response = await axios({ url, ...config });
        return { success: true, data: response.data };
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            throw new Error(`connect ECONNREFUSED ${error.address}:${error.port}`);
        }
        console.error(`[CartTool] API Error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

const cartTools = {
    'cart.view': {
        description: 'View the current contents of the shopping cart',
        params: {}, // No params needed, uses sessionId from context
        handler: async (params, context) => {
            const { sessionId } = context;
            if (!sessionId) return { error: "Session ID required" };

            const result = await callBackendAPI(`/cart?session_id=${sessionId}`);

            if (!result.success) return { error: "Failed to retrieve cart", details: result.error };

            const { cart, items, vendorGroups } = result.data;
            if (!items || items.length === 0) {
                return { message: "Your cart is empty.", items: [], total: 0 };
            }

            const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const cartSummary = {
                items: items.map(i => ({
                    id: i.id,
                    product_name: i.product_name,
                    quantity: i.quantity,
                    price: i.price,
                    subtotal: i.price * i.quantity
                })),
                total: total.toFixed(2),
                item_count: items.length
            };

            // Sync to State
            const stateManager = require('../state/stateManager');
            await stateManager.updateCart(sessionId, cartSummary);

            return {
                ...cartSummary,
                vendor_groups: vendorGroups.map(vg => ({
                    vendor_id: vg.vendorId,
                    business_name: vg.businessName,
                    checkout_style: vg.checkoutStyle,
                    item_count: vg.items.length,
                    subtotal: vg.items.reduce((s, i) => s + (parseFloat(i.price) * i.quantity), 0).toFixed(2)
                }))
            };
        }
    },

    'cart.add': {
        description: 'Add a product to the shopping cart',
        params: {
            product_id: { type: 'string', description: 'Product ID, name, or reference (e.g. "the first one", "the cheap one", "it", or "Rattan 2 Drawers"). NEVER use placeholders like "product-id".' },
            quantity: { type: 'number', description: 'Quantity (default 1)' }
        },
        handler: async (params, context) => {
            const { product_id: identifier, quantity = 1 } = params;
            const { sessionId } = context;

            if (!identifier) return { error: "Product ID or name is required" };

            // --- STAGE 1: Product Resolution (Phase 8) ---
            const { resolveProduct } = require('../utils/productResolver');
            const product_id = await resolveProduct(identifier, context);

            if (!product_id) return { error: `Could not find product: ${identifier}` };

            console.log(`[CartTool] cart.add using resolved ID: ${product_id} (from "${identifier}")`);

            // Get product price first (simplified logic)
            // In a real scenario, the backend endpoint usually handles price lookup or validation
            const productRes = await callBackendAPI(`/products/storefront/products/${product_id}`);
            if (!productRes.success) return { error: `Product not found: ${product_id}` };

            const product = productRes.data.product;

            const result = await callBackendAPI('/cart/items', {
                method: 'POST',
                data: {
                    product_id,
                    quantity: parseInt(quantity),
                    price: product.price,
                    session_id: sessionId
                }
            });

            if (!result.success) return { error: "Failed to add to cart", details: result.error };

            // Sync to State
            const stateManager = require('../state/stateManager');
            const cartUpdate = {
                item_count: result.data.cart?.item_count || 1,
                total: result.data.cart?.total || product.price
            };
            await stateManager.updateCart(sessionId, cartUpdate);

            // Track for abandoned items
            const currentState = await stateManager.getState(sessionId);
            const abandoned = currentState.preferences.abandoned_items || [];
            if (!abandoned.some(i => i.id === product_id)) {
                abandoned.push({
                    id: product_id,
                    name: product.name,
                    price: product.price,
                    abandoned_at: new Date().toISOString()
                });
                await stateManager.updateState(sessionId, {
                    preferences: { ...currentState.preferences, abandoned_items: abandoned.slice(-5) }
                });
            }

            return {
                success: true,
                message: `Added ${quantity} x ${product.name} to cart`,
                cart_summary: result.data.cart
            };
        }
    },

    'cart.remove': {
        description: 'Remove an item from the shopping cart',
        params: {
            // Supports removing by cart item ID or product ID if needed, 
            // but usually AI passes product ID or name logic
            cart_item_id: { type: 'string', description: 'ID of the item in the cart' }
        },
        handler: async (params, context) => {
            const { cart_item_id } = params;
            if (!cart_item_id) return { error: "Cart Item ID required" };

            const result = await callBackendAPI(`/cart/items/${cart_item_id}`, {
                method: 'DELETE'
            });

            if (!result.success) return { error: "Failed to remove item", details: result.error };

            return { success: true, message: "Item removed from cart" };
        }
    },
    'cart.updateQuantity': {
        description: 'Update the quantity of an item in the shopping cart',
        params: {
            cart_item_id: { type: 'string', description: 'ID of the item in the cart' },
            quantity: { type: 'number', description: 'New quantity' }
        },
        handler: async (params, context) => {
            const { cart_item_id, quantity } = params;
            if (!cart_item_id) return { error: "Cart Item ID required" };
            if (!quantity || quantity < 1) return { error: "Quantity must be at least 1" };

            const result = await callBackendAPI(`/cart/items/${cart_item_id}`, {
                method: 'PATCH',
                data: { quantity: parseInt(quantity) }
            });

            if (!result.success) return { error: "Failed to update quantity", details: result.error };

            return {
                success: true,
                message: "Quantity updated",
                item: result.data.item
            };
        }
    }
};

module.exports = cartTools;
