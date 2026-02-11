/**
 * Redis Connection Module
 * Handles Redis client setup, connection management, and utilities
 */

const redis = require('redis');

// Redis configuration
const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
};

// Key prefix for namespacing
const KEY_PREFIX = 'be3:state:';

let client = null;
let isConnected = false;

/**
 * Initialize Redis client
 */
async function initRedis() {
    if (client) {
        return client;
    }

    try {
        client = redis.createClient({
            socket: {
                host: REDIS_CONFIG.host,
                port: REDIS_CONFIG.port,
                reconnectStrategy: REDIS_CONFIG.retryStrategy
            },
            password: REDIS_CONFIG.password,
            database: REDIS_CONFIG.db
        });

        client.on('error', (err) => {
            console.error('[Redis] Error:', err.message);
            isConnected = false;
        });

        client.on('connect', () => {
            console.log('[Redis] Connecting...');
        });

        client.on('ready', () => {
            console.log('[Redis] Connected and ready');
            isConnected = true;
        });

        client.on('reconnecting', () => {
            console.log('[Redis] Reconnecting...');
            isConnected = false;
        });

        await client.connect();
        return client;
    } catch (error) {
        console.error('[Redis] Failed to initialize:', error.message);
        console.warn('[Redis] Running in fallback mode (in-memory only)');
        return null;
    }
}

/**
 * Get Redis client (with fallback)
 */
function getClient() {
    return client;
}

/**
 * Check if Redis is connected
 */
function isRedisConnected() {
    return isConnected && client !== null;
}

/**
 * Generate Redis key for user state
 */
function getStateKey(userId) {
    return `${KEY_PREFIX}${userId}`;
}

/**
 * Set state in Redis with TTL
 */
async function setState(userId, state, ttl = 3600) {
    if (!isRedisConnected()) {
        console.warn('[Redis] Not connected, state not persisted');
        return false;
    }

    try {
        const key = getStateKey(userId);
        const serialized = JSON.stringify(state);

        await client.setEx(key, ttl, serialized);
        return true;
    } catch (error) {
        console.error('[Redis] Error setting state:', error.message);
        return false;
    }
}

/**
 * Get state from Redis
 */
async function getState(userId) {
    if (!isRedisConnected()) {
        return null;
    }

    try {
        const key = getStateKey(userId);
        const serialized = await client.get(key);

        if (!serialized) {
            return null;
        }

        return JSON.parse(serialized);
    } catch (error) {
        console.error('[Redis] Error getting state:', error.message);
        return null;
    }
}

/**
 * Delete state from Redis
 */
async function deleteState(userId) {
    if (!isRedisConnected()) {
        return false;
    }

    try {
        const key = getStateKey(userId);
        await client.del(key);
        return true;
    } catch (error) {
        console.error('[Redis] Error deleting state:', error.message);
        return false;
    }
}

/**
 * Extend TTL for a state key
 */
async function extendTTL(userId, seconds = 3600) {
    if (!isRedisConnected()) {
        return false;
    }

    try {
        const key = getStateKey(userId);
        await client.expire(key, seconds);
        return true;
    } catch (error) {
        console.error('[Redis] Error extending TTL:', error.message);
        return false;
    }
}

/**
 * Check if state exists
 */
async function stateExists(userId) {
    if (!isRedisConnected()) {
        return false;
    }

    try {
        const key = getStateKey(userId);
        const exists = await client.exists(key);
        return exists === 1;
    } catch (error) {
        console.error('[Redis] Error checking state existence:', error.message);
        return false;
    }
}

/**
 * Get TTL for a state key
 */
async function getTTL(userId) {
    if (!isRedisConnected()) {
        return -1;
    }

    try {
        const key = getStateKey(userId);
        return await client.ttl(key);
    } catch (error) {
        console.error('[Redis] Error getting TTL:', error.message);
        return -1;
    }
}

/**
 * Close Redis connection
 */
async function closeRedis() {
    if (client) {
        await client.quit();
        client = null;
        isConnected = false;
        console.log('[Redis] Connection closed');
    }
}

module.exports = {
    initRedis,
    getClient,
    isRedisConnected,
    setState,
    getState,
    deleteState,
    extendTTL,
    stateExists,
    getTTL,
    closeRedis
};
