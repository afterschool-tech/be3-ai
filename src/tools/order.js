/**
 * Order Tools
 * Capabilities related to order tracking and history.
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
        console.log(`[OrderTool] API Call: ${url}`); // Corrected logging prefix
        const response = await axios({ url, ...config });
        return { success: true, data: response.data };
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            throw new Error(`connect ECONNREFUSED ${error.address}:${error.port}`);
        }
        console.error(`[OrderTool] API Error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

const orderTools = {
    'order.list': {
        description: 'List recent orders for the user',
        params: {},
        handler: async (params, context) => {
            const { sessionId } = context;
            if (!sessionId) return { error: "Session ID required" };

            const result = await callBackendAPI(`/orders?session_id=${sessionId}`);

            if (!result.success) return { error: "Failed to retrieve orders", details: result.error };

            const orders = result.data.orders || [];
            return {
                orders: orders.map(o => ({
                    order_number: o.order_number,
                    status: o.status,
                    total: o.total,
                    created_at: o.created_at,
                    item_count: o.items ? o.items.length : 0
                })),
                total_count: orders.length
            };
        }
    },

    'order.track': {
        description: 'Get status and details of a specific order',
        params: {
            order_number: { type: 'string', description: 'Order number or ID' }
        },
        handler: async (params, context) => {
            const { order_number } = params;
            if (!order_number) return { error: "Order number is required" };

            const result = await callBackendAPI(`/orders/${order_number}`);

            if (!result.success) return { error: `Order not found: ${order_number}` };

            const o = result.data.order;
            return {
                order: {
                    order_number: o.order_number,
                    status: o.status,
                    total: o.total,
                    items: o.items,
                    tracking_url: o.tracking_url || null
                }
            };
        }
    },

    'order.checkout': {
        description: 'Initialize the checkout process for the current cart',
        params: {
            customer_name: { type: 'string', description: 'Customer name (optional, for WhatsApp orders)' },
            customer_email: { type: 'string', description: 'Customer email (optional, for WhatsApp orders)' }
        },
        handler: async (params, context) => {
            const { sessionId } = context;
            const { customer_name, customer_email } = params;

            const cartRes = await callBackendAPI(`/cart?session_id=${sessionId}`);
            if (!cartRes.success || !cartRes.data.vendorGroups || cartRes.data.vendorGroups.length === 0) {
                return { error: "Your cart is empty. Add some items before checking out." };
            }

            const vendorGroups = cartRes.data.vendorGroups;
            const checkoutResults = [];

            for (const group of vendorGroups) {
                const groupSubtotal = group.items.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);

                if (group.checkoutStyle === 'whatsapp') {
                    // Record pre-order in backend
                    const orderRes = await callBackendAPI('/orders/whatsapp', {
                        method: 'POST',
                        data: {
                            cartId: cartRes.data.cart?.id,
                            vendorId: group.vendorId,
                            items: group.items,
                            total: groupSubtotal,
                            customerName: customer_name,
                            customerEmail: customer_email,
                            session_id: sessionId
                        }
                    });

                    if (orderRes.success) {
                        const itemsList = group.items.map(i => `- ${i.product_name} x${i.quantity} ($${(parseFloat(i.price) * i.quantity).toFixed(2)})`).join('\n');
                        const message = `Hello ${group.businessName}! I'd like to place an order:\n\n${itemsList}\n\nTotal: $${groupSubtotal.toFixed(2)}\n\nOrder Ref: ${orderRes.data.order.order_number}`;
                        const phone = group.whatsappPhone?.replace(/[^0-9]/g, '');
                        const waLink = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

                        checkoutResults.push({
                            vendor: group.businessName,
                            type: 'whatsapp',
                            subtotal: groupSubtotal.toFixed(2),
                            order_number: orderRes.data.order.order_number,
                            whatsapp_link: waLink,
                            status: `Order recorded as ${orderRes.data.order.order_number}.`
                        });
                    } else {
                        checkoutResults.push({
                            vendor: group.businessName,
                            type: 'whatsapp',
                            error: "Failed to record WhatsApp order",
                            details: orderRes.error || orderRes.data?.error
                        });
                    }
                } else {
                    // In-house vendor: Record pre-order for dashboard
                    const orderRes = await callBackendAPI('/orders/inhouse-preorder', {
                        method: 'POST',
                        data: {
                            cartId: cartRes.data.cart?.id,
                            vendorId: group.vendorId,
                            items: group.items,
                            total: groupSubtotal,
                            customerName: customer_name,
                            customerEmail: customer_email,
                            session_id: sessionId
                        }
                    });

                    if (orderRes.success) {
                        const itemsList = group.items.map(i => `- ${i.product_name} x${i.quantity} ($${(parseFloat(i.price) * i.quantity).toFixed(2)})`).join('\n');
                        checkoutResults.push({
                            vendor: group.businessName,
                            type: 'inhouse',
                            subtotal: groupSubtotal.toFixed(2),
                            order_number: orderRes.data.order.order_number,
                            checkout_url: `/checkout?vendor_id=${group.vendorId}&order_id=${orderRes.data.order.id}`,
                            status: `Pre-order created as ${orderRes.data.order.order_number}. Vendor will contact you for payment.`,
                            items_summary: itemsList
                        });
                    } else {
                        checkoutResults.push({
                            vendor: group.businessName,
                            type: 'inhouse',
                            error: "Failed to record pre-order",
                            details: orderRes.error || orderRes.data?.error
                        });
                    }
                }
            }

            const total = cartRes.data.items.reduce((sum, i) => sum + (parseFloat(i.price) * i.quantity), 0);

            return {
                message: "Checkout initialized!",
                total: total.toFixed(2),
                vendor_breakdown: checkoutResults,
                whatsapp_only: vendorGroups.every(g => g.checkoutStyle === 'whatsapp'),
                inhouse_required: vendorGroups.some(g => g.checkoutStyle !== 'whatsapp')
            };
        }
    },

    'order.setDelivery': {
        description: 'Set or update the delivery method for the current order',
        params: {
            method: { type: 'string', description: 'Delivery method (e.g. standard, express)' }
        },
        handler: async (params, context) => {
            return {
                success: true,
                method_set: params.method || 'standard',
                message: `Delivery method set to ${params.method || 'standard'}.`
            };
        }
    },

    'order.confirm': {
        description: 'Finalize and place the order',
        params: {},
        handler: async (params, context) => {
            return {
                message: "To complete your order, please follow the payment link in our next message or visit the checkout page.",
                checkout_url: "/checkout/confirm"
            };
        }
    },

    'order.cancel': {
        description: 'Cancel an existing order',
        params: {
            order_number: { type: 'string', description: 'Order number to cancel' }
        },
        handler: async (params, context) => {
            const { order_number } = params;
            if (!order_number) return { error: "Order number required" };

            const result = await callBackendAPI(`/orders/${order_number}/cancel`, {
                method: 'POST'
            });

            if (!result.success) return { error: `Failed to cancel order ${order_number}` };

            return {
                success: true,
                message: `Order #${order_number} has been cancelled.`,
                order: result.data.order
            };
        }
    }
};

module.exports = orderTools;
