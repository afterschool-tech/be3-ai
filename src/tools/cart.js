/**
 * Cart Tools
 * Capabilities related to shopping cart management.
 */

const axios = require('axios');
const stateManager = require('../state/stateManager');
const { resolveProduct } = require('../utils/productResolver');

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
                return {
                    success: true,
                    message: "Your cart is empty.",
                    items: [],
                    total: 0,
                    item_count: 0
                };
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
            await stateManager.updateCart(sessionId, cartSummary);

            const itemWord = items.length === 1 ? 'item' : 'items';
            const message = `Your cart has ${items.length} ${itemWord}. Total: $${total.toFixed(2)}.`;

            return {
                success: true,
                message,
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

            if (!identifier) {
                return { success: false, error: "I need to know which product to add. Try saying the product name or \"the first one\" from your last search." };
            }

            // --- STAGE 1: Product Resolution (Phase 8) ---
            const product_id = await resolveProduct(identifier, context);

            if (!product_id) {
                return { success: false, error: `I couldn't find a product matching "${identifier}". Check the name or say "the first one" / "the second one" after a search.` };
            }

            console.log(`[CartTool] cart.add using resolved ID: ${product_id} (from "${identifier}")`);

            const productRes = await callBackendAPI(`/products/storefront/products/${product_id}`);
            if (!productRes.success) {
                return { success: false, error: "That product isn't available right now. Try another or check back later." };
            }

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

            if (!result.success) {
                return { success: false, error: "I couldn't add it to your cart. Please try again.", details: result.error };
            }

            // Sync to State
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

            const name = product.name || 'Item';
            const qtyText = quantity > 1 ? `${quantity} × ${name}` : name;
            return {
                success: true,
                message: `Added ${qtyText} to your cart.`,
                product_name: name,
                quantity,
                cart_summary: result.data.cart,
                whatsapp: {
                    type: 'button',
                    buttons: [
                        { id: '__cart:view__', title: 'View cart' },
                        { id: '__order:checkout__', title: 'Checkout' },
                        { id: '__shop:continue__', title: 'Continue shopping' }
                    ]
                }
            };
        }
    },

    'cart.remove': {
        description: 'Remove an item from the shopping cart. Supports removing by product name/description.',
        params: {
            cart_item_id: { type: 'string', description: 'ID of the item in the cart (optional if product_id is provided)' },
            product_id: { type: 'string', description: 'Product ID or Name to remove (resolved from context)' }
        },
        handler: async (params, context) => {
            let { cart_item_id, product_id } = params;
            const { sessionId } = context;

            // if product_id is provided, resolve it to a cart_item_id (or use directly if it's already a cart item id)
            let removedItemName = null;
            if (!cart_item_id && product_id) {
                const cartRes = await callBackendAPI(`/cart?session_id=${sessionId}`);
                if (!cartRes.success) {
                    return { success: false, error: "I couldn't load your cart. Please try again.", details: cartRes.error };
                }

                const items = cartRes.data.items || [];
                if (items.length === 0) {
                    return { success: true, message: "Your cart is already empty." };
                }

                // Pipeline may pass cart_item_id as product_id when expanding "remove the first two"
                const byCartItemId = items.find(i => i.id === product_id);
                if (byCartItemId) {
                    cart_item_id = product_id;
                    removedItemName = byCartItemId.product_name;
                } else {
                    const resolvedProductId = await resolveProduct(product_id, context);
                    if (resolvedProductId) {
                        const match = items.find(i => i.product_id === resolvedProductId || i.id === resolvedProductId);
                        if (match) {
                            cart_item_id = match.id;
                            removedItemName = match.product_name;
                            console.log(`[CartTool] Resolved "${product_id}" to cart item ${cart_item_id}`);
                        }
                    }
                    if (!cart_item_id) {
                        const lowerQuery = String(product_id).toLowerCase();
                        const fuzzyMatch = items.find(i => i.product_name && i.product_name.toLowerCase().includes(lowerQuery));
                        if (fuzzyMatch) {
                            cart_item_id = fuzzyMatch.id;
                            removedItemName = fuzzyMatch.product_name;
                        }
                    }
                }
            } else if (cart_item_id) {
                const cartRes = await callBackendAPI(`/cart?session_id=${sessionId}`);
                if (cartRes.success && cartRes.data.items) {
                    const item = cartRes.data.items.find(i => i.id === cart_item_id);
                    if (item) removedItemName = item.product_name;
                }
            }

            if (!cart_item_id) {
                return { success: false, error: "I couldn't find that item in your cart. Say \"show my cart\" to see what's there, or describe the item (e.g. \"the second item\")." };
            }

            const result = await callBackendAPI(`/cart/items/${cart_item_id}`, {
                method: 'DELETE'
            });

            if (!result.success) {
                return { success: false, error: "I couldn't remove that item. Please try again.", details: result.error };
            }

            await stateManager.updateCart(sessionId, {
                item_count: result.data.cart?.item_count || 0,
                total: result.data.cart?.total || 0
            });

            const namePart = removedItemName ? ` "${removedItemName}"` : ' it';
            return { success: true, message: `Removed${namePart} from your cart.` };
        }
    },
    'cart.updateQuantity': {
        description: 'Update the quantity of an item in the shopping cart',
        params: {
            cart_item_id: { type: 'string', description: 'ID of the item in the cart (optional if product_id is provided)' },
            product_id: { type: 'string', description: 'Product ID or name to locate the cart item (resolved from context)' },
            quantity: { type: 'number', description: 'New quantity' }
        },
        handler: async (params, context) => {
            let { cart_item_id, product_id, quantity } = params;
            const { sessionId } = context;

            if (!cart_item_id && product_id) {
                const cartRes = await callBackendAPI(`/cart?session_id=${sessionId}`);
                if (!cartRes.success) {
                    return { success: false, error: "I couldn't load your cart. Please try again.", details: cartRes.error };
                }
                const items = cartRes.data.items || [];
                if (items.length === 0) {
                    return { success: false, error: "Your cart is empty. Add something first, then I can update the quantity." };
                }
                const resolvedProductId = await resolveProduct(product_id, context);
                if (resolvedProductId) {
                    const match = items.find(i => i.product_id === resolvedProductId || i.id === resolvedProductId);
                    if (match) {
                        cart_item_id = match.id;
                        console.log(`[CartTool] Resolved "${product_id}" to cart item ${cart_item_id} for quantity update`);
                    }
                }
                if (!cart_item_id) {
                    const lowerQuery = product_id.toLowerCase();
                    const fuzzyMatch = items.find(i => i.product_name.toLowerCase().includes(lowerQuery));
                    if (fuzzyMatch) cart_item_id = fuzzyMatch.id;
                }
            }

            if (!cart_item_id) {
                return { success: false, error: "I couldn't find that item in your cart. Say \"show my cart\" to see your items." };
            }
            if (!quantity || quantity < 1) {
                return { success: false, error: "Quantity must be at least 1. Say how many you want (e.g. \"change it to 2\")." };
            }

            const result = await callBackendAPI(`/cart/items/${cart_item_id}`, {
                method: 'PATCH',
                data: { quantity: parseInt(quantity) }
            });

            if (!result.success) {
                return { success: false, error: "I couldn't update the quantity. Please try again.", details: result.error };
            }

            const item = result.data.item;
            const name = item?.product_name || 'Item';
            return {
                success: true,
                message: `Updated quantity to ${quantity} for ${name}.`,
                item: result.data.item
            };
        }
    }
};

module.exports = cartTools;
