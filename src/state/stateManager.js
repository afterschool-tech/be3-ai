/**
 * State Manager
 * Comprehensive state management for the Be3 AI bot
 * Handles conversation context, product tracking, reference resolution, and multi-turn flows
 */

const fs = require('fs');
const path = require('path');
const redisClient = require('./redis');
const { logDebug } = require('../utils/debugLogger');

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

    user_query_map: {}, // Volatile map: user's search queries -> product IDs (session-only, not persisted)
    // Format: { "spaghetti": "id1", "pasta": "id1,id2,id3" }
    // Only stores queries that successfully matched products
    // Single product: "query": "id"
    // Multiple products: "query": "id1,id2,id3" (comma-separated)

    search_context: null, // Semantic snapshot of last search/browse results (memory-only, message-count TTL)

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
        abandoned_items: [], // [{ id, name, price, abandoned_at }]
        language: 'en'
    },

    session: {
        started_at: null,
        last_activity: null,
        message_count: 0,
        search_refinement_count: 0,
        is_active: true,
        platform: 'whatsapp'
    },

    microstate: null, // null when inactive, full microstate object when active

    last_bot_suggestion: {
        type: null,  // 'product_offer', 'action_offer', 'category_offer'
        intent: null,  // What intent would be triggered if user accepts
        params: {},    // Parameters for that intent
        text: null,    // Human-readable description of what was offered
        timestamp: null
    },

    last_tools: [], // Array of { tool, params }
    active_topic: null, // Ambient Context: { type, category_id, vendor, product_id, set_at_message, ... }

    paused_context: null, // Stores context when user wants to chat mid-transaction

    created_at: null,
    updated_at: null,
    version: 1
};

// In-memory fallback cache
const memoryCache = new Map();
const searchSnapshotCache = new Map();

class StateManager {
    constructor() {
        this.historyLimit = parseInt(process.env.CONVERSATION_HISTORY_LIMIT || '20');
        this.defaultTTL = parseInt(process.env.STATE_TTL || '300'); // Default 5 mins (was 3600)
        this.enableLearning = process.env.ENABLE_PREFERENCE_LEARNING !== 'false'; // Enabled by default
        this.searchSnapshotTTL = parseInt(process.env.SEARCH_SNAPSHOT_TTL || '900');
    }

    async setSearchSnapshot(userId, snapshotId, filters, ttlSeconds = null) {
        if (!userId || !snapshotId) return false;
        const ttl = ttlSeconds || this.searchSnapshotTTL;
        const payload = {
            filters: filters && typeof filters === 'object' ? filters : {},
            created_at: new Date().toISOString()
        };

        const key = `be3:search_snapshot:${userId}:${snapshotId}`;

        try {
            const client = redisClient.getClient ? redisClient.getClient() : null;
            if (client) {
                await client.setEx(key, ttl, JSON.stringify(payload));
            } else {
                searchSnapshotCache.set(key, { payload, expiresAt: Date.now() + ttl * 1000 });
            }
            return true;
        } catch (e) {
            searchSnapshotCache.set(key, { payload, expiresAt: Date.now() + ttl * 1000 });
            return false;
        }
    }

    async getSearchSnapshot(userId, snapshotId) {
        if (!userId || !snapshotId) return null;
        const key = `be3:search_snapshot:${userId}:${snapshotId}`;

        try {
            const client = redisClient.getClient ? redisClient.getClient() : null;
            if (client) {
                const raw = await client.get(key);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                return parsed && typeof parsed === 'object' ? parsed : null;
            }
        } catch (_) {}

        const local = searchSnapshotCache.get(key);
        if (!local) return null;
        if (local.expiresAt && local.expiresAt <= Date.now()) {
            searchSnapshotCache.delete(key);
            return null;
        }
        return local.payload;
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
                // Ensure user_query_map exists (volatile, session-only)
                // If state came from Redis, it won't have user_query_map (we exclude it)
                if (!state.user_query_map) {
                    state.user_query_map = {};
                }
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

            // user_query_map is volatile - exclude it from Redis persistence
            const stateForRedis = { ...state };
            delete stateForRedis.user_query_map;

            // Save to Redis (without user_query_map)
            await redisClient.setState(userId, stateForRedis, stateTTL);

            // Also save to memory cache as fallback (with user_query_map - it's session-only)
            memoryCache.set(userId, state);

            return true;
        } catch (error) {
            console.error('[StateManager] Error setting state:', error.message);
            // At least save to memory (with user_query_map)
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

    /**
     * Contextual Pruning: Clear ephemeral state like ordinals/plurals when intent shifts
     * Now less aggressive: Slugs are preserved unless manually cleared.
     */
    async pruneState(userId, intent) {
        const isNewSearch = intent === 'new search' || intent.includes('category');
        if (isNewSearch) {
            console.log(`[StateManager] ✂️ Pruning search context for intent: ${intent}`);
            const state = await this.getState(userId);
            // We only prune current context, not the whole map (preserving slugs)
            await this.updateState(userId, {
                product_context: {
                    ...state.product_context,
                    currently_viewing: null
                }
            });
        }
    }

    // ============ INTENT & FLOW MANAGEMENT ============

    /**
     * Set current intent
     */
    async setCurrentIntent(userId, intent) {
        await this.updateState(userId, { current_intent: intent });
    }

    /**
     * @deprecated Use setMicrostate() with chained contracts instead.
     */
    async startFlow(userId, flowType, initialData = {}) {
        console.warn(`[StateManager] DEPRECATED: startFlow() called. Use setMicrostate() instead.`);
        const flow = {
            type: flowType,
            stage: 'started',
            data: initialData,
            started_at: new Date().toISOString(),
            completed_steps: []
        };
        await this.updateState(userId, { active_flow: flow });
        return flow;
    }

    /**
     * @deprecated Use advanceMicrostate() instead.
     */
    async updateFlow(userId, stage, data = {}) {
        console.warn(`[StateManager] DEPRECATED: updateFlow() called. Use advanceMicrostate() instead.`);
        const state = await this.getState(userId);
        if (!state.active_flow) return null;
        if (state.active_flow.stage && !state.active_flow.completed_steps.includes(state.active_flow.stage)) {
            state.active_flow.completed_steps.push(state.active_flow.stage);
        }
        state.active_flow.stage = stage;
        state.active_flow.data = { ...state.active_flow.data, ...data };
        await this.setState(userId, state);
        return state.active_flow;
    }

    /**
     * @deprecated Use clearMicrostate() instead.
     */
    async completeFlow(userId) {
        console.warn(`[StateManager] DEPRECATED: completeFlow() called. Use clearMicrostate() instead.`);
        const state = await this.getState(userId);
        const completedFlow = state.active_flow;
        await this.updateState(userId, { active_flow: null, expecting_input: null });
        return completedFlow;
    }

    /**
     * @deprecated Use getMicrostate() instead.
     */
    async getActiveFlow(userId) {
        console.warn(`[StateManager] DEPRECATED: getActiveFlow() called. Use getMicrostate() instead.`);
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
        return expecting;
    }

    /**
     * Set last tools executed
     */
    async setLastTools(userId, tools) {
        await this.updateState(userId, { last_tools: tools });
    }

    /**
     * Get last tools executed
     */
    async getLastTools(userId) {
        const state = await this.getState(userId);
        return state.last_tools || [];
    }
    /**
     * Clear expecting input
     */
    async clearExpectingInput(userId) {
        await this.updateState(userId, { expecting_input: null });
    }

    // ============ MICROSTATE MANAGEMENT ============

    /**
     * Open a microstate sandbox.
     * 
     * @param {string} userId
     * @param {object} microstateObj - Full microstate definition:
     *   { type, intent, sandbox, boostScore, params, entities, contract, prompt }
     * @param {number} ttlSeconds - TTL fallback (default 5 min)
     */
    async setMicrostate(userId, microstateObj, ttlSeconds = 300) {
        const state = await this.getState(userId);

        state.microstate = {
            id: `ms_${Date.now()}`,
            type: microstateObj.type,
            intent: microstateObj.intent,
            sandbox: microstateObj.sandbox || 'soft',
            boostScore: microstateObj.boostScore || 10.0,
            params: microstateObj.params || {},
            entities: microstateObj.entities || [],
            options: microstateObj.options || [],
            contract: {
                maxMessages: microstateObj.contract?.maxMessages || 3,
                messagesUsed: 0,
                onFulfilled: microstateObj.contract?.onFulfilled || [],
                onKeyword: microstateObj.contract?.onKeyword || ['cancel', 'nevermind', 'stop'],
                escalation: microstateObj.contract?.escalation || null,
                onFulfilledSpawn: microstateObj.contract?.onFulfilledSpawn || null
            },
            confidence: 1.0,
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString()
        };

        await this.setState(userId, state);
        console.log(`[StateManager] 🔒 Microstate OPENED: "${microstateObj.type}" for intent "${microstateObj.intent}" (${userId})`);
        return state.microstate;
    }

    /**
     * Get active microstate (null if expired or inactive)
     */
    async getMicrostate(userId) {
        const state = await this.getState(userId);
        if (!state.microstate) return null;

        // Check TTL expiry
        if (state.microstate.expires_at && new Date() > new Date(state.microstate.expires_at)) {
            console.log(`[StateManager] Microstate expired (TTL) for ${userId}`);
            await this.clearMicrostate(userId);
            return null;
        }

        // Check contract expiry (maxMessages exceeded)
        if (state.microstate.contract &&
            state.microstate.contract.messagesUsed >= state.microstate.contract.maxMessages) {
            console.log(`[StateManager] Microstate expired (maxMessages: ${state.microstate.contract.maxMessages}) for ${userId}`);
            await this.clearMicrostate(userId);
            return null;
        }

        // Check confidence decay
        if (state.microstate.confidence <= 0) {
            console.log(`[StateManager] Microstate expired (confidence depleted) for ${userId}`);
            await this.clearMicrostate(userId);
            return null;
        }

        return state.microstate;
    }

    /**
     * Advance microstate: merge new params, increment message count, decay confidence.
     * Returns the updated microstate.
     * 
     * @param {string} userId
     * @param {object} newParams - New params to merge
     * @param {boolean} advanced - Whether the message advanced the microstate (filled a param)
     * @returns {object|null} Updated microstate or null if expired
     */
    async advanceMicrostate(userId, newParams = {}, advanced = false) {
        const state = await this.getState(userId);
        if (!state.microstate) return null;

        // Merge new params
        state.microstate.params = { ...state.microstate.params, ...newParams };

        // Multi-field progression: if this microstate tracks ordered fields,
        // advance the pointer when the current field is now satisfied.
        if (state.microstate.fields && Array.isArray(state.microstate.fields) && state.microstate.fields.length > 0) {
            const idx = state.microstate.currentFieldIndex || 0;
            const currentField = state.microstate.fields[idx];
            if (currentField && currentField.name) {
                const val = state.microstate.params[currentField.name];
                if (val !== undefined && val !== null && String(val).trim().length > 0) {
                    const nextIdx = idx + 1;
                    if (nextIdx < state.microstate.fields.length) {
                        state.microstate.currentFieldIndex = nextIdx;
                    }
                }
            }
        }

        // Increment message counter
        state.microstate.contract.messagesUsed++;

        // Decay confidence only if message didn't advance the microstate
        if (!advanced) {
            state.microstate.confidence = Math.max(0, state.microstate.confidence - 0.3);
        }

        await this.setState(userId, state);
        console.log(`[StateManager] Microstate advanced: messages=${state.microstate.contract.messagesUsed}/${state.microstate.contract.maxMessages}, confidence=${state.microstate.confidence.toFixed(1)}, params=${JSON.stringify(newParams)}`);
        return state.microstate;
    }

    /**
     * Clear microstate
     */
    async clearMicrostate(userId) {
        const state = await this.getState(userId);
        state.microstate = null;
        console.log(`[StateManager] 🔓 Microstate CLEARED for ${userId}`);
        await this.setState(userId, state);
    }

    // ═══════════════════════════════════════════════
    // STACK MANAGEMENT (Intent Stack for sequential execution)
    // ═══════════════════════════════════════════════

    /**
     * Set intent stack for sequential execution.
     * Stores remaining intents when microstate opens mid-stack.
     */
    async setStack(userId, stackObj) {
        const state = await this.getState(userId);
        state.stack = {
            remaining_intents: stackObj.remaining_intents || [],
            current_intent_index: stackObj.current_intent_index || 0,
            executed_intents: stackObj.executed_intents || [],
            accumulated_results: stackObj.accumulated_results || [],
            created_at: stackObj.created_at || new Date().toISOString(),
            expires_at: stackObj.expires_at || new Date(Date.now() + 300 * 1000).toISOString()
        };
        console.log(`[StateManager] 📚 Stack SET: ${state.stack.remaining_intents.length} remaining, index=${state.stack.current_intent_index}`);
        await this.setState(userId, state);
        return state.stack;
    }

    /**
     * Get intent stack if valid.
     * Returns null if expired or inactive.
     */
    async getStack(userId) {
        const state = await this.getState(userId);
        if (!state.stack) return null;

        // Check TTL expiry
        if (state.stack.expires_at && new Date() > new Date(state.stack.expires_at)) {
            console.log(`[StateManager] Stack expired (TTL) for ${userId}`);
            await this.clearStack(userId);
            return null;
        }

        return state.stack;
    }

    /**
     * Clear intent stack.
     */
    async clearStack(userId) {
        const state = await this.getState(userId);
        if (state.stack) {
            console.log(`[StateManager] 📚 Stack CLEARED for ${userId}`);
            state.stack = null;
            await this.setState(userId, state);
        }
    }

    // ═══════════════════════════════════════════════
    // SEARCH CONTEXT (semantic reference map)
    // ═══════════════════════════════════════════════

    /**
     * Set search context after a search/browse execution.
     * Overwrites any previous context (single-slot design).
     */
    async setSearchContext(userId, context) {
        const state = await this.getState(userId);

        // Safely extract clause IDs into a clean string array
        let clauseList = context.clauses || [];
        if (Array.isArray(clauseList)) {
            clauseList = clauseList.map(c => typeof c === 'object' ? (c.clauseId || c.id || String(c)) : String(c));
        } else {
            clauseList = typeof clauseList === 'object' ? Object.keys(clauseList) : [String(clauseList)];
        }

        state.search_context = {
            category: context.category || null,
            category_id: context.category_id || context.category || null,
            vendor: context.vendor || null,
            vendor_id: context.vendor_id || context.vendor || null,
            clauses: clauseList,
            attributes: context.attributes || {},
            product_ids: Array.isArray(context.product_ids) ? context.product_ids.slice(0, 10) : [],
            product_attributes_map: context.product_attributes_map || {}, // { productId: { color: 'white', brand: 'Apple', ... } }
            result_count: context.result_count || 0,
            query: context.query || null,
            source_intent: context.source_intent || null,
            created_at: new Date().toISOString(),
            ttl_messages: context.ttl_messages || 5
        };

        const clausesStr = clauseList.join(',');
        console.log(`[StateManager] 📸 Search context SET:`, {
            category: state.search_context.category || 'none',
            clauses: `[${clausesStr}]`,
            product_ids_count: state.search_context.product_ids.length,
            product_attributes_map_count: Object.keys(state.search_context.product_attributes_map || {}).length,
            attributes: state.search_context.attributes,
            sample_product_attrs: Object.keys(state.search_context.product_attributes_map || {}).slice(0, 2).reduce((acc, pid) => {
                acc[pid] = state.search_context.product_attributes_map[pid];
                return acc;
            }, {})
        });

        await this.setState(userId, state);
    }

    /**
     * Get search context if still valid (TTL > 0).
     * Returns null if expired or never set.
     */
    async getSearchContext(userId) {
        const state = await this.getState(userId);
        if (!state.search_context) return null;
        if (state.search_context.ttl_messages <= 0) {
            state.search_context = null;
            await this.setState(userId, state);
            return null;
        }
        console.log(`[StateManager] 🔍 Retrieved search_context:`, {
            product_ids_count: state.search_context.product_ids?.length || 0,
            product_attributes_map_count: Object.keys(state.search_context.product_attributes_map || {}).length,
            clauses: state.search_context.clauses,
            attributes: state.search_context.attributes,
            sample_attrs_map: Object.keys(state.search_context.product_attributes_map || {}).slice(0, 2).reduce((acc, pid) => {
                acc[pid] = state.search_context.product_attributes_map[pid];
                return acc;
            }, {})
        });
        return state.search_context;
    }

    /**
     * Clear search context immediately.
     */
    async clearSearchContext(userId) {
        const state = await this.getState(userId);
        if (state.search_context) {
            console.log(`[StateManager] 🗑️ Search context CLEARED for ${userId}`);
            state.search_context = null;
            await this.setState(userId, state);
        }
    }

    /**
     * Decrement search context TTL. Called once per message.
     * Auto-clears when TTL hits 0.
     */
    async decrementSearchContextTTL(userId) {
        const state = await this.getState(userId);
        if (!state.search_context) return;
        state.search_context.ttl_messages--;
        if (state.search_context.ttl_messages <= 0) {
            console.log(`[StateManager] ⏰ Search context EXPIRED (TTL=0) for ${userId}`);
            state.search_context = null;
        }
        await this.setState(userId, state);
    }

    // ═══════════════════════════════════════════════
    // AMBIENT TOPIC MANAGEMENT
    // ═══════════════════════════════════════════════

    /**
     * Set active topic (browsing context).
     * Called by tool handlers after successful execution.
     */
    async setActiveTopic(userId, topic) {
        const state = await this.getState(userId);
        // Ensure message counts are tagged
        const enrichedTopic = {
            ...topic,
            set_at_message: state.session.message_count,
            reinforced_at_message: state.session.message_count
        };
        state.active_topic = enrichedTopic;
        console.log(`[StateManager] 📡 Active topic SET: "${topic.type}" (${userId})`);
        
        logDebug('STATE:AMBIENT_TOPIC_SET', {
            _desc: 'Ambient Context topic updated',
            userId,
            topicType: topic.type,
            category: topic.category_label || topic.category_id,
            product: topic.product_name || topic.product_id,
            product_ids: topic.product_ids || null,
            vendor: topic.vendor,
            attributes: topic.attributes || null
        });

        await this.setState(userId, state);
    }

    /**
     * Get active topic. 
     * Returns null if stale (> 6 messages since reinforcement).
     */
    async getActiveTopic(userId) {
        const state = await this.getState(userId);
        const topic = state.active_topic;
        if (!topic) return null;

        const messagesSinceTopic = state.session.message_count - topic.reinforced_at_message;
        const threshold = parseInt(process.env.AMBIENT_TOPIC_STALE_THRESHOLD || '6');

        if (messagesSinceTopic > threshold) {
            console.log(`[StateManager] 📡 Topic EXPIRED (stale by ${messagesSinceTopic} messages, threshold ${threshold}) for ${userId}: "${topic.type}"`);
            await this.clearActiveTopic(userId);
            return null;
        }

        console.log(`[StateManager] 📡 Topic ACTIVE for ${userId}: "${topic.type}" (Age: ${messagesSinceTopic} messages)`);

        logDebug('STATE:AMBIENT_TOPIC_RETRIEVED', {
            _desc: 'Ambient Context topic found and active',
            userId,
            topicType: topic.type,
            age: messagesSinceTopic,
            threshold
        });

        return topic;
    }

    /**
     * Reinforce active topic.
     * Updates reinforced_at_message without changing content.
     */
    async reinforceActiveTopic(userId) {
        const state = await this.getState(userId);
        if (state.active_topic) {
            state.active_topic.reinforced_at_message = state.session.message_count;
            console.log(`[StateManager] 📡 Topic REINFORCED at message ${state.session.message_count} (${userId})`);
            await this.setState(userId, state);
        }
    }

    /**
     * Clear active topic.
     */
    async clearActiveTopic(userId) {
        const state = await this.getState(userId);
        if (state.active_topic) {
            state.active_topic = null;
            console.log(`[StateManager] 📡 Topic CLEARED for ${userId}`);
            await this.setState(userId, state);
        }
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
     * Cache product image URL in Redis (to keep state lean)
     */
    async cacheProductImage(productId, imageUrl) {
        if (!productId || !imageUrl) return;
        try {
            if (redisClient.isRedisConnected()) {
                // Store with a long TTL (e.g. 24 hours) as images don't change often
                await redisClient.getClient().setEx(`product_image:${productId}`, 86400, imageUrl);
            }
        } catch (error) {
            console.error(`[StateManager] Failed to cache image for ${productId}:`, error.message);
        }
    }

    /**
     * Retrieve product image URL from Redis
     */
    async getProductImage(productId) {
        if (!productId) return null;
        try {
            if (redisClient.isRedisConnected()) {
                return await redisClient.getClient().get(`product_image:${productId}`);
            }
            return null;
        } catch (error) {
            console.error(`[StateManager] Failed to get image for ${productId}:`, error.message);
            return null;
        }
    }

    /**
     * Intelligent Reference Mapping:
     * - Accumulates single product results (fills empty slots for first, second...).
     * - Overwrites context for sets (>1 results).
     * - Preserves product slugs (name-based refs) cumulatively.
     * - Additive plurals: 'them'/'all' append single products, overwrite on sets.
     */
    async updateReferenceMap(userId, products, options = {}) {
        if (!products || products.length === 0) return;

        const state = await this.getState(userId);
        const scope = (options && options.scope) ? String(options.scope).toLowerCase() : 'global';
        const useMicrostateScope = scope === 'microstate' && state.microstate;

        const referenceMap = useMicrostateScope
            ? (state.microstate.reference_map || {})
            : (state.reference_map || {});
        let ordinalList = useMicrostateScope
            ? ([...(state.microstate.ordinal_list || [])])
            : ([...(state.ordinal_list || [])]);
        const isSingleProduct = products.length === 1;

        const slotKeys = ['the_first_one', 'the_second_one', 'the_third_one', 'first', 'second', 'third'];
        const ordinalNames = ['first', 'second', 'third', 'fourth', 'fifth'];

        if (!isSingleProduct) {
            // --- SET OVERWRITE RULE ---
            console.log(`[StateManager] 🔄 Overwriting context with set of ${products.length} items`);

            // Clear positional ordinals
            slotKeys.forEach(k => delete referenceMap[k]);
            ordinalList = [];

            products.forEach((product, idx) => {
                const id = product.handle || product.id || product.product_id;
                ordinalList.push(id);

                // Map first few slots
                if (idx === 0) { referenceMap.the_first_one = id; referenceMap.first = id; }
                if (idx === 1) { referenceMap.the_second_one = id; referenceMap.second = id; }
                if (idx === 2) { referenceMap.the_third_one = id; referenceMap.third = id; }
            });

            // Map plurals to full set
            referenceMap.them = ordinalList.join(',');
            referenceMap.all = ordinalList.join(',');
            referenceMap.the_products = ordinalList.join(',');
            referenceMap.all_of_them = ordinalList.join(',');

            // Map singulars to first
            referenceMap.it = ordinalList[0];
            referenceMap.this = ordinalList[0];
            referenceMap.that = ordinalList[0];
            referenceMap.the_one = ordinalList[0];

            // Re-calc Relational references for the set
            const prices = products.map(p => p.price).filter(p => !isNaN(p)).sort((a, b) => a - b);
            if (prices.length > 0) {
                const cheapest = products.find(p => p.price === prices[0]);
                const expensive = products.find(p => p.price === prices[prices.length - 1]);
                if (cheapest) referenceMap.the_cheapest = cheapest.handle || cheapest.id || cheapest.product_id;
                if (expensive) referenceMap.the_most_expensive = expensive.handle || expensive.id || expensive.product_id;
            }
        } else {
            // --- ACCUMULATION RULE (Single Product) ---
            const product = products[0];
            const id = product.handle || product.id || product.product_id;
            console.log(`[StateManager] ➕ Accumulating single product: ${id}`);

            if (!ordinalList.includes(id)) {
                ordinalList.push(id);
            }

            // Fill first empty slot
            for (let i = 0; i < ordinalNames.length; i++) {
                const name = ordinalNames[i];
                const the_name = `the_${name}_one`;
                if (!referenceMap[name] || referenceMap[name] === 'null') {
                    referenceMap[name] = id;
                    referenceMap[the_name] = id;
                    break;
                }
            }

            // Additive Plurals
            let currentPlural = referenceMap.all ? referenceMap.all.split(',') : [];
            if (!currentPlural.includes(id)) {
                currentPlural.push(id);
                const pluralStr = currentPlural.join(',');
                referenceMap.them = pluralStr;
                referenceMap.all = pluralStr;
                referenceMap.ones = pluralStr;
                referenceMap.the_ones = pluralStr;
                referenceMap.the_products = pluralStr;
                referenceMap.all_of_them = pluralStr;
            }

            // Singular Overwrite (Always points to latest)
            referenceMap.it = id;
            referenceMap.this = id;
            referenceMap.that = id;
            referenceMap.the_one = id;
        }

        // --- ALWAYS: CUMULATIVE SLUGS ---
        products.forEach(product => {
            const id = product.handle || product.id || product.product_id;
            if (product.name) {
                const nameSlug = product.name.toLowerCase().replace(/\s+/g, '_');
                const nameIdentifier = product.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
                referenceMap[nameSlug] = id;
                if (nameIdentifier !== nameSlug) referenceMap[nameIdentifier] = id;

                // Vendor/Brand Slugs
                const vendor = (product.vendor || product.metadata?.vendor || '').toLowerCase().trim();
                const brands = ['samsung', 'apple', 'iphone', 'macbook', 'dell', 'hp', 'lenovo', 'asus', 'sony', 'lg', 'infinix', 'tecno'];

                if (vendor) {
                    const vendorSlug = vendor.replace(/\s+/g, '_');
                    referenceMap[vendorSlug] = id;
                    referenceMap[`the_${vendorSlug}_one`] = id;
                }
                brands.forEach(brand => {
                    if (product.name.toLowerCase().includes(brand)) {
                        referenceMap[brand] = id;
                        referenceMap[`the_${brand}`] = id;
                        referenceMap[`the_${brand}_one`] = id;
                    }
                });
            }
        });

        if (useMicrostateScope) {
            state.microstate.reference_map = referenceMap;
            state.microstate.ordinal_list = ordinalList;
        } else {
            state.reference_map = referenceMap;
            state.ordinal_list = ordinalList;
        }
        await this.setState(userId, state);
        console.log(`[StateManager] Reference map updated (${useMicrostateScope ? 'microstate' : 'global'}). Keys: ${Object.keys(referenceMap).length}, Items in list: ${ordinalList.length}`);
    }

    /**
     * Update user_query_map: Volatile map of user's search queries -> product IDs
     * Only stores queries that successfully matched products.
     * Session-only (not persisted to Redis).
     * 
     * @param {string} userId - User session ID
     * @param {string} query - User's search query (normalized)
     * @param {Array} products - Products found for this query
     */
    async updateUserQueryMap(userId, query, products) {
        if (!query || !products || products.length === 0) return;

        // Ensure query is a string (can be object/number from params in some flows)
        const queryStr = typeof query === 'string' ? query : (query?.query ?? String(query));
        if (typeof queryStr !== 'string' || queryStr.trim().length === 0) return;

        const state = await this.getState(userId);
        const userQueryMap = state.user_query_map || {};
        
        // Normalize query: lowercase, trim, collapse whitespace
        const normalizedQuery = queryStr.toLowerCase().trim().replace(/\s+/g, ' ');
        
        // Extract product IDs
        const productIds = products.map(p => p.handle || p.id || p.product_id).filter(Boolean);
        
        if (productIds.length === 0) return;
        
        // Store: single product as string, multiple as comma-separated
        if (productIds.length === 1) {
            userQueryMap[normalizedQuery] = productIds[0];
            console.log(`[StateManager] 📝 User query map: "${normalizedQuery}" → ${productIds[0]} (single product)`);
        } else {
            userQueryMap[normalizedQuery] = productIds.join(',');
            console.log(`[StateManager] 📝 User query map: "${normalizedQuery}" → ${productIds.join(',')} (${productIds.length} products)`);
        }
        
        state.user_query_map = userQueryMap;
        // Note: user_query_map is volatile - only stored in memory cache, not persisted to Redis
        await this.setState(userId, state);
    }

    /**
     * Resolve a user query to product ID(s) from user_query_map
     * Returns single ID string or comma-separated string for sets
     * 
     * @param {string} userId - User session ID
     * @param {string} query - User's search query
     * @returns {string|null} - Product ID(s) or null if not found
     */
    async resolveUserQuery(userId, query) {
        if (!query) return null;

        const queryStr = typeof query === 'string' ? query : (query?.query ?? String(query));
        if (typeof queryStr !== 'string' || queryStr.trim().length === 0) return null;
        
        const state = await this.getState(userId);
        const userQueryMap = state.user_query_map || {};
        
        // Normalize query
        const normalizedQuery = queryStr.toLowerCase().trim().replace(/\s+/g, ' ');
        
        // Exact match
        if (userQueryMap[normalizedQuery]) {
            return userQueryMap[normalizedQuery];
        }
        
        // Try substring matching (e.g., "spaghetti" matches "home made spaghetti")
        for (const [key, value] of Object.entries(userQueryMap)) {
            if (key.includes(normalizedQuery) || normalizedQuery.includes(key)) {
                return value;
            }
        }
        
        return null;
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

        // Prefer microstate-scoped references when a microstate is active.
        const msMap = state.microstate?.reference_map || null;
        const msOrdinals = Array.isArray(state.microstate?.ordinal_list) ? state.microstate.ordinal_list : null;

        if (msMap && msMap[refLower]) {
            console.log(`[StateManager] Resolved "${reference}" → ${msMap[refLower]} (microstate)`);
            return msMap[refLower];
        }

        // Check global reference map
        if (state.reference_map[refLower]) {
            console.log(`[StateManager] Resolved "${reference}" → ${state.reference_map[refLower]}`);
            return state.reference_map[refLower];
        }

        // Check ordinal positions (microstate first)
        const ordinalMatchMs = reference.match(/(\d+)(st|nd|rd|th)/i);
        if (ordinalMatchMs && msOrdinals) {
            const position = parseInt(ordinalMatchMs[1]) - 1;
            if (msOrdinals[position]) {
                console.log(`[StateManager] Resolved "${reference}" → ${msOrdinals[position]} (microstate ordinal)`);
                return msOrdinals[position];
            }
        }

        // Check ordinal positions (global)
        const ordinalMatchGlobal = reference.match(/(\d+)(st|nd|rd|th)/i);
        if (ordinalMatchGlobal) {
            const position = parseInt(ordinalMatchGlobal[1]) - 1;
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

        // If no suggestion or no intent, return null
        if (!suggestion || !suggestion.intent) {
            return null;
        }

        // Check timestamp validity and age
        const timestamp = suggestion.timestamp ? new Date(suggestion.timestamp).getTime() : 0;
        const age = Date.now() - timestamp;
        const TTL = 2 * 60 * 1000; // 2 minutes expiry (was 5)

        // If expired or invalid timestamp, clear and return null
        if (!suggestion.timestamp || age > TTL || age < 0) {
            console.log(`[StateManager] Clearing expired suggestion: ${suggestion.intent} (Age: ${Math.round(age / 1000)}s)`);
            await this.clearLastSuggestion(userId);
            return null;
        }

        return suggestion;
    }

    async clearLastSuggestion(userId) {
        await this.updateState(userId, {
            last_bot_suggestion: { type: null, intent: null, params: {}, text: null, timestamp: null }
        });
    }
    /**
     * Pause current context (e.g. search results) to switch to conversation
     */
    async pauseContext(userId, type, data) {
        // Save contextual data with a timestamp
        const context = {
            type,
            data,
            pausedAt: new Date().toISOString()
        };
        await this.updateState(userId, { paused_context: context });
        console.log(`[StateManager] Context paused: ${type}`);
    }

    /**
     * Get paused context
     */
    async getPausedContext(userId) {
        const state = await this.getState(userId);
        return state.paused_context;
    }

    /**
     * Resume paused context and clear it
     */
    async resumeContext(userId) {
        const state = await this.getState(userId);
        if (!state.paused_context) return null;

        const context = state.paused_context;
        // Check expiry (e.g. 10 mins) - conversational drift might make it irrelevant
        const age = Date.now() - new Date(context.pausedAt).getTime();
        if (age > 10 * 60 * 1000) {
            console.log(`[StateManager] Paused context expired (${Math.round(age / 60000)}m)`);
            await this.clearPausedContext(userId);
            return null;
        }

        console.log(`[StateManager] Resuming context: ${context.type}`);
        // Clear it after retrieving
        await this.clearPausedContext(userId);
        return context;
    }

    async clearPausedContext(userId) {
        await this.updateState(userId, { paused_context: null });
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

