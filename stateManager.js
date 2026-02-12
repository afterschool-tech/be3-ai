/**
 * State Manager
 * Comprehensive state management for the Be3 AI bot
 * Handles conversation context, product tracking, reference resolution, and multi-turn flows
 */

const redisClient = require('./redis');

// Default state template
const DEFAULT_STATE = {
    user_id: null,
    session_id: null,
    tenant_id: process.env.TENANT_ID || 'cbe1df05-45ed-455a-9ce6-156b0bd45713',

    current_intent: null,
    active_flow: null,
    expecting_input: null,

    conversation_history: [],
    conversation_summary: null,

    product_context: {
        currently_viewing: null,
        last_search: null,
        comparison_set: [],
        recently_viewed: []
    },

    reference_map: {},
    ordinal_list: [],

    cart: {
        id: null,
        item_count: 0,
        total: 0,
        last_modified: null
    },

    checkout: {
        stage: null,
        address: null,
        delivery_option: null,
        payment_method: null
    },

    preferences: {
        price_range: { min: null, max: null },
        favorite_brands: [],
        favorite_categories: [],
        language: 'en'
    },

    session: {
        started_at: null,
        last_activity: null,
        message_count: 0,
        is_active: true,
        platform: 'whatsapp'
    },

    microstate: {
        type: null, // clause_resolution, cart_interaction, etc
        data: {},
        expires_at: null
    },

    last_bot_suggestion: {
        type: null,  // 'product_offer', 'action_offer', 'category_offer'
        intent: null,  // What intent would be triggered if user accepts
        params: {},    // Parameters for that intent
        text: null,    // Human-readable description of what was offered
        timestamp: null
    },

    created_at: null,
    updated_at: null,
    version: 1
};

// In-memory fallback cache
const memoryCache = new Map();

class StateManager {
    constructor() {
        this.historyLimit = parseInt(process.env.CONVERSATION_HISTORY_LIMIT || '20');
        this.defaultTTL = parseInt(process.env.STATE_TTL || '3600');
        this.enableLearning = process.env.ENABLE_PREFERENCE_LEARNING !== 'false'; // Enabled by default
    }

    /**
     * Get user state (with fallback to memory)
     */
    async getState(userId) {
        try {
            // Try Redis first
            let state = await redisClient.getState(userId);

            // Fallback to memory cache
            if (!state && memoryCache.has(userId)) {
                state = memoryCache.get(userId);
                console.log(`[StateManager] Retrieved from memory cache: ${userId}`);
            }

            // Return existing state or create new
            if (state) {
                return state;
            }

            // Create new state
            const newState = this._createNewState(userId);
            await this.setState(userId, newState);
            return newState;
        } catch (error) {
            console.error('[StateManager] Error getting state:', error.message);
            return this._createNewState(userId);
        }
    }

    /**
     * Save user state
     */
    async setState(userId, state, ttl = null) {
        try {
            state.updated_at = new Date().toISOString();
            state.session.last_activity = state.updated_at;

            const stateTTL = ttl || this.defaultTTL;

            // Save to Redis
            await redisClient.setState(userId, state, stateTTL);

            // Also save to memory cache as fallback
            memoryCache.set(userId, state);

            return true;
        } catch (error) {
            console.error('[StateManager] Error setting state:', error.message);
            // At least save to memory
            memoryCache.set(userId, state);
            return false;
        }
    }

    /**
     * Update state partially
     */
    async updateState(userId, updates) {
        const state = await this.getState(userId);
        const updatedState = { ...state, ...updates };
        await this.setState(userId, updatedState);
        return updatedState;
    }

    /**
     * Clear user state
     */
    async clearState(userId) {
        await redisClient.deleteState(userId);
        memoryCache.delete(userId);
        console.log(`[StateManager] Cleared state for: ${userId}`);
    }

    /**
     * Extend session TTL
     */
    async extendTTL(userId, seconds = null) {
        const ttl = seconds || this.defaultTTL;
        await redisClient.extendTTL(userId, ttl);
    }

    // ============ CONVERSATION MANAGEMENT ============

    /**
     * Add message to conversation history
     */
    async addMessage(userId, role, text, intent = null) {
        const state = await this.getState(userId);

        const message = {
            role,
            text,
            timestamp: new Date().toISOString()
        };

        if (intent) {
            message.intent = intent;
        }

        state.conversation_history.push(message);

        // Trim history to limit
        if (state.conversation_history.length > this.historyLimit) {
            state.conversation_history = state.conversation_history.slice(-this.historyLimit);
        }

        // Increment message count
        state.session.message_count++;

        await this.setState(userId, state);
        return message;
    }

    /**
     * Get conversation history
     */
    async getConversationHistory(userId, limit = null) {
        const state = await this.getState(userId);
        const history = state.conversation_history || [];

        if (limit) {
            return history.slice(-limit);
        }

        return history;
    }

    /**
     * Update conversation summary
     */
    async updateConversationSummary(userId, summary) {
        await this.updateState(userId, { conversation_summary: summary });
    }

    // ============ INTENT & FLOW MANAGEMENT ============

    /**
     * Set current intent
     */
    async setCurrentIntent(userId, intent) {
        await this.updateState(userId, { current_intent: intent });
    }

    /**
     * Start a multi-turn flow
     */
    async startFlow(userId, flowType, initialData = {}) {
        const flow = {
            type: flowType,
            stage: 'started',
            data: initialData,
            started_at: new Date().toISOString(),
            completed_steps: []
        };

        await this.updateState(userId, { active_flow: flow });
        console.log(`[StateManager] Started flow: ${flowType} for ${userId}`);
        return flow;
    }

    /**
     * Update flow progress
     */
    async updateFlow(userId, stage, data = {}) {
        const state = await this.getState(userId);

        if (!state.active_flow) {
            console.warn(`[StateManager] No active flow for ${userId}`);
            return null;
        }

        // Add previous stage to completed steps
        if (state.active_flow.stage && !state.active_flow.completed_steps.includes(state.active_flow.stage)) {
            state.active_flow.completed_steps.push(state.active_flow.stage);
        }

        state.active_flow.stage = stage;
        state.active_flow.data = { ...state.active_flow.data, ...data };

        await this.setState(userId, state);
        return state.active_flow;
    }

    /**
     * Complete and clear active flow
     */
    async completeFlow(userId) {
        const state = await this.getState(userId);
        const completedFlow = state.active_flow;

        await this.updateState(userId, { active_flow: null, expecting_input: null });
        console.log(`[StateManager] Completed flow: ${completedFlow?.type} for ${userId}`);

        return completedFlow;
    }

    /**
     * Get active flow
     */
    async getActiveFlow(userId) {
        const state = await this.getState(userId);
        return state.active_flow;
    }

    /**
     * Set expecting input
     */
    async setExpectingInput(userId, type, context, options = []) {
        const expecting = {
            type,
            context,
            options,
            set_at: new Date().toISOString()
        };

        await this.updateState(userId, { expecting_input: expecting });
    }

    /**
     * Clear expecting input
     */
    async clearExpectingInput(userId) {
        await this.updateState(userId, { expecting_input: null });
    }

    // ============ MICROSTATE MANAGEMENT ============

    /**
     * Set a short-lived microstate for specific reasoning contexts
     */
    async setMicrostate(userId, type, data = {}, ttlSeconds = 300) {
        const state = await this.getState(userId);
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

        state.microstate = {
            type,
            data,
            expires_at: expiresAt
        };

        await this.setState(userId, state);
        console.log(`[StateManager] Set microstate "${type}" for ${userId} (Expires: ${expiresAt})`);
    }

    /**
     * Get valid microstate
     */
    async getMicrostate(userId) {
        const state = await this.getState(userId);
        if (!state.microstate || !state.microstate.expires_at) return null;

        // Check expiry
        if (new Date() > new Date(state.microstate.expires_at)) {
            await this.clearMicrostate(userId);
            return null;
        }

        return state.microstate;
    }

    /**
     * Clear microstate
     */
    async clearMicrostate(userId) {
        const state = await this.getState(userId);
        state.microstate = { type: null, data: {}, expires_at: null };
        await this.setState(userId, state);
    }

    // ============ PRODUCT CONTEXT MANAGEMENT ============

    /**
     * Update product context
     */
    async updateProductContext(userId, context) {
        const state = await this.getState(userId);
        state.product_context = { ...state.product_context, ...context };
        await this.setState(userId, state);
    }

    /**
     * Set currently viewing product
     */
    async setCurrentlyViewing(userId, productId) {
        await this.updateProductContext(userId, { currently_viewing: productId });
    }

    /**
     * Update last search
     */
    async updateLastSearch(userId, query, filters, results, resultCount) {
        const lastSearch = {
            query,
            filters,
            results: results.slice(0, 10), // Store first 10 for reference
            result_count: resultCount,
            executed_at: new Date().toISOString()
        };

        await this.updateProductContext(userId, { last_search: lastSearch });
    }

    /**
     * Add to recently viewed
     */
    async addToRecentlyViewed(userId, productId, productName, duration = 0) {
        const state = await this.getState(userId);

        const viewedItem = {
            id: productId,
            name: productName,
            viewed_at: new Date().toISOString(),
            duration_seconds: duration
        };

        // Remove if already exists
        state.product_context.recently_viewed = state.product_context.recently_viewed.filter(
            item => item.id !== productId
        );

        // Add to front
        state.product_context.recently_viewed.unshift(viewedItem);

        // Keep only last 10
        state.product_context.recently_viewed = state.product_context.recently_viewed.slice(0, 10);

        await this.setState(userId, state);
    }

    /**
     * Update reference map from product list
     */
    async updateReferenceMap(userId, products) {
        if (!products || products.length === 0) {
            return;
        }

        const state = await this.getState(userId);
        const referenceMap = {};
        const ordinalList = [];

        // Debug: Log first product structure
        console.log(`[StateManager] Updating reference map. First product:`, JSON.stringify(products[0], null, 2));

        // Map ordinal references
        products.forEach((product, index) => {
            // Use handle if available, otherwise id
            const productIdentifier = product.handle || product.id || product.product_id;

            if (!productIdentifier) {
                console.warn(`[StateManager] Product at index ${index} has no identifier:`, product);
                return;
            }

            ordinalList.push(productIdentifier);

            // Map positions: "the first one", "the second one"
            if (index === 0) referenceMap.the_first_one = productIdentifier;
            if (index === 1) referenceMap.the_second_one = productIdentifier;
            if (index === 2) referenceMap.the_third_one = productIdentifier;
        });

        // Map "this" and "that"
        if (products.length > 0) {
            const firstId = products[0].handle || products[0].id || products[0].product_id;
            const secondId = products.length > 1 ? (products[1].handle || products[1].id || products[1].product_id) : firstId;

            referenceMap.this = firstId;
            referenceMap.that = secondId;
        }

        // Map brand and full name references
        products.forEach(product => {
            const productIdentifier = product.handle || product.id || product.product_id;

            if (product.name) {
                const nameLower = product.name.toLowerCase();
                const nameSlug = nameLower.replace(/\s+/g, '_');
                const nameIdentifier = nameLower.replace(/[^a-z0-9]/g, '_');

                // Add full name as reference
                referenceMap[nameSlug] = productIdentifier;
                if (nameIdentifier !== nameSlug) {
                    referenceMap[nameIdentifier] = productIdentifier;
                }

                // Common brands
                const brands = ['samsung', 'apple', 'dell', 'hp', 'lenovo', 'asus', 'sony', 'lg', 'infinix', 'tecno'];
                brands.forEach(brand => {
                    if (nameLower.includes(brand)) {
                        referenceMap[`the_${brand}`] = productIdentifier;
                        referenceMap[`the_${brand}_one`] = productIdentifier;
                    }
                });

                // Price-based references
                if (product.price) {
                    const prices = products.map(p => p.price).sort((a, b) => a - b);
                    if (product.price === prices[0]) {
                        referenceMap.the_cheap_one = productIdentifier;
                        referenceMap.the_cheapest = productIdentifier;
                    }
                    if (product.price === prices[prices.length - 1]) {
                        referenceMap.the_expensive_one = productIdentifier;
                        referenceMap.the_most_expensive = productIdentifier;
                    }
                }
            }
        });

        state.reference_map = referenceMap;
        state.ordinal_list = ordinalList;

        await this.setState(userId, state);
        console.log(`[StateManager] Updated reference map with ${products.length} products`);
        console.log(`[StateManager] Reference map keys:`, Object.keys(referenceMap));
        console.log(`[StateManager] Ordinal list:`, ordinalList);
    }

    /**
     * Resolve a reference to a product ID
     */
    async resolveReference(userId, reference) {
        const state = await this.getState(userId);

        if (!reference) {
            return null;
        }

        const refLower = reference.toLowerCase().replace(/\s+/g, '_');

        // Check reference map
        if (state.reference_map[refLower]) {
            console.log(`[StateManager] Resolved "${reference}" → ${state.reference_map[refLower]}`);
            return state.reference_map[refLower];
        }

        // Check ordinal positions
        const ordinalMatch = reference.match(/(\d+)(st|nd|rd|th)/i);
        if (ordinalMatch) {
            const position = parseInt(ordinalMatch[1]) - 1;
            if (state.ordinal_list[position]) {
                console.log(`[StateManager] Resolved "${reference}" → ${state.ordinal_list[position]}`);
                return state.ordinal_list[position];
            }
        }

        console.log(`[StateManager] Could not resolve reference: "${reference}"`);
        return null;
    }

    /**
     * Get ordinal reference (1st, 2nd, 3rd)
     */
    async getOrdinalReference(userId, position) {
        const state = await this.getState(userId);
        return state.ordinal_list[position] || null;
    }

    // ============ CART & CHECKOUT ============

    /**
     * Update cart state
     */
    async updateCart(userId, cartData) {
        const state = await this.getState(userId);
        state.cart = { ...state.cart, ...cartData, last_modified: new Date().toISOString() };
        await this.setState(userId, state);
    }

    /**
     * Update checkout state
     */
    async updateCheckout(userId, checkoutData) {
        const state = await this.getState(userId);
        state.checkout = { ...state.checkout, ...checkoutData };
        await this.setState(userId, state);
    }

    // ============ PREFERENCES & LEARNING ============

    /**
     * Update user preferences
     */
    async updatePreferences(userId, prefs) {
        const state = await this.getState(userId);
        state.preferences = { ...state.preferences, ...prefs };
        await this.setState(userId, state);
    }

    /**
     * Learn from user behavior
     */
    async learnFromBehavior(userId, action, data) {
        if (!this.enableLearning) {
            return;
        }

        const state = await this.getState(userId);

        console.log(`[StateManager] Learning from ${action}:`, data);

        switch (action) {
            case 'search':
                // Learn price preferences (use numbers for comparison)
                const priceMax = parseFloat(data.price_max);
                if (!isNaN(priceMax)) {
                    const currentMax = parseFloat(state.preferences.price_range.max);
                    if (isNaN(currentMax) || priceMax < currentMax) {
                        console.log(`[StateManager] Learned price preference: max $${priceMax}`);
                        state.preferences.price_range.max = priceMax;
                    }
                }

                // Learn category preferences
                if (data.category && !state.preferences.favorite_categories.includes(data.category)) {
                    console.log(`[StateManager] Learned category preference: ${data.category}`);
                    state.preferences.favorite_categories.push(data.category);
                }
                break;

            case 'view_product':
                // Learn brand preferences
                if (data.brand && !state.preferences.favorite_brands.includes(data.brand)) {
                    console.log(`[StateManager] Learned brand preference: ${data.brand}`);
                    state.preferences.favorite_brands.push(data.brand);
                    state.preferences.favorite_brands = state.preferences.favorite_brands.slice(-5); // Keep last 5
                }
                break;
        }

        await this.setState(userId, state);
    }

    // ============ UTILITIES ============

    /**
     * Create new state for user
     */
    _createNewState(userId) {
        const now = new Date().toISOString();
        return {
            ...DEFAULT_STATE,
            user_id: userId,
            session_id: `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            created_at: now,
            updated_at: now,
            session: {
                ...DEFAULT_STATE.session,
                started_at: now,
                last_activity: now
            }
        };
    }


    // ============ SUGGESTION TRACKING ============

    async setLastSuggestion(userId, suggestion) {
        const suggestionWithTimestamp = { ...suggestion, timestamp: new Date().toISOString() };
        await this.updateState(userId, { last_bot_suggestion: suggestionWithTimestamp });
        console.log(`[StateManager] Tracked suggestion: ${suggestion.type} -> ${suggestion.intent}`);
    }

    async getLastSuggestion(userId) {
        const state = await this.getState(userId);
        const suggestion = state.last_bot_suggestion;
        if (suggestion?.timestamp) {
            const age = Date.now() - new Date(suggestion.timestamp).getTime();
            if (age > 5 * 60 * 1000) {
                await this.clearLastSuggestion(userId);
                return null;
            }
        }
        return suggestion;
    }

    async clearLastSuggestion(userId) {
        await this.updateState(userId, {
            last_bot_suggestion: { type: null, intent: null, params: {}, text: null, timestamp: null }
        });
    }
    /**
     * Get state summary for debugging
     */
    async getStateSummary(userId) {
        const state = await this.getState(userId);
        return {
            user_id: state.user_id,
            session_id: state.session_id,
            current_intent: state.current_intent,
            active_flow: state.active_flow?.type || null,
            message_count: state.session.message_count,
            cart_items: state.cart.item_count,
            last_activity: state.session.last_activity
        };
    }
}

// Export singleton instance
module.exports = new StateManager();

